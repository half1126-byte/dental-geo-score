# P1 (개정) — AI검색 "필드노트" + 자체 벤치마크 (린 온웨지)

작성일: 2026-06-28 · 개정: 2026-06-28 (autoplan CEO 게이트 결과 반영)
브랜치: realmeasurement-live
스펙 범위: **린 버전 P1만.** 전업종 리포지션(구 P2)·엔진 일반화(구 P3)는 **보류**(수요 검증 전).

## 0. 개정 이유 (autoplan Phase 1 결과)

Claude 독립 서브에이전트 + Codex가 독립적으로 **만장일치**로 원안(매일 자동 뉴스집계 + 전업종 리포지션)을 반려.
레포 자체 문서가 그 결론을 뒷받침:
- [docs/validation/heuristic-vs-citation-2026-06.md](../../validation/heuristic-vs-citation-2026-06.md): 점수 ↔ 실제 인용 **역상관**. "실측이 1급, 점수는 보조" 이미 결정.
- [docs/redesign-realmeasurement-first.md](../../redesign-realmeasurement-first.md): 딜 클로징하는 라이브 인용 데모에 **미해결 CRITICAL 블로커**(AD-13 비동기·예산 / AD-14 비용가드·KV / AD-15 존재 인덱스).

만장일치 반려 사유: (1) 뉴스피드는 전환을 못 움직임, (2) 전업종화=비치헤드 희석, (3) 수요검증 전 인프라=순서 역전, (4) AI뉴스 집계는 복제 가능(방어 0), (5) 멈춘 "권위" 피드는 무피드보다 신뢰 더 깎음(비대칭 리스크), (6) 스펙이 전환이 아닌 "배포 위생"을 최적화.

**사용자 결정(User Challenge 게이트):** 린 온웨지 버전. 아래가 그 설계.

## 1. 무엇으로 바뀌나 (원안 → 린)

| 항목 | 원안 (반려) | 린 (확정) |
|---|---|---|
| 포지셔닝 | 전 마케팅 AI검색 허브 | **치과·로컬 마케터** 비치헤드 유지 |
| 갱신 | 매일 06:00 크론 자동 | **주간, 사람이 큐레이션** (커밋·배포) |
| 가공 | 크론에서 LLM 자동요약·자동발행 | **사람이 검토 후 발행** (자동발행 0) |
| 신선도 약속 | "매일 06:00 갱신" 트러스트줄 | **약속 제거** + "최근 검토: YYYY-MM-DD" + **72h… 아니 stale-hide(아래)** |
| 저장/인프라 | KV + 크론 + dedupe + 폴백 | **레포 커밋 JSON 1개** (크론·KV·LLM-in-request 0) |
| UI | 독립 `/news.html` + 홈 | **진단 결과/홈에 종속 섹션**, CTA 1개로 진단 복귀 |
| 콘텐츠 | 3자 헤드라인 집계(복제가능) | 헤드라인 + **자체 측정 기반 벤치마크**(방어가능) |

## 2. 콘텐츠 모델 (2종)

### (A) 필드노트 — 주간 사람-큐레이션
치과·로컬 마케터에게 **이번 주 영향 있는** AI검색 변화. 사람이 고르고 한 줄 쓴다(자동발행 없음).
```json
{
  "kind": "fieldnote",
  "title": "원문 제목",
  "url": "원문 링크",
  "source": "Search Engine Land",
  "date": "2026-06-27",
  "summary": "구글이 AI 개요 인용 표기를 강화했다.",   // 사실 1줄
  "clientAction": "지역 치과는 진료별 FAQ·출처 구조 점검 권장",  // 마케터 액션 1줄
  "confidence": "high"   // high|medium (출처·해석 신뢰)
}
```
형식 강제: **출처 → 사실 → 한국 치과시장 함의/액션 → 신뢰도.** "AI검색이 바뀌고 있다" 류 보일러플레이트 금지.

### (B) 벤치마크 — 자체 측정 데이터 (방어가능 핵심)
운영자의 실제 인용 측정 런에서 뽑은 집계. 처음엔 수동 데이터 블록, 실측 패널 라이브(AD-13/14/15) 후 자동화 가능.
```json
{
  "kind": "benchmark",
  "label": "강남 임플란트 — ChatGPT 인용",
  "metric": "10곳 중 3곳 인용",
  "asOf": "2026-06",
  "note": "인용된 곳 공통점: 지역·진료 엔티티 명확 + 디렉터리 존재",
  "sampleNote": "소표본·단일질의 — 일반화 아님"   // 컴플라이언스: 과대일반화 금지
}
```

## 3. 저장 · 서빙 (인프라 0)

