// Page signal extraction from RAW HTML via cheerio.
// POC finding: WebFetch/markdown strips <script>, so JSON-LD must be read from raw HTML here.
import * as cheerio from 'cheerio';
import { detectProcedures } from './dental-procedures.js';

const CRED_RE = /전문의|치의학박사|박사|원장|면허|교수|DDS|DMD|레지던트|수련의/g;
const PHONE_RE = /0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/;
const ADDR_RE = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주|서울특별시|부산광역시)\S*\s?\S*(로|길|동|가)\s?\d/;
// GEO content citability signals — KDD 2024 validated (+33/41/27%)
const STAT_RE = /\d[\d,]*\.?\d*\s*(%|퍼센트|명|원|회|개|번|배|점|년|월|일|건|례|만|억|천|mm|cm|mg|ml)/g;
const SAMEAS_AUTHORITY_RE = /wikidata\.org|wikipedia\.org|namu\.wiki|naver\.me|health\.kr|nhis\.or\.kr|kda\.or\.kr/i;
// Fuller address capture (for auto-detect): 시/도 + 시군구 + (도로/동) for region suggestion.
const SIDO = '서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주';
const ADDR_FULL_RE = new RegExp(`(${SIDO})(?:특별자치시|특별자치도|특별시|광역시|도)?\\s*[가-힣]{1,5}(?:시|군|구)(?:\\s*[가-힣]{1,5}(?:동|읍|면))?`);
const GU_RE = /([가-힣]{1,5}(?:시|군|구))/;
const DONG_RE = /([가-힣]{1,5}(?:동|읍|면))(?![가-힣])/;
const SIDO_RE = new RegExp(`(${SIDO})(?:특별자치시|특별자치도|특별시|광역시|도)?`);
const QUESTION_RE = /\?|인가요|되나요|있나요|어떻게|무엇|왜\s|얼마|가능한가|차이|주의|준비|기간/;
const DENTAL_SCHEMA = /^(Dentist|MedicalClinic|MedicalBusiness|LocalBusiness|MedicalOrganization)$/i;
const TRUST_SCHEMA = /^(FAQPage|Person|Organization|MedicalWebPage|Article|BreadcrumbList|WebSite)$/i;
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
  const hasPriceInfo = /임플란트.*비용|교정.*가격|비급여.*금액|가격.*안내/i.test(bodyText);

  // GEO content citability signals (KDD 2024: statistics +33%, quotations +41%, citations +27%)
  const bodyPara = reload('p, li, td').map((_, e) => reload(e).text()).get().join(' ');
  const hasStatistics = (bodyPara.match(STAT_RE) || []).length >= 2;
  const hasQuotations =
    reload('blockquote').length > 0 ||
    (bodyText.match(/“[^”\n]{20,}”|「[^」\n]{20,}」/g) || []).length >= 1;
  const citeCount = reload('cite, .reference, .citation, sup > a[href^="#"]').length;
  const hasCitedSources =
    citeCount > 0 ||
    /\[\d+\]/.test(bodyText) ||
    /참고문헌|출처\s*:|\bReference|\bBibliography/i.test(bodyText);

  const formAccessibility = extractFormActionability(reload);

  // Auto-detect inputs so the operator doesn't hand-type region/procedure (the "서울 vs 강남" bug).
  const locationGuess = extractLocationGuess(bodyText, jsonld);
  const procedureGuess = detectProcedures(bodyText);

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
    formAccessibility,
    locationGuess,
    procedureGuess,
    hasMapEmbed,
    hasPriceInfo,
    hasStatistics,
    hasQuotations,
    hasCitedSources,
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

// 시/도 full → colloquial ("서울특별시"→"서울", "경기도"→"경기").
function sidoShort(s = '') {
  return s.replace(/(특별자치시|특별자치도|특별시|광역시|특별자치|도)$/, '').trim();
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

  const sido = (ap && ap.addressRegion) || (raw.match(SIDO_RE)?.[0]) || '';
  const district = (ap && ap.addressLocality) || (raw.match(GU_RE)?.[1]) || '';
  const dong = (ap && ap.streetAddress ? ap.streetAddress.match(DONG_RE)?.[1] : '') || (raw.match(DONG_RE)?.[1]) || '';
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
