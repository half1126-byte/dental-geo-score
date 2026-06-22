import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSignals } from '../lib/extract.js';

const RICH = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@graph":[
  {"@type":"Dentist","name":"테스트치과","telephone":"02-123-4567","address":{"@type":"PostalAddress","streetAddress":"서울 강남구 테헤란로 1"}},
  {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":"q"}]},
  {"@type":"Person","name":"원장"}
]}
</script>
<meta property="article:modified_time" content="2026-01-01">
</head><body>
<h1>임플란트 안내</h1>
<h2>임플란트 비용은 얼마인가요?</h2>
<h2>수술 후 주의사항</h2>
<h2>뼈이식이 필요한가요?</h2>
<table><tr><td>구분</td><td>기간</td></tr></table>
<details><summary>자주 묻는 질문</summary>답변</details>
<p>대표원장 김OO 전문의 치의학박사 면허</p>
<p>서울특별시 강남구 테헤란로 1</p>
<a href="https://blog.naver.com/x">블로그</a>
</body></html>`;

test('parses @graph JSON-LD array → Dentist + FAQPage + Person', () => {
  const s = extractSignals(RICH);
  assert.equal(s.jsonld.hasDental, true);
  assert.equal(s.jsonld.hasFaq, true);
  assert.equal(s.jsonld.hasTrust, true);
  assert.ok(s.jsonld.types.includes('Dentist'));
  assert.equal(s.jsonld.hasTelephone, true);
  assert.equal(s.jsonld.hasAddress, true);
});

test('detects question-H2, table, faq block, dates, credentials, NAP, social', () => {
  const s = extractSignals(RICH);
  assert.ok(s.questionH2 >= 2, `questionH2 ${s.questionH2}`);
  assert.ok(s.tables >= 1);
  assert.ok(s.faqBlocks >= 1);
  assert.ok(s.dateSignals >= 1);
  assert.ok(s.credentials >= 3, `creds ${s.credentials}`);
  assert.equal(s.phone, true);
  assert.equal(s.address, true);
  assert.ok(s.social >= 1);
});

test('JS-shell (empty #root) → needsHeadless true', () => {
  const s = extractSignals('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
  assert.equal(s.needsHeadless, true);
});

test('malformed JSON-LD does not throw, yields no types', () => {
  const s = extractSignals('<html><head><script type="application/ld+json">{bad json,,}</script></head><body>hi there friend this is text</body></html>');
  assert.equal(s.jsonld.count, 0);
  assert.equal(s.jsonld.hasDental, false);
});
