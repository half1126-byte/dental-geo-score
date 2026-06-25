import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore } from '../lib/store.js';

test('in-memory cache get/set honors TTL (injectable clock)', async () => {
  let t = 1000;
  const store = makeStore({ now: () => t });
  await store.cacheSet('k', { a: 1 }, 5000);
  assert.deepEqual(await store.cacheGet('k'), { a: 1 });
  t = 7000; // past ttl
  assert.equal(await store.cacheGet('k'), null);
});

test('in-memory incrDaily increments per day key', async () => {
  const store = makeStore();
  assert.equal(await store.incrDaily('2026-06-23'), 1);
  assert.equal(await store.incrDaily('2026-06-23'), 2);
  assert.equal(await store.incrDaily('2026-06-24'), 1);
});

test('incrIpDaily: independent from incrDaily, isolated per ipHash', async () => {
  const store = makeStore();
  assert.equal(await store.incrIpDaily('abc123', '2026-06-24'), 1);
  assert.equal(await store.incrIpDaily('abc123', '2026-06-24'), 2);
  assert.equal(await store.incrIpDaily('def456', '2026-06-24'), 1, 'different IP hash starts at 1');
  assert.equal(await store.incrIpDaily('abc123', '2026-06-25'), 1, 'new day resets');
  // must not share key space with incrDaily
  assert.equal(await store.incrDaily('2026-06-24'), 1, 'incrDaily unaffected by incrIpDaily');
});

test('histAppend: prepends newest-first, caps at HIST_MAX=30', async () => {
  const store = makeStore();
  for (let i = 1; i <= 32; i++) {
    await store.histAppend('s:example.co.kr', { ts: `2026-06-${String(i).padStart(2,'0')}`, score: i });
  }
  const hist = await store.histGet('s:example.co.kr');
  assert.equal(hist.length, 30, 'capped at 30');
  assert.equal(hist[0].score, 32, 'newest first');
  assert.equal(hist[29].score, 3, 'oldest kept is #3');
});

test('histGet: returns [] when key missing', async () => {
  const store = makeStore();
  assert.deepEqual(await store.histGet('s:nobody.com'), []);
});

test('histAppend KV-backed: persists via JSON serialize/deserialize', async () => {
  const data = new Map();
  const kv = {
    async get(k) { return data.get(k) ?? null; },
    async set(k, v) { data.set(k, v); },
    async incr() { return 1; },
    async expire() {},
  };
  const store = makeStore({ kv });
  await store.histAppend('c:clinic.co.kr', { ts: 'ts1', engines: [{ engine: 'chatgpt', cited: false }] });
  await store.histAppend('c:clinic.co.kr', { ts: 'ts2', engines: [{ engine: 'chatgpt', cited: true }] });
  const hist = await store.histGet('c:clinic.co.kr');
  assert.equal(hist.length, 2);
  assert.equal(hist[0].ts, 'ts2', 'newest first via KV');
  assert.equal(hist[1].ts, 'ts1');
});

test('KV-backed path uses injected kv + sets expire once', async () => {
  const data = new Map();
  let expireCalls = 0;
  const kv = {
    async get(k) { return data.has(k) ? data.get(k) : null; },
    async set(k, v) { data.set(k, v); },
    async incr(k) { const n = (data.get(k) || 0) + 1; data.set(k, n); return n; },
    async expire() { expireCalls++; },
  };
  const store = makeStore({ kv });
  assert.equal(store.backedByKv, true);
  await store.cacheSet('x', { y: 2 }, 86400000);
  assert.deepEqual(await store.cacheGet('x'), { y: 2 });
  assert.equal(await store.incrDaily('d1'), 1); // first → expire set
  assert.equal(await store.incrDaily('d1'), 2); // second → no new expire
  assert.equal(expireCalls, 1);
});
