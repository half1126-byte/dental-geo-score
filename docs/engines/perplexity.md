# Perplexity — 치과 추천 로직

**한 줄:** 거의 모든 질의에 **실시간 검색**을 돌리는 답변엔진. 모든 답에 출처를 단다. 회수 패시지에 제약된 합성 → 인용 마커가 소스로 매핑. 한국은 SKT 무료 Pro로 침투율이 글로벌보다 높음.

## 추천 생성 로직
"항상 검색" 라이브 RAG: (1) 의도 파싱·서브질의 분해 → (2) 자체 크롤/인덱스에 하이브리드(BM25 키워드 + 밀집 임베딩) 검색 → (3) 관련성·신선도·답변구조·권위로 다단 리랭크 → (4) Sonar가 회수 패시지에 **제약된** 답을 인용 마커와 합성. 로컬은 추론 위치(IP/디바이스), Sonar API는 `web_search_options.user_location`(lat/lng/country/city/region) + `search_domain_filter`(허용/차단) + `search_recency_filter` + `search_mode`로 명시 제어. = 파라메트릭 회상이 아닌 **라이브 검색 그라운딩.**
> 회수 내부수치(60+ 소스/리랭크 0.7 임계/5단계/`pplx-embed` 모델명)는 **비공식 역공학 블로그** 출처 → 본 문서는 사실로 싣지 않음(추정 표시).

## 추천을 만드는 신호
- **라이브 지오 회수(user_location/IP)** [high] — 근처 회수 코퍼스에 있어야 추천 가능.
- **answer-first/추출 가능 패시지 배치** [high] — 첫 문단에 답(상호·비용대·시간·주소). (※ "90%가 answer-first"류 수치는 출처 없어 **제외**.)
- **페이지 신선도** [high] — 무거운 게이트. 가격/시간 오래된 페이지는 탈락. (※ "12~18개월" 같은 단정 수치는 출처와 불일치라 제외 — "현행 유지"로.)
- **구조화 데이터(JSON-LD)+명확 NAP** [high], **교육/정의형(홍보 아님)** [medium], **주제 권위/실명 전문가** [medium], **디렉토리/리뷰/포럼(레딧 포함) 등장** [medium], **크롤 가능(SSR·열린 robots)** [medium].

## 인용 메커니즘 (검증됨)
Sonar chat-completions 응답: 최상위 `citations[]`(소스 URL 문자열 배열) + `search_results[]`(객체: `.url`·`.title`·`.date`·`.last_updated`·`.snippet`·`.source`). 귀속: `choices[0].message.content`의 `[n]` 마커를 `search_results[]`/`citations[]`에 인덱스/URL로 매핑.
> ⚠️ **`search_results[].source`는 enum(`web`|`attachment`)이지 게시자명이 아님** → 도메인 매칭은 **`.url`로만**. `search_domain_filter` "~20 캡"은 버전 의존(chat-completions 레퍼런스엔 하드캡 없음).

## 측정 가능성 — **auto-api**
유료 Sonar 호출이 답을 그라운드한 정확한 `search_results[].url`+`citations[]`을 반환 → 시드 프롬프트에 거래처 도메인 등장 여부를 도메인 diff로 자동 측정. 단 (1) API 답 ≠ 소비자 perplexity.ai 앱(랭킹/UX 다름, 앱은 user_location 자동) → 프록시, (2) 유료(토큰+검색당 과금)·레이트리밋, 소비자 UI 스크래핑은 ToS 위반 → 공식 API 경유.

## 최적화 레버
1. **answer-first/BLUF**(상호·비용대·시간·주소를 도입부). 2. **JSON-LD**(Dentist/MedicalClinic/FAQPage/Person + NAP). 3. **정의/교육 깊이 > 홍보**(시술/비용/회복/부작용 클러스터). 4. **신선도 유지**. 5. **(API 빌드 시) user_location + search_domain_filter로 신뢰 디렉토리 허용**. 6. **크롤 가능 디렉토리/리뷰/포럼 등장**. 7. **실명 전문가 저자**(Person 스키마). 8. **SSR/크롤 가능성**.

## 한국/치과 특이사항
- **SKT 딜(검증됨):** SK텔레콤이 Perplexity에 **$10M 투자(2024-06)** + 가입자에 **Perplexity Pro 1년 무료**(A.(에이닷)/T Universe 경유, ~32M 대상). → 한국 사용자가 통신사 앱 안에서 Perplexity급 인용 검색에 도달. *단 "자격 ≠ 활성화"(실제 사용수 미공개), 한국 점유 78.8/12.8% 류 수치는 단일 아그리게이터라 **제외**.*
- **네이버 벽:** 네이버가 외부 AI 크롤러 차단 → Perplexity의 네이버 블로그/플레이스 접근 제한적(추정). 한국 치과는 네이버만으론 안 됨 → **자사 도메인 + GBP + 열린 디렉토리** 필요.
- **의료광고법:** 제56조가 최상급/랭킹 표현 제한 — 마침 Perplexity는 교육형>홍보형을 선호 → **컴플라이언스와 인용 최적화가 같은 방향.**

## 출처 / 불확실성
- 공식: docs.perplexity.ai/api-reference/chat-completions-post, /docs/sonar/quickstart, perplexity.ai/hub. SKT: KED Global·Neowin. **신뢰 medium**(필드패스·SKT딜 검증; 내부 회수수치·점유율 미검증).
- 검증에서 제거: "90% answer-first", "47% 스키마 인용↑", "12~18개월 cadence(출처는 daily-weekly)", `pplx-embed` 모델명, 한국 78.8/12.8% — 전부 출처 부재/모순.
