// POST /api/unlock { password } — operator login.
// The password is validated server-side and exchanged for a short-lived HttpOnly cookie.
// Neither the password nor OPERATOR_KEY is ever returned to browser JavaScript.
import {
  createOperatorSession,
  setOperatorSessionCookie,
  verifyOperatorPassword,
} from '../lib/operator-auth.js';
import { createHash } from 'node:crypto';
import { kv } from '../lib/kv.js';

export const config = { runtime: 'nodejs' };

const LOGIN_WINDOW_S = 15 * 60;
const loginAttempts = new Map();

async function loginRateAllowed(req) {
  const limit = Math.max(1, parseInt(process.env.LOGIN_ATTEMPT_LIMIT || '8', 10) || 8);
  const rawIp = String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')
    .split(',')[0].trim();
  const ipHash = createHash('sha256').update(rawIp).digest('hex').slice(0, 16);
  const windowKey = Math.floor(Date.now() / (LOGIN_WINDOW_S * 1000));
  const key = `login:${ipHash}:${windowKey}`;
  if (kv) {
    try {
      const count = await kv.incr(key);
      if (count === 1) await kv.expire(key, LOGIN_WINDOW_S * 2);
      return count <= limit;
    } catch { /* fall through to the per-instance guard */ }
  }
  const count = (loginAttempts.get(key) || 0) + 1;
  loginAttempts.set(key, count);
  if (loginAttempts.size > 500) {
    for (const oldKey of loginAttempts.keys()) {
      if (!oldKey.endsWith(`:${windowKey}`)) loginAttempts.delete(oldKey);
    }
  }
  return count <= limit;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  if (!(await loginRateAllowed(req))) {
    res.setHeader('Retry-After', String(LOGIN_WINDOW_S));
    res.status(429).json({ error: 'rate-limited' });
    return;
  }

  // Fail closed: both password verification and session signing must be configured.
  if (!process.env.ADVANCED_GATE_PASSWORD || !process.env.OPERATOR_KEY) {
    res.status(503).json({ error: 'not-configured' });
    return;
  }

  const { password } = req.body || {};
  if (!verifyOperatorPassword(password)) {
    res.status(401).json({ error: 'invalid' });
    return;
  }

  const session = createOperatorSession();
  if (!session) { res.status(503).json({ error: 'not-configured' }); return; }
  setOperatorSessionCookie(req, res, session);
  res.status(200).json({ ok: true, expiresAt: new Date(session.expiresAt).toISOString() });
}
