import { agentCardHtml } from './agent-card.js';
import { dentalQueryVariants } from './query-preview.js';
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
  updatePreview();
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
  updatePreview();
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
  updatePreview();
});

$('opRegion').addEventListener('input', updatePreview);

function updatePreview() {
  const region = $('opRegion').value.trim();
  const prev = $('opPreview');
  if (!region && !selectedProcedure) { prev.style.display = 'none'; return; }
  const variants = dentalQueryVariants({ district: region, procedure: selectedProcedure });
  prev.style.display = 'block';
  prev.innerHTML = `<div class="qlabel">AI에게 보내는 질의</div><ol>${variants.map((v) => `<li>${esc(v)}</li>`).join('')}</ol>`;
}

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
    const citeRes = await fetch('/api/citation', {
      method: 'POST', headers,
      body: JSON.stringify({ url: lastUrl, region, procedure }),
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
    renderCitation(citeRes),
    renderGemini(q),
    renderImprovements(scoreRes),
    renderAgentActionability(scoreRes),
    renderHygiene(scoreRes),
  ];
  $('opResult').innerHTML = parts.join('');
  show('opResult');
}

function renderGemini(q) {
  const variants = dentalQueryVariants({ district: q.region, procedure: q.procedure });
  const rows = variants.map((v, i) => `
    <div style="padding:10px 0;border-top:1px solid var(--border)">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <code style="flex:1 1 180px;font-size:.85rem;background:rgba(255,255,255,.06);padding:4px 8px;border-radius:6px">${esc(v)}</code>
        <button type="button" class="chip" data-gcopy="${esc(v)}">복사</button>
        <a class="chip" href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer">Gemini 열기 ↗</a>
      </div>
      <div style="margin-top:6px;display:flex;gap:6px">
        <button type="button" class="chip" data-gset="${i}:cited">떴음 ✓</button>
        <button type="button" class="chip" data-gset="${i}:not">안 떴음</button>
        <button type="button" class="chip" data-gset="${i}:unsure">불확실</button>
      </div>
    </div>`).join('');
  return card('Gemini (수동 확인)',
    '<p class="muted small" style="margin-bottom:4px">Gemini는 약관상 자동 측정 불가 — 문구 복사 후 직접 확인하고 결과를 클릭하세요.</p>'
    + rows + '<p class="small muted" id="gTally" style="margin-top:10px">기록 없음</p>', 'gate');
}

$('opResult').addEventListener('click', (e) => {
  const cp = e.target.closest('[data-gcopy]');
  if (cp) {
    const t = cp.getAttribute('data-gcopy');
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    cp.textContent = '복사됨'; setTimeout(() => { cp.textContent = '복사'; }, 1200);
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
  }
});

function renderCitation(citeRes) {
  if (!citeRes) return card('AI 실측', '<p class="muted">인용 측정에 실패했습니다.</p>');
  const d = citeRes.d || {};
  if (d.status === 'pending') return card('AI 실측 — 비활성', `<p class="muted">${esc(d.message || 'CITATION_ENABLED 키 필요.')}</p>`);
  if (d.status === 'cap-reached') return card('AI 실측 — 한도 소진', `<p class="muted">${esc(d.message || '오늘 한도 소진.')}</p>`);
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  if (!eng.length) return card('AI 실측', '<p class="muted">측정 결과 없음.</p>');

  const rows = eng.map((p) => {
    let head;
    if (!p.measured) {
      const why = p.unmeasurable === 'engine-error' ? '엔진 오류' : p.unmeasurable === 'no-search' ? '검색 미수행' : '키 필요';
      head = `<span class="mark fail">·</span> <b>${esc(ENGINE_LABEL[p.engine] || p.engine)}</b> — 측정 안 됨 (${esc(why)})`;
    } else if (p.cited) {
      head = `<span class="mark ok">✓</span> <b>${esc(ENGINE_LABEL[p.engine] || p.engine)}</b> — ${p.validRuns}회 중 ${p.citedRuns}회 인용 (${pct(p.hitRate)}%)`;
    } else {
      head = `<span class="mark warn">!</span> <b>${esc(ENGINE_LABEL[p.engine] || p.engine)}</b> — 이 표본 미인용 (0/${p.validRuns})`;
    }
    const ev = (p.evidence || []).filter((x) => x.matchedUrls && x.matchedUrls.length).flatMap((x) => x.matchedUrls);
    const evHtml = ev.length ? `<small class="muted" style="display:block;margin-top:4px">인용 위치: ${ev.slice(0, 4).map((u) => esc(u)).join(', ')}</small>` : '';
    const comp = (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain);
    const compHtml = comp.length ? `<small class="muted" style="display:block;margin-top:2px">AI가 함께 호명: ${comp.slice(0, 8).map((x) => esc(x)).join(', ')}</small>` : '';
    return `<div style="padding:10px 0;border-top:1px solid var(--border)">${head}${evHtml}${compHtml}</div>`;
  }).join('');

  const note = `<p class="muted small" style="margin-top:12px">개발자 API 기준 — 일반 ChatGPT 앱과 다를 수 있음. <b>환자 대상 광고에 인용 금지(의료광고법).</b></p>`;
  return card(`AI 실측 결과 — ${esc(d.clinicDomain || '')}`, rows + note, 'gate');
}

