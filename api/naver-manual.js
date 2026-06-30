// PUT /api/naver-manual — store Smart Place private monthly stats (operator-only)
// GET /api/naver-manual?domain=...&months=6 — read last N months
//
// Key schema in KV: nm:{registrableDomain}:{YYYY-MM}
// TTL: 2 years (monthly reference records)

import { kv } from '../lib/kv.js';
import { registrableDomain } from '../lib/normalize.js';

export const config = { runtime: 'nodejs', maxDuration: 10 };

const TTL_S = 63_072_000; // 2 years

// ── Pure helpers (exported for tests) ────────────────────────────────────────

export function prevMonths(n, now = new Date()) {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
}

const ALLOWED_FIELDS = ['naturalVisitRate', 'callClicks', 'directionClicks', 'reservations', 'saves'];

export function sanitize(raw) {
  const out = {};
  for (const f of ALLOWED_FIELDS) {
    if (raw[f] === undefined || raw[f] === null || raw[f] === '') continue;
    const n = Number(raw[f]);
    if (Number.isFinite(n) && n >= 0 && n <= 1_000_000) out[f] = n;
  }
  return out;
}

// ── Handler ───────────────────────────────────────────────────────────────────

function gate(req, res) {
  const k = req.headers['x-operator-key'] || '';
  if (!k || k !== process.env.OPERATOR_KEY) {
    res.status(401).json({ error: 'unauthorized' });
    return false;
  }
  return true;
}

function parseDomain(raw) {
  return registrableDomain(raw.includes('://') ? raw : 'https://' + raw);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!gate(req, res)) return;

  // ── PUT: upsert one month ─────────────────────────────────────────────────
  if (req.method === 'PUT') {
    const { domain: rawDomain, period, data } = req.body || {};
    if (!rawDomain || !period || !data) {
      return res.status(400).json({ error: 'bad_request', message: 'domain, period, data required' });
    }
    if (!/^\d{4}-\d{2}$/.test(period)) {
      return res.status(400).json({ error: 'bad_request', message: 'period must be YYYY-MM' });
    }
    const domain = parseDomain(rawDomain);
    if (!domain) return res.status(400).json({ error: 'bad_request', message: 'invalid domain' });

    const record = { ...sanitize(data), savedAt: new Date().toISOString() };
    if (kv) await kv.set(`nm:${domain}:${period}`, JSON.stringify(record), TTL_S);

    return res.status(200).json({ ok: true, domain, period, savedAt: record.savedAt });
  }

  // ── GET: read last N months ───────────────────────────────────────────────
  if (req.method === 'GET') {
    const rawDomain = (req.query && req.query.domain) || '';
    if (!rawDomain) return res.status(400).json({ error: 'bad_request', message: 'domain required' });

    const domain = parseDomain(rawDomain);
    if (!domain) return res.status(400).json({ error: 'bad_request', message: 'invalid domain' });

    const months = Math.min(Math.max(Number(req.query.months) || 6, 1), 12);
    const periods = prevMonths(months);

    let records = [];
    if (kv) {
      const vals = await Promise.all(periods.map((p) => kv.get(`nm:${domain}:${p}`)));
      records = periods
        .map((p, i) => (vals[i] ? { period: p, ...JSON.parse(vals[i]) } : null))
        .filter(Boolean);
    }
    return res.status(200).json({ domain, records, months });
  }

  return res.status(405).json({ error: 'method_not_allowed' });
}
