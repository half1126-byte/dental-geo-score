import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  embeddableFromHeaders,
  buildSignalDiff,
  buildSchemaDiff,
  buildMetaDiff,
  buildContentDiff,
  mapGapToProducts,
  buildPlanRows,
  recommendedProductIds,
  buildComparePackage,
  EFFECT_LABEL,
  SCHEMA_FIELDS,
} from '../lib/compare.js';
import { extractSignals, extractJsonLd, extractTeardown } from '../lib/extract.js';
import * as cheerio from 'cheerio';

// ── fixtures ────────────────────────────────────────────────
const RICH_HTML = `<!doctype html><html><head>
<title>강남 임플란트 치과 | 위시치과</title>
<meta name="description" content="강남 임플란트·교정 진료 안내. 평일 야간 진료.">
<meta property="og:title" content="위시치과">
<meta property="og:image" content="https://weshe.example/og.png">
<link rel="canonical" href="https://weshe.example/">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Dentist","name":"위시치과","telephone":"02-123-4567","address":{"@type":"PostalAddress","addressRegion":"서울","addressLocality":"강남구","streetAddress":"테헤란로 1"},"openingHoursSpecification":[{"@type":"OpeningHoursSpecification"}],"geo":{"@type":"GeoCoordinates","latitude":37.5},"sameAs":["https://instagram.com/weshe","https://blog.naver.com/weshe"],"areaServed":"강남","priceRange":"₩₩"}</script>
<script type="application/ld+json">{"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"임플란트 비용은 얼마인가요?","acceptedAnswer":{"@type":"Answer","text":"진료별 상이"}},{"@type":"Question","name":"보험 적용되나요?"}]}</script>
<script type="application/ld+json">{"@type":"AggregateRating","ratingValue":"4.8","ratingCount":120}</script>
</head><body><h1>강남 임플란트</h1><h2>비용은 얼마인가요?</h2><p>강남 위시치과입니다.</p></body></html>`;

const BARE_HTML = `<!doctype html><html><head><title>치과</title></head><body><div id="root"></div></body></html>`;

// ── extract.js enrichment ───────────────────────────────────
test('extractSignals: surfaces page meta', () => {
  const s = extractSignals(RICH_HTML);
  assert.ok(s.title.includes('강남 임플란트'));
  assert.ok(s.metaDescription.includes('강남 임플란트'));
  assert.equal(s.canonical, 'https://weshe.example/');
  assert.equal(s.ogTitle, '위시치과');
  assert.ok(s.ogImage.includes('og.png'));
  assert.ok(s.viewport.includes('width=device-width'));
  assert.equal(s.robotsMeta, 'index,follow');
});

test('extractJsonLd: retains field-level schema', () => {
  const $ = cheerio.load(RICH_HTML);
  const j = extractJsonLd($);
  assert.ok(j.schema, 'schema object present');
  assert.equal(j.schema.hasDentalType, true);
  const e = j.schema.entity;
  assert.equal(e.name, true);
  assert.equal(e.telephone, true);
  assert.equal(e.address, true);
  assert.equal(e.openingHours, true);
  assert.equal(e.geo, true);
  assert.equal(e.sameAs, true);
  assert.equal(e.areaServed, true);
  assert.equal(e.priceRange, true);
  assert.equal(j.schema.faqCount, 2);
  assert.ok(j.schema.aggregateRating);
  assert.equal(j.schema.aggregateRating.value, '4.8');
  assert.equal(j.schema.aggregateRating.count, 120);
  assert.ok(j.schema.sameAsUrls.length >= 2);
});

test('extractJsonLd: empty schema on bare page', () => {
  const $ = cheerio.load(BARE_HTML);
  const j = extractJsonLd($);
  assert.equal(j.schema.hasDentalType, false);
  assert.equal(j.schema.entity.name, false);
  assert.equal(j.schema.faqCount, 0);
});

