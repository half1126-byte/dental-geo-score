// Page signal extraction from RAW HTML via cheerio.
// POC finding: WebFetch/markdown strips <script>, so JSON-LD must be read from raw HTML here.
import * as cheerio from 'cheerio';

const CRED_RE = /전문의|치의학박사|박사|원장|면허|교수|DDS|DMD|레지던트|수련의/g;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const ADDR_RE = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|서울특별시|부산광역시)\S*\s?\S*(로|길|동|가)\s?\d/;
const QUESTION_RE = /\?|인가요|되나요|있나요|어떻게|무엇|왜\s|얼마|가능한가|차이|주의|준비|기간/;
const DENTAL_SCHEMA = /^(Dentist|MedicalClinic|MedicalBusiness|LocalBusiness|MedicalOrganization)$/i;
const TRUST_SCHEMA = /^(FAQPage|Person|Organization|MedicalWebPage|Article|BreadcrumbList|WebSite)$/i;

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

  return {
    visibleLen,
    needsHeadless,
    jsonld,
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
  };
}

export function extractJsonLd($) {
  const types = new Set();
  let count = 0;
  let hasDate = false;
  let hasTelephone = false;
  let hasAddress = false;

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = ($(el).contents().text() || $(el).text() || '').trim();
    if (!raw) return;
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      // some sites wrap multiple objects or have trailing commas — best effort skip
      return;
    }
    walk(data);
  });

  function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    if (node['@graph']) walk(node['@graph']);
    const t = node['@type'];
    if (t) {
      (Array.isArray(t) ? t : [t]).forEach((x) => types.add(String(x)));
      count++;
    }
    if (node.datePublished || node.dateModified) hasDate = true;
    if (node.telephone) hasTelephone = true;
    if (node.address) hasAddress = true;
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
    hasDental: typeList.some((t) => DENTAL_SCHEMA.test(t)),
    hasFaq: typeList.some((t) => /FAQPage/i.test(t)),
    hasTrust: typeList.some((t) => TRUST_SCHEMA.test(t)),
  };
}
