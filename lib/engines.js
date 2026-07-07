// Per-engine measurement + optimization config, derived from docs/engines/ (verified 2026-06-22).
// Citation field paths are the VERIFIED ones; the extractors below implement them so Phase 2's
// /api/citation can detect "is this clinic cited" per engine.
import { sameRegistrableDomain, registrableDomain } from './normalize.js';

export const ENGINES = {
  chatgpt: {
    name: 'ChatGPT (OpenAI)',
    measureMode: 'auto-api',
    api: 'OpenAI Responses API + web_search tool',
    citationPath: 'output[type=message].content[type=output_text].annotations[type=url_citation].url',
    crossCheck: 'response.sources / web_search_call.action.sources (consulted != cited)',
    locationParam: { field: 'user_location', value: { country: 'KR', city: '', region: '', timezone: 'Asia/Seoul' } },
    krWeight: 'medium',
    topLevers: [
      'OAI-SearchBot 허용 (robots.txt + CDN/WAF IP 허용) — 비협상 게이트',
      '검증 가능한 교차웹 권위 (의료진 실명·자격·깊이·제3자 멘션)',
      '재작성 질의에 맞춘 위치+시술 명시 페이지',
      'user_location {country:KR, city, region, timezone:Asia/Seoul}',
    ],
    caveats: ['tool_choice를 강제하지 않되 sources[] 교차확인(빈 annotation 함정)', '소비자 앱 ≠ API 백엔드 — 프록시'],
  },
  claude: {
    name: 'Claude (Anthropic)',
    measureMode: 'auto-api',
    api: '/v1/messages + web_search_20250305 (Vertex 유일) / 20260209',
    citationPath: "content[].citations[](type='web_search_result_location').url",
    crossCheck: '원천: web_search_tool_result.content[] web_search_result',
    locationParam: { field: 'user_location', value: { country: 'KR', city: '', region: '', timezone: 'Asia/Seoul' } },
    krWeight: 'medium',
    topLevers: [
      '표준 크롤 가능 웹 SEO (맵팩 없음)',
      '텍스트 추출/answer-shaped 상단 평문(상호·전문의·동네·주소·시간)',
      'Claude 앱이면 search_result 블록/allowed_domains로 자체 DB 주입',
      'user_location 으로 질의 지역화',
    ],
    caveats: ['web_search_20260318 은 환각 → 사용 금지', '$10/1k·150자 캡은 라이브 재확인 전 단정 금지', '측정 모델 기본 claude-sonnet-4-6 — ANTHROPIC_SEARCH_MODEL env로 오버라이드'],
  },
  perplexity: {
    name: 'Perplexity (Sonar)',
    measureMode: 'auto-api',
    api: 'Sonar chat-completions',
    citationPath: 'search_results[].url (+ top-level citations[]); message.content 의 [n] 마커',
    crossCheck: "search_results[].source 는 enum('web'|'attachment') — .url 로만 도메인 매칭",
    locationParam: { field: 'web_search_options.user_location', value: { country: 'KR', city: '', region: '' } },
    krWeight: 'medium',
    topLevers: [
      'answer-first/BLUF (상호·비용대·시간·주소 도입부)',
      'JSON-LD Dentist/MedicalClinic/FAQPage + 명확 NAP',
      '정의/교육 깊이 > 홍보',
      'web_search_options.user_location + search_domain_filter',
    ],
    caveats: ['SKT 무료 Pro로 한국 침투↑(Perplexity 전용 맥락)', 'search_domain_filter ~20캡은 버전 의존'],
  },
  gemini: {
    name: 'Gemini (Google)',
    measureMode: 'checklist',
    measureBlockedReason: 'Gemini API 추가약관: Grounded Results/Maps Data 캐시·분석·내보내기 금지 → 자동 랭크트래커 = ToS 위반',
    api: 'Gemini API grounding (참고용, 자동 측정 금지)',
    citationPath: 'candidates[].groundingMetadata.groundingChunks[].maps.{uri,placeId}/.web.uri',
    locationParam: { field: 'toolConfig.retrievalConfig.latLng', value: null },
    krWeight: 'high',
    topLevers: [
      'Google 비즈니스 프로필(GBP) 완성도·정확도 (NAP·1차 카테고리=치과·시간·사진)',
      'GBP 검증·소유 유지',
      '진짜 Google 리뷰 양+평점↑ 및 응답',
      'latLng 지역화 + 정확한 지오코딩',
    ],
    caveats: ['로컬 레이어 보유 유일 엔진 → GBP 게임', '2026-02 한국 지도 반출 승인(점진)'],
  },
  naver: {
    name: 'Naver (CUE: / AI 브리핑)',
    measureMode: 'checklist',
    measureBlockedReason: 'AI 브리핑/CUE: 공개 API 없음; Local API는 5개 캡·SERP 순서 아님; SERP 스크래핑 ToS/봇차단',
    api: 'Local Open API(참고, 5개 캡) / AI브리핑=육안',
    citationPath: 'AI브리핑 API 없음(육안); Local API items[].link / items[].address',
    locationParam: null,
    krWeight: 'high',
    topLevers: [
      '플레이스 정합성/완성도 (상호·카테고리=치과·대표키워드·주소·시간, 홈피와 일치)',
      '실사용 행동 신호(자연 리뷰·예약·저장·길찾기, 구매 금지)',
      '경험 기반 블로그/카페 후기로 C-rank↑',
      '엔티티/E-E-A-T + LocalBusiness/FAQPage JSON-LD + answer-first Q&A',
    ],
    caveats: ['외부 AI 크롤러 차단 → 네이버 최적화 ≠ 외부 AI 최적화(별도 스코어카드)', '플레이스 가중은 실무 추정'],
  },
};

