// POST /api/citation { url, region?, regions?, procedure?, email?, queries? } — real-citation panel.
//
// v1 = INTERNAL OPERATOR TOOL. Gate = `x-operator-key` header (== OPERATOR_KEY env). The operator
// path returns the FULL private report (named competitors + evidence) via toPrivateReport — that's a
// private 1:1 sales deliverable, not a public ad. The public (non-operator) path requires an email and
// only ever returns the redacted toPublicView (no competitor identities — 의료광고법).
//
// SAFETY: live engine calls run ONLY if CITATION_ENABLED=true AND ≥1 engine key is set. Cost guard =
// 24h cache (domain|region|procedure) + DAILY_CITATION_CAP global counter (lib/store). The in-memory
// store is fine for internal/low volume; back it with KV + per-IP limits BEFORE any public path.
//
// Multi-region: pass `regions: string[]` (max 5) to run one panel per region in parallel and get
// a { byRegion: { region: panel } } response. `regions` overrides `region`.
import { createHash } from 'node:crypto';
import { runCitationPanel } from '../lib/citation.js';
import { AUTO_ENGINES } from '../lib/engines.js';
import { checkNaverLocal, naverApiAvailable } from '../lib/naver.js';
import { registrableDomain } from '../lib/normalize.js';
import { toPublicView, toPrivateReport } from '../lib/redact.js';
import { makeStore } from '../lib/store.js';
import { kv } from '../lib/kv.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const ENV_KEYS = { chatgpt: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY' };
const DAY = 86_400_000;
// Repeat each query N× to stabilize the noisy single-shot rate (Wilson CI needs N≥2). Clamp 1–3.
// Cost: requests = engines × prompts × repeats. Override with CITATION_REPEATS env.
const REPEATS = Math.max(1, Math.min(parseInt(process.env.CITATION_REPEATS || '3', 10) || 3, 3));
const store = makeStore({ kv }); // kv = Upstash when KV_REST_API_URL+TOKEN set, else in-memory

const maskEmail = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');

