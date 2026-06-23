# 재설계 — 실측 중심 (v0.2 방향)

## 왜 (근거)

[검증 연구 v0.1](validation/heuristic-vs-citation-2026-06.md)에서 예측 점수가 실제 GPT 인용과 **역상관·측정불가(2/5)·불안정**으로 확인됨. 사용자 결정: **"예측이 아닌 실측이 중점."** 제품 무게중심을 예측(휴리스틱 0~100)에서 실측(실제 엔진이 인용하나)으로 이동한다. 경쟁자(블연플=네이버 단일지수, 동훈=Gemini 단일추적)와의 차별점도 여기 = "우린 예측 안 하고 실제로 물어본다."

## 새 정보 위계 — 하이브리드 퍼널 (Phase 1 CEO 결정, 2026-06-23: "실측이 열고, 실행이 닫는다")

| 순서 | 무엇 | 역할 | 현 상태 |
|---|---|---|---|
| **① HOOK** | **실측 스냅샷** — "성남치과 물으면 누가 추천되나" 실제 엔진(ChatGPT/Perplexity) 질의 → 경쟁 N곳 인용 vs 귀원 + utm 증거 | 데모 wow·진입 | 코어 `lib/citation.js` → 승격. **인용률+신뢰구간(N회)**, 단발 이진 금지(AD-3) |
| **② CLOSE** | **실행가능 갭 + 경쟁사 포획** — "경쟁 5곳은 doctornow·goodoc 등재, 귀원 3곳 누락 → 채우면 후보. 이번 달 고칠 N개" | 팔 갭 생성·전환 | **신규(헤드라인 가치)**. 영업/T2 직결 |
| **③ SUPPORT** | **등재 현황 맵**(描述, 인과 아님) — 디렉터리/플레이스/전문의 엔티티/NAP. **균형표본 검증 전까지 "그래서 인용됨" 금지**(AD-1) | 갭의 근거 | 신규, `checklists.js` 시드 |
| **④ FOOTNOTE** | **크롤/렌더 위생 점수**(구 0~100) — 필요조건, 노출예측 아님. **헤드리스 렌더 선수정 후**(AD-2) | 보조 진단 | `scorer.js` 강등·재라벨 |

## 카피 재작성 (정직 — 과장 제거)

- **hero:** "AI가 인용할 **준비**가 됐을까?"(예측 암시·과장) → **"지금 AI가 우리 치과를 추천하고 있나? — 실제로 물어보고 증거로 보여드립니다."**
- **점수 옆 라벨:** "이 점수는 **페이지 추출 위생**(뜨기 위한 필요조건)입니다. 실제 노출 여부는 아래 **실측**에서 확인하세요. (노출 예측 아님)"
- **미측정:** "측정 안 됨"(0 위장 금지). 인증서 만료·차단 사이트는 사유 표기.

## 구현 변경 (단계별)

### 1단계 — 무료·지금 (정직 + 견고화)
- **프론트 위계 전환**(`public/app.js`·`index.html`): 점수 미터를 보조 카드로 강등, 실측 패널 영역을 결과 상단(헤드라인)으로. hero/라벨 카피 위 문구로 교체.
- **fetch 견고화**(`lib/fetcher.js`·`audit.js`): 인증서 만료·TLS 끊김·modoo/SPA → `status:'unmeasurable'` + 사유(현재는 throw/0에 가까움). 실제 엔진이 인용하는 사이트를 "0점"으로 오도하지 않음.
- **재현성**: JS-shell 판정 안정화(간헐 SPA·utm 분기 영향 축소). 골든셋에 회귀 고정.
- **점수 재라벨**: `methodologyVersion` 카피·`/methodology.html`에 "추출 위생 = 필요조건, 노출예측 아님" 명시.

### 2단계 — 키 (실측 헤드라인 라이브)
- `lib/citation.js`+`api/citation.js`를 **지역+의도 질의**로 구동(홈/페이지에서 지역·진료 파싱 또는 입력). 노출 k/N + utm 증거 카드.
- 이메일 게이트·`CITATION_ENABLED`·KV 레이트가드 기존 설계 유지(비용폭탄 방지).
- 자동 = ChatGPT+Perplexity(Gemini ToS 제외 유지).

### 3단계 — 존재 맵 + 리포트
- 디렉터리/플레이스 존재 체크(가능 범위·스크래핑 차단 한계 명시), 전문의 엔티티 추출.
- 리포트 = 실측 증거 중심(점수는 작은 위생 각주). PSI(기존 계획)는 "품질 보조, 노출예측 아님" 라벨로만.

## 반허위 가드 (유지)

