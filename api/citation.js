// POST /api/citation { url, email, region?, procedure? } — real-citation panel (Phase 2).
// SAFETY (autoplan critical): the cost-bomb gate is ON by default. Live engine calls run ONLY if
// CITATION_ENABLED=true AND at least one engine key is set. Otherwise = email lead-capture (no API
// calls, no cost). Email is REQUIRED (lead gate). Before enabling in production, back the rate-limit
// with Upstash/KV — the in-memory cache below is per-serverless-instance and is best-effort only.
import { runCitationPanel } from '../lib/citation.js';
import { AUTO_ENGINES } from '../lib/engines.js';
import { registrableDomain } from '../lib/normalize.js';

export const config = { runtime: 'nodejs', maxDuration: 120 };

const ENV_KEYS = { chatgpt: 'OPENAI_API_KEY', perplexity: 'PERPLEXITY_API_KEY', claude: 'ANTHROPIC_API_KEY' };
const cache = new Map(); // best-effort per-instance; replace with Upstash KV before going live.
const DAY = 86_400_000;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  const { url, email, region, procedure } = req.body || {};
  if (!email || typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    res.status(400).json({ error: 'email-required', message: '실측 결과를 받을 이메일이 필요합니다.' });
    return;
  }
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'missing-url' });
    return;
  }
  const domain = registrableDomain(url);
  console.log('[citation-lead]', email, domain, region || '', procedure || '');

  // which engines have keys configured?
  const keys = {};
  for (const e of AUTO_ENGINES) {
    const k = process.env[ENV_KEYS[e]];
    if (k) keys[e] = k;
  }
  const enabled = process.env.CITATION_ENABLED === 'true' && Object.keys(keys).length > 0;

  if (!enabled) {
    // Lead captured; live measurement not switched on yet (no keys / not enabled).
    res.status(202).json({
      status: 'pending',
      domain,
      message: '신청되었습니다. 실측 인용 측정 결과를 이메일로 보내드리겠습니다.',
    });
    return;
  }

  // cost guard: 24h cache by registrable domain (in-memory best-effort)
  const cached = cache.get(domain);
  if (cached && Date.now() - cached.t < DAY) {
    res.status(200).json({ ...cached.data, cached: true });
    return;
  }
  try {
    const result = await runCitationPanel({
      clinicDomain: domain,
      region: region || '',
      procedure: procedure || '',
      keys,
      loc: { city: region || '' },
      repeats: 1,
    });
    cache.set(domain, { t: Date.now(), data: result });
    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
