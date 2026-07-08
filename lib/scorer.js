// Heuristic GEO "준비도" score (0-100). DETERMINISTIC given the same parsed signals.
// v0.2: 두 진단 축으로 재편 — 축A "기술 준비도"(AI 크롤러가 읽을 수 있는가)
//        축B "콘텐츠 인용성"(인용할 가치가 있는가).
// 합산 score·band는 하위 호환을 위해 병행 유지.
// 이 점수는 AI 인용을 예측하지 않습니다 (자사 검증: 점수↔실제 인용 역상관 판명).
const METHODOLOGY_VERSION = 'v0.2';

export function scorePage({ robots = {}, signals = {} }) {
  const s = signals;
  const b = [];

  // ══════════════════════════════════════════════════════════
  // 축A: 기술 준비도 — AI 크롤러가 읽을 수 있는가 (max 55)
  // ══════════════════════════════════════════════════════════

  // A1. AI 크롤러 허용 (15) — 차단은 인용 후보 자체에서 제외되는 필요조건
  {
    let pts = 15, status = 'ok', note = 'AI 크롤러 차단 없음(허용)', fix = null;
    if (robots.present && robots.blocksAny) {
      pts = 2; status = 'fail'; note = robots.note;
      fix = `robots.txt에서 ${robots.blockedBots.join(', ')} 차단 해제`;
    } else if (!robots.present) {
      pts = 11; status = 'warn'; note = 'robots.txt 없음/판정불가 (암묵 허용이나 명시 권장)';
      fix = 'robots.txt를 두고 AI 크롤러(OAI-SearchBot·PerplexityBot 등) 허용을 명시';
    }
    b.push(item('crawl', 'AI 크롤러 허용', pts, 15, status, note, fix, 'AI 크롤러가 막히면 인용 자체가 불가능합니다.', 'SEO'));
  }

  // A2. 구조화 데이터 JSON-LD (20)
  {
    const j = s.jsonld || {};
    let pts = 0;
    if (j.hasDental) pts += 10;
    if (j.hasFaq) pts += 5;
    if (j.hasTrust) pts += 5;
    if (s.hasSameAsAuthority) pts += 3;
    pts = Math.min(20, pts);
    const status = pts >= 15 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = j.count ? `JSON-LD: ${(j.types || []).slice(0, 6).join(', ') || '있음'}` : 'JSON-LD 구조화 데이터 없음';
    const fix = !j.hasDental
      ? 'Dentist/MedicalClinic + LocalBusiness JSON-LD 추가(상호·주소·전화·진료)'
      : !j.hasFaq
        ? 'FAQPage 스키마로 자주 묻는 질문을 마크업'
        : null;
    b.push(item('schema', '구조화 데이터(JSON-LD)', pts, 20, status, note, fix, 'JSON-LD는 상호·진료·FAQ를 AI가 기계적으로 읽게 해줍니다.', 'AEO'));
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
  // 축B: 콘텐츠 인용성 — 인용할 가치가 있는가 (max 45)
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
  {
    const d = s.dateSignals || 0;
    const pts = d >= 2 ? 10 : d === 1 ? 6 : 0;
    const status = pts >= 10 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `게시일/수정일 신호 ${d}건`;
    const fix = pts < 10 ? '콘텐츠에 게시일/수정일(datePublished·article:modified_time) 노출' : null;
    b.push(item('fresh', '신선도', pts, 10, status, note, fix, '게시·수정일이 보이면 AI가 최신 정보로 우선합니다.', 'SEO'));
  }

  // B3. Answer-first 구조 + 인용 신호 (20)
  // 인용문(quotations) 최대 가중, statCount 3-밴드, hasCitedSources 신규 편입
  {
    let pts = 0;
    if ((s.h1Count || 0) >= 1) pts += 2;
    if ((s.h2Count || 0) >= 3) pts += 3;
    if ((s.questionH2 || 0) >= 1) pts += 4;
    if ((s.tables || 0) >= 1) pts += 3;
    if ((s.faqBlocks || 0) >= 1) pts += 2;
    // 인용문: 최대 가중 (KDD 2024: +41%)
    if (s.hasQuotations) pts += 3;
    // statCount 3-밴드: 0→+0, 1-2→+1, 3+→+2 (오탐 완화)
    const sc = s.statCount != null ? s.statCount : (s.hasStatistics ? 1 : 0);
    pts += sc >= 2 ? 2 : sc >= 1 ? 1 : 0;
    // 출처 표기 (KDD 2024: +27%)
    if (s.hasCitedSources) pts += 1;
    // sectionProfile: 250–900자 밴드 비율 ≥0.5이면 +0, null이면 중립(패널티 없음)
    // (구조화된 섹션 비율이 높으면 추가 신호 없음 — 이미 h2/questionH2에서 반영)
    pts = Math.min(20, pts);
    const status = pts >= 14 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const statNote = sc >= 2 ? ' · 통계 충분' : sc >= 1 ? ' · 통계 일부' : '';
    const note = `질문형 H2 ${s.questionH2 || 0}개, 표 ${s.tables || 0}개, FAQ블록 ${s.faqBlocks || 0}개${statNote}${s.hasQuotations ? ' · 인용구O' : ''}${s.hasCitedSources ? ' · 출처O' : ''}`;
    const fix = pts < 14 ? '진료별 질문형 H2 + 표/Q&A 블록으로 answer-first 구조화(인용구·출처 병기 권장)' : null;
    b.push(item('answer', 'Answer-first 구조', pts, 20, status, note, fix, '질문에 결론부터 답하는 구조라야 AI가 그대로 인용합니다.', 'GEO'));
  }

  // ── 합산 및 축 집계 ──────────────────────────────────────
  const score = b.reduce((a, x) => a + x.points, 0);
  const band = score >= 75 ? '우수' : score >= 50 ? '보통' : score >= 30 ? '개선 여지 큼' : '초기 단계';

  // 축A: crawl(15) + schema(20) + extract(10) + local(10) = max 55
  const techKeys = new Set(['crawl', 'schema', 'extract', 'local']);
  const techItems = b.filter((x) => techKeys.has(x.key));
  const techScore = techItems.reduce((a, x) => a + x.points, 0);
  const techMax = techItems.reduce((a, x) => a + x.max, 0);

  // 축B: eeat(15) + fresh(10) + answer(20) = max 45
  const contentKeys = new Set(['eeat', 'fresh', 'answer']);
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
