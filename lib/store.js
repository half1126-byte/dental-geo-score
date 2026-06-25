// Minimal store: 24h result cache + daily global call cap + 90-day measurement history.
// In-memory by default (per-serverless-instance).
// Pass { kv } (lib/kv.js → Upstash) for shared/persistent state across serverless instances.
// `now` is injectable so tests are deterministic.

const HIST_TTL_S = 7_776_000; // 90 days in seconds
const HIST_MAX   = 30;         // keep last 30 entries per domain

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

    // ── Measurement history ─────────────────────────────────────────
    // histKey convention: 's:{domain}' for scores, 'c:{domain}' for citations.
    // Entries are prepended (newest-first), capped at HIST_MAX, TTL = 90 days.

    async histGet(histKey) {
      const k = 'h:' + histKey;
      if (kv) {
        const v = await kv.get(k);
        return v ? JSON.parse(v) : [];
      }
      return mem.get(k) || [];
    },

    async histAppend(histKey, record) {
      const k = 'h:' + histKey;
      if (kv) {
        const v = await kv.get(k);
        const arr = v ? JSON.parse(v) : [];
        arr.unshift(record);
        if (arr.length > HIST_MAX) arr.length = HIST_MAX;
        await kv.set(k, JSON.stringify(arr), HIST_TTL_S);
        return;
      }
      const arr = mem.get(k) || [];
      arr.unshift(record);
      if (arr.length > HIST_MAX) arr.length = HIST_MAX;
      mem.set(k, arr);
    },
  };
}
