// Naver Local Search API — checks if a clinic's domain appears in the top-5
// local search results for "{region} {procedure} 치과".
// IMPORTANT: This is local SEARCH visibility, NOT Naver AI 브리핑/CUE: citation
// (AI 브리핑 has no public API). The result is a proxy: "does this clinic appear
// when a patient searches on Naver for this query?"
//
// Requires: NAVER_CLIENT_ID + NAVER_CLIENT_SECRET (Naver Open API application).
// Without those env vars, this module returns null and the caller skips the check.

const NAVER_LOCAL_URL = 'https://openapi.naver.com/v1/search/local.json';
const MAX_RESULTS = 5;

export function naverApiAvailable() {
  return !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET);
}

export async function checkNaverLocal({ clinicDomain, region, procedure, clientId, clientSecret }) {
  const q = [region, procedure, '치과'].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const url = `${NAVER_LOCAL_URL}?query=${encodeURIComponent(q)}&display=${MAX_RESULTS}&start=1&sort=comment`;

  const r = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': clientId,
      'X-Naver-Client-Secret': clientSecret,
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Naver Local API ${r.status}: ${txt.slice(0, 120)}`);
  }

  const data = await r.json();
  const items = (data.items || []).slice(0, MAX_RESULTS);

  const annotated = items.map((item, idx) => {
    const link = item.link || item.bloggerlink || '';
    const name = stripHtml(item.title || '');
    const matched = !!clinicDomain && domainMatch(link, clinicDomain);
    return { rank: idx + 1, name, link, address: item.address || '', matched };
  });

  const hit = annotated.find((x) => x.matched);
  return {
    engine: 'naver',
    measureMode: 'local-api',
    cited: !!hit,
    rank: hit ? hit.rank : null,
    query: q,
    totalItems: items.length,
    items: annotated,
  };
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').trim();
}

function domainMatch(link, clinicDomain) {
  if (!link) return false;
  try {
    const host = new URL(link.startsWith('http') ? link : 'https://' + link).hostname
      .replace(/^www\./, '').toLowerCase();
    const target = clinicDomain.replace(/^www\./, '').toLowerCase();
    return host === target || host.endsWith('.' + target) || target.endsWith('.' + host);
  } catch { return false; }
}
