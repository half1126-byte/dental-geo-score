// GET /api/history?domain=X — operator-only, returns last 30 score + citation records.
// KV (Upstash) must be configured for history to persist across serverless instances.
// Without KV, returns empty arrays (in-memory history doesn't survive cold starts).
import { makeStore } from '../lib/store.js';
import { kv } from '../lib/kv.js';
import { registrableDomain } from '../lib/normalize.js';
import { isOperatorRequest } from '../lib/operator-auth.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

const store = makeStore({ kv });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  if (!isOperatorRequest(req)) {
    res.status(401).json({ error: 'operator-key-required' });
    return;
  }

  const { domain: rawDomain } = req.query || {};
  if (!rawDomain) { res.status(400).json({ error: 'missing-domain' }); return; }

  const domain = registrableDomain('https://' + String(rawDomain).replace(/^https?:\/\//, ''));

  const [scoreHistory, citationHistory] = await Promise.all([
    store.histGet(`s:${domain}`),
    store.histGet(`c:${domain}`),
  ]);

  res.status(200).json({
    domain,
    backedByKv: store.backedByKv,
    scoreHistory,
    citationHistory,
  });
}