function renderImprovements(scoreRes) {
  const fixes = (scoreRes && scoreRes.d && scoreRes.d.topFixes) || [];
  const proven = `<div class="fix"><span class="gain" style="background:var(--teal);color:#04201d;border-radius:4px;padding:2px 8px">입증</span><div style="flex:1"><b>콘텐츠 인용성 강화</b><small class="muted" style="display:block;margin-top:2px">본문에 출처·통계·전문의 인용 추가 — AI 인용과 인과 입증된 유일 레버 (KDD'24)</small></div></div>`;
  const hygiene = fixes.map((f) => `<div class="fix"><span class="gain">+${f.gain}<small>점</small></span><div style="flex:1">${esc(f.fix)}<small class="muted" style="display:block;margin-top:2px">${esc(f.gainLabel || '구조 위생 점수 · 인용 예측 아님')}</small></div></div>`).join('');
  return card('개선 우선순위',
    proven + hygiene +
    '<p class="muted small" style="margin-top:10px">위생 점수↑ ≠ 인용↑ — robots·구조데이터·E-E-A-T는 필요조건(위생)이며 인용 예측 아님.</p>');
}

function renderAgentActionability(scoreRes) {
  const a = scoreRes && scoreRes.d && scoreRes.d.agentActionability;
  return agentCardHtml(a, { esc, card });
}

function renderHygiene(scoreRes) {
  if (!scoreRes || !scoreRes.ok) {
    const reason = scoreRes && scoreRes.d && (scoreRes.d.reason || scoreRes.d.message);
    return card('페이지 위생 점수', `<p class="muted">측정 불가${reason ? ' — ' + esc(reason) : ''}</p>`);
  }
  const d = scoreRes.d;
  const bd = (d.breakdown || []).map((x) => {
    const mark = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
    return `<div class="item"><span class="mark ${x.status}">${mark}</span><div class="t"><b>${esc(x.label)}</b><small>${esc(x.note || '')}</small>${x.why ? `<small class="why">왜: ${esc(x.why)}</small>` : ''}</div><span class="pts">${x.points}/${x.max}</span></div>`;
  }).join('');
  const meta = [
    { label: 'llms.txt', val: d.hasLlmsTxt, note: 'AI 읽기 전용 색인 파일 (점수 외)' },
    { label: 'Google Maps 삽입', val: d.hasMapEmbed, note: 'Maps/Place ID 감지 (점수 외)' },
    { label: '비급여 가격 안내', val: d.hasPriceInfo, note: '임플란트/교정/비급여 키워드 (점수 외)' },
  ].map((m) => `<div class="item"><span class="mark ${m.val ? 'ok' : ''}">${m.val ? '✓' : '○'}</span><div class="t"><b>${esc(m.label)}</b><small>${esc(m.note)}</small></div><span class="pts" style="color:var(--text-2);font-size:.78rem">참고</span></div>`).join('');
  const body = `<p class="small muted">${d.score}/100 · 필요조건(위생), 인용 예측 아님. ${esc(d.renderMode || '')}</p>${bd}<p class="small muted" style="margin:10px 0 4px">── 참고 메타데이터 (점수 외) ──</p>${meta}`;
  return `<details class="card"><summary><b>페이지 위생 점수 ${d.score}/100</b> (펼쳐보기)</summary><div style="margin-top:10px">${body}</div></details>`;
}

function card(title, bodyHtml, cls) {
  return `<div class="card ${cls || ''}"><b style="font-size:1rem">${esc(title)}</b><div style="margin-top:8px">${bodyHtml}</div></div>`;
}
