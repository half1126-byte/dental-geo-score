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

export const config = { runtime: 'nodejs', maxDuration: 25 };

async function buildProfile(url, hintedScore) {
  const page = await safeFetch(url, { timeoutMs: 8000, maxBytes: 1_500_000 });

  let robots = { present: false, parseable: false, blocksAny: false, blockedBots: [], sitemap: null };
  try {
    const r = await safeFetch(new URL('/robots.txt', page.finalUrl).href, { timeoutMs: 5000, maxBytes: 300_000 });
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
  const operatorKeySet = !!process.env.OPERATOR_KEY;
  const isOperator = operatorKeySet && req.headers['x-operator-key'] === process.env.OPERATOR_KEY;
  if (operatorKeySet && !isOperator) {
    res.status(401).json({ error: 'operator-key-required' });
    return;
  }

  const { userUrl, compUrl, userScore, compScore, userCited } = req.body || {};
  if (!userUrl || typeof userUrl !== 'string' || !compUrl || typeof compUrl !== 'string') {
    res.status(400).json({ error: 'missing-url', message: 'userUrl·compUrl 필드가 필요합니다.' });
    return;
  }

  try {
    const [userRes, compRes] = await Promise.allSettled([
      buildProfile(userUrl, userScore),
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
        message: failed === 'user' ? '측정 대상 URL을 가져올 수 없습니다.' : '경쟁 치과 URL을 가져올 수 없습니다.',
      });
      return;
    }

    const pkg = buildComparePackage(userRes.value, compRes.value, { userCited: userCited === true ? true : userCited === false ? false : undefined });
    res.status(200).json(pkg);
  } catch (e) {
    res.status(500).json({ error: 'internal', message: String(e?.message || e).slice(0, 200) });
  }
}
