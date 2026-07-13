// Lightweight operator session validation used by operator.html on page load.
import { isOperatorRequest } from '../lib/operator-auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  if (!isOperatorRequest(req)) return res.status(401).json({ error: 'invalid-session' });
  res.status(200).json({ ok: true });
}
