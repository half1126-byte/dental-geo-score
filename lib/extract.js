// Page signal extraction from RAW HTML via cheerio.
// POC finding: WebFetch/markdown strips <script>, so JSON-LD must be read from raw HTML here.
import * as cheerio from 'cheerio';
import { getDomain } from 'tldts';
import { detectProcedures } from './dental-procedures.js';

const CRED_RE = /전문의|치의학박사|박사|원장|면허|교수|DDS|DMD|레지던트|수련의/g;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
// ── 한국 주소 파싱 ────────────────────────────────────────────────────────────
// 시·도는 정식/약식 표기를 사전으로 고정한다. 접미사를 옵션 그룹(?:광역시|특별시)? 으로
// 붙이면 '부산광역'·'서울특별' 같은 존재하지 않는 지역명이 만들어져 유료 실측 쿼리로 샌다.
const SIDO_MAP = {
  '서울특별시': '서울', '서울시': '서울', '서울': '서울',
  '부산광역시': '부산', '부산시': '부산', '부산': '부산',
  '대구광역시': '대구', '대구시': '대구', '대구': '대구',
  '인천광역시': '인천', '인천시': '인천', '인천': '인천',
  '광주광역시': '광주', '광주시': '광주', '광주': '광주',
  '대전광역시': '대전', '대전시': '대전', '대전': '대전',
  '울산광역시': '울산', '울산시': '울산', '울산': '울산',
  '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
  '경기도': '경기', '경기': '경기',
  '강원특별자치도': '강원', '강원도': '강원', '강원': '강원',
  '충청북도': '충북', '충북': '충북',
  '충청남도': '충남', '충남': '충남',
  '전북특별자치도': '전북', '전라북도': '전북', '전북': '전북',
  '전라남도': '전남', '전남': '전남',
  '경상북도': '경북', '경북': '경북',
  '경상남도': '경남', '경남': '경남',
  '제주특별자치도': '제주', '제주도': '제주', '제주': '제주',
};
// 긴 표기 우선 정렬 — '서울특별시'가 '서울'보다 먼저 시도돼야 부분매칭이 생기지 않는다.
const SIDO_ALT = Object.keys(SIDO_MAP).sort((a, b) => b.length - a.length).join('|');
const GUGUN = '[가-힣]{1,6}(?:시|군|구)';            // 성남시 / 분당구 / 옹진군
const ROAD = '[가-힣A-Za-z0-9]{1,10}(?:로|길|동|가)'; // 테헤란로 / 한누리대로 / 역삼동 / 을지로2가
// 주소 존재 판정: 시도 + (시군구 0~2) + 도로명/동 + 번지.
// 표준 3토큰("서울 강남구 테헤란로 123")을 반드시 통과시키되 "평일 10시-19시"·전화번호는 배제.
const ADDR_RE = new RegExp(`(?:${SIDO_ALT})(?:\\s*${GUGUN}){0,2}\\s*${ROAD}\\s*\\d`);
// GEO 인용 근거 신호 — KDD 2024(arXiv:2311.09735) 실측 상위 3기법(출처 명시·인용구·통계).
// 통계 = 비교·비율·규모를 나타내는 수치만. 가격(원)·순번(번)·날짜(년/월/일)·수량(개)·
// 금액 단위(만/억/천)는 "1번 출구", "2024년 8월 5일", "1,200,000원"을 통계로 오인시키므로 제외.
const STAT_RE = /\d[\d,]*(?:\.\d+)?\s*(?:%p|%|퍼센트포인트|퍼센트|배|명|건|례)|\d[\d,]*(?:\.\d+)?\s*(?:mm|cm|mg|ml)(?![A-Za-z])/g;
// 환자 후기·리뷰 위젯: 의료법 제56조(치료경험담) 리스크 영역이므로 인용 근거로 가점하지 않는다.
// class/id 판정은 앞쪽 경계를 둔다 — 'preview'가 'review'를 부분문자열로 포함해 정상 본문이
// 통째로 배제되는 것을 막기 위함('reviewList' 같은 camelCase는 계속 잡힌다).
const REVIEW_ATTR_RE = /(?:^|[^a-zA-Z])(?:review|testimonial)|후기|리뷰/i;
// cite 텍스트가 '환자 이름'인지 판정. '환자'·'고객' 단독어는 '환자안전위원회' 같은 정식 출처를
// 오배제하므로 쓰지 않는다.
const REVIEW_CITE_RE = /(?:님|씨)\s*$|후기|리뷰|환자\s*(?:이야기|사례|경험)|고객\s*(?:의\s*)?소리|내원\s*경험|보호자|어머님|아버님/;
const REVIEW_HEADING_RE = /후기|리뷰|치료\s*경험|환자\s*이야기|고객\s*의?\s*소리/;
// 출처 섹션 라벨(제목 전체 일치) — 국내 표기 변형 포함.
const SOURCE_LABEL_RE = /^(참고\s*문헌|참고\s*자료|참고|출처|자료\s*출처|인용\s*문헌|인용\s*자료|references?|reference\s*list|bibliography|sources?|citations?)\s*[:：]?$/i;
// 본문 인라인 출처 표기 — '출처:' '출처 —' '참고자료' '자료출처' '인용:' 등.
const SOURCE_INLINE_RE = /참고\s*문헌|참고\s*자료|자료\s*출처|출처\s*[:：\-–—]|인용\s*[:：]|\bReferences?\s*[:：]|\bBibliography\b|\bSources?\s*[:：]/i;
// 외부 링크 중 '출처'로 볼 수 없는 호스트(SNS·CDN·지도·단축URL·플랫폼).
const NON_SOURCE_HOST_RE = /(^|\.)(instagram\.com|facebook\.com|fb\.com|youtube\.com|youtube-nocookie\.com|youtu\.be|twitter\.com|x\.com|tiktok\.com|threads\.net|linkedin\.com|pinterest\.com|band\.us|naver\.com|naver\.me|kakao\.com|kakaocdn\.net|daum\.net|tistory\.com|brunch\.co\.kr|blogspot\.com|wordpress\.com|jsdelivr\.net|cloudflare\.com|googleapis\.com|gstatic\.com|google\.com|goo\.gl|bit\.ly|w3\.org|schema\.org|wa\.me|t\.me)$/i;
// 1급 출처(학술·공공·학회) — 외부에서 검증 가능하고 논문의 Cite Sources에 가장 가깝다.
const AUTHORITY_HOST_RE = /(^|\.)(go\.kr|ac\.kr|edu|gov|arxiv\.org|doi\.org|nih\.gov|who\.int|nature\.com|sciencedirect\.com|springer\.com|springeropen\.com|wiley\.com|jamanetwork\.com|bmj\.com|thelancet\.com|nejm\.org|cochrane\.org|koreamed\.org|kci\.go\.kr|riss\.kr|dbpia\.co\.kr|medric\.or\.kr|kda\.or\.kr|nhis\.or\.kr|hira\.or\.kr|health\.kr|wikipedia\.org|wikidata\.org)$/i;
// 본문(prose) 영역 링크만 출처 후보로 본다 — nav/footer 제휴 링크 오탐 차단.
const SOURCE_LINK_SEL = ['p', 'li', 'td', 'dd', 'blockquote', 'cite', 'figcaption', '.references', '.refs', '.reference', '.citation', '.footnotes']
  .map((s) => `${s} a[href]`)
  .join(', ');
