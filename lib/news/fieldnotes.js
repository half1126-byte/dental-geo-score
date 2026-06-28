// Pure field-notes logic: validate/normalize the operator-curated JSON and decide staleness.
// No deps, no I/O — the caller passes already-parsed JSON. This is the canonical rule source
// for tests; public/news-section.js mirrors STALE_MAX_DAYS for the static client render.

export const STALE_MAX_DAYS = 21; // weekly cadence + slack; older than this → hide the section
                                  // (a decayed "authority" surface hurts trust more than no surface)

// 의료광고법·신뢰 백스톱: 우리가 쓴 카피에 최상급/단정 0건. 누가 금칙어 넣으면 테스트가 잡는다.
export const LAW_HARD = /최고|1\s*위|넘버\s*원|No\.?\s*1|유일|완치|보장|보증|100\s*%|최상급|명품/i;

const CONF = new Set(['high', 'medium']);

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

export function validateNote(n) {
  if (!n || typeof n !== 'object') return null;
  const { title, url, source, date, summary, clientAction, confidence } = n;
  if (!title || !summary || !isHttpUrl(url)) return null; // title+summary+valid url required
  return {
    kind: 'fieldnote',
    title: String(title),
    url,
    source: source ? String(source) : '',
    date: date ? String(date) : '',
    summary: String(summary),
    clientAction: clientAction ? String(clientAction) : '',
    confidence: CONF.has(confidence) ? confidence : 'medium',
  };
}

export function validateBenchmark(b) {
  if (!b || typeof b !== 'object') return null;
  const { label, metric, asOf, note, sampleNote } = b;
  if (!label || !metric) return null; // label+metric required
  return {
    kind: 'benchmark',
    label: String(label),
    metric: String(metric),
    asOf: asOf ? String(asOf) : '',
    note: note ? String(note) : '',
    sampleNote: sampleNote ? String(sampleNote) : '',
  };
}

// days elapsed since reviewedAt; null/unparseable → Infinity (treated as stale → hidden: fail-safe)
export function daysSince(reviewedAt, now = Date.now()) {
  const t = Date.parse(reviewedAt);
  if (Number.isNaN(t)) return Infinity;
  return (now - t) / 86400000;
}

export function isStale(reviewedAt, now = Date.now(), maxDays = STALE_MAX_DAYS) {
  return daysSince(reviewedAt, now) > maxDays;
}

// Full load: parsed JSON → render-ready { reviewedAt, stale, notes, benchmarks }.
export function loadFieldnotes(raw, now = Date.now()) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const notes = Array.isArray(obj.notes) ? obj.notes.map(validateNote).filter(Boolean) : [];
  const benchmarks = Array.isArray(obj.benchmarks) ? obj.benchmarks.map(validateBenchmark).filter(Boolean) : [];
  const reviewedAt = obj.reviewedAt || obj.updatedAt || '';
  return { reviewedAt, stale: isStale(reviewedAt, now), notes, benchmarks };
}

// Compliance scan: returns the offending strings (empty array = clean).
export function scanForbidden(strings) {
  return strings.filter((s) => typeof s === 'string' && LAW_HARD.test(s));
}

// Flatten every operator-authored copy string in a feed object (for the compliance test).
export function collectCopy(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const out = [];
  for (const n of obj.notes || []) {
    if (n) out.push(n.title, n.summary, n.clientAction);
  }
  for (const b of obj.benchmarks || []) {
    if (b) out.push(b.label, b.metric, b.note, b.sampleNote);
  }
  return out.filter((s) => typeof s === 'string' && s.length > 0);
}
