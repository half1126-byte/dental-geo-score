// Pure mirror of lib/engines.js buildPrompts user-phrasing — so the operator's "이 문구로 측정합니다"
// preview is byte-identical to what the backend actually queries. A drift between this and buildPrompts
// would make the preview a lie, so test/query-preview.test.js asserts deep-equality against buildPrompts.
export function dentalQueryVariants({ district = '', procedure = '', businessType = '치과' } = {}) {
  const d = String(district).trim();
  const p = String(procedure).trim();
  const bt = String(businessType || '치과').trim();
  return [
    `${d} ${p} 잘하는 ${bt} 추천해줘`.replace(/\s+/g, ' ').trim(),
    `${d}에서 ${p} ${bt} 비교`.replace(/\s+/g, ' ').trim(),
    `${d} ${bt} 추천`.replace(/\s+/g, ' ').trim(),
    `${d} ${p} 비용이 얼마예요`.replace(/\s+/g, ' ').trim(),
  ];
}

// Extended set of conversational query variants for the operator query-selection UI.
// These are NOT automatically sent to the backend — the operator selects up to 3,
// and only the selected strings are passed via the `queries` body param.
export function allQueryVariants({ district = '', procedure = '', businessType = '치과' } = {}) {
  const d = String(district).trim();
  const p = String(procedure).trim();
  const bt = String(businessType || '치과').trim();
  const hasD = d.length > 0;
  const hasP = p.length > 0;

  const base = [
    `${d} ${p} 잘하는 ${bt} 추천해줘`.replace(/\s+/g, ' ').trim(),
    `${d}에서 ${p} ${bt} 비교`.replace(/\s+/g, ' ').trim(),
    `${d} ${bt} 추천`.replace(/\s+/g, ' ').trim(),
    `${d} ${p} 비용이 얼마예요`.replace(/\s+/g, ' ').trim(),
  ];

  const conversational = [
    hasD && hasP && `${d} 출퇴근하는데 ${p} 할 ${bt} 어디가 좋아?`,
    hasD && hasP && `${d} 근처 ${p} ${bt} 아무데나 예약해도 괜찮을까?`,
    hasD && hasP && `${p} 해야 하는데 ${d} 쪽 어디 가면 돼?`,
    hasD && hasP && `${p} ${d} 잘하는 데 어딘지 알려줘`,
    hasD && hasP && `${d}에서 ${p} 잘해준다는 ${bt} 찾는데 추천해줘`,
    hasD && !hasP && `${d} 근처 ${bt} 아무데나 괜찮은 곳 있어?`,
    !hasD && hasP && `${p} 잘하는 ${bt} 추천해줘`,
  ].filter(Boolean);

  return [...base, ...conversational];
}