// Stable 16-char hex digest of the raw IP string — never log or expose the raw IP.
function hashIp(raw) {
  return createHash('sha256').update(String(raw || 'unknown')).digest('hex').slice(0, 16);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  const { url, email, region, regions, procedure, queries, clinicName } = req.body || {};

  // --- operator gate (internal tool) ---
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  const isOperator = operatorKeySet && req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (operatorKeySet && !isOperator) {
    res.status(401).json({ error: 'operator-key-required', message: '운영자 키가 필요합니다.' });
    return;
  }
  // public (no operator-key configured) path keeps the email lead gate
  if (!isOperator) {
    if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      res.status(400).json({ error: 'email-required', message: '실측 결과를 받을 이메일이 필요합니다.' });
      return;
    }
  }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'missing-url' });
    return;
  }
  const domain = registrableDomain(url);
  const view = (data) => (isOperator ? toPrivateReport(data, url) : toPublicView(data));
  // Stable IP hash for per-IP rate limiting. Operators bypass all IP limits (ipHash = null).
  const rawIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipHash = isOperator ? null : hashIp(rawIp);
  console.log('[citation]', isOperator ? 'operator' : maskEmail(email), domain, region || '', procedure || '');

  // Multi-region: `regions` overrides `region`. Clamped to 5, empty strings filtered out.
  const rawRegions = Array.isArray(regions) && regions.length > 0
    ? regions.slice(0, 5).map((r) => String(r).trim()).filter(Boolean)
    : null;
  const effectiveRegions = rawRegions || (region ? [String(region).trim()] : ['']);
  const isMulti = effectiveRegions.length > 1;

  // which engines have keys configured?
  const keys = {};
  for (const e of AUTO_ENGINES) {
    const k = process.env[ENV_KEYS[e]];
    if (k) keys[e] = k;
  }
  const enabled = process.env.CITATION_ENABLED === 'true' && Object.keys(keys).length > 0;
  if (!enabled) {
    res.status(202).json({
      status: 'pending',
      domain,
      ...(isMulti ? { regions: effectiveRegions } : {}),
      message: isOperator ? '측정 비활성(키/CITATION_ENABLED 필요).' : '신청되었습니다. 실측 결과를 이메일로 보내드리겠습니다.',
    });
    return;
  }

  try {
    // Build customPrompts early so cache key can include query fingerprint.
    const rawCustom = Array.isArray(queries) && queries.length > 0
      ? queries.slice(0, 3).map((q) => String(q).trim().slice(0, 300)).filter(Boolean)
      : null;
    const customPrompts = rawCustom && rawCustom.length > 0 ? rawCustom : null;
    const queryFP = customPrompts ? customPrompts.slice().sort().join('§').slice(0, 120) : '';
    const queryCount = customPrompts ? customPrompts.length : 3;

    if (isMulti) {
      // --- Multi-region path ---
      const costNote = buildCostNote(effectiveRegions.length, Object.keys(keys).length, queryCount);
      // Cache key uses sorted region list so order-invariant
      const cacheKey = `multi|${domain}|${effectiveRegions.slice().sort().join('‖')}|${(procedure || '').trim().toLowerCase()}|${queryFP}`;
      const cached = await store.cacheGet(cacheKey);
      if (cached) {
        const byRegion = buildByRegionView(cached.panelsByRegion, effectiveRegions, view);
        res.status(200).json({ clinicDomain: domain, regions: effectiveRegions, procedure: procedure || '', byRegion, measuredAt: cached.measuredAt, costNote, view: isOperator ? 'private' : 'public', cached: true });
        return;
      }

      // Per-IP + daily global cap — checked after cache miss, before any paid call
      if (await enforceRateCaps(ipHash, domain, store, res)) return;

      const settlements = await Promise.allSettled(
        effectiveRegions.map((r) => runCitationPanel({
          clinicDomain: domain,
          region: r,
          procedure: procedure || '',
          keys,
          loc: { city: r },
          repeats: REPEATS,
          clinicName: clinicName || '',
          customPrompts,
        }))
      );

      const panelsByRegion = {};
      const measuredAt = new Date().toISOString();
      for (let i = 0; i < effectiveRegions.length; i++) {
        const r = effectiveRegions[i];
        const s = settlements[i];
        panelsByRegion[r] = s.status === 'fulfilled' ? s.value : { error: String(s.reason?.message || 'unknown') };
      }

      await store.cacheSet(cacheKey, { type: 'multi', panelsByRegion, measuredAt }, DAY);
      const byRegion = buildByRegionView(panelsByRegion, effectiveRegions, view);
      res.status(200).json({ clinicDomain: domain, regions: effectiveRegions, procedure: procedure || '', byRegion, measuredAt, costNote, view: isOperator ? 'private' : 'public' });
      return;
    }

    // --- Single-region path (existing behavior) ---
    const cacheKey = `${domain}|${(effectiveRegions[0] || '').toLowerCase()}|${(procedure || '').trim().toLowerCase()}|${queryFP}`;
    const cached = await store.cacheGet(cacheKey);
    if (cached) {
      res.status(200).json({ ...view(cached), cached: true });
      return;
    }

    if (await enforceRateCaps(ipHash, domain, store, res)) return;

    const result = await runCitationPanel({
      clinicDomain: domain,
      region: effectiveRegions[0] || '',
      procedure: procedure || '',
      keys,
      loc: { city: effectiveRegions[0] || '' },
      repeats: REPEATS,
      clinicName: clinicName || '',
      customPrompts,
    });
    // Naver Local API check (non-blocking, parallel with cache write)
    let naverResult = null;
    if (naverApiAvailable()) {
      naverResult = await checkNaverLocal({
        clinicDomain: domain,
        region: effectiveRegions[0] || '',
        procedure: procedure || '',
        clientId:     process.env.NAVER_CLIENT_ID,
        clientSecret: process.env.NAVER_CLIENT_SECRET,
      }).catch(() => null);
    }

    const enriched = naverResult ? { ...result, naverLocal: naverResult } : result;
    await store.cacheSet(cacheKey, enriched, DAY);

    // Persist citation history (non-blocking — never fail the response on KV errors)
    const histRecord = {
      ts: new Date().toISOString(),
      region: effectiveRegions[0] || '',
      procedure: procedure || '',
      engines: (result.perEngine || []).map((p) => ({
        engine: p.engine,
        cited: p.cited,
        citedRuns: p.citedRuns ?? 0,
        validRuns: p.validRuns ?? 0,
      })),
    };
    store.histAppend(`c:${domain}`, histRecord).catch(() => {});

    res.status(200).json(view(enriched));
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}

// Build byRegion response: apply view() to each raw panel; pass through errors unchanged.
function buildByRegionView(panelsByRegion, regions, viewFn) {
  const byRegion = {};
  for (const r of regions) {
    const p = panelsByRegion?.[r];
    byRegion[r] = p && !p.error ? viewFn(p) : (p || { error: 'missing' });
  }
  return byRegion;
}

// Rough cost estimate string shown alongside multi-region results.
function buildCostNote(nRegions, nEngines, nQueries) {
  const approx = (nRegions * nEngines * nQueries * 0.06).toFixed(2);
  return `${nRegions}지역 × ${nEngines}엔진 × ${nQueries}쿼리 ≈ $${approx}`;
}

// Returns true and sends the 429/202 response if the request should be blocked by rate caps.
// Returns false if the request should proceed. Used by both multi-region and single-region paths.
async function enforceRateCaps(ipHash, domain, store, res) {
  if (ipHash) {
    const perIpCap = parseInt(process.env.PER_IP_DAILY_CAP || '0', 10);
    if (perIpCap > 0) {
      const dayKey = new Date().toISOString().slice(0, 10);
      const n = await store.incrIpDaily(ipHash, dayKey);
      if (n > perIpCap) {
        res.status(429).json({ error: 'rate-limited', message: '하루 측정 한도를 초과했습니다. 내일 다시 시도해주세요.' });
        return true;
      }
    }
  }
  const cap = parseInt(process.env.DAILY_CITATION_CAP || '0', 10);
  if (cap > 0) {
    const dayKey = new Date().toISOString().slice(0, 10);
    const n = await store.incrDaily(dayKey);
    if (n > cap) {
      res.status(202).json({ status: 'cap-reached', domain, message: '오늘 실측 한도 소진 — 내일 다시 또는 상담.' });
      return true;
    }
  }
  return false;
}
