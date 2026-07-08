import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dentalQueryVariants, allQueryVariants } from '../public/query-preview.js';
import { buildPrompts } from '../lib/engines.js';
import { REGION_TERMS } from '../public/kr-regions.js';

// The operator's "이 문구로 측정합니다" preview MUST be byte-identical to what the backend queries.
// If buildPrompts ever changes its phrasing, this fails and forces query-preview.js back in sync.
const CASES = [
  { district: '강남', procedure: '임플란트' },
  { district: '서초', procedure: '치아교정' },
  { district: '강남역', procedure: '' },
  { district: '', procedure: '임플란트' },
  { district: '  성남 수정구  ', procedure: '  보철  ' },
];

test('preview phrasing is identical to buildPrompts (no drift)', () => {
  for (const c of CASES) {
    const preview = dentalQueryVariants(c);
    const backend = buildPrompts(c).map((u) => u.user);
    assert.deepEqual(preview, backend, `mismatch for ${JSON.stringify(c)}`);
  }
});

test('allQueryVariants: district+procedure → ≥6 variants, first 4 identical to dentalQueryVariants', () => {
  const all = allQueryVariants({ district: '강남', procedure: '임플란트' });
  const base = dentalQueryVariants({ district: '강남', procedure: '임플란트' });
  assert.ok(all.length >= 6, `expected ≥6 variants, got ${all.length}`);
  assert.deepEqual(all.slice(0, 4), base, 'first 4 must match dentalQueryVariants exactly');
  assert.ok(all.some((q) => q.includes('출퇴근')), 'conversational "출퇴근" variant should be present');
});

test('allQueryVariants: district only (no procedure) → ≥4 variants, includes district-only conversational', () => {
  const all = allQueryVariants({ district: '강남', procedure: '' });
  assert.ok(all.length >= 4, `expected ≥4 variants, got ${all.length}`);
  assert.ok(all.some((q) => q.includes('강남') && q.includes('치과')), 'district-only conversational variant present');
  assert.ok(!all.some((q) => q.includes('임플란트')), 'no procedure leak with empty procedure');
});

test('allQueryVariants: procedure only (no district) → ≥4 variants, includes procedure-only conversational', () => {
  const all = allQueryVariants({ district: '', procedure: '임플란트' });
  assert.ok(all.length >= 4, `expected ≥4 variants, got ${all.length}`);
  assert.ok(all.some((q) => q.includes('임플란트') && q.includes('추천')), 'procedure-only conversational variant present');
});

test('allQueryVariants: both empty → returns exactly 4 base variants', () => {
  const all = allQueryVariants({ district: '', procedure: '' });
  assert.equal(all.length, 4, 'empty inputs → only 4 base variants');
});

test('region terms list is non-empty, deduped, trimmed', () => {
  assert.ok(REGION_TERMS.length > 30);
  assert.equal(new Set(REGION_TERMS).size, REGION_TERMS.length, 'no duplicates');
  assert.ok(REGION_TERMS.every((r) => r === r.trim() && r.length > 0));
  assert.ok(REGION_TERMS.includes('강남') && REGION_TERMS.includes('서초'));
});
