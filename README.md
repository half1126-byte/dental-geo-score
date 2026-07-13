# dental-geo-score

치과 홈페이지 URL을 넣으면 **AI 검색 답변이 그 홈페이지를 출처로 인용하는지** 실제 API 패널로 측정하고, 페이지 크롤·콘텐츠 위생을 별도로 점검하는 웹앱. 출처 인용은 긍정적 추천과 동일하지 않다.

**라이브**: https://dental-geo-score.vercel.app

---

## 현재 기능 (2026-07)

| 기능 | 경로 | 접근 |
|---|---|---|
| 휴리스틱 위생 점수 (0-100) | `POST /api/score` | 공개 |
| 실측 인용 패널 (ChatGPT·Perplexity) | `POST /api/citation` | 이메일 게이트 / operator |
| 인용 출처 도메인 구조 비교 + 개선 계획표 | `POST /api/compare` | operator 전용 |
| 재측정 히스토리 + 점수 스파클라인 | `GET /api/history` | operator 전용 |
| 네이버 플레이스 공개 데이터 조회 | `POST /api/naver-place` | operator 전용 |
| 수동 Smart Place 통계 입력/조회 | `PUT/GET /api/naver-manual` | operator 전용 |

브라우저 Operator 기능은 서버에서 발급한 8시간 HttpOnly 세션 쿠키를 사용한다. `x-operator-key`는 서버 간 자동화 호환용이며 브라우저에 전달하거나 저장하지 않는다.

---

## 아키텍처

```
dental-geo-score/
├── api/                          Vercel 서버리스 엔드포인트
│   ├── score.js                  POST {url} → 휴리스틱 점수 (공개)
│   ├── citation.js               POST → 실측 AI 인용 (이메일·operator 게이트)
│   ├── compare.js                POST → 인용 출처 구조 비교 (operator)
│   ├── history.js                GET  → 재측정 이력 (operator)
│   ├── naver-place.js            POST → 네이버 GraphQL 플레이스 조회 (operator)
│   ├── naver-manual.js           PUT/GET → 수동 Smart Place 통계 (operator)
│   ├── page-source.js            POST → 원문 HTML 분해 (operator)
│   ├── lead.js                   POST → 이메일 게이트
│   ├── engines.js                GET  → 엔진 config·체크리스트
│   ├── auth-check.js             POST → HttpOnly operator 세션 검증
│   ├── unlock.js                 POST → 비밀번호 검증 + 세션 쿠키 발급
│   └── logout.js                 POST → 세션 쿠키 만료
│
├── lib/                          서버 공유 라이브러리
│   ├── fetcher.js                ★ SSRF 게이트 (내부 IP·localhost·메타데이터 전부 차단)
│   ├── ip-guard.js               사설·loopback·v4-mapped IP 차단 (net.BlockList)
│   ├── extract.js                cheerio HTML 파싱 (JSON-LD·메타·신호·teardown)
│   ├── scorer.js                 7신호 → 0-100 + breakdown + fixes
│   ├── compare.js                순수 함수 diff 빌더 (신호·스키마·메타·개선표)
│   ├── citation.js               실측 인용 패널 (ChatGPT·Perplexity 병렬)
│   ├── engines.js                AI 엔진 config + 인용 추출 + 프롬프트
│   ├── naver-place.js            Naver 플레이스 GraphQL client
│   ├── naver.js                  Naver Local API top-5 rank check
│   ├── robots.js                 robots.txt 분석 (SPA fallback 오탐 가드)
│   ├── normalize.js              eTLD+1 · isKnownPlatformDomain
│   ├── audit.js                  auditUrl() 파이프라인 (fetch→robots→extract→score)
│   ├── store.js                  Upstash KV 어댑터 (캐시·히스토리·rate-limit)
│   ├── kv.js                     KV 저수준 어댑터
│   ├── redact.js                 toPublicView() — 경쟁사 실명 마스킹
│   ├── operator-auth.js          서명 세션·쿠키·서버 헤더 인증
│   └── checklists.js             PLACE_CHECKLIST (수동 8항목)
│
├── public/                       정적 프론트 (빌드 없음)
│   ├── index.html                공개 랜딩 (URL 입력 → 점수 → 이메일 게이트)
│   ├── app.js                    공개 Path A 클라이언트
│   ├── operator.html             운영자 대시보드
│   ├── operator.js               운영자 클라이언트 (full report · compare · Naver)
│   ├── methodology.html          공개 방법론 문서
│   └── style.css                 다크 테마 (--plum #8052ff, --gold #ffb829)
│
├── test/                         Node.js 내장 test runner (277 tests)
│   ├── ssrf.test.js              SSRF 차단 케이스
│   ├── extract.test.js           HTML 파싱·JSON-LD
│   ├── compare.test.js           diff 빌더 + LAW_HARD 컴플라이언스 가드
│   ├── citation-api.test.js      실측 인용 케이스
│   ├── naver-place.test.js       GraphQL 클라이언트
│   └── ...                       총 24개 파일
│
├── docs/
│   ├── naver-poc-plan.md         Naver POC 설계 문서
│   └── engines/                  엔진별 조사 문서
│
├── MASTER.md                     서비스 정본 (전략·아키텍처·로드맵 통합)
├── TODOS.md                      개발 체크리스트
└── vercel.json                   Vercel 함수 설정 (citation maxDuration=120)
```

