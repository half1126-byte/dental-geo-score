import { agentCardHtml } from './agent-card.js';
import { dentalQueryVariants, allQueryVariants } from './query-preview.js';
import { REGION_TERMS } from './kr-regions.js';

const $ = (id) => document.getElementById(id);
const show = (id) => { const el = $(id); if (el) el.classList.remove('hidden'); };
const hide = (id) => { const el = $(id); if (el) el.classList.add('hidden'); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => Math.round((x || 0) * 100);
const ENGINE_LABEL = { chatgpt: 'ChatGPT (API)', perplexity: 'Perplexity (API)', claude: 'Claude (API)' };

let lastScoreRes = null;
let lastUrl = '';
let selectedProcedure = '';
let geminiVerdicts = [];
let selectedQueries = []; // strings selected by operator for measurement (max 3)
let selectedRegions = []; // for multi-region sweep (max 5)
let selectedProducts = []; // for product recommendation (medinmedi services)
let lastCiteRes = null; // saved from last citation measurement

$('regionList').innerHTML = REGION_TERMS.map((r) => `<option value="${esc(r)}">`).join('');

// ── URL ?key= 자동 주입 ──────────────────────────────────────────
const _urlKey = new URLSearchParams(location.search).get('key');
if (_urlKey) { localStorage.setItem('opKey', _urlKey); history.replaceState(null, '', location.pathname); }

// ── 패스코드 상태 초기화 ────────────────────────────────────────
function showKeyEntry(errMsg) {
  hide('keySaved');
  hide('confirmSection');
  const note = $('keyValidationNote');
  if (note) {
    if (errMsg) { note.textContent = errMsg; note.style.display = 'block'; }
    else { note.textContent = ''; note.style.display = 'none'; }
  }
}

function showKeyValid(key) {
  $('keySaved').classList.remove('hidden');
  hide('setupCard');
  $('keyMasked').textContent = key.slice(0, 2) + '•'.repeat(Math.max(0, key.length - 2));
  show('analyzeSection');
  const note = $('keyValidationNote');
  if (note) note.style.display = 'none';
}

async function validateKey(key) {
  try {
    const r = await fetch('/api/auth-check', {
      method: 'POST',
      headers: { 'x-operator-key': key },
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

async function initKeyState() {
  const saved = localStorage.getItem('opKey') || '';
  if (!saved) { showKeyEntry(); return; }
  // Re-validate saved key on every page load — catches key rotation without UI lag
  const ok = await validateKey(saved);
  if (ok) {
    showKeyValid(saved);
  } else {
    localStorage.removeItem('opKey');
    showKeyEntry('저장된 패스코드가 유효하지 않습니다. 다시 입력해주세요.');
  }
}
initKeyState();

// 저장 버튼
$('keySaveBtn').addEventListener('click', async () => {
  const val = $('opKey').value.trim();
  if (!val) return;
  const btn = $('keySaveBtn');
  btn.disabled = true; btn.textContent = '확인 중...';
  const ok = await validateKey(val);
  btn.disabled = false; btn.textContent = '저장';
  if (!ok) {
    showKeyEntry('패스코드가 맞지 않습니다. .env.local의 OPERATOR_KEY 값을 확인하세요.');
    return;
  }
  localStorage.setItem('opKey', val);
  showKeyValid(val);
});
$('opKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('keySaveBtn').click(); });

// 변경 버튼
$('keyChangeBtn').addEventListener('click', () => {
  showKeyEntry();
  $('opKey').value = localStorage.getItem('opKey') || '';
  $('opKey').focus();
});

$('keyShareBtn').addEventListener('click', () => {
  const key = localStorage.getItem('opKey') || '';
  if (!key) return;
  const shareUrl = `${location.origin}/operator.html?key=${encodeURIComponent(key)}`;
  navigator.clipboard.writeText(shareUrl).then(() => {
    const btn = $('keyShareBtn');
    btn.textContent = '복사됨!';
    setTimeout(() => { btn.textContent = '링크 복사'; }, 2000);
  }).catch(() => { prompt('이 URL을 복사하세요:', shareUrl); });
});

// ── PHASE 1: 분석 (/api/score) ─────────────────────────────────
$('opBtn').addEventListener('click', async () => {
  let url = ($('opUrl').value || '').trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  lastUrl = url;

  hide('opResult'); hide('opError'); hide('confirmSection'); hide('printBar'); hide('naverSection'); hide('naverManualSection');
  $('opLoadMsg').textContent = '페이지 분석 중 (지역·진료 자동 감지)...';
  show('opLoading');
  $('opBtn').disabled = true; $('opBtn').textContent = '분석 중...';
  requestAnimationFrame(() => { const el = $('opLoading'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  try {
    const scoreRes = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null);

    hide('opLoading');
    if (!scoreRes || !scoreRes.ok) {
      const why = scoreRes && scoreRes.d && (scoreRes.d.message || scoreRes.d.reason);
      showError('페이지 분석 실패 — URL 확인' + (why ? ' (' + esc(why) + ')' : ''));
      return;
    }
    lastScoreRes = scoreRes;
    populateConfirm(scoreRes.d);
    show('confirmSection');
    requestAnimationFrame(() => { const el = $('confirmSection'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opBtn').disabled = false; $('opBtn').textContent = '분석';
  }
});

function populateConfirm(d) {
  selectedRegions = []; // reset on new URL
  renderRegionChips();
  const g = d.locationGuess;
  $('opRegion').value = (g && g.region) || '';
  const hint = $('opRegionHint');
  if (g && g.raw) {
    hint.className = 'region-hint ok';
    hint.textContent = '✓ 감지됨: ' + g.raw;
  } else {
    hint.className = 'region-hint';
    hint.textContent = '자동 감지 실패 — 직접 입력하세요 (예: 강남)';
  }
  const procs = d.procedureGuess || [];
  selectedProcedure = procs.length ? procs[0].q : '';
  renderProcChips(procs.map((p) => ({ q: p.q, label: p.label })));
  updateQueryChips();
}

function renderProcChips(items) {
  const wrap = $('opProcChips');
  if (!items.length) {
    wrap.innerHTML = '<span class="muted small">감지된 진료 없음 — 아래에 직접 입력</span>';
    return;
  }
  wrap.innerHTML = items
    .map((p) => `<button type="button" class="chip${p.q === selectedProcedure ? ' on' : ''}" data-proc="${esc(p.q)}">${esc(p.label)}</button>`)
    .join('');
}

$('opProcChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-proc]'); if (!b) return;
  selectedProcedure = b.getAttribute('data-proc');
  $('opProcChips').querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === b));
  updateQueryChips();
});

$('opProcAdd').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const v = e.target.value.trim(); if (!v) return;
  selectedProcedure = v;
  const cur = [...$('opProcChips').querySelectorAll('[data-proc]')].map((c) => ({ q: c.getAttribute('data-proc'), label: c.textContent }));
  if (!cur.some((c) => c.q === v)) cur.push({ q: v, label: v });
  renderProcChips(cur);
  e.target.value = '';
  updateQueryChips();
});

$('opRegion').addEventListener('input', updateQueryChips);
$('opRegion').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRegionChip(); } });
$('opRegionAddBtn').addEventListener('click', addRegionChip);

function addRegionChip() {
  const v = $('opRegion').value.trim();
  if (!v || selectedRegions.includes(v)) return;
  if (selectedRegions.length >= 5) return;
  selectedRegions = [...selectedRegions, v];
  renderRegionChips();
  updateQueryChips();
}

function removeRegionChip(r) {
  selectedRegions = selectedRegions.filter((x) => x !== r);
  renderRegionChips();
  updateQueryChips();
}

function renderRegionChips() {
  const wrap = $('opRegionChips');
  if (!wrap) return;
  if (!selectedRegions.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = selectedRegions.map((r) =>
    `<span class="chip on" style="gap:6px">${esc(r)}<button type="button" data-rmregion="${esc(r)}" style="background:none;border:none;cursor:pointer;color:inherit;font-size:.8rem;padding:0;line-height:1">✕</button></span>`
  ).join('');
}

$('opRegionChips') && document.body.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rmregion]'); if (!btn) return;
  removeRegionChip(btn.getAttribute('data-rmregion'));
});

function updateQueryChips() {
  const region = selectedRegions.length ? selectedRegions[0] : $('opRegion').value.trim();
  const variants = allQueryVariants({ district: region, procedure: selectedProcedure });
  // default: first 3 selected (reset on region/procedure change)
  selectedQueries = variants.slice(0, 4);
  renderQueryChips(variants);
}

function renderQueryChips(variants) {
  const wrap = $('opQueryChips');
  if (!variants.length) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = variants.map((v, i) => {
    const on = selectedQueries.includes(v);
    return `<button type="button" class="q-chip${on ? ' on' : ''}" data-query="${esc(v)}">
      <div class="q-chip-num">${on ? selectedQueries.indexOf(v) + 1 : '·'}</div>
      <div class="q-chip-text">${esc(v)}</div>
    </button>`;
  }).join('');
  updateQueryHint();
}

function updateQueryHint() {
  const h = $('opQueryHint');
  const n = selectedQueries.length;
  if (h) h.textContent = `${n}개 선택됨 (최대 3개) · 선택된 질의로만 AI에게 질문합니다.`;
}

$('opQueryChips').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-query]'); if (!btn) return;
  const q = btn.getAttribute('data-query');
  if (selectedQueries.includes(q)) {
    if (selectedQueries.length <= 1) return; // 최소 1개 유지
    selectedQueries = selectedQueries.filter((x) => x !== q);
  } else {
    if (selectedQueries.length >= 4) return; // 최대 4개
    selectedQueries = [...selectedQueries, q];
  }
  // re-render chips with updated selection
  const all = [...$('opQueryChips').querySelectorAll('[data-query]')].map((b) => b.getAttribute('data-query'));
  renderQueryChips(all);
});

