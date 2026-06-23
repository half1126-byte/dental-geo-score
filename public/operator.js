import { agentCardHtml } from './agent-card.js';
import { dentalQueryVariants } from './query-preview.js';
import { REGION_TERMS } from './kr-regions.js';

const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => Math.round((x || 0) * 100);
const ENGINE_LABEL = { chatgpt: 'ChatGPT (API)', perplexity: 'Perplexity (API)', claude: 'Claude (API)' };

let lastScoreRes = null;   // /api/score result (page analysis), reused at measure time
let lastUrl = '';
let selectedProcedure = '';
let geminiVerdicts = [];   // per-phrase manual verdict: 'cited' | 'not' | 'unsure'

$('regionList').innerHTML = REGION_TERMS.map((r) => `<option value="${esc(r)}">`).join('');
$('opKey').value = localStorage.getItem('opKey') || '';

// ── PHASE 1: 분석 (free /api/score → auto-detect region + procedure) ──────────
$('opForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = $('opUrl').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  localStorage.setItem('opKey', $('opKey').value.trim());
  lastUrl = url;

  hide('opResult'); hide('opError'); hide('opConfirm');
  $('opLoadMsg').textContent = '페이지 분석 중 (지역·진료 자동 감지)...'; show('opLoading');
  $('opBtn').disabled = true; $('opBtn').textContent = '분석 중...';
  try {
    const scoreRes = await fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null);
    hide('opLoading');
    if (!scoreRes || !scoreRes.ok) {
      const why = scoreRes && scoreRes.d && (scoreRes.d.message || scoreRes.d.reason);
      showError('페이지 분석 실패 — URL 확인' + (why ? ' (' + esc(why) + ')' : ''));
      return;
    }
    lastScoreRes = scoreRes;
    populateConfirm(scoreRes.d);
    show('opConfirm');
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opBtn').disabled = false; $('opBtn').textContent = '분석';
  }
});

function populateConfirm(d) {
  const g = d.locationGuess;
  $('opRegion').value = (g && g.region) || '';
  $('opRegionHint').textContent = g ? `감지된 주소: ${g.raw || g.region}` : '주소 자동감지 실패 — 직접 입력하세요';
  const procs = d.procedureGuess || [];
  selectedProcedure = procs.length ? procs[0].q : '';
  renderProcChips(procs.map((p) => ({ q: p.q, label: p.label })));
  updatePreview();
}

function renderProcChips(items) {
  if (!items.length) { $('opProcChips').innerHTML = '<span class="muted small">감지된 진료 없음 — 아래에 직접 입력</span>'; return; }
  $('opProcChips').innerHTML = items
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
  if (!region && !selectedProcedure) { $('opPreview').innerHTML = '<span class="muted small">지역/진료를 확인하면 측정 문구가 여기에 표시됩니다.</span>'; return; }
  const variants = dentalQueryVariants({ district: region, procedure: selectedProcedure });
  $('opPreview').innerHTML = `<b>이 문구로 측정합니다:</b><ol style="margin:6px 0 0 18px;padding:0">${variants.map((v) => `<li>${esc(v)}</li>`).join('')}</ol>`;
}

// ── PHASE 2: 측정 (paid /api/citation with confirmed region + procedure) ──────
$('opMeasureBtn').addEventListener('click', async () => {
  const key = $('opKey').value.trim();
  const region = $('opRegion').value.trim();
  const procedure = selectedProcedure;
  if (!region && !procedure) { showError('지역 또는 진료를 확인해주세요.'); return; }

  hide('opError'); hide('opResult');
  $('opLoadMsg').textContent = 'ChatGPT·Perplexity에 실제 질의해 인용 측정 중 (최대 1~2분)...'; show('opLoading');
  $('opMeasureBtn').disabled = true; $('opMeasureBtn').textContent = '측정 중...';
  try {
    const headers = { 'content-type': 'application/json', 'x-operator-key': key };
    const citeRes = await fetch('/api/citation', { method: 'POST', headers, body: JSON.stringify({ url: lastUrl, region, procedure }) })
      .then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null);
    hide('opLoading');
    if (citeRes && citeRes.status === 401) { showError('운영자 키가 틀렸습니다.'); return; }
    render(lastScoreRes, citeRes, { region, procedure });
  } catch {
    hide('opLoading'); showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opMeasureBtn').disabled = false; $('opMeasureBtn').textContent = '측정 (유료 API)';
  }
});

