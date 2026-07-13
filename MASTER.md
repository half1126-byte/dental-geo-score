# dental-geo-score — 서비스 마스터 문서

> 정본. 이 파일 하나로 서비스 정의·아키텍처·기능·전략·로드맵·운영 규칙 전체를 파악할 수 있어야 한다.
> 최종 갱신: 2026-07-13

---

## 1. 서비스 정의

### 한 줄 정의
> **"치과 홈페이지의 페이지 위생을 점검하고, 고정 질의 패널에서 병원명 언급과 공식 홈페이지 출처 인용을 반복 측정하는 도구"**

### 위치와 역할
- **라이브 URL**: dental-geo-score.vercel.app
- **실제 역할**: 메디앤메디 **영업 리드젠 웨지(Lead-gen Wedge)**
- **진짜 상품**: GEO칼럼 서비스(세팅비 + 월 운영비, 3개월 사이클)
- **트리거**: 현재 상태를 기준선으로 확인 → 승인된 개선안 상담

### 전환 퍼널
```
URL 입력
  → /api/score (휴리스틱 위생 점수, 무료·즉시)
  → 페이지 위생 결과 (AI 인용 예측 아님)
  → 이메일 게이트 (Path A 공개용)
  → /api/citation (실측: ChatGPT·Perplexity에 실제 질문)
  → 진단서 (업체명 언급·출처 인용·측정 불가를 구분 + 페이지 위생 breakdown)
  → 예약콜 CTA
```

---

## 2. 아키텍처

### 스택
- **호스팅**: Vercel Serverless (Node.js runtime)
- **저장소**: Upstash KV (캐시·히스토리·rate-limit 카운터). 없으면 in-memory fallback.
- **AI 엔진**: OpenAI(gpt-4o), Perplexity API — 키 없으면 202 pending 반환
- **프론트**: 정적 HTML+JS (`public/`), 빌드 없음

### 디렉토리 구조
```
dental-geo-score/
├── api/
│   ├── score.js          # POST/GET — 휴리스틱 점수 (무료, SSRF-safe)
│   ├── citation.js       # POST — 실측 인용 패널 (이메일·operator 게이트)
│   ├── page-source.js    # POST — 원문 HTML 파싱 (operator 전용)
│   └── ...
├── lib/
│   ├── audit.js          # auditUrl() — URL 페치 + 신호 추출 + 점수 계산
│   ├── scorer.js         # 7신호 → 0-100 점수 + breakdown
│   ├── citation.js       # runCitationPanel() — 엔진 병렬 실행
│   ├── engines.js        # AUTO_ENGINES 목록 + 엔진별 프롬프트
│   ├── normalize.js      # registrableDomain, isKnownPlatformDomain
│   ├── naver.js          # Naver Local API top-5 rank check
│   ├── redact.js         # toPublicView / toPrivateReport (경쟁사 마스킹)
│   ├── fetcher.js        # safeFetch — SSRF 가드 (내부IP·localhost 차단)
│   ├── checklists.js     # PLACE_CHECKLIST 8항목 (수동)
│   ├── store.js          # makeStore() — KV 캐시·히스토리·rate-limit
│   └── kv.js             # Upstash KV 어댑터
├── public/
│   ├── index.html        # 공개 랜딩 (URL 입력 → 점수 → 이메일 게이트)
│   ├── app.js            # 공개 Path A 클라이언트
│   ├── operator.html     # 운영자 전용 대시보드
│   ├── operator.js       # 운영자 클라이언트 (full report + compare)
│   └── style.css
└── test/
    ├── normalize.test.js
    ├── citation-api.test.js
    ├── score-api.test.js
    └── ...  (총 201 tests green, 2026-06-30)
```

### 데이터 흐름
```
클라이언트
  │
  ├─ POST /api/score { url }
  │    → lib/fetcher.js (SSRF 가드)
  │    → lib/audit.js (HTML 파싱 + 신호 추출)
  │    → lib/scorer.js (7신호 → 점수)
  │    → KV histAppend(`s:domain`)
  │    → 200 { score, band, breakdown, signals }
  │
  └─ POST /api/citation { url, email?, region?, regions?, procedure? }
       → 이메일 검증 (공개) 또는 HttpOnly 세션 검증 (운영자)
       → isKnownPlatformDomain 가드
       → KV cache check (24h)
       → enforceRateCaps (PER_IP_DAILY_CAP, DAILY_CITATION_CAP)
       → lib/citation.js runCitationPanel() — 엔진별 병렬
       → lib/naver.js checkNaverLocal() (NAVER 키 있을 때)
       → KV cacheSet + histAppend(`c:domain`)
       → toPublicView (공개) 또는 toPrivateReport (운영자)
       → 200 { perEngine, overallCited, competitors?, naverLocal? }
```

---

