// POC harness — loads .env.local at RUNTIME (keys never leave this process) and runs the real
// citation panel once against a live clinic. Usage: node poc.mjs [url] [region] [procedure]
import { readFileSync } from 'node:fs';
import { runCitationPanel } from './lib/citation.js';

for (const line of readFileSync('./.env.local', 'utf8').split(/\r?\n/)) {
  if (/^\s*#/.test(line)) continue;
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const clinicDomain = (process.argv[2] || 'haruplant.co.kr').replace(/^https?:\/\//, '');
const region = process.argv[3] || '서울';
const procedure = process.argv[4] || '임플란트';

const keys = {};
const ok = (v) => v && !/^PASTE_/.test(v);
if (ok(process.env.OPENAI_API_KEY)) keys.chatgpt = process.env.OPENAI_API_KEY;
if (ok(process.env.PERPLEXITY_API_KEY)) keys.perplexity = process.env.PERPLEXITY_API_KEY;
if (ok(process.env.ANTHROPIC_API_KEY)) keys.claude = process.env.ANTHROPIC_API_KEY;

console.log(`target: ${clinicDomain} | region: ${region} | procedure: ${procedure}`);
console.log(`engines with keys: ${Object.keys(keys).join(', ') || 'NONE'} | model: ${process.env.OPENAI_SEARCH_MODEL}`);
if (!Object.keys(keys).length) { console.log('NO KEYS — fill .env.local'); process.exit(1); }

const t0 = Date.now();
const panel = await runCitationPanel({ clinicDomain, region, procedure, keys, repeats: 1 });
console.log(`\nmeasuredAt: ${panel.measuredAt} | ${Date.now() - t0}ms`);

for (const e of panel.perEngine) {
  console.log(`\n[${e.engine}] measured=${e.measured} cited=${e.cited} ${e.citedRuns}/${e.validRuns} (rate ${e.hitRate}) | unmeasurable=${e.unmeasurable || '-'} | attempts=${e.attempts} errored=${e.erroredRuns} inconclusive=${e.inconclusiveRuns}`);
  for (const ev of (e.evidence || [])) {
    if (ev.error) console.log('   ⚠ ERROR:', ev.error, '|', (ev.prompt || '').slice(0, 55));
    else if (ev.inconclusive) console.log('   · inconclusive (엔진 검색 안 함) |', (ev.prompt || '').slice(0, 55));
    else console.log('   ✓ CITED:', (ev.matchedUrls || []).join(', '), '|', (ev.prompt || '').slice(0, 55));
  }
  if (e.sampledCitedDomains?.length) console.log('   함께 호명된 치과:', e.sampledCitedDomains.slice(0, 10).join(', '));
}
console.log(`\nnote: ${panel.note}`);
