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
function initKeyState() {
  const saved = localStorage.getItem('opKey') || '';
  if (saved) {
    $('keySaved').classList.remove('hidden');
    hide('setupCard');
    $('keyMasked').textContent = saved.slice(0, 2) + '•'.repeat(Math.max(0, saved.length - 2));
    show('analyzeSection');
  } else {
    hide('keySaved');
    $('setupCard').classList.remove('hidden');
    hide('analyzeSection');
    hide('confirmSection');
  }
}
initKeyState();

// 저장 버튼
$('keySaveBtn').addEventListener('click', () => {
  const val = $('opKey').value.trim();
  if (!val) return;
  localStorage.setItem('opKey', val);
  initKeyState();
});
$('opKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('keySaveBtn').click(); });

// 변경 버튼
$('keyChangeBtn').addEventListener('click', () => {
  hide('keySaved');
  $('setupCard').classList.remove('hidden');
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
  const parts = [
    renderResultHeader(scoreRes, citeRes, q),
    renderCitation(citeRes),
    renderGemini(q),
    renderImprovements(scoreRes),
    renderHygiene(scoreRes),
    renderAgentActionability(scoreRes),
  ];
  $('opResult').innerHTML = parts.join('');
  show('opResult');
  // animate score bar
  requestAnimationFrame(() => {
    const bar = document.querySelector('.score-bar-fill');
    if (bar) bar.style.width = bar.dataset.pct + '%';
  });
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

  sec.innerHTML = renderCompare(userDomain, userBreakdown, compDomain, compScore);
}

function renderCompare(userDomain, userBreakdown, compDomain, compScore) {
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
    <p class="muted small" style="margin-top:12px">기술 점수 비교 — AI 인용과 직접 인과관계 없음 (필요조건·위생 지표)</p>
  </div>`;
}

function renderResultHeader(scoreRes, citeRes, q) {
  const d = (citeRes && citeRes.d) || {};
  const domain = d.clinicDomain || lastUrl.replace(/^https?:\/\//,'').split('/')[0];
  return `<div class="result-header">
    <div class="result-domain">${esc(domain)}</div>
    <div class="result-region">${esc(q.region || '')} ${esc(q.procedure || '')} · AI 추천 실측 리포트</div>
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
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  if (!eng.length) return card('AI 실측', '<p class="muted">측정 결과 없음.</p>');

  const cells = eng.map((p) => {
    let badge, statusText, statText, cls;
    if (!p.measured) {
      badge = '⚠️'; statusText = '측정 불가'; statText = '키 또는 엔진 오류'; cls = 'error';
    } else if (p.cited) {
      badge = '✅'; statusText = 'AI가 추천했습니다'; statText = `${p.citedRuns}/${p.validRuns}회 인용`; cls = 'cited';
    } else {
      badge = '❌'; statusText = '추천하지 않음'; statText = `0/${p.validRuns}회 인용`; cls = 'not-cited';
    }
    const comp = (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain);
    const compHtml = comp.length ? `<div class="competitor-box" style="text-align:left;margin-top:10px">
      <div class="competitor-title">대신 이곳이 추천됐습니다</div>
      <div class="competitor-list">${comp.slice(0, 6).map((x) => {
        const href = /^https?:\/\//.test(x) ? x : `https://${x}`;
        return `<a class="comp-link" href="${esc(href)}" target="_blank" rel="noopener" data-compare="${esc(x)}">${esc(x)}</a>`;
      }).join('')}</div>
    </div>` : '';
    const logo = ENGINE_LOGO[p.engine] || '';
    return `<div class="engine-cell ${cls}">
      <div class="engine-name" style="display:flex;align-items:center;gap:5px;justify-content:center">${logo}${esc(ENGINE_SHORT[p.engine] || p.engine)}</div>
      <div class="engine-badge">${badge}</div>
      <div class="engine-status">${statusText}</div>
      <div class="engine-stat">${statText}</div>
      ${compHtml}
    </div>`;
  }).join('');

  const logos = eng.map((p) => ENGINE_LOGO[p.engine] || '').filter(Boolean).join('');
  const note = `<p class="muted small" style="margin-top:12px;text-align:center">개발자 API 기준 · 일반 앱과 다를 수 있음 · <b>환자 광고에 "추천·인증·1위"로 인용 금지(의료광고법)</b></p>`;
  return `<div class="card gate">
    <div class="engine-title-row">
      <div class="engine-title-logos">${logos}</div>
      <b style="font-size:1rem">AI 실측 — 이 치과를 실제로 추천하나요?</b>
    </div>
    <div class="engine-grid">${cells}</div>
    ${note}
  </div>`;
}

function renderImprovements(scoreRes) {
  const fixes = (scoreRes && scoreRes.d && scoreRes.d.topFixes) || [];
  const provenItem = `<li class="action-item">
    <div class="action-num">1</div>
    <div class="action-body">
      <div class="action-title">콘텐츠에 출처·통계·전문의 인용 추가</div>
      <div class="action-desc">진료 페이지 본문에 "연구에 따르면…", 의료진 자격·경력, 실제 수치를 넣습니다. AI가 신뢰할 수 있는 콘텐츠로 인식합니다.</div>
      <span class="action-tag tag-proven">인과 입증된 유일 레버</span>
    </div>
  </li>`;
  const hygieneItems = fixes.map((f, i) => `<li class="action-item">
    <div class="action-num">${i + 2}</div>
    <div class="action-body">
      <div class="action-title">${esc(f.fix)}</div>
      <div class="action-desc">${esc(f.note || '검색엔진·AI 크롤러가 사이트를 더 잘 읽을 수 있게 됩니다.')}</div>
      <span class="action-tag tag-hygiene">위생 개선 +${f.gain}점</span>
    </div>
  </li>`).join('');
  return `<div class="card">
    <b style="font-size:1rem">개선 실행 목록</b>
    <p class="muted small" style="margin:6px 0 12px">우선순위 순서입니다. 1번이 AI 인용에 가장 직접적인 영향을 줍니다.</p>
    <ul class="action-list">${provenItem}${hygieneItems}</ul>
    <p class="muted small" style="margin-top:10px">2번 이하 항목은 홈페이지 구조 개선이며 인용을 직접 보장하지 않습니다.</p>
  </div>`;
}

function renderAgentActionability(scoreRes) {
  const a = scoreRes && scoreRes.d && scoreRes.d.agentActionability;
  return agentCardHtml(a, { esc, card });
}

function renderHygiene(scoreRes) {
  if (!scoreRes || !scoreRes.ok) {
    const reason = scoreRes && scoreRes.d && (scoreRes.d.reason || scoreRes.d.message);
    return `<details class="card"><summary><b>홈페이지 기술 점수</b> — 측정 불가</summary><p class="muted" style="margin-top:8px">${reason ? esc(reason) : '분석 불가'}</p></details>`;
  }
  const d = scoreRes.d;
  const pctVal = Math.round((d.score / 100) * 100);
  const bandLabel = d.score >= 70 ? '양호' : d.score >= 40 ? '개선 필요' : '시급';
  const bandColor = d.score >= 70 ? 'var(--teal)' : d.score >= 40 ? 'var(--gold-2)' : 'var(--amber)';

  const checks = (d.breakdown || []).map((x) => {
    const iconCls = x.status === 'ok' ? 'icon-ok' : x.status === 'warn' ? 'icon-warn' : 'icon-fail';
    const icon = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
    return `<div class="check-row">
      <div class="check-icon ${iconCls}">${icon}</div>
      <div class="check-text">
        <span class="check-label">${esc(x.label)}</span>
        ${x.why ? `<span class="check-why">${esc(x.why)}</span>` : ''}
      </div>
      <span class="check-pts">${x.points}/${x.max}</span>
    </div>`;
  }).join('');

  const metaItems = [
    { label: 'llms.txt 파일', val: d.hasLlmsTxt, note: 'AI 전용 색인 파일 있음' },
    { label: 'Google Maps', val: d.hasMapEmbed, note: '지도 삽입 있음' },
    { label: '비급여 가격 안내', val: d.hasPriceInfo, note: '가격 키워드 감지됨' },
  ].map((m) => `<div class="check-row">
    <div class="check-icon ${m.val ? 'icon-ok' : 'icon-fail'}">${m.val ? '✓' : '○'}</div>
    <div class="check-text"><span class="check-label">${esc(m.label)}</span>${m.val ? `<span class="check-why">${esc(m.note)}</span>` : ''}</div>
    <span class="check-pts" style="color:var(--text-2);font-size:.75rem">참고</span>
  </div>`).join('');

  const body = `<div class="score-visual">
    <div class="score-big">${d.score}<small>/100</small></div>
    <div class="score-meaning">
      <span style="font-weight:700;color:${bandColor}">${bandLabel}</span>
      <div class="score-bar-wrap"><div class="score-bar-fill" data-pct="${pctVal}" style="width:0%"></div></div>
      <div class="muted small" style="margin-top:4px">AI가 이 사이트를 읽고 추출할 수 있는 준비 수준</div>
    </div>
  </div>
  ${checks}
  <p class="muted small" style="margin:10px 0 4px;text-align:center">─ 추가 확인 항목 ─</p>
  ${metaItems}`;

  return `<details class="card"><summary><b style="font-size:.95rem">홈페이지 기술 점수 ${d.score}/100</b> <span class="muted small">(클릭해서 세부 항목 보기)</span></summary><div style="margin-top:14px">${body}</div></details>`;
}

function card(title, bodyHtml, cls) {
  return `<div class="card ${cls || ''}"><b style="font-size:1rem">${esc(title)}</b><div style="margin-top:8px">${bodyHtml}</div></div>`;
}
