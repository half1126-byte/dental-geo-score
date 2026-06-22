# 공신력 측정 스택 — 1차(first-party) 도구 (조사 2026-06-22)

"AI가 우리 치과를 찾나/인용하나"를 **플랫폼이 직접 주는 공식 데이터**로 측정하는 도구 모음. 제3자 트래커(추정·벤더 방법론)와 달리 1차 신호라 공신력이 높다. 단, **무엇을 보느냐가 도구마다 다르다.**

> ⚠️ 아래 "API 가용성/필드"는 **POC 검증 대상**(다음 단계 전 워크플로로 확인). 문서엔 라이브 조사 기준 사실 + 미확인은 "POC 검증" 라벨.

## 도구 ↔ 답하는 질문 ↔ 측정 모드

| 도구 | 답하는 질문 | 자동(API)? | 문서 |
|---|---|---|---|
| **GSC Gen-AI 리포트**(구글, 2026-06 신규) | 내 페이지가 **AI Overviews·AI Mode에 노출**됐나(impressions) | POC(Search Analytics API 신규 차원?) | [gsc-genai.md](gsc-genai.md) |
| **GA4 AI Assistant 채널**(구글, 2026-05) | **AI 추천 유입 트래픽** | 예(GA4 Data API) — POC 확인 | [ga4-ai-channel.md](ga4-ai-channel.md) |
| **Cloudflare AI Audit/Crawl Control** | **AI 크롤러가 실제로 긁나**(GPTBot·OAI-SearchBot·PerplexityBot·ClaudeBot) | 예(GraphQL Analytics?) — POC | [cloudflare-ai-audit.md](cloudflare-ai-audit.md) |
| **Google Business Profile 인사이트** | **로컬/지도(Gemini)** 조회·전화·길찾기 | 예(Performance API) — POC | [google-business-profile.md](google-business-profile.md) |
| **네이버 서치어드바이저 + 스마트플레이스** | 네이버 검색·플레이스 노출/예약(한국 1차) | 부분/수동 — POC | [naver-search-advisor.md](naver-search-advisor.md) |

근거(인용용, 1차/학술): [authoritative-sources.md](authoritative-sources.md) — Pew·GEO논문(KDD'24)·Semrush/Similarweb.

## 빈칸(가장 중요)
**OpenAI·Anthropic·Perplexity는 "우릴 몇 번 인용했나" 1차 대시보드가 없다.** GSC=구글 AI 노출만, GA4·Cloudflare=트래픽·크롤만. → **ChatGPT·Perplexity·Claude 인용은 공식 API 직접 측정(프롬프트 패널)이 유일** (= dental-geo-score Phase 2, `lib/engines.js`의 검증된 추출기).

## 레이어 맵 (무엇이 무엇을 답하나)
```
크롤됐나     → Cloudflare/서버 로그            (1차, 진실)
구글 AI 노출 → GSC Gen-AI 리포트               (1차, 노출만, 구글한정)
AI 유입 트래픽 → GA4 AI Assistant 채널          (1차, 35~70% 과소)
로컬/지도    → Google Business Profile         (1차, Gemini 레이어)
네이버       → 서치어드바이저 + 스마트플레이스   (1차, 한국)
LLM 인용     → ❌ 공식 도구 없음 → 엔진 API 직접 측정 (우리 도구)
```

## 적용 방향 (다음 단계 = POC 후)
거래처 셋업 시 위 1차 도구를 연결한 **"공신력 측정 스택"** + LLM 인용 API 측정을 묶어 한 리포트로. POC가 "어떤 게 자동 API로 당겨지나"를 확정하면, 자동/수동을 가른 **거래처 측정 셋업 체크리스트** + (가능한 것만) 커넥터를 만든다.
