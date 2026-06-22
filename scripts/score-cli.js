// Local end-to-end CLI: node scripts/score-cli.js <url> [--json]
import { auditUrl, FetchBlockedError } from '../lib/audit.js';

const url = process.argv[2];
const asJson = process.argv.includes('--json');
if (!url) {
  console.error('usage: node scripts/score-cli.js <url> [--json]');
  process.exit(1);
}

try {
  const r = await auditUrl(url);
  if (asJson) {
    console.log(JSON.stringify(r, null, 2));
  } else {
    console.log(`\n  ${r.domain}  —  ${r.score}/100  (${r.band})   [${r.renderMode}]`);
    console.log(`  ${'─'.repeat(58)}`);
    for (const x of r.breakdown) {
      const mark = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
      console.log(`  ${mark} ${x.label.padEnd(20)} ${String(x.points).padStart(2)}/${x.max}  ${x.note}`);
    }
    console.log(`  ${'─'.repeat(58)}`);
    console.log('  개선 우선순위:');
    r.topFixes.forEach((f, i) => console.log(`   ${i + 1}. (+${f.gain}) ${f.fix}`));
    console.log('');
  }
} catch (e) {
  if (e instanceof FetchBlockedError) console.error('BLOCKED:', e.reason, e.detail || '');
  else console.error('ERROR:', e?.message || e);
  process.exit(2);
}
