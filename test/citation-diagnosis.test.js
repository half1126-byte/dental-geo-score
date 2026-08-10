// 구조 점수 × 실측 인용을 잇는 경로의 통합 테스트.
// "점수는 높은데 왜 AI에 안 나오나요?"가 실제로 코드에서 답이 나오는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCitationPanel } from '../lib/citation.js';
import { diagnose } from '../lib/diagnose.js';
import { scorePage } from '../lib/scorer.js';
import { buildDiagnosisByRegion } from '../api/citation.js';

const ROBOTS_OK = { present: true, blocksAny: false, blockedBots: [] };
const STRONG = {
  h1Count: 1, h2Count: 5, questionH2: 2, tables: 2, faqBlocks: 2,
  credentials: 6, social: 3, dateSignals: 3, phone: true, address: true,
  sn: 0.1, scripts: 5, jsonld: { hasDental: true, hasFaq: true, hasTrust: true },
  hasSameAsAuthority: true, hasCitedSources: true, hasQuotations: true, statCount: 2, priceBand: 2,
};

// 엔진 목: citedDomain이 응답에 실리면 '인용됨'으로 판정된다.
const mockEngine = ({ citeDomain = null, mentionName = null, noSearch = false } = {}) =>
  async () => ({
    ok: true,
    json: async () => ({
      output: [{
        type: 'message',
        content: [{
          type: 'output_text',
          text: mentionName ? `${mentionName}를 추천합니다.` : '여러 곳을 추천합니다.',
          annotations: noSearch ? [] : [{ type: 'url_citation', url: `https://${citeDomain || 'other.co.kr'}/x` }],
        }],
      }],
    }),
  });

const panelWith = (opts, extra = {}) => runCitationPanel({
  clinicDomain: 'test-clinic.co.kr', clinicName: '테스트치과', region: '강남',
  keys: { chatgpt: 'k' }, repeats: 2, fetchImpl: mockEngine(opts),
  customPrompts: ['강남 임플란트 치과 추천'], ...extra,
});

test('통합: 구조 만점 + 실측 미인용 → 경쟁 상황으로 설명한다', async () => {
  const panel = await panelWith({ citeDomain: 'competitor.co.kr' });
  const scored = scorePage({ robots: ROBOTS_OK, signals: STRONG });
  const d = diagnose({ scored, panel });

  assert.equal(d.measured, true, '유효 관측이 있어야 한다');
  assert.equal(d.exposed, false);
  const f = d.findings.find((x) => x.code === 'structure-ok-not-exposed');
  assert.ok(f, '이 조합이 바로 원장님 질문의 상황이다');
  assert.ok(/다른 곳이 선택되고 있는/.test(f.detail));
});

test('통합: 인용되면 노출로 잡히고 경쟁 원인을 붙이지 않는다', async () => {
  const panel = await panelWith({ citeDomain: 'test-clinic.co.kr' });
  const d = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: STRONG }), panel });
  assert.equal(d.exposed, true);
  assert.ok(!d.findings.some((x) => x.code === 'structure-ok-not-exposed'));
  assert.ok(/노출됐습니다/.test(d.headline));
});

test('통합: 이름만 언급되고 링크는 남의 도메인 → named-not-linked', async () => {
  const panel = await panelWith({ citeDomain: 'directory.co.kr', mentionName: '테스트치과' });
  const d = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: STRONG }), panel });
  assert.ok(d.findings.some((x) => x.code === 'named-not-linked'));
});

test('통합: 엔진이 검색을 안 한 회차는 미인용이 아니라 미측정이다', async () => {
  const panel = await panelWith({ noSearch: true });
  const e = panel.perEngine[0];
  assert.equal(e.validRuns, 0, '분모에서 빠져야 한다');
  assert.ok(e.inconclusiveRuns > 0);
  const d = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: STRONG }), panel });
  assert.equal(d.measured, false);
  assert.ok(/미측정/.test(d.headline));
  assert.deepEqual(d.findings.map((f) => f.code), ['not-measured'], '판정 보류 시 원인을 추측하지 않는다');
});

