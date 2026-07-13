// Pure comparison/diff/plan builders for the operator competitor teardown.
// NO fetching, NO DOM — takes two extracted "profiles" and returns a render-ready package.
// All copy here is OPERATOR-FACING (internal sales), but kept 의료광고법-clean anyway:
// no 최고/1위/유일/완치/보장/100%/최상급/명품, and effects are framed as hygiene, never citation promises.
// (test/compare.test.js scans every static string in this file against the banned list.)

// Framing label reused from scorer.js topFixes.gainLabel — never render improvement as a citation lift.
export const EFFECT_LABEL = '구조 위생 지표 · AI 인용 예측 아님';

// Why each scored signal matters — factual, necessary-condition language only.
const SIGNAL_WHY = {
  crawl: 'AI 크롤러가 차단되면 페이지가 인용 후보에서 아예 제외됩니다(필요조건).',
  schema: 'JSON-LD가 있으면 상호·진료·FAQ를 AI가 기계적으로 식별합니다.',
  eeat: '의료(YMYL) 주제는 작성자 자격 신호가 있어야 신뢰 근거가 생깁니다.',
  fresh: '게시·수정일이 노출되면 최신성 판단 근거가 됩니다.',
  answer: '질문에 결론부터 답하는 구조라야 본문이 그대로 발췌되기 쉽습니다.',
  extract: '본문 가시 텍스트 비중이 충분해야 추출할 내용이 존재합니다.',
  local: '상호·주소·전화(NAP)가 일치해야 지역 질의에서 엔티티로 잡힙니다.',
};

const SIGNAL_DIFFICULTY = {
  crawl: '하', schema: '중', eeat: '중', fresh: '하', answer: '상', extract: '중', local: '하',
};

// Gap → 메디앤메디 product ids (must match PRODUCTS ids in public/operator.js).
const GAP_PRODUCTS = {
  crawl: ['geo-diagnosis'],
  schema: ['content-hub', 'geo-diagnosis'],
  eeat: ['content-hub', 'media-feature'],
  fresh: ['blog-posting'],
  answer: ['content-hub'],
  extract: ['content-hub'],
  local: ['content-hub', 'geo-diagnosis'],
  citability: ['blog-posting', 'media-feature'],
  notcited: ['blog-posting', 'media-feature', 'reboot-30'],
};

// Dentist/LocalBusiness schema fields surfaced in the field-level diff, in display order.
export const SCHEMA_FIELDS = [
  { key: 'name', label: '상호 (name)' },
  { key: 'telephone', label: '전화 (telephone)' },
  { key: 'address', label: '주소 (address)' },
  { key: 'openingHours', label: '진료시간 (openingHours)' },
  { key: 'geo', label: '좌표 (geo)' },
  { key: 'sameAs', label: 'SNS·권위 링크 (sameAs)' },
  { key: 'priceRange', label: '가격대 (priceRange)' },
  { key: 'areaServed', label: '진료지역 (areaServed)' },
  { key: 'medicalSpecialty', label: '전문분야 (medicalSpecialty)' },
];

// True when a response can be embedded in an iframe from a different origin.
// Conservative: any X-Frame-Options, or a CSP frame-ancestors that isn't open, blocks it.
export function embeddableFromHeaders(headers = {}) {
  if (!headers || typeof headers !== 'object') return false;
  const get = (name) => {
    const target = name.toLowerCase();
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === target) {
        const v = headers[k];
        return Array.isArray(v) ? v.join(' ') : String(v || '');
      }
    }
    return '';
  };
  const xfo = get('x-frame-options').trim();
  if (xfo) return false; // DENY or SAMEORIGIN — both block cross-origin embedding
  const csp = get('content-security-policy').toLowerCase();
  const fa = csp.match(/frame-ancestors([^;]*)/);
  if (fa) {
    const val = fa[1].trim();
    // Embeddable only if the directive explicitly allows any origin.
    if (!/\*/.test(val) || /'none'|'self'/.test(val)) return false;
  }
  return true;
}