const SAMEAS_AUTHORITY_RE = /wikidata\.org|wikipedia\.org|namu\.wiki|naver\.me|health\.kr|nhis\.or\.kr|kda\.or\.kr/i;
// Fuller address capture (for auto-detect): 시도 + 시군구 1~2 [+ 도로명/동], 또는
// 시군구가 없는 세종·제주형(시도 + 도로명 + 번지). 시도 단독으로는 절대 매칭되지 않는다.
const ADDR_FULL_RE = new RegExp(
  `(?:${SIDO_ALT})(?:(?:\\s*${GUGUN}){1,2}(?:\\s*${ROAD})?|\\s*${ROAD}\\s*\\d)`
);
// 시도 토큰(엄격): 앞뒤가 한글로 이어지면 매칭하지 않음 → '서울시립'·'제주도민' 오탐 차단.
const SIDO_RE = new RegExp(`(?:^|[^가-힣])(${SIDO_ALT})(?![가-힣])`);
// 주소 앞머리의 시도를 떼기 위한 앵커 버전(공백 없는 "서울강남구..."도 처리).
const SIDO_LEAD_RE = new RegExp(`^\\s*(${SIDO_ALT})`);
const GU_ALL_RE = /[가-힣]{1,5}(?:시|군|구)(?![가-힣])/g;
const DONG_RE = /([가-힣]{1,5}(?:동|읍|면))(?![가-힣])/;
const SIDO_SUFFIX_RE = /(특별자치시|특별자치도|특별시|광역시)$/;
// 질문형 H2 판별 — 의문 종결어미 기반. '차이·주의·준비·기간'은 평범한 명사라
// 평서형 제목("임플란트 후 주의사항", "진료 기간 안내")을 오검출해 제외한다.
// 한글은 완성 음절로 저장되므로 '-ㄴ가'(다른가·필요한가)를 낱자로 쓸 수 없다
// → 종성이 ㄴ인 음절 399자를 코드포인트로 생성해 문자 클래스로 쓴다.
const N_FINAL_SYLLABLES = (() => {
  let out = '';
  for (let cp = 0xac00; cp <= 0xd7a3; cp += 1) if ((cp - 0xac00) % 28 === 4) out += String.fromCharCode(cp);
  return out;
})();
// 문말 앵커: 끝의 괄호 주석("… (6)")과 공백·구두점만 허용 → "무엇이든 상담 가능합니다" 류 오탐 차단
const Q_TAIL = '(?:\\s*[(\\[（][^)\\]）]{0,12}[)\\]）])?[\\s.!·…"\'”’)\\]]*$';
const Q_ENDING = [
  `(?!단가|원가|정가|편지)[${N_FINAL_SYLLABLES}][가지]`, // ~ㄴ가/~ㄴ지: 다른가, 필요한가, 있는가, 무엇인지
  '나요|가요|까요|니까',                                  // 되나요, 인가요, 할까요, 합니까
  // 얻나, 되나 같은 의문형 종결. 앞 음절 블록리스트로 오탐을 막는다:
  //  - 부사/조사: 하나·언제나·누구나·얼마나·그러나·시간이 지나
  //  - 사람 이름: 미나·세나·유나·예나·소나·리나·다나 (의료진 소개 H2 "대표원장 김미나"가 실제로 걸렸음)
  // 잔존 한계: 위 목록 밖 음절로 끝나는 이름(예: 윤나)은 여전히 오탐될 수 있다.
  '(?<![하제구무마러이거지미세유예소리다])나',
  '얼마나?|무엇|어디|언제',                                // 문말 의문사
].join('|');
// '왜'는 어두/공백 뒤 + 뒤에 공백·물음표·문말만 인정 → '왜곡·왜냐하면' 오탐 차단
const QUESTION_RE = new RegExp(
  `[?？]|어떻게(?!든)|(?:^|[\\s(“'"])왜(?=[\\s?？]|$)|(?:${Q_ENDING})${Q_TAIL}`
);
const DENTAL_SCHEMA = /^(Dentist|MedicalClinic|MedicalBusiness|LocalBusiness|MedicalOrganization)$/i;
// v0.4: FAQPage를 제외했다. hasFaq로 이미 따로 세는데 여기에도 있어서 FAQPage 하나가
// schema 점수를 두 번(hasFaq + hasTrust) 받았다. TRUST는 '작성 주체가 명시됐는가'만 본다.
const TRUST_SCHEMA = /^(Person|Organization|MedicalWebPage|Article|BreadcrumbList|WebSite)$/i;
const BOOKING_RE = /예약|문의|상담|reservation|booking|appointment|contact|consult/i;