## 3. 핵심 기능 (라이브, 2026-06-30)

| 기능 | 파일 | 비고 |
|---|---|---|
| 페이지 크롤·콘텐츠 위생 점수 (0-100) | `lib/scorer.js` | 7신호, SSRF-safe, 인용 예측 아님 |
| 실측 인용 패널 (ChatGPT·Perplexity) | `lib/citation.js` | 24h KV 캐시 |
| 공개 이메일 게이트 (Path A) | `public/app.js` | 이메일 필수, toPublicView |
| 운영자 전용 풀리포트 | `public/operator.js` | HttpOnly 8시간 세션 |
| 인용 출처 구조 비교 패널 | `public/operator.js:loadCompare` | 운영자 전용, 공개뷰 노출 금지 |
| 다지역 비교 (`regions[]`) | `api/citation.js` | 최대 5지역 병렬 |
| 플랫폼 URL 가드 | `lib/normalize.js:isKnownPlatformDomain` | place.naver.com 등 차단 |
| Naver Local API rank check | `lib/naver.js` | top-5, sort=comment |
| 히스토리 append | `lib/store.js` | `s:domain`, `c:domain` KV |
| per-IP + 일일 글로벌 cap | `api/citation.js:enforceRateCaps` | 429/202 |
| 의료법 경쟁사 마스킹 | `lib/redact.js:toPublicView` | 공개뷰 경쟁사 실명 차단 |

---

## 4. API 명세

### `POST /api/score`
```
Request:  { url: string }
Response: { score: 0-100, band: 'low'|'mid'|'high', breakdown: [...], signals: {...}, measuredAt }
Error:    400 missing-url | 400 platform-url | 422 fetch-blocked | 500 internal
```
- 무료, 인증 없음, SSRF-safe
- 결과를 KV `s:domain`에 히스토리 append

### `POST /api/citation`
```
Request:  { url, email?, region?, regions?: string[], procedure?, queries?: string[], queryIndexes?: number[], clinicName?, businessType? }
Auth:     HttpOnly operator session (브라우저) | x-operator-key (서버 간 자동화만)

Response (공개): toPublicView — 경쟁사 실명 마스킹
Response (운영자): toPrivateReport — 경쟁사 실명·증거 URL 포함

Status:   200 ok | 202 pending (키 없음) | 202 cap-reached | 400 email-required
          400 missing-url | 400 platform-url | 429 rate-limited | 500 internal
```
- `regions[]` 5개까지: 지역별 패널 병렬 → `{ byRegion: { 강남: panel, ... } }`
- `queries[]` 3개까지: 커스텀 쿼리로 캐시 키 분리
- REPEATS=3 (Wilson CI 안정화, 노이즈 감소)

---

## 5. 핵심 lib 모듈 요약

### `lib/scorer.js` — 7신호 점수
| 신호 | 가중치 | 측정 방법 |
|---|---|---|
| crawl | 15 | robots.txt + TLS + 접근성 |
| schema | 20 | JSON-LD Dentist @type |
| eeat | 20 | 의사 프로필·자격·경력 |
| fresh | 10 | 날짜 신호·최신성 |
| answer | 15 | FAQ·질문형 h2·테이블 |
| extract | 10 | 인용성 문장(통계·출처) |
| local | 10 | NAP 일관성 (전화·주소·JSON-LD) |

### `lib/normalize.js` — URL 정규화
- `registrableDomain()`: PSL(tldts) 기반, `.co.kr` 다중 TLD 처리
- `isKnownPlatformDomain()`: 공유 플랫폼 차단
  ```
  naver.com, kakao.com, daum.net, instagram.com, facebook.com,
  youtube.com, tiktok.com, twitter.com, tistory.com, modoo.at,
  imweb.me, wix.com, notion.site ...
  ```
- `unwrapRedirect()`: Vertex AI / Bing 리디렉터 언래핑

### `lib/naver.js` — Naver Local API
- 쿼리: `"{region} {procedure} 치과"` → `openapi.naver.com/v1/search/local.json`
- display=5, sort=comment
- 반환: `{ cited, rank, items: [{rank, name, link, matched}] }`
- **한계**: 실제 SERP 순서 재현 불가, 상업 키워드 AI 브리핑 트리거 안 함

### `lib/redact.js` — 의료광고법 컴플라이언스 경계
- `toPublicView(data)`: 경쟁사 이름·URL 마스킹, 순위 제거
- `toPrivateReport(data, url)`: 풀 데이터, 운영자만 접근

### `lib/store.js` — KV 추상화
- `cacheGet/cacheSet(key, value, ttlMs)`
- `histAppend(key, record)` — 히스토리 배열 append
- `incrDaily(dayKey)` — 일일 글로벌 캡 카운터
- `incrIpDaily(ipHash, dayKey)` — per-IP 카운터