function pick(breakdown, key) {
  return (breakdown || []).find((b) => b.key === key) || null;
}

// 7-signal side-by-side, every signal (not just gaps). verdict: 'gap'|'same'|'ahead'.
export function buildSignalDiff(userBreakdown, compBreakdown) {
  const order = ['crawl', 'schema', 'eeat', 'answer', 'fresh', 'extract', 'local'];
  const rows = [];
  for (const key of order) {
    const u = pick(userBreakdown, key);
    const c = pick(compBreakdown, key);
    if (!u && !c) continue;
    const uOk = u && u.status === 'ok';
    const cOk = c && c.status === 'ok';
    let verdict = 'same';
    if (!uOk && cOk) verdict = 'gap';
    else if (uOk && !cOk) verdict = 'ahead';
    rows.push({
      key,
      label: (u || c).label,
      layer: (u || c).layer || '',
      weight: (u || c).max || 0,
      userStatus: u ? u.status : 'na',
      compStatus: c ? c.status : 'na',
      userNote: u ? u.note : '',
      compNote: c ? c.note : '',
      fix: u ? u.fix : null,
      verdict,
      why: SIGNAL_WHY[key] || '',
    });
  }
  return rows;
}

// Field-level JSON-LD diff. Reads the `schema` object produced by extractJsonLd.
export function buildSchemaDiff(userSchema = {}, compSchema = {}) {
  const uEnt = (userSchema && userSchema.entity) || {};
  const cEnt = (compSchema && compSchema.entity) || {};
  const fields = SCHEMA_FIELDS.map((f) => {
    const userHas = !!uEnt[f.key];
    const compHas = !!cEnt[f.key];
    let verdict = 'same';
    if (!userHas && compHas) verdict = 'gap';
    else if (userHas && !compHas) verdict = 'ahead';
    return { key: f.key, label: f.label, userHas, compHas, verdict };
  });
  return {
    userTypes: (userSchema && userSchema.typeList) || [],
    compTypes: (compSchema && compSchema.typeList) || [],
    userHasDental: !!(userSchema && userSchema.hasDentalType),
    compHasDental: !!(compSchema && compSchema.hasDentalType),
    fields,
    faqCount: { user: (userSchema && userSchema.faqCount) || 0, comp: (compSchema && compSchema.faqCount) || 0 },
    aggregateRating: {
      user: (userSchema && userSchema.aggregateRating) || null,
      comp: (compSchema && compSchema.aggregateRating) || null,
    },
    breadcrumb: { user: !!(userSchema && userSchema.hasBreadcrumb), comp: !!(compSchema && compSchema.hasBreadcrumb) },
    // fields competitor markup includes that the subject's does not — drives the schema plan row.
    missingVsComp: fields.filter((f) => f.verdict === 'gap').map((f) => f.label),
  };
}

function txtVerdict(userVal, compVal) {
  const u = (userVal || '').trim();
  const c = (compVal || '').trim();
  if (!u && c) return 'gap';
  if (u && !c) return 'ahead';
  return 'same';
}

// Title / description / OG / canonical / viewport / robots meta diff.
export function buildMetaDiff(userMeta = {}, compMeta = {}) {
  const titleRow = (key, label, uv, cv) => ({
    key, label,
    user: uv || '', comp: cv || '',
    userLen: (uv || '').length, compLen: (cv || '').length,
    verdict: txtVerdict(uv, cv),
  });
  const rows = [
    titleRow('title', 'title 태그', userMeta.title, compMeta.title),
    titleRow('description', 'meta description', userMeta.metaDescription, compMeta.metaDescription),
    titleRow('ogTitle', 'og:title', userMeta.ogTitle, compMeta.ogTitle),
    titleRow('ogImage', 'og:image', userMeta.ogImage, compMeta.ogImage),
    titleRow('canonical', 'canonical', userMeta.canonical, compMeta.canonical),
    titleRow('viewport', 'viewport', userMeta.viewport, compMeta.viewport),
  ];
  // robots meta: presence is neutral, but noindex is a real problem — flag it.
  const uRobots = (userMeta.robotsMeta || '').toLowerCase();
  const cRobots = (compMeta.robotsMeta || '').toLowerCase();
  rows.push({
    key: 'robots', label: 'robots 메타',
    user: userMeta.robotsMeta || '(없음)', comp: compMeta.robotsMeta || '(없음)',
    userLen: 0, compLen: 0,
    verdict: /noindex/.test(uRobots) && !/noindex/.test(cRobots) ? 'gap' : 'same',
    warnUser: /noindex/.test(uRobots),
  });
  return rows;
}

