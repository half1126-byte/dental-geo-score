// Heuristic GEO "준비도" score (0-100). DETERMINISTIC given the same parsed signals.
// v0.2: 두 진단 축으로 재편 — 축A "기술 준비도"(AI 크롤러가 읽을 수 있는가)
//        축B "콘텐츠 인용성"(인용할 가치가 있는가).
// v0.3: 인용 근거를 독립 항목(citable)으로 승격. 근거는 Aggarwal et al.,
//        "GEO: Generative Engine Optimization", KDD 2024 (arXiv:2311.09735).
//        해당 논문이 실측한 상위 3개 기법 = 출처 명시 / 전문가 인용구 / 통계 수치.
//        (특히 출처 명시는 검색 5위권 사이트에서 인용 +115.1%, 반대로 1위 사이트는 -30.3%.)
//        v0.2까지 이 3신호는 answer 항목 안에 합계 6점으로 묻혀 있어 리포트에 보이지 않았음.
//        재배분: schema 20→15, fresh 10→5, answer 20→15(구조 전용), citable 15 신설.
// 합산 score·band는 하위 호환을 위해 병행 유지.
// 이 점수는 AI 인용을 예측하지 않습니다 (자사 검증: 점수↔실제 인용 역상관 판명).
const METHODOLOGY_VERSION = 'v0.4';

