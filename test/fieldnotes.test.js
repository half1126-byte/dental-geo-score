import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  validateNote, validateBenchmark, isStale, daysSince,
  loadFieldnotes, scanForbidden, collectCopy, STALE_MAX_DAYS,
} from '../lib/news/fieldnotes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = JSON.parse(readFileSync(join(__dirname, '../public/data/fieldnotes.json'), 'utf8'));
const DAY = 86400000;

// ── validateNote ─────────────────────────────────────────────
test('validateNote: drops items missing title/summary/url', () => {
  assert.equal(validateNote({ title: 'x', summary: 'y' }), null);            // no url
  assert.equal(validateNote({ url: 'https://a.com', summary: 'y' }), null);  // no title
  assert.equal(validateNote({ title: 'x', url: 'https://a.com' }), null);    // no summary
  assert.equal(validateNote({ title: 'x', url: 'ftp://a.com', summary: 'y' }), null); // bad scheme
  assert.equal(validateNote(null), null);
});

test('validateNote: normalizes a good note + clamps confidence', () => {
  const n = validateNote({ title: 'T', url: 'https://a.com', summary: 'S', confidence: 'bogus' });
  assert.equal(n.kind, 'fieldnote');
  assert.equal(n.confidence, 'medium'); // unknown → medium
  assert.equal(validateNote({ title: 'T', url: 'https://a.com', summary: 'S', confidence: 'high' }).confidence, 'high');
});

test('validateBenchmark: requires label + metric', () => {
  assert.equal(validateBenchmark({ label: 'L' }), null);
  assert.equal(validateBenchmark({ metric: 'M' }), null);
  assert.ok(validateBenchmark({ label: 'L', metric: 'M' }));
});

// ── staleness (fail-safe) ────────────────────────────────────
test('isStale: boundary at STALE_MAX_DAYS', () => {
  const now = Date.parse('2026-06-28T00:00:00Z');
  const fresh = new Date(now - (STALE_MAX_DAYS - 1) * DAY).toISOString();
  const old = new Date(now - (STALE_MAX_DAYS + 1) * DAY).toISOString();
  assert.equal(isStale(fresh, now), false);
  assert.equal(isStale(old, now), true);
});

test('isStale: missing/unparseable reviewedAt → stale (hidden, fail-safe)', () => {
  assert.equal(daysSince(undefined), Infinity);
  assert.equal(daysSince('not-a-date'), Infinity);
  assert.equal(isStale('', Date.now()), true);
});

// ── loadFieldnotes on the real seed ──────────────────────────
test('loadFieldnotes: seed parses to valid notes + benchmarks', () => {
  const now = Date.parse('2026-06-28T12:00:00Z');
  const out = loadFieldnotes(SEED, now);
  assert.ok(out.notes.length >= 1, 'has notes');
  assert.ok(out.benchmarks.length >= 1, 'has benchmarks');
  assert.equal(out.stale, false, 'seed reviewedAt is fresh as of its own date');
  for (const n of out.notes) assert.equal(n.kind, 'fieldnote');
});

// ── compliance backstop ──────────────────────────────────────
test('seed copy: zero LAW_HARD (의료광고법·과장 0건)', () => {
  const offenders = scanForbidden(collectCopy(SEED));
  assert.deepEqual(offenders, [], `forbidden phrases found: ${offenders.join(' | ')}`);
});

test('scanForbidden: catches a planted superlative', () => {
  assert.deepEqual(scanForbidden(['정상 문구']), []);
  assert.equal(scanForbidden(['지역 1위 보장']).length, 1);
});
