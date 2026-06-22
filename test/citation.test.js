import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenAIRequest, buildPerplexityRequest, buildClaudeRequest, runCitationPanel, ENGINE_API } from '../lib/citation.js';

test('openai request forces web_search (tool_choice:required) + KR user_location', () => {
  const r = buildOpenAIRequest({ system: 's', user: 'u' }, { city: '강남' });
  assert.equal(r.tool_choice, 'required');
  assert.equal(r.tools[0].type, 'web_search');
  assert.equal(r.tools[0].user_location.country, 'KR');
  assert.equal(r.tools[0].user_location.city, '강남');
  assert.ok(r.input.some((m) => m.role === 'user' && m.content === 'u'));
});

test('perplexity request sets web_search_options.user_location KR', () => {
  const r = buildPerplexityRequest({ user: 'u' }, { city: '강남' });
  assert.equal(r.model, 'sonar');
  assert.equal(r.web_search_options.user_location.country, 'KR');
  assert.equal(r.web_search_options.user_location.city, '강남');
});

test('claude request uses verified web_search_20250305 (not hallucinated _20260318)', () => {
  const r = buildClaudeRequest({ user: 'u' }, {});
  assert.equal(r.tools[0].type, 'web_search_20250305');
});

test('ENGINE_API endpoints + env keys correct', () => {
  assert.equal(ENGINE_API.chatgpt.url, 'https://api.openai.com/v1/responses');
  assert.equal(ENGINE_API.perplexity.url, 'https://api.perplexity.ai/chat/completions');
  assert.equal(ENGINE_API.claude.envKey, 'ANTHROPIC_API_KEY');
});

test('runCitationPanel aggregates per-engine hit-rate with mock fetch + evidence', async () => {
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url.includes('openai')) {
      const userMsg = body.input.find((m) => m.role === 'user').content;
      const cited = userMsg.includes('추천'); // cite only on recommendation-shaped prompts
      return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', annotations: cited ? [{ type: 'url_citation', url: 'https://www.haruplant.co.kr/implant' }] : [] }] }] }) };
    }
    if (url.includes('perplexity')) {
      return { ok: true, json: async () => ({ search_results: [{ url: 'https://other.co.kr' }], citations: [] }) };
    }
    return { ok: false, status: 404 };
  };
  const r = await runCitationPanel({ clinicDomain: 'haruplant.co.kr', region: '강남', procedure: '임플란트', keys: { chatgpt: 'k1', perplexity: 'k2' }, nowIso: '2026-06-23T00:00:00Z', fetchImpl });
  const cg = r.perEngine.find((p) => p.engine === 'chatgpt');
  const px = r.perEngine.find((p) => p.engine === 'perplexity');
  assert.ok(cg.runs >= 3);
  assert.ok(cg.citedRuns >= 1, 'chatgpt cites on 추천 prompts');
  assert.equal(cg.cited, true);
  assert.ok(cg.evidence.some((ev) => ev.matchedUrls && ev.matchedUrls.length));
  assert.equal(px.cited, false);
  assert.equal(px.measured, true); // measured but not cited != not measured
});

test('runCitationPanel skips engines without a key; failures captured as evidence', async () => {
  const fetchImpl = async (url) => (url.includes('openai') ? { ok: false, status: 500 } : { ok: true, json: async () => ({ output: [] }) });
  const r = await runCitationPanel({ clinicDomain: 'x.co.kr', keys: { chatgpt: 'k' }, nowIso: 't', fetchImpl });
  assert.equal(r.perEngine.length, 1);
  assert.equal(r.perEngine[0].engine, 'chatgpt');
  assert.equal(r.perEngine[0].cited, false);
  assert.ok(r.perEngine[0].evidence.some((e) => e.error));
});