---

## 6. 보안 & 컴플라이언스 (절대 규칙)

### 시크릿 관리
```
절대 커밋 금지:
  OPERATOR_KEY
  OPERATOR_SESSION_SECRET
  ADVANCED_GATE_PASSWORD
  모든 API provider key/token
  .fixclean_* 파일      (라이브 API 키 포함, gitignored)

배포 전 필수 스캔:
  npm run check:secrets
```

### 의료광고법 제56조 LAW_HARD (0건 유지)
금지 표현: `최고` `1위` `유일` `완치` `보장` `보증` `100%` `무통` `최상급` `명품`
- 생성된 카피 전체에 0건
- 경쟁사 비교 = 운영자 게이트 전용, 공개뷰 절대 노출 금지
- 효과 주장 금지: "인용률 N% 상승" 등 불가

### 로컬 개발
```bash
NODE_OPTIONS=--use-system-ca  # Avast HTTPS MITM 우회
```

### 운영자 인증 흐름
```
POST /api/unlock에서 ADVANCED_GATE_PASSWORD 서버 검증
  → 서명된 8시간 HttpOnly·SameSite=Strict 쿠키 발급
  → isOperatorRequest = true → toPrivateReport (비공개 원문 포함)
  → 세션 없음 → email 게이트 → toPublicView (마스킹)
  → x-operator-key는 서버 간 자동화 호환용; 브라우저 저장·URL 공유 금지
```

---

## 7. 2026 네이버 알고리즘 — 핵심 발견

### 연관검색어 폐지 (2026-04-30)
- 19년 역사 종료 → AI 브리핑 + 관련질문으로 대체
- **블연플(블로그+연관검색어+플레이스) 전략의 '연' 축 소멸**
- 전략 재편: **블 + AI브리핑 + 플**
- 검색 패턴 변화: 문장형 2×↑, 의문문 3×↑, 요청형 5×↑

### 플레이스 알고리즘 2026 전환
| 구 기준 | 신 기준 (2026) |
|---|---|
| 리뷰 수 / 별점 | **자연유입 비율** (키워드 검색량 대비 클릭 비율) |
| 블로그 포스팅 연동 수 | **실제 상호작용** (저장·전화클릭·길찾기·예약) |
| 단순 정보 완성도 | **매장 활성도** (사장님 답글·새소식 포스팅 빈도) |

→ "얼마나 많이"가 아니라 "얼마나 자연스럽게"가 핵심.

### 블로그 알고리즘 (C-Rank + DIA+, 변동 없음)
- **C-Rank**: 카테고리당 50+ 포스팅, 주 3-5회 일관성 → 채널 전문성 점수
- **DIA+**: 직접 촬영 사진 + 본인 경험담 (AI 복붙 탐지·차감)
- 발행 후 **24-48시간 초기 반응**(공감·댓글·저장)이 순위 결정
- AI 브리핑 소스 인용 = GEO 최적화 목표

### 치과·의료 특이사항 — dental-geo-score에 중요
- GPTBot·OAI-SearchBot·PerplexityBot·ClaudeBot **네이버 전체 차단**
- → 네이버 콘텐츠가 ChatGPT·Perplexity에 보이지 않음
- "강남 치과 추천" 등 상업질의 → AI 브리핑 **비트리거** (의료 YMYL 보수적)
- ∴ **네이버 최적화 ≠ 외부 AI 인용 최적화** — 완전히 별도 트랙

---

## 8. 측정 갭 분석 (Naver)

| 항목 | 2026 중요도 | 현재 앱 |
|---|---|---|
| 플레이스 자연유입 비율 | ★★★ Critical | ❌ 공개 API 없음 |
| 상호작용 (저장·전화·길찾기) | ★★★ Critical | ❌ API 없음, 체크리스트만 |
| AI 브리핑 인용 여부 | ★★ High | ❌ API 없음, 수동 확인만 |
| Search Advisor (클릭·노출) | ★★ High | ❌ API 없음 |
| place.naver.com 공개 데이터 (저장수·리뷰수·별점) | ★★ Medium | ❌ 미구현 (POC 예정) |
| Local API rank (top-5) | ★ Low (proxy) | ✅ `lib/naver.js` |
| PLACE_CHECKLIST 8항목 | ★ Low (수동) | ✅ `lib/checklists.js` |

**제약**: Smart Place 상호작용·Search Advisor·AI 브리핑 출처는 공개 API 없음. 스크래핑은 ToS 위반.

**측정 가능한 공개 데이터** (place.naver.com 파싱):
- 저장 수, 방문자 리뷰 수, 블로그 리뷰 수, 별점 평균, 사진 수
- NAP (영업시간·전화·주소 완성도)
- 최근 사장님 글 여부 (활성도 신호)

---

