// Real-citation panel (funnel CITATION layer) — "does ChatGPT/Perplexity/Claude actually cite
// this clinic?" Uses the VERIFIED request params (docs/engines) + the verified extractors
// (lib/engines.js). Build/aggregate are pure (mock-testable); live calls need API keys.
import { buildPrompts, isClinicCited, extractAnswerText, answerMentionsName, AUTO_ENGINES } from './engines.js';
import { wilsonInterval } from './redact.js';

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
  // Append search mandate to prevent Claude from skipping the tool (no tool_choice:'required' in older SDKs).
  // tool_choice:{type:'tool'} is the correct Anthropic equivalent of OpenAI tool_choice:'required'.
  const forceNote = '반드시 web_search 도구를 사용해 최신 웹 정보를 검색한 후 답변하세요.';
  const combinedSystem = system ? `${system}\n${forceNote}` : forceNote;
  return {
    model: loc.model || process.env.ANTHROPIC_SEARCH_MODEL || 'claude-sonnet-4-6', // override via ANTHROPIC_SEARCH_MODEL env var in Vercel dashboard
    max_tokens: 1024,
    system: combinedSystem,
    tool_choice: { type: 'tool', name: 'web_search' }, // CRITICAL: force search every call (mirrors OpenAI tool_choice:'required')
    messages: [{ role: 'user', content: user }],
    // web_search_20250305: the only version that allows direct tool_choice calling.
    // web_search_20260209/20260318 require allowed_callers=['code_execution'] — 400 on direct call.
    // tool_choice forces search every call; system prompt is backup.
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
  if (!res.ok) {
    let detail = '';
    try { const t = await res.text(); detail = t.slice(0, 200); } catch { /* ignore */ }
    throw new Error(`${engine}: HTTP ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  const json = await res.json();
  // Claude returns HTTP 200 even when web_search fails internally.
  // Detect tool_result error blocks and surface them as thrown errors (→ erroredRun, not inconclusiveRun).
  if (engine === 'claude') {
    for (const block of json?.content || []) {
      if (block.type === 'tool_result' && block.is_error) {
        const code = (block.content || []).map((c) => c.text || '').join(' ').trim() || 'web_search_error';
        throw new Error(`claude: web_search_tool_result error — ${code}`);
      }
    }
  }
  return json;
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
export async function runCitationPanel({ clinicDomain, clinicName = '', aliases = [], region = '', procedure = '', businessType = '치과', keys = {}, loc = {}, repeats = 1, concurrency = 6, nowIso = null, fetchImpl = fetch, customPrompts = null }) {
  const bt = (businessType || '치과').trim();
  const system = `You are helping a user in ${region || '한국'} find a ${bt}. Use web search.`;
  const prompts = (customPrompts && customPrompts.length > 0)
    ? customPrompts.map((q) => (typeof q === 'string' ? { system, user: q } : q))
    : buildPrompts({ district: region, procedure, businessType: bt });
  const stamp = nowIso || new Date().toISOString();
  const reps = Math.max(1, Math.min((repeats | 0) || 1, 3)); // server-side clamp (cost + no-fake)
  const engines = AUTO_ENGINES.filter((e) => keys[e]); // only engines with a key
  // names for the "named in answer" signal — catches a name-mention without a domain link
  const names = [clinicName, ...(Array.isArray(aliases) ? aliases : [])]
    .map((s) => String(s || '').trim()).filter((s) => s.length >= 2);

  // flat task list: engine × prompt × repeat → run bounded-parallel
  const tasks = [];
  for (const engine of engines) for (const p of prompts) for (let i = 0; i < reps; i++) tasks.push({ engine, p });
  const outcomes = await mapLimit(tasks, concurrency, async ({ engine, p }) => {
    try {
      const resp = await callEngine(engine, p, { key: keys[engine], loc: { city: region, region, ...loc }, fetchImpl });
      const answer = extractAnswerText(engine, resp);
      return { engine, p, hit: isClinicCited(engine, resp, clinicDomain), answer, named: answerMentionsName(answer, names) };
    } catch (e) {
      return { engine, p, error: String(e?.message || e) };
    }
  });

  const perEngine = engines.map((engine) => {
    let attempts = 0, erroredRuns = 0, inconclusiveRuns = 0, citedRuns = 0, namedRuns = 0;
    let posTop = 0, posMid = 0, posTail = 0;
    const evidence = [];
    const competitors = new Set();
    const answersByPrompt = new Map(); // prompt → {prompt, answer, cited} — operator-only raw AI answer
    // 질의별 분포. 평균 하나로 뭉치면 "A 질문엔 항상 뜨고 B 질문엔 한 번도 안 뜬다"가 사라진다.
    // 근거: Don't Measure Once (arXiv:2604.07585) — 가시성은 단일 값이 아니라 분포다.
    const byPrompt = new Map(); // prompt → { valid, cited, named, errored, inconclusive }
    const bump = (prompt, field) => {
      if (!byPrompt.has(prompt)) byPrompt.set(prompt, { prompt, valid: 0, cited: 0, named: 0, errored: 0, inconclusive: 0 });
      byPrompt.get(prompt)[field]++;
    };
    for (const o of outcomes) {
      if (o.engine !== engine) continue;
      attempts++;
      if (o.error) bump(o.p.user, 'errored');
      else if (!o.hit || !o.hit.measuredCitations) bump(o.p.user, 'inconclusive');
      else {
        bump(o.p.user, 'valid');
        if (o.hit.cited) bump(o.p.user, 'cited');
        if (o.named) bump(o.p.user, 'named');
      }
      if (o.error) {
        erroredRuns++; // engine call threw — NOT a clinic observation (no-fake C1)
        evidence.push({ engine, prompt: o.p.user, error: o.error });
        continue;
      }
      if (o.named) namedRuns++; // model named the clinic in its answer text (link-independent)
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
        if (hit.mentionPosition === 'top') posTop++;
        else if (hit.mentionPosition === 'mid') posMid++;
        else if (hit.mentionPosition === 'tail') posTail++;
        evidence.push({ engine, prompt: o.p.user, matchedUrls: hit.matchedUrls, measuredAt: stamp });
      }
    }
    const validRuns = attempts - erroredRuns - inconclusiveRuns; // conclusive observations only
    const measured = validRuns > 0; // "measured" = ≥1 SUCCESSFUL, conclusive observation (no-fake C1)

    // 질의별 분포 — 유효 관측이 있는 질의만. 분모가 0인 질의는 '미측정'이지 '미인용'이 아니다.
    const promptRows = [...byPrompt.values()]
      .map((r) => ({ ...r, rate: r.valid ? +(r.cited / r.valid).toFixed(2) : null }))
      .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1));
    const scored = promptRows.filter((r) => r.valid > 0);
    const alwaysCited = scored.filter((r) => r.rate === 1).length;
    const neverCited = scored.filter((r) => r.rate === 0).length;
    // 분산도: 질의마다 결과가 갈리는 정도. 전부 1이거나 전부 0이면 0(일관), 반반이면 1(불안정).
    const spread = scored.length
      ? +(1 - Math.abs((alwaysCited - neverCited) / scored.length)).toFixed(2)
      : null;
    const distribution = scored.length
      ? {
        promptsScored: scored.length,
        alwaysCited,
        neverCited,
        sometimesCited: scored.length - alwaysCited - neverCited,
        spread, // 0 = 질의와 무관하게 일관 / 1 = 질의에 따라 갈림
        // 반복 호출을 켰을 때만 의미가 있다. reps=1이면 회차 변동을 관측할 수 없다.
        repeatsPerPrompt: reps,
        note: reps < 2
          ? '1회 측정이라 회차 변동은 관측되지 않았습니다. 반복 측정으로만 확인됩니다.'
          : null,
      }
      : null;

    return {
      engine,
      attempts,
      validRuns, // denominator for hitRate / Wilson CI — never the raw attempt count
      citedRuns,
      namedRuns, // runs where the model NAMED the clinic in its answer (link-independent accuracy)
      mentionPositions: { top: posTop, mid: posMid, tail: posTail },
      erroredRuns,
      inconclusiveRuns,
      hitRate: validRuns ? +(citedRuns / validRuns).toFixed(2) : 0,
      cited: citedRuns > 0,
      // exposed = linked (own-domain URL cited) OR named (clinic named in answer). The true
      // "is this clinic surfacing at all" signal — fixes the directory/name-mention false-negative.
      exposed: citedRuns > 0 || namedRuns > 0,
      // Wilson CI on the linked citation rate. Only on a real conclusive sample WITH ≥1 citation —
      // never a fabricated band next to 0 (의료광고법 A-2). Operator view shows it; public view gates too.
      ci: citedRuns > 0 && validRuns >= 2 ? wilsonInterval(citedRuns, validRuns) : null,
      measured,
      unmeasurable: measured ? null : erroredRuns > 0 ? 'engine-error' : inconclusiveRuns > 0 ? 'no-search' : 'no-key',
      // 분포 — hitRate 하나로는 "어떤 질의에서 뜨고 어떤 질의에서 안 뜨는지"가 사라진다.
      distribution,
      perPrompt: promptRows,
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