function numVerdict(u, c) {
  const un = Number(u) || 0;
  const cn = Number(c) || 0;
  if (cn > un) return 'gap';
  if (un > cn) return 'ahead';
  return 'same';
}
function boolVerdict(u, c) {
  if (!u && c) return 'gap';
  if (u && !c) return 'ahead';
  return 'same';
}

// Heading / answer-structure / citability content diff.
export function buildContentDiff(userC = {}, compC = {}, userSig = {}, compSig = {}) {
  return [
    { key: 'h1', label: 'H1 개수', user: userC.h1Count || 0, comp: compC.h1Count || 0, kind: 'num', verdict: numVerdict(userC.h1Count, compC.h1Count) },
    { key: 'h2', label: 'H2 개수', user: userC.h2Count || 0, comp: compC.h2Count || 0, kind: 'num', verdict: numVerdict(userC.h2Count, compC.h2Count) },
    { key: 'questionH2', label: '질문형 H2', user: userC.questionH2 || 0, comp: compC.questionH2 || 0, kind: 'num', verdict: numVerdict(userC.questionH2, compC.questionH2) },
    { key: 'tables', label: '표(table)', user: userC.tables || 0, comp: compC.tables || 0, kind: 'num', verdict: numVerdict(userC.tables, compC.tables) },
    { key: 'faqBlocks', label: 'FAQ 블록', user: userC.faqBlocks || 0, comp: compC.faqBlocks || 0, kind: 'num', verdict: numVerdict(userC.faqBlocks, compC.faqBlocks) },
    { key: 'wordCount', label: '본문 글자수', user: userC.wordCount || 0, comp: compC.wordCount || 0, kind: 'num', verdict: numVerdict(userC.wordCount, compC.wordCount) },
    { key: 'statistics', label: '수치·통계 ≥2', user: !!userSig.hasStatistics, comp: !!compSig.hasStatistics, kind: 'bool', verdict: boolVerdict(userSig.hasStatistics, compSig.hasStatistics) },
    { key: 'quotations', label: '인용문', user: !!userSig.hasQuotations, comp: !!compSig.hasQuotations, kind: 'bool', verdict: boolVerdict(userSig.hasQuotations, compSig.hasQuotations) },
    { key: 'citedSources', label: '출처 표기', user: !!userSig.hasCitedSources, comp: !!compSig.hasCitedSources, kind: 'bool', verdict: boolVerdict(userSig.hasCitedSources, compSig.hasCitedSources) },
  ];
}

export function mapGapToProducts(key) {
  return GAP_PRODUCTS[key] ? [...GAP_PRODUCTS[key]] : [];
}

