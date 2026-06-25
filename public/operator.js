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

$('regionList').innerHTML = REGION_TERMS.map((r) => `<option value="${esc(r)}">`).join('');

// ── URL ?key= 자동 주입 ──────────────────────────────────────────
const _urlKey = new URLSearchParams(location.search).get('key');
if (_urlKey) { localStorage.setItem('opKey', _urlKey); history.replaceState(null, '', location.pathname); }

// ── 패스코드 상태 초기화 ────────────────────────────────────────
function showKeyEntry(errMsg) {
  hide('keySaved');
  $('setupCard').classList.remove('hidden');
  hide('analyzeSection');
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

// ── PHASE 1: 분석 (/api/score) ─────────────────────────────────
$('opBtn').addEventListener('click', async () => {
  let url = ($('opUrl').value || '').trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  lastUrl = url;

  hide('opResult'); hide('opError'); hide('confirmSection');
  $('opLoadMsg').textContent = '페이지 분석 중 (지역·진료 자동 감지)...';
  show('opLoading');
  $('opBtn').disabled = true; $('opBtn').textContent = '분석 중...';
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
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opBtn').disabled = false; $('opBtn').textContent = '분석';
  }
});

function populateConfirm(d) {
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

function updateQueryChips() {
  const region = $('opRegion').value.trim();
  const variants = allQueryVariants({ district: region, procedure: selectedProcedure });
  // default: first 3 selected (reset on region/procedure change)
  selectedQueries = variants.slice(0, 3);
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
    if (selectedQueries.length >= 3) return; // 최대 3개
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
  if (!region && !procedure) { showError('지역 또는 진료를 입력해주세요.'); return; }

  hide('opError'); hide('opResult');
  $('opLoadMsg').textContent = 'ChatGPT·Perplexity에 실제 질의 중 (최대 1~2분)...';
  show('opLoading');
  $('opMeasureBtn').disabled = true; $('opMeasureBtn').textContent = '측정 중...';
  try {
    const headers = { 'content-type': 'application/json', 'x-operator-key': key };
    const queriesToSend = selectedQueries.length > 0 ? selectedQueries : undefined;
    const citeRes = await fetch('/api/citation', {
      method: 'POST', headers,
      body: JSON.stringify({ url: lastUrl, region, procedure, queries: queriesToSend }),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null);
    hide('opLoading');
    if (citeRes && citeRes.status === 401) {
      // 패스코드 오류 — 안내를 명확히
      localStorage.removeItem('opKey');
      initKeyState();
      hide('analyzeSection'); hide('confirmSection');
      showError('패스코드가 맞지 않습니다. ① 패스코드를 다시 입력해주세요.<br><small style="color:var(--text-2)">.env.local의 <code>OPERATOR_KEY=</code> 값을 확인하세요 (OpenAI/Perplexity API 키가 아닙니다)</small>');
      return;
    }
    render(lastScoreRes, citeRes, { region, procedure });
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opMeasureBtn').disabled = false; $('opMeasureBtn').textContent = '측정 시작 (유료 API)';
  }
});

function showError(msg) { $('opErrMsg').innerHTML = msg; show('opError'); }

function render(scoreRes, citeRes, q) {
  geminiVerdicts = [];

  const header    = renderResultHeader(scoreRes, citeRes, q);
  const citation  = renderCitation(citeRes);
  const hygiene   = renderHygiene(scoreRes);
  const improve   = renderImprovements(scoreRes);
  const agent     = renderAgentActionability(scoreRes);
  const gemini    = renderGemini(q);

  const citeOk = citeRes && citeRes.d && Array.isArray(citeRes.d.perEngine)
    && citeRes.d.perEngine.some((p) => p.cited);
  const strategyOrBannerHtml = citeRes && citeRes.d && citeRes.d.perEngine
    ? (citeOk
        ? (() => {
            const cited = citeRes.d.perEngine.filter((p) => p.cited).map((p) => ENGINE_SHORT[p.engine] || p.engine);
            return `<div class="insight-banner insight-ok"><b>✅ AI 추천 확인</b> — 현재 ${esc(cited.join('·'))}에 이 치과가 인용되고 있습니다.</div>`;
          })()
        : renderContentStrategy(q))
    : '';

  $('opResult').innerHTML = `
    ${header}
    ${strategyOrBannerHtml}
    ${citation}
    <div class="result-2col">
      <div>${improve}${agent}</div>
      <div>${hygiene}</div>
    </div>
    <div class="accordion-wrap" style="margin-top:12px">
      <button type="button" class="accordion-btn" onclick="this.closest('.accordion-wrap').classList.toggle('open')">
        <span>🔍 Gemini 수동 확인</span><span class="accordion-arrow">▼</span>
      </button>
      <div class="accordion-body">${gemini}</div>
    </div>
  `;
  show('opResult');
  requestAnimationFrame(() => {
    const bar = document.querySelector('.score-bar-fill');
    if (bar) bar.style.width = bar.dataset.pct + '%';
  });
  // 이력 비동기 로드 (메인 렌더를 블록하지 않음)
  hide('historySection');
  fetchAndRenderHistory(lastUrl);
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
  }
});

