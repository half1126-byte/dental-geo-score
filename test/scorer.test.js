import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { extractSignals } from '../lib/extract.js';
import { scorePage } from '../lib/scorer.js';

const dir = dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(join(dir, 'fixtures', n), 'utf8');

test('golden: haruplant (optimized) — server-rendered, Dentist JSON-LD, mid-high score', () => {
  const sig = extractSignals(fx('haruplant.html'));
  const r = scorePage({ robots: { present: true, blocksAny: false, blockedBots: [] }, signals: sig });
  assert.equal(sig.needsHeadless, false, 'should be server-rendered');
  assert.equal(sig.jsonld.hasDental, true, 'POC: Dentist JSON-LD present (WebFetch missed it)');
  assert.ok(r.score >= 55 && r.score <= 90, `score in band: ${r.score}`);
});

test('golden: seoulwooriidental (JS shell 542B) — needsHeadless, low score', () => {
  const sig = extractSignals(fx('seoulwooriidental.html'));
  const r = scorePage({ robots: { present: false, blocksAny: false, blockedBots: [] }, signals: sig });
  assert.equal(sig.needsHeadless, true, 'JS shell must route to headless');
  assert.ok(r.score < 30, `low score: ${r.score}`);
});

test('two clinic tiers score meaningfully differently (>30pt gap)', () => {
  const a = scorePage({ robots: { present: true }, signals: extractSignals(fx('haruplant.html')) }).score;
  const b = scorePage({ robots: { present: false }, signals: extractSignals(fx('seoulwooriidental.html')) }).score;
  assert.ok(a - b > 30, `gap ${a - b}`);
});

test('breakdown has 9 items summing to score, clamped 0..100', () => {
  const r = scorePage({ robots: { present: false }, signals: extractSignals('<html><body><h1>x</h1></body></html>') });
  assert.equal(r.breakdown.length, 9);
  assert.equal(r.breakdown.reduce((a, x) => a + x.points, 0), r.score);
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.ok(['초기 단계', '개선 여지 큼', '보통', '우수'].includes(r.band));
});

test('breakdown items all have layer field in SEO|AEO|GEO', () => {
  const r = scorePage({ robots: { present: false }, signals: extractSignals('<html><body><h1>x</h1></body></html>') });
  const valid = new Set(['SEO', 'AEO', 'GEO']);
  for (const item of r.breakdown) {
    assert.ok(valid.has(item.layer), `"${item.key}" has invalid layer: ${item.layer}`);
  }
});

test('AI-bot block is heavily penalized (fatal signal)', () => {
  const sig = extractSignals(fx('haruplant.html'));
  const allowed = scorePage({ robots: { present: true, blocksAny: false, blockedBots: [] }, signals: sig }).score;
  const blocked = scorePage({ robots: { present: true, blocksAny: true, blockedBots: ['OAI-SearchBot'], note: 'blocked' }, signals: sig }).score;
  assert.ok(allowed - blocked >= 13, `block penalty ${allowed - blocked}`);
});

test('topFixes: each item carries note (x.why) so UI can show specific guidance', () => {
  // Low-signal HTML → guaranteed to produce topFixes
  const sig = extractSignals('<html><body><h1>x</h1></body></html>');
  const r = scorePage({ robots: { present: false, blocksAny: false, blockedBots: [] }, signals: sig });
  assert.ok(r.topFixes.length > 0, 'expected at least one fix');
  for (const f of r.topFixes) {
    assert.ok(typeof f.note === 'string' && f.note.length > 0, `topFix "${f.label}" missing note`);
    assert.ok(typeof f.gainLabel === 'string', `topFix "${f.label}" missing gainLabel`);
  }
});

// ── KDD 2024 GEO signals — v0.3: citable is its own scored bucket ────────────
// 근거: Aggarwal et al., KDD 2024 (arXiv:2311.09735). 실측 상위 3개 기법이
// 출처 명시 / 인용구 추가 / 통계 추가. 출처 명시가 단일 최대 레버(5위권 +115.1%).

const citablePts = (signals) =>
  scorePage({ robots: { present: false, blocksAny: false, blockedBots: [] }, signals })
    .breakdown.find((x) => x.key === 'citable').points;

test('v0.3: citable is a separate scored bucket, not buried inside answer', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  const citable = r.breakdown.find((x) => x.key === 'citable');
  assert.ok(citable, 'citable bucket exists');
  assert.equal(citable.max, 15);
  assert.equal(citable.layer, 'GEO');
});

test('v0.3: hasCitedSources carries the single largest weight (7) — the +115.1% lever', () => {
  const gain = citablePts({ hasCitedSources: true }) - citablePts({});
  assert.equal(gain, 7);
  // 출처(7) > 인용구(4), 출처(7) > 통계 최대(4)
  assert.ok(gain > citablePts({ hasQuotations: true }) - citablePts({}), 'citation outweighs quotation');
  assert.ok(gain > citablePts({ statCount: 2 }) - citablePts({}), 'citation outweighs statistics');
});

