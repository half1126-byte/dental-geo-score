import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentCardHtml } from '../public/agent-card.js';

// Mirror operator.js's esc + card so the test exercises the real rendering contract.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const card = (title, body) => `<div class="card"><b>${esc(title)}</b><div>${body}</div></div>`;

test('non-measured states say "실패 아님" and never a bare 실패/낙제', () => {
  for (const status of ['measurement-limited', 'no-form', 'no-controls']) {
    const html = agentCardHtml({ status }, { esc, card });
    assert.ok(html.includes('실패 아님'), `${status} must reassure 실패 아님`);
    assert.ok(!/낙제/.test(html), `${status} must not say 낙제`);
  }
});

test('measured card NEVER emits a 0-100 / band / grade; shows fraction labeled 점수 아님', () => {
  const a = {
    status: 'measured', forms: 1, bookingForms: 1, controlsTotal: 7, controlsNamed: 5,
    placeholderOnly: 0, coverage: 0.71, submitNamed: 1, submitTotal: 1,
    checks: [{ key: 'control-names', label: '입력칸에 기계가 읽을 이름', pass: false }], passed: 0, total: 3, unnamedSamples: [],
  };
  const html = agentCardHtml(a, { esc, card });
  assert.ok(!html.includes('/100'), 'no /100');
  assert.ok(!/등급|낙제|grade|band/i.test(html), 'no grade/band wording');
  assert.ok(html.includes('점수 아님'), 'fraction labeled 점수 아님');
  assert.ok(html.includes('5/7'), 'verbatim coverage fraction');
  assert.ok(html.includes('라벨을 고쳐도 AI 인용·점수에는 영향 없음'), 'explicit non-causal-toward-citation copy');
});

test('XSS — unnamedSamples and labels are escaped', () => {
  const a = {
    status: 'measured', forms: 1, bookingForms: 0, controlsTotal: 1, controlsNamed: 0,
    placeholderOnly: 0, coverage: 0, submitNamed: 0, submitTotal: 0,
    checks: [{ key: 'x', label: '<b>evil</b>', pass: false }], passed: 0, total: 3,
    unnamedSamples: ['<img src=x onerror=alert(1)>'],
  };
  const html = agentCardHtml(a, { esc, card });
  assert.ok(!html.includes('<img'), 'must escape <img');
  assert.ok(!html.includes('<b>evil</b>'), 'must escape injected label markup');
  assert.ok(html.includes('&lt;img'), 'escaped form present');
});

test('undefined agentActionability → 측정 불가, no throw', () => {
  const html = agentCardHtml(undefined, { esc, card });
  assert.ok(html.includes('측정 불가'));
});
