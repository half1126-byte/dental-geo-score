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

test('form actionability: labeled booking form → full coverage, booking detected, submit named', () => {
  const html = `<html><body><div>충분한 본문 텍스트를 넣어 needsHeadless를 피한다. ${'가나다라 '.repeat(40)}</div>
   <form id="reserve"><h3>온라인 예약</h3>
     <label for="nm">이름</label><input id="nm" type="text">
     <label for="tel">연락처</label><input id="tel" type="tel">
     <button type="submit">예약 신청</button>
   </form></body></html>`;
  const fa = extractSignals(html).formAccessibility;
  assert.equal(fa.forms, 1);
  assert.equal(fa.bookingForms, 1);
  assert.equal(fa.controlsTotal, 3);
  assert.equal(fa.controlsNamed, 3);
  assert.equal(fa.submitTotal, 1);
  assert.equal(fa.submitNamed, 1);
  assert.equal(fa.placeholderOnly, 0);
});

test('form actionability: unnamed inputs sampled, placeholder-only counted separately', () => {
  const html = `<html><body><div>본문 텍스트 충분히. ${'배경 설명 '.repeat(40)}</div>
   <form>
     <input type="text">
     <input type="tel" placeholder="휴대폰">
     <button></button>
   </form></body></html>`;
  const fa = extractSignals(html).formAccessibility;
  assert.equal(fa.controlsTotal, 3);
  assert.ok(fa.controlsNamed < fa.controlsTotal, `named ${fa.controlsNamed} < total ${fa.controlsTotal}`);
  assert.ok(fa.placeholderOnly >= 1, `placeholderOnly ${fa.placeholderOnly}`);
  assert.ok(fa.unnamedSamples.length >= 1);
});

const PAD = '<div>' + '본문 텍스트 채우기 '.repeat(50) + '</div>'; // keep visibleLen high → not needsHeadless

test('QA#1 uppercase role=BUTTON sole submit is NOT dropped (case-insensitive selector)', () => {
  const html = `<html><body>${PAD}<form id="reserve"><label for="nm">이름</label><input id="nm"><div role="BUTTON">예약 신청</div></form></body></html>`;
  const fa = extractSignals(html).formAccessibility;
  assert.equal(fa.controlsTotal, 2, 'input + role=BUTTON div both counted');
  assert.equal(fa.submitTotal, 1, 'role button counts as submit');
  assert.equal(fa.submitNamed, 1);
});

test('QA#2 duplicate id credits only the FIRST control (no false 100% coverage)', () => {
  const html = `<html><body>${PAD}<form id="reserve"><label for="dup">이름</label><input id="dup" type="text"><input id="dup" type="tel"><button type="submit">예약</button></form></body></html>`;
  const fa = extractSignals(html).formAccessibility;
  assert.equal(fa.controlsTotal, 3);
  assert.equal(fa.controlsNamed, 2, 'first input(label) + submit; second dup input is UNnamed');
  assert.ok(fa.unnamedSamples.length >= 1);
});

test('QA#3 wrapping label: no text-bleed to siblings, option-only select is unnamed', () => {
  const multi = `<html><body>${PAD}<form id="reserve"><label>개인정보 동의<input type="checkbox"><input type="text"></label><button type="submit">예약</button></form></body></html>`;
  const fa1 = extractSignals(multi).formAccessibility;
  assert.ok(fa1.controlsNamed < fa1.controlsTotal, `bare text input must NOT inherit label text (named ${fa1.controlsNamed}/${fa1.controlsTotal})`);

  const sel = `<html><body>${PAD}<form id="reserve"><label><select><option>09:00</option></select></label><button type="submit">예약</button></form></body></html>`;
  const fa2 = extractSignals(sel).formAccessibility;
  assert.ok(fa2.unnamedSamples.includes('<select>'), `select named only by option text must be UNnamed: ${JSON.stringify(fa2.unnamedSamples)}`);
});

test('QA#4 reset button excluded from coverage denominator', () => {
  const html = `<html><body>${PAD}<form id="reserve"><input type="text" aria-label="이름"><button type="reset">초기화</button><button type="submit" aria-label="예약">예약</button></form></body></html>`;
  const fa = extractSignals(html).formAccessibility;
  assert.equal(fa.controlsTotal, 2, 'text input + submit; reset excluded');
  assert.equal(fa.submitTotal, 1);
});

test('locationGuess from JSON-LD streetAddress → 강남 (RICH fixture)', () => {
  const g = extractSignals(RICH).locationGuess;
  assert.ok(g, 'should detect a location');
  assert.equal(g.district, '강남구');
  assert.equal(g.region, '강남');   // colloquial query form (구 stripped)
  assert.equal(g.sido, '서울');
});

