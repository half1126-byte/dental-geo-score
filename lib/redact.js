// Public/private response boundary (의료광고법 제56조 + anti-leak gate).
// The PUBLIC HTTP path must NEVER carry competitor clinic domains/names or raw evidence.
// Only aggregate, name-free fields cross to the browser. The full named panel (competitor
// domains, matched URLs, per-prompt evidence) goes ONLY through toPrivateReport — the
// email-gated/private operator report. Make leakage impossible by construction: every public
// response is shaped by toPublicView, and test/redact.test.js scans the serialized payload.

// Wilson score interval — honest small-N confidence band (AD-3). Naive normal-approx gives a
// degenerate [0,0] for 0/5 (false certainty); Wilson keeps an upper bound. Returns null for n=0
// ("측정 안 됨", no interval — never fabricate a band from zero data).
export function wilsonInterval(citedRuns, runs, z = 1.96) {
  if (!runs) return null;
  const p = citedRuns / runs;
  const z2 = z * z;
  const denom = 1 + z2 / runs;
  const center = (p + z2 / (2 * runs)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * runs)) / runs)) / denom;
  return {
    low: Math.max(0, +(center - margin).toFixed(3)),
    high: Math.min(1, +(center + margin).toFixed(3)),
  };
}

// Aggregate, name-free view for the public path. Drops sampledCitedDomains, evidence (matched
// URLs + prompt text), and any competitor identity. Keeps only counts + a citation RATE with CI.
export function toPublicView(panel) {
  const perEngine = (panel.perEngine || []).map((e) => ({
    engine: e.engine,
    validRuns: e.validRuns, // conclusive observations — the honest denominator (not raw attempts)
    citedRuns: e.citedRuns,
    inconclusiveRuns: e.inconclusiveRuns,
    erroredRuns: e.erroredRuns,
    hitRate: e.hitRate,
    cited: e.cited,
    measured: e.measured,
    unmeasurable: e.unmeasurable || null, // engine-error / no-search / no-key — never a fake 0
    // CI ONLY on a real conclusive sample WITH ≥1 citation. Showing a Wilson upper bound next to
    // "0 cited" reads to a clinic as implied efficacy → 의료광고법 과장 (A-2). So: cited>0 required.
    ci: e.measured && e.citedRuns > 0 && e.validRuns >= 2 ? wilsonInterval(e.citedRuns, e.validRuns) : null,
    // NO competitorCount: even an anonymized "N other clinics" count is comparative advertising (A-1).
  }));
  return {
    clinicDomain: panel.clinicDomain,
    region: panel.region,
    procedure: panel.procedure,
    perEngine,
    measuredAt: panel.measuredAt,
    note: panel.note,
    view: 'public',
    // Intentionally absent: sampledCitedDomains, evidence, matchedUrls, competitor names/count.
  };
}

// Full named panel for the private/email-gated operator report ONLY. Never send to the public path.
export function toPrivateReport(panel) {
  return { ...panel, view: 'private' };
}