- 단일 파일: `public/data/fieldnotes.json` = `{ updatedAt, reviewedAt, notes: [...], benchmarks: [...] }`.
- 운영자가 파일 편집 → 커밋 → 배포. **크론·KV·LLM-in-request·서버 상태 없음.**
- 클라이언트가 정적 fetch. 요청 시점 외부호출·LLM 0 (원안 원칙 유지, 인프라만 증발).
- (선택) 로컬 헬퍼 `scripts/news-candidates.js`: 화이트리스트 RSS를 긁어 **후보를 콘솔에 출력만** → 운영자가 보고 골라 JSON에 수기 반영. 발행은 사람이. (자동발행 절대 아님)

## 4. UI (종속 · 진단 CTA로 회귀)

- **독립 `/news.html` 만들지 않음.** 홈/결과 흐름 안의 컴팩트 "AI검색 동향" 섹션.
- 필드노트 상위 3건 + 벤치마크 1~2개. 각 카드 출처배지·날짜.
- 섹션 하단 **CTA 1개**: "내 사이트 AI검색 인용 점검 →" (스코어링으로 복귀). 병렬 목적지 금지.
- 신선도: **"최근 검토: {reviewedAt}"** 표기. "매일 갱신" 류 카피 금지.
- **Stale-hide:** `reviewedAt`가 21일(주간 케이던스 여유) 초과로 오래되면 섹션 **통째 숨김**(부패한 "권위" 노출 방지). 무피드가 멈춘피드보다 낫다.
- 디자인 토큰: --plum/--teal #8052ff · --gold #ffb829 · Pretendard · 다크 (기존 일관).

## 5. 컴플라이언스 / 카피

- 우리가 쓴 summary·clientAction·benchmark note: 과장·최상급·과대일반화 금지(의료광고법·신뢰). 벤치마크엔 항상 "소표본·일반화 아님" 단서.
- "1위·최고·보장·완치" 등 LAW_HARD 0건(테스트 가드).
- 치과 비치헤드 카피 유지 — 전업종 리포지션 카피 변경 **안 함**.

## 6. 무엇을 안 짓나 (린에서 제외)

- 매일 크론 / `/api/news/refresh` / `/api/news` / KV 의존 / 크론 시크릿.
- LLM 자동요약·자동발행 / dedupe·롤링윈도 / sourceStatus.
- 독립 `/news.html` 페이지.
- 전업종 리포지션(구 P2)·엔진 업종 일반화(구 P3) — **별도 결정까지 보류**.

## 7. 파일

신규:
- `public/data/fieldnotes.json` — 콘텐츠 단일 출처(운영자 수기 편집).
- `public/news-section.js` (또는 기존 렌더에 통합) — 종속 섹션 렌더 + stale-hide.
- `scripts/news-candidates.js` (선택) — RSS 후보 출력 헬퍼(발행 아님).
- `lib/news/fieldnotes.js` — JSON 로드·검증·stale 판정 순수 함수.
- `test/fieldnotes.test.js` — 스키마 검증·stale-hide 경계·금칙어 가드.

수정:
- `public/index.html` (+ 해당 렌더) — "AI검색 동향" 종속 섹션 마운트 + 진단 CTA.

엔진/스코어/`auditUrl`/`/api/score`/`/api/compare`/실측 패널 **안 건드림**.

## 8. 테스트

`test/fieldnotes.test.js`:
- 스키마 검증: fieldnote·benchmark 필수필드, 잘못된 항목 드롭.
- stale 판정: reviewedAt 21일 경계 전/후 → 숨김 토글.
- 금칙어 가드: 모든 정적 카피 문자열에 LAW_HARD(최고·1위·완치·보장·100%·최상급) 0건 단언.

검증:
```bash
cd /c/Users/com/Downloads/dental-geo-score
NODE_OPTIONS=--use-system-ca node --test test/*.test.js
```
수동: JSON 편집 → 로컬 → 섹션 렌더 + CTA 동작 + reviewedAt 21일 넘기면 숨김 확인.

배포: `NODE_OPTIONS=--use-system-ca vercel --prod --yes`. **신규 env 없음**(KV·크론·요약키 불필요).

## 9. 보류 항목의 선행조건 (언젠가 재개 시)

- **전업종 리포지션:** 기존 도구로 비치과 2~3곳 수동 인용 데모 → 전환 신호 확인 후에만.
- **자동 갱신 피드:** 주간 수동본이 영업에서 실제로 읽히고 booked call/close에 기여한다는 증거 후에만.
- **벤치마크 자동화:** 실측 패널 라이브(AD-13/14/15 해결) 후.
