// Colloquial region terms for the operator's region-edit autocomplete (datalist) — the way patients
// actually search ("강남", not "강남특별시 강남구"). Auto-detect fills the field from the clinic's
// address; this list only assists manual correction. Free text is always allowed, so this needn't be
// exhaustive — it covers Seoul's 25 자치구 + metro 자치구 + 경기/주요 시 where clinics cluster.
export const REGION_TERMS = [
  // 서울 25 자치구
  '강남', '강동', '강북', '강서', '관악', '광진', '구로', '금천', '노원', '도봉',
  '동대문', '동작', '마포', '서대문', '서초', '성동', '성북', '송파', '양천', '영등포',
  '용산', '은평', '종로', '중구', '중랑',
  // 서울 주요 역세권/생활권
  '강남역', '역삼', '선릉', '삼성', '잠실', '홍대', '신촌', '여의도', '목동', '노량진', '수유', '미아', '왕십리',
  // 경기 주요 시·생활권
  '수원', '성남', '분당', '판교', '용인', '수지', '고양', '일산', '안양', '평촌', '부천', '안산',
  '화성', '동탄', '남양주', '의정부', '광명', '시흥', '군포', '하남', '김포', '파주', '이천',
  // 인천
  '인천', '부평', '송도', '계양', '연수',
  // 광역시 자치구·생활권
  '부산', '해운대', '서면', '동래', '대구', '수성', '대전', '둔산', '유성', '광주', '울산',
  // 기타 시·도
  '세종', '천안', '청주', '전주', '창원', '김해', '포항', '제주',
];
