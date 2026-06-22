# Cloudflare — AI Audit / Crawl Control (1차, "크롤 진실")

**무엇:** Cloudflare가 제공하는 AI 크롤러 분석·제어. 내 사이트를 **어떤 AI 봇이 실제로 긁는지**를 1차로 보여주고, 허용/차단·요금까지 통제. "AI가 날 크롤했나"의 가장 권위 있는 1차 데이터(서버/CDN 로그 레벨).

## 보여주는 것
- **AI 크롤러별 방문**: GPTBot · OAI-SearchBot · ChatGPT-User · PerplexityBot · ClaudeBot · Google-Extended · CCBot 등.
- **AI Crawl Control 대시보드**: 크롤러별 설정(허용/차단), 경로 패턴별 드릴다운, 스파이크 감지.
- **crawl-to-refer 비율**: 긁어가고 트래픽을 돌려주는 효율(예 2026-Q1: PerplexityBot ~111:1).
- (옵션) **pay-per-crawl** 등 수익화.

## 거시 맥락 (Cloudflare 망 기준, 2026)
- 봇이 HTML 트래픽의 **57.5%**(사람 42.5%). 검증봇 중 **AI 크롤러 20.3% + AI-검색봇 6.5%**(2026-05).
- GPTBot이 가장 많이 차단되나 **허용(5.84%)이 차단(4.71%)을 처음 추월**.
- 권장: **학습봇(GPTBot·ClaudeBot·Meta-ExternalAgent·CCBot) 차단 vs 검색/유저봇(OAI-SearchBot·ChatGPT-User·PerplexityBot) 허용**을 구분.

## 측정/적용 (POC 확정 2026-06-23)
- ◐ **부분 자동.** `POST api.cloudflare.com/client/v4/graphql` → `httpRequestsAdaptiveGroups`. **정밀(봇별)=`botDetectionIds_hasany`** → **Enterprise + Bot Management** 필요. Free/Pro는 `userAgent LIKE '%GPTBot%'` 폴백(스푸핑 가능 → 카운트 UNVERIFIED 라벨). `requestSource:"eyeball"` 필수, 非Ent 보존 ~72h(자주 폴링·저장).
- **인증(에이전시 친화):** 거래처 계정별 API 토큰 **Account Analytics:Read**.
- 이게 **OAI-SearchBot 허용(점수 1번 신호)**의 실제 작동 1차 증거 + **인용 0의 원인 설명**(크롤 0 → 인용 0).

## 출처
- [Cloudflare blog — AI crawler traffic by purpose and industry](https://blog.cloudflare.com/ai-crawler-traffic-by-purpose-and-industry/)
- [Digital Applied — AI crawler/bot traffic statistics 2026](https://www.digitalapplied.com/blog/ai-crawler-bot-traffic-statistics-2026-data-reference)