---

## 보안 제약 (절대 변경 금지)

### SSRF 게이트
`lib/fetcher.js`가 모든 사용자 제공 URL을 통과시킨다.
- scheme/port allowlist (`http`/`https`, 80/443만)
- DNS resolve → **모든 IP 검증** (사설·loopback·169.254 메타데이터·v4-mapped IPv6 전부 차단)
- 검증된 IP로 **연결 핀** (DNS 리바인딩 방어)
- 리다이렉트 **매 홉 재검증**
- 타임아웃·바디 캡 (`maxBytes: 1_500_000`)

`test/ssrf.test.js`·`test/ip-guard.test.js`가 CI 게이트. **통과 전 배포 금지.**

### Operator 게이트
`POST /api/unlock`이 `ADVANCED_GATE_PASSWORD`를 서버에서 검증하고 8시간 HttpOnly·SameSite=Strict 세션을 발급한다. 브라우저 JavaScript와 URL에는 비밀번호·운영자 키가 남지 않는다. 서버 간 자동화만 `x-operator-key`를 사용할 수 있다. 비공개 원문·비교 데이터는 이 게이트 뒤에서만 노출한다.

시크릿이 공개 HTML이나 Git 이력에 한 번이라도 들어갔다면 파일에서 지우는 것만으로는 복구되지 않는다. 배포 환경의 관련 비밀번호·키·세션 서명값을 모두 회전하고 재배포한 뒤, 저장소 공개 범위에 따라 Git 이력 정리 여부를 결정한다.

### 의료광고법 §56 (LAW_HARD)
`최고·1위·유일·완치·보장·100%·최상급·명품` 금지.
`test/compare.test.js`의 컴플라이언스 가드가 정적 카피 스캔으로 결정론적 체크.

---

## 로컬 개발

```bash
# 의존성 설치
npm install
# ⚠️ Avast HTTPS 검사 PC: NODE_OPTIONS=--use-system-ca npm install

# 테스트 (256 tests)
npm test
# ⚠️ Avast PC: NODE_OPTIONS=--use-system-ca npm test

# 로컬 서버 (api/ + public/ 동시)
npm run dev
# → http://localhost:3000

# 단일 URL 점수 확인 (CLI)
node scripts/score-cli.js https://example-dental.co.kr
# ⚠️ Avast PC: NODE_OPTIONS=--use-system-ca node scripts/score-cli.js ...
```

> **Avast HTTPS 검사** (이 개발 PC 한정): 외부 TLS를 MITM해서 Node.js fetch가 실패함.
> `NODE_OPTIONS=--use-system-ca`를 붙이면 Avast CA를 신뢰해서 해결됨.
> **Vercel 프로덕션 환경에는 영향 없음.**

---

## 배포

```bash
vercel --prod
# Avast PC: NODE_OPTIONS=--use-system-ca vercel --prod
```

---

## 환경변수

```
# Vercel 프로젝트 설정에서 관리 (로컬은 .env.local)

ADVANCED_GATE_PASSWORD 운영자 로그인 비밀번호 (서버 전용)
OPERATOR_KEY           세션 서명 fallback + 서버 간 자동화 키 (서버 전용)
OPERATOR_SESSION_SECRET 세션 전용 서명 키 (권장, 서버 전용)
OPENAI_API_KEY        ChatGPT 실측 인용 (없으면 /api/citation 202 반환)
PERPLEXITY_API_KEY    Perplexity 실측 인용 (없으면 해당 엔진 skip)
KV_REST_API_URL       Upstash KV URL (없으면 in-memory fallback)
KV_REST_API_TOKEN     Upstash KV 토큰
```

---

## 데이터 흐름 요약

```
공개 사용자
  POST /api/score {url}
    → lib/fetcher.js  (SSRF 검증)
    → lib/audit.js    (robots + HTML 파싱 + 신호 추출)
    → lib/scorer.js   (7신호 → 0-100 + breakdown)
    ← { score, band, breakdown, signals, compareProfile }

이메일 게이트 통과 후
  POST /api/citation {url, email}
    → lib/citation.js (ChatGPT·Perplexity 병렬 실측)
    → lib/redact.js   (toPublicView — 경쟁사 마스킹)
    ← { perEngine[], cited, competitors[] (마스킹됨) }

Operator (HttpOnly session)
  POST /api/compare {userUrl, compUrl, userProfile?}
    → buildProfile() ×2  (safeFetch + extract + score)
    → lib/compare.js      (signalDiff, schemaDiff, planRows, ...)
    ← { signalDiff, schemaDiff, metaDiff, planRows, recommendedProductIds, ... }
```

---

## 테스트

```bash
npm test                              # 전체 256 tests
node --test test/compare.test.js     # 비교 로직만
node --test test/ssrf.test.js        # SSRF 게이트만
```

테스트 파일은 `test/` 디렉터리, Node.js 내장 `node:test` 사용 (Jest 불필요).
