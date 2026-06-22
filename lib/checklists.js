// Readiness checklists for the engines we CANNOT auto-measure (Gemini=ToS-blocked, Naver=no API).
// Operator/clinic scores these manually. Items derived from docs/engines/ (verified 2026-06-22).

export const GBP_CHECKLIST = {
  engine: 'gemini',
  title: 'Google 비즈니스 프로필(GBP) 준비도 — Gemini · AI Overviews 로컬',
  note: 'Gemini 로컬 추천은 GBP/지도/지식그래프 기반. 자동 인용 측정은 Gemini API 약관상 금지 → 체크리스트로.',
  items: [
    { id: 'gbp-verified', label: 'GBP 소유 등록 + 검증 완료(신뢰 게이트)', weight: 'high' },
    { id: 'gbp-nap', label: '정확한 NAP(상호·주소·전화)가 홈페이지와 100% 일치', weight: 'high' },
    { id: 'gbp-category', label: '1차 카테고리 = 치과/세부 전문 (관련성 게이트 #1)', weight: 'high' },
    { id: 'gbp-services', label: '서비스·속성(진료과목) 채움', weight: 'medium' },
    { id: 'gbp-hours', label: '정규 + 특별/공휴 영업시간 최신', weight: 'medium' },
    { id: 'gbp-photos', label: '사진 업로드', weight: 'medium' },
    { id: 'gbp-website', label: 'GBP 웹사이트 URL = 공식 사이트', weight: 'medium' },
    { id: 'gbp-reviews', label: 'Google 리뷰 양+평점 존재·증가, 원장 응답', weight: 'high' },
    { id: 'gbp-geocode', label: '지도 핀/주소 지오코딩 정확(근접 계산 포함)', weight: 'medium' },
    { id: 'gbp-nap-web', label: '웹 디렉토리 전반 NAP 일관(엔티티 판별)', weight: 'medium' },
    { id: 'gbp-schema', label: 'Organization/Dentist JSON-LD on site (지식그래프 지원 — 구글 직접 랭킹요소는 아닌 추정)', weight: 'low' },
  ],
  tooltip: 'KR 가용성은 2026-02-27 국토부 1:5,000 지도 반출 조건부 승인 후 개선(점진). 한국은 Maps 그라운딩 제한지역 아님.',
};

export const PLACE_CHECKLIST = {
  engine: 'naver',
  title: '네이버 플레이스 준비도 (가중은 실무 추정 — 네이버 공식 스펙 미공개)',
  note: '고의도 치과 "추천/비교" 질의에 AI 브리핑 커버리지는 얇음(의료 YMYL 보수·상업질의 비트리거 보도). 플레이스+블로그+지도 스택이 진짜 추천 엔진.',
  items: [
    { id: 'place-relevance', label: '적합도: 상호(intent 매치)·카테고리=치과·대표키워드·정확 주소', weight: 'high' },
    { id: 'place-complete', label: '플레이스 필드 완성(운영시간·전화·진료과목·사진) — 홈피와 일치', weight: 'high' },
    { id: 'place-popularity', label: '인기도: 자연 방문자리뷰·네이버예약·저장·길찾기/전화 (검색량 비례 자연속도)', weight: 'high' },
    { id: 'place-trust', label: '신뢰도: 트래픽/리뷰 구매 없음(스파이크 억제·delisting 위험)', weight: 'high' },
    { id: 'place-blog', label: '경험 기반 블로그/카페 후기로 C-rank↑(미편집 AI 텍스트 금지)', weight: 'high' },
    { id: 'place-eeat', label: '엔티티/E-E-A-T: 전문의 자격·수련·논문 + LocalBusiness/FAQPage/Article JSON-LD', weight: 'medium' },
    { id: 'place-aeo', label: 'AEO 구조: 소제목 2~7·리스트·answer-first 20~30 Q&A', weight: 'medium' },
    { id: 'place-jisikin', label: '지식인에 흔한 치과 질문 권위 답변 등장', weight: 'low' },
  ],
  tooltip: '외부 AI 크롤러 차단으로 네이버 내부 콘텐츠는 ChatGPT/Perplexity/Claude에 안 보임 — 별도 스코어카드. 모든 카피 의료광고법(제56조) 준수.',
};

export const CHECKLISTS = [GBP_CHECKLIST, PLACE_CHECKLIST];
