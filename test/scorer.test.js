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
