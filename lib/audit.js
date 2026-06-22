// Full heuristic audit pipeline: SSRF-safe fetch → robots → signal extraction → score.
// Shared by the CLI and the /api/score serverless function.
import { safeFetch, FetchBlockedError } from './fetcher.js';
import { analyzeRobots } from './robots.js';
import { extractSignals } from './extract.js';
import { scorePage } from './scorer.js';
import { registrableDomain } from './normalize.js';

export async function auditUrl(inputUrl, opts = {}) {
  const page = await safeFetch(inputUrl, opts);

  let robots = { present: false, parseable: false, blocksAny: false, blockedBots: [], sitemap: null };
  try {
    const robotsUrl = new URL('/robots.txt', page.finalUrl).href;
    const r = await safeFetch(robotsUrl, opts);
    robots = analyzeRobots(r);
  } catch {
    // robots.txt is optional; absence is itself a (low-weight) signal handled by analyzeRobots default
  }

  const signals = extractSignals(page.body);
  const scored = scorePage({ robots, signals });

  return {
    url: inputUrl,
    finalUrl: page.finalUrl,
    domain: registrableDomain(page.finalUrl),
    httpStatus: page.status,
    renderMode: signals.needsHeadless
      ? 'js-shell (휴리스틱 제한 — 정밀 측정은 헤드리스 필요)'
      : 'server-rendered',
    redirectChain: page.redirectChain,
    sitemap: robots.sitemap || null,
    ...scored,
  };
}

export { FetchBlockedError };
