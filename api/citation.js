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
import { sendAlert } from '../lib/alert.js';
import { auditUrl } from '../lib/audit.js';
import { runCitationPanel } from '../lib/citation.js';
import { diagnose } from '../lib/diagnose.js';
import { AUTO_ENGINES, allQueryVariants } from '../lib/engines.js';
import { checkNaverLocal, naverApiAvailable } from '../lib/naver.js';
import { registrableDomain, isKnownPlatformDomain } from '../lib/normalize.js';
import { toPublicView, toPrivateReport } from '../lib/redact.js';
import { makeStore } from '../lib/store.js';
import { kv } from '../lib/kv.js';
import { isOperatorRequest } from '../lib/operator-auth.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const ENV_KEYS = { chatgpt: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY' };
const DAY = 86_400_000;
const MAX_CUSTOM_QUERIES = 3;
// Repeat each query N× to stabilize the noisy single-shot rate (Wilson CI needs N≥2). Clamp 1–3.
// Cost: requests = engines × prompts × repeats. Override with CITATION_REPEATS env.
const REPEATS = Math.max(1, Math.min(parseInt(process.env.CITATION_REPEATS || '3', 10) || 3, 3));
const store = makeStore({ kv }); // kv = Upstash when KV_REST_API_URL+TOKEN set, else in-memory

const maskEmail = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');

export function sanitizeQueryIndexes(value, maxExclusive = 20) {
  if (!Array.isArray(value)) return [];
  const upperBound = Number.isInteger(maxExclusive) && maxExclusive > 0 ? maxExclusive : 20;
  return [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < upperBound))]
    .slice(0, MAX_CUSTOM_QUERIES);
}

