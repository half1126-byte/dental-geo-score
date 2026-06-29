// Full heuristic audit pipeline: SSRF-safe fetch → robots → signal extraction → score.
// Shared by the CLI and the /api/score serverless function.
import { safeFetch, FetchBlockedError } from './fetcher.js';
import { analyzeRobots } from './robots.js';
import { extractSignals, extractTeardown } from './extract.js';
import { scorePage } from './scorer.js';
import { buildAgentActionability } from './agent-score.js';
import { registrableDomain } from './normalize.js';
import { embeddableFromHeaders } from './compare.js';

export async function auditUrl(inputUrl, opts = {}) {
  const page = await safeFetch(inputUrl, opts);

  let robots = { present: false, parseable: false, blocksAny: false, blockedBots: [], sitemap: null };
  let hasLlmsTxt = false;
  try {
    const [robotsRes, llmsRes] = await Promise.allSettled([
      safeFetch(new URL('/robots.txt', page.finalUrl).href, opts),
      safeFetch(new URL('/llms.txt', page.finalUrl).href, opts),
    ]);
    if (robotsRes.status === 'fulfilled') robots = analyzeRobots(robotsRes.value);
    if (llmsRes.status === 'fulfilled' && llmsRes.value.status === 200) hasLlmsTxt = true;
  } catch {
    // robots.txt / llms.txt are optional; absence is informational
  }

  const signals = extractSignals(page.body);
  const scored = scorePage({ robots, signals });
  // SEPARATE capability layer — sibling key, deliberately NOT merged into scored.score (0-100).
  const agentActionability = buildAgentActionability(signals);

  return {
    url: inputUrl,
    finalUrl: page.finalUrl,
    domain: registrableDomain(page.finalUrl),
    // best-effort business name for the citation "named in answer" signal (first title segment)
    clinicNameGuess: (signals.title || signals.ogTitle || '').split(/[|–—:·ㅣ-]/)[0].trim().slice(0, 40),
    httpStatus: page.status,
    renderMode: signals.needsHeadless
      ? 'js-shell (휴리스틱 제한 — 정밀 측정은 헤드리스 필요)'
      : 'server-rendered',
    redirectChain: page.redirectChain,
    sitemap: robots.sitemap || null,
    ...scored,
    agentActionability,
    locationGuess: signals.locationGuess, // auto-detected region (operator confirms) — null if unparseable
    procedureGuess: signals.procedureGuess, // detected procedures, ranked by frequency
    hasLlmsTxt,    // metadata: llms.txt existence (score-neutral)
    hasMapEmbed: signals.hasMapEmbed,  // metadata: Google Maps embed detected (score-neutral)
    hasPriceInfo: signals.hasPriceInfo, // metadata: 비급여 가격 키워드 detected (score-neutral)
    // GEO citation signal subset (operator UI — renderHygiene reads these from d.signals / d.jsonld)
    signals: {
      hasStatistics: signals.hasStatistics,
      hasQuotations: signals.hasQuotations,
      hasCitedSources: signals.hasCitedSources,
    },
    jsonld: signals.jsonld,
    // Pre-extracted profile so /api/compare can reuse the USER side WITHOUT a fragile live re-fetch
    // (some sites block/throttle the repeat hit). The competitor side is still fetched fresh.
    compareProfile: {
      finalUrl: page.finalUrl,
      embeddable: embeddableFromHeaders(page.headers),
      schema: (signals.jsonld && signals.jsonld.schema) || {},
      meta: {
        title: signals.title, metaDescription: signals.metaDescription, canonical: signals.canonical,
        ogTitle: signals.ogTitle, ogDescription: signals.ogDescription, ogImage: signals.ogImage,
        viewport: signals.viewport, robotsMeta: signals.robotsMeta,
      },
      content: {
        h1Count: signals.h1Count, h2Count: signals.h2Count, questionH2: signals.questionH2,
        tables: signals.tables, faqBlocks: signals.faqBlocks, credentials: signals.credentials,
        social: signals.social, dateSignals: signals.dateSignals, wordCount: signals.visibleLen,
      },
      teardown: extractTeardown(page.body),
    },
  };
}

export { FetchBlockedError };