test('통합: 질의별 분포가 진단으로 이어진다', async () => {
  // 임플란트 질의만 인용되도록 — 교정 질의는 다른 도메인이 인용됨
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const q = (body.input || []).map((m) => m.content).join(' ');
    const hit = /임플란트/.test(q);
    return {
      ok: true,
      json: async () => ({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok',
          annotations: [{ type: 'url_citation', url: hit ? 'https://test-clinic.co.kr/a' : 'https://other.co.kr/b' }] }] }],
      }),
    };
  };
  const panel = await runCitationPanel({
    clinicDomain: 'test-clinic.co.kr', clinicName: '테스트치과', region: '강남',
    keys: { chatgpt: 'k' }, repeats: 2, fetchImpl,
    customPrompts: ['강남 임플란트 치과 추천', '강남 교정 치과 추천'],
  });
  const e = panel.perEngine[0];
  assert.equal(e.hitRate, 0.5, '평균은 절반');
  assert.equal(e.distribution.alwaysCited, 1);
  assert.equal(e.distribution.neverCited, 1);

  const d = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: STRONG }), panel });
  const gap = d.findings.find((x) => x.code === 'prompt-gap');
  assert.ok(gap, '평균 뒤에 숨은 편차를 보고해야 한다');
  assert.ok(gap.check.includes('교정'), '인용 안 된 질의를 그대로 보여준다');
});

test('multi-region: 구조는 공유하고 지역별로 진단이 갈린다', async () => {
  const hit = await panelWith({ citeDomain: 'test-clinic.co.kr' });
  const miss = await panelWith({ citeDomain: 'competitor.co.kr' });
  const structure = scorePage({ robots: ROBOTS_OK, signals: STRONG });
  const out = buildDiagnosisByRegion(structure, { 강남: hit, 분당: miss }, ['강남', '분당']);
  assert.equal(out['강남'].exposed, true);
  assert.equal(out['분당'].exposed, false);
  assert.ok(out['분당'].findings.some((f) => f.code === 'structure-ok-not-exposed'));
});

test('multi-region: 패널이 실패한 지역은 null이고 응답을 깨지 않는다', () => {
  const out = buildDiagnosisByRegion({}, { 강남: { error: 'boom' } }, ['강남', '없는지역']);
  assert.equal(out['강남'], null);
  assert.equal(out['없는지역'], null);
});

test('공개 노출 안전성: 진단 결과에 경쟁사 도메인이 섞이지 않는다', async () => {
  const panel = await panelWith({ citeDomain: 'competitor-clinic.co.kr' });
  const d = diagnose({ scored: scorePage({ robots: ROBOTS_OK, signals: STRONG }), panel });
  assert.ok(!JSON.stringify(d).includes('competitor-clinic'), '경쟁사 식별정보는 공개 뷰로 새면 안 된다(의료광고법)');
});

// ── 공개 뷰 노출 범위 ────────────────────────────────────────────────────────
import { toPublicView } from '../lib/redact.js';

test('공개 뷰: 분포는 나가고 경쟁사 식별정보는 나가지 않는다', async () => {
  const panel = await panelWith({ citeDomain: 'competitor-clinic.co.kr' });
  const pub = toPublicView(panel);
  const e = pub.perEngine[0];
  assert.ok(e.perPrompt.length > 0, '질의별 분포가 공개돼야 검증이 가능하다');
  assert.ok('distribution' in e);
  const json = JSON.stringify(pub);
  assert.ok(!json.includes('competitor-clinic'), '인용된 경쟁 도메인은 공개 뷰에서 제외');
  assert.ok(!json.includes('matchedUrls'), '매칭 URL은 operator 전용');
  assert.ok(!json.includes('sampleAnswers'), '원문 답변은 operator 전용');
});

test('공개 뷰: 인용 0건이면 신뢰구간을 만들지 않는다 (의료광고법)', async () => {
  const panel = await panelWith({ citeDomain: 'competitor-clinic.co.kr' });
  const e = toPublicView(panel).perEngine[0];
  assert.equal(e.citedRuns, 0);
  assert.equal(e.ci, null, '0건 옆의 상한값은 효과 암시로 읽힌다');
});
