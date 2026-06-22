# Google Business Profile (GBP) 인사이트 (1차, Gemini 로컬 레이어)

**무엇:** 구글 비즈니스 프로필의 공식 성능 통계. **Gemini 로컬 추천이 GBP/지도/지식그래프에 의존**하므로(→ [docs/engines/gemini.md](../engines/gemini.md)), GBP 통계는 "구글 AI가 보는 우리 로컬 데이터"의 1차 신호.

## 보여주는 것 (Performance)
- 검색/지도에서의 **노출(searches·views)**, **전화·길찾기·웹사이트 클릭**, **예약**, 검색 키워드(상위), 사진 조회.
- = 환자가 지도/검색에서 우리 치과로 어떤 행동을 했나의 1차 데이터.

## 왜 중요 (Gemini 연결)
- Gemini Maps 그라운딩이 GBP 레코드(NAP·카테고리·시간·리뷰·평점)를 **답변 생성 소스**로 사용. GBP가 비거나 부정확하면 Gemini 로컬 인용 후보에서 약화.
- 한국: **2026-02-27 정밀지도 반출 승인** 후 한국 Google Maps/GBP 가치↑(점진).

## 측정/적용 (POC 검증 대상)
- API: **Business Profile Performance API**(`businessprofileperformance.googleapis.com`)로 거래처 location의 metrics(CALL_CLICKS·BUSINESS_DIRECTION_REQUESTS·WEBSITE_CLICKS·노출 등)를 자동 추출 가능한지 + OAuth/소유권 요건 **POC 확인**.
- GBP는 **자동 측정 불가인 Gemini 인용의 대체 신호** → [GBP 준비도 체크리스트](../../lib/checklists.js)(11항목)와 함께 사용.

## 출처
- [Google — Business Profile Performance API](https://developers.google.com/my-business/reference/performance/rest)
- 로컬 랭킹: [support.google.com/business/answer/7091](https://support.google.com/business/answer/7091)