// ── PHASE 2: 측정 (/api/citation) ──────────────────────────────
$('opMeasureBtn').addEventListener('click', async () => {
  const key = localStorage.getItem('opKey') || '';
  const region = $('opRegion').value.trim();
  const procedure = selectedProcedure;
  const isMultiRegion = selectedRegions.length > 1;
  const effectiveRegion = selectedRegions.length === 1 ? selectedRegions[0] : region;
  if (!effectiveRegion && !selectedRegions.length && !procedure) { showError('지역 또는 진료를 입력해주세요.'); return; }

  hide('opError'); hide('opResult');
  if (isMultiRegion) {
    const nEng = 3; const nQ = selectedQueries.length || 4;
    const approx = (selectedRegions.length * nEng * nQ * 0.06).toFixed(2);
    $('opLoadMsg').textContent = `${selectedRegions.length}개 지역 × ${nEng}엔진 × ${nQ}쿼리 ≈ $${approx} — 측정 중...`;
  } else {
    $('opLoadMsg').textContent = 'ChatGPT·Perplexity·Claude에 실제 질의 중 (최대 1~2분)...';
  }
  show('opLoading');
  $('opMeasureBtn').disabled = true; $('opMeasureBtn').textContent = '측정 중...';
  try {
    const nocache = !!($('opNocache') && $('opNocache').checked);
    const headers = { 'content-type': 'application/json', 'x-operator-key': key, ...(nocache ? { 'x-nocache': '1' } : {}) };
    const queriesToSend = selectedQueries.length > 0 ? selectedQueries : undefined;
    const cName = (lastScoreRes && lastScoreRes.d && lastScoreRes.d.clinicNameGuess) || '';
    const body = isMultiRegion
      ? { url: lastUrl, regions: selectedRegions, procedure, queries: queriesToSend, clinicName: cName, ...(nocache ? { nocache: true } : {}) }
      : { url: lastUrl, region: effectiveRegion, procedure, queries: queriesToSend, clinicName: cName, ...(nocache ? { nocache: true } : {}) };
    const citeRes = await fetch('/api/citation', {
      method: 'POST', headers,
      body: JSON.stringify(body),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null);
    hide('opLoading');
    if (citeRes && citeRes.status === 401) {
      // 패스코드 오류 — 안내를 명확히
      localStorage.removeItem('opKey');
      initKeyState();
      hide('confirmSection');
      showError('패스코드가 맞지 않습니다. ① 패스코드를 다시 입력해주세요.<br><small style="color:var(--text-2)">.env.local의 <code>OPERATOR_KEY=</code> 값을 확인하세요 (OpenAI/Perplexity API 키가 아닙니다)</small>');
      return;
    }
    render(lastScoreRes, citeRes, { region: isMultiRegion ? selectedRegions.join('·') : (effectiveRegion || region), procedure });
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opMeasureBtn').disabled = false; $('opMeasureBtn').textContent = '측정 시작 (유료 API)';
  }
});

function showError(msg) {
  $('opErrMsg').innerHTML = msg; show('opError');
  requestAnimationFrame(() => { const el = $('opError'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
}
window.printReport = function () { window.print(); };

function render(scoreRes, citeRes, q) {
  geminiVerdicts = [];
  lastCiteRes = citeRes;
  selectedProducts = [];

  const header    = renderResultHeader(scoreRes, citeRes, q);
  const citation  = renderCitation(citeRes);
  const recommend = renderProductRecommend(citeRes, scoreRes);
  const hygiene   = renderHygiene(scoreRes);
  const improve   = renderImprovements(scoreRes);
  const agent     = renderAgentActionability(scoreRes);
  const gemini    = renderGemini(q);

  const citeOk = citeRes && citeRes.d && Array.isArray(citeRes.d.perEngine)
    && citeRes.d.perEngine.some((p) => p.cited);
  // 미추천 시 '인용 얻는 법' 전략 카드 → 결과 위가 아니라 부가(접기)로 이동
  const strategy = (citeRes && citeRes.d && Array.isArray(citeRes.d.perEngine) && citeRes.d.perEngine.length && !citeOk)
    ? renderContentStrategy(q) : '';

  const acc = (title, body) => `<div class="accordion-wrap" style="margin-top:8px">
    <button type="button" class="accordion-btn" onclick="this.closest('.accordion-wrap').classList.toggle('open')"><span>${title}</span><span class="accordion-arrow">▼</span></button>
    <div class="accordion-body">${body}</div>
  </div>`;
  const label = (n, text, dim) => `<div class="result-section-label${dim ? ' dim' : ''}"><span class="rsl-num">${n}</span> ${text}</div>`;

  // IA: 결론(hero) → ① 실측 → ② 진단 → ③ 솔루션 → ④ 부가(접기)
  $('opResult').innerHTML = `
    ${header}
    ${label('①', 'AI 실측 — 실제로 추천하나요?')}
    ${citation}
    ${label('②', '진단 — 무엇이 부족한가')}
    <div class="result-2col">
      <div>${improve}</div>
      <div>${hygiene}</div>
    </div>
    ${label('③', '솔루션 — 이렇게 해결하세요')}
    ${recommend}
    ${label('④', '부가 분석 (펼쳐서 보기)', true)}
    ${acc('🤖 에이전트 액션 가능성', agent)}
    ${acc('🔍 Gemini 수동 확인', gemini)}
    ${strategy ? acc('⚡ AI 인용을 얻는 방법', strategy) : ''}
  `;
  show('opResult');
  { const _r = $('opResult'); _r.classList.remove('reveal'); void _r.offsetWidth; _r.classList.add('reveal'); }
  requestAnimationFrame(() => {
    const bar = document.querySelector('.score-bar-fill');
    if (bar) bar.style.width = bar.dataset.pct + '%';
  });
  // 인쇄 버튼 활성화 + 메타 갱신
  { const _pd = (citeRes && citeRes.d) || {};
    const _dom = _pd.clinicDomain || lastUrl.replace(/^https?:\/\//, '').split('/')[0];
    const _pm = document.getElementById('printMeta');
    if (_pm) _pm.textContent = [_dom, new Date().toLocaleDateString('ko-KR'), q.region, q.procedure].filter(Boolean).join(' · ');
    show('printBar'); }
  // 이력 비동기 로드 (메인 렌더를 블록하지 않음)
  hide('historySection');
  fetchAndRenderHistory(lastUrl);
  // Naver Place 비동기 로드 (실패해도 메인 결과 영향 없음)
  hide('naverSection');
  loadNaverPlace(q);
  hide('naverManualSection');
  const _nmDomain = lastUrl ? lastUrl.replace(/^https?:\/\//, '').split('/')[0].split('?')[0] : '';
  if (_nmDomain) loadNaverManual(_nmDomain);
}

function renderContentStrategy(q) {
  const region = (q && q.region) || '지역';
  const proc   = (q && q.procedure) || '진료';
  const items = [
    {
      num: '01',
      label: '네이버 블로그 실명 포스팅',
      desc: `"${region} 치과 ${proc} 후기", "추천 치과 방문기" 등 이 치과 이름이 명시된 블로그 글이 ChatGPT·Perplexity의 핵심 인용 소스입니다. lifeinsightspost.com 같은 헬스 콘텐츠 사이트가 치과를 언급한 기사를 AI가 그대로 인용하는 방식입니다.`,
    },
    {
      num: '02',
      label: '의료 미디어 기고 · 원장 인터뷰',
      desc: '헬스조선·코메디닷컴·닥터Q 등 의료 전문 도메인에 원장님 이름·치과명이 함께 실린 기사나 인터뷰. 권위 있는 도메인의 언급은 AI 인용 가중치가 가장 높습니다.',
    },
    {
      num: '03',
      label: '지역 커뮤니티 자연 언급',
      desc: `${region} 맘카페·지역 온라인 커뮤니티에서 치과 이름이 자연스럽게 거론될수록 AI가 "${region} 추천 치과"로 학습합니다. 직접 홍보 글보다 자연 언급이 효과적입니다.`,
    },
    {
      num: '04',
      label: '리뷰 플랫폼 · GBP 축적',
      desc: '카카오맵·네이버 지도 리뷰 수·평점이 높을수록 AI가 신뢰받는 치과로 인식합니다. Google Business Profile 리뷰도 AI가 "지역 인기 치과"를 판단하는 제3자 신호입니다.',
    },
  ];

  return `<div class="strategy-card">
    <div class="strategy-card-hd">
      <div class="strategy-card-icon">⚡</div>
      <div>
        <div class="strategy-card-title">AI 인용을 얻는 방법</div>
        <div class="strategy-card-sub">기술 점수와 별개 · 외부 콘텐츠 언급이 핵심입니다</div>
      </div>
    </div>
    <div class="strategy-card-lead">
      ChatGPT·Perplexity는 치과 홈페이지를 직접 순위화하지 않습니다.<br>
      <b>제3자 콘텐츠(블로그·기사·리뷰·커뮤니티)가 이 치과를 언급한 횟수</b>와 출처의 권위를 기준으로 추천합니다.<br>
      기술 점수 89점이어도 외부 언급이 없으면 미인용 — 34점 사이트가 추천되는 이유입니다.
    </div>
    <div class="strategy-items">
      ${items.map((it) => `<div class="strategy-item">
        <div class="strategy-item-num">${esc(it.num)}</div>
        <div class="strategy-item-body">
          <div class="strategy-item-label">${esc(it.label)}</div>
          <div class="strategy-item-desc">${esc(it.desc)}</div>
        </div>
      </div>`).join('')}
    </div>
  </div>`;
}

function renderGemini(q) {
  const variants = dentalQueryVariants({ district: q.region, procedure: q.procedure });
  const rows = variants.map((v, i) => `
    <div style="padding:12px 0;border-top:1px solid var(--border)">
      <div style="font-size:.88rem;font-weight:600;color:var(--text-1);margin-bottom:8px;line-height:1.4">"${esc(v)}"</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="chip" data-gcopy="${esc(v)}">📋 복사</button>
        <a class="chip" href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer">Gemini 열기 ↗</a>
        <span style="flex:1 0 100%;height:4px"></span>
        <button type="button" class="chip" data-gset="${i}:cited">✅ 추천됨</button>
        <button type="button" class="chip" data-gset="${i}:not">❌ 추천 안 됨</button>
        <button type="button" class="chip" data-gset="${i}:unsure">❓ 불확실</button>
      </div>
    </div>`).join('');
  return `<div class="card gate">
    <b style="font-size:1rem">Gemini — 직접 확인</b>
    <p class="muted small" style="margin:6px 0 4px">Gemini는 자동 측정이 어렵습니다. 아래 검색어를 복사해 Gemini에 붙여넣고 이 치과가 나오면 <b>추천됨</b>을 클릭하세요.</p>
    ${rows}
    <p class="small muted" id="gTally" style="margin-top:12px;text-align:center">아직 기록 없음</p>
  </div>`;
}

$('opResult').addEventListener('click', (e) => {
  const cp = e.target.closest('[data-gcopy]');
  if (cp) {
    const t = cp.getAttribute('data-gcopy');
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    cp.textContent = '📋 복사됨'; setTimeout(() => { cp.textContent = '📋 복사'; }, 1200);
    return;
  }
  const set = e.target.closest('[data-gset]');
  if (set) {
    const [idx, val] = set.getAttribute('data-gset').split(':');
    geminiVerdicts[+idx] = val;
    set.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === set));
    const n = geminiVerdicts.filter(Boolean).length;
    const cited = geminiVerdicts.filter((v) => v === 'cited').length;
    const el = $('gTally');
    if (el) el.textContent = `Gemini(수동): ${n}개 기록 · 떴음 ${cited}건`;
    return;
  }
  // competitor compare — intercept link clicks that have data-compare
  const cmpLink = e.target.closest('[data-compare]');
  if (cmpLink) {
    e.preventDefault();
    const domain = cmpLink.getAttribute('data-compare');
    const href = cmpLink.getAttribute('href');
    loadCompare(domain, href);
    return;
  }
  // Product inquiry CTA — toggle lead form
  if (e.target.closest('#prodInquiryBtn')) {
    const formWrap = $('leadFormWrap');
    if (formWrap) {
      const isOpen = formWrap.style.display !== 'none' && formWrap.style.display !== '';
      formWrap.style.display = isOpen ? 'none' : 'block';
      if (!isOpen) updateLeadProductChips();
    }
    return;
  }
  // Lead form submit
  if (e.target.closest('#leadSubmitBtn')) {
    submitLead();
  }
});

function formatTeardown(td, domain) {
  if (!td) return `(소스 가져오기 실패 — ${esc(domain)})`;
  const lines = [];
  if (td.title) lines.push(`<title>${esc(td.title)}</title>`);
  for (const m of (td.metas || []).slice(0, 8)) lines.push(esc(m));
  if (td.jsonlds && td.jsonlds.length) {
    lines.push('');
    lines.push('&lt;!-- ── JSON-LD Schema ── --&gt;');
    for (const jld of td.jsonlds.slice(0, 3)) {
      lines.push(`&lt;script type="application/ld+json"&gt;\n${esc(jld)}\n&lt;/script&gt;`);
    }
  }
  if (td.bodyText) {
    lines.push('');
    lines.push('--- 본문 텍스트 미리보기 ---');
    lines.push(esc(td.bodyText.slice(0, 700)));
  }
  return lines.join('\n') || '(추출된 내용 없음)';
}

// Plan table → inquiry form: add gap-solving products to selectedProducts, reflect checkboxes, scroll.
function addProductsToInquiry(ids) {
  for (const id of ids) {
    if (id && PRODUCTS.some((p) => p.id === id) && !selectedProducts.includes(id)) {
      selectedProducts = [...selectedProducts, id];
    }
  }
  for (const id of selectedProducts) {
    const cb = document.querySelector(`[data-prodcheck="${id}"]`);
    if (cb) cb.checked = true;
  }
  updateProductUI();
  const ps = $('productSection');
  if (ps) ps.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// compareSection is a SIBLING of #opResult, so its panel needs its own delegation.
$('compareSection').addEventListener('click', (e) => {
  const retry = e.target.closest('[data-compare-retry]');
  if (retry) {
    loadCompare(retry.getAttribute('data-retry-domain'), retry.getAttribute('data-retry-url'));
    return;
  }
  const addBtn = e.target.closest('[data-add-products]');
  if (addBtn) {
    const ids = (addBtn.getAttribute('data-add-products') || '').split(',').filter(Boolean);
    addProductsToInquiry(ids);
    addBtn.textContent = '✓ 문의에 담았습니다';
    addBtn.classList.add('on');
    addBtn.disabled = true;
    return;
  }
  const chip = e.target.closest('[data-add-product]');
  if (chip) {
    addProductsToInquiry([chip.getAttribute('data-add-product')]);
    chip.classList.add('on');
  }
});

function short(s, n = 18) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function compCloseBtn() {
  return `<button type="button" onclick="document.getElementById('compareSection').classList.add('hidden')" class="chip" style="float:right;margin-left:8px">닫기 ✕</button>`;
}

// Scale-to-fit: render each preview iframe at desktop width (1200) then shrink to the cell — shows the
// whole homepage as a thumbnail instead of a cropped top-left corner.
function applyPreviewScale(root) {
  const BASE = 1200;
  root.querySelectorAll('.compare-preview-frame[data-embed="1"]').forEach((f) => {
    if (f.style.display === 'none') return; // fell back to card
    const stage = f.parentElement;
    const w = stage.clientWidth, h = stage.clientHeight || 440;
    if (!w) return;
    const scale = w / BASE;
    f.style.width = BASE + 'px';
    f.style.height = Math.round(h / scale) + 'px';
    f.style.transformOrigin = '0 0';
    f.style.transform = `scale(${scale})`;
  });
}

// iframe graceful fallback + scale-to-fit sizing.
function wireComparePreviews(root) {
  applyPreviewScale(root);
  requestAnimationFrame(() => applyPreviewScale(root));
  root.querySelectorAll('.compare-preview-frame[data-embed="1"]').forEach((f) => {
    let done = false;
    const fb = f.parentElement.querySelector('.compare-preview-fallback');
    const reveal = () => { if (done) return; f.style.display = 'none'; if (fb) fb.removeAttribute('hidden'); };
    const t = setTimeout(reveal, 4800);
    f.addEventListener('load', () => { done = true; clearTimeout(t); applyPreviewScale(root); });
    f.addEventListener('error', () => { clearTimeout(t); reveal(); });
  });
}

// re-scale previews on window resize (panel is responsive)
let _cmpResizeT;
window.addEventListener('resize', () => {
  clearTimeout(_cmpResizeT);
  _cmpResizeT = setTimeout(() => {
    const sec = document.getElementById('compareSection');
    if (sec && !sec.classList.contains('hidden')) applyPreviewScale(sec);
  }, 150);
});

async function loadCompare(compDomain, compUrl, _retrying = false) {
  const sec = $('compareSection');
  sec.innerHTML = `<div class="compare-panel"><p class="muted small">⏳ ${esc(compDomain)} — 구조 분석 중 (최대 35초)${_retrying ? ' · 재시도 중...' : ''}...</p></div>`;
  show('compareSection');
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const key = localStorage.getItem('opKey') || '';
  const compFullUrl = compUrl || (compDomain.startsWith('http') ? compDomain : `https://${compDomain}`);
  const userScore = lastScoreRes && lastScoreRes.d ? lastScoreRes.d.score : null;
  const userCited = !!(lastCiteRes && lastCiteRes.d && Array.isArray(lastCiteRes.d.perEngine)
    && lastCiteRes.d.perEngine.some((p) => p.cited));

  // Reuse the already-measured user data → server skips the fragile re-fetch of the user's own site.
  const sd = lastScoreRes && lastScoreRes.d;
  const cp = sd && sd.compareProfile;
  const userProfile = (cp && sd.breakdown) ? {
    domain: sd.domain, finalUrl: cp.finalUrl, score: sd.score,
    breakdown: sd.breakdown, signals: sd.signals,
    schema: cp.schema, meta: cp.meta, content: cp.content,
    teardown: cp.teardown, embeddable: cp.embeddable,
  } : null;

  let pkg = null, errMsg = '', errStatus = 0, errData = null;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 38000); // client-side guard — Vercel maxDuration=40s
    let r;
    try {
      r = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-operator-key': key },
        body: JSON.stringify({ userUrl: lastUrl, compUrl: compFullUrl, userScore, userCited, userProfile }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }
    errStatus = r.status;
    errData = await r.json().catch(() => ({}));
    if (r.ok) pkg = errData;
    else errMsg = (errData && errData.message) ? errData.message : `분석 실패 (${r.status})`;
  } catch (e) {
    errMsg = (e && e.name === 'AbortError') ? '분석 시간 초과 (35초) — 경쟁 병원 사이트 응답이 느린 것 같습니다' : '네트워크 오류';
  }

  // Auto-retry once on transient server/network errors (502 fetch-failed, 504 timeout, 0 network)
  if (!pkg && !_retrying && (errStatus === 0 || errStatus === 502 || errStatus === 504)) {
    return loadCompare(compDomain, compUrl, true);
  }

  if (!pkg || !pkg.signalDiff) {
    const side = errData && errData.side;
    const reason = errData && errData.reason;
    const reasonTag = reason
      ? `<br><code style="font-size:.73rem;color:#555;background:#f5f5f5;padding:2px 7px;border-radius:3px;letter-spacing:.01em">${esc(reason)}</code>`
      : '';
    const sideNote = side === 'comp'
      ? '<br><span class="muted small" style="font-size:.78rem">경쟁 병원 사이트가 느리거나 일시 차단된 것 같습니다. 잠시 후 재시도해 보세요.</span>'
      : side === 'user'
      ? '<br><span class="muted small" style="font-size:.78rem">분석 대상 사이트를 다시 불러오지 못했습니다. "분석" 버튼으로 재측정 후 시도하세요.</span>'
      : '';
    sec.innerHTML = `<div class="compare-panel">${compCloseBtn()}
      <p style="margin-bottom:12px">비교 분석 실패 — ${esc(errMsg || '데이터 없음')}${reasonTag}${sideNote}</p>
      <button type="button" class="btn p" data-compare-retry data-retry-domain="${esc(compDomain)}" data-retry-url="${esc(compFullUrl)}" style="min-width:140px">🔄 다시 시도</button></div>`;
    return;
  }
  sec.innerHTML = renderCompare(pkg, compDomain);
  sec.classList.remove('reveal'); void sec.offsetWidth; sec.classList.add('reveal');
  wireComparePreviews(sec);
}

function renderCompare(pkg, compDomain) {
  const userDomain = (pkg.domains && pkg.domains.user) || '측정 대상';
  const cDomain = compDomain || (pkg.domains && pkg.domains.comp) || '경쟁 치과';
  const uScore = pkg.scores ? pkg.scores.user : '?';
  const cScore = pkg.scores ? pkg.scores.comp : '?';

  return `<div class="compare-panel">
    ${compCloseBtn()}
    <div class="compare-title">🔬 심층 경쟁 비교 — ${esc(short(cDomain, 28))}</div>
    <p class="muted small" style="margin:2px 0 12px">측정 대상과 AI가 인용한 경쟁 치과의 코드·구조를 나란히 분해합니다.</p>
    ${renderPreviewRow(pkg, userDomain, cDomain, uScore, cScore)}
    ${renderSignalDiff(pkg.signalDiff, userDomain, cDomain)}
    ${renderSchemaDiff(pkg.schemaDiff, userDomain, cDomain)}
    ${renderMetaContentDiff(pkg, userDomain, cDomain)}
    ${renderPlanTable(pkg)}
    ${renderSolutionCTA(pkg)}
    ${renderTeardown(pkg.teardown, userDomain, cDomain)}
    <p class="muted small" style="margin-top:14px">기술·구조 비교는 AI 인용과 직접 인과관계가 없는 <b>필요조건·위생 지표</b>입니다. 인용은 외부 언급(블로그·기사·커뮤니티)에 좌우됩니다.</p>
  </div>`;
}

function renderPreviewRow(pkg, userDomain, cDomain, uScore, cScore) {
  const emb = pkg.embeddable || {};
  const urls = pkg.finalUrls || {};
  const cell = (domain, score, url, embeddable, tagClass, badge) => {
    const safeUrl = url || (String(domain).startsWith('http') ? domain : `https://${domain}`);
    const stage = embeddable
      ? `<iframe class="compare-preview-frame" data-embed="1" src="${esc(safeUrl)}" loading="lazy" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin"></iframe>
         <div class="compare-preview-fallback" hidden>
           <div class="compare-preview-blocked">미리보기를 불러오지 못했습니다</div>
           <a class="btn p" href="${esc(safeUrl)}" target="_blank" rel="noopener">새 탭에서 열기 ↗</a>
         </div>`
      : `<div class="compare-preview-fallback">
           <div class="compare-preview-blocked">⚠ 임베드 차단됨<br><span>X-Frame-Options / CSP</span></div>
           <a class="btn p" href="${esc(safeUrl)}" target="_blank" rel="noopener">새 탭에서 열기 ↗</a>
         </div>`;
    return `<div class="compare-preview-cell">
      <div class="compare-preview-head ${tagClass}"><span>${esc(short(domain, 20))}</span><span class="compare-preview-score">${esc(String(score))}점 ${badge}<a href="${esc(safeUrl)}" target="_blank" rel="noopener" class="cp-open" title="전체 보기">↗</a></span></div>
      <div class="compare-preview-stage">${stage}</div>
    </div>`;
  };
  return `<div class="compare-preview-cols">
    ${cell(userDomain, uScore, urls.user, emb.user, 'compare-tag-user', '<span class="compare-mini-badge">측정 대상</span>')}
    ${cell(cDomain, cScore, urls.comp, emb.comp, 'compare-tag-comp', '<span class="compare-mini-badge gold">🏆 AI 인용</span>')}
  </div>`;
}

function statusCellHtml(status) {
  const map = { ok: ['✓', 'ok'], warn: ['△', 'warn'], fail: ['✗', 'fail'], na: ['—', 'na'] };
  const [sym, cls] = map[status] || map.na;
  return `<span class="diff-status ${cls}">${sym}</span>`;
}

function renderSignalDiff(rows, userDomain, cDomain) {
  if (!rows || !rows.length) return '';
  const body = rows.map((r) => `<tr class="${r.verdict === 'gap' ? 'diff-gap' : ''}">
    <td class="diff-item"><div>${esc(r.label)} <span class="diff-layer">${esc(r.layer)}</span></div>
      <div class="diff-why">${esc(r.why)}</div></td>
    <td class="diff-cell">${statusCellHtml(r.userStatus)}</td>
    <td class="diff-cell">${statusCellHtml(r.compStatus)}</td>
    <td class="diff-cell">${r.verdict === 'gap' ? '<span class="diff-tag gap">격차</span>' : r.verdict === 'ahead' ? '<span class="diff-tag ahead">우위</span>' : '<span class="diff-tag same">동일</span>'}</td>
  </tr>`).join('');
  return `<div class="compare-section-head" style="margin-top:20px">① GEO 신호 비교 (7개)</div>
  <table class="compare-diff-table">
    <thead><tr><th>항목</th><th>${esc(short(userDomain))}</th><th>${esc(short(cDomain))}</th><th>판정</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderSchemaDiff(sd, userDomain, cDomain) {
  if (!sd) return '';
  const ox = (b) => b ? '<span class="diff-status ok">O</span>' : '<span class="diff-status fail">X</span>';
  const fieldRows = (sd.fields || []).map((f) => `<tr class="${f.verdict === 'gap' ? 'diff-gap' : ''}">
    <td class="diff-item">${esc(f.label)}</td>
    <td class="diff-cell">${ox(f.userHas)}</td>
    <td class="diff-cell">${ox(f.compHas)}</td>
  </tr>`).join('');
  const ar = sd.aggregateRating || {};
  const arText = (a) => a ? esc(`${a.value || '?'}★ / ${a.count != null ? a.count + '건' : '?'}`) : '<span class="diff-status fail">X</span>';
  const arLine = (ar.user || ar.comp)
    ? `<tr><td class="diff-item">별점 스키마 (AggregateRating)</td><td class="diff-cell">${arText(ar.user)}</td><td class="diff-cell">${arText(ar.comp)}</td></tr>`
    : '';
  const faq = sd.faqCount || {};
  const faqLine = (faq.user || faq.comp)
    ? `<tr><td class="diff-item">FAQ 질문 수</td><td class="diff-cell">${faq.user || 0}</td><td class="diff-cell">${faq.comp || 0}</td></tr>`
    : '';
  const typeLine = `<div class="diff-types">
    <div><b>${esc(short(userDomain))}</b> · ${(sd.userTypes || []).length ? esc((sd.userTypes).slice(0, 8).join(', ')) : '<span class="diff-none">JSON-LD 없음</span>'}</div>
    <div><b>${esc(short(cDomain))}</b> · ${(sd.compTypes || []).length ? esc((sd.compTypes).slice(0, 8).join(', ')) : '<span class="diff-none">JSON-LD 없음</span>'}</div></div>`;
  return `<div class="compare-section-head" style="margin-top:20px">② 구조화 데이터(JSON-LD) 필드 비교 — "어떤 코드가 있나"</div>
    ${typeLine}
    <table class="compare-diff-table">
      <thead><tr><th>스키마 필드</th><th>${esc(short(userDomain))}</th><th>${esc(short(cDomain))}</th></tr></thead>
      <tbody>${fieldRows}${arLine}${faqLine}</tbody>
    </table>`;
}

function renderMetaContentDiff(pkg, userDomain, cDomain) {
  const md = pkg.metaDiff || [];
  const cd = pkg.contentDiff || [];
  const trunc = (s, n = 44) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  const metaRows = md.map((r) => {
    const val = (v, len) => v ? `${esc(trunc(v))}${len ? ` <span class="diff-len">${len}자</span>` : ''}` : '<span class="diff-none">없음</span>';
    return `<tr class="${r.verdict === 'gap' ? 'diff-gap' : ''}">
      <td class="diff-item">${esc(r.label)}</td>
      <td class="diff-cell-l">${r.warnUser ? '⚠ ' : ''}${val(r.user, r.userLen)}</td>
      <td class="diff-cell-l">${val(r.comp, r.compLen)}</td>
    </tr>`;
  }).join('');
  const contentRows = cd.map((r) => {
    const fmt = (v) => r.kind === 'bool' ? (v ? '<span class="diff-status ok">O</span>' : '<span class="diff-status fail">X</span>') : esc(String(v));
    return `<tr class="${r.verdict === 'gap' ? 'diff-gap' : ''}">
      <td class="diff-item">${esc(r.label)}</td>
      <td class="diff-cell">${fmt(r.user)}</td>
      <td class="diff-cell">${fmt(r.comp)}</td>
    </tr>`;
  }).join('');
  return `<div class="compare-section-head" style="margin-top:20px">③ 메타·본문 구조 비교</div>
    <table class="compare-diff-table">
      <thead><tr><th>메타</th><th>${esc(short(userDomain))}</th><th>${esc(short(cDomain))}</th></tr></thead>
      <tbody>${metaRows}</tbody>
    </table>
    <table class="compare-diff-table" style="margin-top:8px">
      <thead><tr><th>본문·구조</th><th>${esc(short(userDomain))}</th><th>${esc(short(cDomain))}</th></tr></thead>
      <tbody>${contentRows}</tbody>
    </table>`;
}

function renderPlanTable(pkg) {
  const rows = pkg.planRows || [];
  if (!rows.length) {
    return `<div class="compare-section-head" style="margin-top:22px">④ 개선 계획표</div>
      <p class="muted small">측정 대상이 비교 항목에서 모두 통과했습니다. 외부 언급(블로그·기고) 축적이 다음 단계입니다.</p>`;
  }
  const prodName = (id) => { const p = PRODUCTS.find((x) => x.id === id); return p ? p.name : id; };
  const body = rows.map((r) => {
    const chips = (r.productIds || []).map((id) => `<span class="plan-prod-chip" data-add-product="${esc(id)}">${esc(prodName(id))}</span>`).join('');
    return `<tr class="${r.compAhead ? 'diff-gap' : ''}">
      <td class="plan-pri">${r.priority}</td>
      <td class="plan-item"><b>${esc(r.item)}</b>${r.detail ? `<div class="plan-detail">${esc(r.detail)}</div>` : ''}</td>
      <td class="plan-now">${esc(r.current)}</td>
      <td class="plan-target">${esc(r.target)}<div class="plan-effect">${esc(r.effectLabel)}</div></td>
      <td><span class="plan-badge plan-diff-${esc(r.difficulty)}">${esc(r.difficulty)}</span></td>
      <td class="plan-prods">${chips}</td>
    </tr>`;
  }).join('');
  const recIds = pkg.recommendedProductIds || [];
  const addBtn = recIds.length
    ? `<button type="button" class="btn p compare-add-btn" data-add-products="${esc(recIds.join(','))}">개선 담당 상품 ${recIds.length}개 문의에 담기</button>`
    : '';
  return `<div class="compare-section-head" style="margin-top:22px">④ 개선 계획표 — 우선순위 + 담당 상품</div>
    <div class="compare-plan-wrap">
    <table class="compare-plan-table">
      <thead><tr><th>#</th><th>항목</th><th>현재</th><th>목표 액션</th><th>난이도</th><th>담당 상품</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
    </div>
    ${addBtn}`;
}

// 비교 격차 기반 솔루션 추천 + 구매 유도 CTA (클릭 → 문의에 담김)
function renderSolutionCTA(pkg) {
  const gapKeys = new Set((pkg.planRows || []).map((r) => r.key));
  let recs = SOLUTIONS.filter((s) => s.keys.some((k) => gapKeys.has(k)));
  if (!recs.length) recs = SOLUTIONS; // 격차 없으면 전체 노출
  const cards = recs.map((s) => {
    const p = PRODUCTS.find((x) => x.id === s.id) || { name: s.id, desc: '' };
    return `<div class="solution-card">
      <div class="solution-body">
        <div class="solution-name">${esc(p.name)}</div>
        <div class="solution-desc">${esc(p.desc)}</div>
      </div>
      <button type="button" class="btn p solution-cta" data-add-products="${esc(s.id)}">상담 신청 →</button>
    </div>`;
  }).join('');
  return `<div class="compare-section-head" style="margin-top:24px">💎 추천 솔루션 — 이렇게 해결하세요</div>
    <p class="muted small" style="margin:0 0 10px">발견된 격차를 메우는 메디앤메디 솔루션입니다. 구조 위생 개선 · AI 인용 예측 아님.</p>
    <div class="solution-grid">${cards}</div>`;
}

function renderTeardown(td, userDomain, cDomain) {
  if (!td || (!td.user && !td.comp)) return '';
  return `<div class="compare-section-head" style="margin-top:22px">⑤ HTML 원본 분해 — 메타·스키마·본문</div>
    <div class="compare-code-cols">
      <div class="compare-code-box">
        <div class="compare-code-header compare-tag-user">📍 ${esc(short(userDomain))}</div>
        <pre class="compare-pre">${formatTeardown(td.user, userDomain)}</pre>
      </div>
      <div class="compare-code-box">
        <div class="compare-code-header compare-tag-comp">🏆 ${esc(short(cDomain))} (AI 인용됨)</div>
        <pre class="compare-pre">${formatTeardown(td.comp, cDomain)}</pre>
      </div>
    </div>`;
}

function renderResultHeader(scoreRes, citeRes, q) {
  const d = (citeRes && citeRes.d) || {};
  const domain = d.clinicDomain || lastUrl.replace(/^https?:\/\//,'').split('/')[0];
  const sd = scoreRes && scoreRes.d;
  const score = sd ? sd.score : null;
  const band  = sd ? sd.band : null;
  const bandColor = sd ? (sd.score >= 70 ? '#1fcec4' : sd.score >= 40 ? '#c9a84c' : '#f05e6a') : 'var(--text-2)';

  const prevScore = sd ? (sd.prevScore ?? null) : null;
  const delta = (prevScore != null && score != null) ? (score - prevScore) : null;
  const deltaHtml = delta == null ? '' : delta === 0
    ? `<div style="font-size:.72rem;font-weight:700;margin-top:4px;color:var(--text-2)">전회 동점</div>`
    : `<div style="font-size:.72rem;font-weight:800;margin-top:4px;color:${delta > 0 ? 'var(--teal)' : '#f05e6a'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}pt</div>`;

  const scoreBlock = score != null ? `
    <div class="result-dash-score">
      <div class="result-dash-score-num">${score}</div>
      ${deltaHtml}
      <div style="font-size:.65rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-top:3px">GEO 준비도</div>
      <div style="font-size:.9rem;font-weight:700;color:${bandColor};margin-top:6px">${esc(band)}</div>
    </div>` : '';

  const engRows = Array.isArray(d.perEngine) ? d.perEngine.map((p) => {
    const logo = ENGINE_LOGO[p.engine] || '';
    const name = ENGINE_SHORT[p.engine] || p.engine;
    if (!p.measured) return `<div class="result-dash-engine-row">${logo}<span class="rdname">${esc(name)}</span><span style="color:var(--text-2);font-size:.8rem">—</span></div>`;
    const named = p.namedRuns || 0;
    const color = p.cited ? 'var(--teal)' : named ? 'var(--gold-2,#e6a817)' : 'var(--text-2)';
    const icon  = p.cited ? '✅' : named ? '🟡' : '❌';
    const stat  = p.cited ? `${p.citedRuns}/${p.validRuns}회` : named ? `이름언급 ${named}회` : '미인용';
    return `<div class="result-dash-engine-row">${logo}<span class="rdname">${esc(name)}</span><span style="font-weight:700;color:${color};font-size:.82rem">${icon} ${esc(stat)}</span></div>`;
  }).join('') : '';

  // ── 강한 결론 한 줄 (hero) ──
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  const measuredAny = eng.some((p) => p.measured);
  const citedNames = eng.filter((p) => p.cited).map((p) => ENGINE_SHORT[p.engine] || p.engine);
  const namedNames = eng.filter((p) => !p.cited && (p.namedRuns || 0) > 0).map((p) => ENGINE_SHORT[p.engine] || p.engine);
  const verdictLine = (eng.length && measuredAny)
    ? (citedNames.length
        ? `<div class="result-verdict ok"><span class="rv-icon">✅</span><span class="rv-text"><b>AI 추천됨</b> — ${esc(citedNames.join('·'))}에 이 치과가 인용되고 있습니다.</span></div>`
        : namedNames.length
          ? `<div class="result-verdict warn" style="background:rgba(230,168,23,.08);border-color:rgba(230,168,23,.25)"><span class="rv-icon">🟡</span><span class="rv-text"><b>이름 언급됨</b> — ${esc(namedNames.join('·'))}이 답변에서 이 치과를 언급했지만 링크 인용은 없습니다.</span></div>`
          : `<div class="result-verdict bad"><span class="rv-icon">❌</span><span class="rv-text"><b>AI 미추천</b> — ChatGPT·Perplexity 추천 목록에 이 치과가 없습니다. 아래 '② 진단'에서 무엇이 부족한지 확인하세요.</span></div>`)
    : '';

  return `${verdictLine}<div class="result-dash">
    ${scoreBlock}
    <div class="result-dash-info">
      <div class="result-dash-domain"><a class="result-dash-link" href="${esc(lastUrl || ('https://'+domain))}" target="_blank" rel="noopener noreferrer">${esc(domain)}<span style="font-size:.7em;margin-left:3px;opacity:.5">↗</span></a></div>
      <div class="result-dash-region">${esc(q.region || '')} · ${esc(q.procedure || '')} · AI 추천 실측</div>
    </div>
    ${engRows ? `<div class="result-dash-engines">${engRows}</div>` : ''}
  </div>`;
}

const ENGINE_LOGO = {
  chatgpt: `<span class="engine-logo logo-chatgpt" title="ChatGPT">G</span>`,
  perplexity: `<span class="engine-logo logo-perplexity" title="Perplexity">P</span>`,
  claude: `<span class="engine-logo logo-claude" title="Claude">C</span>`,
};
const ENGINE_SHORT = { chatgpt: 'ChatGPT', perplexity: 'Perplexity', claude: 'Claude' };

function renderNaverLocal(d) {
  const nl = d && d.naverLocal;
  if (!nl) return '';
  const icon = nl.cited ? '✅' : '❌';
  const label = nl.cited
    ? `Naver 지역 검색 ${nl.rank}위 (상위 5개 내 노출)`
    : `Naver 지역 검색 상위 5개 미노출`;
  const color = nl.cited ? '#1fcec4' : 'var(--text-2)';
  return `<div style="margin-top:14px;padding:12px 16px;background:rgba(3,199,90,.05);border:1px solid rgba(3,199,90,.15);border-radius:10px;display:flex;gap:10px;align-items:center">
    <span style="font-size:1.1rem">${icon}</span>
    <div>
      <div style="font-size:.88rem;font-weight:700;color:${color}">${label}</div>
      <div class="muted small">검색어: "${esc(nl.query)}" · Naver 로컬 검색 (AI 브리핑/CUE: 아님)</div>
    </div>
  </div>`;
}

function renderCitation(citeRes) {
  if (!citeRes) return card('AI 실측', '<p class="muted">인용 측정에 실패했습니다.</p>');
  const d = citeRes.d || {};
  if (d.status === 'pending') return card('AI 실측 — 비활성', `<p class="muted">${esc(d.message || 'CITATION_ENABLED 키 필요.')}</p>`);
  if (d.status === 'cap-reached') return card('AI 실측 — 한도 소진', `<p class="muted">${esc(d.message || '오늘 한도 소진.')}</p>`);
  if (d.byRegion && Array.isArray(d.regions)) return renderRegionHitmap(d);
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  if (!eng.length) return card('AI 실측', '<p class="muted">측정 결과 없음.</p>');

  const logos = eng.map((p) => ENGINE_LOGO[p.engine] || '').filter(Boolean).join('');
  const maxReps = eng.reduce((m, p) => Math.max(m, p.validRuns || 0), 0);
  const repsNote = maxReps > 1 ? `쿼리당 ${maxReps}회 평균` : '쿼리당 1회 측정 (오차 큼)';
  const note = `<p class="muted small" style="margin-top:12px;text-align:center">
    측정 엔진: <b>gpt-4o API</b> · <b>sonar API</b> · ${esc(repsNote)} —
    ChatGPT·Perplexity <b>앱 직접 검색과 모델·버전이 달라 결과 차이 있을 수 있음</b> ·
    <b>환자 광고에 "추천·인증·1위"로 인용 금지(의료광고법)</b>
  </p>`;
  const urlMatchHtml = d.citedUrlMatch ? renderCitedUrlMatch(d.citedUrlMatch) : '';

  const TH_LABEL = 'padding:11px 16px;font-size:.72rem;font-weight:700;color:var(--text-2);text-align:left;white-space:nowrap;border-right:1px solid var(--border);background:rgba(255,255,255,.02)';
  const TD_LABEL = 'padding:12px 16px;font-size:.72rem;font-weight:700;color:var(--text-2);white-space:nowrap;border-right:1px solid var(--border);background:rgba(255,255,255,.02);vertical-align:middle';

  // Header: engine logos + names as columns
  const engHeaders = eng.map((p) => {
    const logo = ENGINE_LOGO[p.engine] || '';
    const name = ENGINE_SHORT[p.engine] || p.engine;
    const accent = p.cited ? '#1fcec4' : 'var(--text-2)';
    const borderAccent = p.cited ? 'border-bottom:2px solid #1fcec4' : 'border-bottom:2px solid rgba(255,255,255,.1)';
    return `<th style="padding:11px 20px;font-size:.85rem;font-weight:700;color:${accent};text-align:center;${borderAccent}">${logo} ${esc(name)}</th>`;
  }).join('');

  // Row 1 — AI 추천 결과
  const resultCells = eng.map((p) => {
    if (!p.measured) return `<td style="padding:16px 20px;text-align:center;color:var(--text-2)"><div style="font-size:.9rem">—</div><div style="font-size:.72rem;margin-top:3px">측정불가</div></td>`;
    if (p.cited) return `<td style="padding:16px 20px;text-align:center;background:rgba(31,206,196,.06)">
      <div style="font-size:1.4rem;line-height:1">✅</div>
      <div style="font-size:.88rem;font-weight:700;color:#1fcec4;margin-top:5px">${p.citedRuns}/${p.validRuns}회 인용</div>
      <div style="font-size:.73rem;color:#1fcec4;margin-top:2px;opacity:.8">AI가 추천했습니다</div>
    </td>`;
    const named = p.namedRuns || 0;
    if (named > 0) return `<td style="padding:16px 20px;text-align:center;background:rgba(230,168,23,.06)">
      <div style="font-size:1.4rem;line-height:1">🟡</div>
      <div style="font-size:.88rem;font-weight:700;color:#e6a817;margin-top:5px">이름 언급 ${named}회</div>
      <div style="font-size:.73rem;color:#e6a817;margin-top:2px;opacity:.8">링크 인용 없음</div>
    </td>`;
    return `<td style="padding:16px 20px;text-align:center">
      <div style="font-size:1.4rem;line-height:1">❌</div>
      <div style="font-size:.88rem;color:var(--text-2);margin-top:5px">0/${p.validRuns}회 인용</div>
      <div style="font-size:.73rem;color:var(--text-2);margin-top:2px;opacity:.7">미추천</div>
    </td>`;
  }).join('');

  // Row 2 — 대신 추천된 경쟁 도메인 (클릭 → 심층 비교: 무엇이 부족한지)
  const compCells = eng.map((p) => {
    const comp = (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain);
    if (!p.measured || !comp.length) return `<td style="padding:14px 20px;text-align:center;color:rgba(255,255,255,.2);font-size:.82rem">—</td>`;
    const links = comp.slice(0, 6).map((x) => {
      const href = /^https?:\/\//.test(x) ? x : `https://${x}`;
      return `<a class="comp-link" href="${esc(href)}" target="_blank" rel="noopener" data-compare="${esc(x)}"
        style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:5px;word-break:break-all"><span>${esc(x)}</span><span style="color:var(--plum);font-weight:700;white-space:nowrap;font-size:.72rem">비교 →</span></a>`;
    }).join('');
    return `<td style="padding:14px 20px;vertical-align:top">${links}</td>`;
  }).join('');

  // narrative: not recommended → THESE 3 homepages WERE → friendly invite to compare
  const anyNotCited = eng.some((p) => p.measured && !p.cited);
  const recHomes = [...new Set(eng.flatMap((p) => (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain)))].slice(0, 3);
  const qLabel = [d.region, d.procedure].filter(Boolean).join(' ');
  const compareHint = (recHomes.length && anyNotCited)
    ? `<div class="compare-invite">
        <div class="compare-invite-head">🔍 경쟁 병원 홈페이지, 비교해보시겠어요?</div>
        <p class="compare-invite-sub">AI가 ${qLabel ? `"${esc(qLabel)} 치과 추천"` : '이 검색'}에서 <b>실제로 추천한 홈페이지 ${recHomes.length}곳</b>입니다. 클릭하면 우리 홈페이지를 나란히 띄우고 코드를 뜯어 <b>무엇이 다른지</b> 한눈에 보여드립니다.</p>
        <div class="compare-invite-list">
          ${recHomes.map((x, i) => { const href = /^https?:\/\//.test(x) ? x : `https://${x}`; return `<a class="compare-invite-item" href="${esc(href)}" target="_blank" rel="noopener" data-compare="${esc(x)}"><span class="ci-rank">${i + 1}</span><span class="ci-domain">${esc(x)}</span><span class="ci-cta">비교 분석 →</span></a>`; }).join('')}
        </div>
      </div>`
    : '';

  const colgroup = `<colgroup><col style="width:72px">${eng.map(() => '<col>').join('')}</colgroup>`;

  const table = `<div style="overflow-x:auto;margin-top:14px;border-radius:10px;border:1px solid var(--border)">
    <table class="engine-htable">
      ${colgroup}
      <thead>
        <tr>
          <th style="${TH_LABEL}">구분</th>
          ${engHeaders}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="${TD_LABEL}">AI 추천</td>
          ${resultCells}
        </tr>
        <tr>
          <td style="${TD_LABEL}">대신<br>추천됨</td>
          ${compCells}
        </tr>
      </tbody>
    </table>
  </div>`;

  return `<div class="card gate" style="margin-top:16px">
    <div class="engine-title-row">
      <div class="engine-title-logos">${logos}</div>
      <b style="font-size:1rem">AI 실측 — 이 치과를 실제로 추천하나요?</b>
    </div>
    ${table}
    ${compareHint}
    ${renderCitationAnswers(eng, d.clinicDomain)}
    ${renderNaverLocal(d)}
    ${urlMatchHtml}
    ${note}
  </div>`;
}

// Operator-only: show the ACTUAL ChatGPT/Perplexity answer text per query (collapsible).
function renderCitationAnswers(eng, clinicDomain) {
  const withAnswers = (eng || []).filter((p) => Array.isArray(p.sampleAnswers) && p.sampleAnswers.length);
  if (!withAnswers.length) return '';
  const blocks = withAnswers.map((p) => {
    const name = ENGINE_SHORT[p.engine] || p.engine;
    const logo = ENGINE_LOGO[p.engine] || '';
    const items = p.sampleAnswers.map((a) => {
      const badge = a.cited
        ? '<span style="color:#1fcec4;font-weight:700">✅ 이 치과 언급됨</span>'
        : '<span style="color:var(--text-2)">이 치과 미언급</span>';
      return `<div style="margin-bottom:14px">
        <div style="font-size:.78rem;color:var(--text-2);margin-bottom:5px">💬 "${esc(a.prompt)}" · ${badge}</div>
        <div style="font-size:.82rem;line-height:1.65;color:var(--text-1);white-space:pre-wrap;word-break:break-word;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;padding:11px 13px;max-height:320px;overflow:auto">${esc(a.answer || '(빈 응답)')}</div>
      </div>`;
    }).join('');
    return `<div class="accordion-wrap" style="margin-top:8px">
      <button type="button" class="accordion-btn" onclick="this.closest('.accordion-wrap').classList.toggle('open')">
        <span>${logo} ${esc(name)} — 실제 답변 보기 (${p.sampleAnswers.length}개 질의)</span><span class="accordion-arrow">▼</span>
      </button>
      <div class="accordion-body">${items}</div>
    </div>`;
  }).join('');
  return `<div style="margin-top:16px">
    <div class="compare-section-head" style="margin-bottom:4px">🔎 AI 답변 원문 — 실제로 무엇을 추천했나</div>
    <p class="muted small" style="margin:0 0 8px">ChatGPT·Perplexity가 각 질의에 실제로 생성한 답변입니다(운영자 전용). 환자 광고에 인용 금지 — 의료광고법.</p>
    ${blocks}
  </div>`;
}

function renderCitedUrlMatch(m) {
  if (!m) return '';
  const ICON = { exact: '✅', domain: '⚠️', none: '❌' };
  const LABEL = {
    exact: '목표 페이지 직접 인용됨',
    domain: '홈/다른 페이지 인용 (목표 페이지 아님)',
    none: '목표 페이지 미인용',
  };
  const icon = ICON[m.match] || '—';
  const label = LABEL[m.match] || esc(m.match);
  const pathsHtml = m.citedPaths && m.citedPaths.length
    ? `인용된 경로: <code style="font-size:.75rem">${m.citedPaths.map(esc).join(', ')}</code>`
    : '';
  return `<div style="border-top:1px solid var(--border,rgba(255,255,255,.07));margin-top:14px;padding-top:12px;text-align:center">
    <div style="font-size:.9rem;font-weight:700;margin-bottom:4px">${icon} ${label}</div>
    <div class="muted" style="font-size:.8rem">입력 경로: <code style="font-size:.75rem">${esc(m.inputPath)}</code>&nbsp;&nbsp;${pathsHtml}</div>
  </div>`;
}

function renderRegionHitmap(d) {
  const regions = d.regions || [];
  const byRegion = d.byRegion || {};
  // Collect all engine keys that appear across any region
  const engineSet = new Set();
  for (const r of regions) {
    for (const e of (byRegion[r]?.perEngine || [])) engineSet.add(e.engine);
  }
  const engines = [...engineSet];

  const CELL_STYLE = {
    cited: 'background:rgba(31,206,196,.15);color:#1fcec4',
    notCited: 'background:rgba(240,94,106,.10);color:#f05e6a',
    unmeasured: 'background:rgba(255,255,255,.05);color:#8da0bb',
  };

  const headerCols = engines.map((e) => `<th style="padding:6px 10px;font-size:.78rem;font-weight:600;color:var(--text-2)">${esc(ENGINE_SHORT[e] || e)}</th>`).join('');
  const rows = regions.map((r) => {
    const panel = byRegion[r] || {};
    if (panel.error) {
      const errCell = `<td colspan="${engines.length}" style="padding:6px 10px;font-size:.8rem;color:#f05e6a">오류: ${esc(panel.error)}</td>`;
      return `<tr><th style="padding:6px 10px;font-size:.85rem;font-weight:600;white-space:nowrap">${esc(r)}</th>${errCell}</tr>`;
    }
    const cells = engines.map((e) => {
      const ep = (panel.perEngine || []).find((x) => x.engine === e);
      if (!ep || !ep.measured) {
        return `<td style="padding:6px 10px;text-align:center;${CELL_STYLE.unmeasured}">—</td>`;
      }
      const icon = ep.cited ? '✅' : '❌';
      const stat = `${ep.citedRuns}/${ep.validRuns}`;
      const style = ep.cited ? CELL_STYLE.cited : CELL_STYLE.notCited;
      return `<td style="padding:6px 10px;text-align:center;${style}"><span style="font-size:1rem">${icon}</span><div style="font-size:.7rem;margin-top:2px">${stat}</div></td>`;
    }).join('');
    return `<tr><th style="padding:6px 10px;font-size:.85rem;font-weight:600;white-space:nowrap">${esc(r)}</th>${cells}</tr>`;
  }).join('');

  const table = `<div style="overflow-x:auto;margin-top:10px">
    <table style="width:100%;border-collapse:collapse;border-spacing:0">
      <thead><tr><th style="padding:6px 10px;text-align:left;font-size:.78rem;color:var(--text-2)">지역</th>${headerCols}</tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;

  const costHtml = d.costNote
    ? `<p class="muted small" style="margin-top:10px;text-align:right">${esc(d.costNote)}</p>`
    : '';
  const note = `<p class="muted small" style="margin-top:6px;text-align:center">개발자 API 기준 · 일반 앱과 다를 수 있음 · <b>환자 광고에 "추천·인증·1위"로 인용 금지(의료광고법)</b></p>`;
  return `<div class="card gate">
    <b style="font-size:1rem">AI 실측 — 지역별 인용 현황 (${regions.length}개 지역)</b>
    ${table}
    ${costHtml}
    ${note}
  </div>`;
}

function renderImprovements(scoreRes) {
  const fixes = (scoreRes && scoreRes.d && scoreRes.d.topFixes) || [];
  const TH = 'padding:8px 10px;font-size:.75rem;font-weight:700;color:var(--text-2);border-bottom:1px solid var(--border,rgba(255,255,255,.07));text-align:left;white-space:nowrap';
  const TD = 'padding:8px 10px;font-size:.85rem;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top';

  const provenRow = `<tr style="background:rgba(31,206,196,.05)">
    <td style="${TD};text-align:center;font-weight:800;color:var(--teal)">1</td>
    <td style="${TD}"><span style="font-weight:700">콘텐츠에 출처·통계·전문의 인용 추가</span>
      <div style="font-size:.78rem;color:var(--text-2);margin-top:3px">진료 페이지 본문에 "연구에 따르면…", 의료진 자격·경력, 실제 수치를 넣습니다</div>
    </td>
    <td style="${TD};white-space:nowrap"><span class="action-tag tag-proven">인과 입증 레버</span></td>
    <td style="${TD};text-align:right;color:var(--teal);font-weight:700">최우선</td>
  </tr>`;

  const hygieneRows = fixes.map((f, i) => `<tr>
    <td style="${TD};text-align:center;color:var(--text-2)">${i + 2}</td>
    <td style="${TD}"><span style="font-weight:600">${esc(f.fix)}</span>
      <div style="font-size:.78rem;color:var(--text-2);margin-top:3px">${esc(f.note || '검색엔진·AI 크롤러가 사이트를 더 잘 읽을 수 있게 됩니다.')}</div>
    </td>
    <td style="${TD};white-space:nowrap"><span class="action-tag tag-hygiene">위생</span></td>
    <td style="${TD};text-align:right;color:var(--gold-2);font-weight:700">+${f.gain}점</td>
  </tr>`).join('');

  const table = `<div style="overflow-x:auto;margin-top:10px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${TH};text-align:center;width:32px">#</th>
        <th style="${TH}">실행 항목</th>
        <th style="${TH}">유형</th>
        <th style="${TH};text-align:right">효과</th>
      </tr></thead>
      <tbody>${provenRow}${hygieneRows}</tbody>
    </table>
  </div>
  <p class="muted small" style="margin-top:8px">1번이 AI 인용에 가장 직접적인 영향을 줍니다. 2번 이하는 홈페이지 구조 개선이며 인용을 직접 보장하지 않습니다.</p>`;

  return `<div class="card"><b style="font-size:1rem">개선 실행 목록</b>${table}</div>`;
}

function renderAgentActionability(scoreRes) {
  const a = scoreRes && scoreRes.d && scoreRes.d.agentActionability;
  return agentCardHtml(a, { esc, card });
}

function renderHygiene(scoreRes) {
  if (!scoreRes || !scoreRes.ok) {
    const reason = scoreRes && scoreRes.d && (scoreRes.d.reason || scoreRes.d.message);
    return card('GEO 준비도 분석', `<p class="muted">${reason ? esc(reason) : '분석 불가'}</p>`);
  }
  const d = scoreRes.d;
  const s = d.signals || {};
  const j = d.jsonld || {};
  const pctVal = Math.round((d.score / 100) * 100);
  const bandLabel = d.score >= 70 ? '양호' : d.score >= 40 ? '개선 필요' : '시급';
  const bandColor = d.score >= 70 ? 'var(--teal)' : d.score >= 40 ? 'var(--gold-2)' : '#f05e6a';

  const LAYER_STYLE = {
    SEO: 'background:#1a3a5c;color:#7ab8f5',
    AEO: 'background:#0f3a35;color:#1fcec4',
    GEO: 'background:#3a2a00;color:#c9a84c',
  };
  const badge = (layer) => {
    const s = layer && LAYER_STYLE[layer] ? LAYER_STYLE[layer] : '';
    return s ? `<span style="display:inline-block;font-size:.62rem;font-weight:700;padding:1px 5px;border-radius:3px;${s}">${esc(layer)}</span>` : '';
  };

  const TH = 'padding:8px 10px;font-size:.75rem;font-weight:700;color:var(--text-2);border-bottom:1px solid var(--border,rgba(255,255,255,.07));text-align:left;white-space:nowrap';
  const TD = 'padding:8px 10px;font-size:.85rem;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top';
  const statusCell = (ok, warn) => {
    if (ok)   return `<td style="${TD};color:#1fcec4;font-weight:700;text-align:center">✓</td>`;
    if (warn) return `<td style="${TD};color:#c9a84c;font-weight:700;text-align:center">!</td>`;
    return           `<td style="${TD};color:#f05e6a;font-weight:700;text-align:center">✗</td>`;
  };

  // ── Section 1: 기술 위생 ──────────────────────────────────────
  const hygieneRows = (d.breakdown || []).map((x) => `<tr>
    <td style="${TD}">${esc(x.label)} ${badge(x.layer)}</td>
    ${statusCell(x.status === 'ok', x.status === 'warn')}
    <td style="${TD};text-align:right;color:var(--text-2);white-space:nowrap">${x.points}/${x.max}</td>
    <td style="${TD};color:var(--text-2);font-size:.78rem">${x.why ? esc(x.why) : ''}</td>
  </tr>`).join('');

  // ── Section 2: 콘텐츠 인용성 신호 ───────────────────────────
  const geoSigs = [
    { val: s.hasStatistics,      label: '수치·통계 ≥2개',               layer: 'GEO', note: 'AI 인용 +33% (KDD 2024)' },
    { val: s.hasQuotations,      label: '인용문 (blockquote·따옴표)',    layer: 'GEO', note: 'AI 인용 +41% (KDD 2024)' },
    { val: s.hasCitedSources,    label: '출처 표기 (cite·[1]·참고문헌)', layer: 'GEO', note: 'AI 인용 +27% (KDD 2024)' },
    { val: j.hasSameAsAuthority, label: 'SameAs 권위 URL',               layer: 'AEO', note: 'Wikidata·건강보험공단·의협' },
    { val: j.hasAggregateRating, label: 'AggregateRating 스키마',        layer: 'AEO', note: '리뷰 점수 구조화' },
    { val: j.hasMedicalWebPage,  label: 'MedicalWebPage 스키마',         layer: 'AEO', note: '의료 페이지 타입 명시' },
  ];
  const geoRows = geoSigs.map((x) => `<tr>
    <td style="${TD}">${esc(x.label)} ${badge(x.layer)}</td>
    ${statusCell(x.val, false)}
    <td style="${TD};text-align:right;color:var(--text-2);font-size:.75rem;white-space:nowrap">참고</td>
    <td style="${TD};color:var(--text-2);font-size:.78rem">${esc(x.note)}</td>
  </tr>`).join('');

  // ── Section 3: 추가 메타 ─────────────────────────────────────
  const metaSigs = [
    { val: d.hasLlmsTxt,    label: 'llms.txt',        layer: 'GEO', note: 'AI 전용 색인 파일 (Google 공식 미지원 — 참고용)' },
    { val: d.hasMapEmbed,   label: 'Google Maps 삽입', layer: 'SEO', note: '위치 신호 강화' },
    { val: d.hasPriceInfo,  label: '비급여 가격 안내', layer: 'AEO', note: '가격 키워드 감지' },
  ];
  const metaRows = metaSigs.map((x) => `<tr>
    <td style="${TD}">${esc(x.label)} ${badge(x.layer)}</td>
    ${statusCell(x.val, false)}
    <td style="${TD};text-align:right;color:var(--text-2);font-size:.75rem;white-space:nowrap">참고</td>
    <td style="${TD};color:var(--text-2);font-size:.78rem">${esc(x.note)}</td>
  </tr>`).join('');

  const sectionHead = (text) =>
    `<tr><td colspan="4" style="padding:10px 10px 4px;font-size:.72rem;font-weight:700;color:var(--text-2);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid var(--border,rgba(255,255,255,.07))">${text}</td></tr>`;

  const table = `<div style="overflow-x:auto;margin-top:14px">
    <table style="width:100%;border-collapse:collapse">
      <thead><tr>
        <th style="${TH}">항목</th>
        <th style="${TH};text-align:center">상태</th>
        <th style="${TH};text-align:right">점수</th>
        <th style="${TH}">설명</th>
      </tr></thead>
      <tbody>
        ${sectionHead('기술 위생 (크롤러·AI 접근성)')}
        ${hygieneRows}
        ${sectionHead('콘텐츠 인용성 신호')}
        ${geoRows}
        ${sectionHead('추가 메타')}
        ${metaRows}
      </tbody>
    </table>
  </div>
  <p class="muted small" style="margin-top:8px">축A 기술 준비도(crawl·schema·extract·local) + 축B 콘텐츠 인용성(eeat·fresh·answer) = 합산 점수. 이 점수는 AI 인용 가능성을 예측하지 않습니다.</p>`;

  // 두 축 표시 (v0.2+): axes 없으면 조용히 생략 (구 엔트리 하위 호환)
  let axesBar = '';
  if (d.axes && d.axes.tech && d.axes.content) {
    const { tech, content } = d.axes;
    axesBar = `<div style="display:flex;gap:14px;margin:8px 0 4px;flex-wrap:wrap">
      <div style="font-size:.78rem;color:var(--text-2)">축A 기술 준비도 <b style="color:var(--text-1)">${tech.score}/${tech.max}</b></div>
      <div style="font-size:.78rem;color:var(--text-2)">축B 콘텐츠 인용성 <b style="color:var(--text-1)">${content.score}/${content.max}</b></div>
    </div>`;
  }

  const scoreBar = `<div style="display:flex;align-items:center;gap:10px;margin:10px 0 6px">
    <div class="score-bar-wrap" style="flex:1"><div class="score-bar-fill" data-pct="${pctVal}" style="width:0%"></div></div>
    <span style="font-size:.8rem;font-weight:700;color:${bandColor};flex-shrink:0">${d.score}pt · ${bandLabel}</span>
  </div>${axesBar}`;

  return `<div class="card"><b style="font-size:1rem">GEO 준비도 세부 분석</b>${scoreBar}${table}</div>`;
}

function card(title, bodyHtml, cls) {
  return `<div class="card ${cls || ''}"><b style="font-size:1rem">${esc(title)}</b><div style="margin-top:8px">${bodyHtml}</div></div>`;
}

// ── 측정 이력 ────────────────────────────────────────────────────
async function fetchAndRenderHistory(url) {
  try {
    const domain = url.replace(/^https?:\/\//, '').split('/')[0];
    const key = localStorage.getItem('opKey') || '';
    const r = await fetch(`/api/history?domain=${encodeURIComponent(domain)}`, {
      headers: { 'x-operator-key': key },
    });
    if (!r.ok) return;
    const data = await r.json();
    const { scoreHistory = [], citationHistory = [], backedByKv } = data;
    if (!scoreHistory.length && !citationHistory.length) return;
    const sec = $('historySection');
    if (!sec) return;
    sec.innerHTML = renderHistorySection(scoreHistory, citationHistory, backedByKv);
    show('historySection');
  } catch { /* 이력 없으면 조용히 스킵 */ }
}

// ── Naver Place 현황 ────────────────────────────────────────────
let _naverAbort = null;

async function loadNaverPlace(q) {
  const sec = $('naverSection');
  if (!sec) return;
  const key = localStorage.getItem('opKey') || '';
  const region = (q.region || '').split('·')[0].trim();
  const procedure = (q.procedure || '').trim();
  if (!region || !procedure) return;

  const clinicName = (lastScoreRes && lastScoreRes.d && lastScoreRes.d.clinicNameGuess) || '';
  const clinicPhone = (lastScoreRes && lastScoreRes.d && lastScoreRes.d.phone) || '';

  _naverAbort?.abort();
  _naverAbort = new AbortController();

  sec.innerHTML = `<div class="naver-place-card"><p class="muted small" style="display:flex;align-items:center;gap:8px"><span class="spin"></span>네이버 플레이스 조회 중...</p></div>`;
  show('naverSection');

  try {
    const r = await fetch('/api/naver-place', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-key': key },
      body: JSON.stringify({ region, procedure, clinicPhone, clinicName }),
      signal: _naverAbort.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error === 'unauthorized') { hide('naverSection'); return; }
    if (data.error === 'fetch_failed') {
      sec.innerHTML = '<div class="naver-place-card"><p class="muted small">네이버 플레이스 조회 실패 — 잠시 후 재시도하세요.</p></div>';
      return;
    }
    const html = renderNaverPlace(data);
    if (!html) { hide('naverSection'); return; }
    sec.innerHTML = html;
    sec.classList.remove('reveal'); void sec.offsetWidth; sec.classList.add('reveal');
  } catch (e) {
    if (e?.name !== 'AbortError') hide('naverSection');
  }
}

function renderNaverPlace(data) {
  if (!data) return '';
  const fmt = (n) => n != null ? Number(n).toLocaleString('ko-KR') : '—';
  const target = data.target;
  const comps = data.competitors || [];
  const total = data.total != null ? Number(data.total) | 0 : null;
  const rank = data.targetRank != null ? Number(data.targetRank) | 0 : 0;
  const parsedAt = data.parsedAt
    ? new Date(data.parsedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  const targetBlock = target
    ? `<div class="np-target">
        <div class="np-target-head">
          <a class="np-name" href="${esc(target.naverUrl)}" target="_blank" rel="noopener noreferrer">${esc(target.name)}</a>
          ${rank ? `<span class="np-rank-badge">${rank}위</span>` : '<span class="np-rank-na">순위 미식별</span>'}
        </div>
        <div class="np-stats">
          <span>방문자리뷰 <b>${fmt(target.visitorReviews)}</b></span>
          <span>블로그리뷰 <b>${fmt(target.blogReviews)}</b></span>
          <span>예약리뷰 <b>${fmt(target.bookingReviews)}</b></span>
          <span>사진 <b>${fmt(target.photos)}</b>장</span>
        </div>
      </div>`
    : `<div class="np-no-target">"${esc(data.query)}" 검색 결과에서 이 치과를 찾지 못했습니다${total != null ? ` (총 ${total}개 중)` : ''}<br><span style="font-size:.76rem">전화번호·치과명 매칭 실패 — 거래처 전화번호를 확인하세요.</span></div>`;

  const compBlock = comps.length
    ? `<div class="np-comp-section">
        <div class="np-comp-label">경쟁 상위 — 공개 파싱</div>
        ${comps.map((c, i) => `
          <div class="np-comp-row">
            <span class="np-comp-num">${i + 1}</span>
            <a class="np-comp-name" href="${esc(c.naverUrl)}" target="_blank" rel="noopener noreferrer">${esc(c.name)}</a>
            <span class="np-comp-stats">방문 ${fmt(c.visitorReviews)} · 블로그 ${fmt(c.blogReviews)} · 사진 ${fmt(c.photos)}</span>
          </div>`).join('')}
      </div>`
    : '';

  return `<div class="naver-place-card">
    <div class="np-head">
      <span class="np-title">📍 플레이스 현황</span>
      <span class="np-query">"${esc(data.query)}"</span>
      ${total != null ? `<span class="np-total">총 ${total}개</span>` : ''}
    </div>
    ${targetBlock}
    ${compBlock}
    <p class="np-note">${parsedAt ? `파싱 기준 ${parsedAt} · ` : ''}${esc(data.dataNote || '')}</p>
  </div>`;
}

function renderScoreSparkline(history) {
  if (!history || history.length < 2) return '';
  const W = 240, H = 44;
  const pts = history.slice(-12).map(r => r.score ?? 0);
  const maxV = Math.max(...pts, 10);
  const n = pts.length;
  const bw = W / n;
  const bars = pts.map((s, i) => {
    const bh = Math.max(2, (s / maxV) * H);
    const color = s >= 70 ? '#1fcec4' : s >= 40 ? '#c9a84c' : '#f05e6a';
    return `<rect x="${(i*bw+1).toFixed(1)}" y="${(H-bh).toFixed(1)}" width="${(bw-2).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}" rx="2" opacity=".85"/>`;
  }).join('');
  const d0 = pts[0], d1 = pts[n-1], dd = d1 - d0;
  const dc = dd > 0 ? '#1fcec4' : dd < 0 ? '#f05e6a' : 'var(--text-2)';
  const arrow = dd > 0 ? '▲' : dd < 0 ? '▼' : '→';
  return `<div style="margin-bottom:10px">
    <svg width="${W}" height="${H}" style="display:block;border-radius:6px;background:rgba(255,255,255,.03);overflow:visible">${bars}</svg>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:3px;font-size:.68rem;color:var(--text-2)">
      <span>${d0}pt</span>
      <span style="color:${dc};font-weight:700">${arrow}${Math.abs(dd)}pt</span>
      <span>${d1}pt</span>
    </div>
  </div>`;
}

function renderHistorySection(scoreHistory, citationHistory, backedByKv) {
  const fmt = (ts) => {
    try {
      const d = new Date(ts);
      return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch { return ts || '—'; }
  };

  const TH = 'padding:8px 12px;font-size:.74rem;font-weight:700;color:var(--text-2);border-bottom:1px solid var(--border);text-align:left;white-space:nowrap';
  const TD = 'padding:8px 12px;font-size:.82rem;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top';

  // Score history table (with sparkline if ≥2 points)
  const sparkline = renderScoreSparkline(scoreHistory);
  const scoreTable = scoreHistory.length ? `
    ${sparkline}<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${TH}">날짜</th>
          <th style="${TH};text-align:right">GEO 점수</th>
          <th style="${TH}">등급</th>
        </tr></thead>
        <tbody>
          ${scoreHistory.map((r) => {
            const bandColor = r.score >= 70 ? '#1fcec4' : r.score >= 40 ? '#c9a84c' : '#f05e6a';
            return `<tr>
              <td style="${TD};color:var(--text-2)">${fmt(r.ts)}</td>
              <td style="${TD};text-align:right;font-weight:700;color:${bandColor}">${r.score ?? '—'}pt</td>
              <td style="${TD};color:${bandColor}">${esc(r.band || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : '<p class="muted small">점수 이력 없음</p>';

  // Citation history table — engines from first record
  let citationTable = '<p class="muted small">인용 이력 없음</p>';
  if (citationHistory.length) {
    const allEngines = [...new Set(citationHistory.flatMap((r) => (r.engines || []).map((e) => e.engine)))];
    const engHead = allEngines.map((e) => `<th style="${TH};text-align:center">${esc(ENGINE_SHORT[e] || e)}</th>`).join('');
    const rows = citationHistory.map((r) => {
      const engMap = Object.fromEntries((r.engines || []).map((e) => [e.engine, e]));
      const engCells = allEngines.map((e) => {
        const p = engMap[e];
        if (!p) return `<td style="${TD};text-align:center;color:var(--text-2)">—</td>`;
        const color = p.cited ? '#1fcec4' : 'var(--text-2)';
        return `<td style="${TD};text-align:center;color:${color};font-weight:${p.cited ? 700 : 400}">${p.cited ? '✅' : '❌'} ${p.citedRuns}/${p.validRuns}</td>`;
      }).join('');
      return `<tr>
        <td style="${TD};color:var(--text-2)">${fmt(r.ts)}</td>
        <td style="${TD};font-size:.78rem;color:var(--text-2)">${esc(r.region || '—')} / ${esc(r.procedure || '—')}</td>
        ${engCells}
      </tr>`;
    }).join('');
    citationTable = `<div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse">
        <thead><tr>
          <th style="${TH}">날짜</th>
          <th style="${TH}">지역/진료</th>
          ${engHead}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  const kvNote = backedByKv
    ? ''
    : '<p class="muted small" style="margin-top:6px">⚠️ KV 미연결 — 이력은 서버 재시작 시 초기화됩니다. Vercel KV를 연결하면 영구 저장됩니다.</p>';

  return `<div style="background:var(--bg-3);border:1px solid var(--border);border-radius:18px;padding:22px">
    <b style="font-size:1rem">📈 측정 이력</b>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.6fr);gap:20px;margin-top:14px;align-items:start">
      <div>
        <div style="font-size:.75rem;font-weight:700;color:var(--text-2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">GEO 점수 추이</div>
        ${scoreTable}
      </div>
      <div>
        <div style="font-size:.75rem;font-weight:700;color:var(--text-2);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">AI 인용 추이</div>
        ${citationTable}
      </div>
    </div>
    ${kvNote}
  </div>`;
}

// ── 상품 추천 + 리드 캡처 ──────────────────────────────────────────

const PRODUCTS = [
  {
    id: 'geo-diagnosis',
    name: 'GEO 진단 리포트',
    desc: 'AI·네이버 검색에서 내 치과가 어떻게 읽히는지 데이터 진단',
    how: '1회 리포트 + 대면 설명',
    trigger: () => true,
  },
  {
    id: 'content-hub',
    name: 'GEO 콘텐츠 허브 구축',
    desc: '임플란트·교정 등 진료별 AI 인용 기준 문서 제작',
    how: '1회 구축 + 의료진 검수',
    trigger: (cited, score) => !cited || score < 70,
  },
  {
    id: 'blog-posting',
    name: '네이버 블로그 포스팅',
    desc: '지역+진료 조합 — AI가 학습하는 제3자 블로그 언급 생성',
    how: '월 N편 발행',
    trigger: (cited) => !cited,
  },
  {
    id: 'media-feature',
    name: '의료 미디어 기고',
    desc: '헬스조선·코메디닷컴 등 권위 도메인 기고 — AI 인용 가중치 높음',
    how: '건당 기획·작성·게재',
    trigger: (cited) => !cited,
  },
  {
    id: 'geo-column',
    name: 'GEO칼럼 월 운영',
    desc: '3개월 폐쇄 루프 — 진단→구축→데이터 분석 반복',
    how: '월 정기 운영 계약',
    trigger: () => true,
  },
  {
    id: 'reboot-30',
    name: '신환 리부트 30일',
    desc: '신환 정체 진단 + 30일 스프린트 + Before/After 리포트',
    how: '30일 집중 구축',
    trigger: (cited) => !cited,
  },
  // ── 비교 패널 솔루션(구매 유도) 상품 ──
  {
    id: 'geo-renewal',
    name: 'GEO 홈페이지 리뉴얼',
    desc: 'AI가 읽는 구조로 홈페이지 재구축 — JSON-LD 스키마·메타·answer-first 정비',
    how: '1회 구축',
    trigger: (cited, score) => !cited || score < 70,
  },
  {
    id: 'ai-column',
    name: 'AI 검색 인용 칼럼(GEO)',
    desc: 'AI가 학습하는 제3자 인용 콘텐츠 — 권위 도메인 칼럼·기고 발행',
    how: '월 정기',
    trigger: (cited) => !cited,
  },
  {
    id: 'shortform',
    name: '주의사항 숏폼영상',
    desc: '진료 주의사항 숏폼으로 자연 언급·검색 노출 확대',
    how: '건당 제작',
    trigger: (cited) => !cited,
  },
];

// 비교에서 발견된 격차(planRows key) → 추천 솔루션 매핑 (구매 유도용)
const SOLUTIONS = [
  { id: 'geo-renewal', keys: ['schema', 'meta', 'answer', 'extract', 'local', 'crawl'] },
  { id: 'ai-column',   keys: ['notcited', 'citability', 'eeat', 'fresh'] },
  { id: 'shortform',   keys: ['notcited', 'citability'] },
];

function renderProductRecommend(citeRes, scoreRes) {
  const cited = citeRes && citeRes.d && Array.isArray(citeRes.d.perEngine)
    && citeRes.d.perEngine.some((p) => p.cited);
  const score = scoreRes?.d?.score ?? 100;
  const count = selectedProducts.length;

  const cards = PRODUCTS.map((p) => {
    const isRec = p.trigger(cited, score);
    const checked = selectedProducts.includes(p.id);
    const cardBorder = isRec
      ? 'border:1.5px solid var(--gold);background:linear-gradient(135deg,var(--bg-3),rgba(201,168,76,.06))'
      : 'border:1px solid var(--border);background:var(--bg-3);opacity:.82';
    return `<label data-prodid="${esc(p.id)}" style="display:block;cursor:pointer;border-radius:13px;padding:14px 16px;${cardBorder};transition:opacity .15s">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <input type="checkbox" data-prodcheck="${esc(p.id)}" ${checked ? 'checked' : ''} style="margin-top:3px;flex-shrink:0;accent-color:var(--gold);width:16px;height:16px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-size:.92rem;font-weight:700;color:var(--text-1)">${esc(p.name)}</span>
            ${isRec ? '<span style="font-size:.7rem;font-weight:700;background:var(--gold);color:var(--bg-1);border-radius:6px;padding:2px 8px">추천</span>' : ''}
          </div>
          <div style="font-size:.83rem;color:var(--text-2);margin-top:4px;line-height:1.5">${esc(p.desc)}</div>
          <div style="font-size:.78rem;color:var(--text-2);margin-top:3px;opacity:.75">제공: ${esc(p.how)}</div>
          <div style="font-size:.78rem;font-weight:700;color:var(--gold);margin-top:4px">상담 문의</div>
        </div>
      </div>
    </label>`;
  }).join('');

  return `<div id="productSection" style="background:var(--bg-3);border:1px solid var(--border);border-radius:18px;padding:22px;margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
      <b style="font-size:1rem">메디앤메디 서비스 추천</b>
      <span id="prodCountBadge" style="font-size:.78rem;font-weight:700;background:var(--teal);color:var(--bg-1);border-radius:10px;padding:2px 9px;display:${count > 0 ? 'inline' : 'none'}">${count}개 선택됨</span>
    </div>
    <p class="muted small" style="margin:0 0 14px">진단 결과 기반 맞춤 추천입니다. 관심 있는 서비스를 체크하세요.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px">
      ${cards}
    </div>
    <button type="button" id="prodInquiryBtn" class="btn p" style="width:100%;margin-top:16px;font-size:.92rem" ${count === 0 ? 'disabled' : ''}>
      ${count === 0 ? '서비스를 선택하면 문의할 수 있습니다' : `선택한 서비스 문의하기 (${count}개)`}
    </button>
    <div id="leadFormWrap" style="display:none;margin-top:16px;border-top:1px solid var(--border);padding-top:16px">
      <b style="font-size:.92rem">문의 정보 입력</b>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div><label class="muted small" style="display:block;margin-bottom:4px">치과명 *</label><input id="leadClinicName" type="text" placeholder="예: 이도치과" style="width:100%;box-sizing:border-box"></div>
        <div><label class="muted small" style="display:block;margin-bottom:4px">담당자 이름 *</label><input id="leadContactName" type="text" placeholder="예: 홍길동" style="width:100%;box-sizing:border-box"></div>
        <div><label class="muted small" style="display:block;margin-bottom:4px">연락처 *</label><input id="leadPhone" type="tel" placeholder="010-0000-0000" style="width:100%;box-sizing:border-box"></div>
        <div><label class="muted small" style="display:block;margin-bottom:4px">이메일 (선택)</label><input id="leadEmail" type="email" placeholder="clinic@example.com" style="width:100%;box-sizing:border-box"></div>
      </div>
      <div style="margin-top:10px">
        <div class="muted small" style="margin-bottom:6px">선택 서비스</div>
        <div id="leadProductChips" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      </div>
      <div style="margin-top:10px">
        <label class="muted small" style="display:block;margin-bottom:4px">메모 (선택)</label>
        <textarea id="leadNotes" rows="3" placeholder="추가 문의 내용..." style="width:100%;box-sizing:border-box;resize:vertical;font-family:inherit;background:var(--bg-2);color:var(--text-1);border:1px solid var(--border);border-radius:10px;padding:10px 14px"></textarea>
      </div>
      <div id="leadMsg" style="display:none;font-size:.85rem;margin-top:10px;padding:10px 14px;border-radius:10px"></div>
      <button type="button" id="leadSubmitBtn" class="btn p" style="margin-top:12px;width:100%">문의 제출</button>
    </div>
  </div>`;
}

// Product checkbox change → update selectedProducts + UI
$('opResult').addEventListener('change', (e) => {
  const cb = e.target.closest('[data-prodcheck]');
  if (!cb) return;
  const id = cb.getAttribute('data-prodcheck');
  if (cb.checked) {
    if (!selectedProducts.includes(id)) selectedProducts = [...selectedProducts, id];
  } else {
    selectedProducts = selectedProducts.filter((x) => x !== id);
  }
  updateProductUI();
});

function updateProductUI() {
  const count = selectedProducts.length;
  const badge = $('prodCountBadge');
  if (badge) { badge.textContent = `${count}개 선택됨`; badge.style.display = count > 0 ? 'inline' : 'none'; }
  const btn = $('prodInquiryBtn');
  if (btn) {
    btn.disabled = count === 0;
    btn.textContent = count === 0 ? '서비스를 선택하면 문의할 수 있습니다' : `선택한 서비스 문의하기 (${count}개)`;
  }
  updateLeadProductChips();
}

function updateLeadProductChips() {
  const wrap = $('leadProductChips');
  if (!wrap) return;
  wrap.innerHTML = selectedProducts.map((id) => {
    const p = PRODUCTS.find((x) => x.id === id);
    return `<span class="chip on" style="font-size:.78rem">${esc(p ? p.name : id)}</span>`;
  }).join('');
}

async function submitLead() {
  const clinicName  = ($('leadClinicName')?.value  || '').trim();
  const contactName = ($('leadContactName')?.value || '').trim();
  const phone       = ($('leadPhone')?.value       || '').trim();
  const email       = ($('leadEmail')?.value       || '').trim();
  const notes       = ($('leadNotes')?.value       || '').trim();
  const msgEl       = $('leadMsg');

  const showMsg = (text, ok) => {
    if (!msgEl) return;
    msgEl.style.display = 'block';
    msgEl.style.background = ok ? 'rgba(31,206,196,.15)' : 'rgba(240,94,106,.15)';
    msgEl.style.color = ok ? 'var(--teal)' : '#f05e6a';
    msgEl.textContent = text;
  };

  if (!clinicName || !contactName || !phone) {
    showMsg('치과명, 담당자 이름, 연락처는 필수입니다.', false);
    return;
  }
  if (selectedProducts.length === 0) {
    showMsg('서비스를 하나 이상 선택해주세요.', false);
    return;
  }

  const submitBtn = $('leadSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '제출 중...'; }

  try {
    const key = localStorage.getItem('opKey') || '';
    let domain = '';
    try { domain = new URL(lastUrl).hostname.replace(/^www\./, ''); } catch {}
    const geoScore = lastScoreRes?.d?.score ?? null;
    const aiCited = !!(lastCiteRes && lastCiteRes.d && Array.isArray(lastCiteRes.d.perEngine)
      && lastCiteRes.d.perEngine.some((p) => p.cited));

    const r = await fetch('/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-key': key },
      body: JSON.stringify({ domain, clinicName, contactName, phone, email, selectedProducts, notes, geoScore, aiCited }),
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      showMsg('문의가 접수되었습니다. 빠른 시일 내 연락드리겠습니다.', true);
      if (submitBtn) submitBtn.textContent = '접수 완료';
      selectedProducts = [];
      updateProductUI();
    } else {
      throw new Error(data.error || 'unknown');
    }
  } catch (err) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '문의 제출'; }
    showMsg('제출 실패: ' + String(err.message || err).slice(0, 100), false);
  }
}

// ── Naver Manual (Smart Place private stats) ──────────────────────────────────
let _nmAbort = null;

async function loadNaverManual(domain) {
  const sec = $('naverManualSection');
  if (!sec || !domain) return;
  const key = localStorage.getItem('opKey') || '';
  _nmAbort?.abort();
  _nmAbort = new AbortController();
  try {
    const r = await fetch(`/api/naver-manual?domain=${encodeURIComponent(domain)}&months=6`, {
      headers: { 'x-operator-key': key },
      signal: _nmAbort.signal,
    });
    if (!r.ok) { hide('naverManualSection'); return; }
    const data = await r.json();
    sec.innerHTML = renderNaverManual(data, domain);
    show('naverManualSection');
  } catch (e) {
    if (e?.name !== 'AbortError') hide('naverManualSection');
  }
}

function renderNaverManual(data, domain) {
  const records = data.records || [];
  const fmtN = (n) => n != null ? Number(n).toLocaleString('ko-KR') : '—';

  const tableRows = records.map((r) => `
    <tr>
      <td style="color:var(--gold-2);font-weight:700">${esc(r.period)}</td>
      <td>${r.naturalVisitRate != null ? r.naturalVisitRate + '%' : '—'}</td>
      <td>${fmtN(r.callClicks)}</td>
      <td>${fmtN(r.directionClicks)}</td>
      <td>${fmtN(r.reservations)}</td>
      <td>${fmtN(r.saves)}</td>
    </tr>`).join('');

  const tableHtml = records.length > 0 ? `
    <table class="nm-table">
      <thead><tr><th>기간</th><th>자연유입</th><th>전화클릭</th><th>길찾기</th><th>예약</th><th>저장수</th></tr></thead>
      <tbody>${tableRows}</tbody>
    </table>` : `<p class="nm-empty">저장된 통계가 없습니다. 아래에서 입력하세요.</p>`;

  const now = new Date();
  const currentPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return `<div class="naver-place-card naver-manual-card">
    <div class="nm-head">
      <span class="nm-title">📊 Smart Place 통계 <span class="nm-period">(수동 입력)</span></span>
      <button class="nm-toggle" onclick="this.closest('.naver-manual-card').querySelector('.nm-form').classList.toggle('open');this.textContent=this.textContent.includes('입력')?'▲ 닫기':'+ 월별 통계 입력'">+ 월별 통계 입력</button>
    </div>
    ${tableHtml}
    <div class="nm-form">
      <div class="nm-form-grid">
        <div class="nm-form-group">
          <label class="nm-form-label">기간 (YYYY-MM)</label>
          <input class="nm-form-input" id="nmPeriod" type="text" placeholder="${currentPeriod}" value="${currentPeriod}">
        </div>
        <div class="nm-form-group">
          <label class="nm-form-label">자연유입률 (%)</label>
          <input class="nm-form-input" id="nmNaturalVisitRate" type="number" min="0" max="100" step="0.1" placeholder="예: 42.5">
        </div>
        <div class="nm-form-group">
          <label class="nm-form-label">전화 클릭</label>
          <input class="nm-form-input" id="nmCallClicks" type="number" min="0" placeholder="예: 87">
        </div>
        <div class="nm-form-group">
          <label class="nm-form-label">길찾기 클릭</label>
          <input class="nm-form-input" id="nmDirectionClicks" type="number" min="0" placeholder="예: 234">
        </div>
        <div class="nm-form-group">
          <label class="nm-form-label">예약 수</label>
          <input class="nm-form-input" id="nmReservations" type="number" min="0" placeholder="예: 12">
        </div>
        <div class="nm-form-group">
          <label class="nm-form-label">저장수 (하트)</label>
          <input class="nm-form-input" id="nmSaves" type="number" min="0" placeholder="예: 312">
        </div>
      </div>
      <button class="nm-save-btn" onclick="saveNaverManual(${JSON.stringify(domain)})">저장</button>
      <span class="nm-save-msg muted" id="nmSaveMsg"></span>
    </div>
  </div>`;
}

async function saveNaverManual(domain) {
  const opKey = localStorage.getItem('opKey') || '';
  const period = ($('nmPeriod') || {}).value || '';
  const msg = $('nmSaveMsg');
  if (!/^\d{4}-\d{2}$/.test(period)) {
    if (msg) { msg.textContent = '기간 형식 오류 (YYYY-MM)'; msg.style.color = '#f05e6a'; }
    return;
  }
  const data = {
    naturalVisitRate: ($('nmNaturalVisitRate') || {}).value,
    callClicks:       ($('nmCallClicks')       || {}).value,
    directionClicks:  ($('nmDirectionClicks')  || {}).value,
    reservations:     ($('nmReservations')     || {}).value,
    saves:            ($('nmSaves')            || {}).value,
  };
  if (msg) { msg.textContent = '저장 중...'; msg.style.color = 'var(--text-2)'; }
  try {
    const r = await fetch('/api/naver-manual', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-operator-key': opKey },
      body: JSON.stringify({ domain, period, data }),
    });
    const result = await r.json().catch(() => ({}));
    if (!r.ok || result.error) {
      if (msg) { msg.textContent = '저장 실패 — 키 확인'; msg.style.color = '#f05e6a'; }
      return;
    }
    if (msg) { msg.textContent = `✔ ${period} 저장 완료`; msg.style.color = 'var(--teal)'; }
    setTimeout(() => loadNaverManual(domain), 400);
  } catch {
    if (msg) { msg.textContent = '네트워크 오류'; msg.style.color = '#f05e6a'; }
  }
}

// ── 배치 대시보드 ──────────────────────────────────────────────────────────

const BATCH_KEY = 'op_batch_urls';

function loadBatchUrls() {
  try { return JSON.parse(localStorage.getItem(BATCH_KEY) || '[]'); } catch { return []; }
}
function saveBatchUrls(arr) {
  localStorage.setItem(BATCH_KEY, JSON.stringify(arr));
}

let batchResults = [];
let batchRunning = false;

function switchTab(tab) {
  document.querySelectorAll('.op-tab').forEach(el => el.classList.toggle('on', el.dataset.tab === tab));
  const single = $('singleView');
  const batch  = $('batchSection');
  if (tab === 'batch') {
    if (single) single.classList.add('hidden');
    if (batch)  { batch.classList.remove('hidden'); renderBatch(); }
  } else {
    if (single) single.classList.remove('hidden');
    if (batch)  batch.classList.add('hidden');
  }
}

function renderBatch() {
  const sec = $('batchSection');
  if (!sec) return;
  const urls = loadBatchUrls();

  const urlListHtml = urls.length === 0
    ? '<p class="batch-empty">URL이 없습니다. 위에서 추가하세요.</p>'
    : urls.map((u, i) => `
      <div class="batch-url-row">
        <span class="batch-url-text">${esc(u)}</span>
        <button class="batch-url-del" onclick="batchRemoveUrl(${i})" title="삭제">✕</button>
      </div>`).join('');

  const resultsHtml = batchResults.length === 0 ? '' : `
    <div class="batch-result-wrap">
      <div class="batch-section-head">측정 결과 <span class="muted small">${batchResults.length}개</span></div>
      <div class="batch-table-wrap">
        <table class="batch-table">
          <thead><tr><th>도메인</th><th>점수</th><th>변화량</th><th>밴드</th><th>측정 시각</th></tr></thead>
          <tbody>${batchResults.map(r => _batchRow(r)).join('')}</tbody>
        </table>
      </div>
    </div>`;

  sec.innerHTML = `
    <div class="batch-card">
      <div class="batch-head">
        <span class="batch-title">배치 대시보드</span>
        <span class="batch-sub">거래처 URL 목록을 저장하고 일괄 점수 조회 · 변화량을 모아봅니다</span>
      </div>
      <div class="batch-add-row">
        <input class="batch-url-input" id="batchUrlInput" type="url" placeholder="https://거래처치과.co.kr" />
        <button class="batch-add-btn" onclick="batchAddUrl()">추가</button>
      </div>
      <div class="batch-url-list">${urlListHtml}</div>
      <button class="batch-run-btn" id="batchRunBtn" onclick="runBatch()"${urls.length === 0 ? ' disabled' : ''}>
        ▶ 배치 측정 실행 (${urls.length}개)
      </button>
      <p class="batch-run-hint">순차 측정 · 위생점수만 (무료 API · prevScore 델타 포함)</p>
    </div>
    ${resultsHtml}`;

  const inp = $('batchUrlInput');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') batchAddUrl(); });
}

function _batchRow(r) {
  if (r.error) {
    return `<tr class="batch-row-err">
      <td class="batch-domain">${esc(r.domain || r.url)}</td>
      <td colspan="4" style="color:#f05e6a;font-size:.78rem">${esc(r.error)}</td>
    </tr>`;
  }
  const score = r.score != null ? Number(r.score) : null;
  const prev  = r.prevScore != null ? Number(r.prevScore) : null;
  const delta = (score != null && prev != null) ? score - prev : null;
  const deltaHtml = delta == null
    ? '<span class="muted">—</span>'
    : delta === 0
      ? '<span class="batch-delta same">동점</span>'
      : `<span class="batch-delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'}${Math.abs(delta)}pt</span>`;
  const bandColor = { A: 'var(--teal)', B: 'var(--gold-2)', C: 'var(--text-2)', D: '#f05e6a' };
  const band = r.band || '—';
  const ts = r.measuredAt ? new Date(r.measuredAt).toLocaleTimeString('ko-KR') : '';
  return `<tr>
    <td class="batch-domain">${esc(r.domain || r.url)}</td>
    <td class="batch-score">${score != null ? score : '—'}</td>
    <td>${deltaHtml}</td>
    <td style="font-weight:700;color:${bandColor[band] || 'var(--text-2)'}">${esc(band)}</td>
    <td class="batch-ts">${esc(ts)}</td>
  </tr>`;
}

function batchAddUrl() {
  const inp = $('batchUrlInput');
  if (!inp) return;
  let val = inp.value.trim();
  if (!val) return;
  if (!/^https?:\/\//i.test(val)) val = 'https://' + val;
  const urls = loadBatchUrls();
  if (!urls.includes(val)) { urls.push(val); saveBatchUrls(urls); }
  inp.value = '';
  renderBatch();
}

function batchRemoveUrl(idx) {
  const urls = loadBatchUrls();
  urls.splice(idx, 1);
  saveBatchUrls(urls);
  renderBatch();
}

async function runBatch() {
  if (batchRunning) return;
  const urls = loadBatchUrls();
  if (!urls.length) return;
  batchRunning = true;
  batchResults = [];

  const btn = $('batchRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = '측정 중... (0/' + urls.length + ')'; }

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (btn) btn.textContent = `측정 중... (${i + 1}/${urls.length})`;
    let domain = url;
    try { domain = new URL(url).hostname; } catch { /* keep raw */ }
    try {
      const r = await fetch('/api/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.error) {
        batchResults.push({ url, domain, error: d.message || d.reason || '분석 실패' });
      } else {
        batchResults.push({
          url,
          domain: d.domain || domain,
          score: d.score,
          prevScore: d.prevScore ?? null,
          band: d.band,
          measuredAt: d.measuredAt || new Date().toISOString(),
        });
      }
    } catch {
      batchResults.push({ url, domain, error: '네트워크 오류' });
    }
    renderBatch();
  }

  batchRunning = false;
}

// module → global (inline onclick handlers need window scope)
window.switchTab = switchTab;
window.batchAddUrl = batchAddUrl;
window.batchRemoveUrl = batchRemoveUrl;
window.runBatch = runBatch;
window.saveNaverManual = saveNaverManual;
