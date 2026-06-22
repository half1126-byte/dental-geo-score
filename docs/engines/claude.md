# Claude (Anthropic) — 치과 추천 로직

**한 줄:** 자체 검색 인덱스가 없다. 웹검색 도구(제3자 제공자)를 Claude가 *스스로 판단해* 켜서 인용을 붙이거나, 안 켜지면 사전학습 기억으로 답한다. 로컬 그라운딩은 Gemini보다 약함(지도/비즈니스 프로필 레이어 없음 — 구조적 추론).

## 추천 생성 로직
세 경로: (1) **파라메트릭** — 검색 미발동 시 기억으로 답(로컬엔 비그라운드/부정확). (2) **웹검색 도구** — Claude가 검색 여부를 판단 → API가 제3자 제공자로 질의 → `web_search_result` 블록 반환 → Claude가 인용 답 합성. **일반 웹검색이지 GBP/리뷰/맵팩 같은 로컬 구조 인덱스 아님.** (3) **search_result 블록/RAG** — 개발자가 자체 회수 결과를 넣어 Claude가 인용(버티컬 앱에서 지배적). `user_location`(city/region/country/timezone)은 검색 질의를 지역화할 뿐 places DB 아님.

## 추천을 만드는 신호
- **검색 발동 여부** [high] — 안정 지식은 기억으로, "현재/변화/외부" 정보일 때만 검색. 일반 "근처 치과 추천"은 검색을 안 켤 수 있음(추정 — 트리거 휴리스틱 비공개).
- **제공자 웹검색 결과 내 랭크** [high] — 거기 안 뜨면 인용 불가. **별도 로컬/맵 신호 없음** → 표준 웹 SEO가 레버.
- **user_location** [medium], **allowed_domains/blocked_domains** [medium], **텍스트 추출성·인용 친화성** [medium], **개발자 RAG(search_result 블록)** [high], **page_age 신선도** [low].

## 인용 메커니즘 (필드 패스 — 일부 라이브 재확인 필요)
- 웹검색: `response.content[].citations[]`(type==`web_search_result_location`) → `.url`/`.title`/`.cited_text`. 원천은 앞선 `web_search_tool_result.content[]`의 `web_search_result` 객체 목록.
- 문서/RAG: `citations:{enabled:true}` 시 `char_location`/`page_location`/`search_result_location` 인용.
> ⚠️ 검증 정정: 도구 버전은 **`web_search_20250305`(기본, Vertex 유일)·`web_search_20260209`만** — 조사 중 나온 `web_search_20260318`은 **환각으로 제외**. `$10/1k`·`cited_text 150자`·`encrypted_index`·"토큰 미카운트"는 권위 문서로 미확인 → **라이브 재확인 전 사실 단정 금지**.

## 측정 가능성 — **auto-api** (부분)
`/v1/messages` + web_search → 모든 답이 구조화 인용 반환 → 거래처 도메인 인용 여부 스크립트 측정 가능. 단 (1) 소비자 claude.ai 앱엔 인용 추출 공개 API 없음, (2) Console에서 조직 관리자가 웹검색 활성화 필요 + 검색당 비용, (3) 표시 시 출처 인용 의무는 **Anthropic 이용정책(확인 필요)**.

## 최적화 레버
1. **표준 크롤 가능 웹 SEO**(Claude가 생성할 질의에 대해) — 맵팩 없음, 온페이지 SEO가 1차. 2. **텍스트 추출/answer-shaped**(상호·전문의·동네·주소·시간을 상단 평문). 3. **이미 랭크하는 디렉토리 등재**. 4. **Claude 앱이면 search_result 블록+allowed_domains로 자체 DB 주입**(일반 웹검색 우회). 5. 신선도. 6. 현재/비교형 질의가 검색 발동을 더 유도(클리닉 통제 불가).

## 한국/치과 특이사항
- 한국 로컬은 일반 웹검색에 의존 → **네이버/포털 가시성 + 크롤 가능한 한국어 평문 페이지**가 'Claude 비즈니스 프로필'(없음)보다 중요. `user_location`을 대상 한국 도시로.
- **의료광고법(제56조)**: Claude가 인용 페이지의 "최고/유일/1위"·미검증 전문의 표현을 그대로 `cited_text`로 재생산할 수 있음 → Claude 기반 표면을 운영하면 동일 금칙어 스크리닝 적용.
- 한국은 Claude의 실제 강세 시장(개발자/유료 편중)이라는 보도가 있으나 **단일 출처(KED Global)·시장점유 수치는 미검증** → "강세(추정)"로만, 수치 미표기.

## 출처 / 불확실성
- 공식: platform.claude.com/docs (web-search-tool, citations, search-results) + claude-api 스킬 레퍼런스로 핵심 필드 검증. **신뢰 medium**(필드패스 확인, 가격/캡/시장수치 미확인).
- 미확인: 제3자 제공자 정체, 소비자앱 검색 트리거 휴리스틱, "Gemini보다 약함"은 벤치마크 아닌 구조 추론, 모든 한국 점유 수치는 3자 추정.
