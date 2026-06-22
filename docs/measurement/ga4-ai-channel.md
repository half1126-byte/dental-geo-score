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

## 측정/적용 (POC 검증 대상)
- API: **GA4 Data API**(Analytics Data)로 `sessionDefaultChannelGroup == 'AI Assistant'` 세션·전환을 거래처별 자동 추출 가능한지 **POC 확인**(정확한 채널 그룹 값/차원명).
- 보강: 커스텀 채널 그룹 정규식으로 Perplexity/Copilot/you.com 추가(리퍼러 있는 분만).
- GA를 **단독 진실로 쓰지 말 것** — "트래픽" 보조. "AI가 인용했나"는 별도(엔진 API).

## 출처
- [Semrush — GA4 adds AI Assistant channel](https://www.semrush.com/blog/ga4-adds-ai-assistant-channel/)
- [MADX — GA4 AI Assistant channel: what it shows and hides](https://www.madx.digital/learn/ga4-launches-ai-assistant-channel)
