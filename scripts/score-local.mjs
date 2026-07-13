// Local file scorer — bypasses SSRF-safe fetcher, reads HTML+robots.txt from disk.
// Usage: node scripts/score-local.mjs <html-path> [robots-path]
import { readFileSync } from 'node:fs';
import { extractSignals } from '../lib/extract.js';
import { scorePage } from '../lib/scorer.js';
import { analyzeRobots } from '../lib/robots.js';

const htmlPath = process.argv[2];
const robotsPath = process.argv[3];
const asJson = process.argv.includes('--json');

if (!htmlPath) {
  console.error('usage: node scripts/score-local.mjs <html-path> [robots-path] [--json]');
  process.exit(1);
}

const html = readFileSync(htmlPath, 'utf8');
const signals = extractSignals(html);

let robots = { present: false, parseable: false, blocksAny: false, blockedBots: [] };
if (robotsPath) {
  const body = readFileSync(robotsPath, 'utf8');
  robots = analyzeRobots({ status: 200, contentType: 'text/plain', body });
}

const result = scorePage({ robots, signals });

if (asJson) {
  console.log(JSON.stringify({ signals: {
    scripts: signals.scripts, sn: signals.sn, needsHeadless: signals.needsHeadless,
    h1Count: signals.h1Count, h2Count: signals.h2Count, questionH2: signals.questionH2,
    tables: signals.tables, faqBlocks: signals.faqBlocks,
    credentials: signals.credentials, social: signals.social,
    dateSignals: signals.dateSignals, hasQuotations: signals.hasQuotations,
    statCount: signals.statCount, hasCitedSources: signals.hasCitedSources,
    jsonld: signals.jsonld,
  }, result }, null, 2));
} else {
  console.log(`\n  [로컬 파일] ${htmlPath}`);
  console.log(`  점수: ${result.score}/100  (${result.band})`);
  console.log(`  축A 기술준비도: ${result.axes.tech.score}/${result.axes.tech.max}`);
  console.log(`  축B 콘텐츠인용성: ${result.axes.content.score}/${result.axes.content.max}`);
  console.log(`  ${'─'.repeat(58)}`);
  for (const x of result.breakdown) {
    const mark = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
    console.log(`  ${mark} ${x.label.padEnd(22)} ${String(x.points).padStart(2)}/${x.max}  ${x.note}`);
  }
  if (result.topFixes.length) {
    console.log(`  ${'─'.repeat(58)}`);
    console.log('  개선 우선순위:');
    result.topFixes.forEach((f, i) => console.log(`   ${i + 1}. (+${f.gain}) ${f.fix}`));
  }
  console.log('');
}