test('v0.3: hasQuotations adds 4 to citable, independent of structure', () => {
  assert.equal(citablePts({ hasQuotations: true }) - citablePts({}), 4);
});

test('v0.3: statCount bands 0/1/2 → 0/2/4 in citable', () => {
  const zero = citablePts({});
  assert.equal(citablePts({ statCount: 1 }) - zero, 2);
  assert.equal(citablePts({ statCount: 2 }) - zero, 4);
});

test('v0.3: citable capped at 15 with all three signals (7+4+4)', () => {
  assert.equal(citablePts({ hasCitedSources: true, hasQuotations: true, statCount: 2 }), 15);
});

test('v0.3: answer bucket is structure-only — citation signals do not move it', () => {
  const structure = { h1Count: 1, h2Count: 3, questionH2: 1, tables: 1, faqBlocks: 1 };
  const robots = { present: false };
  const plain = scorePage({ robots, signals: structure }).breakdown.find((x) => x.key === 'answer').points;
  const withCites = scorePage({
    robots,
    signals: { ...structure, hasQuotations: true, statCount: 2, hasCitedSources: true },
  }).breakdown.find((x) => x.key === 'answer').points;
  assert.equal(plain, 10, 'full structure maxes answer at 10');
  assert.equal(withCites, plain, 'citation signals must not leak into answer');
});

test('hasSameAsAuthority boosts schema bucket when hasTrust or hasFaq is missing', () => {
  const robots = { present: false, blocksAny: false, blockedBots: [] };
  // Only hasDental — schema pts = 10 without sameAs, 13 with
  const base = { jsonld: { hasDental: true, hasFaq: false, hasTrust: false }, hasSameAsAuthority: false };
  const withSameAs = { ...base, hasSameAsAuthority: true };
  const b = scorePage({ robots, signals: base }).breakdown.find((x) => x.key === 'schema').points;
  const s = scorePage({ robots, signals: withSameAs }).breakdown.find((x) => x.key === 'schema').points;
  assert.equal(s - b, 2);
});

test('schema bucket capped at 10 even with hasDental + hasFaq + hasTrust + hasSameAsAuthority', () => {
  const signals = { jsonld: { hasDental: true, hasFaq: true, hasTrust: true }, hasSameAsAuthority: true };
  const r = scorePage({ robots: { present: false }, signals });
  assert.equal(r.breakdown.find((x) => x.key === 'schema').points, 10);
});

// ── v0.3 axes structure ───────────────────────────────────────────────────────

test('axes: result has tech and content axes with correct max values', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.ok(r.axes, 'axes object present');
  assert.ok(r.axes.tech, 'axes.tech present');
  assert.ok(r.axes.content, 'axes.content present');
  assert.equal(r.axes.tech.max, 50, 'tech max = 50 (crawl15+schema10+extract10+local10+price5)');
  assert.equal(r.axes.content.max, 50, 'content max = 50 (eeat15+citable15+answer10+fresh10)');
  assert.equal(r.axes.tech.max + r.axes.content.max, 100, 'axes maxima sum to 100');
  assert.equal(r.axes.tech.score + r.axes.content.score, r.score, 'axes scores sum to total score');
});

test('axes: tech keys are crawl/schema/extract/local/price; content keys are eeat/fresh/answer/citable', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  const techKeys = ['crawl', 'schema', 'extract', 'local', 'price'];
  const contentKeys = ['eeat', 'fresh', 'answer', 'citable'];
  const techSum = r.breakdown.filter((x) => techKeys.includes(x.key)).reduce((a, x) => a + x.points, 0);
  const contentSum = r.breakdown.filter((x) => contentKeys.includes(x.key)).reduce((a, x) => a + x.points, 0);
  assert.equal(techSum, r.axes.tech.score);
  assert.equal(contentSum, r.axes.content.score);
});

test('axes: needsHeadless caps extract bucket → tech.score drops significantly', () => {
  const withHeadless = { needsHeadless: true, sn: 0.1, scripts: 5 };
  const withoutHeadless = { needsHeadless: false, sn: 0.1, scripts: 5 };
  const robots = { present: false };
  const rH = scorePage({ robots, signals: withHeadless });
  const rN = scorePage({ robots, signals: withoutHeadless });
  assert.ok(rN.axes.tech.score > rH.axes.tech.score, 'headless should lower tech score');
});

test('axes: label fields present', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.equal(typeof r.axes.tech.label, 'string');
  assert.equal(typeof r.axes.content.label, 'string');
  assert.ok(r.axes.tech.label.length > 0);
  assert.ok(r.axes.content.label.length > 0);
});

