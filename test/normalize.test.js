import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain, sameRegistrableDomain, unwrapRedirect } from '../lib/normalize.js';

test('eTLD+1 handles Korean multi-part TLDs (PSL, not naive 2-label)', () => {
  assert.equal(registrableDomain('https://www.haruplant.co.kr/implant'), 'haruplant.co.kr');
  assert.equal(registrableDomain('clinic.or.kr'), 'clinic.or.kr');
  assert.equal(registrableDomain('seoul.ne.kr'), 'seoul.ne.kr');
  // naive last-2-labels would collapse these to "co.kr"; PSL keeps them distinct
  assert.notEqual(registrableDomain('a.co.kr'), registrableDomain('b.co.kr'));
});

test('strips www, lowercases, accepts bare host', () => {
  assert.equal(registrableDomain('HTTP://WWW.Example.COM/'), 'example.com');
  assert.equal(registrableDomain('sub.example.com'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
});

test('sameRegistrableDomain matches across www/path/scheme', () => {
  assert.equal(sameRegistrableDomain('https://www.haruplant.co.kr/implant', 'haruplant.co.kr'), true);
  assert.equal(sameRegistrableDomain('http://haruplant.co.kr', 'https://www.haruplant.co.kr/'), true);
  assert.equal(sameRegistrableDomain('https://other.co.kr', 'haruplant.co.kr'), false);
});

test('unwrapRedirect extracts real URL from grounding/redirect wrappers', () => {
  const wrapped =
    'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc?url=https%3A%2F%2Fharuplant.co.kr%2F';
  assert.equal(unwrapRedirect(wrapped), 'https://haruplant.co.kr/');
  // non-wrapper passes through untouched
  assert.equal(unwrapRedirect('https://haruplant.co.kr/x'), 'https://haruplant.co.kr/x');
  // citation through a wrapper still matches the clinic domain
  assert.equal(sameRegistrableDomain(wrapped, 'haruplant.co.kr'), true);
});
