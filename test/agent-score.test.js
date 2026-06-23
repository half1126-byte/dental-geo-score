import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentActionability } from '../lib/agent-score.js';

test('SPA (needsHeadless) → measurement-limited, never a fake 0', () => {
  const a = buildAgentActionability({ needsHeadless: true, formAccessibility: { forms: 1, controlsTotal: 4, controlsNamed: 0 } });
  assert.equal(a.status, 'measurement-limited');
  assert.equal(a.coverage, undefined); // no fabricated fraction from unmeasured DOM
  assert.equal(a.passed, undefined);
});

test('no form → no-form (informational, not a fail)', () => {
  const a = buildAgentActionability({ formAccessibility: { forms: 0 } });
  assert.equal(a.status, 'no-form');
});

test('measured → pass-rate fraction, NOT a 0-100 score or grade', () => {
  const a = buildAgentActionability({ formAccessibility: { forms: 1, bookingForms: 1, controlsTotal: 5, controlsNamed: 5, placeholderOnly: 0, submitTotal: 1, submitNamed: 1 } });
  assert.equal(a.status, 'measured');
  assert.equal(a.coverage, 1);
  assert.equal(a.passed, a.total);
  assert.ok(a.total <= 5 && a.passed <= a.total);
  // honesty guard: this layer must NEVER expose a 0-100 score / band / grade
  assert.equal(a.score, undefined);
  assert.equal(a.band, undefined);
  assert.equal(a.grade, undefined);
});

test('low coverage + placeholder-only + unnamed submit fail the right checks (still no score)', () => {
  const a = buildAgentActionability({ formAccessibility: { forms: 1, controlsTotal: 10, controlsNamed: 4, placeholderOnly: 4, submitTotal: 1, submitNamed: 0 } });
  assert.equal(a.coverage, 0.4);
  const byKey = Object.fromEntries(a.checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey['control-names'], false); // 0.4 < 0.8
  assert.equal(byKey['submit-name'], false); // 0/1 named
  assert.equal(byKey['not-placeholder-only'], false); // 4/4 = 100% placeholder-only > 30%
  assert.equal(a.passed, 0);
  assert.equal(a.score, undefined);
});

test('empty signals (no formAccessibility) → no-form, no throw', () => {
  const a = buildAgentActionability({});
  assert.equal(a.status, 'no-form');
});

test('QA#6 no submit button → submit-name FAILS (not vacuous); nothing named → placeholder check FAILS', () => {
  const a = buildAgentActionability({ formAccessibility: { forms: 1, controlsTotal: 8, controlsNamed: 0, placeholderOnly: 0, submitTotal: 0, submitNamed: 0 } });
  assert.equal(a.status, 'measured');
  const byKey = Object.fromEntries(a.checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey['submit-name'], false, 'no submit → fail');
  assert.equal(byKey['not-placeholder-only'], false, 'nothing named → fail');
  assert.equal(byKey['control-names'], false);
  assert.equal(a.passed, 0);
});

test('QA#11 form present but zero readable controls → no-controls (not vacuous 0/0 measured)', () => {
  const a = buildAgentActionability({ formAccessibility: { forms: 1, bookingForms: 1, controlsTotal: 0, controlsNamed: 0 } });
  assert.equal(a.status, 'no-controls');
  assert.equal(a.passed, undefined);
  assert.equal(a.coverage, undefined);
});

test('QA#7 coverage gate uses RAW ratio, not the rounded display value', () => {
  // 39/49 = 0.7959… → display rounds to 0.80, but RAW < 0.8 must FAIL control-names
  const a = buildAgentActionability({ formAccessibility: { forms: 1, controlsTotal: 49, controlsNamed: 39, placeholderOnly: 0, submitTotal: 1, submitNamed: 1 } });
  assert.equal(a.coverage, 0.8, 'display rounds up');
  const byKey = Object.fromEntries(a.checks.map((c) => [c.key, c.pass]));
  assert.equal(byKey['control-names'], false, 'raw 0.7959 < 0.8 → fail');
  assert.equal(a.thresholdsVersion, 'v0.1');
});
