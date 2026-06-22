// POST /api/lead { email, url } — Phase 1 stub. Captures intent for the real-citation
// email gate. Phase 2 wires per-IP rate-limit (Upstash/KV), the ChatGPT/Perplexity
// citation panel, and Sheets/Notion lead logging.
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method-not-allowed' });
    return;
  }
  const { email, url } = req.body || {};
  const valid = typeof email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!valid) {
    res.status(400).json({ error: 'invalid-email' });
    return;
  }
  // Phase 1: log only. Do NOT call paid AI APIs here yet (cost/abuse gate lands in Phase 2).
  console.log('[lead]', email, typeof url === 'string' ? url.slice(0, 200) : '');
  res.status(200).json({ ok: true });
}