## 9. 검증 결과 — 휴리스틱 vs 실측 (2026-06)

`docs/validation/heuristic-vs-citation-2026-06.md` 주요 발견:

| 발견 | 결과 |
|---|---|
| 점수-인용 상관관계 | **역상관** — 최고점(63) 병원이 미인용, 저점 병원이 인용 |
| 측정 불가율 | 인용된 사이트의 40%가 TLS/cert 차단으로 점수 측정 불가 |
| 점수 안정성 | 동일 사이트 재측정: 15↔45 불안정 |
| 인용 사례에서 함께 관찰된 요소 | 멀티 디렉토리 등재 + 전문의 entity 명시(제한 표본의 동시 관찰이며 인과 미확정) |

**시사점**: 휴리스틱 점수는 "페이지 위생" 지표일 뿐, AI 인용 예측력 없음.
실측 인용 패널(`/api/citation`)이 세일즈 핵심 증거.

---

## 10. 전체 로드맵

| 단계 | 내용 | 상태 |
|---|---|---|
| Phase 1 | 페이지 위생 점검 + SSRF 가드 | ✅ 완료 |
| Phase A | 실측 인용 패널 + 이메일 게이트 + 운영자 모드 | ✅ 구현 |
| **Naver POC** | 플레이스 조회(`api/naver-place.js`) + 수동 입력(`api/naver-manual.js`) | ✅ 운영자 기능 구현 |
| 재측정 이력 그래프 | `prevScore` API + 히스토리 차트 | ✅ 구현 |
| Export 리포트 | 인쇄 버튼 + `@media print` A4 CSS | ✅ 구현 |
| /api/compare | 출처 도메인 구조 diff (스키마·메타·신호 필드 단위) | ✅ 구현 |
| 배치 대시보드 | localStorage URL 목록 + batch `/api/score` | ✅ 구현 |

현재 회귀 테스트: **277개 통과** (2026-07-13).

### Naver POC 설계 (다음 단계)
```
POST /api/naver-place { clinicName, region, procedure }  (operator-gated)
  → "{region} {procedure} 치과" 검색
  → place.naver.com HTML 파싱
  → { rank, saves, reviewCount, blogReviews, rating, hasOwnerPost, nap }
  → 운영자 화면: 내 치과 vs 경쟁사 상위 N곳 카드

PUT /api/naver-manual { domain, stats }  (operator-gated)
  → 거래처 Smart Place 통계 수동 입력 (90일 export)
  → KV 저장 → 트렌드 표시
```

---

## 11. 현재 태스크 현황 (TODOS)

### Now
- [ ] **Export 리포트** — `public/operator.html` 인쇄 버튼 + `@media print` A4 CSS + compliance 스캔

### Soon (7월 내)
- [x] Path A 공개 이메일 게이트 — 라이브 ✅

### Later (8월 내)
- [ ] **재측정 이력 그래프** — `prevScore` API + KV `c:domain` 히스토리 활용

### When Needed (거래처 5개+)
- [ ] **거래처 배치 대시보드** — localStorage URL 목록 + batch `/api/score`

---

## 12. 운영 커맨드

```bash
# 로컬 개발
cd c:/Users/com/Downloads/dental-geo-score
NODE_OPTIONS=--use-system-ca npx vercel dev

# 테스트 전체 실행
NODE_OPTIONS=--use-system-ca node --test test/*.test.js

# 배포 전 시크릿 스캔
npm run check:secrets

# 프로덕션 배포
NODE_OPTIONS=--use-system-ca npx vercel --prod

# 라이브 확인
# https://dental-geo-score.vercel.app
# 운영자: /operator.html 비밀번호 로그인 → HttpOnly 세션
```

---

## 13. 파일별 빠른 참조

| 찾는 것 | 파일 |
|---|---|
| 점수 계산 로직 | `lib/scorer.js` |
| 신호 추출 (HTML 파싱) | `lib/audit.js`, `lib/extract.js` |
| 실측 엔진 프롬프트 | `lib/engines.js` |
| 경쟁사 마스킹 | `lib/redact.js` |
| 플랫폼 URL 차단 | `lib/normalize.js:isKnownPlatformDomain` |
| 네이버 검색 순위 | `lib/naver.js` |
| 수동 체크리스트 | `lib/checklists.js` |
| KV 캐시·히스토리 | `lib/store.js` |
| SSRF 가드 | `lib/fetcher.js` |
| 비용 추정 | `api/citation.js:buildCostNote` |
| rate limit | `api/citation.js:enforceRateCaps` |
| 테스트 | `test/*.test.js` (201 green) |
| 검증 연구 | `docs/validation/heuristic-vs-citation-2026-06.md` |
| 네이버 알고리즘 | `docs/engines/naver.md` |
| 측정 갭 | `docs/measurement/naver-search-advisor.md` |
