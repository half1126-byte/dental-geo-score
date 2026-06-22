// Cloudflare GraphQL connector — AI crawler hits per bot (funnel CRAWL/eligibility layer).
// POC-confirmed (2026-06-23): httpRequestsAdaptiveGroups + botDetectionIds (PRECISE, needs
// Enterprise + Bot Management) OR userAgent matching (FALLBACK, all plans, spoofable).
// A clinic blocking OAI-SearchBot can never be cited → cf-aibots explains a 0 citation.
// Auth: per-client API token, permission Account > Account Analytics > Read.
export const CF_ENDPOINT = 'https://api.cloudflare.com/client/v4/graphql';

// Verified numeric bot detection IDs (two ids for some bots — include BOTH to avoid undercount).
export const BOT_DETECTION_IDS = {
  GPTBot: [123815556, 33563875],
  'OAI-SearchBot': [126255384, 33563986],
  'ChatGPT-User': [132995013, 33563857],
  ClaudeBot: [33563859],
  'Claude-SearchBot': [33564301],
  'Claude-User': [33564303],
  PerplexityBot: [33563889],
  'Perplexity-User': [33564371],
};

// Search/user bots worth allowing (citation-driving) — used for UA fallback matching order.
export const UA_BOTS = ['OAI-SearchBot', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'ChatGPT-User', 'Perplexity-User', 'Claude-User', 'GPTBot'];

function idToBotMap() {
  const m = {};
  for (const [bot, ids] of Object.entries(BOT_DETECTION_IDS)) for (const id of ids) m[id] = bot;
  return m;
}

export function buildGraphQLQuery({ zoneTag, since, until, mode = 'precise' }) {
  if (mode === 'precise') {
    const ids = [...new Set(Object.values(BOT_DETECTION_IDS).flat())];
    const query =
      `query($zoneTag:String!,$since:Time!,$until:Time!,$ids:[uint32!]){` +
      `viewer{zones(filter:{zoneTag:$zoneTag}){` +
      `httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:$since,datetime_leq:$until,requestSource:"eyeball",botDetectionIds_hasany:$ids}){` +
      `count dimensions{botDetectionIds clientRequestPath}}}}}`;
    return { query, variables: { zoneTag, since, until, ids } };
  }
  // fallback: UA substring match (all plans; spoofable → counts UNVERIFIED)
  const query =
    `query($zoneTag:String!,$since:Time!,$until:Time!,$ua:String!){` +
    `viewer{zones(filter:{zoneTag:$zoneTag}){` +
    `httpRequestsAdaptiveGroups(limit:1000,filter:{datetime_geq:$since,datetime_leq:$until,requestSource:"eyeball",userAgent_like:$ua}){` +
    `count dimensions{userAgent}}}}}`;
  return { query, variables: { zoneTag, since, until, ua: '%bot%' } };
}

export function parseBotGroups(resp, mode = 'precise') {
  const zones = resp?.data?.viewer?.zones || [];
  const groups = zones[0]?.httpRequestsAdaptiveGroups || [];
  const map = idToBotMap();
  const perBot = {};
  let total = 0;
  for (const g of groups) {
    const count = g.count || 0;
    total += count;
    let bot;
    if (mode === 'precise') {
      const ids = g.dimensions?.botDetectionIds || [];
      bot = ids.map((i) => map[i]).find(Boolean) || `id:${ids.join(',')}`;
    } else {
      const ua = g.dimensions?.userAgent || '(ua)';
      bot = UA_BOTS.find((b) => ua.includes(b)) || ua.slice(0, 40);
    }
    perBot[bot] = (perBot[bot] || 0) + count;
  }
  return {
    total,
    perBot: Object.entries(perBot)
      .map(([bot, count]) => ({ bot, count }))
      .sort((a, b) => b.count - a.count),
    mode,
    // searchbots crawling = citation eligibility; a 0 here means the engine literally can't cite you.
    searchBotsCrawling: Object.keys(perBot).some((b) => UA_BOTS.includes(b)),
    note:
      mode === 'precise'
        ? '정밀(botDetectionIds, Enterprise+Bot Management). 非Ent 보존 ~72h.'
        : 'UA 폴백(스푸핑 가능 → 카운트 UNVERIFIED). Free/Pro 가능.',
  };
}

export async function fetchCfAiBots({ zoneTag, apiToken, since, until, mode = 'precise', fetchImpl = fetch }) {
  if (!zoneTag || !apiToken) throw new Error('cf-aibots: zoneTag + apiToken required');
  const { query, variables } = buildGraphQLQuery({ zoneTag, since, until, mode });
  const res = await fetchImpl(CF_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`cf-aibots: HTTP ${res.status}`);
  return parseBotGroups(await res.json(), mode);
}
