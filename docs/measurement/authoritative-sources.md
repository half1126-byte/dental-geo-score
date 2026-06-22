# 공신력 있는 근거 (인용용) — AI 인용/검색

제안서·방법론·리포트에 인용해도 되는 **공신력 출처**. 신뢰도 순으로, 단일출처 SEO 블로그는 제외(반허위).

## 1차/중립 — 그대로 인용 가능
- **Pew Research Center (중립·최고 권위)** — 구글 AI 요약과 클릭 행동. 미국 성인 900명 실브라우징.
  - 핵심: 구글 검색 ~**18%가 AI 요약** 노출(2025-3); AI 요약 시 일반 링크 클릭 **8%**(없으면 15%), AI 요약 **안의** 링크 클릭 **1%**; `.gov` 출처 과대표(6% vs 2% — AI가 권위 출처 선호).
  - [pewresearch.org](https://www.pewresearch.org/short-reads/2025/07/22/google-users-are-less-likely-to-click-on-links-when-an-ai-summary-appears-in-the-results/)

## 학술(피어리뷰) — "무엇이 인용을 늘리나"의 근거
- **GEO: Generative Engine Optimization (Aggarwal et al., KDD 2024)** — 10,000 질의 실험. **인용·통계·전문가 인용문이 각각 +25~40% 가시성.** 우리 휴리스틱(answer-first·근거·구조화)의 학술 백본.
  - [arXiv 2311.09735](https://arxiv.org/abs/2311.09735) · [ACM KDD 2024](https://dl.acm.org/doi/abs/10.1145/3637528.3671900)

## 데이터회사 — 거시 추세 ("~사 기준"으로만, 사실 단정 금지)
- **Semrush** (17개월 클릭스트림): ChatGPT 답변 인용 포함률 **0.6%(2025-1)→2.8%(2025-8)**; 인용 출처 1위 Wikipedia 6.2%·Reddit 5.2%; AI 트래픽 전체 <0.15%(66% 성장); **LLM 방문자 전환 4.4배**.
  - [semrush.com](https://www.semrush.com/blog/chatgpt-search-insights/)
- **Similarweb**: GenAI 트래픽 점유 ChatGPT 77%→57%, Gemini 6%→25%(2025초→2026-3); 산업별 AI 추천 유입 winners.
  - [similarweb.com](https://www.similarweb.com/blog/marketing/geo/gen-ai-stats/)
- **Cloudflare** (망 기준): 봇 57.5% of HTML 트래픽, AI 크롤러 20.3%+AI검색봇 6.5%(2026-05).
  - [blog.cloudflare.com](https://blog.cloudflare.com/ai-crawler-traffic-by-purpose-and-industry/)

## 벤더 공식 문서 — 메커니즘(크롤러·인용 필드·그라운딩)
OpenAI(bots·web_search) · Google(AI 최적화 가이드·grounding·GBP) · Anthropic(web search·citations) · Perplexity(Sonar) → [docs/engines/](../engines/) 참고.

## ❌ 공신력 *없는* 것 (쓰지 말 것)
"치과추천 90% answer-first", "스키마 47% 인용↑", "한국 ChatGPT 78.8%/Perplexity 12.8%", "Claude Code 6x" 등 — **단일출처·환각**. 제안서 금지.

## 핵심 메타
- **거시**(인용이 늘고 클릭은 줄고 등)는 공신력 출처 있음(위).
- **"내 치과가 실제 인용되나"의 중립 공인 점수/권위는 없음**(AI 인용은 확률적·비재현). → **공식 엔진 API 직접 측정 + 공개 방법론**이 유일하게 정직한 길. 그 빈칸이 메디앤메디의 자리.
