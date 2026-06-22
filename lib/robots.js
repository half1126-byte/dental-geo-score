// robots.txt analysis for AI search crawlers.
// POC finding: many KR clinic "robots.txt" URLs actually return the SPA index.html
// (Content-Type text/html, 200) — that is NOT a robots file and must be treated as absent,
// not parsed as "no rules = everything allowed".
export const AI_BOTS = [
  'OAI-SearchBot', // ChatGPT Search (highest citation volume) — ALLOW matters most
  'GPTBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'CCBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'anthropic-ai',
];

export function analyzeRobots({ status = 0, contentType = '', body = '' } = {}) {
  const looksHtml = /text\/html/i.test(contentType) || /^\s*<(?:!doctype|html)/i.test(body);
  const hasGroups = /user-agent\s*:/i.test(body);
  if (status !== 200 || looksHtml || !hasGroups) {
    return { present: false, parseable: false, blocksAny: false, blockedBots: [], note: 'robots.txt 없음/판정불가 (SPA fallback 또는 미존재)' };
  }

  const groups = parseGroups(body);
  const blockedBots = [];
  for (const bot of AI_BOTS) {
    if (rootDisallowed(groups, bot)) blockedBots.push(bot);
  }
  const sitemap = (body.match(/^\s*sitemap\s*:\s*(\S+)/im) || [])[1] || null;
  return {
    present: true,
    parseable: true,
    blocksAny: blockedBots.length > 0,
    blockedBots,
    sitemap,
    note: blockedBots.length ? `AI 봇 차단: ${blockedBots.join(', ')}` : 'AI 크롤러 차단 없음(허용)',
  };
}

function parseGroups(body) {
  const lines = body.split(/\r?\n/);
  const groups = [];
  let cur = null;
  let lastWasUa = false;
  for (let raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasUa) {
        cur = { agents: [], disallow: [], allow: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasUa = true;
    } else if (cur && (field === 'disallow' || field === 'allow')) {
      cur[field].push(value);
      lastWasUa = false;
    } else {
      lastWasUa = false;
    }
  }
  return groups;
}

function rootDisallowed(groups, bot) {
  const ua = bot.toLowerCase();
  // Most specific matching group: exact UA token match beats '*'.
  let specific = groups.find((g) => g.agents.some((a) => a === ua || (a !== '*' && ua.includes(a))));
  let group = specific || groups.find((g) => g.agents.includes('*'));
  if (!group) return false;
  // Disallow: /  (or empty path covering root). Allow overrides an equal/longer match — keep simple: explicit Allow:/ wins.
  const blocksRoot = group.disallow.some((p) => p === '/' || p === '');
  const allowsRoot = group.allow.some((p) => p === '/' );
  // Disallow: (empty) means "allow all"; treat only '/' as a real block.
  const realBlock = group.disallow.some((p) => p === '/');
  return realBlock && !allowsRoot && blocksRoot;
}
