# 엔진별 치과 추천 로직 (조사·검증 2026-06-22)

각 AI 엔진이 "치과 추천"을 만드는 방식은 **구조적으로 다릅니다.** 한 가지 "GEO"가 아니라, 엔진마다 측정 방법·최적화 레버가 갈립니다. 이 폴더는 9-에이전트 워크플로(조사 → 적대적 검증 → 종합)로 만든 엔진별 정본입니다.

> **반허위(NO-FAKE) 정책:** 검증 단계에서 출처 없는 수치를 전부 걸러냈습니다. 아래 문서에는 "치과 추천의 90%가 answer-first", "스키마 시 47% 인용↑", "한국 ChatGPT 78.8%/Perplexity 12.8%", "Claude Code 6x" 같은 **단일출처·환각 의심 수치를 의도적으로 넣지 않았습니다.** 추정은 "추정"으로 라벨합니다.

## 엔진별 요약 + 도구 적용 모드

| 엔진 | 추천 엔진 방식 | 측정 모드 | 인용 필드 패스 | 한국 가중 |
|---|---|---|---|---|
| [ChatGPT](chatgpt.md) | 검색모드(OAI-SearchBot)→질의재작성→웹인덱스+파트너, 인용 | **auto-api** | `output[message].content[output_text].annotations[url_citation].url` (+`sources[]`) | medium |
| [Gemini](gemini.md) | **Google Maps/GBP 그라운딩** + 지식그래프 + Search | **checklist**(ToS) | `groundingMetadata.groundingChunks[].maps.{uri,placeId}/.web.uri` | high |
| [Claude](claude.md) | 웹검색 도구(제3자 제공자), 자체 인덱스 없음 | **auto-api** | `content[].citations[](web_search_result_location).url` | medium |
| [Perplexity](perplexity.md) | **항상 검색** 답변엔진, 모든 답 인용 | **auto-api** | `search_results[].url` + `citations[]` (`source`는 enum, .url로 매칭) | medium |
| [Naver](naver.md) | 플레이스+블로그+카페 내부코퍼스 RAG (CUE:/AI 브리핑) | **checklist**(API 없음) | AI브리핑 API 없음; Local API `items[].link`(5개 캡, SERP 순서 아님) | high |

## 핵심 구조 차이 (왜 하나의 GEO가 아닌가)
- **Gemini = GBP/지도 게임.** 진짜 로컬 레이어(Maps·GBP·지식그래프)를 가진 유일한 엔진. 구글 비즈니스 프로필 완성도가 1차 레버.
- **ChatGPT/Claude/Perplexity = 일반 웹검색.** 지도/비즈니스 프로필 그래프 없음 → 크롤 가능한 온페이지 SEO + 디렉토리 + 리뷰가 레버(맵팩 없음). 우리 휴리스틱 7신호가 잘 맞는 영역.
- **Naver = 별도 월드.** 플레이스+블로그 내부 코퍼스. **외부 AI 크롤러(GPTBot·OAI-SearchBot·PerplexityBot·ClaudeBot·Google-Extended) 차단** → 네이버 내부 콘텐츠는 ChatGPT/Perplexity/Claude에 안 보임.

## 글로벌 규칙 (도구에 인코딩)
1. **월드 분리:** 네이버 내부 최적화 ≠ 외부 AI(열린 웹+GBP) 최적화. **별도 스코어카드**로 다룬다.
2. **인용 ≠ 열람:** url_citation 없다고 "안 봤다"가 아니다 → `sources[]` 교차확인. "미인용"을 "미열람"으로 보고 금지.
3. **API는 소비자 앱의 프록시:** 개발자 API 인용 = 추세 신호(고정 프롬프트셋·시계열), 진실 아님.
4. **로컬 능력 차이 인코딩:** "Claude한테 GBP 최적화하라"고 말하지 말 것(Claude엔 GBP 레이어 없음).
5. **의료광고법(제56조) 횡단:** 인용 따려고 "잘하는/최고/1등·보장·전후" 카피 권장 금지. 검증가능 사실 깊이(전문의·시술·프로세스)로. (Perplexity·Naver AI도 교육형>홍보형을 선호 → 컴플라이언스와 방향 일치.)
6. **교차 귀속 위생:** SKT-Perplexity 딜은 **Perplexity 전용** 맥락(다른 엔진 행에 누설 금지).

## 출처 신뢰도
- ChatGPT·Gemini: **high**(공식 문서 다수 검증). Claude·Perplexity·Naver: **medium**(공식 필드패스는 확인, 시장점유·내부 랭킹 가중은 실무 추정).
- 빌드 전 재확인 필요(검증에서 플래그): Claude는 `web_search_20250305`/`20260209`만(환각된 `20260318` 제외), 가격·150자 캡은 라이브 재확인. Gemini `googleMapsWidgetContextToken` 필드명 미확인. Perplexity `search_domain_filter ~20` 캡은 버전 의존.
