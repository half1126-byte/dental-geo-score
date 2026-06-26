import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractAnswerText } from '../lib/engines.js';
import { runCitationPanel } from '../lib/citation.js';
import { toPublicView, toPrivateReport } from '../lib/redact.js';

// ── extractAnswerText per engine shape ──────────────────────
test('extractAnswerText: ChatGPT Responses API (output_text)', () => {
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text', text: '강남 임플란트는 A치과를 추천합니다.' }] }] };
  assert.ok(extractAnswerText('chatgpt', resp).includes('A치과'));
});
test('extractAnswerText: ChatGPT output_text convenience fallback', () => {
  assert.equal(extractAnswerText('chatgpt', { output_text: '추천 답변' }), '추천 답변');
});
test('extractAnswerText: Claude text blocks', () => {
  const resp = { content: [{ type: 'text', text: '분당 스케일링은 C치과.' }, { type: 'tool_use' }] };
  assert.ok(extractAnswerText('claude', resp).includes('C치과'));
});
test('extractAnswerText: Perplexity chat completion', () => {
  const resp = { choices: [{ message: { content: '송파 교정은 B치과 추천.' } }] };
  assert.ok(extractAnswerText('perplexity', resp).includes('B치과'));
});
test('extractAnswerText: malformed → empty string, never throws', () => {
  assert.equal(extractAnswerText('chatgpt', null), '');
  assert.equal(extractAnswerText('perplexity', {}), '');
  assert.equal(extractAnswerText('claude', { content: 'not-array' }), '');
  assert.equal(extractAnswerText('unknown', { x: 1 }), '');
});

// ── runCitationPanel captures sampleAnswers ─────────────────
function mockFetch(answers) {
  return async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('openai')) return { output: [{ type: 'message', content: [{ type: 'output_text', text: answers.chatgpt, annotations: [{ type: 'url_citation', url: 'https://weshe.example/' }] }] }] };
      if (url.includes('perplexity')) return { choices: [{ message: { content: answers.perplexity } }], search_results: [{ url: 'https://other.example/' }] };
      return {};
    },
  });
}

test('runCitationPanel: per-engine sampleAnswers carry raw answer text + cited flag', async () => {
  const res = await runCitationPanel({
    clinicDomain: 'weshe.example', region: '강남', procedure: '임플란트',
    keys: { chatgpt: 'k', perplexity: 'k' },
    fetchImpl: mockFetch({ chatgpt: '강남 임플란트는 위시치과를 추천합니다.', perplexity: '다른 치과를 추천합니다.' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const gpt = res.perEngine.find((e) => e.engine === 'chatgpt');
  const ppl = res.perEngine.find((e) => e.engine === 'perplexity');
  assert.ok(gpt.sampleAnswers.length >= 1, 'chatgpt has sample answers');
  assert.ok(gpt.sampleAnswers[0].answer.includes('위시치과'));
  assert.equal(gpt.sampleAnswers[0].cited, true);       // weshe.example matched → cited
  assert.ok(gpt.sampleAnswers.length <= 3, 'capped at 3');
  assert.ok(ppl.sampleAnswers[0].answer.includes('다른 치과'));
  assert.equal(ppl.sampleAnswers[0].cited, false);      // only other.example cited
});

test('runCitationPanel: answer length capped (≤1400)', async () => {
  const huge = '가'.repeat(5000);
  const res = await runCitationPanel({
    clinicDomain: 'weshe.example', region: '강남', procedure: '임플란트',
    keys: { chatgpt: 'k' },
    fetchImpl: mockFetch({ chatgpt: huge, perplexity: '' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const gpt = res.perEngine.find((e) => e.engine === 'chatgpt');
  assert.ok(gpt.sampleAnswers[0].answer.length <= 1400);
});

// ── redaction: raw answers are OPERATOR-ONLY ────────────────
test('toPublicView: NEVER exposes sampleAnswers (의료광고법)', async () => {
  const panel = await runCitationPanel({
    clinicDomain: 'weshe.example', region: '강남', procedure: '임플란트',
    keys: { chatgpt: 'k', perplexity: 'k' },
    fetchImpl: mockFetch({ chatgpt: '위시치과 추천', perplexity: '다른 치과' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const pub = toPublicView(panel);
  for (const e of pub.perEngine) {
    assert.equal(e.sampleAnswers, undefined, 'public view must not carry raw answers');
    assert.equal(e.sampledCitedDomains, undefined, 'public view must not carry competitor domains');
  }
  // belt: stringify the whole public payload and assert the answer text is gone
  assert.ok(!JSON.stringify(pub).includes('위시치과'));
});

test('toPrivateReport: operator view DOES include sampleAnswers', async () => {
  const panel = await runCitationPanel({
    clinicDomain: 'weshe.example', region: '강남', procedure: '임플란트',
    keys: { chatgpt: 'k' },
    fetchImpl: mockFetch({ chatgpt: '위시치과 추천', perplexity: '' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const priv = toPrivateReport(panel, 'https://weshe.example/');
  const gpt = priv.perEngine.find((e) => e.engine === 'chatgpt');
  assert.ok(Array.isArray(gpt.sampleAnswers) && gpt.sampleAnswers.length >= 1);
  assert.ok(gpt.sampleAnswers[0].answer.includes('위시치과'));
});
