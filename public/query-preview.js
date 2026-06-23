// Pure mirror of lib/engines.js buildPrompts user-phrasing — so the operator's "이 문구로 측정합니다"
// preview is byte-identical to what the backend actually queries. A drift between this and buildPrompts
// would make the preview a lie, so test/query-preview.test.js asserts deep-equality against buildPrompts.
export function dentalQueryVariants({ district = '', procedure = '' } = {}) {
  const d = String(district).trim();
  const p = String(procedure).trim();
  return [
    `${d} ${p} 잘하는 치과 추천해줘`.replace(/\s+/g, ' ').trim(),
    `${d}에서 ${p} 치과 비교`.replace(/\s+/g, ' ').trim(),
    `${d} 치과 추천`.replace(/\s+/g, ' ').trim(),
  ];
}