function showError(msg) { $('opErrMsg').innerHTML = msg; show('opError'); }

function render(scoreRes, citeRes, q) {
  geminiVerdicts = [];
  const parts = [
    renderCitation(citeRes),                 // 1) 자동 실측 헤드라인 (ChatGPT+Perplexity)
    renderGemini(q),                         // 2) Gemini #2 — 수동 캡처
    renderImprovements(scoreRes),            // 3) 개선 우선순위
    renderAgentActionability(scoreRes),      // 4) 에이전트 실행성 (별도 분수)
    renderHygiene(scoreRes),                 // 5) 위생 점수 footnote
  ];
  $('opResult').innerHTML = parts.join('');
  show('opResult');
}

function renderGemini(q) {
  const variants = dentalQueryVariants({ district: q.region, procedure: q.procedure });
  const rows = variants.map((v, i) => `
    <div style="padding:8px 0;border-top:1px solid var(--border)">
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <code style="flex:1 1 200px">${esc(v)}</code>
        <button type="button" class="chip" data-gcopy="${esc(v)}">문구 복사</button>
        <a class="chip" href="https://gemini.google.com/app" target="_blank" rel="noopener noreferrer">Gemini 열기</a>
      </div>
      <div style="margin-top:4px">
        <button type="button" class="chip" data-gset="${i}:cited">떴음</button>
        <button type="button" class="chip" data-gset="${i}:not">안 떴음</button>
        <button type="button" class="chip" data-gset="${i}:unsure">불확실</button>
      </div>
    </div>`).join('');
  return card('Gemini (한국 #2 · 운영자 수동 확인)',
    '<p class="muted small">Gemini는 약관상 자동 측정 불가 → 같은 문구를 직접 확인합니다. 문구 복사 → Gemini에 붙여넣고 → 우리 도메인이 떴는지 클릭. <b>리포트엔 "수동 확인"으로 표기.</b></p>'
    + rows + '<p class="small muted" id="gTally" style="margin-top:8px">Gemini(수동): 미기록</p>', 'gate');
}

// delegated: Gemini copy + verdict capture
$('opResult').addEventListener('click', (e) => {
  const cp = e.target.closest('[data-gcopy]');
  if (cp) {
    const t = cp.getAttribute('data-gcopy');
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    cp.textContent = '복사됨'; setTimeout(() => { cp.textContent = '문구 복사'; }, 1200);
    return;
  }
  const set = e.target.closest('[data-gset]');
  if (set) {
    const [idx, val] = set.getAttribute('data-gset').split(':');
    geminiVerdicts[+idx] = val;
    set.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === set));
    const n = geminiVerdicts.filter(Boolean).length;
    const cited = geminiVerdicts.filter((v) => v === 'cited').length;
    const el = $('gTally'); if (el) el.textContent = `Gemini(수동): ${n}개 기록 · 떴음 ${cited}건 (운영자 확인 · 약관상 자동측정 불가)`;
  }
});

