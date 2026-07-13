# Naver 플레이스 POC 설계 문서

_작성: 2026-06-30 | 상태: 설계 완료, 구현 대기_

---

## 1. 목적 및 범위

`lib/naver.js`는 현재 Naver Local API(openapi.naver.com)만 사용해 top-5 순위를 확인한다. 이것은 2026년 플레이스 알고리즘 전환 이후 **핵심 신호(자연유입 비율·상호작용·저장수)를 전혀 반영하지 못한다**.

POC 목표: place.naver.com 공개 데이터를 파싱해 현재 `lib/naver.js`가 보여주지 못하는 **플레이스 건강 지표**를 운영자에게 제공한다.

---

## 2. 2026 Naver 플레이스 알고리즘 — 측정 가능성 지도

| 신호 | 2026 중요도 | 공개 여부 | 파싱 가능 | 비고 |
|---|---|---|---|---|
| 자연유입 비율 | ★★★ | ❌ Private | ❌ | Search Advisor 전용 |
| 전화클릭·길찾기·예약 전환 | ★★★ | ❌ Private | ❌ | Smart Place 전용 |
| AI 브리핑 인용 여부 | ★★ | ❌ | ❌ | Naver 내부 AI |
| **저장수 (하트)** | ★★ | ✅ 공개 | ✅ | place.naver.com 노출 |
| **방문자 리뷰 수** | ★★ | ✅ 공개 | ✅ | |
| **블로그 리뷰 수** | ★ | ✅ 공개 | ✅ | |
| **별점 평균** | ★ | ✅ 공개 | ✅ | |
| **사진 수** | ★ | ✅ 공개 | ✅ | 활성도 신호 |
| **사장님 글 최근 여부** | ★★ | ✅ 공개 | ✅ | 매장 활성도 |
| **NAP 완성도** (명칭·주소·전화) | ★ | ✅ 공개 | ✅ | |
| Local API rank (top-5) | ★ (proxy) | ✅ | ✅ | 이미 구현됨 |
| PLACE_CHECKLIST 8항목 | ★ (수동) | — | ✅ (수동) | 이미 구현됨 |

**파싱 가능한 공개 지표 7종** → 이것이 POC 범위.

---

## 3. ToS 리스크 분석

### Naver 크롤링 정책 (2026-06-30 기준)

- Naver 공식 robots.txt: place.naver.com 검색 결과 페이지는 Disallow 없음
- 단, 과도한 요청(automated bulk scraping)은 ToS 17조 "서비스 방해" 위반 소지
- place.naver.com은 JS 렌더링 없이 SSR HTML 일부를 제공하나, SPA 구조 증가로 파싱 안정성 불확실

### 리스크 등급

| 리스크 | 등급 | 완화책 |
|---|---|---|
| Naver 요청 차단/IP 밴 | 중 | operator-key 게이트 + 최소 호출(영업 미팅용만) + 캐시 TTL 60분 |
| HTML 구조 변경으로 파서 깨짐 | 높음 | fallback graceful(빈 결과 반환, 에러 노출 안 함) + 별도 모니터링 |
| 데이터 정확도 불일치 | 중 | UI에 "실시간 아님, 파싱 기준 시점 표시" 명시 |
| 경쟁사 데이터 노출 | 낮음 | operator-key 게이트 → 공개뷰 노출 완전 차단 |

**결론**: 소량·운영자 전용 사용은 허용 범위 내로 판단. 배치/자동화 호출 금지.

---

## 4. 구현 옵션

### 옵션 A: `api/naver-place.js` — 자동 파싱 (operator-gated)

```
POST /api/naver-place
  Cookie: HttpOnly operator session
  { clinicName, region, procedure }

→ 쿼리: "{region} {procedure} 치과"
→ place.naver.com 검색 결과 HTML 파싱
→ 반환:
  {
    target: { placeId, rank, saves, visitorReviews, blogReviews, rating, photos, hasOwnerPost, nap },
    competitors: [ ...동일 구조 × 상위 N개 ],
    parsedAt: ISO timestamp,
    warning: "파싱 기준 시점 데이터, 실시간 아님"
  }
```

**구현 포인트:**
- `lib/fetcher.js`의 `safeFetch` + SSRF 가드 재사용
- User-Agent: 일반 브라우저 헤더 (Googlebot 아님)
- 캐시: in-memory TTL 60분 (KV 불필요, 운영자 전용 low-volume)
- 파싱 실패 시: `{ error: "parse_failed", target: null }` — UI가 graceful 처리
- `vercel.json`에 `maxDuration: 20` (HTML fetch + 파싱 여유)

**게이트 이유:**
1. Naver 데이터는 경쟁사 실명·순위 포함 → 의료광고법 공개뷰 금지
2. 파싱 실패/변동으로 인한 오해 방지 (운영자만 한계 인지)
3. 호출 빈도 통제 (IP 차단 방지)

### 옵션 B: `api/naver-manual.js` — 수동 입력 보강

```
PUT /api/naver-manual
  Cookie: HttpOnly operator session
  { clinicDomain, period: "2026-06", data: { naturalVisitRate, callClicks, directionClicks, reservations } }

GET /api/naver-manual?domain=example.com
→ 최근 3개월 Smart Place 통계 트렌드
```

**용도**: 사장님 계정에서만 볼 수 있는 Private 지표(자연유입 비율·전화클릭 등)를 운영자가 수동으로 입력해 KV에 저장. 히스토리 그래프(후속 Later 태스크)와 연동.

**저장소**: `kv.get/set` — 키 `nm:domain:YYYY-MM`

