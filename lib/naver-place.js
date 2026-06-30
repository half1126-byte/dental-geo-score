// Naver Place GraphQL client — searches pcmap-api.place.naver.com
//
// Data source: Naver's internal Apollo GraphQL API (public-facing data only).
// CSRF bypass: Content-Type: application/json + apollo-require-preflight header.
// Operator-gated: results contain competitor data → must never reach public view.
//
// Confirmed available fields (2026-06-30 probe):
//   id, name, category, address, roadAddress, phone, x, y,
//   visitorReviewCount, blogCafeReviewCount, bookingReviewCount, imageCount, businessHours
//
// NOT available (Private Smart Place data):
//   saveCount/bookmarkCount, starScore/rating, naturalVisitRate, callClicks

const GRAPHQL_URL = 'https://pcmap-api.place.naver.com/place/graphql';
const PAGE_SIZE = 30; // API returns 30 per call; start=1 gives items 1-30

const PLACE_QUERY = `
query getPlaces($input: PlacesInput!) {
  places(input: $input) {
    total
    items {
      id
      name
      category
      address
      roadAddress
      phone
      x
      y
      visitorReviewCount
      blogCafeReviewCount
      bookingReviewCount
      imageCount
      businessHours
    }
  }
}
`.trim();

/**
 * Search Naver Place for "{region} {procedure} 치과" and return up to PAGE_SIZE items.
 * @param {string} query - search text
 * @param {number} start - 1-based start index for pagination
 * @param {object} [fetchOverride] - injectable fetch for testing
 */
export async function searchNaverPlaces(query, { start = 1, fetch: fetchFn } = {}) {
  const fetchImpl = fetchFn || globalThis.fetch;
  if (!fetchImpl) throw new Error('fetch not available');

  const body = JSON.stringify({
    operationName: 'getPlaces',
    variables: { input: { query, start } },
    query: PLACE_QUERY,
  });

  const res = await fetchImpl(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apollo-require-preflight': 'true',
      'x-apollo-operation-name': 'getPlaces',
      'User-Agent':
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      'Origin': 'https://m.place.naver.com',
      'Referer': 'https://m.place.naver.com/',
      'Accept': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Naver Place API HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) throw new Error(`Naver Place GraphQL: ${json.errors[0]?.message}`);

  return json.data?.places ?? { total: 0, items: [] };
}

/**
 * Parse Naver's comma-formatted number strings ("2,203" → 2203).
 */
export function parseNaverInt(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  const n = parseInt(String(val).replace(/,/g, ''), 10);
  return isNaN(n) ? null : n;
}

/**
 * Normalize a raw PlaceSummary item into a clean object.
 */
export function normalizePlace(item) {
  return {
    id: item.id,
    naverUrl: `https://place.naver.com/hospital/${item.id}`,
    name: item.name,
    category: item.category || null,
    address: item.address || null,
    roadAddress: item.roadAddress || null,
    phone: item.phone || null,
    coords:
      item.x && item.y
        ? { lng: parseFloat(item.x), lat: parseFloat(item.y) }
        : null,
    visitorReviews: parseNaverInt(item.visitorReviewCount),
    blogReviews: parseNaverInt(item.blogCafeReviewCount),
    bookingReviews: parseNaverInt(item.bookingReviewCount),
    photos: typeof item.imageCount === 'number' ? item.imageCount : null,
    businessHours: item.businessHours || null,
  };
}

/**
 * Try to find the target clinic in a list of normalized places.
 * Matching priority: exact phone > phone last-7 > name includes.
 * Returns null if no match found.
 */
export function findTargetClinic(items, { clinicPhone, clinicName } = {}) {
  if (!items?.length) return null;

  // Normalize phone for comparison (digits only)
  const normPhone = (p) => String(p || '').replace(/\D/g, '');
  const targetPhone = normPhone(clinicPhone);
  const targetName = (clinicName || '').trim().toLowerCase();

  // Exact phone match
  if (targetPhone.length >= 7) {
    const byPhone = items.find(
      (it) => it.phone && normPhone(it.phone) === targetPhone
    );
    if (byPhone) return byPhone;

    // Last-7-digits phone match (accounts for area code formatting)
    const last7 = targetPhone.slice(-7);
    const byPhone7 = items.find(
      (it) => it.phone && normPhone(it.phone).endsWith(last7)
    );
    if (byPhone7) return byPhone7;
  }

  // Name includes match
  if (targetName) {
    const byName = items.find(
      (it) => it.name && it.name.toLowerCase().includes(targetName)
    );
    if (byName) return byName;
  }

  return null;
}

/**
 * Main entry point: search for a query, return normalized items + target match.
 * @param {{ query: string, clinicPhone?: string, clinicName?: string, fetch?: Function }} opts
 */
export async function getNaverPlaceData({ query, clinicPhone, clinicName, fetch: fetchFn } = {}) {
  if (!query?.trim()) throw new Error('query is required');

  const raw = await searchNaverPlaces(query, { fetch: fetchFn });
  const items = (raw.items || []).map(normalizePlace);

  const target = findTargetClinic(items, { clinicPhone, clinicName });
  const targetRank = target ? items.findIndex((it) => it.id === target.id) + 1 : null;

  // Competitors = top items excluding the target (max 5)
  const competitors = items
    .filter((it) => !target || it.id !== target.id)
    .slice(0, 5);

  return {
    query,
    total: raw.total,
    target: target || null,
    targetRank,
    competitors,
    parsedAt: new Date().toISOString(),
    dataNote:
      '공개 파싱 데이터(방문자리뷰·블로그리뷰·사진수). 저장수·별점·자연유입비율은 Smart Place 전용으로 제공 불가.',
  };
}
