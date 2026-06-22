# Google Search Console — Gen-AI 성능 리포트 (1차)

**무엇:** 구글이 **2026-06-03** Search Console에 출시한 신규 리포트. 내 사이트 URL이 **AI Overviews · AI Mode**(및 Discover의 AI 기능)에 **얼마나 노출되는지**를 보여준다. "AI에 보였나"의 유일한 구글 공식 1차 지표.

## 보여주는 것
- **Impressions(노출)** — 생성형 AI 기능에 내 URL이 등장한 횟수.
- **Pages** — 어떤 URL이 AI 기능에 등장했나.
- 분해: 페이지 / 국가 / 기기 / 날짜(시간~월).

## 한계 (정직)
- **노출(impressions)만.** **클릭·CTR·평균순위·쿼리 없음** → 가시성은 보이나 트래픽 가치는 안 보임.
- **AI Overviews vs AI Mode 분리 안 됨**(합산).
- **새 데이터가 아니라 분해**임 — 원래 전체 성능 합계에 포함돼 있던 걸 떼어 보여주는 것.
- **점진 롤아웃**(영국 일부부터). 모든 사이트 가용 아님.
- **구글 전용** — ChatGPT/Perplexity/Claude는 안 보임.
- 별도 **opt-out 토글**: AI 기능 노출 차단 가능(차단 시 AI 노출/트래픽 포기, 일반 랭킹엔 영향 없음).

## 측정/적용 (POC 검증 대상)
- API: Search Console **Search Analytics API**에 AI-feature를 거르는 신규 차원(예: searchAppearance/type)이 생겼는지 **POC로 확인**. 안 생겼으면 당분간 **UI/내보내기 수동**.
- 거래처 GSC 속성 접근 권한 필요. 거래처별 "AI 노출 추세"를 월간 리포트에 포함.

## 출처
- [Google Search Central — Gen-AI performance reports (2026-06-03)](https://developers.google.com/search/blog/2026/06/gen-ai-performance-reports)
- [Search Engine Journal — dedicated AI search reports](https://www.searchenginejournal.com/google-tests-dedicated-ai-search-reports-in-search-console/577793/)