### 권장: A + B 하이브리드

- A: 자동으로 공개 지표 파싱 (저장수·리뷰·별점·사진·사장님 글)
- B: 운영자가 분기마다 수동 입력 (자연유입 비율·전화클릭 등 Private 지표)
- 운영자 화면: 두 소스를 통합한 "플레이스 건강 카드"

---

## 5. operator.html UI 설계

### 화면 배치

```
기존: [URL 입력] → [AI 인용 실측] → [경쟁사 비교]
추가:              → [플레이스 건강] (새 탭 또는 섹션)
```

**플레이스 건강 카드 구성 (renderNaverPlace 함수):**

```
┌─────────────────────────────────────────────────┐
│ 📍 플레이스 건강 점수  [내 치과 vs 경쟁 상위]    │
│                                                 │
│ 공개 지표 (자동)          수동 지표 (입력 필요)  │
│ ─────────────────         ────────────────────  │
│ 저장수: 247              자연유입: 미입력        │
│ 방문자리뷰: 1,423         전화클릭: 미입력        │
│ 블로그리뷰: 89            길찾기: 미입력          │
│ 별점: 4.8 (n=1,423)       예약전환: 미입력        │
│ 사진: 134장                                      │
│ 사장님 글: 최근 3일 전    [Smart Place 데이터 입력] │
│                                                 │
│ 파싱 기준: 2026-06-30 14:23 KST                 │
│ ⚠️ 본 수치는 공개 파싱 데이터로 Smart Place      │
│    실제 통계와 다를 수 있습니다.                  │
└─────────────────────────────────────────────────┘
```

**트리거:** `renderNaverPlace()` — 기존 AI 인용 결과 로드 후 operator.js에서 별도 호출 (병렬 가능, 실패해도 메인 결과 영향 없음)

---

## 6. 파일 변경 계획

### 신규 파일

| 파일 | 역할 | 의존성 |
|---|---|---|
| `lib/naver-place.js` | place.naver.com HTML 파싱 순수 함수 | `lib/fetcher.js` |
| `api/naver-place.js` | operator-gated API 엔드포인트 | `lib/naver-place.js`, `lib/cache.js` |
| `api/naver-manual.js` | PUT/GET 수동 지표 KV | `lib/kv.js` |

### 기존 파일 변경

| 파일 | 변경 내용 |
|---|---|
| `public/operator.js` | `loadNaverPlace()` 함수 추가, `renderNaverPlace()` 렌더러 |
| `public/operator.html` | `#naverPlaceSection` 섹션 추가, 수동 입력 폼 |
| `public/style.css` | `.naver-place-card`, `.naver-grid`, `.naver-manual-form` 스타일 |

### 기존 파일 변경 없음

- `lib/naver.js` (Local API rank — 독립 유지)
- `api/citation.js` (Public/Private split 건드리지 않음)
- `public/app.js` (공개뷰 — Naver 데이터 노출 금지)

---

## 7. 테스트 전략

### 단위 테스트 (`test/naver-place.test.js`)

```js
// 파서 격리 테스트 (실제 네트워크 없음)
✓ place.naver.com HTML fixture에서 저장수 추출
✓ 리뷰 수 파싱 (방문자 / 블로그 구분)
✓ 별점 + 리뷰 수 파싱
✓ 사장님 글 최근 여부 판별 (날짜 파싱)
✓ NAP 완성도 추출 (명칭·주소·전화)
✓ HTML 구조 변경 시 graceful null 반환
✓ SSRF 가드: 내부 IP → 거부
✓ operator-key 없음 → 401
✓ TTL 60분 캐시 hit/miss
```

### 수동 테스트 (구현 후)

1. 로컬에서 `operator.html` → URL 입력 → AI 실측 완료 후 "플레이스 건강" 카드 로드 확인
2. 파싱 실패 시뮬레이션 (빈 fixture) → 카드가 "데이터 없음" graceful 표시
3. 수동 입력 폼 → PUT 저장 → GET 재조회 일치

### 회귀: 기존 201 테스트 그린 유지

---

## 8. 컴플라이언스 체크

- `renderNaverPlace()` 내 경쟁사 실명·순위: **운영자뷰 전용, `toPublicView()` 경로 없음**
- UI 카드 내 금지 표현 스캔 필수 (`/clinic-ad-compliance` 실행)
- "1위 치과" 식 자기우월 단정 문구 사용 금지 (Local API rank 표시 시 "N위 도달" 형식)
- 파싱 시점 명시 의무 ("파싱 기준: YYYY-MM-DD HH:MM KST")

---

## 9. 구현 우선순위 및 일정

| 단계 | 내용 | 조건 |
|---|---|---|
| Step 1 | `lib/naver-place.js` 파서 + 단위 테스트 | HTML fixture 확보 후 |
| Step 2 | `api/naver-place.js` 엔드포인트 + 캐시 | Step 1 완료 |
| Step 3 | `operator.js/html` UI 통합 | Step 2 완료 |
| Step 4 | `api/naver-manual.js` (옵션 B) | Step 3 이후 필요 시 |

**전제 조건**: place.naver.com HTML 구조를 DevTools로 확인해 selector 확정 → 그 시점에 구현 시작.

---

## 10. 미구현 결정 사항 (Out of Scope)

- Naver 로그인 자동화 / Smart Place API 직접 호출 → ToS 위반
- 실시간 스트리밍 업데이트 → 운영자 수동 새로고침으로 충분
- 공개뷰(`app.js`) Naver 데이터 노출 → 절대 금지
- Naver Search Advisor 크롤링 → Private 페이지, 불가
