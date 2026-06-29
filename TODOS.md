# dental-geo-score — TODOS

_Last updated: 2026-06-29 (CEO Review SCOPE EXPANSION)_

---

## P0 — Cleared

- [x] `gpt-4o-search-preview` → `gpt-4o` Vercel 프로덕션 교체 (2026-06-29)

---

## Now (다음 영업 미팅 전)

- [x] **Commit uncommitted 378 lines** — code-reveal UI + businessType params (2026-06-29)
- [ ] **Export 리포트** — `public/operator.html` 인쇄 버튼 + `@media print` A4 CSS, compliance 스캔 (디자인 재검토 필요)

---

## Soon (7월 내)

- [x] **Path A 공개 이메일 게이트** — 라이브 (2026-06-29)
  - 이메일 입력 → `/api/citation` → `toPublicView()` 결과 (경쟁사 마스킹)
  - `DAILY_CITATION_CAP=20` 선 유지 (출시 후 KV per-IP 추가 검토)

---

## Later (8월 내)

- [ ] **재측정 이력 그래프** — `/api/score` 응답에 `prevScore` 추가
  - KV `c:domain` histAppend 재활용
  - operator.js 화면에 "지난 측정 대비 ±점수" 표시

---

## When Needed (거래처 5개+ 시)

- [ ] **거래처 배치 대시보드** — operator.html 탭 추가
  - localStorage URL 목록 저장
  - 배치 `/api/score` 호출 → 변화량 모아보기

---

## Engineering Constraints (항상 적용)

- 배포 전: `git diff | grep -iE "half1126|Gwwwwang94|medi2026poc|sk-[A-Za-z0-9]{8}|pplx-"` 스캔
- 의료광고법 제56조 LAW_HARD 0건 (최고·1위·유일·완치·보장·100%·최상급·명품)
- 경쟁사 비교 데이터 = operator-key 게이트 전용, 공개뷰 노출 금지
- `NODE_OPTIONS=--use-system-ca` (Avast MITM)
- Export 리포트 + Path A 신규 copy → `/clinic-ad-compliance` 스캔 필수
