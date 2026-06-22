# GA4 — AI Assistant 채널 (1차)

**무엇:** Google Analytics 4가 **2026-05-13**(광범위 ~06-07) 추가한 기본 채널. AI 어시스턴트에서 들어온 유입을 자동으로 별도 채널로 분류. **설정 0**(자동).

## 동작
- 리퍼러가 인식된 어시스턴트면 → `medium = ai-assistant`, channel group = **AI Assistant**, campaign = `(ai-assistant)`.
- "AI 추천으로 사이트에 실제로 **온 클릭**"을 측정.

## 한계 (정직 — 크다)
- **ChatGPT·Gemini·Claude만** 기본 인식. **Perplexity·Copilot 커버리지 불확실**(구글이 전체 리퍼러 목록 미공개).
- **AI 세션의 35~70%가 리퍼러 없이 도착 → Direct로 샘**(앱 리퍼러 제거·제로클릭). → **구조적 과소측정.**
- 트래픽 자체가 작음(예: B2B 테크 ~6.4%, 2026-01) — 단 **전환율은 유기검색의 4~5배**.
- 네이버 AI 브리핑 등은 미포함(네이버 생태계 별도).

## 측정/적용 (POC 확정 2026-06-23)
- ✅ **자동 가능 — 스택 최우선 커넥터.** `POST analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`, 필터 **`sessionMedium == "ai-assistant"`(현지화 라벨 'AI Assistant' 아닌 토큰)**, `sessionSourceMedium`로 플랫폼별 분해, metrics sessions/전환.
- **인증(에이전시 친화):** 에이전시 **서비스계정 1개** → 거래처는 GA4 속성에 SA 이메일을 **Viewer로 추가**(거래처당 1스텝, per-user OAuth 갱신 없음).
- caveat: 무리퍼러 AI 클릭은 Direct로 누수(→ **하한선**으로 보고), AI Overviews/AI Mode 제외, 데이터 2026-06-07~.

## 출처
- [Semrush — GA4 adds AI Assistant channel](https://www.semrush.com/blog/ga4-adds-ai-assistant-channel/)
- [MADX — GA4 AI Assistant channel: what it shows and hides](https://www.madx.digital/learn/ga4-launches-ai-assistant-channel)
