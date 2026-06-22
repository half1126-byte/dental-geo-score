# 공신력 측정 스택 — 1차(first-party) 도구 (조사 2026-06-22)

"AI가 우리 치과를 찾나/인용하나"를 **플랫폼이 직접 주는 공식 데이터**로 측정하는 도구 모음. 제3자 트래커(추정·벤더 방법론)와 달리 1차 신호라 공신력이 높다. 단, **무엇을 보느냐가 도구마다 다르다.**

> ⚠️ 아래 "API 가용성/필드"는 **POC 검증 대상**(다음 단계 전 워크플로로 확인). 문서엔 라이브 조사 기준 사실 + 미확인은 "POC 검증" 라벨.

## 도구 ↔ 답하는 질문 ↔ 측정 모드 (POC 확정 2026-06-23)

| 도구 | 답하는 질문 | 자동 API? (POC 검증) | 문서 |
|---|---|---|---|
| **GA4 AI Assistant 채널** | **AI 추천 유입 트래픽** | ✅ **자동 — 최우선**. GA4 Data API runReport, `sessionMedium == "ai-assistant"`(토큰) | [ga4-ai-channel.md](ga4-ai-channel.md) |
| **Cloudflare AI Crawl Control** | **AI 크롤러가 실제로 긁나** | ◐ **부분**. GraphQL `httpRequestsAdaptiveGroups`+`botDetectionIds`(정밀=Enterprise+Bot Mgmt) / Free·Pro=UA매칭(스푸핑 가능) | [cloudflare-ai-audit.md](cloudflare-ai-audit.md) |
| **GSC Gen-AI 리포트** | AI Overviews·AI Mode **노출** | ❌ **API 없음(UI 전용)**. searchanalytics.query는 AI 분리 불가('aiOverview' API값은 **환각**) | [gsc-genai.md](gsc-genai.md) |
| **Google Business Profile** | **로컬/지도(Gemini)** | ◐ API 있으나 **이중게이트**(프로젝트 승인 0→300 QPM + 거래처별 소유/매니저, 서비스계정 불가) | [google-business-profile.md](google-business-profile.md) |
| **네이버 서치어드바이저/스마트플레이스** | 네이버 검색·플레이스(한국) | ❌ **API 없음(수동 export)**. DataLab=상대추세만, Search Ad=유료광고만 | [naver-search-advisor.md](naver-search-advisor.md) |

### POC 검증 결과 — 무엇을 지을까 (5/5 검증·반박 통과)
- **지금 지을 커넥터(자동·에이전시 확장 가능):** ① **`ga4-ai`**(에이전시 서비스계정 1개 → 거래처는 GA4에 Viewer로 SA 이메일 추가 1스텝; medium=`ai-assistant` 필터·플랫폼별 분해) ② **`cf-aibots`**(거래처별 Account Analytics:Read 토큰; 플랜에 따라 정밀/UA 2모드).
- **커넥터 짓지 말 것(수동 체크리스트):** GSC AI세그(API 없음·롤아웃 한정), GBP(승인+매니저 게이트 → Phase 3), 네이버(API 없음·스크래핑=ToS 위험).
- **3단 퍼널로 합쳐진다(엔진별):** ① **크롤/적격** `cf-aibots`(OAI-SearchBot·ClaudeBot·PerplexityBot이 긁나 — 0이면 인용도 0인 이유 설명) → ② **인용/노출** 기존 패널 `lib/engines.js`(인용됐나) → ③ **결과/트래픽** `ga4-ai`(AI 세션·전환 왔나). *구글 AI Overviews/네이버는 양 축 모두 수동·체크리스트 유지(비대칭 보존).*
- **잔여 리스크:** GA4는 무리퍼러→Direct 누수(=하한선으로 보고)·데이터 2026-06-07부터(이력 없음); Cloudflare 정밀=Enterprise·非Ent 보존 ~72h; GBP 승인 SLA 없음; 크리덴셜 blast radius(읽기전용·회전 필요); 3계층 식별자 정합은 휴리스틱.

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
