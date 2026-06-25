import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicView, toPrivateReport, wilsonInterval } from '../lib/redact.js';

const panel = {
  clinicDomain: 'myclinic.co.kr',
  region: '성남',
  procedure: '임플란트',
  perEngine: [{
    engine: 'chatgpt',
    attempts: 5,
    validRuns: 5,
    citedRuns: 1,
    inconclusiveRuns: 0,
    erroredRuns: 0,
    hitRate: 0.2,
    cited: true,
    measured: true,
    unmeasurable: null,
    evidence: [{ engine: 'chatgpt', prompt: '성남 임플란트 추천', matchedUrls: ['https://myclinic.co.kr/implant'], measuredAt: 't' }],
    sampledCitedDomains: ['competitor-a.co.kr', 'competitor-b.com', 'myclinic.co.kr'],
  }],
  measuredAt: 't',
  note: 'n',
};

test('toPublicView strips competitor domains, evidence, matchedUrls', () => {
  const s = JSON.stringify(toPublicView(panel));
  assert.ok(!s.includes('competitor-a.co.kr'), 'competitor domain leaked');
  assert.ok(!s.includes('competitor-b.com'), 'competitor domain leaked');
  assert.ok(!s.includes('matchedUrls'), 'matchedUrls leaked');
  assert.ok(!s.includes('sampledCitedDomains'), 'sampledCitedDomains leaked');
  assert.ok(!s.includes('evidence'), 'evidence leaked');
});

test('public payload contains NO non-owned http(s) URL', () => {
  const s = JSON.stringify(toPublicView(panel));
  const urls = s.match(/https?:\/\/[^"\s]+/g) || [];
  for (const u of urls) assert.ok(u.includes('myclinic.co.kr'), `leaked non-owned url: ${u}`);
});

test('A-1: public view has NO competitorCount (anonymized count is still 비교광고)', () => {
  const pub = toPublicView(panel);
  assert.equal('competitorCount' in pub.perEngine[0], false);
  assert.ok(!JSON.stringify(pub).includes('competitorCount'));
});

test('public view keeps the honest rate + denominator (validRuns)', () => {
  const pub = toPublicView(panel);
  assert.equal(pub.perEngine[0].validRuns, 5);
  assert.equal(pub.perEngine[0].hitRate, 0.2);
  assert.ok(pub.perEngine[0].ci, 'CI present when cited>0');
  assert.equal(pub.clinicDomain, 'myclinic.co.kr'); // own domain allowed
});

test('A-2: 0-cited engine gets NO CI (no implied-efficacy upper bound)', () => {
  const zero = { ...panel, perEngine: [{ ...panel.perEngine[0], citedRuns: 0, cited: false }] };
  const pub = toPublicView(zero);
  assert.equal(pub.perEngine[0].ci, null);
  assert.equal(pub.perEngine[0].measured, true); // measured, just not cited this sample
});

test('C1: all-error engine is measured:false + unmeasurable, no fake 0/N', () => {
  const errored = {
    ...panel,
    perEngine: [{ engine: 'chatgpt', attempts: 3, validRuns: 0, citedRuns: 0, inconclusiveRuns: 0, erroredRuns: 3, hitRate: 0, cited: false, measured: false, unmeasurable: 'engine-error' }],
  };
  const pub = toPublicView(errored);
  assert.equal(pub.perEngine[0].measured, false);
  assert.equal(pub.perEngine[0].unmeasurable, 'engine-error');
  assert.equal(pub.perEngine[0].ci, null);
});

test('toPrivateReport keeps full named evidence (private path only)', () => {
  const priv = toPrivateReport(panel);
  assert.equal(priv.view, 'private');
  assert.ok(priv.perEngine[0].sampledCitedDomains.includes('competitor-a.co.kr'));
});

test('wilson: 0/5 is NOT [0,0] (no false certainty), low=0', () => {
  const ci = wilsonInterval(0, 5);
  assert.equal(ci.low, 0);
  assert.ok(ci.high > 0, 'upper bound must be > 0 for small n');
});

test('wilson: n=0 returns null (측정 안 됨, no interval)', () => {
  assert.equal(wilsonInterval(0, 0), null);
});

test('wilson: 5/5 high bound is 1, low < 1 (not false certainty)', () => {
  const ci = wilsonInterval(5, 5);
  assert.equal(ci.high, 1);
  assert.ok(ci.low < 1, 'lower bound must be < 1 for small n');
});

// --- citedUrlMatch path comparison ---

test('citedUrlMatch: exact path match → match "exact"', () => {
  const priv = toPrivateReport(panel, 'https://myclinic.co.kr/implant');
  assert.equal(priv.citedUrlMatch.match, 'exact');
  assert.equal(priv.citedUrlMatch.inputPath, '/implant');
  assert.ok(priv.citedUrlMatch.citedPaths.includes('/implant'));
});

test('citedUrlMatch: homepage cited when target is /implant → match "domain"', () => {
  const homePanel = {
    ...panel,
    perEngine: [{ ...panel.perEngine[0], evidence: [{ engine: 'chatgpt', prompt: '...', matchedUrls: ['https://myclinic.co.kr/'], measuredAt: 't' }] }],
  };
  const priv = toPrivateReport(homePanel, 'https://myclinic.co.kr/implant');
  assert.equal(priv.citedUrlMatch.match, 'domain');
  assert.equal(priv.citedUrlMatch.inputPath, '/implant');
});

test('citedUrlMatch: no matchedUrls anywhere → match "none"', () => {
  const noMatchPanel = { ...panel, perEngine: [{ ...panel.perEngine[0], evidence: [] }] };
  const priv = toPrivateReport(noMatchPanel, 'https://myclinic.co.kr/implant');
  assert.equal(priv.citedUrlMatch.match, 'none');
  assert.deepEqual(priv.citedUrlMatch.citedPaths, []);
});

test('citedUrlMatch: no inputUrl → field absent (backward compat)', () => {
  const priv = toPrivateReport(panel);
  assert.equal('citedUrlMatch' in priv, false);
});
