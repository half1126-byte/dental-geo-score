import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkNaverLocal, naverApiAvailable } from '../lib/naver.js';

// naverApiAvailable reads process.env — in tests, both vars are absent → false
test('naverApiAvailable: false when env vars missing', () => {
  // Don't set NAVER_CLIENT_ID / NAVER_CLIENT_SECRET in tests
  const orig = { id: process.env.NAVER_CLIENT_ID, sec: process.env.NAVER_CLIENT_SECRET };
  delete process.env.NAVER_CLIENT_ID;
  delete process.env.NAVER_CLIENT_SECRET;
  assert.equal(naverApiAvailable(), false);
  if (orig.id !== undefined) process.env.NAVER_CLIENT_ID = orig.id;
  if (orig.sec !== undefined) process.env.NAVER_CLIENT_SECRET = orig.sec;
});

test('checkNaverLocal: cited=true when clinic domain matches result link', async () => {
  // Stub fetch to return a single Naver local result whose link matches clinic
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        { title: '<b>하루플란트치과</b>', link: 'https://harupl.co.kr', address: '서울 강남구' },
        { title: '강남치과', link: 'https://gangnamprc.co.kr', address: '서울 강남구' },
      ],
    }),
  });
  try {
    const r = await checkNaverLocal({
      clinicDomain: 'harupl.co.kr',
      region: '강남',
      procedure: '임플란트',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });
    assert.equal(r.cited, true);
    assert.equal(r.rank, 1);
    assert.equal(r.query, '강남 임플란트 치과');
    assert.equal(r.engine, 'naver');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('checkNaverLocal: cited=false when clinic domain not in results', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      items: [
        { title: '서초치과', link: 'https://seocho-dental.co.kr', address: '서울 서초구' },
      ],
    }),
  });
  try {
    const r = await checkNaverLocal({
      clinicDomain: 'harupl.co.kr',
      region: '강남',
      procedure: '임플란트',
      clientId: 'test-id',
      clientSecret: 'test-secret',
    });
    assert.equal(r.cited, false);
    assert.equal(r.rank, null);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('checkNaverLocal: throws on non-ok response', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => 'Unauthorized' });
  try {
    await assert.rejects(
      () => checkNaverLocal({ clinicDomain: 'x.co.kr', region: '강남', procedure: '임플란트', clientId: 'bad', clientSecret: 'bad' }),
      /Naver Local API 401/
    );
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('checkNaverLocal: www prefix stripped in domain match', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ items: [{ title: '이도치과', link: 'https://www.ido-dental.co.kr', address: '서울 강남' }] }),
  });
  try {
    const r = await checkNaverLocal({ clinicDomain: 'ido-dental.co.kr', region: '강남', procedure: '', clientId: 'x', clientSecret: 'x' });
    assert.equal(r.cited, true, 'www prefix should be stripped for match');
  } finally {
    globalThis.fetch = origFetch;
  }
});
