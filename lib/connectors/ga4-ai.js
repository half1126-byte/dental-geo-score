// GA4 Data API connector — "AI Assistant" channel traffic/conversions (funnel OUTCOME layer).
// POC-confirmed (2026-06-23): filter on sessionMedium == "ai-assistant" (the TOKEN, not the
// localizable "AI Assistant" label). Build/parse are pure (mock-testable); fetch needs a token.
// Auth: ONE agency service account → client adds SA email as GA4 property Viewer.
export const GA4_ENDPOINT = (propertyId) =>
  `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;

export function buildRunReportBody({ startDate = '2026-06-07', endDate = 'today' } = {}) {
  return {
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: 'sessionSourceMedium' }, { name: 'date' }],
    metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'keyEvents' }],
    // The displayed channel "AI Assistant" is localizable; the stable token is the medium.
    dimensionFilter: {
      filter: {
        fieldName: 'sessionMedium',
        stringFilter: { matchType: 'EXACT', value: 'ai-assistant' },
      },
    },
    limit: 1000,
  };
}

export function parseRunReport(resp) {
  const rows = resp?.rows || [];
  const byPlatform = {};
  let totalSessions = 0;
  let totalKeyEvents = 0;
  let totalUsers = 0;
  for (const r of rows) {
    const dv = (r.dimensionValues || []).map((d) => d.value);
    const mv = (r.metricValues || []).map((m) => Number(m.value) || 0);
    const sourceMedium = dv[0] || '(unknown)';
    const sessions = mv[0] || 0;
    const users = mv[1] || 0;
    const keyEvents = mv[2] || 0;
    totalSessions += sessions;
    totalUsers += users;
    totalKeyEvents += keyEvents;
    const cur = byPlatform[sourceMedium] || { sessions: 0, keyEvents: 0 };
    cur.sessions += sessions;
    cur.keyEvents += keyEvents;
    byPlatform[sourceMedium] = cur;
  }
  return {
    totalSessions,
    totalUsers,
    totalKeyEvents,
    byPlatform: Object.entries(byPlatform)
      .map(([sourceMedium, v]) => ({ sourceMedium, ...v }))
      .sort((a, b) => b.sessions - a.sessions),
    // Honesty: this is a FLOOR (no-referrer AI clicks leak to Direct), excludes Google
    // AI Overviews/AI Mode, and only has data from ~2026-06-07.
    note: 'AI Assistant 세션은 하한선(무리퍼러→Direct 누수). AI Overviews/AI Mode 제외. 데이터 2026-06-07~.',
  };
}

export async function fetchGa4Ai({ propertyId, accessToken, startDate, endDate, fetchImpl = fetch }) {
  if (!propertyId || !accessToken) throw new Error('ga4-ai: propertyId + accessToken required');
  const res = await fetchImpl(GA4_ENDPOINT(propertyId), {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildRunReportBody({ startDate, endDate })),
  });
  if (!res.ok) throw new Error(`ga4-ai: HTTP ${res.status}`);
  return parseRunReport(await res.json());
}
