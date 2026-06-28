# P1 — AI검색 동향 뉴스 피드 (authority content) 설계

작성일: 2026-06-28
브랜치: realmeasurement-live
스펙 범위: **P1만**. P2(리포지션 카피·브랜딩), P3(엔진 업종 일반화)는 별도 스펙.

## 0. 맥락 / 리포지션

dental-geo-score를 "치과 GEO 점수"에서 **"AI검색 마케팅(GEO) 진단 + 동향 허브"**로 전면 리포지션한다.
치과는 여러 업종 중 하나의 쇼케이스가 된다. 이 리포지션은 3페이즈로 분해한다:

| 페이즈 | 내용 | 위험 | 엔진 손댐 |
|---|---|---|---|
| **P1 (이 스펙)** | AI검색 동향 뉴스 피드 — 화이트리스트 RSS + 웹검색 보강 → 매일 크론 → 한국어 한줄요약 → 서빙 | 낮음 | ❌ |
| P2 | 리포지션 카피·브랜딩 (치과 하드코딩 92곳 → 범용) | 낮음 | ❌ |
| P3 | 엔진 업종 일반화 (업종 자동감지 + 편집가능 키워드 질의) | 중간 | ✅ |

순서: **P1 → P2 → P3.** P1은 "권위 허브" 기둥을 세우고 본질적으로 업종 무관이라 리포지션을 견인한다. 엔진 0 위험.

## 1. 확정된 결정 (사용자)

1. 확장 강도 = **전면 리포지션** (치과 = 쇼케이스 업종 하나).
2. 뉴스 소스 = **화이트리스트 RSS 주축 + 웹검색 보강**.
3. 뉴스 가공 = **한국어 한줄 요약 + '왜 중요' 태그 + 출처 링크** (크론에서 소형 LLM 요약).
4. (P3 예고) 실측 질의 = **자동감지 + 편집가능**.
5. UI 배치 = **홈 티저 섹션 + 전용 `/news.html` 페이지 둘 다**.

## 2. 핵심 원칙

- **요청 시점엔 LLM·외부호출 0.** 사용자 GET은 미리 만들어둔 KV JSON만 반환 → 빠르고 공짜·안전.
- 무거운 일(fetch·요약)은 **하루 한 번 크론에서만**.
- **신규 항목만 요약** (저장본과 diff) → 비용 가드. 하루 신규 5~15건 × 소형모델 = 수십원.
- 소스 하나 죽어도 `Promise.allSettled`로 나머지 진행. KV 비면 시드/안내로 우아하게. **절대 안 깨짐.**
- SSRF: 모든 외부 fetch는 기존 `lib/fetcher.js`의 `safeFetch` 재사용.

## 3. 아키텍처 / 데이터 흐름

```
[매일 06:00 KST = 21:00 UTC] Vercel Cron
  → POST /api/news/refresh   (CRON_SECRET 베어러 게이트)
       1. 화이트리스트 RSS 병렬 fetch (safeFetch)
       2. 관련성 키워드 게이트 필터
       3. 부족(<MIN_ITEMS)하면 웹검색 보강 (기존 엔진 1콜)
       4. 신규 항목만(저장본 URL 정규화 dedupe) → 소형 LLM:
            한국어 한줄요약 + whyTag + relevance(0~1)
       5. relevance < THRESHOLD 드롭, 상위 ~40건 KV 저장 (news:feed, news:meta)

[사용자 방문] GET /api/news   (공개, Cache-Control s-maxage)
  → KV news:feed JSON 반환 (LLM 0, 즉시). KV 비면 시드 폴백.
  → 홈 'AI검색 동향' 섹션 + /news.html 렌더
```

## 4. 파일 (격리·단위테스트 가능하게 분리)

