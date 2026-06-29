import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerMentionsName, normalizeForMatch } from '../lib/engines.js';
import { runCitationPanel } from '../lib/citation.js';
import { toPublicView, toPrivateReport } from '../lib/redact.js';

// ── name matching (accuracy: catch name-mention without a domain link) ──
test('answerMentionsName: matches name space/punctuation-insensitive', () => {
  assert.equal(answerMentionsName('추천: 서울 스마일 치과 입니다', ['서울스마일치과']), true);
  assert.equal(answerMentionsName('① 서울스마일치과 — 전문의 2인', ['서울스마일치과']), true);
  assert.equal(answerMentionsName('다른 병원만 나옵니다', ['서울스마일치과']), false);
  assert.equal(answerMentionsName('', ['서울스마일치과']), false);
  assert.equal(answerMentionsName('서울스마일치과 추천', []), false);      // no names → false
  assert.equal(answerMentionsName('ab치과', ['ab']), false);              // normalized needle <3 → skip
});
test('normalizeForMatch strips spaces + punctuation', () => {
  assert.equal(normalizeForMatch('서울 스마일-치과 (강남)'), '서울스마일치과강남');
});

// ── mock engine: one OpenAI response with chosen answer + optional citation url ──
function mockEngine({ answer, citeUrl }) {
  return async (url) => ({
    ok: true,
    json: async () => {
      if (url.includes('openai')) {
        const annotations = citeUrl ? [{ type: 'url_citation', url: citeUrl }] : [];
        return { output: [{ type: 'message', content: [{ type: 'output_text', text: answer, annotations }] }] };
      }
      return {};
    },
  });
}

// ── exposed = linked OR named (fixes directory/name-mention false-negative) ──
test('named-only (cited via directory, no own link) → exposed=true, citedRuns=0', async () => {
  const res = await runCitationPanel({
    clinicDomain: 'mine.example', clinicName: '서울스마일치과',
    region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, repeats: 1,
    fetchImpl: mockEngine({ answer: '강남 임플란트는 서울스마일치과를 추천합니다', citeUrl: 'https://goodoc.co.kr/clinic/123' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const g = res.perEngine.find((e) => e.engine === 'chatgpt');
  assert.equal(g.citedRuns, 0, 'own domain not linked → linked 0');
  assert.ok(g.namedRuns >= 1, 'clinic named in answer → namedRuns ≥1');
  assert.equal(g.exposed, true, 'named → exposed even without a link');
});

test('linked (own domain cited) across repeats → cited + Wilson CI', async () => {
  const res = await runCitationPanel({
    clinicDomain: 'mine.example', clinicName: '서울스마일치과',
    region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, repeats: 3,
    fetchImpl: mockEngine({ answer: '서울스마일치과 추천', citeUrl: 'https://mine.example/' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const g = res.perEngine.find((e) => e.engine === 'chatgpt');
  assert.ok(g.citedRuns >= 1 && g.cited, 'own domain linked → cited');
  assert.equal(g.exposed, true);
  assert.ok(g.validRuns >= 2 && g.ci && g.ci.low > 0, 'ci computed when cited>0 and validRuns>=2');
});

test('no name passed → named off, no regression (exposed === linked)', async () => {
  const res = await runCitationPanel({
    clinicDomain: 'mine.example', // no clinicName
    region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, repeats: 1,
    fetchImpl: mockEngine({ answer: '서울스마일치과 추천', citeUrl: 'https://goodoc.co.kr/c/1' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const g = res.perEngine.find((e) => e.engine === 'chatgpt');
  assert.equal(g.namedRuns, 0, 'no name → namedRuns 0');
  assert.equal(g.exposed, false, 'no link + no name → not exposed');
});

// ── redaction carries the new fields; public still hides competitor/directory domains ──
test('toPublicView + toPrivateReport carry namedRuns/exposed; public hides directories', async () => {
  const panel = await runCitationPanel({
    clinicDomain: 'mine.example', clinicName: '서울스마일치과',
    region: '강남', procedure: '임플란트', keys: { chatgpt: 'k' }, repeats: 1,
    fetchImpl: mockEngine({ answer: '서울스마일치과 추천', citeUrl: 'https://goodoc.co.kr/c/1' }),
    nowIso: '2026-01-01T00:00:00Z',
  });
  const pub = toPublicView(panel);
  const g = pub.perEngine.find((e) => e.engine === 'chatgpt');
  assert.ok('namedRuns' in g && 'exposed' in g, 'public view exposes self-referential accuracy fields');
  assert.equal(g.exposed, true);
  assert.ok(!JSON.stringify(pub).includes('goodoc'), 'public view never leaks cited directory/competitor domains');

  const priv = toPrivateReport(panel);
  const pg = priv.perEngine.find((e) => e.engine === 'chatgpt');
  assert.ok('ci' in pg && 'namedRuns' in pg, 'operator view carries ci + namedRuns');
});