test('extractTeardown: returns sanitized sections', () => {
  const td = extractTeardown(RICH_HTML);
  assert.ok(td.title.includes('위시치과'));
  assert.ok(td.metas.some((m) => /description/i.test(m)));
  assert.equal(td.jsonlds.length, 3);
  assert.ok(td.bodyText.includes('강남'));
  assert.ok(!/<script/i.test(td.bodyText), 'scripts stripped from bodyText');
});

// ── embeddableFromHeaders ───────────────────────────────────
test('embeddableFromHeaders: no headers → embeddable', () => {
  assert.equal(embeddableFromHeaders({}), true);
  assert.equal(embeddableFromHeaders({ 'content-type': 'text/html' }), true);
});
test('embeddableFromHeaders: X-Frame-Options blocks', () => {
  assert.equal(embeddableFromHeaders({ 'x-frame-options': 'DENY' }), false);
  assert.equal(embeddableFromHeaders({ 'x-frame-options': 'SAMEORIGIN' }), false);
  assert.equal(embeddableFromHeaders({ 'X-Frame-Options': 'sameorigin' }), false);
});
test('embeddableFromHeaders: CSP frame-ancestors', () => {
  assert.equal(embeddableFromHeaders({ 'content-security-policy': "frame-ancestors 'none'" }), false);
  assert.equal(embeddableFromHeaders({ 'content-security-policy': "frame-ancestors 'self'" }), false);
  assert.equal(embeddableFromHeaders({ 'content-security-policy': 'frame-ancestors *' }), true);
  assert.equal(embeddableFromHeaders({ 'content-security-policy': "default-src 'self'" }), true);
});

// ── buildSignalDiff ─────────────────────────────────────────
function bd(key, label, status, max, layer) {
  return { key, label, status, max, layer, note: `${label}:${status}`, fix: status === 'ok' ? null : `${label} 보완` };
}
const USER_BD = [bd('crawl', 'AI 크롤러 허용', 'ok', 15, 'SEO'), bd('schema', '구조화 데이터(JSON-LD)', 'fail', 20, 'AEO'), bd('local', '엔티티·로컬 정합', 'ok', 10, 'SEO')];
const COMP_BD = [bd('crawl', 'AI 크롤러 허용', 'ok', 15, 'SEO'), bd('schema', '구조화 데이터(JSON-LD)', 'ok', 20, 'AEO'), bd('local', '엔티티·로컬 정합', 'fail', 10, 'SEO')];

test('buildSignalDiff: classifies gap/same/ahead', () => {
  const rows = buildSignalDiff(USER_BD, COMP_BD);
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.crawl.verdict, 'same');
  assert.equal(byKey.schema.verdict, 'gap');   // user fail, comp ok
  assert.equal(byKey.local.verdict, 'ahead');  // user ok, comp fail
  assert.ok(byKey.schema.why.length > 0);
  assert.equal(byKey.schema.weight, 20);
});

// ── buildSchemaDiff ─────────────────────────────────────────
test('buildSchemaDiff: field presence + missingVsComp', () => {
  const userSchema = { typeList: ['LocalBusiness'], hasDentalType: false, entity: { name: true } };
  const compSchema = { typeList: ['Dentist', 'FAQPage'], hasDentalType: true, entity: { name: true, telephone: true, openingHours: true, sameAs: true }, faqCount: 3 };
  const sd = buildSchemaDiff(userSchema, compSchema);
  const fields = Object.fromEntries(sd.fields.map((f) => [f.key, f]));
  assert.equal(fields.name.verdict, 'same');
  assert.equal(fields.telephone.verdict, 'gap');
  assert.equal(fields.openingHours.verdict, 'gap');
  assert.ok(sd.missingVsComp.length >= 3);
  assert.equal(sd.faqCount.comp, 3);
  assert.equal(SCHEMA_FIELDS.length, sd.fields.length);
});