신규:
- `lib/news/sources.js` — 화이트리스트 소스 정의(name·rssUrl·tier·lang) + 시드 폴백 항목. 순수 데이터.
- `lib/news/rss.js` — 최소 RSS/Atom 파서(cheerio xml mode). `parseFeed(xml) → [{title,url,publishedAt}]`. 순수.
- `lib/news/relevance.js` — `isRelevant(item)` 키워드 게이트 + `canonicalUrl(url)` + `dedupe(items)`. 순수.
- `lib/news/curate.js` — `selectNew(fetched, stored)` + `buildSummaryPrompt(item)` (LLM 호출은 주입) + `mergeFeed(stored, summarizedNew, max)`. 순수.
- `api/news/refresh.js` — 크론 오케스트레이션 + CRON_SECRET 게이트. 얇게.
- `api/news.js` — 공개 GET 서빙(KV 읽기 + 시드 폴백 + 캐시 헤더).
- `public/news.html` + `public/news.js` — 전체 피드 페이지.
- `test/news.test.js` — rss·relevance·dedupe·curate 단위테스트 + 요약 금칙어 가드.

수정:
- `vercel.json` — `crons` 추가 + `api/news/refresh.js` maxDuration 상향(요약 루프).
- `public/index.html` + `public/app.js` (또는 해당 렌더) — 홈 "AI검색 동향" 티저 섹션.
- `lib/engines.js` — 웹검색 보강·요약에 재사용할 호출 헬퍼가 없으면 소형 추가(기존 패턴 따름).

기존 엔진/스코어/`auditUrl`/`/api/score`/`/api/compare`/공개 환자뷰 측정 로직은 **건드리지 않는다** (P1 위험 0).

## 5. 소스 화이트리스트

Tier 1 (공식): Google Search Central Blog · OpenAI News · Anthropic News · Google "The Keyword"(AI) · Microsoft/Bing·Copilot Blog · Perplexity Blog
Tier 2 (전문매체): Search Engine Land · Search Engine Journal · Search Engine Roundtable

- 실제 RSS URL은 구현 때 검증(피드 이동/폐지 가능). 검증 실패 소스는 `sourceStatus`에 기록하고 건너뜀.
- 한국어 1차 소스는 화이트리스트에 두지 않음 — 영문 공식 위주 + 한국어는 요약으로 해결.
- 웹검색 보강이 신선도 안전망.

## 6. 관련성 게이트

키워드: `AI search · generative engine (optimization) · GEO · AEO · AI Overviews · SGE · ChatGPT search · Perplexity · answer engine · citation · grounding · AI mode · Gemini · Copilot`
- 화이트리스트 항목: 키워드 매칭 없으면 드롭.
- 웹검색 보강 항목: 키워드 매칭 + LLM relevance ≥ THRESHOLD.
- dedupe: canonical URL(쿼리스트링·utm·fragment 제거, http→https, 트레일링 슬래시 정규화) 기준.

## 7. 데이터 형태

`news:feed` = JSON 배열(롤링 최근 ~40건, publishedAt desc):
```json
{
  "id": "<canonicalUrl sha 짧은해시>",
  "title": "원문 제목",
  "url": "원문 링크",
  "source": "Search Engine Land",
  "sourceTier": 2,
  "publishedAt": "2026-06-27T08:00:00Z",
  "koSummary": "구글이 AI 개요 인용 표기를 강화했다…",
  "whyTag": "지역업종·커머스 인용 노출 영향",
  "relevance": 0.86,
  "fetchedAt": "2026-06-28T21:00:00Z"
}
```
`news:meta` = `{ lastRefresh, count, sourceStatus: [{source, ok, itemCount, error?}] }`.

## 8. 요약 LLM

- 모델: 소형·저렴. `NEWS_SUMMARY_MODEL` env로 교체(기본 저가 티어).
- 프롬프트: 제목+원문 발췌 → (a) 한국어 1줄 요약(사실 위주, 과장·최상급 금지), (b) whyTag 1구, (c) relevance 0~1.
- 출력 JSON 강제. 파싱 실패 시 해당 항목 드롭(피드 무결성 우선).
- 신규 항목만 호출.

