# API 연결 비용 · 어떤 API · 개선점 신빙성 (공식자료, 2026-06-23)

> 출처: 각 API 공식 가격 페이지 직접 조회(2026-06-23). no-fake 적대감사 통과 — **확인 안 된 숫자는 "미검증"으로 표기**.
> 반허위 원칙: 검색 호출비는 확정, 토큰비는 [추정], OpenAI 모델 단가는 공식 재확인 전까지 비용계산 투입 금지.

## (A) 클리닉당 비용 모델

호출 패턴: `엔진수 × 측정 프롬프트 3문구 × repeats`. 각 호출 web_search 강제(tool_choice:required).

| 엔진 | 콜수(r=1 / r=5) | 검색비(확정) | 토큰비([추정]) | 출처/확인일 |
|---|---|---|---|---|
| **OpenAI** (ChatGPT) | 3 / 15 | tool $0.01/call → **$0.03 / $0.15** | 미검증(모델단가 미확인) | web_search $0.01/call 형식충족¹ |
| **Perplexity** Sonar Med | 3 / 15 | fee $0.008/req → **$0.024 / $0.12** | ~$0.0012/콜 [추정] | docs.perplexity.ai/pricing |
| **Claude** Sonnet 4.6 (선택) | 3 / 15 | $0.01/search → **$0.03 / $0.15** | ~$0.047/콜 [추정] | docs.claude.com |

¹OpenAI web_search $0.01/call은 출처 형식 충족하나 모델 토큰단가 미확인으로 종합 보류.

**확정 검색비 합계 (3엔진, 토큰 제외):** r=1 ≈ **$0.084/클리닉**, r=5 ≈ **$0.42/클리닉**.
**100클리닉/월 (검색비만, 확정분):** r=1 ≈ **$8.4/월**, r=5 ≈ **$42/월**. 토큰비 포함 시 추정 2~4배(미확정).

실무 함의: **영업 데모용(잠재 거래처 소수 측정)은 비용 사실상 무시 가능**(클리닉당 1달러 미만). 대량 공개 셀프서브를 켤 때만 KV 비용가드가 의미. OpenAI 토큰 단가는 발급 후 실측으로 재계산.

## (B) 연결해야 할 API

| 구분 | API | 발급처(공식) | 무료 한도 |
|---|---|---|---|
| 필수(유료) | OpenAI Responses + web_search | platform.openai.com | 없음(종량) |
| 필수(유료) | Perplexity Sonar | docs.perplexity.ai | Tier0 RPM 50 |
| 선택(유료) | Anthropic Claude web_search | console.anthropic.com | 없음(종량) |
| 무료보조 | Google PageSpeed Insights v5 (품질·CWV) | console.cloud.google.com | **25,000/일 하드캡** |
| 무료보조 | Naver 검색 Open API Local (존재확인) | developers.naver.com | 25,000/일(2차출처·중간확신) |
| 무료보조 | Upstash Redis (비용가드·캐시) | upstash.com | 256MB + 50만 cmd/월 |
| 무료보조 | Vercel Functions (호스팅) | vercel.com | 100만 호출/월, maxDuration 300s(Hobby) |
| **제외** | **Gemini** | — | **ToS상 인용 자동측정 금지 — 사용 안 함** |

무료 스택 결론: 품질(PSI)·존재확인(Naver)·비용가드(Upstash)·호스팅(Vercel) 전부 **무료 한도로 PoC~소규모 운영 가능**. 상업화 시 Vercel Pro($20/seat) 정도만 고정비.

## (C) 개선점 신빙성 (과장 0 — 공식 출처)

| 레버 | 공식 출처 | 신빙성 등급 | 위생 vs 인용 인과 |
|---|---|---|---|
| AI 크롤러 허용 (robots.txt) | OpenAI bots·Anthropic·PerplexityBot·Google-Extended 1차 문서 | 입증(메커니즘) | **위생/필요조건** — 허용≠인용 보장 |
| JSON-LD 구조화 데이터 | Google sd-policies·schema.org Dentist | 타당·미입증/일부논쟁 | **위생** — Google "순위 직접영향 없음", FAQPage 리치결과 2026-05 폐기 |
| E-E-A-T / YMYL | Google 검색품질평가 가이드라인(2025-09판) | 타당·미입증 | **위생** — Google "직접 순위인자 아님" |
| PageSpeed "Agentic Browsing" AI준비도 | Chrome 공식 스코어링 문서(Lighthouse 13.4) | 논쟁(실험적) | **위생** — Google "인용 상관 주장 없음·단일점수 아님" |
| **콘텐츠형 GEO(인용·통계·전문가 인용)** | Aggarwal et al. KDD'24 (arXiv 2311.09735) | **부분 입증(실험실)** | **유일한 인용 인과 레버** — 단 합성벤치 한정 |

**핵심 결론 (영업 메시지 가드):** 자사 검증(점수↔실제 인용 무상관)과 일치 — 레버 1~4는 전부 **위생/필요조건**이고 인용 증가 인과 근거 없음(Google 본인이 명시). **AI 인용과 직접 인과가 입증된 유일 레버는 (5) 콘텐츠 인용성 강화**(본문에 출처·통계·전문가 인용), 그것도 실험실 한정. → 팔 때 **"점수 올리면 인용 오른다" 금지**, **"차단 제거(필수) + 콘텐츠 인용성 강화(유일 입증)"**로 분리.

## 출처 링크
- OpenAI: developers.openai.com/api/docs/pricing · /guides/tools-web-search · /deprecations (gpt-4o-search-preview 셧다운 2026-07-23)
- Perplexity: docs.perplexity.ai/docs/getting-started/pricing · /guides/usage-tiers
- Anthropic: docs.claude.com/en/docs/agents-and-tools/tool-use/web-search-tool · /about-claude/pricing
- Google PSI: developers.google.com/speed/docs/insights/v5/get-started
- Upstash: upstash.com/pricing/redis · Vercel: vercel.com/docs/functions/limitations
- 근거: developers.google.com/search/docs/appearance/structured-data/sd-policies · QRG(services.google.com/fh/files/misc/hsw-sqrg.pdf) · developer.chrome.com/docs/lighthouse/agentic-browsing/scoring · dl.acm.org/doi/10.1145/3637528.3671900
