import { clearOperatorSessionCookie } from '../lib/operator-auth.js';

export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  clearOperatorSessionCookie(req, res);
  return res.status(200).json({ ok: true });
}