// Prioritized improvement plan: every signal the subject hasn't passed, comp-ahead first.
// severity = weight × (comp-ahead ? 2 : 1) × (fail ? 1 : 0.6).
export function buildPlanRows(signalDiff, schemaDiff, contentDiff, opts = {}) {
  const rows = [];
  for (const s of signalDiff) {
    if (s.userStatus === 'ok') continue; // already passing — not a plan item
    const compAhead = s.verdict === 'gap';
    const failMult = s.userStatus === 'fail' ? 1 : 0.6;
    const severity = s.weight * (compAhead ? 2 : 1) * failMult;
    let target = s.fix || '구조 위생 항목 보완';
    let detail = '';
    if (s.key === 'schema' && schemaDiff && schemaDiff.missingVsComp && schemaDiff.missingVsComp.length) {
      detail = `비교 대상에 있는 필드: ${schemaDiff.missingVsComp.join(' · ')}`;
    }
    rows.push({
      key: s.key,
      item: s.label,
      current: s.userNote || '미충족',
      target,
      detail,
      difficulty: SIGNAL_DIFFICULTY[s.key] || '중',
      compAhead,
      severity,
      productIds: mapGapToProducts(s.key),
      effectLabel: EFFECT_LABEL,
    });
  }

  // Content citability gap (statistics/quotations/sources comp has and subject lacks).
  const citabilityGaps = (contentDiff || []).filter(
    (c) => ['statistics', 'quotations', 'citedSources'].includes(c.key) && c.verdict === 'gap'
  );
  if (citabilityGaps.length) {
    rows.push({
      key: 'citability',
      item: '콘텐츠 인용성 신호',
      current: `약함 (${citabilityGaps.map((c) => c.label).join('·')} 부족)`,
      target: '진료 설명 본문에 수치·인용·출처 표기를 보강',
      detail: '제3자 콘텐츠(블로그·기고)에서 동일 신호를 함께 축적',
      difficulty: '중',
      compAhead: true,
      severity: 9,
      productIds: mapGapToProducts('citability'),
      effectLabel: EFFECT_LABEL,
    });
  }

  // Subject not cited by AI while a competitor is → external-mention track (top priority).
  if (opts.userCited === false) {
    rows.unshift({
      key: 'notcited',
      item: 'AI 미인용 — 외부 언급 부재',
      current: '제3자 콘텐츠(블로그·기사·커뮤니티) 언급이 적음',
      target: '지역+진료 조합의 제3자 언급을 단계적으로 축적',
      detail: '기술 점수와 별개로, AI 인용은 외부 언급 신호에 좌우됩니다',
      difficulty: '상',
      compAhead: true,
      severity: 999,
      productIds: mapGapToProducts('notcited'),
      effectLabel: EFFECT_LABEL,
    });
  }

  rows.sort((a, b) => b.severity - a.severity);
  return rows.map((r, i) => ({ ...r, priority: i + 1 }));
}

// Union of plan-row product ids in priority order (for auto-selecting the inquiry form).
export function recommendedProductIds(planRows) {
  const seen = new Set();
  const out = [];
  for (const r of planRows || []) {
    for (const id of r.productIds || []) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
  }
  return out;
}

// Assemble the full render-ready package from two profiles.
// profile = { domain, score, breakdown[], signals{}, schema{}, meta{}, content{}, teardown{}, embeddable }
export function buildComparePackage(user, comp, opts = {}) {
  const signalDiff = buildSignalDiff(user.breakdown, comp.breakdown);
  const schemaDiff = buildSchemaDiff(user.schema, comp.schema);
  const metaDiff = buildMetaDiff(user.meta, comp.meta);
  const contentDiff = buildContentDiff(user.content, comp.content, user.signals, comp.signals);
  const planRows = buildPlanRows(signalDiff, schemaDiff, contentDiff, { userCited: opts.userCited });
  return {
    domains: { user: user.domain, comp: comp.domain },
    scores: { user: user.score, comp: comp.score },
    embeddable: { user: !!user.embeddable, comp: !!comp.embeddable },
    finalUrls: { user: user.finalUrl || '', comp: comp.finalUrl || '' },
    signalDiff,
    schemaDiff,
    metaDiff,
    contentDiff,
    planRows,
    recommendedProductIds: recommendedProductIds(planRows),
    teardown: { user: user.teardown || null, comp: comp.teardown || null },
    effectLabel: EFFECT_LABEL,
  };
}
