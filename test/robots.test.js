import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRobots } from '../lib/robots.js';

test('SPA index.html fallback (200 text/html) treated as ABSENT, not "allow all"', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body>app</body></html>' });
  assert.equal(r.present, false);
  assert.equal(r.blocksAny, false);
});

test('missing robots (404) treated as absent', () => {
  const r = analyzeRobots({ status: 404, contentType: 'text/plain', body: 'Not Found' });
  assert.equal(r.present, false);
});

test('normal allow-all robots, captures sitemap', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nAllow: /\nSitemap: https://x.co.kr/sitemap.xml' });
  assert.equal(r.present, true);
  assert.equal(r.blocksAny, false);
  assert.equal(r.sitemap, 'https://x.co.kr/sitemap.xml');
});

test('detects AI-bot block (GPTBot Disallow /)', () => {
  const body = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body });
  assert.equal(r.present, true);
  assert.equal(r.blocksAny, true);
  assert.ok(r.blockedBots.includes('GPTBot'));
});

test('wildcard Disallow / blocks all AI bots', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /\n' });
  assert.equal(r.blocksAny, true);
  assert.ok(r.blockedBots.includes('OAI-SearchBot'));
});

test('empty Disallow (allow all) is not a block', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow:\n' });
  assert.equal(r.blocksAny, false);
});
