import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import unlock from '../api/unlock.js';
import authCheck from '../api/auth-check.js';
import logout from '../api/logout.js';
import {
  OPERATOR_COOKIE,
  createOperatorSession,
  isOperatorRequest,
  verifyOperatorPassword,
  verifyOperatorSession,
} from '../lib/operator-auth.js';

const saved = {
  OPERATOR_KEY: process.env.OPERATOR_KEY,
  OPERATOR_SESSION_SECRET: process.env.OPERATOR_SESSION_SECRET,
  ADVANCED_GATE_PASSWORD: process.env.ADVANCED_GATE_PASSWORD,
};

before(() => {
  process.env.OPERATOR_KEY = 'server-only-operator-key';
  process.env.OPERATOR_SESSION_SECRET = 'dedicated-session-secret';
  process.env.ADVANCED_GATE_PASSWORD = 'correct horse battery staple';
});

after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('password comparison and signed session reject wrong, expired, and tampered values', () => {
  assert.equal(verifyOperatorPassword('correct horse battery staple'), true);
  assert.equal(verifyOperatorPassword('wrong'), false);
  const session = createOperatorSession({ now: 1_000, ttlMs: 60_000 });
  assert.equal(verifyOperatorSession(session.token, { now: 20_000 }), true);
  assert.equal(verifyOperatorSession(session.token, { now: 61_001 }), false);
  assert.equal(verifyOperatorSession(session.token + 'x', { now: 20_000 }), false);
});

test('operator request accepts HttpOnly session cookie without exposing a browser key', () => {
  const session = createOperatorSession();
  const req = { headers: { cookie: `${OPERATOR_COOKIE}=${encodeURIComponent(session.token)}` } };
  assert.equal(isOperatorRequest(req), true);
  assert.equal(isOperatorRequest({ headers: {} }), false);
});

test('unlock sets HttpOnly cookie and never returns OPERATOR_KEY', async () => {
  const req = {
    method: 'POST',
    body: { password: 'correct horse battery staple' },
    headers: { 'x-forwarded-proto': 'https' },
  };
  const res = mockRes();
  await unlock(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal('key' in res.body, false);
  assert.match(res.headers['Set-Cookie'], /HttpOnly/);
  assert.match(res.headers['Set-Cookie'], /SameSite=Strict/);
  assert.match(res.headers['Set-Cookie'], /Secure/);
});

test('auth-check accepts the issued cookie and logout expires it', () => {
  const session = createOperatorSession();
  const cookie = `${OPERATOR_COOKIE}=${encodeURIComponent(session.token)}`;
  const authRes = mockRes();
  authCheck({ method: 'POST', headers: { cookie } }, authRes);
  assert.equal(authRes.statusCode, 200);

  const logoutRes = mockRes();
  logout({ method: 'POST', headers: {} }, logoutRes);
  assert.equal(logoutRes.statusCode, 200);
  assert.match(logoutRes.headers['Set-Cookie'], /Max-Age=0/);
});

test('unlock rate-limits repeated attempts per IP', async () => {
  const previous = process.env.LOGIN_ATTEMPT_LIMIT;
  process.env.LOGIN_ATTEMPT_LIMIT = '2';
  const req = {
    method: 'POST',
    body: { password: 'wrong' },
    headers: { 'x-forwarded-for': '203.0.113.77' },
  };
  const first = mockRes();
  const second = mockRes();
  const third = mockRes();
  await unlock(req, first);
  await unlock(req, second);
  await unlock(req, third);
  assert.equal(first.statusCode, 401);
  assert.equal(second.statusCode, 401);
  assert.equal(third.statusCode, 429);
  assert.equal(third.headers['Retry-After'], '900');
  if (previous === undefined) delete process.env.LOGIN_ATTEMPT_LIMIT;
  else process.env.LOGIN_ATTEMPT_LIMIT = previous;
});
