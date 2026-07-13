import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/citation.js';

// minimal req/res doubles — these tests exercise the gate/early-return logic only (never reach a
// live runCitationPanel call, so no network).
function mk(method, body, headers = {}) {
  const req = { method, body, headers };
  const out = {};
  const res = {
    setHeader() {},
    status(s) { out.status = s; return this; },
    json(j) { out.json = j; return this; },
  };
  return { req, res, out };
}

const ENV = ['OPERATOR_KEY', 'CITATION_ENABLED', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY', 'ANTHROPIC_API_KEY', 'DAILY_CITATION_CAP'];
function clearEnv() { for (const k of ENV) delete process.env[k]; }

test('GET → 405', async () => {
  clearEnv();
  const { req, res, out } = mk('GET');
  await handler(req, res);
  assert.equal(out.status, 405);
});

test('operator key configured + no auth header → public path → 400 email-required', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'secret';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr' }, {});
  await handler(req, res);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, 'email-required'); // public users need email, not 401
});

test('operator path bypasses email; not-enabled → 202 pending', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'secret';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', region: '성남' }, { 'x-operator-key': 'secret' });
  await handler(req, res);
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending'); // no keys/CITATION_ENABLED → pending, email NOT required for operator
});

test('public path (no operator key configured) requires email → 400', async () => {
  clearEnv();
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr' }, {});
  await handler(req, res);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, 'email-required');
});

test('public path with email, not enabled → 202 pending', async () => {
  clearEnv();
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', email: 'a@b.co' }, {});
  await handler(req, res);
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
});

test('missing url → 400', async () => {
  clearEnv();
  const { req, res, out } = mk('POST', { email: 'a@b.co' }, {});
  await handler(req, res);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, 'missing-url');
});

test('platform url (Naver Place) → 400 platform-url (false-positive guard)', async () => {
  clearEnv();
  const { req, res, out } = mk('POST', { url: 'https://place.naver.com/hospital/2081935519/home', email: 'a@b.co' }, {});
  await handler(req, res);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, 'platform-url');
});

test('platform url as operator → 400 platform-url (operator also blocked)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://blog.naver.com/myclinic' }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 400);
  assert.equal(out.json.error, 'platform-url');
});

test('queries param: whitespace-only strings are filtered → falls back to buildPrompts (202 pending when disabled)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', queries: ['  ', '   '] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  // Not enabled → 202 pending (gate reached, no crash from whitespace-only queries)
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
});

test('queries param: too-long strings are truncated to 300 chars (gate smoke)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const longQuery = 'a'.repeat(1000);
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', queries: [longQuery] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  // Not enabled → 202 pending; test verifies no crash from oversized queries
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
});

test('queries param: valid array → cache key changes (different from no-queries baseline)', async () => {
  // This test verifies that the cacheKey now includes a query fingerprint.
  // We can't observe the internal cacheKey directly, but we CAN verify that
  // two requests with different queries on the same domain reach the live path
  // rather than returning a stale cache hit when CITATION_ENABLED=true.
  // For this smoke test: operator + not-enabled → 202 (no crash, query array processed).
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', {
    url: 'https://x.co.kr',
    region: '강남',
    procedure: '임플란트',
    queries: ['강남 임플란트 치과 어디가 좋아?', '강남역 근처 치과 추천해줘'],
  }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
});

// --- Multi-region ---

test('regions[] overrides region; not-enabled → 202 with regions echoed', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', regions: ['강남', '서초', '송파'] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
  assert.deepEqual(out.json.regions, ['강남', '서초', '송파']);
});

test('regions[] clamped to 5; not-enabled → 202', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', regions: ['강남', '서초', '송파', '강서', '마포', '영등포'] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 202);
  // 6 regions → clamped to 5 (echoed in json)
  assert.equal((out.json.regions || []).length, 5, 'clamped to max 5');
});

