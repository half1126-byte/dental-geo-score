// Agent-actionability — a NET-NEW capability layer, kept SEPARATE from the 0-100 hygiene score.
// Question: once an AI agent has arrived (cited or not), can it actually OPERATE the clinic's
// booking/contact form? This is a third axis — NOT citation (engine cites us) and NOT page hygiene
// (crawler can read us). Lighthouse "agentic browsing" is a PASS-RATE FRACTION, not a weighted
// score; we mirror that on purpose. Hard rules (honesty guards):
//   - NEVER import scorer.js and NEVER fold into the 0-100 score (no `score`/`band`/grade key here).
//   - Static cheerio is a LOWER BOUND: JS-injected labels are invisible, so an SPA is
//     'measurement-limited' (NOT a 0 — the 밸런스 false-fail is the exact lie we already paid for).
//   - No form at all = 'no-form' (phone/map booking is valid), informational, NOT a failure.

// Versioned thresholds (mirrors scorer's METHODOLOGY_VERSION discipline).
const THRESHOLDS_VERSION = 'v0.1';
const COVERAGE_GATE = 0.8;   // ≥80% of operable controls must have a machine-readable name
const PLACEHOLDER_MAX = 0.3; // ≤30% of named controls may rely on placeholder-only

export function buildAgentActionability(signals = {}) {
  const fa = signals.formAccessibility || {};
  const note = '인용 여부와 별개 — 에이전트가 예약/문의 폼을 조작할 수 있는지(정적 분석 하한선).';

  // SPA / JS-shell: static HTML can't see runtime-injected labels → measurement-limited, never 0.
  if (signals.needsHeadless) {
    return { status: 'measurement-limited', note, forms: fa.forms || 0, bookingForms: fa.bookingForms || 0 };
  }
  // Many static clinic pages book via phone/map — no form is informational, not a fail.
  if (!fa.forms) {
    return { status: 'no-form', note, forms: 0, bookingForms: 0 };
  }
  // Form present but ZERO statically-readable controls (JS-built widget just above the SPA threshold):
  // can't render an honest fraction → its own state, NOT a vacuous 0/0 'measured' pass.
  if (!fa.controlsTotal) {
    return { status: 'no-controls', note, forms: fa.forms, bookingForms: fa.bookingForms || 0 };
  }

  const controlsTotal = fa.controlsTotal;
  const controlsNamed = fa.controlsNamed || 0;
  const coverageRaw = controlsNamed / controlsTotal;        // gate on the RAW ratio…
  const coverage = +coverageRaw.toFixed(2);                 // …round only for display
  const placeholderShare = controlsNamed ? (fa.placeholderOnly || 0) / controlsNamed : 1; // nothing named = worst
  const submitTotal = fa.submitTotal || 0;
  const submitNamed = fa.submitNamed || 0;

  // Boolean agent-readiness checks → pass-rate fraction (NEVER a weighted 0-100).
  const checks = [
    { key: 'control-names', label: '입력칸에 기계가 읽을 이름', pass: coverageRaw >= COVERAGE_GATE },
    // NO submit button at all = an agent literally cannot submit → FAIL (not a vacuous pass).
    { key: 'submit-name', label: '제출/예약 버튼에 접근가능 이름', pass: submitTotal > 0 && submitNamed >= submitTotal },
    // Requires ≥1 named control before it can pass (nothing-named no longer passes by default).
    { key: 'not-placeholder-only', label: 'placeholder에만 의존하지 않음', pass: controlsNamed > 0 && placeholderShare <= PLACEHOLDER_MAX },
  ];
  const passed = checks.filter((c) => c.pass).length;

  return {
    status: 'measured',
    note,
    forms: fa.forms,
    bookingForms: fa.bookingForms || 0,
    controlsTotal,
    controlsNamed,
    placeholderOnly: fa.placeholderOnly || 0,
    coverage, // raw fraction, rendered verbatim (e.g. 5/7) — not a 0-100
    submitNamed,
    submitTotal,
    checks,
    passed,
    total: checks.length, // pass-rate denominator — the only "out of N" we expose
    thresholdsVersion: THRESHOLDS_VERSION,
    unnamedSamples: fa.unnamedSamples || [],
  };
}