- 실측 못한 건 **"측정 안 됨"**(0 위장 금지). 모든 노출 주장에 utm·엔진·질의·시각 증거.
- 단일 질의 일반화 금지(검증 v0.1 한계 명시). N회·문구변형·다엔진 집계 권장.
- 점수를 "노출 예측"으로 절대 표기하지 않음(오늘의 오류를 PSI·AI준비도로 3배 키우지 않기).

## 기존 계획과의 관계

- [GEO 마스터 플랜](../../../../.claude/plans/deep-research-report-md-geo-md-cozy-metcalfe.md)의 PSI(Phase A)·리포트(Phase B)는 **유효하되 위계 하향** — 둘 다 "페이지 품질" 보조층. 헤드라인은 실측.
- 검증 v0.2(균형표본·다엔진)는 키 연결 후 실측 데이터로 수행.

---

## AUTOPLAN REVIEW — Phase 1 CEO (2026-06-23, 듀얼보이스 Claude×Codex)

**합의: 6/6 차원 CONFIRMED — 전략 보정 필요.** 두 독립 보이스가 동일 결론 수렴(고신뢰 신호).

| 차원 | 합의 |
|---|---|
| 전제 타당성 | 약함 — 인과모델이 n=6에서 가정됨 |
| 올바른 문제 | 아니오 — "측정"이 아니라 "인용시키기(실행)"가 제품 |
| 범위 보정 | 측정 과대·실행층 과소 |
| 대안 탐색 | "플레이북/실행=제품" 미검토 |
| 경쟁 리스크 | 실측=커머디티(동훈·Google PSI), 해자=KR 치과 엔티티그래프+실행 |
| 6개월 궤적 | 스냅샷≠추세, 소비자앱≠API, fetcher 렌더버그 |

### 자동 반영 (Mechanical — 양 모델 합의·정직성/정확성)
- **AD-1 인과→기술(描述) 강등:** 존재맵은 "등재 현황"으로 표기, "그래서 인용됨" 금지. **균형표본(인용/미인용 모두)으로 디렉터리 델타 측정 전까지 인과 주장 불가.** 근거: selection-on-dependent-variable(미인용 치과의 디렉터리 등재율 미측정).
- **AD-2 fetcher 렌더 선수정:** 점수 강등 전 헤드리스 렌더 + 골든셋 재현성 고정. 더서울 63=가시텍스트 2%·script 45(JS-shell 미렌더), 밸런스 15↔45=불안정. 점수 라벨 "크롤/렌더 위생". raw HTML·rendered DOM·unmeasurable 분리 표기.
- **AD-3 변동성 기준선:** 실측은 단발 이진(cited/not) 금지 → N회(5~10)·문구변형·인용**률 + 신뢰구간**. 주간 추세=계약 후 retention 증거로 전환.
- **AD-4 측정면 불일치 명시:** 소비자앱 ChatGPT 인용(utm 증거)은 API로 재현 안 됨. 자동화=Perplexity API 주도, ChatGPT 소비자앱=수동/프리미엄. 증거 저장(시각·프롬프트·엔진·인용URL·runId).
- **AD-5 해자 재정의:** 헤드라인 차별화를 커머디티(실측)에 걸지 않음. 해자=KR 치과 엔티티그래프(클리닉→디렉터리→전문의→의도슬롯) + before/after 개입데이터 + 에이전시 실행 워크플로.

### USER CHALLENGE (양 모델이 사용자 방향 변경 권고 — 자동결정 불가)
- **사용자가 정한 것:** "예측이 아닌 **실측이 중점**"(헤드라인=실제로 AI가 인용하나).
- **양 모델 권고:** 실측은 진단/증거이지 **헤드라인이 아님**. 헤드라인=**실행가능한 갭 + 경쟁사 포획**("성남치과 물으면 누가 추천되나; 귀원이 후보가 되려면 닫을 갭 N개"), 실측=그 안의 before/after 증거 + 계약 후 retention.
- **이유:** (a) 실측은 커머디티(복제 쉬움) (b) ToS/비용·소비자앱≠API로 스케일 취약 (c) 스냅샷≠추세 (d) "AI가 당신을 안 본다" 공포헤드라인이 리드를 양방향 실격(겁줘서 이탈 OR 이미 인용된 곳은 "난 됐네").
- **모를 수 있는 것:** 사용자가 아는 영업 모션·메디앤메디 실행역량·"AI가 당신 모름" 데모의 클로징 위력.
- **틀렸을 때 비용:** 갭/플레이북 헤드라인인데 에이전시가 실제 수정(디렉터리·엔티티)을 품질·스케일로 실행 못하면 과약속. 반대로 실측 데모가 실제로 계약을 더 잘 닫을 수도.
- **결정:** Phase 4 게이트(또는 즉시 프리미스 게이트)에서 사용자 확정. 기본값=사용자 원안.
- **→ 해소(2026-06-23, 프리미스 게이트):** **하이브리드 채택** — ①실측 hook이 열고 ②실행 갭+경쟁사 포획이 닫음. 사용자 확정. 위 "하이브리드 퍼널" 위계 반영.

