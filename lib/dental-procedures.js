// Dental procedure catalog — single source for (a) auto-detecting which procedures a clinic's page
// is about, and (b) the chips the operator confirms. `q` = the term used IN the measurement query
// ("강남 {q} 잘하는 치과 추천해줘"), `label` = chip display, `kw` = detection keywords (literal, ci).
export const PROCEDURES = [
  { q: '임플란트', label: '임플란트', kw: ['임플란트', 'implant'] },
  { q: '치아교정', label: '치아교정', kw: ['교정', '인비절라인', 'invisalign', '투명교정'] },
  { q: '충치치료', label: '충치치료', kw: ['충치', '레진', '인레이', '온레이'] },
  { q: '신경치료', label: '신경치료', kw: ['신경치료', '근관치료'] },
  { q: '사랑니발치', label: '사랑니', kw: ['사랑니', '매복치'] },
  { q: '라미네이트', label: '라미네이트', kw: ['라미네이트', '라미네잇'] },
  { q: '치아미백', label: '미백', kw: ['미백'] },
  { q: '스케일링', label: '스케일링', kw: ['스케일링'] },
  { q: '보철', label: '보철(크라운)', kw: ['보철', '크라운', '브릿지', '온레이'] },
  { q: '틀니', label: '틀니', kw: ['틀니', '의치'] },
  { q: '소아치과', label: '소아치과', kw: ['소아치과', '어린이치과', '소아진료'] },
  { q: '턱관절', label: '턱관절', kw: ['턱관절', '악관절'] },
  { q: '잇몸치료', label: '잇몸치료', kw: ['잇몸', '치주', '풍치'] },
  { q: '구강검진', label: '검진', kw: ['정기검진', '구강검진', '구강검사'] },
];

// Count keyword hits per procedure in raw page text → detected procedures ranked by frequency.
export function detectProcedures(text = '') {
  const out = [];
  for (const p of PROCEDURES) {
    let hits = 0;
    for (const kw of p.kw) {
      const m = text.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'));
      if (m) hits += m.length;
    }
    if (hits > 0) out.push({ q: p.q, label: p.label, hits });
  }
  return out.sort((a, b) => b.hits - a.hits);
}
