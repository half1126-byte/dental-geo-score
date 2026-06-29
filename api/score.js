// POST /api/score { url }  → heuristic GEO readiness score (free, no AI keys).
// SSRF-safe (lib/fetcher), deterministic, returns evidence/breakdown for the frontend.
import { auditUrl, FetchBlockedError } from '../lib/audit.js';
import { makeStore } from '../lib/store.js';
import { kv } from '../lib/kv.js';
import { registrableDomain, isKnownPlatformDomain } from '../lib/normalize.js';

export const config = { runtime: 'nodejs', maxDuration: 20 };

const store = makeStore({ kv });

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
  if (isKnownPlatformDomain(url)) {
    res.status(400).json({ error: 'platform-url', message: '네이버 플레이스·블로그·SNS URL은 분석할 수 없습니다. 병원 자체 홈페이지 URL을 입력해 주세요.' });
    return;
  }

  try {
    const result = await auditUrl(url, { timeoutMs: 8000 });
    result.measuredAt = new Date().toISOString();

    // Persist score history (non-blocking)
    const domain = registrableDomain(url);
    store.histAppend(`s:${domain}`, {
      ts:    result.measuredAt,
      score: result.score,
      band:  result.band,
    }).catch(() => {});

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