export function extractSignals(html) {
  const $ = cheerio.load(html);
  $('script:not([type="application/ld+json"]), style, noscript').remove();
  const bodyText = ($('body').text() || $.root().text() || '').replace(/\s+/g, ' ').trim();
  const visibleLen = bodyText.length;

  // JS-shell / SPA detection → needsHeadless (route to Puppeteer fallback later)
  const rootShell = ['#root', '#app', '#__next', '#__nuxt'].some(
    (sel) => $(sel).length > 0 && $(sel).text().trim().length < 80
  );
  const needsHeadless = visibleLen < 500 || (rootShell && visibleLen < 1200);

  const reload = cheerio.load(html); // fresh (we removed scripts above)
  const jsonld = extractJsonLd(reload);

  const h1 = reload('h1').map((_, e) => reload(e).text().trim()).get().filter(Boolean);
  const h2 = reload('h2').map((_, e) => reload(e).text().trim()).get().filter(Boolean);

  const dateSignals =
    reload('meta[property="article:published_time"], meta[property="article:modified_time"], meta[itemprop="datePublished"], meta[itemprop="dateModified"], time[datetime]').length +
    (jsonld.hasDate ? 1 : 0);

  const credentials = (bodyText.match(CRED_RE) || []).length;
  const social = reload(
    'a[href*="instagram.com"], a[href*="youtube.com"], a[href*="youtu.be"], a[href*="facebook.com"], a[href*="blog.naver.com"], a[href*="pf.kakao.com"]'
  ).length;

  const phone = PHONE_RE.test(bodyText) || jsonld.hasTelephone;
  const address = ADDR_RE.test(bodyText) || jsonld.hasAddress;

  const questionH2 = h2.filter((t) => QUESTION_RE.test(t)).length;
  const tables = reload('table').length;
  const faqBlocks = reload('details, dl, [itemtype*="FAQPage"], .faq, .qna').length;
  const firstChunk = bodyText.slice(0, 240);
  const answerFirst = /\b(은|는|이|가|란)\b/.test(firstChunk) && firstChunk.length > 80;

  const scripts = (html.match(/<script\b/gi) || []).length;
  const sn = html.length ? +(visibleLen / html.length).toFixed(3) : 0;

  // Page <head> meta — read from a non-stripped instance (reload keeps <head> intact).
  const metaContent = (sel) => (reload(sel).first().attr('content') || '').replace(/\s+/g, ' ').trim();
  const title = (reload('title').first().text() || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const metaDescription = metaContent('meta[name="description" i]').slice(0, 400);
  const canonical = (reload('link[rel="canonical" i]').first().attr('href') || '').trim().slice(0, 400);
  const ogTitle = metaContent('meta[property="og:title" i]').slice(0, 300);
  const ogDescription = metaContent('meta[property="og:description" i]').slice(0, 400);
  const ogImage = metaContent('meta[property="og:image" i]').slice(0, 500);
  const viewport = metaContent('meta[name="viewport" i]').slice(0, 200);
  const robotsMeta = metaContent('meta[name="robots" i]').slice(0, 200);

  // Metadata signals — informational only, no scorer.js score impact (100pt cap preserved).
  const hasMapEmbed = /(maps\.google\.|google\.com\/maps|place_id=)/i.test(html);

  // ── 비급여 진료비 안내 (v0.4 신설 채점 신호) ──────────────────────────────────
  // 근거 ①: What Gets Cited (arXiv:2605.25517) — 25.2만회 통제 실험에서 '가격 미기재'가
  //         6개 모델 전원 일치로 확인된 인용 게이트키퍼 4요인 중 하나.
  // 근거 ②: 의료법상 비급여 진료비용 고지 의무. 즉 이 항목은 AI 노출과 법적 의무가 겹친다.
  // v0.3까지의 판정(`/임플란트.*비용|.../`)은 평탄화된 본문 전체에 `.*`를 걸어
  // "임플란트"와 "비용"이 페이지 어디에든 따로 있으면 참이 되는 사실상 상시 통과였다.
  // → 진료 항목과 금액이 '같은 줄에서 가까이' 나오는지, 표/고지 문구가 있는지로 바꾼다.
  const PRICE_ITEM_RE = /임플란트|교정|크라운|보철|충치|신경치료|스케일링|잇몸|치아미백|라미네이트|사랑니|틀니|브릿지|인레이/;
  // 금액: 4자리 이상 또는 만/천 단위. 전화번호(02-123-4567)·번지·연도 오탐을 막기 위해
  //       숫자 앞에 하이픈이 붙지 않고, 뒤에 '원'이 오는 경우만 인정한다.
  const PRICE_AMOUNT_RE = /(?<![-\d])\d{1,3}(?:,\d{3})+\s*원|(?<![-\d])\d+\s*(?:만|천만|억)\s*원/;
  // 블록 요소별 텍스트 = '같은 줄' 단위. bodyText는 전체가 한 줄로 평탄화돼 근접성 판정에 못 쓴다.
  const priceBlocks = reload('p, li, td, th, dd, dt, h2, h3, h4, div')
    .map((_, e) => reload(e).children().length ? '' : reload(e).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter((t) => t && t.length < 300);
  const priceLines = priceBlocks.filter((ln) => PRICE_ITEM_RE.test(ln) && PRICE_AMOUNT_RE.test(ln));
  // 비급여 진료비용 고지(법정) 문구
  const hasNonCoveredNotice = /비급여\s*(진료비|진료 비용|항목|안내|고지)|진료비용\s*안내|가격표|수가표/.test(bodyText);
  // 표 안에 진료 항목과 금액이 함께 있는가 (가장 강한 신호)
  let hasPriceTable = false;
  reload('table').each((_, el) => {
    const t = reload(el).text().replace(/\s+/g, ' ');
    if (PRICE_ITEM_RE.test(t) && PRICE_AMOUNT_RE.test(t)) hasPriceTable = true;
  });
  const priceItemCount = priceLines.length;
  // 3-band: 0 없음 / 1 일부(항목 1~2개 또는 고지 문구만) / 2 충분(표 또는 항목 3개 이상)
  const priceBand = hasPriceTable || priceItemCount >= 3 ? 2 : (priceItemCount >= 1 || hasNonCoveredNotice) ? 1 : 0;
  const hasPriceInfo = priceBand > 0;

  // GEO content citability signals — KDD 2024 (arXiv:2311.09735)가 실측한 상위 3개 기법.
  // 논문 실측치: 상위 3개 기법(출처 명시·인용구 추가·통계 추가)이 가시성 지표 기준 30~40% 개선.
  // 출처 명시는 검색 5위권 사이트에서 +115.1%(반대로 1위 사이트는 -30.3%).
  // ※ 기법별 +41%/+33%/+27% 같은 세부 수치는 논문에 없음 — 인용 금지.
  // 후기·리뷰 블록 판정: 의료법 제56조(치료경험담) 영역은 인용 근거 신호에서 통째로 제외한다.
  const isReviewish = (el) => {
    const $el = reload(el);
    const inReviewBox = [el, ...$el.parents().toArray()].some((n) => {
      const a = `${(n.attribs && n.attribs.class) || ''} ${(n.attribs && n.attribs.id) || ''}`;
      return a.trim() !== '' && REVIEW_ATTR_RE.test(a);
    });
    if (inReviewBox) return true;
    const tag = (el.tagName || el.name || '').toLowerCase();
    const citeText = (tag === 'cite' ? $el.text() : $el.find('cite').first().text()) || $el.attr('cite') || '';
    if (citeText.trim() && REVIEW_CITE_RE.test(citeText.replace(/\s+/g, ' ').trim())) return true;
    const prevHead =
      $el.prevAll('h1,h2,h3,h4,h5,h6').first().text() ||
      $el.parent().prevAll('h1,h2,h3,h4,h5,h6').first().text() || '';
    return REVIEW_HEADING_RE.test(prevHead);
  };

  const bodyPara = reload('p, li, td')
    .filter((_, e) => !isReviewish(e))
    .map((_, e) => reload(e).text())
    .get()
    .join(' ');
  // 동일 수치의 단순 반복(배너·네비 중복)이 통계로 부풀지 않도록 고유 매치로 센다.
  const _statMatches = [...new Set((bodyPara.match(STAT_RE) || []).map((m) => m.replace(/\s+/g, '')))].length;
  const hasStatistics = _statMatches >= 2;

  // statCount: 3-band (0 / 1-2 / 3+) to reduce false-positive scoring from ad/price noise
  const statCount = _statMatches === 0 ? 0 : _statMatches <= 2 ? 1 : 2;

  // sectionProfile: ratio of h2-delimited sections whose char count falls in 250–900 band.
  // Returns null when no h2 headings exist (SPA shell, no structure) — scorer treats null as neutral.
  let sectionProfile = null;
  {
    const h2Els = reload('h2');
    if (h2Els.length > 0) {
      const sections = [];
      h2Els.each((_, el) => {
        let text = '';
        let node = reload(el).next();
        // collect text until the next h2 or end
        while (node.length && !node.is('h2')) {
          text += node.text();
          node = node.next();
        }
        sections.push(text.replace(/\s+/g, ' ').trim().length);
      });
      const inBand = sections.filter((len) => len >= 250 && len <= 900).length;
      sectionProfile = sections.length > 0 ? +(inBand / sections.length).toFixed(2) : null;
    }
  }

  // 인용구: 후기 위젯 blockquote는 제외하고, 곡선(“”)·낫표(「」)에 더해 한글 키보드 기본인
  // 직선 따옴표(")도 인정한다. 따옴표 매칭은 후기 블록을 제거한 본문에서만 한다.
  const proseQuoteText = reload('p, li, td, dd, blockquote, figcaption, h2, h3')
    .filter((_, e) => !isReviewish(e))
    .map((_, e) => reload(e).text())
    .get()
    .join(' \n ')
    .replace(/[ \t]+/g, ' ');
  const realBlockquotes = reload('blockquote').filter((_, e) => !isReviewish(e)).length;
  const hasQuotations =
    realBlockquotes > 0 ||
    (proseQuoteText.match(/“[^”\n]{20,300}”|「[^」\n]{20,300}」|"[^"\n]{20,300}"/g) || []).length >= 1;

  // 출처: 본문 영역의 외부 도메인 하이퍼링크를 1급 신호로 본다(외부 검증 가능).
  // 호스트가 아니라 등록가능도메인(eTLD+1)으로 집계한다 — canonical이 없는 페이지에서
  // 자사 www./m. 서브도메인이 '외부 출처 2개'로 오인되는 것을 막기 위함.
  const selfHost = hostOf(canonical) || hostOf(metaContent('meta[property="og:url" i]')) ||
    hostOf(reload('base[href]').first().attr('href') || '');
  const selfDomain = selfHost ? getDomain(selfHost) || selfHost : '';
  const sourceHosts = new Set();
  let authorityLinks = 0;
  reload(SOURCE_LINK_SEL).each((_, a) => {
    const $a = reload(a);
    if ($a.closest('nav, footer, header, aside').length > 0) return;
    if (isReviewish(a)) return;
    const host = hostOf($a.attr('href') || '');
    if (!host) return;
    const domain = getDomain(host) || host;
    if (selfDomain && domain === selfDomain) return; // 자사 내부 링크
    if (NON_SOURCE_HOST_RE.test(host)) return; // SNS·CDN·지도 등
    sourceHosts.add(domain);
    if (AUTHORITY_HOST_RE.test(host)) authorityLinks++;
  });

  const citeCount = reload('cite, .reference, .citation, sup > a[href^="#"]')
    .filter((_, e) => !isReviewish(e)).length;
  const sourceHeading = reload('h1,h2,h3,h4,h5,h6,dt,caption,summary,strong,b,legend')
    .toArray()
    .some((e) => SOURCE_LABEL_RE.test(reload(e).text().replace(/\s+/g, ' ').trim()));
  const hasCitedSources =
    authorityLinks >= 1 ||
    sourceHosts.size >= 2 ||
    citeCount > 0 ||
    /\[\d+\]/.test(bodyText) ||
    sourceHeading ||
    SOURCE_INLINE_RE.test(bodyText);

  const formAccessibility = extractFormActionability(reload);

  // Auto-detect inputs so the operator doesn't hand-type region/procedure (the "서울 vs 강남" bug).
  const locationGuess = extractLocationGuess(bodyText, jsonld);
  const procedureGuess = detectProcedures(bodyText);

  return {
    visibleLen,
    needsHeadless,
    jsonld,
    // scorer.js가 최상위에서 읽는다. jsonld 안에만 두면 실경로에서 항상 undefined가 되어
    // 해당 배점(3점)이 한 번도 지급되지 않는다(v0.3까지의 배선 버그).
    hasSameAsAuthority: !!jsonld.hasSameAsAuthority,
    h1Count: h1.length,
    h2Count: h2.length,
    h1Sample: h1.slice(0, 3),
    dateSignals,
    credentials,
    social,
    phone,
    address,
    questionH2,
    tables,
    faqBlocks,
    answerFirst,
    scripts,
    sn,
    formAccessibility,
    locationGuess,
    procedureGuess,
    hasMapEmbed,
    hasPriceInfo,
    priceBand,
    priceItemCount,
    hasPriceTable,
    hasNonCoveredNotice,
    hasStatistics,
    statCount,
    sectionProfile,
    hasQuotations,
    hasCitedSources,
    sourceLinkCount: sourceHosts.size,
    authorityLinkCount: authorityLinks,
    // page meta (operator comparison) — score-neutral
    title,
    metaDescription,
    canonical,
    ogTitle,
    ogDescription,
    ogImage,
    viewport,
    robotsMeta,
  };
}

// Sanitized HTML sections for the operator side-by-side teardown <pre>.
// Mirrors the old /api/page-source extraction so the compare endpoint is self-contained.
export function extractTeardown(html = '') {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 200) : '';

  const metas = [];
  const metaRe = /<meta\s[^>]+>/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null && metas.length < 12) {
    const tag = m[0];
    if (/(name=["'](description|keywords|robots|author)|property=["'](og:|twitter:))/i.test(tag)) {
      metas.push(tag.replace(/\s+/g, ' ').trim().slice(0, 300));
    }
  }

  const jsonlds = [];
  const jldRe = /<script[^>]+type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = jldRe.exec(html)) !== null && jsonlds.length < 5) {
    try {
      jsonlds.push(JSON.stringify(JSON.parse(m[1]), null, 2).slice(0, 1400));
    } catch {
      jsonlds.push(m[1].trim().slice(0, 1400));
    }
  }

  const bodyText = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 900);

  return { title, metas, jsonlds, bodyText };
}

