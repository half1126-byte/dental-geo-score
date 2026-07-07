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

test('breakdown has 7 items summing to score, clamped 0..100', () => {
  const r = scorePage({ robots: { present: false }, signals: extractSignals('<html><body><h1>x</h1></body></html>') });
  assert.equal(r.breakdown.length, 7);
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

// ── KDD 2024 GEO signals (v0.2 weights) ──────────────────────────────────────

test('KDD 2024: hasStatistics (statCount band) boosts answer bucket when other signals are partial', () => {
  // Only h1 present → base answer pts = 2; statCount=1 (1-2 matches) → +1
  const base = { h1Count: 1, h2Count: 0, questionH2: 0, tables: 0, faqBlocks: 0, hasStatistics: false, hasQuotations: false };
  const withStats = { ...base, hasStatistics: true, statCount: 1 };
  const robots = { present: false, blocksAny: false, blockedBots: [] };
  const rBase = scorePage({ robots, signals: base });
  const rStats = scorePage({ robots, signals: withStats });
  const answerBase = rBase.breakdown.find((x) => x.key === 'answer').points;
  const answerStats = rStats.breakdown.find((x) => x.key === 'answer').points;
  assert.ok(answerStats > answerBase, `stats boost expected: ${answerBase} → ${answerStats}`);
  assert.equal(answerStats - answerBase, 1);
});

test('KDD 2024: hasQuotations boosts answer bucket independently (max weight in v0.2)', () => {
  const base = { h1Count: 1, h2Count: 0, questionH2: 0, tables: 0, faqBlocks: 0, hasStatistics: false, hasQuotations: false };
  const withQuotes = { ...base, hasQuotations: true };
  const robots = { present: false, blocksAny: false, blockedBots: [] };
  const b = scorePage({ robots, signals: base }).breakdown.find((x) => x.key === 'answer').points;
  const q = scorePage({ robots, signals: withQuotes }).breakdown.find((x) => x.key === 'answer').points;
  assert.equal(q - b, 3);
});

test('KDD 2024: answer bucket still capped at 20 even with all signals', () => {
  const allSignals = { h1Count: 1, h2Count: 3, questionH2: 1, tables: 1, faqBlocks: 1, hasStatistics: true, hasQuotations: true, statCount: 2, hasCitedSources: true };
  const r = scorePage({ robots: { present: false }, signals: allSignals });
  const pts = r.breakdown.find((x) => x.key === 'answer').points;
  assert.equal(pts, 20);
});

test('hasSameAsAuthority boosts schema bucket when hasTrust or hasFaq is missing', () => {
  const robots = { present: false, blocksAny: false, blockedBots: [] };
  // Only hasDental — schema pts = 10 without sameAs, 13 with
  const base = { jsonld: { hasDental: true, hasFaq: false, hasTrust: false }, hasSameAsAuthority: false };
  const withSameAs = { ...base, hasSameAsAuthority: true };
  const b = scorePage({ robots, signals: base }).breakdown.find((x) => x.key === 'schema').points;
  const s = scorePage({ robots, signals: withSameAs }).breakdown.find((x) => x.key === 'schema').points;
  assert.equal(s - b, 3);
});

test('schema bucket capped at 20 even with hasDental + hasFaq + hasTrust + hasSameAsAuthority', () => {
  const signals = { jsonld: { hasDental: true, hasFaq: true, hasTrust: true }, hasSameAsAuthority: true };
  const r = scorePage({ robots: { present: false }, signals });
  assert.equal(r.breakdown.find((x) => x.key === 'schema').points, 20);
});

// ── v0.2 axes structure ───────────────────────────────────────────────────────

test('axes: result has tech and content axes with correct max values', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.ok(r.axes, 'axes object present');
  assert.ok(r.axes.tech, 'axes.tech present');
  assert.ok(r.axes.content, 'axes.content present');
  assert.equal(r.axes.tech.max, 55, 'tech max = 55 (crawl15+schema20+extract10+local10)');
  assert.equal(r.axes.content.max, 45, 'content max = 45 (eeat15+fresh10+answer20)');
  assert.equal(r.axes.tech.score + r.axes.content.score, r.score, 'axes scores sum to total score');
});

test('axes: tech keys are crawl/schema/extract/local; content keys are eeat/fresh/answer', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  const techKeys = ['crawl', 'schema', 'extract', 'local'];
  const contentKeys = ['eeat', 'fresh', 'answer'];
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

test('METHODOLOGY_VERSION is v0.2', () => {
  const r = scorePage({ robots: { present: false }, signals: {} });
  assert.equal(r.methodologyVersion, 'v0.2');
});
