import { test } from 'node:test';
import assert from 'node:assert/strict';

// Helper: lightweight req/res mocks
function mockReq(body = {}, headers = {}) {
  return { method: 'POST', body, headers };
}
function mockRes() {
  const res = {
    _status: 200, _body: null, _headers: {},
    status(s) { this._status = s; return this; },
    json(b)   { this._body = b;  return this; },
    setHeader(k, v) { this._headers[k] = v; },
  };
  return res;
}

let handler;
test('lead: import handler', async () => {
  const mod = await import('../api/lead.js');
  handler = mod.default;
  assert.equal(typeof handler, 'function');
});

test('lead: 405 for GET', async () => {
  const req = { method: 'GET', body: {}, headers: {} };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 405);
  assert.equal(res._body?.error, 'method-not-allowed');
});

test('lead: 401 when OPERATOR_KEY set and header wrong', async () => {
  const origKey = process.env.OPERATOR_KEY;
  process.env.OPERATOR_KEY = 'correct-key';
  const req = mockReq(
    { clinicName: '이도치과', contactName: '홍길동', phone: '010-1234-5678', selectedProducts: ['geo-diagnosis'] },
    { 'x-operator-key': 'wrong-key' }
  );
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 401);
  assert.equal(res._body?.error, 'operator-key-required');
  if (origKey !== undefined) process.env.OPERATOR_KEY = origKey;
  else delete process.env.OPERATOR_KEY;
});

test('lead: 400 when clinicName missing', async () => {
  const origKey = process.env.OPERATOR_KEY;
  delete process.env.OPERATOR_KEY;
  const req = mockReq({ contactName: '홍길동', phone: '010-1234-5678', selectedProducts: ['geo-diagnosis'] });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body?.error, 'missing-clinicName');
  if (origKey !== undefined) process.env.OPERATOR_KEY = origKey;
});

test('lead: 400 when selectedProducts empty array', async () => {
  const origKey = process.env.OPERATOR_KEY;
  delete process.env.OPERATOR_KEY;
  const req = mockReq({ clinicName: '이도치과', contactName: '홍길동', phone: '010-1234-5678', selectedProducts: [] });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body?.error, 'missing-selectedProducts');
  if (origKey !== undefined) process.env.OPERATOR_KEY = origKey;
});

test('lead: 400 when phone missing', async () => {
  const origKey = process.env.OPERATOR_KEY;
  delete process.env.OPERATOR_KEY;
  const req = mockReq({ clinicName: '이도치과', contactName: '홍길동', selectedProducts: ['geo-diagnosis'] });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res._status, 400);
  assert.equal(res._body?.error, 'missing-phone');
  if (origKey !== undefined) process.env.OPERATOR_KEY = origKey;
});

test('lead: 200 ok with notionSkipped when NOTION env absent', async () => {
  const saved = {
    OPERATOR_KEY: process.env.OPERATOR_KEY,
    NOTION_TOKEN: process.env.NOTION_TOKEN,
    NOTION_LEADS_DB_ID: process.env.NOTION_LEADS_DB_ID,
  };
  delete process.env.OPERATOR_KEY;
  delete process.env.NOTION_TOKEN;
  delete process.env.NOTION_LEADS_DB_ID;

  const req = mockReq({
    domain: 'bestplantdental.com',
    clinicName: '베스트플란트치과',
    contactName: '김원장',
    phone: '055-000-0000',
    selectedProducts: ['blog-posting', 'media-feature'],
    geoScore: 89,
    aiCited: false,
  });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body?.ok, true);
  assert.equal(res._body?.notionSkipped, true);
  assert.match(res._body?.leadId, /^lead:/);

  // restore
  if (saved.OPERATOR_KEY !== undefined) process.env.OPERATOR_KEY = saved.OPERATOR_KEY;
  if (saved.NOTION_TOKEN !== undefined) process.env.NOTION_TOKEN = saved.NOTION_TOKEN;
  if (saved.NOTION_LEADS_DB_ID !== undefined) process.env.NOTION_LEADS_DB_ID = saved.NOTION_LEADS_DB_ID;
});