// Engines we auto-measure citations on (clean API + KR relevance). Gemini/Naver are checklist-only.
export const AUTO_ENGINES = Object.keys(ENGINES).filter((k) => ENGINES[k].measureMode === 'auto-api');

// Engine-agnostic measurement prompt set for the 3 auto-api engines.
// businessType: Korean category noun for the target business (e.g. '치과', '피부과', '한의원').
// Defaults to '치과' so all existing callers without this param are unaffected.
export function buildPrompts({ district = '', procedure = '', businessType = '치과' } = {}) {
  const d = district.trim();
  const p = procedure.trim();
  const bt = (businessType || '치과').trim();
  const system = `You are helping a user in ${d || '한국'} find a ${bt}. Use web search.`;
  const users = [
    `${d} ${p} 잘하는 ${bt} 추천해줘`.replace(/\s+/g, ' ').trim(),
    `${d}에서 ${p} ${bt} 비교`.replace(/\s+/g, ' ').trim(),
    `${d} ${bt} 추천`.replace(/\s+/g, ' ').trim(),
  ];
  return users.map((user) => ({ system, user }));
}

// VERIFIED citation field paths → extract cited URLs from a raw engine response.
export function extractCitedUrls(engine, response) {
  const urls = [];
  try {
    if (engine === 'chatgpt') {
      for (const item of response?.output || []) {
        if (item.type !== 'message') continue;
        for (const part of item.content || []) {
          for (const a of part.annotations || []) {
            if (a.type === 'url_citation' && a.url) urls.push(a.url);
          }
        }
      }
    } else if (engine === 'claude') {
      for (const block of response?.content || []) {
        for (const c of block.citations || []) {
          if (c.type === 'web_search_result_location' && c.url) urls.push(c.url);
        }
      }
    } else if (engine === 'perplexity') {
      for (const sr of response?.search_results || []) if (sr.url) urls.push(sr.url);
      for (const c of response?.citations || []) if (typeof c === 'string') urls.push(c);
    } else if (engine === 'gemini') {
      for (const cand of response?.candidates || []) {
        for (const ch of cand?.groundingMetadata?.groundingChunks || []) {
          if (ch?.maps?.uri) urls.push(ch.maps.uri);
          if (ch?.web?.uri) urls.push(ch.web.uri);
        }
      }
    }
  } catch {
    /* defensive — malformed response yields no urls, never throws */
  }
  // dedupe
  return [...new Set(urls)];
}