### What already exists (재사용)
실측 코어 `lib/citation.js`+`api/citation.js`(승격), `lib/checklists.js` GBP/Place(존재맵 시드), `lib/engines.js` 추출기, fetcher SSRF. 신규=존재맵 디렉터리체크 + 렌더 폴백 + 변동성 집계.

### NOT in scope (이번)
시계열 KV/cron(Phase D), 자동 ChatGPT 소비자앱 수집(ToS), 레비뉴 귀속 추적(콜·예약), 한국 인덱스/벤치마크 발행.

---

## AUTOPLAN REVIEW — Phase 2 Design (2026-06-23, 듀얼보이스)

**합의: 7/7 CONFIRMED.** 두 보이스가 동일 P0 독립 도달. 핵심: 전환 카드(CLOSE)가 가장 미설계·최대 법적노출 — 정확히 역전.

### 자동 반영 (구조적 수정 — auto-fix)
- **AD-6 퍼널 순서(동기 CLOSE 우선):** 제출 즉시 **싸고 빠른 데이터(휴리스틱+등재체크)로 CLOSE 갭 프리뷰 동기 표시**, 느린 유료 실측 HOOK는 백그라운드 → 증거로 강화. 60초 스피너 응시 금지. *[taste: 사용자 "실측이 열고"의 시퀀싱 미세조정 — Phase4 게이트에 노출]*
- **AD-7 의료광고법(CRITICAL):** **공개 셀프서브 = 익명 집계만**("상위 5곳 중 4곳 doctornow 등재, 귀원 미등재"). 플랫폼명(doctornow/goodoc)=사실, OK. **경쟁 치과 실명 = 공개 금지.** 실명 비교는 **이메일+noindex 사설 리포트**에서만(시장조사 프레이밍). 이메일 게이트=공개/사설 법적 경계. CLOSE/HOOK 카피 `clinic-ad-compliance` 스캐너 통과 + 공개 경로에 경쟁사명 문자열 렌더 차단 가드.
- **AD-8 비동기 상태머신:** `/api/citation` 잡 기반 enum(`queued/running/partial/complete/failed/cached/unmeasurable/rate-limited`). 엔진별 독립 렌더. 제출 전 "유료 외부 측정이라 이메일 필요" 명시. cached=측정시각+경과. **unmeasurable ≠ 0**(벤더실패 vs 클리닉약점 구분).
- **AD-9 감정 아크:** HOOK=공포 아닌 **수요포착/FOMO**, 비율 언어("10번 중 3번 추천", 소표본 CI 주의). 미인용 행은 인라인으로 CLOSE 연결("미인용 — 큰 이유=등재 누락 ↓"). 인용된 곳=수성/확장(주간 추적 retention). 인용 행에 적색 ✗ 금지(style.css grey-not-red 전파).
- **AD-10 점수 강등 설계:** 0~100 미터 제거 → 접힌 `<details>`/인라인 pill. 그라디언트 큰 숫자 폐기. "페이지 위생 체크"로 개명(AI visibility score 아님).
- **AD-11 명세 갭 해소(빌드 전):** 상태 매트릭스 아티팩트 + 지역파싱(무입력 vs 폼+실패경로 택1) + CI 평어 시각화(통계 아닌 "N번 중 k번") + 경쟁사 정의(동 시/구+진료) + 고칠목록 데이터소스(checklists.js+라이브 등재체크) + KR 치과 디렉터리 목록·검증법 + 상태별 카피(SUPPORT는 비인과 문자열 사전작성).

---

## AUTOPLAN REVIEW — Phase 3 Eng (2026-06-23, 듀얼보이스)

**합의: 6/6 CONFIRMED + PSI렌더 1 DISAGREE(taste).** 라이브 결함 발견.