export function selectedPromptsForRegion({ indexes = [], customPrompts = null, region = '', procedure = '', businessType = '치과' } = {}) {
  if (indexes.length) {
    const variants = allQueryVariants({ district: region, procedure, businessType });
    return indexes.map((index) => variants[index]).filter(Boolean);
  }
  return customPrompts;
}

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
  const { url, email, region, regions, procedure, queries, queryIndexes, clinicName, businessType } = req.body || {};

  // --- operator gate (internal tool) ---
  const isOperator = isOperatorRequest(req);
  // Operator-only cache bypass: x-nocache:1 header or ?nocache=1 / body.nocache:true
  const noCache = isOperator && (
    req.headers['x-nocache'] === '1' ||
    req.query?.nocache === '1' ||
    req.body?.nocache === true
  );
  // Non-operator (public) path: allow through with email gate (Path A). toPublicView masks competitors.
  // DAILY_CITATION_CAP=20 guards cost. Operators (x-operator-key) get full private report.
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
  if (isKnownPlatformDomain(url)) {
    res.status(400).json({ error: 'platform-url', message: '네이버 플레이스·블로그·SNS URL은 분석할 수 없습니다. 병원 자체 홈페이지 URL을 입력해 주세요.' });
    return;
  }
  const domain = registrableDomain(url);
  const view = (data) => (isOperator ? toPrivateReport(data, url) : toPublicView(data));
  // Stable IP hash for per-IP rate limiting. Operators bypass all IP limits (ipHash = null).
  const rawIp = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipHash = isOperator ? null : hashIp(rawIp);
  console.log('[citation]', isOperator ? 'operator' : maskEmail(email), domain, region || '', procedure || '');
  if (!isOperator && email) {
    sendAlert(`📬 **새 공개 리드**\n이메일: ${maskEmail(email)}\n치과: ${clinicName || '(미입력)'}\nURL: ${url}`).catch(() => {});
  }

  // Multi-region: `regions` overrides `region`. Clamped to 5, empty strings filtered out.
  const rawRegions = Array.isArray(regions) && regions.length > 0
    ? [...new Set(regions.map((r) => String(r).trim().slice(0, 40)).filter(Boolean))].slice(0, 5)
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
    const variantCount = allQueryVariants({
      district: effectiveRegions[0] || '',
      procedure: procedure || '',
      businessType: businessType || '치과',
    }).length;
    const selectedIndexes = sanitizeQueryIndexes(queryIndexes, variantCount);
    const rawCustom = !selectedIndexes.length && Array.isArray(queries) && queries.length > 0
      ? queries.slice(0, MAX_CUSTOM_QUERIES).map((q) => String(q).trim().slice(0, 300)).filter(Boolean)
      : null;
    const customPrompts = rawCustom && rawCustom.length > 0 ? rawCustom : null;
    const queryFP = selectedIndexes.length
      ? `indexes:${selectedIndexes.join(',')}`
      : (customPrompts ? customPrompts.slice().sort().join('§').slice(0, 120) : '');
    const queryCount = selectedIndexes.length || (customPrompts ? customPrompts.length : 4);

    if (isMulti) {
      // --- Multi-region path ---
      const costNote = buildCostNote(effectiveRegions.length, Object.keys(keys).length, queryCount, REPEATS);
      // Cache key uses sorted region list so order-invariant
      const cacheKey = `multi|${domain}|${effectiveRegions.slice().sort().join('‖')}|${(procedure || '').trim().toLowerCase()}|${queryFP}`;
      const cached = noCache ? null : await store.cacheGet(cacheKey);
      if (cached) {
        const byRegion = buildByRegionView(cached.panelsByRegion, effectiveRegions, view);
        res.status(200).json({
          clinicDomain: domain, regions: effectiveRegions, procedure: procedure || '', byRegion,
          measuredAt: cached.measuredAt, costNote, view: isOperator ? 'private' : 'public', cached: true,
          ...(cached.structure
            ? { diagnosisByRegion: buildDiagnosisByRegion(cached.structure, cached.panelsByRegion, effectiveRegions) }
            : {}),
        });
        return;
      }

      // Per-IP + daily global cap — checked after cache miss, before any paid call
      if (await enforceRateCaps(ipHash, domain, store, res)) return;

      // 구조는 지역과 무관하게 같은 사이트다 — 한 번만 읽어 모든 지역 진단에 재사용한다.
      const structurePromiseMulti = structureSummary(url);
      const settlements = await Promise.allSettled(
        effectiveRegions.map((r) => runCitationPanel({
          clinicDomain: domain,
          region: r,
          procedure: procedure || '',
          businessType: businessType || '치과',
          keys,
          loc: { city: r },
          repeats: REPEATS,
          clinicName: clinicName || '',
          customPrompts: selectedPromptsForRegion({
            indexes: selectedIndexes,
            customPrompts,
            region: r,
            procedure: procedure || '',
            businessType: businessType || '치과',
          }),
        }))
      );

      const panelsByRegion = {};
      const measuredAt = new Date().toISOString();
      for (let i = 0; i < effectiveRegions.length; i++) {
        const r = effectiveRegions[i];
        const s = settlements[i];
        panelsByRegion[r] = s.status === 'fulfilled' ? s.value : { error: String(s.reason?.message || 'unknown') };
      }

      const structureMulti = await structurePromiseMulti;
      await store.cacheSet(cacheKey, { type: 'multi', panelsByRegion, measuredAt, ...(structureMulti ? { structure: structureMulti } : {}) }, DAY);

      // Persist citation history per region (non-blocking, same shape as single-region path)
      for (const r of effectiveRegions) {
        const panel = panelsByRegion[r];
        if (!panel || panel.error) continue;
        store.histAppend(`c:${domain}`, {
          ts: measuredAt,
          region: r,
          procedure: procedure || '',
          engines: (panel.perEngine || []).map((p) => ({
            engine: p.engine,
            cited: p.cited,
            citedRuns: p.citedRuns ?? 0,
            validRuns: p.validRuns ?? 0,
          })),
        }).catch(() => {});
      }

      const byRegion = buildByRegionView(panelsByRegion, effectiveRegions, view);
      res.status(200).json({
        clinicDomain: domain, regions: effectiveRegions, procedure: procedure || '', byRegion,
        measuredAt, costNote, view: isOperator ? 'private' : 'public',
        ...(structureMulti
          ? { diagnosisByRegion: buildDiagnosisByRegion(structureMulti, panelsByRegion, effectiveRegions) }
          : {}),
      });
      return;
    }

    // --- Single-region path (existing behavior) ---
    const costNote = buildCostNote(1, Object.keys(keys).length, queryCount, REPEATS);
    const cacheKey = `${domain}|${(effectiveRegions[0] || '').toLowerCase()}|${(procedure || '').trim().toLowerCase()}|${queryFP}`;
    const cached = noCache ? null : await store.cacheGet(cacheKey);
    if (cached) {
      // 구조는 캐시와 함께 저장해 둔다(없으면 구버전 캐시 — 진단만 생략하고 실측은 그대로 낸다).
      res.status(200).json({
        ...view(cached), costNote, cached: true,
        ...(cached.structure ? { diagnosis: buildDiagnosis(cached.structure, cached) } : {}),
      });
      return;
    }

    if (await enforceRateCaps(ipHash, domain, store, res)) return;

    // 구조 진단은 실측과 동시에 돌린다. 유료 호출을 기다리는 동안 어차피 놀고 있는 시간이다.
    const structurePromise = structureSummary(url);
    const result = await runCitationPanel({
      clinicDomain: domain,
      region: effectiveRegions[0] || '',
      procedure: procedure || '',
      businessType: businessType || '치과',
      keys,
      loc: { city: effectiveRegions[0] || '' },
      repeats: REPEATS,
      clinicName: clinicName || '',
      customPrompts: selectedPromptsForRegion({
        indexes: selectedIndexes,
        customPrompts,
        region: effectiveRegions[0] || '',
        procedure: procedure || '',
        businessType: businessType || '치과',
      }),
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

    const structure = await structurePromise;
    const enriched = {
      ...result,
      ...(naverResult ? { naverLocal: naverResult } : {}),
      ...(structure ? { structure } : {}),
    };
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

    res.status(200).json({
      ...view(enriched), costNote,
      ...(structure ? { diagnosis: buildDiagnosis(structure, result) } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}

// 구조 점수를 가볍게 확보한다. 유료 API가 아니라 페이지 1회 fetch라 실측 비용에 영향이 없다.
// 실패해도 절대 실측 응답을 깨뜨리지 않는다 — 진단은 부가 정보이고 실측이 본체다.
async function structureSummary(url) {
  try {
    const r = await auditUrl(url, { timeoutMs: 8000 });
    return {
      score: r.score, band: r.band, breakdown: r.breakdown,
      needsHeadless: r.needsHeadless, axes: r.axes,
    };
  } catch {
    return null;
  }
}

// 구조 + 실측을 합쳐 "왜 이런 결과인지"를 만든다. 구조를 못 읽었으면 실측만으로 진단한다.
// diagnose()는 경쟁사 도메인을 담지 않으므로 공개 뷰에서도 그대로 노출 가능하다.
function buildDiagnosis(structure, panel) {
  try {
    return diagnose({ scored: structure || {}, panel: panel && !panel.error ? panel : null });
  } catch {
    return null;
  }
}

// 지역별 진단. 구조는 공통이고 실측만 지역마다 다르므로, 같은 구조에 각 지역 패널을 물린다.
export function buildDiagnosisByRegion(structure, panelsByRegion, regions) {
  const out = {};
  for (const r of regions) {
    const p = panelsByRegion?.[r];
    out[r] = p && !p.error ? buildDiagnosis(structure, p) : null;
  }
  return out;
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
export function buildCostNote(nRegions, nEngines, nQueries, repeats = REPEATS) {
  const calls = nRegions * nEngines * nQueries * repeats;
  // 엔진·모델별 단가가 다르고 수시로 바뀌므로 달러 금액을 하드코딩하지 않는다.
  return `${nRegions}지역 × ${nEngines}엔진 × ${nQueries}질의 × ${repeats}회 = ${calls}회 호출`;
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
