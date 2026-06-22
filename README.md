# 치과 GEO 인용 점수 (dental-geo-score)

치과 홈페이지 URL을 넣으면 **생성형 AI 검색(ChatGPT·Perplexity)이 인용하기 좋은 구조인지** 0~100 준비도 점수 + 근거 기반 개선안을 보여주는 웹앱. 메디앤메디 영업 리드젠 도구.

## Phase 1 (현재) — 무료 휴리스틱 점수
- 정적 프론트(`public/`) + Vercel 서버리스(`api/score.js`).
- **AI 키 불필요.** URL → 휴리스틱 7개 신호 → 0~100 결정론적 "준비도 점수".
- 실측 인용(ChatGPT/Perplexity)은 Phase 2 — 현재는 이메일 게이트 stub(`api/lead.js`).

## 아키텍처
```
public/                 정적 프론트(다크 프리미엄, 모바일 우선)
  index.html            URL 입력 → 준비도 미터·신호별 진단·개선안·실측 이메일 게이트
  methodology.html      공개 방법론 v0.1 (배점·근거·재현성)
api/
  score.js              POST {url} → 휴리스틱 점수 (SSRF-safe)
  lead.js               POST {email,url} → 실측 게이트 stub
lib/
  fetcher.js            ★ SSRF-하드닝 fetch (IP 검증·핀·리다이렉트 재검증·캡)
  ip-guard.js           내부/메타데이터/사설 IP 차단 (net.BlockList + v4-mapped 처리)
  robots.js             robots.txt 분석 (SPA fallback 오탐 가드)
  extract.js            cheerio 원시 HTML 파싱 (JSON-LD @graph·신호)
  scorer.js             7개 신호 → 0~100 + breakdown + fixes
  normalize.js          eTLD+1 (tldts/PSL) · 리다이렉트 언랩
  audit.js              fetch → robots → extract → score 파이프라인
```

## 보안 (출시 차단 요건)
`lib/fetcher.js`는 모든 사용자 제공 URL fetch를 통과시키는 **SSRF 게이트**:
scheme/port allowlist, DNS resolve된 **모든 IP 검증**(사설·loopback·169.254 메타데이터·v4-mapped 차단),
검증 IP로 **연결 핀(DNS 리바인딩 방어)**, 리다이렉트 **매 홉 재검증**, 타임아웃·바디 캡.
→ `test/ssrf.test.js`·`test/ip-guard.test.js`가 CI 게이트. **통과 전 배포 금지.**

## 개발
```bash
npm install                 # Avast MITM PC면: NODE_OPTIONS=--use-system-ca npm install
npm test                    # 32 tests: SSRF·golden-set·PSL·extract·robots
node scripts/score-cli.js https://haruplant.co.kr    # 로컬 PC면 NODE_OPTIONS=--use-system-ca 접두
npx vercel dev              # 로컬 서버 (api + 정적)
```
> 로컬 PC(이 환경)는 Avast HTTPS 검사로 외부 TLS가 MITM되어 `NODE_OPTIONS=--use-system-ca`가 필요. **Vercel 배포 환경은 영향 없음.**

## 배포
정적 + `/api` 단일 Vercel 프로젝트. `vercel --prod`.
Phase 2 env: `OPENAI_API_KEY`, `PERPLEXITY_API_KEY`(Sensitive), Upstash/KV(레이트리밋·캐시).

## 로드맵
- **Phase 1** ✅ 휴리스틱 점수 + 공개 페이지 + SSRF 게이트.
- **Phase 2** 실측 인용 패널(`api/citation` SSE, ChatGPT+Perplexity, `tool_choice:required`) + 이메일 게이트 + KV 비용 가드 + 내부 `/audit`.
- **Phase 3** 방법론 인덱스·배지(링크백)·운영자 배치·네이버 체크리스트.
