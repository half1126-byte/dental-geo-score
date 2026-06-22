# ChatGPT (OpenAI) — 치과 추천 로직

**한 줄:** 검색이 켜지면 OAI-SearchBot이 크롤한 웹인덱스 + 파트너 피드에서 질의를 재작성·검색해 인용을 붙여 답한다. 검색이 안 켜지면 사전학습 기억(환각 위험)으로 답한다.

## 추천 생성 로직
두 경로:
1. **무검색/파라메트릭** — 학습 가중치 기억으로 답. 로컬 치과엔 부정확(옛 정보·환각 상호/주소), **인용 0**. API에서 `tool_choice:auto`면 검색을 건너뛰고 `annotations[]`가 빈 채 나온다.
2. **검색 모드 / web_search 도구** — 프롬프트를 검색 질의로 재작성(추론모델은 여러 번), OpenAI 검색 백엔드로 전달. 후보 = OAI-SearchBot이 크롤·색인한 콘텐츠 + 파트너 피드. 상위 결과를 읽고 **단일 답 합성 + url_citation 주석 + 더 큰 sources 목록**. 위치는 `user_location`(country/city/region/timezone)로 주입돼 "강남"이 지역화됨. **랭크된 SERP는 없다** — 인용되거나 안 되거나(이진), "4위" 같은 위치 보장 없음.

## 추천을 만드는 신호
- **인덱스 등재(OAI-SearchBot 크롤 가능)** [high] — 차단 시 "ChatGPT 검색 답변에 안 나옴". 하드 게이트.
- **권위/신뢰(E-E-A-T류)** [high] — OpenAI는 "신뢰·관련 정보를 위한 여러 요인"이라고만 명시. 권위·전문성·깊이·교차검증으로의 분해는 **실무 해석(추정)**.
- **재작성 질의와의 관련성** [high] — 위치+시술+의도가 본문에 명시된 페이지가 더 잘 회수됨.
- **신선도** [medium], **제3자 제공자 랭킹+파트너 피드** [medium], **로컬/구조화 정합(NAP·리뷰·지도)** [medium, OpenAI 직접 명시 아님], **위치 파라미터** [high].

## 인용 메커니즘 (검증됨)
`response.output[]`(type==message) → `content[]`(type==output_text) → `annotations[]`(type==`url_citation`) → `.url`/`.title`/`.start_index`/`.end_index`. 별도로 `web_search_call`의 `action.sources`(또는 response `sources`)가 **열람한 전체 URL**을 노출 — OpenAI: "sources 수가 citation 수보다 많은 경우가 많다"(열람 ≠ 인용).

## 측정 가능성 — **auto-api** (API 경로)
Responses API + web_search + 고정 `user_location`으로 호출 → `annotations[].url`에 거래처 도메인 등장 여부를 스크립트로 체크. **소비자 ChatGPT 앱**의 인용을 읽는 공식 API는 없음(수동). ⚠️ `annotations[]`가 비어도 `web_search_call`이 돈 경우 있음 → **`sources[]` 교차확인**(미인용≠미열람). 소비자 UI 자동 스크래핑은 ToS 위반 위험.

## 최적화 레버
1. **OAI-SearchBot 허용**(robots.txt + CDN/WAF에서 searchbot.json IP 허용) — 비협상 진입 게이트. 서버로그로 실제 크롤 확인.
2. **검증 가능한 교차웹 권위** — 의료진 실명·자격·깊이 페이지 + 신뢰 제3자(리뷰/디렉토리/언론/학회) 일관 등장.
3. **재작성 질의에 맞춘 위치+시술 명시 페이지**.
4. **로컬/구조화 신호**(NAP 일관, LocalBusiness/Dentist JSON-LD) [medium]. **신선도 유지**.
5. 측정 하니스로 시계열 추적. **"보장 1위" 벤더 금지**(OpenAI가 위치 보장 불가 명시).

## 한국/치과 특이사항
- **의료광고법(제56조)**: 권위로 읽히는 콘텐츠를 "잘하는/최고/1등·보장·전후" 없이 써야 함 → 검증 사실 깊이(전문의·시술 상세·투명 프로세스)로.
- **네이버 함정**: 한국 로컬은 네이버가 강하지만 ChatGPT 백엔드는 비-네이버 제3자 제공자 → **네이버만 강하고 열린 웹(자사 도메인·디렉토리)에 약하면 ChatGPT에 안 보일 수 있음**. 자사 도메인을 OAI-SearchBot이 크롤하게 + 법준수 시술/위치 콘텐츠 확보.
- 한국 ChatGPT 사용은 높고 상승세(OpenAI가 2025-10 'AI in South Korea' 블루프린트 발간)이나, **치과/로컬 발견 점유의 공식 수치는 없음** → 어떤 % 도 만들지 않음.

## 출처 / 불확실성
- 공식: developers.openai.com/api/docs/bots, /guides/tools-web-search, help.openai.com publishers FAQ. **신뢰 high.**
- 추정/미확인: 백엔드 제3자 제공자 정체 미공개, 소비자앱↔API 백엔드 동일 보장 없음, "권위/신선도" 분해는 2차 GEO 블로그 기반, schema가 ChatGPT에 직접 도움인지 미확인(상류 제공자 경유 간접, medium).
