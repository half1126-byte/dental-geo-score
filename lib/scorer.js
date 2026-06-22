// Heuristic GEO "readiness" score (0-100). DETERMINISTIC given the same parsed signals
// (this is the "준비도 점수", not the probabilistic real-citation measurement).
// Weights mirror plan B2; each weight is justified in /methodology. Framing is "opportunity",
// never grades/낙제 (의료광고법 + 전환).
const METHODOLOGY_VERSION = 'v0.1';

export function scorePage({ robots = {}, signals = {} }) {
  const s = signals;
  const b = [];

  // 1. AI 크롤러 허용 (15) — low variance in KR dental, but a hard block is fatal.
  {
    let pts = 15, status = 'ok', note = 'AI 크롤러 차단 없음(허용)', fix = null;
    if (robots.present && robots.blocksAny) {
      pts = 2; status = 'fail'; note = robots.note;
      fix = `robots.txt에서 ${robots.blockedBots.join(', ')} 차단 해제`;
    } else if (!robots.present) {
      pts = 11; status = 'warn'; note = 'robots.txt 없음/판정불가 (암묵 허용이나 명시 권장)';
      fix = 'robots.txt를 두고 AI 크롤러(OAI-SearchBot·PerplexityBot 등) 허용을 명시';
    }
    b.push(item('crawl', 'AI 크롤러 허용', pts, 15, status, note, fix));
  }

  // 2. 구조화 데이터 JSON-LD (20)
  {
    const j = s.jsonld || {};
    let pts = 0;
    if (j.hasDental) pts += 10;
    if (j.hasFaq) pts += 5;
    if (j.hasTrust) pts += 5;
    pts = Math.min(20, pts);
    const status = pts >= 15 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = j.count ? `JSON-LD: ${(j.types || []).slice(0, 6).join(', ') || '있음'}` : 'JSON-LD 구조화 데이터 없음';
    const fix = !j.hasDental
      ? 'Dentist/MedicalClinic + LocalBusiness JSON-LD 추가(상호·주소·전화·진료)'
      : !j.hasFaq
        ? 'FAQPage 스키마로 자주 묻는 질문을 마크업'
        : null;
    b.push(item('schema', '구조화 데이터(JSON-LD)', pts, 20, status, note, fix));
  }

  // 3. E-E-A-T (15)
  {
    let pts = 0;
    if ((s.credentials || 0) >= 4) pts += 10;
    else if ((s.credentials || 0) >= 1) pts += 6;
    if ((s.social || 0) >= 1) pts += 5;
    pts = Math.min(15, pts);
    const status = pts >= 11 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `의료진 자격 신호 ${s.credentials || 0}건, sameAs(SNS/블로그) ${s.social || 0}건`;
    const fix = (s.credentials || 0) < 4 ? '의료진 전문의/면허/경력을 본문 + Person 스키마로 명시' : null;
    b.push(item('eeat', 'E-E-A-T(작성자·자격)', pts, 15, status, note, fix));
  }

  // 4. 신선도 (10)
  {
    const d = s.dateSignals || 0;
    const pts = d >= 2 ? 10 : d === 1 ? 6 : 0;
    const status = pts >= 10 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `게시일/수정일 신호 ${d}건`;
    const fix = pts < 10 ? '콘텐츠에 게시일/수정일(datePublished·article:modified_time) 노출' : null;
    b.push(item('fresh', '신선도', pts, 10, status, note, fix));
  }

  // 5. Answer-first 구조 (20)
  {
    let pts = 0;
    if ((s.h1Count || 0) >= 1) pts += 3;
    if ((s.h2Count || 0) >= 3) pts += 4;
    if ((s.questionH2 || 0) >= 1) pts += 5;
    if ((s.tables || 0) >= 1) pts += 4;
    if ((s.faqBlocks || 0) >= 1) pts += 4;
    pts = Math.min(20, pts);
    const status = pts >= 14 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `질문형 H2 ${s.questionH2 || 0}개, 표 ${s.tables || 0}개, FAQ블록 ${s.faqBlocks || 0}개`;
    const fix = pts < 14 ? '진료별 질문형 H2 + 표/Q&A 블록으로 answer-first 구조화(첫 문단에 결론)' : null;
    b.push(item('answer', 'Answer-first 구조', pts, 20, status, note, fix));
  }

  // 6. 추출성 S/N (10)
  {
    let pts = 0;
    const sn = s.sn || 0;
    if (sn >= 0.06) pts += 6;
    else if (sn >= 0.02) pts += 3;
    if ((s.scripts || 0) <= 25) pts += 4;
    else if ((s.scripts || 0) <= 50) pts += 2;
    pts = Math.min(10, pts);
    const status = pts >= 7 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `가시 텍스트 비율 ${(sn * 100).toFixed(1)}%, script ${s.scripts || 0}개`;
    const fix = pts < 7 ? '본문 텍스트 비중↑·불필요 스크립트/광고 정리(서버 렌더 권장)' : null;
    b.push(item('extract', '추출성(S/N)', pts, 10, status, note, fix));
  }

  // 7. 엔티티·로컬 정합 (10)
  {
    let pts = 0;
    if (s.phone) pts += 4;
    if (s.address) pts += 4;
    if ((s.jsonld || {}).hasDental) pts += 2;
    pts = Math.min(10, pts);
    const status = pts >= 8 ? 'ok' : pts > 0 ? 'warn' : 'fail';
    const note = `전화 ${s.phone ? 'O' : 'X'} · 주소 ${s.address ? 'O' : 'X'} · 진료 스키마 ${(s.jsonld || {}).hasDental ? 'O' : 'X'}`;
    const fix = pts < 8 ? 'NAP(상호·주소·전화)를 본문 + 스키마에 일관되게(플레이스 정보와 일치)' : null;
    b.push(item('local', '엔티티·로컬 정합', pts, 10, status, note, fix));
  }

  const score = b.reduce((a, x) => a + x.points, 0);
  // Neutral "opportunity" bands — no grades, no 낙제.
  const band = score >= 75 ? '우수' : score >= 50 ? '보통' : score >= 30 ? '개선 여지 큼' : '초기 단계';
  const topFixes = b
    .filter((x) => x.fix)
    .sort((a, c) => c.max - c.points - (a.max - a.points))
    .slice(0, 3)
    .map((x) => ({ label: x.label, fix: x.fix, gain: x.max - x.points }));

  return {
    score,
    max: 100,
    band,
    breakdown: b,
    topFixes,
    needsHeadless: !!s.needsHeadless,
    methodologyVersion: METHODOLOGY_VERSION,
  };
}

function item(key, label, points, max, status, note, fix) {
  return { key, label, points, max, status, note, fix };
}

export { METHODOLOGY_VERSION };
