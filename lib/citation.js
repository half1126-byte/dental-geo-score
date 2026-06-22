// Real-citation panel (funnel CITATION layer) — "does ChatGPT/Perplexity/Claude actually cite
// this clinic?" Uses the VERIFIED request params (docs/engines) + the verified extractors
// (lib/engines.js). Build/aggregate are pure (mock-testable); live calls need API keys.
import { buildPrompts, isClinicCited, AUTO_ENGINES } from './engines.js';

// --- request builders (verified params) ---
export function buildOpenAIRequest({ system, user }, loc = {}) {
  const userLocation = {
    type: 'approximate',
    country: 'KR',
    timezone: 'Asia/Seoul',
    ...(loc.city ? { city: loc.city } : {}),
    ...(loc.region ? { region: loc.region } : {}),
  };
  return {
    model: loc.model || 'gpt-5-search-api', // verify vs account; gpt-4o-search-preview deprecates 2026-07-23
    tools: [{ type: 'web_search', user_location: userLocation }],
    tool_choice: 'required', // CRITICAL: default 'auto' skips search → ~2% hit-rate collapse
    input: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }],
  };
}

export function buildPerplexityRequest({ user }, loc = {}) {
  return {
    model: loc.model || 'sonar',
    messages: [{ role: 'user', content: user }],
    web_search_options: {
      user_location: {
        country: 'KR',
        ...(loc.city ? { city: loc.city } : {}),
        ...(loc.region ? { region: loc.region } : {}),
        ...(loc.latitude != null ? { latitude: loc.latitude, longitude: loc.longitude } : {}),
      },
    },
  };
}

export function buildClaudeRequest({ system, user }, loc = {}) {
  return {
    model: loc.model || 'claude-sonnet-4-6',
    max_tokens: 1024,
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content: user }],
    // web_search_20250305 (basic; only variant on Vertex). NOT the hallucinated _20260318.
    tools: [{
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 3,
      user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul', ...(loc.city ? { city: loc.city } : {}), ...(loc.region ? { region: loc.region } : {}) },
    }],
  };
}

export const ENGINE_API = {
  chatgpt: { url: 'https://api.openai.com/v1/responses', envKey: 'OPENAI_API_KEY', headers: (k) => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' }), body: buildOpenAIRequest },
  perplexity: { url: 'https://api.perplexity.ai/chat/completions', envKey: 'PERPLEXITY_API_KEY', headers: (k) => ({ authorization: `Bearer ${k}`, 'content-type': 'application/json' }), body: buildPerplexityRequest },
  claude: { url: 'https://api.anthropic.com/v1/messages', envKey: 'ANTHROPIC_API_KEY', headers: (k) => ({ 'x-api-key': k, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }), body: buildClaudeRequest },
};

export async function callEngine(engine, promptObj, { key, loc = {}, fetchImpl = fetch }) {
  const cfg = ENGINE_API[engine];
  if (!cfg) throw new Error('unknown engine ' + engine);
  const res = await fetchImpl(cfg.url, { method: 'POST', headers: cfg.headers(key), body: JSON.stringify(cfg.body(promptObj, loc)) });
  if (!res.ok) throw new Error(`${engine}: HTTP ${res.status}`);
  return res.json();
}

// Aggregate hit-rate per engine across the prompt set (× repeats), with evidence.
export async function runCitationPanel({ clinicDomain, region = '', procedure = '', keys = {}, loc = {}, repeats = 1, nowIso = null, fetchImpl = fetch }) {
  const prompts = buildPrompts({ district: region, procedure });
  const stamp = nowIso || new Date().toISOString();
  const perEngine = [];
  for (const engine of AUTO_ENGINES) {
    const key = keys[engine];
    if (!key) continue; // run only engines with a key
    let runs = 0;
    let citedRuns = 0;
    const evidence = [];
    const competitors = new Set();
    for (const p of prompts) {
      for (let i = 0; i < repeats; i++) {
        runs++;
        try {
          const resp = await callEngine(engine, p, { key, loc: { city: region, region, ...loc }, fetchImpl });
          const hit = isClinicCited(engine, resp, clinicDomain);
          (hit.allCitedDomains || []).forEach((d) => competitors.add(d));
          if (hit.cited) {
            citedRuns++;
            evidence.push({ engine, prompt: p.user, matchedUrls: hit.matchedUrls, measuredAt: stamp });
          }
        } catch (e) {
          evidence.push({ engine, prompt: p.user, error: String(e?.message || e) });
        }
      }
    }
    perEngine.push({
      engine,
      runs,
      citedRuns,
      hitRate: runs ? +(citedRuns / runs).toFixed(2) : 0,
      cited: citedRuns > 0,
      // empty (runs>0, citedRuns=0) = "측정됨, 이 회차엔 미인용"; runs=0 = not measured.
      measured: runs > 0,
      evidence,
      sampledCitedDomains: [...competitors].slice(0, 15),
    });
  }
  return {
    clinicDomain,
    region,
    procedure,
    perEngine,
    measuredAt: stamp,
    note: 'API 기준 인용(소비자 앱과 다를 수 있음). 빈 인용 = 측정됨·미인용 ≠ 미측정. N회·문구변형 집계 권장.',
  };
}

export { AUTO_ENGINES };
