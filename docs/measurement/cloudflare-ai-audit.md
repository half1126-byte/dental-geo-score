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

## 측정/적용 (POC 검증 대상)
- 전제: 거래처가 **Cloudflare(또는 로그 접근 가능한 호스트)** 사용. 아니면 서버 access log 파싱으로 대체.
- API: **Cloudflare GraphQL Analytics / AI Audit API**로 봇별 크롤 수를 거래처별 자동 추출 가능한지 + 플랜 요건 **POC 확인**.
- 이게 **OAI-SearchBot 허용(우리 점수 1번 신호)**이 실제로 작동하는지 검증하는 1차 증거.

## 출처
- [Cloudflare blog — AI crawler traffic by purpose and industry](https://blog.cloudflare.com/ai-crawler-traffic-by-purpose-and-industry/)
- [Digital Applied — AI crawler/bot traffic statistics 2026](https://www.digitalapplied.com/blog/ai-crawler-bot-traffic-statistics-2026-data-reference)
