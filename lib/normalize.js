// Domain + URL normalization. Uses the Public Suffix List (tldts) so Korean multi-part
// eTLDs (.co.kr/.or.kr/.ne.kr/.go.kr/.pe.kr) and punycode are handled correctly —
// naive "last two labels" matching would treat clinic.co.kr and other.co.kr as equal.
import { getDomain, parse as tldParse } from 'tldts';

/** Registrable domain (eTLD+1), lowercased, IDN-safe. Returns '' if none. */
export function registrableDomain(input) {
  if (!input) return '';
  const host = toHost(input);
  const d = getDomain(host, { allowPrivateDomains: false });
  return (d || host.replace(/^www\./, '')).toLowerCase();
}

function toHost(input) {
  let s = String(input).trim();
  if (!/:\/\//.test(s)) s = 'http://' + s;
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    return String(input).toLowerCase();
  }
}

/**
 * Does a cited URL belong to the target clinic domain?
 * Compares on registrable domain after unwrapping known redirector wrappers.
 */
export function sameRegistrableDomain(citedUrl, targetDomain) {
  const cited = registrableDomain(unwrapRedirect(citedUrl));
  return cited !== '' && cited === registrableDomain(targetDomain);
}

// Many engines wrap citations in tracking/redirect URLs (Vertex AI search, Bing ck,
// Google translate/cache). Pull the real destination out of common query params.
const REDIRECT_HOSTS = [/vertexaisearch\.cloud\.google\.com/i, /\.bing\.com$/i, /translate\.goog$/i, /webcache\.googleusercontent\.com/i];
const URL_PARAMS = ['url', 'u', 'q', 'target', 'dest', 'r'];

export function unwrapRedirect(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return input;
  }
  const isWrapper = REDIRECT_HOSTS.some((re) => re.test(url.hostname));
  if (!isWrapper) return input;
  for (const p of URL_PARAMS) {
    const v = url.searchParams.get(p);
    if (v && /^https?:\/\//i.test(v)) return v;
  }
  return input;
}

// Known platforms where registrable domain = shared infrastructure, not a clinic's own site.
// Inputting these causes false-positive citation matches (e.g. place.naver.com → naver.com
// which matches any blog.naver.com citation in AI results).
const PLATFORM_DOMAINS = new Set([
  'naver.com', 'kakao.com', 'daum.net',
  'instagram.com', 'facebook.com', 'youtube.com', 'youtu.be',
  'tiktok.com', 'twitter.com', 'x.com', 'linkedin.com',
  'blog.me', 'tistory.com',
  'modoo.at', 'imweb.me', 'wix.com', 'cafe24.com', 'makeshop.co.kr',
]);

/** Returns true when the URL is hosted on a shared platform, not a clinic's own domain. */
export function isKnownPlatformDomain(input) {
  const d = registrableDomain(input);
  return d !== '' && PLATFORM_DOMAINS.has(d);
}

export { tldParse };
