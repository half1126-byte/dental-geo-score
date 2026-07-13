#!/usr/bin/env node
// Scan tracked files for provider keys and for exact secret values from local env files.
// Reports only the variable name and location; the secret value is never printed.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' })
  .split('\0').filter(Boolean);

const envFiles = ['.env', '.env.local'].filter(existsSync);
const localSecrets = [];
for (const file of envFiles) {
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const name = match[1];
    const value = match[2].replace(/^['"]|['"]$/g, '').trim();
    if (/(?:KEY|TOKEN|PASSWORD|SECRET)$/i.test(name) && value.length >= 8) {
      localSecrets.push({ name, value });
    }
  }
}

const providerPatterns = [
  ['OpenAI-style key', /\bsk-[A-Za-z0-9_-]{16,}\b/g],
  ['Perplexity key', /\bpplx-[A-Za-z0-9_-]{12,}\b/g],
  ['Bearer token literal', /authorization\s*:\s*['"]Bearer\s+[A-Za-z0-9._-]{16,}/gi],
];

const findings = [];
for (const file of tracked) {
  let text;
  try { text = readFileSync(file, 'utf8'); }
  catch { continue; }
  if (text.includes('\0')) continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { name, value } of localSecrets) {
      if (line.includes(value)) findings.push(`${file}:${index + 1} contains ${name}`);
    }
    for (const [label, pattern] of providerPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) findings.push(`${file}:${index + 1} contains ${label}`);
    }
  });
}

if (findings.length) {
  console.error('Secret scan failed:');
  findings.forEach((finding) => console.error(`- ${finding}`));
  process.exit(1);
}
console.log(`Secret scan passed (${tracked.length} repository files).`);
