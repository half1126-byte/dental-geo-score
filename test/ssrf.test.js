import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeFetch, validateUrl, FetchBlockedError } from '../lib/fetcher.js';

// All of these must fail BEFORE any network connection (scheme/port checks are synchronous;
// literal-IP checks happen at DNS-resolve time which returns the literal locally).

test('rejects non-http(s) schemes', async () => {
  for (const u of ['file:///etc/passwd', 'gopher://x/', 'dict://x/', 'data:text/html,hi', 'ftp://x/']) {
    await assert.rejects(() => safeFetch(u), FetchBlockedError, u);
  }
});

test('rejects disallowed ports', async () => {
  for (const u of ['http://example.com:22/', 'http://example.com:6379/', 'http://example.com:3306/']) {
    await assert.rejects(() => safeFetch(u), /bad-port/, u);
  }
});

test('rejects literal metadata / private / loopback IPs pre-connect', async () => {
  for (const u of [
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1/',
    'http://10.0.0.1/',
    'http://192.168.0.1/',
    'http://[::1]/',
    'http://[fd00::1]/',
  ]) {
    await assert.rejects(() => safeFetch(u), FetchBlockedError, u);
  }
});

test('rejects embedded userinfo (credential leak / parser confusion)', async () => {
  await assert.rejects(() => safeFetch('http://user:pass@example.com/'), /userinfo/);
});

test('validateUrl re-validates redirect targets', () => {
  assert.throws(() => validateUrl('file:///x', 'http://a.com/'), FetchBlockedError);
  assert.throws(() => validateUrl('http://a.com:22/', 'http://a.com/'), /bad-port/);
  // relative redirect resolves against base and stays http
  assert.equal(validateUrl('/next', 'http://a.com/').href, 'http://a.com/next');
});

test('rejects malformed URLs', async () => {
  await assert.rejects(() => safeFetch('not a url'), FetchBlockedError);
});
