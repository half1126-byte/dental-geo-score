# Gemini (Google) — 치과 추천 로직

**한 줄:** 지오 의도를 감지하면 **Google Maps/비즈니스 프로필(GBP) 그라운딩** + Google Search + 지식그래프로 실데이터를 회수해 답한다. 로컬 레이어를 가진 유일한 엔진 — 그래서 GBP가 1차 레버.

## 추천 생성 로직
파라메트릭 기억이 아니라 **도구 그라운딩**. (1) `googleMaps` 도구가 Google Maps의 수억 places(블로그 250M / mapsplatform 300M+, 두 구글 출처가 불일치 — 둘 다 표기)에서 주소·리뷰·사진·영업시간·평점을 회수해 **답변 생성 소스**로 사용. (2) `google_search` 도구가 실시간 웹+인용으로 보강. `toolConfig.retrievalConfig.latLng`로 검색자 위치 지역화(구글 로컬 랭킹의 거리 신호). 엔티티 판별은 **지식그래프**에 의존. → 지오 감지 → Maps(±Search) 회수 → 신선 사실 → 인라인 인용 + (옵션) Maps 위젯.

## 추천을 만드는 신호
- **GBP 완성도·정확도(NAP·시간·카테고리)** [high] — Maps 그라운딩이 GBP 레코드에서 회수. 불완전 = 인용 후보에서 약화.
- **관련성(질의↔프로필 매치)** [high] — 구글 로컬 랭킹 1번. 치과는 **정확한 1차 카테고리(치과/세부전문)**가 회수 자체를 가른다.
- **거리/근접** [high] — 구글 2번. `latLng`로 지역화.
- **저명도(리뷰 양+평점·링크)** [high] — "리뷰·긍정 평점이 로컬 랭킹에 도움"(구글). Maps 그라운딩이 리뷰 인사이트 사용.
- **지식그래프 엔티티** [medium], **GBP 검증** [medium], **E-E-A-T 웹 보강(Search)** [medium], **영업시간 신선도** [medium].
> ⚠️ "GBP가 Maps 그라운딩의 데이터 저장소다"는 **강한 추정**(단일 구글 문서가 명시하진 않음). "지식그래프가 어느 브랜드를 언급할지 정한다"는 ahrefs(SEO 블로그) 해석.

## 인용 메커니즘 (검증됨)
- Search: `candidates[].groundingMetadata.groundingChunks[].web.{uri,title}`, 스팬은 `groundingSupports[].segment`, `webSearchQueries[]`, `searchEntryPoint`(Search Suggestions HTML).
- Maps: `groundingChunks[].maps.{uri,title,placeId}`(placeId 형식 `places/ChIJ...`). 위젯 컨텍스트 토큰은 존재하나 **JSON 필드명 미확인**(`googleMapsWidgetContextToken`은 미검증).

## 측정 가능성 — **checklist** (ToS 차단)
Gemini API는 자기 호출의 `groundingMetadata`를 프로그램으로 읽을 수 있으나, **Gemini API 추가약관이 Grounded Results/Maps Data의 캐시·스크랩·내보내기·학습·분석을 금지** → 그라운딩 출력 위에 랭크트래커/스크래퍼를 만들면 **ToS 위반**. "Gemini가 날 추천했나" 인용-랭크 공식 API도 없음. → **자동 측정 대신 GBP 준비도 체크리스트**(수동 샘플링은 개인이용 한도 내).

## 최적화 레버 (= GBP 게임)
1. **GBP 완성도 극대화**(정확 NAP, 1차 카테고리=치과/세부, 서비스·속성, 정규+특별 영업시간, 사진, 사이트).
2. **GBP 검증·소유 유지**. 3. **진짜 리뷰 양+평점↑ 및 응답**. 4. **지식그래프 강화**(웹 NAP 일관, Organization/Dentist JSON-LD, 권위 멘션, GBP와 사이트 URL 일치). 5. **거리는 살 수 없음** — 핀/주소 지오코딩 정확히. 6. **E-E-A-T 웹 콘텐츠**(Search 보강).

## 한국/치과 특이사항
- **2026-02-27 국토부 1:5,000 정밀지도 반출 조건부 승인**(2007년부터의 분쟁 종료, 풀 Google Maps/내비 길 열림 — Korea Herald·TechCrunch·JURIST 검증). Gemini 로컬은 한국 Maps/GBP 커버리지에 비례 → **한국 치과는 GBP를 네이버와 더불어 1급 채널로**. 단 승인은 조건부·점진(즉시 완전 파리티 아님). 한국은 Maps 그라운딩 **제한지역 리스트에 없음**(가용).
- Korea Gemini 치과 인용 점유 통계 없음 → 만들지 않음.

## 출처 / 불확실성
- 공식: ai.google.dev/gemini-api/docs/grounding, /maps-grounding, /terms, blog.google, mapsplatform.google.com, support.google.com/business/answer/7091. **신뢰 high.**
- 검증 정정: 제한지역 리스트는 maps-grounding 문서(또는 Maps Platform Prohibited Territories)에 있음(블로그 URL 아님). 구글 로컬 3요소 현행 표기는 "relevance/distance/popularity"(문서가 "prominence"로도 씀). 위젯 토큰 필드명·소비자 Gemini 앱이 개발자 API와 동일 파이프라인인지 미확인.
