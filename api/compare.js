// POST /api/compare { userUrl, compUrl, userScore?, compScore?, userCited? } — operator-only.
// Self-contained competitor teardown: fetches BOTH sites (SSRF-safe), extracts signals/schema/meta,
// scores both, and returns a render-ready diff + improvement plan. Replaces the old 3-call flow
// (/api/score + /api/page-source ×2). Competitor data stays behind the operator-key gate.
import { safeFetch, FetchBlockedError } from '../lib/fetcher.js';
import { analyzeRobots } from '../lib/robots.js';
import { extractSignals, extractTeardown } from '../lib/extract.js';
import { scorePage } from '../lib/scorer.js';
import { registrableDomain } from '../lib/normalize.js';
import { buildComparePackage, embeddableFromHeaders } from '../lib/compare.js';

export const config = { runtime: 'nodejs', maxDuration: 40 };

// Real-browser UA + retry: re-fetching an already-measured page is fragile (slow sites, transient
// drops, per-IP rate-limit on repeat hits). A browser UA + one retry on TRANSIENT errors makes it
// resilient. Hard SSRF blocks (blocked-ip/bad-scheme/…) are NEVER retried — security stays intact.
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const HARD_BLOCK = /blocked-ip|bad-scheme|bad-port|invalid-url|userinfo|too-many-redirects|body-too-large/;

async function fetchResilient(url, opts) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await safeFetch(url, opts);
    } catch (e) {
      lastErr = e;
      if (e instanceof FetchBlockedError && HARD_BLOCK.test(e.reason || '')) throw e; // don't retry hard SSRF blocks
    }
  }
  throw lastErr;
}

async function buildProfile(url, hintedScore) {
  const page = await fetchResilient(url, { timeoutMs: 11000, maxBytes: 1_500_000, userAgent: BROWSER_UA });

  let robots = { present: false, parseable: false, blocksAny: false, blockedBots: [], sitemap: null };
  try {
    const r = await safeFetch(new URL('/robots.txt', page.finalUrl).href, { timeoutMs: 4000, maxBytes: 300_000, userAgent: BROWSER_UA });
    robots = analyzeRobots(r);
  } catch {
    // robots.txt optional — absence is informational, not an error
  }

  const signals = extractSignals(page.body);
  const scored = scorePage({ robots, signals });

  return {
    domain: registrableDomain(page.finalUrl),
    finalUrl: page.finalUrl,
    score: hintedScore != null && Number.isFinite(Number(hintedScore)) ? Number(hintedScore) : scored.score,
    breakdown: scored.breakdown,
    signals: {
      hasStatistics: signals.hasStatistics,
      hasQuotations: signals.hasQuotations,
      hasCitedSources: signals.hasCitedSources,
    },
    schema: (signals.jsonld && signals.jsonld.schema) || {},
    meta: {
      title: signals.title,
      metaDescription: signals.metaDescription,
      canonical: signals.canonical,
      ogTitle: signals.ogTitle,
      ogDescription: signals.ogDescription,
      ogImage: signals.ogImage,
      viewport: signals.viewport,
      robotsMeta: signals.robotsMeta,
    },
    content: {
      h1Count: signals.h1Count,
      h2Count: signals.h2Count,
      questionH2: signals.questionH2,
      tables: signals.tables,
      faqBlocks: signals.faqBlocks,
      credentials: signals.credentials,
      social: signals.social,
      dateSignals: signals.dateSignals,
      wordCount: signals.visibleLen,
    },
    teardown: extractTeardown(page.body),
    embeddable: embeddableFromHeaders(page.headers),
  };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ error: 'method-not-allowed' }); return; }

  // Operator gate (mirrors api/page-source.js).
  const isOperator = !!process.env.OPERATOR_KEY &&
    req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (!isOperator) {
    res.status(401).json({ error: 'operator-key-required' });
    return;
  }

  const { userUrl, compUrl, userScore, compScore, userCited, userProfile } = req.body || {};
  if (!compUrl || typeof compUrl !== 'string') {
    res.status(400).json({ error: 'missing-url', message: 'compUrl 필드가 필요합니다.' });
    return;
  }
  // Prefer the client-provided user profile (from /api/score) → skip the fragile re-fetch of the
  // user's OWN site (the failure the operator hit). Live-fetch fallback only if no valid profile.
  const haveUserProfile = userProfile && Array.isArray(userProfile.breakdown) && userProfile.breakdown.length > 0;
  if (!haveUserProfile && (!userUrl || typeof userUrl !== 'string')) {
    res.status(400).json({ error: 'missing-url', message: 'userUrl 또는 userProfile이 필요합니다.' });
    return;
  }

  try {
    const [userRes, compRes] = await Promise.allSettled([
      haveUserProfile ? Promise.resolve(userProfile) : buildProfile(userUrl, userScore),
      buildProfile(compUrl, compScore),
    ]);

    if (userRes.status !== 'fulfilled' || compRes.status !== 'fulfilled') {
      const failed = userRes.status !== 'fulfilled' ? 'user' : 'comp';
      const err = (userRes.status !== 'fulfilled' ? userRes.reason : compRes.reason) || {};
      const blocked = err instanceof FetchBlockedError;
      res.status(blocked ? 422 : 502).json({
        error: blocked ? 'fetch-blocked' : 'fetch-failed',
        side: failed,
        reason: err.reason || null,
        message: failed === 'user'
          ? '측정 대상 사이트를 다시 불러오지 못했습니다 (느리거나 일시적 차단). 잠시 후 다시 시도해 주세요.'
          : '경쟁 치과 사이트를 불러오지 못했습니다 (느리거나 일시적 차단). 잠시 후 다시 시도해 주세요.',
      });
      return;
    }

    const pkg = buildComparePackage(userRes.value, compRes.value, { userCited: userCited === true ? true : userCited === false ? false : undefined });
    res.status(200).json(pkg);
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