test('METHODOLOGY_VERSION is v0.4', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.equal(r.methodologyVersion, 'v0.4');
});

test('disclaimer: score result includes non-prediction disclaimer', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.ok(typeof r.disclaimer === 'string' && r.disclaimer.length > 10, 'disclaimer must be a non-empty string');
  assert.ok(r.disclaimer.includes('AI 인용을 예측하지 않'), 'disclaimer must state non-prediction');
});

// ── v0.4 회귀: 등급 하드 게이트 ────────────────────────────────────────────────
// AI 크롤러 차단은 인용의 필요조건 실패다. 총점이 높아도 '우수'를 붙이면 안 된다.
const V4_RICH = {
  h1Count: 1, h2Count: 5, questionH2: 2, tables: 2, faqBlocks: 2,
  credentials: 6, social: 3, dateSignals: 3, phone: true, address: true,
  sn: 0.1, scripts: 5, jsonld: { hasDental: true, hasFaq: true, hasTrust: true },
  hasSameAsAuthority: true, hasCitedSources: true, hasQuotations: true, statCount: 2,
};

test('v0.4 등급: AI 크롤러 차단 사이트는 총점과 무관하게 우수가 될 수 없다', () => {
  const r = scorePage({
    robots: { present: true, blocksAny: true, blockedBots: ['OAI-SearchBot'], note: '차단' },
    signals: V4_RICH,
  });
  assert.ok(r.score >= 75, `게이트를 검증하려면 총점이 75 이상이어야 한다: ${r.score}`);
  assert.notEqual(r.band, '우수', '크롤러가 막힌 페이지에 우수를 붙이면 안 된다');
});

test('v0.4 등급: 크롤러가 열린 정상 사이트는 우수를 유지한다', () => {
  const r = scorePage({ robots: { present: true, blocksAny: false, blockedBots: [] }, signals: V4_RICH });
  assert.equal(r.band, '우수');
});

test('v0.4 등급: 게이트는 등급만 바꾸고 점수는 건드리지 않는다(하위호환)', () => {
  const robots = { present: true, blocksAny: true, blockedBots: ['GPTBot'], note: '차단' };
  const r = scorePage({ robots, signals: V4_RICH });
  assert.equal(r.breakdown.reduce((a, x) => a + x.points, 0), r.score, '점수는 여전히 항목 합계와 일치해야 한다');
});

// ── v0.4: 게이트키퍼 근거 반영 (What Gets Cited, arXiv:2605.25517) ────────────
// 25.2만회 통제 실험에서 6개 모델 전원 일치로 확인된 인용 게이트키퍼 4요인 중
// 우리가 측정 가능한 두 가지가 '가격 미기재'와 '오래된 타임스탬프'다.

test('v0.4: price는 축A의 독립 채점 항목이다', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  const p = r.breakdown.find((x) => x.key === 'price');
  assert.ok(p, 'price 항목 존재');
  assert.equal(p.max, 5);
  assert.equal(p.points, 0, '가격 정보가 없으면 0점');
});

test('v0.4: price 3-band — 없음 0 / 일부 3 / 충분 5', () => {
  const pts = (signals) => scorePage({ robots: { present: false }, signals })
    .breakdown.find((x) => x.key === 'price').points;
  assert.equal(pts({ priceBand: 0 }), 0);
  assert.equal(pts({ priceBand: 1 }), 3);
  assert.equal(pts({ priceBand: 2 }), 5);
});

test('v0.4: fresh 배점을 10으로 되돌렸다(통제 실험 근거)', () => {
  const f = (dateSignals) => scorePage({ robots: { present: false }, signals: { dateSignals } })
    .breakdown.find((x) => x.key === 'fresh');
  assert.equal(f(0).max, 10);
  assert.equal(f(0).points, 0);
  assert.equal(f(1).points, 6);
  assert.equal(f(3).points, 10);
});

test('v0.4: 총점 상한은 여전히 100이고 축은 50/50이다', () => {
  const full = {
    h1Count: 1, h2Count: 5, questionH2: 2, tables: 2, faqBlocks: 2,
    credentials: 6, social: 3, dateSignals: 3, phone: true, address: true,
    sn: 0.1, scripts: 5, jsonld: { hasDental: true, hasFaq: true, hasTrust: true },
    hasSameAsAuthority: true, hasCitedSources: true, hasQuotations: true, statCount: 2,
    priceBand: 2,
  };
  const r = scorePage({ robots: { present: true, blocksAny: false, blockedBots: [] }, signals: full });
  assert.equal(r.score, 100, '모든 신호 충족 시 정확히 100점');
  assert.equal(r.axes.tech.max, 50);
  assert.equal(r.axes.content.max, 50);
  assert.equal(r.band, '우수');
});
