// 구조 점수(scorer.js) × 실제 인용 실측(citation.js)을 잇는 진단기.
//
// 왜 필요한가: 두 지표는 지금까지 따로 놀았다. 원장님이 가장 많이 하는 질문
// "점수는 높은데 왜 AI에 안 나오나요?"에 답하려면 둘을 함께 봐야 한다.
// 구조 점수는 인용의 필요조건이지 충분조건이 아니다(방법론 문서와 동일한 입장).
//
// 원칙:
//  1. 측정되지 않은 것을 '미인용'이라고 말하지 않는다. 분모가 0이면 '판정 보류'다.
//  2. 원인을 추측하지 않는다. 관측된 신호로 좁혀지는 것만 원인으로 제시한다.
//  3. 각 원인에 '확인 방법'을 붙인다. 원장님이 직접 검증할 수 있어야 한다.
//  4. 효과를 약속하지 않는다. 제안은 '무엇을 채우는 작업'까지만이다.

const PICK = (breakdown, key) => (breakdown || []).find((x) => x.key === key) || null;

export function diagnose({ scored = {}, panel = null } = {}) {
  const b = scored.breakdown || [];
  const crawl = PICK(b, 'crawl');
  const extract = PICK(b, 'extract');
  const citable = PICK(b, 'citable');
  const price = PICK(b, 'price');
  const fresh = PICK(b, 'fresh');

  const engines = (panel && panel.perEngine) || [];
  const measuredEngines = engines.filter((e) => e.measured);
  const citedEngines = measuredEngines.filter((e) => e.citedRuns > 0);
  const namedOnly = measuredEngines.filter((e) => e.citedRuns === 0 && e.namedRuns > 0);
  const totalValid = measuredEngines.reduce((a, e) => a + (e.validRuns || 0), 0);
  const totalCited = measuredEngines.reduce((a, e) => a + (e.citedRuns || 0), 0);

  const findings = [];
  const add = (f) => findings.push(f);

  // ── 0. 측정 자체가 안 된 경우 — 여기서 멈춘다. 없는 결과를 0으로 만들지 않는다.
  if (panel && measuredEngines.length === 0) {
    const why = engines.length === 0 ? 'no-key'
      : engines.every((e) => e.unmeasurable === 'no-search') ? 'no-search'
        : engines.some((e) => e.unmeasurable === 'engine-error') ? 'engine-error' : 'unknown';
    add({
      code: 'not-measured',
      severity: 'info',
      title: '이번 회차는 판정이 나오지 않았습니다',
      detail: why === 'no-search' ? '엔진이 이 회차에 웹 검색을 하지 않아 인용 여부를 관측할 수 없었습니다.'
        : why === 'engine-error' ? '엔진 호출 오류로 관측이 이뤄지지 않았습니다.'
          : '측정 가능한 엔진이 없었습니다.',
      check: '유효 회차 수를 먼저 확인하십시오. 0이면 미인용이 아니라 미측정입니다.',
      action: '반복 측정으로 유효 회차를 확보한 뒤 판정합니다.',
    });
    return finish(scored, findings, { measured: false, exposed: null });
  }

  // ── 1. 필요조건 실패 — 구조가 막혀 있으면 다른 원인을 따질 필요가 없다.
  if (crawl && crawl.status === 'fail') {
    add({
      code: 'crawl-blocked',
      severity: 'high',
      title: 'AI 인용 경로가 robots.txt로 막혀 있습니다',
      detail: crawl.note,
      check: '주소창에 도메인/robots.txt 를 넣어 Disallow 대상을 직접 확인하실 수 있습니다.',
      action: 'robots.txt에서 인용 경로 봇 차단을 해제합니다. 이 항목이 해결되기 전에는 다른 작업의 효과를 관측할 수 없습니다.',
      blocking: true,
    });
  }
  if (scored.needsHeadless || (extract && extract.status === 'fail')) {
    add({
      code: 'js-rendered',
      severity: 'high',
      title: '본문이 자바스크립트로만 그려져 크롤러가 읽지 못합니다',
      detail: extract ? extract.note : 'JS 렌더 필요',
      check: '브라우저에서 페이지 소스 보기를 열어, 눈에 보이는 본문 글자가 HTML에 실제로 있는지 확인하십시오.',
      action: '홈페이지를 갈아엎지 않고, 서버에서 바로 읽히는 진료 설명 페이지를 별도로 얹는 방식으로 해결합니다.',
      blocking: true,
    });
  }

  const blocked = findings.some((f) => f.blocking);

  // ── 2. 실측 결과별 해석
  if (panel && !blocked) {
    if (namedOnly.length && citedEngines.length === 0) {
      add({
        code: 'named-not-linked',
        severity: 'medium',
        title: '이름은 언급되는데 홈페이지가 출처로 걸리지 않습니다',
        detail: `${namedOnly.map((e) => e.engine).join('·')}에서 병원명은 답변에 나왔지만 인용 링크는 다른 도메인이었습니다.`,
        check: '답변에 실제로 걸린 출처 도메인 목록을 보십시오. 디렉터리·플랫폼이 대신 인용되고 있는지 확인됩니다.',
        action: '홈페이지 손질이 아니라, 외부에 병원명·지역·진료 조합의 언급을 쌓는 작업으로 풉니다.',
      });
    }
    // 질의별 편차 — 평균 하나로는 안 보이는 것
    for (const e of measuredEngines) {
      const d = e.distribution;
      if (!d || d.promptsScored < 2) continue;
      if (d.alwaysCited > 0 && d.neverCited > 0) {
        const never = (e.perPrompt || []).filter((p) => p.valid > 0 && p.rate === 0).map((p) => p.prompt);
        add({
          code: 'prompt-gap',
          severity: 'medium',
          title: `${e.engine}: 질문에 따라 결과가 갈립니다`,
          detail: `측정한 ${d.promptsScored}개 질의 중 ${d.alwaysCited}개는 항상 인용됐고 ${d.neverCited}개는 한 번도 인용되지 않았습니다.`,
          check: `인용되지 않은 질의: ${never.slice(0, 3).map((q) => `"${q}"`).join(', ')}`,
          action: '인용되지 않은 질의의 주제를 다루는 페이지가 있는지 먼저 확인합니다. 없으면 그 주제가 비어 있는 것입니다.',
        });
      }
    }
  }

  // ── 3. 구조는 갖췄는데 노출이 없는 경우 — 원장님이 가장 많이 묻는 상황
  const exposed = panel ? measuredEngines.some((e) => e.exposed) : null;
  if (panel && !blocked && measuredEngines.length > 0 && !exposed) {
    if ((scored.score || 0) >= 70) {
      add({
        code: 'structure-ok-not-exposed',
        severity: 'medium',
        title: '읽히는 조건은 갖췄지만 이번 측정에서는 답변에 나오지 않았습니다',
        detail: `구조 점수 ${scored.score}점으로 기술 요건은 통과했습니다. 즉 막혀서 못 나온 것이 아니라, 같은 질문에 대해 다른 곳이 선택되고 있는 상태입니다.`,
        check: '경쟁 상황이므로 우리 페이지만 봐서는 알 수 없습니다. 실제로 인용된 도메인이 무엇인지 함께 보십시오.',
        action: '구조가 아니라 근거의 양을 늘리는 단계입니다. 아래 비어 있는 항목부터 채웁니다.',
      });
    }
  }

  // ── 4. 채울 수 있는 빈칸 — 실측 결과와 무관하게 항상 유효한 실행 항목
  if (citable && citable.points === 0) {
    add({
      code: 'no-citable-evidence',
      severity: 'high',
      title: '인용할 근거 문단이 없습니다',
      detail: citable.note,
      check: '본문에 출처 링크·전문가 인용구·수치가 하나라도 있는지 보십시오.',
      action: '진료 설명에 근거 출처와 수치를 병기합니다. 실측 상위 3기법에 해당하는 항목입니다.',
    });
  }
  if (price && price.points === 0) {
    add({
      code: 'no-price',
      severity: 'medium',
      title: '비급여 진료비 안내가 없습니다',
      detail: price.note,
      check: '주요 비급여 항목과 금액이 같은 표에 있는지 확인하십시오.',
      action: '가격표를 게시합니다. 의료법상 고지 의무 항목이기도 해 우선순위가 높습니다.',
    });
  }
  if (fresh && fresh.points === 0) {
    add({
      code: 'no-date',
      severity: 'medium',
      title: '게시일·수정일이 노출되지 않습니다',
      detail: fresh.note,
      check: '콘텐츠에 날짜가 표시되는지 확인하십시오.',
      action: '게시일·수정일을 노출합니다. 날짜가 없는 페이지가 걸러진다는 통제 실험 결과가 있습니다.',
    });
  }

  return finish(scored, findings, {
    measured: panel ? measuredEngines.length > 0 : null,
    exposed,
    validRuns: totalValid,
    citedRuns: totalCited,
  });
}