## 9. UI (기존 디자인 토큰: --plum/--teal #8052ff · --gold #ffb829 · Pretendard · 다크)

홈 "AI검색 동향" 섹션:
- 상위 3~4건(한줄요약 + 출처배지 + 상대날짜) + "전체 보기 →" → `/news.html`.
- 신뢰줄: "공식·전문매체 N곳 · 매일 06:00 갱신".

`/news.html`:
- 전체 피드 카드 그리드. 출처배지 tier별 색(tier1 골드, tier2 플럼).
- 상대날짜("3일 전"), 원문 `target=_blank rel="noopener noreferrer"`.
- tier 필터(전체/공식/전문매체).
- 상단에 동일 신뢰줄 + lastRefresh 표시.

## 10. 견고성 / 폴백

- KV 미설정/빈 피드 → `sources.js` 시드 항목(수동 큐레이션 6~8건) 반환. "곧 자동 업데이트" 라벨.
- 크론 실패/부분 실패 → 마지막 성공 피드 유지(refresh는 머지, 전체 덮어쓰기 아님).
- 소스 fetch 실패 → `sourceStatus`에 error, 나머지 진행.
- 요약 LLM 실패 → 해당 항목만 드롭.

## 11. 보안 / 컴플라이언스

- `/api/news/refresh`: `CRON_SECRET` 베어러 검증. 누구나 트리거 불가.
- `/api/news`: 공개 읽기 전용. 쓰기 경로 없음.
- 외부 fetch: `safeFetch`(스킴·포트·DNS·IP 검증). RSS·원문 모두.
- 뉴스는 3자 산업 콘텐츠 → 의료광고법 무관. 단 **우리가 만든 한국어 요약문**은 과장·최상급 금지(금칙어 가드 테스트).
- 비밀키(요약 모델 키)는 서버 env만. 클라이언트 노출 0.

## 12. 테스트

`test/news.test.js`:
- `rss.parseFeed`: 샘플 RSS/Atom XML → 항목 추출(제목·url·날짜).
- `relevance.isRelevant`: 양성(AI search 키워드)·음성(무관) 케이스.
- `relevance.canonicalUrl` + `dedupe`: utm·트레일링 슬래시·http/https 변형이 같은 항목으로 합쳐짐.
- `curate.selectNew`: 저장본에 있는 url 제외, 신규만.
- `curate.mergeFeed`: max 컷, publishedAt desc 정렬.
- 금칙어 가드: 요약 프롬프트/시드 항목 문자열에 과장·최상급(최고·1위·완치·보장 등) 0건 단언.

검증:
```bash
cd /c/Users/com/Downloads/dental-geo-score
NODE_OPTIONS=--use-system-ca node --test test/*.test.js   # 기존 182 + 신규
```
수동: 로컬에서 `/api/news/refresh`(CRON_SECRET 로컬값) 1회 → `/api/news` JSON 확인 → `/news.html` 렌더 → 홈 티저 확인.

배포: `NODE_OPTIONS=--use-system-ca vercel --prod --yes`. Vercel env 필요: `CRON_SECRET`, `NEWS_SUMMARY_MODEL`(선택), 요약용 LLM 키(이미 있는 OPENAI 키 재사용 가능), `KV_REST_API_URL`/`KV_REST_API_TOKEN`(없으면 인메모리 — 크론 영속 위해 권장).

## 13. Out of scope (P1 아님)

- P2 리포지션 카피·브랜딩 (별도 스펙).
- P3 엔진 업종 일반화 (별도 스펙).
- 뉴스 개인화·이메일 다이제스트·푸시.
- 댓글·소셜 공유 위젯.
- 한국어 1차 RSS 소스 추가(현재 영문 화이트리스트 + 요약으로 충분).
