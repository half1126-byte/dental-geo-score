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

test('claude request uses web_search_20260209 (dynamic filtering, GA 2026-02-09)', () => {
  const r = buildClaudeRequest({ user: 'u' }, {});
  assert.equal(r.tools[0].type, 'web_search_20260209');
});

test('claude request forces tool_choice:{type:tool} to prevent search skip (mirrors OpenAI required)', () => {
  const r = buildClaudeRequest({ system: 's', user: 'u' }, {});
  assert.deepEqual(r.tool_choice, { type: 'tool', name: 'web_search' });
  assert.ok(r.system.includes('반드시 web_search 도구를 사용'), 'system must mandate search');
  assert.ok(r.system.includes('s'), 'original system preserved');
});

test('callEngine: claude HTTP-200 tool_result is_error → throws (not inconclusive)', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({
      content: [
        { type: 'tool_use', name: 'web_search', id: 'x', input: { query: 'q' } },
        { type: 'tool_result', tool_use_id: 'x', is_error: true, content: [{ type: 'text', text: 'too_many_requests' }] },
      ],
    }),
  });
  await assert.rejects(
    () => import('../lib/citation.js').then(({ callEngine }) => callEngine('claude', { user: 'u' }, { key: 'k', fetchImpl })),
    /web_search_tool_result error.*too_many_requests/,
  );
});

test('ENGINE_API endpoints + env keys correct', () => {
  assert.equal(ENGINE_API.chatgpt.url, 'https://api.openai.com/v1/responses');
  assert.equal(ENGINE_API.perplexity.url, 'https://api.perplexity.ai/chat/completions');
  assert.equal(ENGINE_API.claude.envKey, 'ANTHROPIC_API_KEY');
});

test('runCitationPanel: honest denominator (validRuns) excludes no-search runs (C3)', async () => {
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url.includes('openai')) {
      const userMsg = body.input.find((m) => m.role === 'user').content;
      const cited = userMsg.includes('추천'); // mock cites only on recommendation-shaped prompts; others return NO citations
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
  assert.ok(cg.attempts >= 3);
  assert.ok(cg.inconclusiveRuns >= 1, 'a no-citation run is inconclusive, not counted as not-cited');
  assert.ok(cg.validRuns < cg.attempts, 'validRuns excludes the inconclusive run');
  assert.ok(cg.citedRuns >= 1, 'chatgpt cites on 추천 prompts');
  assert.equal(cg.cited, true);
  assert.equal(cg.measured, true);
  assert.ok(cg.evidence.some((ev) => ev.matchedUrls && ev.matchedUrls.length));
  // perplexity searched (returned a result) but cited a competitor → measured, not cited
  assert.equal(px.cited, false);
  assert.equal(px.measured, true);
  assert.ok(px.validRuns >= 1);
});

test('runCitationPanel: customPrompts string array → {system,user} conversion, only those queries sent', async () => {
  const sentUserMsgs = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes('openai')) {
      const body = JSON.parse(opts.body);
      const userMsg = body.input?.find((m) => m.role === 'user')?.content;
      if (userMsg) sentUserMsgs.push(userMsg);
      return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', annotations: [] }] }] }) };
    }
    return { ok: false, status: 404 };
  };
  const customQ = ['강남 임플란트 치과 추천해줘', '강남역 근처 치과 아무데나 가도 돼?'];
  await runCitationPanel({ clinicDomain: 'x.co.kr', region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, customPrompts: customQ, nowIso: 't', fetchImpl });
  assert.ok(sentUserMsgs.includes('강남 임플란트 치과 추천해줘'), 'customPrompts[0] must be sent as user message');
  assert.ok(sentUserMsgs.includes('강남역 근처 치과 아무데나 가도 돼?'), 'customPrompts[1] must be sent');
  // ensure only 2 queries sent (not 3 from buildPrompts)
  assert.equal(sentUserMsgs.length, 2, 'exactly customPrompts.length calls, not buildPrompts default 3');
});

test('runCitationPanel: customPrompts=[] falls back to buildPrompts (3 default queries)', async () => {
  const sentUserMsgs = [];
  const fetchImpl = async (url, opts) => {
    if (url.includes('openai')) {
      const body = JSON.parse(opts.body);
      const userMsg = body.input?.find((m) => m.role === 'user')?.content;
      if (userMsg) sentUserMsgs.push(userMsg);
      return { ok: true, json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', annotations: [] }] }] }) };
    }
    return { ok: false, status: 404 };
  };
  await runCitationPanel({ clinicDomain: 'x.co.kr', region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, customPrompts: [], nowIso: 't', fetchImpl });
  assert.equal(sentUserMsgs.length, 3, 'empty customPrompts must fall back to buildPrompts 3 queries');
});

test('runCitationPanel: all-error engine is measured:false + unmeasurable (C1, no fake 0/N)', async () => {
  const fetchImpl = async (url) => (url.includes('openai') ? { ok: false, status: 500 } : { ok: true, json: async () => ({ output: [] }) });
  const r = await runCitationPanel({ clinicDomain: 'x.co.kr', keys: { chatgpt: 'k' }, nowIso: 't', fetchImpl });
  assert.equal(r.perEngine.length, 1);
  assert.equal(r.perEngine[0].engine, 'chatgpt');
  assert.equal(r.perEngine[0].cited, false);
  assert.equal(r.perEngine[0].measured, false, 'all calls failed → NOT measured');
  assert.equal(r.perEngine[0].unmeasurable, 'engine-error');
  assert.equal(r.perEngine[0].validRuns, 0);
  assert.ok(r.perEngine[0].erroredRuns >= 1);
  assert.ok(r.perEngine[0].evidence.some((e) => e.error));
});
