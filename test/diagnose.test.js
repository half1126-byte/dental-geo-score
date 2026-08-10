import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose } from '../lib/diagnose.js';
import { scorePage } from '../lib/scorer.js';

const ROBOTS_OK = { present: true, blocksAny: false, blockedBots: [] };
const ROBOTS_BLOCKED = { present: true, blocksAny: true, blockedBots: ['OAI-SearchBot'], blockedCitation: ['OAI-SearchBot'], note: '인용 경로 봇 차단: OAI-SearchBot' };
const RICH = {
  h1Count: 1, h2Count: 5, questionH2: 2, tables: 2, faqBlocks: 2,
  credentials: 6, social: 3, dateSignals: 3, phone: true, address: true,
  sn: 0.1, scripts: 5, jsonld: { hasDental: true, hasFaq: true, hasTrust: true },
  hasSameAsAuthority: true, hasCitedSources: true, hasQuotations: true, statCount: 2, priceBand: 2,
};
const eng = (o) => ({
  engine: 'chatgpt', attempts: 3, validRuns: 3, citedRuns: 0, namedRuns: 0,
  erroredRuns: 0, inconclusiveRuns: 0, measured: true, exposed: false,
  unmeasurable: null, distribution: null, perPrompt: [], ...o,
});
const codes = (r) => r.findings.map((f) => f.code);

test('미측정: 유효 회차 0이면 미인용이라고 말하지 않는다', () => {
  const scored = scorePage({ robots: ROBOTS_OK, signals: RICH });
  const r = diagnose({
    scored,
    panel: { perEngine: [eng({ validRuns: 0, inconclusiveRuns: 3, measured: false, unmeasurable: 'no-search' })] },
  });
  assert.equal(r.measured, false);
  assert.ok(codes(r).includes('not-measured'));
  assert.ok(/미측정/.test(r.headline), '헤드라인이 미측정임을 밝혀야 한다');
  assert.equal(codes(r).length, 1, '판정 보류 시 다른 원인을 추측하지 않는다');
});

test('필요조건 실패: 크롤러 차단은 blocking으로 표시되고 최상단에 온다', () => {
  const scored = scorePage({ robots: ROBOTS_BLOCKED, signals: RICH });
  const r = diagnose({ scored, panel: { perEngine: [eng({})] } });
  assert.equal(r.findings[0].code, 'crawl-blocked');
  assert.equal(r.findings[0].blocking, true);
  assert.ok(/필요조건/.test(r.headline));
});

test('필요조건 실패: JS 렌더도 blocking이다', () => {
  const scored = scorePage({ robots: ROBOTS_OK, signals: { ...RICH, needsHeadless: true, sn: 0.001, scripts: 80 } });
  const r = diagnose({ scored, panel: { perEngine: [eng({})] } });
  assert.ok(codes(r).includes('js-rendered'));
  assert.ok(r.findings.some((f) => f.blocking));
});

test('이름만 언급되고 링크가 안 걸린 경우를 구분한다', () => {
  const scored = scorePage({ robots: ROBOTS_OK, signals: RICH });
  const r = diagnose({
    scored,
    panel: { perEngine: [eng({ citedRuns: 0, namedRuns: 2, exposed: true })] },
  });
  assert.ok(codes(r).includes('named-not-linked'));
  const f = r.findings.find((x) => x.code === 'named-not-linked');
  assert.ok(/외부에/.test(f.action), '홈페이지가 아니라 외부 언급 작업으로 안내해야 한다');
});

test('질의별 편차: 항상 인용/전혀 인용 안 됨이 공존하면 짚어준다', () => {
  const scored = scorePage({ robots: ROBOTS_OK, signals: RICH });
  const r = diagnose({
    scored,
    panel: {
      perEngine: [eng({
        citedRuns: 2, exposed: true,
        distribution: { promptsScored: 2, alwaysCited: 1, neverCited: 1, sometimesCited: 0, spread: 1, repeatsPerPrompt: 2 },
        perPrompt: [
          { prompt: '강남 임플란트 치과', valid: 2, cited: 2, rate: 1 },
          { prompt: '강남 교정 치과', valid: 2, cited: 0, rate: 0 },
        ],
      })],
    },
  });
  const f = r.findings.find((x) => x.code === 'prompt-gap');
  assert.ok(f, '편차를 보고해야 한다');
  assert.ok(f.check.includes('강남 교정 치과'), '인용 안 된 질의를 그대로 보여줘야 한다');
});

test('핵심 상황: 구조는 갖췄는데 노출이 없으면 경쟁 문제로 설명한다', () => {
  const scored = scorePage({ robots: ROBOTS_OK, signals: RICH });
  assert.ok(scored.score >= 70, `전제: 구조 점수가 높아야 한다 (${scored.score})`);
  const r = diagnose({ scored, panel: { perEngine: [eng({ citedRuns: 0, namedRuns: 0, exposed: false })] } });
  const f = r.findings.find((x) => x.code === 'structure-ok-not-exposed');
  assert.ok(f, '이 상황을 별도 원인으로 설명해야 한다');
  assert.ok(/막혀서 못 나온 것이 아니라/.test(f.detail));
  assert.equal(r.exposed, false);
});

test('빈칸 항목: 인용 근거·가격·날짜가 0이면 각각 실행 항목으로 나온다', () => {
  const bare = { h1Count: 1, phone: true, address: true, sn: 0.1, scripts: 5, jsonld: { hasDental: true } };
  const scored = scorePage({ robots: ROBOTS_OK, signals: bare });
  const r = diagnose({ scored, panel: null });
  const c = codes(r);
  assert.ok(c.includes('no-citable-evidence'));
  assert.ok(c.includes('no-price'));
  assert.ok(c.includes('no-date'));
});

test('심각도 순으로 정렬된다 (high → medium → info)', () => {
  const bare = { h1Count: 1, phone: true, address: true, sn: 0.1, scripts: 5, jsonld: { hasDental: true } };
  const r = diagnose({ scored: scorePage({ robots: ROBOTS_BLOCKED, signals: bare }), panel: null });
  const sev = r.findings.map((f) => f.severity);
  const rank = { high: 0, medium: 1, info: 2 };
  for (let i = 1; i < sev.length; i++) assert.ok(rank[sev[i - 1]] <= rank[sev[i]], '정렬 위반: ' + sev.join(','));
});

test('결과에 항상 비예측 고지가 붙는다', () => {
  const r = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: RICH }), panel: null });
  assert.ok(/노출을 예측하지 않습니다/.test(r.disclaimer));
});

test('효과를 약속하는 표현이 들어가지 않는다 (의료광고법)', () => {
  const BAN = ['보장', '100%', '최고', '1위', '최초', '유일', '완치', '무통'];
  const bare = { h1Count: 1, phone: true, address: true, sn: 0.1, scripts: 5, jsonld: { hasDental: true } };
  for (const panel of [null, { perEngine: [eng({})] }]) {
    const r = diagnose({ scored: scorePage({ robots: ROBOTS_BLOCKED, signals: bare }), panel });
    const text = JSON.stringify(r);
    for (const w of BAN) assert.ok(!text.includes(w), `금칙어 "${w}" 포함됨`);
  }
});