// ── buildMetaDiff ───────────────────────────────────────────
test('buildMetaDiff: presence verdicts + noindex flag', () => {
  const rows = buildMetaDiff(
    { title: 'A', metaDescription: '', robotsMeta: 'noindex' },
    { title: 'B', metaDescription: 'desc', robotsMeta: 'index' }
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.description.verdict, 'gap'); // user empty, comp has
  assert.equal(byKey.robots.warnUser, true);
  assert.equal(byKey.robots.verdict, 'gap');
});

// ── buildContentDiff ────────────────────────────────────────
test('buildContentDiff: numeric + boolean verdicts', () => {
  const rows = buildContentDiff(
    { h1Count: 1, questionH2: 0, wordCount: 200 },
    { h1Count: 1, questionH2: 4, wordCount: 2000 },
    { hasStatistics: false },
    { hasStatistics: true }
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(byKey.h1.verdict, 'same');
  assert.equal(byKey.questionH2.verdict, 'gap');
  assert.equal(byKey.wordCount.verdict, 'gap');
  assert.equal(byKey.statistics.verdict, 'gap');
});

// ── product mapping + plan rows ─────────────────────────────
test('mapGapToProducts: known + unknown keys', () => {
  assert.ok(mapGapToProducts('schema').includes('content-hub'));
  assert.deepEqual(mapGapToProducts('nope'), []);
});

test('buildPlanRows: prioritizes, notcited first, schema detail', () => {
  const signalDiff = buildSignalDiff(USER_BD, COMP_BD);
  const schemaDiff = buildSchemaDiff(
    { entity: { name: true } },
    { entity: { name: true, openingHours: true, sameAs: true }, typeList: ['Dentist'] }
  );
  const contentDiff = buildContentDiff({}, {}, { hasStatistics: false }, { hasStatistics: true });
  const rows = buildPlanRows(signalDiff, schemaDiff, contentDiff, { userCited: false });
  assert.equal(rows[0].key, 'notcited');     // top priority
  assert.equal(rows[0].priority, 1);
  const schemaRow = rows.find((r) => r.key === 'schema');
  assert.ok(schemaRow, 'schema gap produces a plan row');
  assert.ok(schemaRow.detail.includes('진료시간') || schemaRow.detail.includes('sameAs'), 'schema row lists missing fields');
  assert.ok(schemaRow.productIds.length > 0);
  assert.equal(schemaRow.effectLabel, EFFECT_LABEL);
  // local is user-ahead → should NOT appear as a plan item
  assert.ok(!rows.some((r) => r.key === 'local'));
  // citability gap present
  assert.ok(rows.some((r) => r.key === 'citability'));
});

test('buildPlanRows: skips notcited when userCited true', () => {
  const rows = buildPlanRows(buildSignalDiff(USER_BD, COMP_BD), buildSchemaDiff({}, {}), [], { userCited: true });
  assert.ok(!rows.some((r) => r.key === 'notcited'));
});

test('recommendedProductIds: dedups, preserves order', () => {
  const ids = recommendedProductIds([
    { productIds: ['geo-diagnosis', 'content-hub'] },
    { productIds: ['content-hub', 'media-feature'] },
  ]);
  assert.deepEqual(ids, ['geo-diagnosis', 'content-hub', 'media-feature']);
});

// ── buildComparePackage integration ─────────────────────────
test('buildComparePackage: assembles full render-ready package', () => {
  const user = {
    domain: 'weshe.example', score: 48, breakdown: USER_BD, embeddable: false, finalUrl: 'https://weshe.example/',
    signals: { hasStatistics: false }, schema: { entity: { name: true }, typeList: [] },
    meta: { title: '치과' }, content: { h1Count: 1 }, teardown: { title: '치과', metas: [], jsonlds: [], bodyText: '' },
  };
  const comp = {
    domain: '2d2d.example', score: 55, breakdown: COMP_BD, embeddable: true, finalUrl: 'https://2d2d.example/',
    signals: { hasStatistics: true }, schema: { entity: { name: true, openingHours: true }, typeList: ['Dentist'] },
    meta: { title: '2d2d 치과' }, content: { h1Count: 2 }, teardown: { title: '2d2d', metas: [], jsonlds: [], bodyText: '' },
  };
  const pkg = buildComparePackage(user, comp, { userCited: false });
  assert.equal(pkg.scores.user, 48);
  assert.equal(pkg.scores.comp, 55);
  assert.equal(pkg.embeddable.comp, true);
  assert.ok(Array.isArray(pkg.signalDiff) && pkg.signalDiff.length === 3);
  assert.ok(pkg.schemaDiff.fields.length === SCHEMA_FIELDS.length);
  assert.ok(pkg.planRows.length > 0);
  assert.ok(pkg.recommendedProductIds.length > 0);
  assert.equal(pkg.effectLabel, EFFECT_LABEL);
});

// ── 의료광고법 compliance backstop ──────────────────────────
// 스캔 대상 5개 파일: lib/scorer.js, lib/checklists.js, public/index.html, public/app.js, public/operator.js
// 의료광고법 절대 금칙어 — 성과 단정·최상급 표현
// 주의: "1위"·"보장"은 의료광고법 경고문("1위로 쓰면 위반") 안에 합법적으로 인용될 수 있으므로 별도 처리
const BANNED_TERMS = ['최고', '유일', '완치', '최상급', '명품', '점수↑', '무통', '부작용 없는', '순위 보장'];

const SCAN_FILES = [
  '../lib/compare.js',
  '../lib/scorer.js',
  '../lib/checklists.js',
  '../public/index.html',
  '../public/app.js',
  '../public/operator.js',
];

test('compliance: lib/compare.js copy has no banned 의료광고법 terms', () => {
  const src = readFileSync(new URL('../lib/compare.js', import.meta.url), 'utf8');
  // strip line comments so guidance comments (e.g. the banned-list itself) aren't flagged
  const code = src.replace(/^\s*\/\/.*$/gm, '');
  for (const term of BANNED_TERMS) {
    assert.ok(!code.includes(term), `compare.js must not contain banned term: ${term}`);
  }
  // the hygiene framing label must stay intact
  assert.ok(code.includes('AI 인용 예측 아님'));
});

test('compliance: assembled package strings have no banned terms', () => {
  const mk = (over) => ({ domain: 'x', score: 50, breakdown: USER_BD, signals: {}, schema: { entity: {} }, meta: {}, content: {}, teardown: null, embeddable: false, ...over });
  const pkg = buildComparePackage(mk({}), mk({ domain: 'y', breakdown: COMP_BD }), { userCited: false });
  const json = JSON.stringify({ planRows: pkg.planRows, signalDiff: pkg.signalDiff.map((s) => ({ why: s.why })), effectLabel: pkg.effectLabel });
  for (const term of ['최고', '1위', '유일', '완치', '보장', '최상급', '명품']) {
    assert.ok(!json.includes(term), `package copy must not contain: ${term}`);
  }
});

test('compliance: 5 source files have no banned 의료광고법 terms', () => {
  for (const relPath of SCAN_FILES) {
    const src = readFileSync(new URL(relPath, import.meta.url), 'utf8');
    // strip single-line comments to avoid flagging the banned-list comment itself
    // also strip negation forms: "보장하지 않습니다" / "보장하지 않으며" are compliant disclaimers
    const code = src
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/보장하지\s*않/g, '__NEGATED__');
    for (const term of BANNED_TERMS) {
      assert.ok(!code.includes(term), `${relPath} must not contain banned term: "${term}"`);
    }
  }
});

test('compliance: BANNED scan reads all 5 target files (coverage check)', () => {
  const expectedFiles = ['lib/scorer.js', 'lib/checklists.js', 'public/index.html', 'public/app.js', 'public/operator.js'];
  for (const f of expectedFiles) {
    const found = SCAN_FILES.some((p) => p.includes(f.replace('/', '/')));
    assert.ok(found, `SCAN_FILES must include ${f}`);
  }
  assert.ok(SCAN_FILES.length >= 5, 'SCAN_FILES must cover at least 5 files');
});
