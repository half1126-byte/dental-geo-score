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
  assert.equal(ps.length, 3);
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

test('checklists: GBP + Place present with required fields', () => {
  assert.equal(CHECKLISTS.length, 2);
  for (const cl of [GBP_CHECKLIST, PLACE_CHECKLIST]) {
    assert.ok(cl.items.length >= 5);
    assert.ok(cl.items.every((i) => i.id && i.label && i.weight));
  }
  assert.equal(GBP_CHECKLIST.engine, 'gemini');
  assert.equal(PLACE_CHECKLIST.engine, 'naver');
});