// Is the clinic cited? Domain-matched (eTLD+1, www-stripped, redirect-unwrapped).
export function isClinicCited(engine, response, clinicDomain) {
  const urls = extractCitedUrls(engine, response);
  const matchedUrls = urls.filter((u) => sameRegistrableDomain(u, clinicDomain));

  // AutoGEO (ICLR 2026): position in answer text — top/mid/tail signals prominence
  let mentionPosition = null;
  try {
    const answerText = extractAnswerText(engine, response);
    if (answerText && clinicDomain) {
      const needle = (registrableDomain(clinicDomain) || clinicDomain).toLowerCase();
      const pos = answerText.toLowerCase().indexOf(needle);
      if (pos >= 0) {
        const ratio = pos / answerText.length;
        mentionPosition = ratio < 0.33 ? 'top' : ratio < 0.67 ? 'mid' : 'tail';
      }
    }
  } catch { /* best-effort */ }

  return {
    cited: matchedUrls.length > 0,
    matchedUrls,
    citationCount: urls.length,
    allCitedDomains: [...new Set(urls.map((u) => { try { return registrableDomain(u) || new URL(u).hostname; } catch { return u; } }))],
    // IMPORTANT: cited=false with citationCount=0 means "no search/citation this run", NOT "not cited".
    measuredCitations: urls.length > 0,
    mentionPosition,
  };
}

// Normalize a string for fuzzy name matching: lowercase, strip whitespace + common punctuation/brackets.
export function normalizeForMatch(s) {
  return String(s || '').toLowerCase().replace(/[\s()[\]{}·.,~!?'"“”‘’\-–—_/|:]+/g, '');
}

// Did the model NAME this clinic in its answer text — even without linking its domain?
// Fixes the false-negative where ChatGPT recommends "서울스마일치과" by name but links a directory
// (goodoc/doctornow) or nothing. URL-only detection (isClinicCited) misses this and undercounts.
// `names` = [clinicName, ...aliases]. Min normalized length 3 to avoid trivial substring hits.
export function answerMentionsName(answer, names) {
  if (!answer || !Array.isArray(names) || !names.length) return false;
  const hay = normalizeForMatch(answer);
  if (!hay) return false;
  for (const n of names) {
    const needle = normalizeForMatch(n);
    if (needle.length >= 3 && hay.includes(needle)) return true;
  }
  return false;
}

// Extract the model's ACTUAL answer text from a raw engine response (operator-only display).
// Mirrors each engine's response shape. Returns '' on any malformed/empty response (never throws).
export function extractAnswerText(engine, response) {
  try {
    if (engine === 'chatgpt') {
      const parts = [];
      for (const item of response?.output || []) {
        if (item.type !== 'message') continue;
        for (const part of item.content || []) {
          if ((part.type === 'output_text' || part.type === 'text') && part.text) parts.push(part.text);
        }
      }
      if (!parts.length && typeof response?.output_text === 'string') parts.push(response.output_text);
      return parts.join('\n').trim();
    }
    if (engine === 'claude') {
      const parts = [];
      for (const block of response?.content || []) {
        if (block.type === 'text' && block.text) parts.push(block.text);
      }
      return parts.join('\n').trim();
    }
    if (engine === 'perplexity') {
      return String(response?.choices?.[0]?.message?.content || '').trim();
    }
    if (engine === 'gemini') {
      const parts = [];
      for (const cand of response?.candidates || []) {
        for (const part of cand?.content?.parts || []) {
          if (part.text) parts.push(part.text);
        }
      }
      return parts.join('\n').trim();
    }
  } catch {
    /* defensive — malformed response yields '' , never throws */
  }
  return '';
}

// Plain, serializable config (no functions) for /api/engines.
export function publicConfig() {
  return { engines: ENGINES, autoEngines: AUTO_ENGINES };
}
