// POST /api/unlock { password } — "고급 분석" door for the PUBLIC page.
// The password is validated SERVER-SIDE against ADVANCED_GATE_PASSWORD (env). Only on success do we
// hand back the operator key (OPERATOR_KEY env). This keeps BOTH secrets out of the public client JS:
// a competitor reading index.html / app.js sees only a fetch to /api/unlock, no passwords.
export const config = { runtime: 'nodejs' };

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  const gate = process.env.ADVANCED_GATE_PASSWORD;
  const opKey = process.env.OPERATOR_KEY;
  // Fail closed: if the gate isn't configured, never grant access.
  if (!gate || !opKey) { res.status(503).json({ error: 'not-configured' }); return; }

  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length === 0 || password !== gate) {
    res.status(401).json({ error: 'invalid' });
    return;
  }

  // Correct gate password → release the operator key (only reaches the client after passing the gate).
  res.status(200).json({ ok: true, key: opKey });
}
