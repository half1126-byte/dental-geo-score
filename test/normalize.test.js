import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain, sameRegistrableDomain, unwrapRedirect, isKnownPlatformDomain } from '../lib/normalize.js';

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

test('isKnownPlatformDomain: Naver Place URL → true (false-positive guard)', () => {
  // place.naver.com → naver.com → platform → block
  assert.equal(isKnownPlatformDomain('https://place.naver.com/hospital/2081935519/home'), true);
  assert.equal(isKnownPlatformDomain('https://blog.naver.com/myclinic'), true);
  assert.equal(isKnownPlatformDomain('https://cafe.naver.com/dental'), true);
});

test('isKnownPlatformDomain: other shared platforms → true', () => {
  assert.equal(isKnownPlatformDomain('https://www.instagram.com/myclinic'), true);
  assert.equal(isKnownPlatformDomain('https://www.facebook.com/myclinic'), true);
  assert.equal(isKnownPlatformDomain('https://myclinic.tistory.com'), true);
  assert.equal(isKnownPlatformDomain('https://map.kakao.com/link/map/12345'), true);
});

test('isKnownPlatformDomain: medical booking/telemedicine aggregators → true', () => {
  assert.equal(isKnownPlatformDomain('my-doctor.io'), true);
  assert.equal(isKnownPlatformDomain('https://www.goodoc.co.kr/hospital/123'), true);
  assert.equal(isKnownPlatformDomain('modoodoc.com'), true);
  assert.equal(isKnownPlatformDomain('https://www.gangnamunni.com/events'), true);
});

test('isKnownPlatformDomain: own clinic domain → false', () => {
  assert.equal(isKnownPlatformDomain('https://www.seoulsmile.co.kr'), false);
  assert.equal(isKnownPlatformDomain('https://haruplant.co.kr/implant'), false);
  assert.equal(isKnownPlatformDomain('https://trium-dental.com'), false);
});
