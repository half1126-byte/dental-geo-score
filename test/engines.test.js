import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENGINES, AUTO_ENGINES, buildPrompts, extractCitedUrls, isClinicCited } from '../lib/engines.js';
import { CHECKLISTS, GBP_CHECKLIST, PLACE_CHECKLIST } from '../lib/checklists.js';

test('engine config: 5 engines, correct measure modes', () => {
  assert.deepEqual(Object.keys(ENGINES).sort(), ['chatgpt', 'claude', 'gemini', 'naver', 'perplexity']);
  assert.deepEqual(AUTO_ENGINES.sort(), ['chatgpt', 'claude', 'perplexity']);
  assert.equal(ENGINES.gemini.measureMode, 'checklist');
  assert.equal(ENGINES.naver.measureMode, 'checklist');
  assert.ok(ENGINES.gemini.measureBlockedReason.includes('ToS') || ENGINES.gemini.measureBlockedReason.includes('약관'));
});

test('buildPrompts produces patient-shaped variants with district+procedure', () => {
  const ps = buildPrompts({ district: '강남', procedure: '임플란트' });
  assert.equal(ps.length, 4);
  assert.ok(ps[0].user.includes('강남') && ps[0].user.includes('임플란트'));
  assert.ok(ps.every((p) => p.system.includes('강남')));
});

test('extractCitedUrls — ChatGPT (annotations url_citation)', () => {
  const resp = { output: [
    { type: 'web_search_call', action: { type: 'search' } },
    { type: 'message', content: [{ type: 'output_text', annotations: [
      { type: 'url_citation', url: 'https://www.haruplant.co.kr/implant' },
      { type: 'url_citation', url: 'https://other.co.kr/x' },
    ] }] },
  ] };
  assert.deepEqual(extractCitedUrls('chatgpt', resp), ['https://www.haruplant.co.kr/implant', 'https://other.co.kr/x']);
});

test('extractCitedUrls — Claude (web_search_result_location)', () => {
  const resp = { content: [{ type: 'text', citations: [{ type: 'web_search_result_location', url: 'https://haruplant.co.kr/a', title: 't' }] }] };
  assert.deepEqual(extractCitedUrls('claude', resp), ['https://haruplant.co.kr/a']);
});

test('extractCitedUrls — Perplexity (search_results.url + citations[])', () => {
  const resp = { search_results: [{ url: 'https://haruplant.co.kr', source: 'web' }], citations: ['https://news.x/y'] };
  assert.deepEqual(extractCitedUrls('perplexity', resp), ['https://haruplant.co.kr', 'https://news.x/y']);
});

test('extractCitedUrls — Gemini (groundingChunks maps/web uri)', () => {
  const resp = { candidates: [{ groundingMetadata: { groundingChunks: [
    { maps: { uri: 'https://maps.google.com/place/abc' } },
    { web: { uri: 'https://haruplant.co.kr' } },
  ] } }] };
  assert.deepEqual(extractCitedUrls('gemini', resp), ['https://maps.google.com/place/abc', 'https://haruplant.co.kr']);
});

test('isClinicCited — domain match across www/path; empty != not-cited', () => {
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text', annotations: [
    { type: 'url_citation', url: 'https://www.haruplant.co.kr/implant' },
  ] }] }] };
  const hit = isClinicCited('chatgpt', resp, 'haruplant.co.kr');
  assert.equal(hit.cited, true);
  assert.equal(hit.matchedUrls.length, 1);

  const miss = isClinicCited('chatgpt', { output: [] }, 'haruplant.co.kr');
  assert.equal(miss.cited, false);
  assert.equal(miss.measuredCitations, false, 'no citations this run != not cited');
});

test('malformed response never throws', () => {
  assert.deepEqual(extractCitedUrls('chatgpt', null), []);
  assert.deepEqual(extractCitedUrls('perplexity', { search_results: 'bad' }), []);
});

test('allCitedDomains uses eTLD+1 (consistent with isClinicCited match logic)', () => {
  // www.example.co.kr and example.co.kr/page should collapse to the same registrable domain
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text', annotations: [
    { type: 'url_citation', url: 'https://www.haruplant.co.kr/implant' },
    { type: 'url_citation', url: 'https://haruplant.co.kr/' },
    { type: 'url_citation', url: 'https://other-clinic.co.kr/about' },
  ] }] }] };
  const result = isClinicCited('chatgpt', resp, 'haruplant.co.kr');
  // haruplant.co.kr appears twice but deduped to one registrable domain
  assert.equal(result.allCitedDomains.filter((d) => d === 'haruplant.co.kr').length, 1,
    'www.haruplant.co.kr and haruplant.co.kr should collapse to single eTLD+1 entry');
  assert.equal(result.allCitedDomains.length, 2, 'haruplant.co.kr + other-clinic.co.kr = 2 distinct domains');
});

// ── mentionPosition (AutoGEO ICLR 2026) ──────────────────────────────────────

test('mentionPosition: top when domain in first third of answer', () => {
  const domain = 'haruplant.co.kr';
  // domain near start → 'top'
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text',
    text: `haruplant.co.kr 은 강남 최고의 치과입니다. ${' 일반적인 텍스트 '.repeat(50)}`,
    annotations: [{ type: 'url_citation', url: 'https://haruplant.co.kr/' }],
  }] }] };
  const r = isClinicCited('chatgpt', resp, domain);
  assert.equal(r.mentionPosition, 'top');
});

test('mentionPosition: tail when domain in last third of answer', () => {
  const domain = 'haruplant.co.kr';
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text',
    text: `${'일반적인 텍스트 '.repeat(50)} haruplant.co.kr 참조`,
    annotations: [{ type: 'url_citation', url: 'https://haruplant.co.kr/' }],
  }] }] };
  const r = isClinicCited('chatgpt', resp, domain);
  assert.equal(r.mentionPosition, 'tail');
});

test('mentionPosition: null when domain not in answer text', () => {
  const resp = { output: [{ type: 'message', content: [{ type: 'output_text',
    text: '서울 강남 치과 추천입니다.',
    annotations: [],
  }] }] };
  const r = isClinicCited('chatgpt', resp, 'haruplant.co.kr');
  assert.equal(r.mentionPosition, null);
});

test('mentionPosition: null when response is empty (no measurement)', () => {
  const r = isClinicCited('chatgpt', { output: [] }, 'haruplant.co.kr');
  assert.equal(r.mentionPosition, null);
  assert.equal(r.cited, false);
});

test('checklists: GBP + Place present with required fields', () => {
  assert.equal(CHECKLISTS.length, 2);
  for (const cl of [GBP_CHECKLIST, PLACE_CHECKLIST]) {
    assert.ok(cl.items.length >= 5);
    assert.ok(cl.items.every((i) => i.id && i.label && i.weight));
  }
  assert.equal(GBP_CHECKLIST.engine, 'gemini');
  assert.equal(PLACE_CHECKLIST.engine, 'naver');
});