function finish(scored, findings, meta) {
  const order = { high: 0, medium: 1, info: 2 };
  findings.sort((a, c) => (order[a.severity] ?? 3) - (order[c.severity] ?? 3));
  // 한 줄 요약 — 리포트 최상단에 그대로 쓸 수 있는 문장.
  let headline;
  if (meta.measured === false) headline = '이번 회차는 판정이 나오지 않았습니다(미측정). 미인용과 다릅니다.';
  else if (findings.some((f) => f.blocking)) headline = '먼저 해결해야 할 필요조건이 막혀 있습니다. 이 상태에서는 다른 작업의 효과를 관측할 수 없습니다.';
  else if (meta.exposed === true) headline = '이번 측정에서 답변에 노출됐습니다. 아래는 노출 폭을 넓히기 위해 비어 있는 항목입니다.';
  else if (meta.exposed === false) headline = '읽히는 조건은 확인됐지만 이번 측정에서는 답변에 나오지 않았습니다.';
  else headline = '구조 진단 기준의 결과입니다. 실제 인용 여부는 별도 실측으로 확인합니다.';

  return {
    headline,
    findings,
    structureScore: scored.score ?? null,
    band: scored.band ?? null,
    ...meta,
    disclaimer: '구조 점수는 인용의 필요조건이며 노출을 예측하지 않습니다. 실측은 측정 시점·질의 기준의 관측입니다.',
  };
}
