// Upstash Redis REST adapter — no npm deps, native fetch (Node 20+).
// Set KV_REST_API_URL + KV_REST_API_TOKEN in Vercel env to enable.
// When either var is missing, makeKv() returns null → store falls back to in-memory.
function makeKv() {
  const base  = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!base || !token) return null;

  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  async function cmd(...args) {
    const r = await fetch(`${base}/pipeline`, {
      method: 'POST',
      headers,
      body: JSON.stringify([args]),
    });
    if (!r.ok) throw new Error(`KV ${r.status}: ${await r.text().catch(() => '')}`);
    const [{ result }] = await r.json();
    return result ?? null;
  }

  return {
    get:    (k)        => cmd('GET', k),
    set:    (k, v, s)  => s ? cmd('SET', k, v, 'EX', s) : cmd('SET', k, v),
    incr:   (k)        => cmd('INCR', k),
    expire: (k, s)     => cmd('EXPIRE', k, s),
  };
}

export const kv = makeKv();
