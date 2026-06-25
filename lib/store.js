// Minimal store for the cost guard: 24h result cache + daily global call cap.
// In-memory by default (per-serverless-instance — fine for the INTERNAL/low-volume v1).
// Pass a KV impl ({ get, set, incr, expire }) for shared/production state (Upstash/Vercel KV)
// before going PUBLIC — a public self-serve path needs cross-instance counters + per-IP limits.
// `now` is injectable so tests are deterministic.
export function makeStore({ kv = null, now = () => Date.now() } = {}) {
  const mem = new Map();
  return {
    backedByKv: !!kv,

    async cacheGet(key) {
      if (kv) {
        const v = await kv.get('c:' + key);
        return v ? JSON.parse(v) : null;
      }
      const e = mem.get('c:' + key);
      if (!e) return null;
      if (e.exp && e.exp < now()) {
        mem.delete('c:' + key);
        return null;
      }
      return e.val;
    },

    async cacheSet(key, val, ttlMs) {
      if (kv) return kv.set('c:' + key, JSON.stringify(val), Math.ceil(ttlMs / 1000));
      mem.set('c:' + key, { val, exp: now() + ttlMs });
      return undefined;
    },

    // INCR a daily counter (returns the post-increment count). Used for the global daily cap.
    async incrDaily(dayKey) {
      if (kv) {
        const n = await kv.incr('d:' + dayKey);
        if (n === 1 && kv.expire) await kv.expire('d:' + dayKey, 172800); // 48h ttl, first set only
        return n;
      }
      const k = 'd:' + dayKey;
      const n = (mem.get(k) || 0) + 1;
      mem.set(k, n);
      return n;
    },

    // Per-IP daily counter — same interface but keyed by {ipHash}:{dayKey}.
    // Used for per-IP rate limiting on the public path; operators bypass this entirely.
    async incrIpDaily(ipHash, dayKey) {
      if (kv) {
        const k = `ip:${ipHash}:${dayKey}`;
        const n = await kv.incr(k);
        if (n === 1 && kv.expire) await kv.expire(k, 172800);
        return n;
      }
      const k = `ip:${ipHash}:${dayKey}`;
      const n = (mem.get(k) || 0) + 1;
      mem.set(k, n);
      return n;
    },
  };
}
