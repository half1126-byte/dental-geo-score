// Lightweight operator key validation — used by operator.html on key save and page load.
// Returns 200 {ok:true} for valid key, 401 for invalid, 200 {ok:true,note:'no-key-configured'} if OPERATOR_KEY not set.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  if (!operatorKeySet) return res.status(200).json({ ok: true, note: 'no-key-configured' });
  const isOperator = req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (!isOperator) return res.status(401).json({ error: 'invalid-key' });
  res.status(200).json({ ok: true });
}
