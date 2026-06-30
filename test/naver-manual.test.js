import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prevMonths, sanitize } from '../api/naver-manual.js';

// ---------------------------------------------------------------------------
// prevMonths
// ---------------------------------------------------------------------------
describe('prevMonths', () => {
  it('returns N months newest-first', () => {
    const now = new Date('2026-06-30');
    assert.deepEqual(prevMonths(3, now), ['2026-06', '2026-05', '2026-04']);
  });

  it('crosses year boundary', () => {
    const now = new Date('2026-02-15');
    assert.deepEqual(prevMonths(3, now), ['2026-02', '2026-01', '2025-12']);
  });

  it('returns exactly N entries', () => {
    assert.equal(prevMonths(6, new Date('2026-06-01')).length, 6);
    assert.equal(prevMonths(1, new Date('2026-01-31')).length, 1);
  });

  it('pads single-digit months', () => {
    const r = prevMonths(9, new Date('2026-09-01'));
    assert.equal(r[8], '2026-01');
  });

  it('crosses two year boundaries', () => {
    const now = new Date('2027-01-31');
    const r = prevMonths(14, now);
    assert.equal(r[13], '2025-12');
  });
});

// ---------------------------------------------------------------------------
// sanitize
// ---------------------------------------------------------------------------
describe('sanitize', () => {
  it('coerces numeric strings', () => {
    const out = sanitize({ callClicks: '123', naturalVisitRate: '45.6' });
    assert.equal(out.callClicks, 123);
    assert.equal(out.naturalVisitRate, 45.6);
  });

  it('accepts zero', () => {
    assert.equal(sanitize({ reservations: '0' }).reservations, 0);
    assert.equal(sanitize({ reservations: 0 }).reservations, 0);
  });

  it('drops negative values', () => {
    assert.equal(sanitize({ callClicks: -1 }).callClicks, undefined);
  });

  it('drops values over 1,000,000', () => {
    assert.equal(sanitize({ saves: 2_000_000 }).saves, undefined);
    assert.equal(sanitize({ saves: 1_000_001 }).saves, undefined);
    assert.equal(sanitize({ saves: 1_000_000 }).saves, 1_000_000);
  });

  it('drops empty strings', () => {
    assert.equal(sanitize({ callClicks: '' }).callClicks, undefined);
    assert.equal(sanitize({ callClicks: '', saves: '50' }).saves, 50);
  });

  it('drops null and undefined', () => {
    assert.equal(sanitize({ callClicks: null }).callClicks, undefined);
    assert.equal(sanitize({ callClicks: undefined }).callClicks, undefined);
  });

  it('drops non-numeric strings', () => {
    assert.equal(sanitize({ callClicks: 'abc' }).callClicks, undefined);
    assert.equal(sanitize({ callClicks: 'NaN' }).callClicks, undefined);
  });

  it('ignores unknown fields — no prototype pollution', () => {
    const out = sanitize({ callClicks: '5', __proto__: '99', constructor: '1', hackerField: '999' });
    assert.equal(out.callClicks, 5);
    assert.equal(out.hackerField, undefined);
    assert.ok(!Object.prototype.hasOwnProperty.call(out, '__proto__'), '__proto__ must not be own property');
    assert.equal(Object.keys(out).length, 1);
  });

  it('accepts all five known fields', () => {
    const input = { naturalVisitRate: 30, callClicks: 100, directionClicks: 50, reservations: 20, saves: 300 };
    assert.deepEqual(sanitize(input), input);
  });

  it('handles fractional values', () => {
    assert.equal(sanitize({ naturalVisitRate: 42.7 }).naturalVisitRate, 42.7);
  });
});
