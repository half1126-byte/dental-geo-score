# Path A — 전환 기계 (Conversion Machine) 빌드 플랜

작성일: 2026-06-28
브랜치: realmeasurement-live
출처: /plan-ceo-review (사업 확장 전략) → Path A 확정

## 0. 전략 맥락 (CEO 리뷰 결론)

dental-geo-score는 **제품이 아니라 대행사(메디앤메디)의 영업 무기(리드젠 웨지)**. 진짜 상품 = "GEO칼럼"(세팅비+월 운영비, 3개월 사이클).
**10배 = 넓은 툴이 아니라 계측된 전환 깔때기.** 치과 비치헤드 안에서 깊게.

확장 경로 3안 중 **Path A(전환 기계)** 확정. Path B(T2 자동 트리거)=다음 사이클, Path C(인접 업종)=A/B 증명 후 단 1개·수동검증.

## 1. 잠긴 결정 (CEO 게이트)

| # | 결정 | 값 |
|---|---|---|
| 게이트 위치 | 실측 데모 | **맛보기(싼 1콜) 앞 → 풀패널+진단서 뒤(이메일 게이트)** |
| 진단서 | 생성 | 반자동 (`샘플_신환정체진단서.html` 자동채움) |
| 예약 | 콜 스텝 | 외부 캘린더 링크(최저마찰) |
| 질의 | 지역·진료 | 자동감지+확인 (기존 재사용) |

## 2. ⚠️ 스코프 정정 — 블로커는 대부분 이미 구현됨

redesign-realmeasurement-first.md VERDICT("라이브 키 전 AD-12/13/14 필수")는 **stale**. 현 코드 검증 결과:

| 항목 | redesign 상태 | **실제 코드 상태** |
|---|---|---|
| AD-12 유출경계 | pending | ✅ `lib/redact.js` 완료·테스트됨 (공개경로 `toPublicView`) |
| AD-14 비용가드 | pending | ✅ `enforceRateCaps` = per-IP(`PER_IP_DAILY_CAP`)·글로벌(`DAILY_CITATION_CAP`)·24h 캐시·KV store |
| AD-13 비동기·예산 | pending | ✅ `Promise.allSettled` 병렬·`repeats:1`·`vercel.json` citation=120s (충돌 해소) |
| 이메일게이트→패널 | — | ✅ `public/app.js:209` 배선 존재 |
| AD-15 presence | pending | ❌ `lib/presence.js` 미구현 (단 무료 CLOSE=휴리스틱 `topFixes`로 커버) |

→ **"블로커 신축"이 아니라 "검증 + 스위치 + 깔때기 완성".** 다 지어진 가드를 재계획하지 말 것.

## 3. 빌드 시퀀스 (정정된 스코프)

### A-1 — 검증 + 라이브 플립 (작음)
목표: 실측 패널을 공개 깔때기에서 안전하게 켤 수 있음을 **증명하고** 스위치를 켠다.
1. **회귀 검증:** 유출가드 테스트(공개 payload에 경쟁도메인·matchedUrls·sampledCitedDomains 0) + 비용가드 테스트(캡·클램프) 그린 확인. (이미 존재 — 실행만)
2. **미세 보강(결정 필요):**
   - per-email 일캡(`PER_EMAIL_DAILY_CAP`) — 현재 per-IP·글로벌만. 이메일 악용 방지.
   - 달러 예산캡(`DAILY_CITATION_BUDGET`) — 현재 건수캡(`DAILY_CITATION_CAP`). 건수→달러는 리파인(콜수×단가 추정).
   - 둘 다 **있으면 좋음, A-1 차단요인 아님**(건수캡으로 출발 가능).
3. **운영 플립(사용자 액션):** Vercel env `CITATION_ENABLED=true` + 엔진키(OPENAI/PERPLEXITY) + `DAILY_CITATION_CAP`·`PER_IP_DAILY_CAP` 보수적 값. **단계적:** 먼저 operator-key 경로로 실측 1건 확인 → 그다음 공개 이메일게이트 개방.

