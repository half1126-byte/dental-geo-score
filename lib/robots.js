// robots.txt analysis for AI search crawlers.
// POC finding: many KR clinic "robots.txt" URLs actually return the SPA index.html
// (Content-Type text/html, 200) — that is NOT a robots file and must be treated as absent,
// not parsed as "no rules = everything allowed".
//
// v0.4 재작성. v0.3까지의 결함(실측 재현 완료):
//  1) 'gptbot'.includes('bot') 이 참이라 `User-agent: bot` 같은 무관한 그룹이
//     AI 봇 6종을 차단한 것으로 오판했다 → UA는 정확 토큰 일치만 인정한다.
//  2) `Disallow: /*` (국내 빌더 기본 템플릿에 실제로 쓰임)를 "차단 없음"으로 통과시켰다.
//  3) `Disallow: /blog/` 처럼 인용 근거가 실린 경로만 막은 경우를 잡지 못했다.
//  4) `Disallow: / + Allow: /clinic/` 을 전면 차단으로 과대 판정했다.
//  5) 학습 전용 봇(GPTBot·CCBot·Google-Extended)만 막은 신중한 병원을,
//     인용 경로 봇(OAI-SearchBot 등)을 막은 병원과 똑같이 감점했다.
// → RFC 9309(most-specific match, 와일드카드 * 와 종결자 $) 를 구현하고
//   봇을 용도별로 분류해 '인용 경로 차단'만 감점 대상으로 삼는다.

// category:
//   'citation' — 답변에 출처로 실리는 경로. 막으면 인용 후보에서 제외된다(감점 대상).
//   'user'     — 사용자가 링크를 열 때 발생. 공식 문서상 robots.txt를 따르지 않을 수 있다(정보 표기만).
//   'training' — 모델 학습·그라운딩용. 막아도 검색 인용과 무관하다(감점하지 않음).
//   'legacy'   — 공식 문서에서 사라진 폐기 토큰(감점하지 않음).
export const BOT_REGISTRY = [
  // ── 인용 경로 (감점 대상) ─────────────────────────────────────────────
  { token: 'OAI-SearchBot', operator: 'OpenAI', category: 'citation', note: 'ChatGPT 검색 답변의 출처 인용' },
  { token: 'PerplexityBot', operator: 'Perplexity', category: 'citation', note: 'Perplexity 답변의 출처 인용' },
  { token: 'ClaudeBot', operator: 'Anthropic', category: 'citation', note: 'Claude 검색·인용' },
  { token: 'Claude-SearchBot', operator: 'Anthropic', category: 'citation', note: 'Claude 검색 인덱싱' },
  { token: 'Googlebot', operator: 'Google', category: 'citation', note: 'Google AI 개요·AI 모드의 근거가 되는 색인' },
  { token: 'Applebot', operator: 'Apple', category: 'citation', note: 'Siri·Spotlight 검색' },
  { token: 'meta-externalagent', operator: 'Meta', category: 'citation', note: 'Meta AI 검색' },
  { token: 'Amazonbot', operator: 'Amazon', category: 'citation', note: 'Alexa 답변' },
  // ── 사용자 요청형 (감점하지 않음 · 안내만) ────────────────────────────
  { token: 'ChatGPT-User', operator: 'OpenAI', category: 'user', note: '사용자가 링크를 열 때 발생 — robots.txt가 적용되지 않을 수 있음' },
  { token: 'Perplexity-User', operator: 'Perplexity', category: 'user', note: '사용자 요청 기반 접근' },
  { token: 'Claude-User', operator: 'Anthropic', category: 'user', note: '사용자 요청 기반 접근' },
  // ── 학습·그라운딩 전용 (감점하지 않음) ────────────────────────────────
  { token: 'GPTBot', operator: 'OpenAI', category: 'training', note: '모델 학습용 — 검색 인용과 별개' },
  { token: 'Google-Extended', operator: 'Google', category: 'training', note: 'Gemini 학습·그라운딩 — 검색 노출과 무관' },
  { token: 'CCBot', operator: 'Common Crawl', category: 'training', note: '공개 크롤 아카이브' },
  { token: 'Applebot-Extended', operator: 'Apple', category: 'training', note: 'Apple 모델 학습' },
  { token: 'Bytespider', operator: 'ByteDance', category: 'training', note: '학습 수집' },
  // ── 폐기 토큰 (감점하지 않음) ─────────────────────────────────────────
  { token: 'anthropic-ai', operator: 'Anthropic', category: 'legacy', note: 'Anthropic 공식 문서에서 사라진 구 토큰' },
  { token: 'Claude-Web', operator: 'Anthropic', category: 'legacy', note: 'Anthropic 공식 문서에서 사라진 구 토큰' },
];

// 하위호환: 기존 소비처가 import 하던 평면 목록.
export const AI_BOTS = BOT_REGISTRY.map((b) => b.token);
export const CITATION_BOTS = BOT_REGISTRY.filter((b) => b.category === 'citation').map((b) => b.token);

