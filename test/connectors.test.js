import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunReportBody, parseRunReport, GA4_ENDPOINT } from '../lib/connectors/ga4-ai.js';
import { buildGraphQLQuery, parseBotGroups, BOT_DETECTION_IDS } from '../lib/connectors/cf-aibots.js';
import { CLIENT_SETUP_CHECKLIST } from '../lib/checklists.js';

// --- GA4 connector ---
test('ga4: runReport body filters on sessionMedium == "ai-assistant" (stable token)', () => {
  const b = buildRunReportBody({});
  assert.equal(b.dimensionFilter.filter.fieldName, 'sessionMedium');
  assert.equal(b.dimensionFilter.filter.stringFilter.value, 'ai-assistant');
  assert.ok(b.dimensions.some((d) => d.name === 'sessionSourceMedium'));
  assert.ok(b.metrics.some((m) => m.name === 'sessions'));
});

test('ga4: endpoint shape', () => {
  assert.equal(GA4_ENDPOINT('123'), 'https://analyticsdata.googleapis.com/v1beta/properties/123:runReport');
});

test('ga4: parseRunReport aggregates sessions/keyEvents by platform', () => {
  const resp = { rows: [
    { dimensionValues: [{ value: 'chatgpt.com / ai-assistant' }, { value: '20260620' }], metricValues: [{ value: '10' }, { value: '8' }, { value: '2' }] },
    { dimensionValues: [{ value: 'chatgpt.com / ai-assistant' }, { value: '20260621' }], metricValues: [{ value: '5' }, { value: '4' }, { value: '1' }] },
    { dimensionValues: [{ value: 'perplexity.ai / ai-assistant' }, { value: '20260621' }], metricValues: [{ value: '3' }, { value: '3' }, { value: '0' }] },
  ] };
  const r = parseRunReport(resp);
  assert.equal(r.totalSessions, 18);
  assert.equal(r.totalKeyEvents, 3);
  assert.equal(r.byPlatform[0].sourceMedium, 'chatgpt.com / ai-assistant');
  assert.equal(r.byPlatform[0].sessions, 15);
});

test('ga4: empty/malformed response safe', () => {
  assert.equal(parseRunReport({}).totalSessions, 0);
  assert.equal(parseRunReport(null).totalSessions, 0);
});

// --- Cloudflare connector ---
test('cf: precise query includes botDetectionIds_hasany + eyeball + all deduped ids', () => {
  const { query, variables } = buildGraphQLQuery({ zoneTag: 'z', since: 'a', until: 'b', mode: 'precise' });
  assert.ok(query.includes('botDetectionIds_hasany'));
  assert.ok(query.includes('requestSource:"eyeball"'));
  const allIds = [...new Set(Object.values(BOT_DETECTION_IDS).flat())];
  assert.deepEqual([...variables.ids].sort(), [...allIds].sort());
});

test('cf: fallback query uses userAgent_like', () => {
  const { query, variables } = buildGraphQLQuery({ zoneTag: 'z', since: 'a', until: 'b', mode: 'fallback' });
  assert.ok(query.includes('userAgent_like'));
  assert.equal(variables.ua, '%bot%');
});

test('cf: parseBotGroups maps detection ids -> bot names (precise) + searchBotsCrawling', () => {
  const resp = { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
    { count: 12, dimensions: { botDetectionIds: [126255384], clientRequestPath: '/' } }, // OAI-SearchBot
    { count: 7, dimensions: { botDetectionIds: [33563889], clientRequestPath: '/implant' } }, // PerplexityBot
    { count: 3, dimensions: { botDetectionIds: [123815556], clientRequestPath: '/' } }, // GPTBot
  ] }] } } };
  const r = parseBotGroups(resp, 'precise');
  assert.equal(r.total, 22);
  assert.equal(r.perBot.find((x) => x.bot === 'OAI-SearchBot').count, 12);
  assert.equal(r.searchBotsCrawling, true);
});

test('cf: fallback parses by UA substring', () => {
  const resp = { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [
    { count: 5, dimensions: { userAgent: 'Mozilla/5.0 (compatible; PerplexityBot/1.0)' } },
  ] }] } } };
  const r = parseBotGroups(resp, 'fallback');
  assert.equal(r.perBot[0].bot, 'PerplexityBot');
  assert.equal(r.perBot[0].count, 5);
});

test('cf: empty/malformed safe', () => {
  assert.equal(parseBotGroups({}, 'precise').total, 0);
  assert.equal(parseBotGroups(null, 'fallback').total, 0);
});

// --- client setup checklist ---
test('client setup: 2 auto-connector + 3 manual, all well-formed', () => {
  const items = CLIENT_SETUP_CHECKLIST.items;
  assert.equal(items.filter((i) => i.mode === 'auto-connector').length, 2);
  assert.equal(items.filter((i) => i.mode === 'manual').length, 3);
  assert.ok(items.every((i) => i.id && i.label && i.mode));
});
