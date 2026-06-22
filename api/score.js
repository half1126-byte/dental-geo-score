// POST /api/score { url }  → heuristic GEO readiness score (free, no AI keys).
// SSRF-safe (lib/fetcher), deterministic, returns evidence/breakdown for the frontend.
import { auditUrl, FetchBlockedError } from '../lib/audit.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }

  const url = method === 'POST' ? req.body && req.body.url : req.query && req.query.url;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'missing-url', message: 'url 필드가 필요합니다.' });
    return;
  }

  try {
    const result = await auditUrl(url, { timeoutMs: 8000 });
    result.measuredAt = new Date().toISOString();
    res.status(200).json(result);
  } catch (e) {
    if (e instanceof FetchBlockedError) {
      // 422: we reached the gate and refused — not a server error.
      res.status(422).json({
        error: 'fetch-blocked',
        reason: e.reason,
        detail: e.detail || null,
        message: 'URL을 가져올 수 없습니다 (차단·접근 불가·내부주소).',
      });
      return;
    }
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