### 자동 반영 (Eng 수정 — auto-fix)
- **AD-12 유출 경계(CRITICAL·라이브 결함):** `lib/citation.js`의 `sampledCitedDomains`+`evidence[].matchedUrls`(경쟁 도메인)가 `api/citation.js:68`에서 클라이언트로 그대로 반환됨 → `CITATION_ENABLED=true` 순간 활성. **`lib/redact.js`** `toPublicView()`(상태·runs·citedRuns·hitRate·Wilson CI·시각·익명 집계만; matchedUrls/sampledCitedDomains/raw evidence 제거) / `toPrivateReport()`(사설·이메일 전용). 공개 응답 전부 `toPublicView` 경유. **유출 가드 테스트**(직렬화 공개 payload에 비소유 도메인·http·matchedUrls·sampledCitedDomains 없음).
- **AD-13 비동기+시간예산(CRITICAL):** `runCitationPanel` 순차 루프(engine×prompt×repeat) → N=5·3프롬·3엔진=45콜=135s+ → 120s 초과. **Promise.allSettled+동시성캡(~6)**, `repeats` 서버 클램프(`MAX_REPEATS`). N>5는 **fire-and-return 202 + waitUntil + KV결과 + 이메일 전달**(폴링 FSM 불필요). **`vercel.json` api/*.js=20s vs api/citation.js 인파일 120s 충돌 → 라우트별 명시 수정.**
- **AD-14 비용 가드(CRITICAL):** in-memory Map=인스턴스별 no-op. **KV는 CITATION_ENABLED=true 전 필수.** per-IP/per-email/일 캡 + 글로벌 일 예산캡(`DAILY_CITATION_BUDGET`) + 24h 디덥 키=domain+region+procedure(현재 domain만→충돌). 비용모델: requests=engines×prompts×repeats; 100리드/일×45=4,500 유료콜.
- **AD-15 존재=오프라인 인덱스(P1, 로드베어링):** 즉시 CLOSE의 디렉터리 존재는 **라이브 스크래핑 불가**(ToS·봇월·SPA거짓음성). **`lib/presence.js`=사전구축 오프라인 엔티티 인덱스**(정규화 상호·전화·주소·도메인)→`present/absent/unknown`, **실패를 absent로 추론 금지.** 네이버=Local Open API(합법 존재확인). goodoc/doctornow=오프라인 인덱스 or 운영자 체크리스트. **즉시 CLOSE의 무료 콘텐츠=휴리스틱 `topFixes`(이미 결정론 계산됨).** ⚠️ 인덱스 구축 오너 없으면 CLOSE 절반 미배포.
- **AD-17 측정불가 분류(P1):** 명시 상태 `measured / unmeasurable:cert / :tls / :blocked / render-needed:spa / vendor-failure / timeout`. 0 위장 금지. `audit.js`·`api/score.js`·citation 전파.
- **AD-18 PII 로그(P2):** `api/citation.js`·`lead.js` 이메일 평문 로그 → 해시/마스킹.
- **AD-19 테스트:** 유출가드(직렬화 스캔)·비용가드(클램프·캡)·Wilson CI(0/5·1/5·5/5)·측정불가 분류·존재 present/absent/unknown(실패≠absent)·렌더 폴백·vercel config 일관성.

### TASTE (Phase 4 게이트 노출)
- **T-ENG PSI=렌더러?** Claude=PSI가 헤드리스 대체(needsHeadless 분기에서 PSI 렌더 출력으로 신호 재도출). Codex=PSI는 렌더 *증거/품질*이지 제어가능 DOM 추출기 아님 → support로만 + `render-needed` 라벨, 진짜 추출 필요시 외부 렌더 서비스. **공통: Puppeteer 번들 금지.** 권고=Codex 보수안(PSI 보조 + 정직 라벨, 헤드리스 디퍼).

### 강점(보존)
`lib/citation.js`+`lib/engines.js`+`test/citation.test.js`=순수·모킹테스트·검증된 API 파라미터·증거스탬프·measured≠cited 정확 모델. **유출경계·비용가드를 코어 건드리지 않고 주위에 추가.**

---

## GSTACK REVIEW REPORT (/autoplan, 2026-06-23)

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO | `/autoplan` | 전략·범위 | 1 (codex+subagent) | CONFIRMED→resolved | 헤드라인 reframe→하이브리드(UC해소), 인과모델 overfit(AD-1), 해자=엔티티그래프(AD-5), 변동성 기준선(AD-3) |
| Design | `/autoplan` | UI/UX | 1 (codex+subagent) | 7/7 CONFIRMED | 퍼널순서(AD-6), **의료광고법 경쟁사 실명(AD-7 CRIT)**, 비동기 상태(AD-8), 점수강등(AD-10), 명세갭(AD-11) |
| Eng | `/autoplan` | 아키·보안·테스트 | 1 (codex+subagent) | 6/6 CONFIRMED +1 disagree | **유출 라이브결함(AD-12 CRIT)**, **비용가드/KV(AD-14 CRIT)**, 비동기예산(AD-13), 존재=오프라인인덱스(AD-15), 측정불가분류(AD-17) |
| DX | — | — | 0 | skipped | 개발자 대상 아님(운영자·원장) |

**VERDICT:** 하이브리드 방향 건전·샤프해짐. **1단계 무료수정 승인·구현 착수.** 라이브 키 전 AD-12(유출경계)·AD-13(비동기예산)·AD-14(비용가드/KV) 필수. CLOSE 절반은 존재-인덱스 결정(AD-15) 대기. 강점=citation 코어 보존.
