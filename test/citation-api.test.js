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

test('operator key configured + missing/wrong header → 401', async () => {
  clearEnv();
  process.env.OPERATOR_KEY = 'secret';
  const { req, res, out } = mk('POST', { url: 'https://x.co.kr' }, {});
  await handler(req, res);
  assert.equal(out.status, 401);
  assert.equal(out.json.error, 'operator-key-required');
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