export function scorePage({ robots = {}, signals = {} }) {
  const s = signals;
  const b = [];

  // ══════════════════════════════════════════════════════════
  // 축A: 기술 준비도 — AI 크롤러가 읽을 수 있는가 (max 50)
  // ══════════════════════════════════════════════════════════

  // A1. AI 크롤러 허용 (15) — 차단은 인용 후보 자체에서 제외되는 필요조건
  // v0.4: robots.js가 봇을 용도별로 분류한다. 감점은 '인용 경로 봇' 차단에만 적용하고,
  //       학습 전용 봇(GPTBot·CCBot·Google-Extended)만 막은 사이트는 감점하지 않는다.
  //       근거 경로(/blog 등)만 막힌 부분 차단은 경고로 다룬다.
  {
    let pts = 15, status = 'ok', note = 'AI 크롤러 차단 없음(허용)', fix = null;
    const blockedCitation = robots.blockedCitation || (robots.blocksAny ? robots.blockedBots || [] : []);
    const partial = robots.partialBlocks || [];
    if (robots.present && robots.blocksAny) {
      pts = 2; status = 'fail'; note = robots.note;
      fix = `robots.txt에서 ${blockedCitation.join(', ')} 차단 해제 — 이 봇들이 막히면 답변 출처에 실릴 수 없습니다`;
    } else if (robots.present && partial.length) {
      pts = 9; status = 'warn'; note = robots.note;
      fix = `robots.txt에서 ${partial.map((p) => p.paths.join(' ')).join(' ')} 경로 차단 해제 — 인용 근거가 실리는 위치입니다`;
    } else if (robots.present && (robots.blockedTraining || []).length) {
      // 학습봇 차단은 정당한 선택이다. 감점하지 않고 상태만 알린다.
      pts = 15; status = 'ok'; note = robots.note;
    } else if (!robots.present) {
      pts = 11; status = 'warn'; note = 'robots.txt 없음/판정불가 (암묵 허용이나 명시 권장)';
      fix = 'robots.txt를 두고 AI 크롤러(OAI-SearchBot·PerplexityBot 등) 허용을 명시';
    }
    b.push(item('crawl', 'AI 크롤러 허용', pts, 15, status, note, fix, 'AI 크롤러가 막히면 인용 자체가 불가능합니다.', 'SEO'));
  }

  // A2. 구조화 데이터 JSON-LD (15)
  // v0.4: FAQPage 배점을 정리했다. Google은 2026-05 FAQ 리치리절트 노출을 중단하고
  //       6월 관련 문서를 삭제했다(공식 변경 로그 확인). v0.3까지는 FAQPage 하나가
  //       hasFaq 5 + hasTrust 5 = 10점을 이중으로 받았고, 처방 문구도 "FAQPage를 마크업하라"였다.
  //       → 이중 계상을 없애고(TRUST에서 제외), FAQPage는 Q&A 쌍의 기계 판독용 보조 신호(3점)로 낮춘다.
  //       마크업 제거를 권하지는 않는다(Google은 미사용 구조화 데이터가 무해하다고 밝힘).
  {
    const j = s.jsonld || {};
    const sameAsAuthority = s.hasSameAsAuthority ?? j.hasSameAsAuthority;
    let pts = 0;
    if (j.hasDental) pts += 7;
    if (j.hasTrust) pts += 3;
    if (j.hasFaq) pts += 2;
    if (sameAsAuthority) pts += 2;
    pts = Math.min(10, pts);
    const status = pts >= 8 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = j.count ? `JSON-LD: ${(j.types || []).slice(0, 6).join(', ') || '있음'}` : 'JSON-LD 구조화 데이터 없음';
    const fix = !j.hasDental
      ? 'Dentist/MedicalClinic + LocalBusiness JSON-LD 추가(상호·주소·전화·진료)'
      : !j.hasTrust
        ? 'Person(의료진)·Organization·Article 스키마로 작성 주체를 명시'
        : !sameAsAuthority
          ? 'sameAs에 공식 채널·인증기관 링크를 연결해 같은 병원임을 교차 확인 가능하게'
          : null;
    b.push(item('schema', '구조화 데이터(JSON-LD)', pts, 10, status, note, fix, 'JSON-LD는 상호·진료·의료진을 AI가 기계적으로 읽게 해줍니다.', 'AEO'));
  }

  // A5. 비급여 진료비 안내 (5) [v0.4 신설]
  // 근거 ①: What Gets Cited (arXiv:2605.25517) — 25.2만회 통제 실험에서 '가격 미기재'가
  //         6개 모델 전원 일치로 확인된 인용 게이트키퍼 4요인 중 하나.
  // 근거 ②: 의료법상 비급여 진료비용 고지 의무 — AI 노출과 법적 의무가 겹치는 유일한 항목.
  {
    const band = s.priceBand != null ? s.priceBand : (s.hasPriceInfo ? 1 : 0);
    const pts = band >= 2 ? 5 : band >= 1 ? 3 : 0;
    const status = pts >= 5 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const detail = s.hasPriceTable ? '가격표 형태로 게시'
      : s.priceItemCount ? `진료 항목·금액 ${s.priceItemCount}건`
        : s.hasNonCoveredNotice ? '비급여 고지 문구만 있음(금액 미표기)'
          : '진료비 안내 없음';
    const fix = band >= 2 ? null
      : '주요 비급여 항목과 금액을 같은 표에 게시(의료법상 고지 의무 항목이기도 합니다)';
    b.push(item('price', '비급여 진료비 안내', pts, 5, status, detail, fix,
      '환자가 가장 많이 묻는 질문이고, 가격이 없는 페이지는 AI 답변에서 걸러진다는 통제 실험 결과가 있습니다.', 'AEO'));
  }

  // A3. 추출성 S/N (10) — 본문 가시 텍스트 비중 + 렌더 신호
  {
    let pts = 0;
    const sn = s.sn || 0;
    if (sn >= 0.06) pts += 6;
    else if (sn >= 0.02) pts += 3;
    if ((s.scripts || 0) <= 25) pts += 4;
    else if ((s.scripts || 0) <= 50) pts += 2;
    // needsHeadless: JS shell — AI 크롤러가 내용을 읽지 못할 가능성 높음 → 축A 치명 감점
    if (s.needsHeadless) pts = Math.min(pts, 2);
    pts = Math.min(10, pts);
    const status = pts >= 7 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const renderNote = s.needsHeadless ? ' · JS 렌더 필요(크롤러 가시성 제한)' : '';
    const note = `가시 텍스트 비율 ${(sn * 100).toFixed(1)}%, script ${s.scripts || 0}개${renderNote}`;
    const fix = pts < 7 ? '본문 텍스트 비중↑·불필요 스크립트/광고 정리(서버 렌더 권장)' : null;
    b.push(item('extract', '추출성(S/N)', pts, 10, status, note, fix, '본문 텍스트가 충분해야 AI가 추출·인용할 내용이 있습니다.', 'AEO'));
  }

  // A4. 엔티티·로컬 정합 (10)
  {
    let pts = 0;
    if (s.phone) pts += 4;
    if (s.address) pts += 4;
    if ((s.jsonld || {}).hasDental) pts += 2;
    pts = Math.min(10, pts);
    const status = pts >= 8 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `전화 ${s.phone ? 'O' : 'X'} · 주소 ${s.address ? 'O' : 'X'} · 진료 스키마 ${(s.jsonld || {}).hasDental ? 'O' : 'X'}`;
    const fix = pts < 8 ? 'NAP(상호·주소·전화)를 본문 + 스키마에 일관되게(플레이스 정보와 일치)' : null;
    b.push(item('local', '엔티티·로컬 정합', pts, 10, status, note, fix, '상호·주소·전화가 일치해야 지역 질의에서 엔티티로 잡힙니다.', 'SEO'));
  }

  // ══════════════════════════════════════════════════════════
  // 축B: 콘텐츠 인용성 — 인용할 가치가 있는가 (max 50)
  // ══════════════════════════════════════════════════════════

  // B1. E-E-A-T (작성자·자격) (15) — 의료 YMYL 신뢰 근거
  {
    let pts = 0;
    if ((s.credentials || 0) >= 4) pts += 10;
    else if ((s.credentials || 0) >= 1) pts += 6;
    if ((s.social || 0) >= 1) pts += 5;
    pts = Math.min(15, pts);
    const status = pts >= 11 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `의료진 자격 신호 ${s.credentials || 0}건, sameAs(SNS/블로그) ${s.social || 0}건`;
    const fix = (s.credentials || 0) < 4 ? '의료진 전문의/면허/경력을 본문 + Person 스키마로 명시' : null;
    b.push(item('eeat', 'E-E-A-T(작성자·자격)', pts, 15, status, note, fix, '의료(YMYL) 주제는 작성자 자격이 있어야 AI가 신뢰합니다.', 'GEO'));
  }

  // B2. 신선도 (10) — 최신성 판단 근거
  // v0.3에서 자사 휴리스틱이라는 이유로 10→5로 낮췄으나, v0.4에서 되돌린다.
  // 근거: What Gets Cited (arXiv:2605.25517) — 25.2만회 통제 실험에서 '오래된 타임스탬프'가
  //       6개 모델 전원 일치로 확인된 인용 게이트키퍼 4요인 중 하나로 나타났다.
  //       더 이상 자사 추정이 아니라 통제 실험으로 뒷받침되는 항목이다.
  {
    const d = s.dateSignals || 0;
    const pts = d >= 2 ? 10 : d === 1 ? 6 : 0;
    const status = pts >= 10 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `게시일/수정일 신호 ${d}건`;
    const fix = pts < 10 ? '콘텐츠에 게시일/수정일(datePublished·article:modified_time) 노출' : null;
    b.push(item('fresh', '신선도', pts, 10, status, note, fix, '날짜가 없거나 오래된 페이지는 AI 답변에서 걸러진다는 통제 실험 결과가 있습니다.', 'SEO'));
  }

  // B3. Answer-first 구조 (10) — 구조 신호 전용. 인용구·통계·출처는 citable로 분리돼 있다.
  // v0.4: 15→10. 포맷팅 단독 효과의 근거가 약하다는 후속 연구를 반영한다.
  //  - Citation Absorption (arXiv:2604.25707): Q&A 포맷은 오히려 -5.74%
  //  - GEO 서베이 45편 (arXiv:2607.14035): 안정적·종단적·플랫폼 교차 인과효과를 보인 기법 없음
  // 구조는 '읽히게' 하는 데 필요하나(SAGEO Arena: 구조 정보가 검색 Hit Rate +22%),
  // 그 몫은 축A(schema·extract)에서 이미 세고 있으므로 여기서 중복 가중하지 않는다.
  {
    let pts = 0;
    if ((s.h1Count || 0) >= 1) pts += 2;
    if ((s.h2Count || 0) >= 3) pts += 2;
    if ((s.questionH2 || 0) >= 1) pts += 3;
    if ((s.tables || 0) >= 1) pts += 2;
    if ((s.faqBlocks || 0) >= 1) pts += 1;
    pts = Math.min(10, pts);
    const status = pts >= 8 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `질문형 H2 ${s.questionH2 || 0}개, 표 ${s.tables || 0}개, FAQ블록 ${s.faqBlocks || 0}개`;
    const fix = pts < 8 ? '진료별 질문형 H2 + 표/Q&A 블록으로 answer-first 구조화' : null;
    b.push(item('answer', 'Answer-first 구조', pts, 10, status, note, fix, '질문에 결론부터 답하는 구조라야 AI가 그대로 발췌합니다.', 'GEO'));
  }

  // B4. 인용 근거 — 출처·인용구·통계 (15)  [v0.3 신설]
  // KDD 2024(arXiv:2311.09735)가 GEO-bench 쿼리 1만 건으로 실측한 상위 3개 기법.
  // 출처 명시에 최대 가중(7) — 검색 5위권 사이트에서 인용 +115.1%로 단일 최대 레버.
  {
    const sc = s.statCount != null ? s.statCount : (s.hasStatistics ? 1 : 0);
    let pts = 0;
    if (s.hasCitedSources) pts += 7;
    pts += sc >= 2 ? 4 : sc >= 1 ? 2 : 0;
    if (s.hasQuotations) pts += 4;
    pts = Math.min(15, pts);
    const status = pts >= 11 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const statNote = sc >= 2 ? '통계 충분' : sc >= 1 ? '통계 일부' : '통계 없음';
    const note = `출처 표기 ${s.hasCitedSources ? 'O' : 'X'} · 인용구 ${s.hasQuotations ? 'O' : 'X'} · ${statNote}`;
    const fix = !s.hasCitedSources
      ? '본문 주장에 근거 출처를 명시(학회·논문·공공기관 링크 또는 참고문헌 표기)'
      : !s.hasQuotations
        ? '의료진 코멘트를 인용구(blockquote)로 배치해 발췌 가능한 형태로'
        : sc < 2
          ? '수치 근거(증례 수·경과 기간·비율)를 본문에 병기'
          : null;
    b.push(item('citable', '인용 근거(출처·인용구·통계)', pts, 15, status, note, fix,
      '출처·인용구·수치가 있는 문단이 AI 답변에 그대로 발췌되기 쉽습니다(KDD 2024 실측 상위 3개 기법).', 'GEO'));
  }

  // ── 측정 제한(JS 렌더) 후처리 ────────────────────────────
  // 형제 모듈 lib/agent-score.js의 원칙을 그대로 따른다: 정적 분석은 '하한선'이고,
  // SPA에서 신호가 안 보이는 것은 '없음'이 아니라 '못 읽음'이다. 없는 것으로 단정해
  // fail을 찍고 "의료진 소개를 만드세요"를 처방하는 것이 이미 값을 치른 거짓말이다.
  // status enum은 'ok|warn|fail' 3값을 유지한다(소비처 CSS 계약: public/style.css .mark.*,
  // 패키지/mnm-style.css .gw-sig li.st-*, operator.html .diff-status.*).
  // 대신 직교 필드 measurement:'measured'|'limited'를 추가해 UI가 구분하게 한다.
  const LIMITED_KEYS = new Set(['eeat', 'fresh', 'answer', 'citable']); // 축B = 본문 의존
  const measurementLimited = !!s.needsHeadless;
  for (const x of b) {
    if (!measurementLimited || !LIMITED_KEYS.has(x.key)) { x.measurement = 'measured'; continue; }
    x.measurement = 'limited';
    if (x.status === 'fail') x.status = 'warn'; // 0점이어도 '없음'이 아니라 '못 읽음'
    x.fix = null;                               // 틀린 처방 차단(topFixes에서도 자동 제외)
    x.note = `측정 제한(JS 렌더로 본문 미확인 · 실패 아님) — ${x.note}`;
    x.limitedNote = 'JS로 그려지는 페이지라 정적 분석으로 확인할 수 없었습니다. 없다는 뜻이 아니며, 정밀 측정은 헤드리스 렌더가 필요합니다.';
  }

  // ── 합산 및 축 집계 ──────────────────────────────────────
  const score = b.reduce((a, x) => a + x.points, 0);

  // 등급 하드 게이트 — score는 그대로 두고 '라벨'만 강등한다(하위호환: 라벨 집합 불변).
  const BAND_ORDER = ['초기 단계', '개선 여지 큼', '보통', '우수'];
  const rawBand = score >= 75 ? '우수' : score >= 50 ? '보통' : score >= 30 ? '개선 여지 큼' : '초기 단계';
  const citableItem = b.find((x) => x.key === 'citable');
  const bandGates = [];
  // G1. 크롤 허용은 A1 주석대로 '필요조건'. 차단 사이트는 나머지 만점이어도 '우수'일 수 없다.
  if (robots.present && robots.blocksAny) {
    bandGates.push({ code: 'crawl-blocked', label: 'AI 크롤러 차단', note: 'AI 크롤러가 차단된 페이지는 인용 후보에서 제외되므로 상한 등급을 보류합니다.' });
  }
  // G2. citable 0점 = 출처·인용구·통계가 하나도 없음(KDD 2024 실측 상위 3기법 전무).
  //     단 측정 제한이면 '없음'이 아니라 '못 읽음'이므로 게이트 대상이 아니다.
  if (citableItem && citableItem.measurement === 'measured' && citableItem.points === 0) {
    bandGates.push({ code: 'no-citable-evidence', label: '인용 근거 0점', note: '출처·인용구·통계가 하나도 없으면 AI가 발췌할 근거 문단이 없습니다.' });
  }
  // G3. 축B를 못 읽은 결과는 하한선이다. 읽지 못한 페이지에 '우수'를 붙이지 않는다.
  if (measurementLimited) {
    bandGates.push({ code: 'measurement-limited', label: '측정 제한(JS 렌더)', note: '본문을 정적으로 읽지 못했으므로 상한 등급을 보류합니다.' });
  }
  // 게이트 발동 시 도달 가능한 상한 등급
  const BAND_CAP = '보통';
  const band = bandGates.length && BAND_ORDER.indexOf(rawBand) > BAND_ORDER.indexOf(BAND_CAP) ? BAND_CAP : rawBand;
  const bandCapped = band !== rawBand;
  const bandNote = bandCapped
    ? `${bandGates.map((g) => g.label).join(' · ')} — 점수는 ${score}점이지만 상한 등급('${rawBand}')을 보류했습니다.`
    : null;

  // 축A: crawl(15) + schema(10) + extract(10) + local(10) + price(5) = max 50
  const techKeys = new Set(['crawl', 'schema', 'extract', 'local', 'price']);
  const techItems = b.filter((x) => techKeys.has(x.key));
  const techScore = techItems.reduce((a, x) => a + x.points, 0);
  const techMax = techItems.reduce((a, x) => a + x.max, 0);

  // 축B: eeat(15) + citable(15) + answer(10) + fresh(10) = max 50
  const contentKeys = new Set(['eeat', 'fresh', 'answer', 'citable']);
  const contentItems = b.filter((x) => contentKeys.has(x.key));
  const contentScore = contentItems.reduce((a, x) => a + x.points, 0);
  const contentMax = contentItems.reduce((a, x) => a + x.max, 0);

  const axes = {
    tech: { score: techScore, max: techMax, label: '기술 준비도' },
    content: { score: contentScore, max: contentMax, label: '콘텐츠 인용성' },
  };

  const topFixes = b
    .filter((x) => x.fix)
    .sort((a, c) => c.max - c.points - (a.max - a.points))
    .slice(0, 3)
    .map((x) => ({ label: x.label, fix: x.fix, gain: x.max - x.points, gainLabel: '구조 위생 점수 · AI 인용 예측 아님', note: x.why }));

  return {
    score,
    max: 100,
    band,
    rawBand,      // 게이트 적용 전 점수 기반 라벨(감사·회귀 추적용)
    bandCapped,   // 게이트로 라벨이 강등되었는가
    bandGates,    // [{code,label,note}] — 강등 사유(기계 판독용)
    bandNote,     // UI 노출용 한 줄 설명(없으면 null)
    measurementLimited, // 축B가 정적 분석 하한선인가(= needsHeadless)
    axes,
    breakdown: b,
    topFixes,
    needsHeadless: !!s.needsHeadless,
    methodologyVersion: METHODOLOGY_VERSION,
    disclaimer: '이 점수는 AI 인용을 예측하지 않습니다. 홈페이지 구조 위생과 인용 가능 조건을 보는 휴리스틱 지표입니다. 인용 여부는 실측 패널로만 확인됩니다.',
  };
}

function item(key, label, points, max, status, note, fix, why, layer) {
  return { key, label, points, max, status, note, fix, why, layer };
}

export { METHODOLOGY_VERSION };