async function loadCompare(compDomain, compUrl) {
  const userBreakdown = lastScoreRes && lastScoreRes.d && lastScoreRes.d.breakdown;
  const userSignals = lastScoreRes && lastScoreRes.d && lastScoreRes.d.signals;
  const userDomain = lastScoreRes && lastScoreRes.d && lastScoreRes.d.domain;
  const sec = $('compareSection');
  sec.innerHTML = `<div class="compare-panel"><p class="muted small">⏳ ${esc(compDomain)} 분석 중...</p></div>`;
  show('compareSection');
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  let compScore = null;
  try {
    const url = compUrl || (compDomain.startsWith('http') ? compDomain : `https://${compDomain}`);
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }).then((r) => r.json().then((d) => ({ ok: r.ok, d }))).catch(() => null);
    if (res && res.ok) compScore = res.d;
  } catch { /* ignore */ }

  sec.innerHTML = renderCompare(userDomain, userBreakdown, compDomain, compScore, userSignals);
}

function renderCompare(userDomain, userBreakdown, compDomain, compScore, userSignals) {
  const compBreakdown = compScore && compScore.breakdown;
  const closeBtn = `<button type="button" onclick="document.getElementById('compareSection').classList.add('hidden')" class="chip" style="float:right;margin-left:8px">닫기 ✕</button>`;
  if (!userBreakdown || !compBreakdown) {
    return `<div class="compare-panel">${closeBtn}<p class="muted">비교 데이터 없음 (${!userBreakdown ? '측정 대상 재분석 필요' : '경쟁 치과 분석 실패'})</p></div>`;
  }

  const compMap = Object.fromEntries(compBreakdown.map((c) => [c.label, c]));
  const gaps = [], same = [], userBetter = [];
  for (const u of userBreakdown) {
    const c = compMap[u.label];
    if (!c) continue;
    const uOk = u.status === 'ok';
    const cOk = c.status === 'ok';
    if (!uOk && cOk) gaps.push({ label: u.label, uNote: u.note, cNote: c.note });
    else if (uOk && cOk) same.push({ label: u.label });
    else if (uOk && !cOk) userBetter.push({ label: u.label });
  }

  const row = (label, uOk, cOk, note) => `<div class="compare-row">
    <div class="compare-label">${esc(label)}${note ? `<div style="font-size:.75rem;color:var(--text-2);margin-top:2px">${esc(note)}</div>` : ''}</div>
    <div class="compare-val ${uOk ? 'ok' : 'fail'}">${uOk ? '✓ 있음' : '✗ 없음'}</div>
    <div class="compare-val ${cOk ? 'ok' : 'fail'}">${cOk ? '✓ 있음' : '✗ 없음'}</div>
  </div>`;

  const compScoreNum = compScore ? compScore.score : '?';
  const userScoreNum = lastScoreRes && lastScoreRes.d ? lastScoreRes.d.score : '?';

  return `<div class="compare-panel">
    ${closeBtn}
    <div class="compare-title">📊 비교 분석</div>
    <div class="compare-domains">
      <span class="compare-domain-tag compare-tag-user">📍 ${esc(userDomain || '측정 대상')} · ${userScoreNum}점</span>
      <span style="color:var(--text-2);font-size:.8rem;align-self:center">vs</span>
      <span class="compare-domain-tag compare-tag-comp">🏆 ${esc(compDomain)} · ${compScoreNum}점</span>
    </div>
    ${gaps.length ? `<div class="compare-section-head">⬆️ 경쟁 치과에 있고 이 치과에 없는 것 (${gaps.length}개)</div>
    <div style="font-size:.78rem;color:var(--text-2);margin-bottom:6px">이 항목들이 AI 추천 격차의 원인일 수 있습니다</div>
    <div style="display:flex;font-size:.72rem;color:var(--text-2);padding:0 0 4px;gap:10px"><div style="flex:1"></div><div style="width:60px;text-align:center">${esc(userDomain || '이 치과')}</div><div style="width:60px;text-align:center">${esc(compDomain)}</div></div>
    ${gaps.map((g) => row(g.label, false, true, g.cNote)).join('')}` : ''}
    ${same.length ? `<div class="compare-section-head" style="margin-top:14px">✅ 양쪽 모두 통과 (${same.length}개)</div>
    ${same.map((g) => row(g.label, true, true, '')).join('')}` : ''}
    ${userBetter.length ? `<div class="compare-section-head" style="margin-top:14px">📌 이 치과만 있는 것 (${userBetter.length}개)</div>
    ${userBetter.map((g) => row(g.label, true, false, '')).join('')}` : ''}
    ${(() => {
      const uS = userSignals || {};
      const cS = (compScore && compScore.signals) || {};
      if (uS.hasStatistics === undefined && cS.hasStatistics === undefined) return '';
      const gSigs = [
        { label: '수치·통계 ≥2개', uVal: uS.hasStatistics, cVal: cS.hasStatistics },
        { label: '인용문 (blockquote·따옴표)', uVal: uS.hasQuotations, cVal: cS.hasQuotations },
        { label: '출처 표기 (cite·[1]·참고문헌)', uVal: uS.hasCitedSources, cVal: cS.hasCitedSources },
      ];
      return `<div class="compare-section-head" style="margin-top:14px">📝 콘텐츠 인용성 신호 (참고 지표)</div>
      <div style="font-size:.78rem;color:var(--text-2);margin-bottom:6px">AI가 인용할 근거 콘텐츠 · 점수 외 참고용</div>
      ${gSigs.map((g) => row(g.label, g.uVal, g.cVal, '')).join('')}`;
    })()}
    <p class="muted small" style="margin-top:12px">기술 점수 비교 — AI 인용과 직접 인과관계 없음 (필요조건·위생 지표)</p>
  </div>`;
}