function renderCitation(citeRes) {
  if (!citeRes) return card('실측', '<p class="muted">인용 측정에 실패했습니다.</p>');
  const d = citeRes.d || {};
  if (d.status === 'pending') return card('실측 — 측정 비활성', `<p class="muted">${esc(d.message || '키/CITATION_ENABLED 필요.')}</p>`);
  if (d.status === 'cap-reached') return card('실측 — 한도 소진', `<p class="muted">${esc(d.message || '오늘 한도 소진.')}</p>`);
  const eng = Array.isArray(d.perEngine) ? d.perEngine : [];
  if (!eng.length) return card('실측', '<p class="muted">측정 결과 없음.</p>');

  const rows = eng.map((p) => {
    let head;
    if (!p.measured) {
      const why = p.unmeasurable === 'engine-error' ? '엔진 오류로 측정 실패' : p.unmeasurable === 'no-search' ? '엔진이 검색을 안 함' : '키 필요';
      head = `<span class="mark fail">·</span> ${esc(ENGINE_LABEL[p.engine] || p.engine)} — 측정 안 됨 (${esc(why)} · 0% 아님)`;
    } else if (p.cited) {
      head = `<span class="mark ok">✓</span> <b>${esc(ENGINE_LABEL[p.engine] || p.engine)}</b> — ${p.validRuns}회 중 ${p.citedRuns}회 추천 (${pct(p.hitRate)}%) · N=${p.validRuns}`;
    } else {
      head = `<span class="mark warn">!</span> ${esc(ENGINE_LABEL[p.engine] || p.engine)} — 이 표본 미인용 (0/${p.validRuns}) · "추천 안 함" 아님`;
    }
    const ev = (p.evidence || []).filter((x) => x.matchedUrls && x.matchedUrls.length).flatMap((x) => x.matchedUrls);
    const evHtml = ev.length ? `<small class="muted" style="display:block">인용 증거: ${ev.slice(0, 4).map((u) => esc(u)).join(', ')}</small>` : '';
    const comp = (p.sampledCitedDomains || []).filter((x) => x && x !== d.clinicDomain);
    const compHtml = comp.length ? `<small class="muted" style="display:block">이 질의에 AI가 함께 호명한 치과(${comp.length}): ${comp.slice(0, 8).map((x) => esc(x)).join(', ')}</small>` : '';
    return `<div style="padding:8px 0;border-top:1px solid var(--border)">${head}${evHtml}${compHtml}</div>`;
  }).join('');

  const note = `<p class="muted small" style="margin-top:10px">${esc(d.note || '')} 개발자 API 기준 — 일반 ChatGPT 앱과 다를 수 있음. <b>환자 대상 광고에 "추천·1위·인증"으로 인용 금지(의료광고법).</b></p>`;
  return card(`실측 — AI가 실제로 추천하나 (${esc(d.clinicDomain || '')})`, rows + note, 'gate');
}

function renderImprovements(scoreRes) {
  const fixes = (scoreRes && scoreRes.d && scoreRes.d.topFixes) || [];
  const proven = `<div class="fix"><span class="gain" style="background:var(--teal);color:#04201d">입증</span><div><b>콘텐츠 인용성 강화</b> — 본문에 출처·통계·전문가(전문의) 인용을 넣기.<small class="muted" style="display:block">AI 인용과 인과가 입증된 유일 레버(Princeton GEO, KDD'24). 단 실험실 한정.</small></div></div>`;
  const hygiene = fixes.map((f) => `<div class="fix"><span class="gain">+${f.gain}<small>점</small></span><div>${esc(f.fix)}<small class="muted" style="display:block">${esc(f.gainLabel || '구조 위생 점수 · 인용 예측 아님')}</small></div></div>`).join('');
  return card('개선 우선순위 (공식근거 기준)', proven + hygiene + '<p class="muted small">robots·구조화데이터·E-E-A-T·PSI는 위생(필요조건)이며 Google도 "직접 순위영향 없음"으로 명시 — "점수↑→인용↑" 아님.</p>');
}

function renderAgentActionability(scoreRes) {
  const a = scoreRes && scoreRes.d && scoreRes.d.agentActionability;
  return agentCardHtml(a, { esc, card });
}

function renderHygiene(scoreRes) {
  if (!scoreRes || !scoreRes.ok) {
    const reason = scoreRes && scoreRes.d && (scoreRes.d.reason || scoreRes.d.message);
    return card('페이지 위생 점수', `<p class="muted">측정 불가${reason ? ' — ' + esc(reason) : ''} (점수 0 아님).</p>`);
  }
  const d = scoreRes.d;
  const bd = (d.breakdown || []).map((x) => {
    const mark = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
    return `<div class="item"><span class="mark ${x.status}">${mark}</span><div class="t"><b>${esc(x.label)}</b><small>${esc(x.note || '')}</small>${x.why ? `<small class="why">왜: ${esc(x.why)}</small>` : ''}</div><span class="pts">${x.points}/${x.max}</span></div>`;
  }).join('');
  const body = `<p class="small muted">${d.score}/100 (${esc(d.band || '')}) · 페이지 추출 위생 — 뜨기 위한 <b>필요조건</b>, 노출 예측 아님. ${esc(d.renderMode || '')}</p>${bd}`;
  return `<details class="card"><summary><b>페이지 위생 점수 ${d.score}/100</b> (펼쳐보기)</summary>${body}</details>`;
}

function card(title, bodyHtml, cls) {
  return `<div class="card ${cls || ''}"><b>${esc(title)}</b><div style="margin-top:6px">${bodyHtml}</div></div>`;
}