### A-2 — 깔때기 완성 (진짜 신규)
목표: URL → 충격 → 이메일 → 진단서 → 예약콜.
1. **맛보기(게이트 앞):** 무료점수 직후, **싼 1콜**(단일 엔진 1쿼리 or 캐시된 예시)로 "AI에 물으니 경쟁사 인용 ✓ / 당신 0" 한 줄 충격. 비용가드: 맛보기는 별도 저캡(`PER_IP_TASTE_CAP`) + 우선 캐시. **공개 경로라 경쟁사 실명 금지**(AD-7) — "상위 N곳 중 k곳 등재, 귀원 미등재" 익명 집계만.
2. **이메일 게이트:** 맛보기 충격 → "전체 엔진 실측 + 신환 정체 진단서 받기" 이메일 폼(기존 leadForm 재사용).
3. **풀 패널(게이트 뒤):** 이메일 후 `/api/citation` 풀 실행(3엔진×3쿼리). 사설 경로라 `toPrivateReport`(실명 가능, noindex 사설).
4. **진단서:** `샘플_신환정체진단서.html` 템플릿에 측정값 자동채움(반자동). `clinic-ad-compliance` 게이트 통과.
5. **예약 CTA:** 외부 캘린더 링크.

### A-3 — 계측 (전환 기계의 핵심)
목표: 깔때기 단계별 추적 — "기계"는 측정 없으면 기계 아님.
1. 퍼널 이벤트(KV): `url_analyzed → taste_shown → email_captured → panel_run → diagnosis_sent → call_booked`.
2. 운영자 미니 대시보드: "이번 주 URL N · 맛보기 M · 이메일 K · 콜 J · 계약 L".
3. `api/lead.js`(존재) + KV 카운터 재사용.

### (보강) AD-15 presence.js — 차단요인 아님
디렉터리 존재(naver/goodoc/doctornow)는 CLOSE 강화. 무료 CLOSE는 휴리스틱 `topFixes`(이미 결정론)로 충분. presence는 오너 정해지면 별도.

## 4. 컴플라이언스 / 보안 (관통)

- **공개 경로 경쟁사 실명 0** (AD-7). 맛보기·공개뷰는 익명 집계만. 실명 비교는 이메일+noindex 사설 진단서.
- 모든 카피·진단서 `clinic-ad-compliance` 게이트 (LAW_HARD 0).
- 비용: 공개 풀패널은 **이메일 후에만** 실행(자격된 리드 = 비용가드 + 퀄리피케이션). 맛보기는 저캡.
- PII: 이메일 해시/마스킹 로그(AD-18), 집계값만.

## 5. NOT in scope

- Path B(T2 자동 트리거)·Path C(인접 업종) — A 증명 후.
- 매일 뉴스 자동피드·전업종 리포지션 — 반려됨(린 필드노트로 대체).
- AD-13 N>5 비동기(202+이메일 전달) — 단일클리닉 9콜은 120s 동기로 충분. 헤비 멀티리전 시에만.
- presence.js — 보강(휴리스틱 topFixes로 무료 CLOSE 커버).

## 6. 검증

```bash
cd /c/Users/com/Downloads/dental-geo-score
NODE_OPTIONS=--use-system-ca node --test   # 유출가드·비용가드·redact·citation 그린
```
A-1 플립 후 수동: operator-key로 실측 1건 → 공개 이메일게이트 맛보기→풀패널→진단서→예약 1회 통과 + 공개뷰 경쟁사 실명 0 확인.

## 7. 다음 단계

A-1은 비용·라이브 API 지출·공개 경로 컴플라이언스가 걸려 **엔지니어링 리뷰 권장**(이미 구현된 가드의 검증 + 맛보기 저캡 설계 + 플립 절차). 그 후 A-2 구현.