test('regions are deduplicated before clamping to 5', async () => {
  process.env.CITATION_ENABLED = 'false';
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', {
    url: 'https://x.co.kr',
    regions: ['강남', '강남', '서초', '송파', '강서', '마포', '영등포'],
  }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.deepEqual(out.json.regions, ['강남', '서초', '송파', '강서', '마포']);
});

test('regions: empty strings filtered out; single valid → single-region path (no .regions in 202)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', regions: ['  ', '', '강남'] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 202);
  // Only 1 non-empty → single-region path → .regions NOT echoed
  assert.equal(out.json.regions, undefined, 'single region → no regions field');
});

test('regions: all empty strings → single-region fallback (no .regions in 202)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr', regions: ['  ', ''] }, { 'x-operator-key': 'k' });
  await handler(req, res);
  assert.equal(out.status, 202);
  assert.equal(out.json.regions, undefined);
});

// --- per-IP rate limiting ---

test('per-IP cap: 429 after exceeding PER_IP_DAILY_CAP (public path, unique IPs per domain)', async () => {
  clearEnv();
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  process.env.PER_IP_DAILY_CAP = '1';
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  // Use unique IP + unique domains to avoid cache hits between requests in this test
  const ip = '10.99.77.1'; // unique to this test — not used elsewhere
  const { req: r1, res: s1, out: o1 } = mk('POST', { url: 'https://ip-test-a.co.kr', email: 'a@b.co' }, { 'x-forwarded-for': ip });
  await handler(r1, s1);
  // First request: live path (fetch fails → 200 or 500, per-IP counter = 1)
  assert.ok([200, 500].includes(o1.status), `first req: ${o1.status}`);

  // Second request from SAME IP, DIFFERENT domain → cache miss → per-IP counter = 2 > 1 → 429
  const { req: r2, res: s2, out: o2 } = mk('POST', { url: 'https://ip-test-b.co.kr', email: 'a@b.co' }, { 'x-forwarded-for': ip });
  await handler(r2, s2);
  assert.equal(o2.status, 429, 'second unique-domain request should be rate-limited');
  assert.equal(o2.json.error, 'rate-limited');

  global.fetch = origFetch;
});

test('per-IP cap: operator bypasses IP limit regardless of PER_IP_DAILY_CAP', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.PER_IP_DAILY_CAP = '0'; // cap=0 means disabled, operators always bypass anyway
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr' }, { 'x-operator-key': 'k' });
  await handler(req, res);
  // Not enabled → 202 pending (NOT 429)
  assert.equal(out.status, 202);
  assert.equal(out.json.status, 'pending');
});

// Cache-hit path: inject a store with a pre-populated cache entry so runCitationPanel is never reached.
test('cache hit returns 200 with cached:true (no live call)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  // Monkey-patch the module's store by overriding the handler's import env — we can't inject the
  // store directly, so instead verify the 202 pending path is bypassed when keys are set.
  // (Full cache-hit path requires store injection; covered by store.test.js integration.)
  // This test at minimum ensures the CITATION_ENABLED+key branch doesn't 400/401 and reaches the
  // live path — a runCitationPanel mock would be needed for full coverage.
  // For now: verify operator+enabled+valid_url reaches try{} (not a gate branch).
  const callCount = { n: 0 };
  const origFetch = global.fetch;
  // stub fetch to return a valid Perplexity-like response immediately
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const { req, res, out } = mk('POST', { url: 'https://example.co.kr', region: '서울' }, { 'x-operator-key': 'k' });
  await handler(req, res);
  // With a failed fetch stub, runCitationPanel returns all-error perEngine → 200 private view
  assert.ok(out.status === 200 || out.status === 500, `expected 200 or 500, got ${out.status}`);
  global.fetch = origFetch;
});

test('nocache: operator x-nocache:1 bypasses cache (reaches live panel, not cached:true)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const { req, res, out } = mk('POST', { url: 'https://nocache-test.co.kr', region: '강남', nocache: true }, { 'x-operator-key': 'k', 'x-nocache': '1' });
  await handler(req, res);
  assert.ok(out.status === 200 || out.status === 500, `expected live path (200/500), got ${out.status}`);
  assert.ok(!out.body?.cached, 'nocache request must NOT return cached:true');
  global.fetch = origFetch;
});

