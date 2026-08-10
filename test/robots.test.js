import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeRobots, pathAllowed } from '../lib/robots.js';

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

// v0.4: blocksAny는 '인용 경로 봇' 차단만을 뜻한다. GPTBot·CCBot·Google-Extended는
// 학습 전용이라 막아도 답변 인용과 무관하므로 감점하지 않는다(blockedTraining에만 기록).
test('detects citation-bot block (OAI-SearchBot Disallow /)', () => {
  const body = 'User-agent: OAI-SearchBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body });
  assert.equal(r.present, true);
  assert.equal(r.blocksAny, true);
  assert.ok(r.blockedCitation.includes('OAI-SearchBot'));
  assert.ok(r.blockedBots.includes('OAI-SearchBot'), '하위호환 blockedBots 유지');
});

test('training-only block (GPTBot) is recorded but NOT penalized', () => {
  const body = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /\n';
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body });
  assert.equal(r.present, true);
  assert.equal(r.blocksAny, false, '학습봇 차단은 인용 경로를 막지 않는다');
  assert.ok(r.blockedTraining.includes('GPTBot'));
  assert.equal(r.blockedCitation.length, 0);
});

test('UA matching is exact-token — "User-agent: bot" must not match GPTBot', () => {
  // v0.3 버그: 'gptbot'.includes('bot') 이 참이라 무관한 그룹이 AI봇 6종을 차단 판정했다.
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: bot\nDisallow: /\n' });
  assert.equal(r.blocksAny, false);
  assert.equal(r.blockedBots.length, 0);
});

test('RFC 9309 wildcard: "Disallow: /*" blocks (국내 빌더 기본 템플릿)', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: OAI-SearchBot\nDisallow: /*\n' });
  assert.equal(r.blocksAny, true);
});

test('RFC 9309 most-specific: 더 긴 Allow가 짧은 Disallow를 이긴다', () => {
  const groups = [{ agents: ['*'], disallow: ['/'], allow: ['/clinic/'] }];
  assert.equal(pathAllowed(groups, 'OAI-SearchBot', '/'), false, '루트는 막힌다');
  assert.equal(pathAllowed(groups, 'OAI-SearchBot', '/clinic/a'), true, '더 구체적인 Allow가 이긴다');
});

test('RFC 9309 종결자 $: "/x$"는 정확히 그 경로만 막는다', () => {
  const groups = [{ agents: ['*'], disallow: ['/x$'], allow: [] }];
  assert.equal(pathAllowed(groups, 'OAI-SearchBot', '/x'), false);
  assert.equal(pathAllowed(groups, 'OAI-SearchBot', '/xyz'), true);
});

test('partial block: 근거 경로(/blog)만 막힌 경우를 감지한다', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: OAI-SearchBot\nDisallow: /blog/\n' });
  assert.equal(r.blocksAny, false, '루트는 열려 있다');
  assert.equal(r.partialBlocks.length, 1);
  assert.ok(r.partialBlocks[0].paths.includes('/blog/'));
});

test('일반 사이트의 /admin 차단은 AI 차단이 아니다', () => {
  const r = analyzeRobots({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /admin/\n' });
  assert.equal(r.blocksAny, false);
  assert.equal(r.partialBlocks.length, 0);
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