test('locationGuess from structured JSON-LD addressLocality/Region → 서초', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist","name":"서초치과",
     "address":{"@type":"PostalAddress","addressRegion":"서울특별시","addressLocality":"서초구","streetAddress":"강남대로 411"}}
  </script></head><body>${'본문 텍스트 채우기 '.repeat(50)}</body></html>`;
  const g = extractSignals(html).locationGuess;
  assert.equal(g.district, '서초구');
  assert.equal(g.region, '서초');
  assert.equal(g.sido, '서울');
});

test('locationGuess from body-text address when no JSON-LD → 송파', () => {
  const html = `<html><body>${'안내 문구 '.repeat(50)}<p>오시는 길: 서울 송파구 올림픽로 300</p></body></html>`;
  const g = extractSignals(html).locationGuess;
  assert.ok(g, 'should parse address from body');
  assert.equal(g.region, '송파');
});

test('locationGuess null when no parseable address (manual fallback, not fabricated)', () => {
  const html = `<html><body>${'치과 소개 본문 텍스트 '.repeat(50)}</body></html>`;
  assert.equal(extractSignals(html).locationGuess, null);
});

test('ambiguous 중구 keeps suffix (strip would leave <2 chars)', () => {
  const html = `<html><body>${'본문 '.repeat(60)}<p>주소: 서울 중구 세종대로 100</p></body></html>`;
  const g = extractSignals(html).locationGuess;
  assert.equal(g.district, '중구');
  assert.equal(g.region, '중구'); // not "중"
});

test('procedureGuess detects + ranks by frequency (RICH → 임플란트 top)', () => {
  const p = extractSignals(RICH).procedureGuess;
  assert.ok(Array.isArray(p) && p.length >= 1);
  assert.equal(p[0].q, '임플란트');
  assert.ok(p[0].hits >= 2);
});

// GEO content citability signals (KDD 2024: statistics +33%, quotations +41%, citations +27%)

test('hasStatistics: ≥2 numeric measurements in p/li text → true', () => {
  const html = `<html><body>${PAD}
    <p>임플란트 10년 생존율은 98%이며 성공 사례는 3,200례 이상입니다.</p>
    <p>평균 수술 시간 45분, 보조금 지원 최대 350만 원.</p>
  </body></html>`;
  assert.equal(extractSignals(html).hasStatistics, true);
});

test('hasStatistics: single numeric measurement → false', () => {
  const html = `<html><body>${PAD}<p>임플란트 수술 일반 안내입니다. 자세한 사항은 상담을 통해 확인하세요.</p></body></html>`;
  assert.equal(extractSignals(html).hasStatistics, false);
});

test('hasQuotations: <blockquote> present → true', () => {
  const html = `<html><body>${PAD}<blockquote>임플란트는 현대 치과의 가장 중요한 치료법 중 하나입니다.</blockquote></body></html>`;
  assert.equal(extractSignals(html).hasQuotations, true);
});

test('hasQuotations: corner-bracket quoted text ≥20 chars → true', () => {
  const html = `<html><body>${PAD}<p>원장이 말했다: 「임플란트 치료는 전문의와 충분한 상담 후 결정하는 것이 중요합니다」</p></body></html>`;
  assert.equal(extractSignals(html).hasQuotations, true);
});

test('hasQuotations: no blockquote, no curly/corner quotes → false', () => {
  const html = `<html><body>${PAD}<p>임플란트 안내 페이지입니다. 자세한 내용은 상담을 통해 확인하세요.</p></body></html>`;
  assert.equal(extractSignals(html).hasQuotations, false);
});

test('hasCitedSources: <cite> tag → true', () => {
  const html = `<html><body>${PAD}<p>임플란트 연구 결과 (<cite>대한치과의사협회, 2024</cite>)</p></body></html>`;
  assert.equal(extractSignals(html).hasCitedSources, true);
});

test('hasCitedSources: [1] footnote marker → true', () => {
  const html = `<html><body>${PAD}<p>임플란트 10년 성공률은 95% 이상입니다[1]. 국내 통계 기준.</p></body></html>`;
  assert.equal(extractSignals(html).hasCitedSources, true);
});

test('hasCitedSources: 참고문헌 heading → true', () => {
  const html = `<html><body>${PAD}<h3>참고문헌</h3><p>대한치과의사협회 가이드라인 2024</p></body></html>`;
  assert.equal(extractSignals(html).hasCitedSources, true);
});

test('hasCitedSources: no cite/marker/heading → false', () => {
  const html = `<html><body>${PAD}<p>임플란트 치료에 대한 일반적인 안내입니다.</p></body></html>`;
  assert.equal(extractSignals(html).hasCitedSources, false);
});

test('hasSameAsAuthority: JSON-LD sameAs wikidata.org → true', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist","name":"테스트치과",
     "sameAs":"https://www.wikidata.org/wiki/Q12345678"}
  </script></head><body>${PAD}</body></html>`;
  assert.equal(extractSignals(html).jsonld.hasSameAsAuthority, true);
});

test('hasSameAsAuthority: sameAs non-authority domain → false', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist","name":"테스트치과",
     "sameAs":"https://example-clinic.co.kr/about"}
  </script></head><body>${PAD}</body></html>`;
  assert.equal(extractSignals(html).jsonld.hasSameAsAuthority, false);
});

// ── Lenient JSON-LD parse (extruct-inspired trailing-comma fix) ───────────────

test('lenient JSON-LD: trailing comma before } still extracts Dentist type', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist","name":"트레일링치과",}
  </script></head><body>${PAD}</body></html>`;
  const j = extractSignals(html).jsonld;
  assert.equal(j.hasDental, true, 'trailing comma before } must not drop JSON-LD');
});

test('lenient JSON-LD: trailing comma before ] in array still parses', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":["Dentist","LocalBusiness",]}
  </script></head><body>${PAD}</body></html>`;
  const j = extractSignals(html).jsonld;
  assert.equal(j.hasDental, true, 'trailing comma before ] must not drop JSON-LD');
});

test('lenient JSON-LD: genuinely broken JSON (unclosed brace) still silently skips', () => {
  const html = `<html><head><script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Dentist"
  </script></head><body>${PAD}</body></html>`;
  const j = extractSignals(html).jsonld;
  assert.equal(j.hasDental, false, 'truly broken JSON must not crash — silent skip');
});