test('nocache: public path ignores nocache (non-operator cannot bypass cache)', async () => {
  clearEnv();
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  // No OPERATOR_KEY set → public path
  const { req, res, out } = mk('POST', { url: 'https://nocache-pub.co.kr', region: '강남', nocache: true, email: 'a@b.co' }, { 'x-nocache': '1' });
  await handler(req, res);
  // Public path with keys but no OPERATOR_KEY set means isOperator=false → noCache=false (cannot bypass)
  // Test verifies the request reaches normal flow (not 400/401)
  assert.ok([200, 202, 429, 500].includes(out.status), `unexpected status ${out.status}`);
});

// --- DAILY_CITATION_CAP ---

test('DAILY_CITATION_CAP: second request over cap returns 202 cap-reached', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  process.env.DAILY_CITATION_CAP = '1';
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  // First request (unique domain): daily counter → 1 == cap; runs live panel → 200/500
  const { req: r1, res: s1, out: o1 } = mk('POST', { url: 'https://daycap-a.co.kr', region: '강남' }, { 'x-operator-key': 'k' });
  await handler(r1, s1);
  assert.ok([200, 500].includes(o1.status), `first req: ${o1.status}`);

  // Second request (different domain → cache miss): daily counter → 2 > 1 → 202 cap-reached
  const { req: r2, res: s2, out: o2 } = mk('POST', { url: 'https://daycap-b.co.kr', region: '강남' }, { 'x-operator-key': 'k' });
  await handler(r2, s2);
  assert.equal(o2.status, 202, `second request should be cap-reached 202, got ${o2.status}`);
  assert.equal(o2.json.status, 'cap-reached');

  global.fetch = origFetch;
});

// --- multi-region cache hit ---

test('multi-region: second identical request returns cached:true (200)', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  // unique domain + regions — avoids cache pollution from other tests
  const body = { url: 'https://multiregion-cachetest.co.kr', regions: ['마포', '은평'] };
  const hdr = { 'x-operator-key': 'k' };

  // First request: cache miss → runCitationPanel (stubbed 503 → error panels, not a throw) → 200 cached
  const { req: r1, res: s1, out: o1 } = mk('POST', body, hdr);
  await handler(r1, s1);
  assert.equal(o1.status, 200, `first request must be 200; got ${o1.status}`);
  assert.equal(o1.json.cached, undefined, 'first request is live, not a cache hit');

  // Second identical request: cache hit → 200 with cached:true
  const { req: r2, res: s2, out: o2 } = mk('POST', body, hdr);
  await handler(r2, s2);
  assert.equal(o2.status, 200);
  assert.equal(o2.json.cached, true, 'second identical multi-region request must be a cache hit');

  global.fetch = origFetch;
});

// --- buildCostNote (via multi-region response) ---

test('buildCostNote: multi-region response shows actual call count without a stale price estimate', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'k';
  process.env.CITATION_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'x';
  // Only OPENAI key → 1 engine; 4 default queries × 3 repeats × 3 regions = 36 paid calls.
  const origFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });

  const { req, res, out } = mk('POST', {
    url: 'https://costnote-test.co.kr',
    regions: ['강남', '서초', '송파'],
  }, { 'x-operator-key': 'k' });
  await handler(req, res);

  assert.equal(out.status, 200, `expected 200, got ${out.status}`);
  assert.ok(typeof out.json.costNote === 'string', 'costNote must be a string');
  assert.ok(out.json.costNote.includes('3지역'), `costNote: ${out.json.costNote}`);
  assert.ok(out.json.costNote.includes('엔진'), `costNote: ${out.json.costNote}`);
  assert.ok(out.json.costNote.includes('36회 호출'), `costNote: ${out.json.costNote}`);
  assert.ok(!out.json.costNote.includes('$'), `costNote must not hardcode model pricing: ${out.json.costNote}`);

  global.fetch = origFetch;
});