// 절대 http(s) URL에서 호스트만 추출(소문자, www. 제거). 상대경로·mailto·tel → ''.
function hostOf(href = '') {
  const m = String(href).trim().match(/^https?:\/\/([^/?#]+)/i);
  if (!m) return '';
  return m[1].toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '');
}

// 시/도 full → colloquial ("서울특별시"→"서울", "경기도"→"경기"). 사전 우선 — 사전에 없는
// 외부 표기(JSON-LD addressRegion 자유입력)만 접미사 제거로 폴백한다.
function sidoShort(s = '') {
  const t = String(s).trim();
  if (!t) return '';
  if (SIDO_MAP[t]) return SIDO_MAP[t];
  return t.replace(/(특별자치시|특별자치도|특별시|광역시|자치시|자치도|시|도)$/, '').trim() || t;
}

// 시도 접두어를 뗀 나머지에서 시/군/구를 고른다. 제외 대상은 (a) 광역 단위 표기('부산광역시')와
// (b) 앞머리 제거에 실패해 남은, 감지된 시도와 동일한 토큰뿐이다. 시도와 이름만 겹치는 실재
// 시군구('경기 광주시'의 '광주시')는 반드시 살린다 — 버리면 지역칸이 도(道) 단위로 떨어진다.
// '성남시 분당구'처럼 2단계면 환자가 실제로 검색하는 마지막 '구'를 쓴다.
function pickDistrict(rest = '', sido = '') {
  const short = sidoShort(sido);
  const toks = (String(rest).match(GU_ALL_RE) || []).filter(
    (t) => !SIDO_SUFFIX_RE.test(t) && !(SIDO_MAP[t] && SIDO_MAP[t] === short)
  );
  if (!toks.length) return '';
  const gu = toks.filter((t) => t.endsWith('구'));
  return gu.length ? gu[gu.length - 1] : toks[0];
}
// 시군구 → how a patient actually searches ("강남구"→"강남"); keep suffix when stripping leaves <2 chars
// (중구→중구, 동구→동구) to avoid ambiguity.
function colloquialDistrict(d = '') {
  const base = d.replace(/(시|군|구)$/, '');
  return base.length >= 2 ? base : d;
}

// Best-effort region suggestion from the clinic's OWN page: JSON-LD PostalAddress first (most
// reliable), then a body-text address match. Returns null when nothing parseable (→ manual fallback,
// never a fabricated guess).
export function extractLocationGuess(bodyText = '', jsonld = {}) {
  const ap = jsonld.addressParts;
  let raw = '';
  if (ap && (ap.addressRegion || ap.addressLocality || ap.streetAddress)) {
    raw = [ap.addressRegion, ap.addressLocality, ap.streetAddress].filter(Boolean).join(' ');
  } else if (jsonld.addressRaw) {
    raw = jsonld.addressRaw;
  } else {
    const m = bodyText.match(ADDR_FULL_RE);
    if (m) raw = m[0];
  }

  const sido = (ap && ap.addressRegion) || raw.match(SIDO_RE)?.[1] || raw.match(SIDO_LEAD_RE)?.[1] || '';
  const rest = raw.replace(SIDO_LEAD_RE, '');
  const district = (ap && ap.addressLocality) || pickDistrict(rest, sido) || '';
  const dong = (ap && ap.streetAddress ? ap.streetAddress.match(DONG_RE)?.[1] : '') || (rest.match(DONG_RE)?.[1]) || '';
  const region = colloquialDistrict(district) || sidoShort(sido) || '';

  if (!region && !district && !dong) return null;
  return { raw: raw.trim(), sido: sidoShort(sido), district, dong, region };
}

// Agent-actionability RAW signals: can an AI agent operate this page's booking/contact form?
// A STATIC LOWER BOUND — JS-injected labels (React etc.) are invisible here, so an SPA result is
// "measurement-limited" downstream, never a fake 0. For each interactive control we decide whether
// it has a programmatic NAME (priority: aria-label → aria-labelledby → <label> → button text →
// placeholder[weak]). Scoped to <form> controls; phone/map-only pages report forms:0 (informational).
export function extractFormActionability(reload) {
  // A <label>'s OWN accessible text = its text MINUS nested controls'/options' text. Prevents
  // text-bleed across sibling controls and a <select> being "named" only by its <option> value.
  function labelOwnText(labelEl) {
    const clone = reload(labelEl).clone();
    clone.find('input, select, textarea, button, option, [role="button" i]').remove();
    return clone.text().replace(/\s+/g, ' ').trim();
  }

  // Pre-index <label for> → own text, and id → first NON-EMPTY text (for aria-labelledby).
  const labelFor = new Map();
  reload('label[for]').each((_, el) => {
    const f = (reload(el).attr('for') || '').trim();
    if (f && !labelFor.has(f)) {
      const t = labelOwnText(el);
      if (t) labelFor.set(f, t);
    }
  });
  const idText = new Map();
  reload('[id]').each((_, el) => {
    const id = (reload(el).attr('id') || '').trim();
    if (!id) return;
    const t = reload(el).text().trim();
    if (!idText.has(id) || (!idText.get(id) && t)) idText.set(id, t); // prefer first non-empty
  });

  // A given id / wrapping <label> associates with at most ONE control (the FIRST in document order),
  // matching browser/AT behavior — avoids duplicate-id and multi-control-label false naming.
  const consumedLabelIds = new Set();
  const consumedWrapLabels = new Set();

  const nameInfo = (el) => {
    const $el = reload(el);
    if (($el.attr('aria-label') || '').trim()) return { named: true, weak: false };
    const lb = ($el.attr('aria-labelledby') || '').trim();
    if (lb && lb.split(/\s+/).map((id) => idText.get(id) || '').join(' ').trim()) return { named: true, weak: false };
    const id = ($el.attr('id') || '').trim();
    if (id && labelFor.get(id) && !consumedLabelIds.has(id)) { consumedLabelIds.add(id); return { named: true, weak: false }; }
    const wrapEl = $el.closest('label').get(0);
    if (wrapEl && !consumedWrapLabels.has(wrapEl) && labelOwnText(wrapEl)) { consumedWrapLabels.add(wrapEl); return { named: true, weak: false }; }
    const tag = (el.tagName || el.name || '').toLowerCase();
    const type = ($el.attr('type') || '').toLowerCase();
    const role = ($el.attr('role') || '').toLowerCase();
    if (tag === 'button' || role === 'button') {
      if (($el.text().trim() || ($el.attr('value') || '').trim())) return { named: true, weak: false };
    }
    if (tag === 'input' && /^(submit|button|image)$/.test(type)) {
      if ((($el.attr('value') || '').trim() || ($el.attr('alt') || '').trim())) return { named: true, weak: false };
    }
    if (($el.attr('placeholder') || '').trim()) return { named: true, weak: true };
    if (($el.attr('title') || '').trim()) return { named: true, weak: true };
    return { named: false, weak: false };
  };

  const describe = (tag, type, role) => {
    if (tag === 'input') return `<input${type ? ` type="${type}"` : ''}>`;
    if (role === 'button' && tag !== 'button') return `<${tag} role="button">`;
    return `<${tag}>`;
  };

  let controlsTotal = 0, controlsNamed = 0, placeholderOnly = 0, submitTotal = 0, submitNamed = 0, bookingForms = 0;
  const unnamedSamples = [];
  const forms = reload('form');

  forms.each((_, form) => {
    const $form = reload(form);
    const meta = [($form.attr('action') || ''), ($form.attr('id') || ''), ($form.attr('class') || ''), ($form.attr('name') || '')].join(' ');
    if (BOOKING_RE.test(meta) || BOOKING_RE.test(($form.text() || '').slice(0, 400))) bookingForms++;

    // [role="button" i] = case-insensitive so <div role="BUTTON"> isn't silently dropped (logic lowercases role).
    $form.find('input:not([type="hidden"]), select, textarea, button, [role="button" i]').each((__, c) => {
      const $c = reload(c);
      const tag = (c.tagName || c.name || '').toLowerCase();
      const type = ($c.attr('type') || '').toLowerCase();
      const role = ($c.attr('role') || '').toLowerCase();
      if (type === 'reset') return; // reset/clear is never agent-operated → not a coverage-eligible control
      const isSubmit = type === 'submit' || (tag === 'button' && (type === '' || type === 'submit')) || (tag === 'input' && type === 'image') || role === 'button';
      controlsTotal++;
      const info = nameInfo(c);
      if (info.named) {
        controlsNamed++;
        if (info.weak) placeholderOnly++;
      } else if (unnamedSamples.length < 5) {
        unnamedSamples.push(describe(tag, type, role));
      }
      if (isSubmit) {
        submitTotal++;
        if (info.named) submitNamed++;
      }
    });
  });

  return { forms: forms.length, bookingForms, controlsTotal, controlsNamed, placeholderOnly, submitTotal, submitNamed, unnamedSamples };
}

export function extractJsonLd($) {
  const types = new Set();
  let count = 0;
  let hasDate = false;
  let hasTelephone = false;
  let hasAddress = false;
  let addressParts = null; // first structured PostalAddress {addressRegion, addressLocality, streetAddress}
  let addressRaw = '';     // first string-form address
  let hasSameAsAuthority = false;
  // Field-level capture for the operator schema diff ("어떤 코드가 있나").
  let hasDentalType = false;
  const ent = { name: false, telephone: false, address: false, openingHours: false, geo: false, priceRange: false, areaServed: false, medicalSpecialty: false, sameAs: false };
  const sameAsUrls = new Set();
  let aggregateRating = null;
  let faqCount = 0;
  let hasBreadcrumb = false;

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).contents().text() || $(el).text() || '').trim();
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // Retry with lenient cleanup: trailing commas before } or ] (common in WordPress/Yoast)
      try {
        data = JSON.parse(raw.replace(/,(\s*[}\]])/g, '$1'));
      } catch {
        return;
      }
    }
    walk(data);
  });

  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node['@graph']) walk(node['@graph']);
    const t = node['@type'];
    let tArr = [];
    if (t) {
      tArr = (Array.isArray(t) ? t : [t]).map((x) => String(x));
      tArr.forEach((x) => types.add(x));
      count++;
    }
    const isDental = tArr.some((x) => DENTAL_SCHEMA.test(x));
    const isOrgish = isDental || tArr.some((x) => /Organization|LocalBusiness/i.test(x));
    if (isDental) hasDentalType = true;
    if (tArr.some((x) => /BreadcrumbList/i.test(x))) hasBreadcrumb = true;
    if (tArr.some((x) => /^Question$/i.test(x))) faqCount++;
    if (isOrgish) {
      if (node.name) ent.name = true;
      if (node.telephone) ent.telephone = true;
      if (node.address) ent.address = true;
      if (node.openingHours || node.openingHoursSpecification) ent.openingHours = true;
      if (node.geo) ent.geo = true;
      if (node.priceRange) ent.priceRange = true;
      if (node.areaServed) ent.areaServed = true;
      if (node.medicalSpecialty || node.availableService || node.knowsAbout) ent.medicalSpecialty = true;
      if (node.sameAs) ent.sameAs = true;
    }
    {
      const ar = node.aggregateRating || (tArr.some((x) => /AggregateRating/i.test(x)) ? node : null);
      if (ar && typeof ar === 'object' && !aggregateRating) {
        const value = ar.ratingValue ?? ar.ratingvalue ?? null;
        const cnt = ar.ratingCount ?? ar.reviewCount ?? ar.ratingcount ?? ar.reviewcount ?? null;
        if (value != null || cnt != null) {
          aggregateRating = {
            value: value != null ? String(value).slice(0, 8) : null,
            count: cnt != null && !Number.isNaN(Number(cnt)) ? Number(cnt) : null,
          };
        }
      }
    }
    if (node.datePublished || node.dateModified) hasDate = true;
    if (node.telephone) hasTelephone = true;
    if (node.sameAs) {
      const urls = Array.isArray(node.sameAs) ? node.sameAs : [node.sameAs];
      urls.forEach((u) => { if (typeof u === 'string' && sameAsUrls.size < 12) sameAsUrls.add(u.trim()); });
      if (!hasSameAsAuthority && urls.some((u) => typeof u === 'string' && SAMEAS_AUTHORITY_RE.test(u))) hasSameAsAuthority = true;
    }
    if (node.address) {
      hasAddress = true;
      const a = node.address;
      if (a && typeof a === 'object' && !addressParts && (a.addressRegion || a.addressLocality || a.streetAddress)) {
        addressParts = {
          addressRegion: String(a.addressRegion || '').trim(),
          addressLocality: String(a.addressLocality || '').trim(),
          streetAddress: String(a.streetAddress || '').trim(),
        };
      } else if (typeof a === 'string' && !addressRaw) {
        addressRaw = a.trim();
      }
    }
    for (const k of Object.keys(node)) {
      if (k !== '@graph' && node[k] && typeof node[k] === 'object') walk(node[k]);
    }
  }

  const typeList = [...types];
  return {
    types: typeList,
    count,
    hasDate,
    hasTelephone,
    hasAddress,
    addressParts,
    addressRaw,
    hasDental: typeList.some((t) => DENTAL_SCHEMA.test(t)),
    hasFaq: typeList.some((t) => /FAQPage/i.test(t)),
    hasTrust: typeList.some((t) => TRUST_SCHEMA.test(t)),
    hasSameAsAuthority,
    hasAggregateRating: typeList.some((t) => /AggregateRating/i.test(t)) || !!aggregateRating,
    hasMedicalWebPage: typeList.some((t) => /MedicalWebPage/i.test(t)),
    // Field-level schema profile for the operator comparison panel.
    schema: {
      typeList,
      hasDentalType,
      entity: ent,
      sameAsUrls: [...sameAsUrls],
      aggregateRating,
      faqCount,
      hasBreadcrumb,
    },
  };
}
