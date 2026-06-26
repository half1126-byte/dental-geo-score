// Real-citation panel (funnel CITATION layer) — "does ChatGPT/Perplexity/Claude actually cite
// this clinic?" Uses the VERIFIED request params (docs/engines) + the verified extractors
// (lib/engines.js). Build/aggregate are pure (mock-testable); live calls need API keys.
import { buildPrompts, isClinicCited, extractAnswerText, AUTO_ENGINES } from './engines.js';

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
    model: loc.model || process.env.OPENAI_SEARCH_MODEL || 'gpt-4o', // override via OPENAI_SEARCH_MODEL env var in Vercel dashboard
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

// Bounded-concurrency parallel map — N repeats × prompts × engines of paid web_search calls must
// fit the 120s function budget; serial await would blow it (autoplan AD-13).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, worker));
  return out;
}

// Aggregate hit-rate per engine across the prompt set (× repeats), with evidence.
// Calls run in bounded-concurrency parallel; the C1/C3 honest-denominator aggregation is unchanged.
export async function runCitationPanel({ clinicDomain, region = '', procedure = '', keys = {}, loc = {}, repeats = 1, concurrency = 6, nowIso = null, fetchImpl = fetch, customPrompts = null }) {
  const system = `You are helping a patient in ${region || '한국'} find a dental clinic. Use web search.`;
  const prompts = (customPrompts && customPrompts.length > 0)
    ? customPrompts.map((q) => (typeof q === 'string' ? { system, user: q } : q))
    : buildPrompts({ district: region, procedure });
  const stamp = nowIso || new Date().toISOString();
  const reps = Math.max(1, Math.min((repeats | 0) || 1, 3)); // server-side clamp (cost + no-fake)
  const engines = AUTO_ENGINES.filter((e) => keys[e]); // only engines with a key

  // flat task list: engine × prompt × repeat → run bounded-parallel
  const tasks = [];
  for (const engine of engines) for (const p of prompts) for (let i = 0; i < reps; i++) tasks.push({ engine, p });
  const outcomes = await mapLimit(tasks, concurrency, async ({ engine, p }) => {
    try {
      const resp = await callEngine(engine, p, { key: keys[engine], loc: { city: region, region, ...loc }, fetchImpl });
      return { engine, p, hit: isClinicCited(engine, resp, clinicDomain), answer: extractAnswerText(engine, resp) };
    } catch (e) {
      return { engine, p, error: String(e?.message || e) };
    }
  });

  const perEngine = engines.map((engine) => {
    let attempts = 0, erroredRuns = 0, inconclusiveRuns = 0, citedRuns = 0;
    const evidence = [];
    const competitors = new Set();
    const answersByPrompt = new Map(); // prompt → {prompt, answer, cited} — operator-only raw AI answer
    for (const o of outcomes) {
      if (o.engine !== engine) continue;
      attempts++;
      if (o.error) {
        erroredRuns++; // engine call threw — NOT a clinic observation (no-fake C1)
        evidence.push({ engine, prompt: o.p.user, error: o.error });
        continue;
      }
      // capture the model's ACTUAL answer text (first non-empty per prompt) — PRIVATE/operator view only
      if (o.answer && !answersByPrompt.has(o.p.user)) {
        answersByPrompt.set(o.p.user, { prompt: o.p.user, answer: String(o.answer).slice(0, 1400), cited: !!(o.hit && o.hit.cited) });
      }
      const hit = o.hit;
      if (!hit.measuredCitations) {
        // engine cited nothing = no search this run; exclude from rate denominator (no-fake C3)
        inconclusiveRuns++;
        evidence.push({ engine, prompt: o.p.user, inconclusive: true, measuredAt: stamp });
        continue;
      }
      (hit.allCitedDomains || []).forEach((d) => competitors.add(d));
      if (hit.cited) {
        citedRuns++;
        evidence.push({ engine, prompt: o.p.user, matchedUrls: hit.matchedUrls, measuredAt: stamp });
      }
    }
    const validRuns = attempts - erroredRuns - inconclusiveRuns; // conclusive observations only
    const measured = validRuns > 0; // "measured" = ≥1 SUCCESSFUL, conclusive observation (no-fake C1)
    return {
      engine,
      attempts,
      validRuns, // denominator for hitRate / Wilson CI — never the raw attempt count
      citedRuns,
      erroredRuns,
      inconclusiveRuns,
      hitRate: validRuns ? +(citedRuns / validRuns).toFixed(2) : 0,
      cited: citedRuns > 0,
      measured,
      unmeasurable: measured ? null : erroredRuns > 0 ? 'engine-error' : inconclusiveRuns > 0 ? 'no-search' : 'no-key',
      evidence,
      sampledCitedDomains: [...competitors].slice(0, 15), // PRIVATE only — redacted from the public view
      sampleAnswers: [...answersByPrompt.values()].slice(0, 3), // PRIVATE only — raw AI answer text per query
    };
  });

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
