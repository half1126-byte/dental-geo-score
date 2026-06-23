import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dentalQueryVariants } from '../public/query-preview.js';
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

test('region terms list is non-empty, deduped, trimmed', () => {
  assert.ok(REGION_TERMS.length > 30);
  assert.equal(new Set(REGION_TERMS).size, REGION_TERMS.length, 'no duplicates');
  assert.ok(REGION_TERMS.every((r) => r === r.trim() && r.length > 0));
  assert.ok(REGION_TERMS.includes('강남') && REGION_TERMS.includes('서초'));
});