function renderResultHeader(scoreRes, citeRes, q) {
  const d = (citeRes && citeRes.d) || {};
  const domain = d.clinicDomain || lastUrl.replace(/^https?:\/\//,'').split('/')[0];
  const sd = scoreRes && scoreRes.d;
  const score = sd ? sd.score : null;
  const band  = sd ? sd.band : null;
  const bandColor = sd ? (sd.score >= 70 ? '#1fcec4' : sd.score >= 40 ? '#c9a84c' : '#f05e6a') : 'var(--text-2)';

  const scoreBlock = score != null ? `
    <div class="result-dash-score">
      <div class="result-dash-score-num">${score}</div>
      <div style="font-size:.65rem;font-weight:700;color:var(--text-2);text-transform:uppercase;letter-spacing:.07em;margin-top:3px">GEO 준비도</div>
      <div style="font-size:.9rem;font-weight:700;color:${bandColor};margin-top:6px">${esc(band)}</div>
    </div>` : '';

  const engRows = Array.isArray(d.perEngine) ? d.perEngine.map((p) => {
    const logo = ENGINE_LOGO[p.engine] || '';
    const name = ENGINE_SHORT[p.engine] || p.engine;
    if (!p.measured) return `<div class="result-dash-engine-row">${logo}<span class="rdname">${esc(name)}</span><span style="color:var(--text-2);font-size:.8rem">—</span></div>`;
    const color = p.cited ? 'var(--teal)' : 'var(--text-2)';
    const icon  = p.cited ? '✅' : '❌';
    const stat  = p.cited ? `${p.citedRuns}/${p.validRuns}회` : '미인용';
    return `<div class="result-dash-engine-row">${logo}<span class="rdname">${esc(name)}</span><span style="font-weight:700;color:${color};font-size:.82rem">${icon} ${esc(stat)}</span></div>`;
  }).join('') : '';

  return `<div class="result-dash">
    ${scoreBlock}
    <div class="result-dash-info">
      <div class="result-dash-domain">${esc(domain)}</div>
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

function renderCitation(citeRes) {
  if (!citeRes) return card('AI 실측', '<p class="muted">인용 측정에 실패했습니다.</p>');
  const d = citeRes.d || {};
  if (d.status === 'pending') return card('AI 실측 — 비활성', `<p class="muted">${esc(d.message || 'CITATION_ENABLED 키 필요.')}</p>`);
  if (d.status === 'cap-reached') return card('AI 실측 — 한도 소진', `<p class="muted">${esc(d.message || '오늘 한도 소진.')}</p>`);
  if (d.byRegion && Array.isArray(d.regions)) return renderRegionHitmap(d);
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  if (!eng.length) return card('AI 실측', '<p class="muted">측정 결과 없음.</p>');

  const logos = eng.map((p) => ENGINE_LOGO[p.engine] || '').filter(Boolean).join('');
  const note = `<p class="muted small" style="margin-top:12px;text-align:center">개발자 API 기준 · 일반 앱과 다를 수 있음 · <b>환자 광고에 "추천·인증·1위"로 인용 금지(의료광고법)</b></p>`;
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
    return `<td style="padding:16px 20px;text-align:center">
      <div style="font-size:1.4rem;line-height:1">❌</div>
      <div style="font-size:.88rem;color:var(--text-2);margin-top:5px">0/${p.validRuns}회 인용</div>
      <div style="font-size:.73rem;color:var(--text-2);margin-top:2px;opacity:.7">미추천</div>
    </td>`;
  }).join('');

  // Row 2 — 대신 인용된 경쟁 도메인
  const compCells = eng.map((p) => {
    const comp = (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain);
    if (!p.measured || !comp.length) return `<td style="padding:14px 20px;text-align:center;color:rgba(255,255,255,.2);font-size:.82rem">—</td>`;
    const links = comp.slice(0, 6).map((x) => {
      const href = /^https?:\/\//.test(x) ? x : `https://${x}`;
      return `<a class="comp-link" href="${esc(href)}" target="_blank" rel="noopener" data-compare="${esc(x)}"
        style="display:block;margin-bottom:5px;word-break:break-all">${esc(x)}</a>`;
    }).join('');
    return `<td style="padding:14px 20px;vertical-align:top">${links}</td>`;
  }).join('');

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
          <td style="${TD_LABEL}">대신<br>인용됨</td>
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
    ${urlMatchHtml}
    ${note}
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
    { val: d.hasLlmsTxt,    label: 'llms.txt',        layer: 'GEO', note: 'AI 전용 색인 파일' },
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
  <p class="muted small" style="margin-top:8px">기술 점수 = 위생 합계. GEO·AEO 행은 점수에 포함되지 않는 참고 지표입니다.</p>`;

  const scoreBar = `<div style="display:flex;align-items:center;gap:10px;margin:10px 0 14px">
    <div class="score-bar-wrap" style="flex:1"><div class="score-bar-fill" data-pct="${pctVal}" style="width:0%"></div></div>
    <span style="font-size:.8rem;font-weight:700;color:${bandColor};flex-shrink:0">${d.score}pt · ${bandLabel}</span>
  </div>`;

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

function renderHistorySection(scoreHistory, citationHistory, backedByKv) {
  const fmt = (ts) => {
    try {
      const d = new Date(ts);
      return `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    } catch { return ts || '—'; }
  };

  const TH = 'padding:8px 12px;font-size:.74rem;font-weight:700;color:var(--text-2);border-bottom:1px solid var(--border);text-align:left;white-space:nowrap';
  const TD = 'padding:8px 12px;font-size:.82rem;border-bottom:1px solid rgba(255,255,255,.04);vertical-align:top';

  // Score history table
  const scoreTable = scoreHistory.length ? `
    <div style="overflow-x:auto">
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
