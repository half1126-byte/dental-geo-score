// POST /api/citation { url, region?, procedure?, email? } — real-citation panel.
//
// v1 = INTERNAL OPERATOR TOOL. Gate = `x-operator-key` header (== OPERATOR_KEY env). The operator
// path returns the FULL private report (named competitors + evidence) via toPrivateReport — that's a
// private 1:1 sales deliverable, not a public ad. The public (non-operator) path requires an email and
// only ever returns the redacted toPublicView (no competitor identities — 의료광고법).
//
// SAFETY: live engine calls run ONLY if CITATION_ENABLED=true AND ≥1 engine key is set. Cost guard =
// 24h cache (domain|region|procedure) + DAILY_CITATION_CAP global counter (lib/store). The in-memory
// store is fine for internal/low volume; back it with KV + per-IP limits BEFORE any public path.
import { runCitationPanel } from '../lib/citation.js';
import { AUTO_ENGINES } from '../lib/engines.js';
import { registrableDomain } from '../lib/normalize.js';
import { toPublicView, toPrivateReport } from '../lib/redact.js';
import { makeStore } from '../lib/store.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const ENV_KEYS = { chatgpt: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY' };
const DAY = 86_400_000;
const store = makeStore(); // in-memory v1; pass { kv } (Upstash) before going public

const maskEmail = (e) => String(e || '').replace(/^(.).*(@.*)$/, '$1***$2');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  const { url, email, region, procedure } = req.body || {};

  // --- operator gate (internal tool) ---
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  const isOperator = operatorKeySet && req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (operatorKeySet && !isOperator) {
    // an operator key is configured → this endpoint is internal-only; reject non-operators early.
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
  const view = (data) => (isOperator ? toPrivateReport(data) : toPublicView(data));
  console.log('[citation]', isOperator ? 'operator' : maskEmail(email), domain, region || '', procedure || '');

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
      message: isOperator ? '측정 비활성(키/CITATION_ENABLED 필요).' : '신청되었습니다. 실측 결과를 이메일로 보내드리겠습니다.',
    });
    return;
  }

  try {
    // 24h cache first — a cache hit does NOT consume the daily cap.
    const cacheKey = `${domain}|${(region || '').trim().toLowerCase()}|${(procedure || '').trim().toLowerCase()}`;
    const cached = await store.cacheGet(cacheKey);
    if (cached) {
      res.status(200).json({ ...view(cached), cached: true });
      return;
    }

    // daily global cap — counts only real live measurements (cost guard)
    const cap = parseInt(process.env.DAILY_CITATION_CAP || '0', 10);
    if (cap > 0) {
      const dayKey = new Date().toISOString().slice(0, 10);
      const n = await store.incrDaily(dayKey);
      if (n > cap) {
        res.status(202).json({ status: 'cap-reached', domain, message: '오늘 실측 한도 소진 — 내일 다시 또는 상담.' });
        return;
      }
    }

    const result = await runCitationPanel({
      clinicDomain: domain,
      region: region || '',
      procedure: procedure || '',
      keys,
      loc: { city: region || '' },
      repeats: 1,
    });
    await store.cacheSet(cacheKey, result, DAY); // full panel cached server-side; view() redacts per audience
    res.status(200).json(view(result));
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