// 인용 근거가 실릴 만한 경로. 루트는 열려 있어도 이쪽이 막히면 실질적으로 인용이 어렵다.
const EVIDENCE_PATHS = ['/', '/blog/', '/column/', '/board/', '/doctors/', '/about/'];

export function analyzeRobots({ status = 0, contentType = '', body = '' } = {}) {
  const looksHtml = /text\/html/i.test(contentType) || /^\s*<(?:!doctype|html)/i.test(body);
  const hasGroups = /user-agent\s*:/i.test(body);
  if (status !== 200 || looksHtml || !hasGroups) {
    return {
      present: false, parseable: false, blocksAny: false, blockedBots: [],
      blockedCitation: [], blockedTraining: [], partialBlocks: [],
      note: 'robots.txt 없음/판정불가 (SPA fallback 또는 미존재)',
    };
  }

  const groups = parseGroups(body);
  const blockedBots = [];      // 하위호환: 루트가 막힌 모든 봇
  const blockedCitation = [];  // 감점 대상
  const blockedTraining = [];  // 정보 표기만
  const partialBlocks = [];    // 루트는 열렸으나 근거 경로가 막힌 경우

  for (const bot of BOT_REGISTRY) {
    const rootBlocked = !pathAllowed(groups, bot.token, '/');
    if (rootBlocked) {
      blockedBots.push(bot.token);
      if (bot.category === 'citation') blockedCitation.push(bot.token);
      else if (bot.category === 'training') blockedTraining.push(bot.token);
      continue;
    }
    if (bot.category !== 'citation') continue;
    const blockedPaths = EVIDENCE_PATHS.filter((p) => p !== '/' && !pathAllowed(groups, bot.token, p));
    if (blockedPaths.length) partialBlocks.push({ bot: bot.token, paths: blockedPaths });
  }

  const sitemap = (body.match(/^\s*sitemap\s*:\s*(\S+)/im) || [])[1] || null;

  let note;
  if (blockedCitation.length) note = `인용 경로 봇 차단: ${blockedCitation.join(', ')}`;
  else if (partialBlocks.length) note = `일부 경로 차단: ${partialBlocks.map((p) => `${p.bot}(${p.paths.join(' ')})`).join(', ')}`;
  else if (blockedTraining.length) note = `학습용 봇만 차단(인용 경로는 허용): ${blockedTraining.join(', ')}`;
  else note = 'AI 크롤러 차단 없음(허용)';

  return {
    present: true,
    parseable: true,
    // blocksAny는 '인용에 영향을 주는 차단'만을 뜻하도록 좁혔다. 학습봇 차단은 감점 사유가 아니다.
    blocksAny: blockedCitation.length > 0,
    blockedBots,
    blockedCitation,
    blockedTraining,
    partialBlocks,
    sitemap,
    note,
  };
}

function parseGroups(body) {
  const lines = body.split(/\r?\n/);
  const groups = [];
  let cur = null;
  let lastWasUa = false;
  for (const raw of lines) {
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

// RFC 9309: 규칙 경로의 '*'는 임의 문자열, 끝의 '$'는 URL 종결을 뜻한다.
// robots.txt는 사용자 입력이므로 정규식 메타문자를 반드시 이스케이프한다(ReDoS 방지).
function ruleMatches(rulePath, urlPath) {
  if (rulePath === '') return false;              // 빈 Disallow = 제한 없음
  if (!rulePath.includes('*') && !rulePath.endsWith('$')) return urlPath.startsWith(rulePath);
  let p = rulePath;
  let anchored = false;
  if (p.endsWith('$')) { anchored = true; p = p.slice(0, -1); }
  const re = p.split('*').map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + re + (anchored ? '$' : '')).test(urlPath);
}

// RFC 9309 그룹 선택: UA 정확 토큰 일치가 '*'보다 우선. 부분문자열 매칭은 쓰지 않는다.
function selectGroup(groups, bot) {
  const ua = bot.toLowerCase();
  const specific = groups.filter((g) => g.agents.includes(ua));
  if (specific.length) {
    // 같은 UA가 여러 그룹에 나오면 규칙을 합친다.
    return {
      disallow: specific.flatMap((g) => g.disallow),
      allow: specific.flatMap((g) => g.allow),
    };
  }
  const star = groups.filter((g) => g.agents.includes('*'));
  if (!star.length) return null;
  return { disallow: star.flatMap((g) => g.disallow), allow: star.flatMap((g) => g.allow) };
}

// RFC 9309 most-specific match: 가장 긴 매칭 규칙이 이긴다. 길이가 같으면 Allow가 이긴다.
export function pathAllowed(groups, bot, urlPath = '/') {
  const group = selectGroup(groups, bot);
  if (!group) return true;
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of group.allow) if (ruleMatches(p, urlPath) && p.length > bestAllow) bestAllow = p.length;
  for (const p of group.disallow) if (ruleMatches(p, urlPath) && p.length > bestDisallow) bestDisallow = p.length;
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}
