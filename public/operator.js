'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => Math.round((x || 0) * 100);
const ENGINE_LABEL = { chatgpt: 'ChatGPT (API)', perplexity: 'Perplexity (API)', claude: 'Claude (API)' };

$('opKey').value = localStorage.getItem('opKey') || '';

$('opForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = $('opKey').value.trim();
  let url = $('opUrl').value.trim();
  const region = $('opRegion').value.trim();
  const procedure = $('opProc').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  localStorage.setItem('opKey', key);

  hide('opResult'); hide('opError'); show('opLoading');
  $('opBtn').disabled = true; $('opBtn').textContent = '측정 중...';

  try {
    const headers = { 'content-type': 'application/json', 'x-operator-key': key };
    const [scoreRes, citeRes] = await Promise.all([
      fetch('/api/score', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null),
      fetch('/api/citation', { method: 'POST', headers, body: JSON.stringify({ url, region, procedure }) }).then((r) => r.json().then((d) => ({ ok: r.ok, status: r.status, d }))).catch(() => null),
    ]);
    hide('opLoading');
    if (citeRes && citeRes.status === 401) { showError('운영자 키가 틀렸습니다.'); return; }
    render(scoreRes, citeRes);
  } catch (err) {
    hide('opLoading');
    showError('네트워크 오류. 잠시 후 다시.');
  } finally {
    $('opBtn').disabled = false; $('opBtn').textContent = '측정';
  }
});

function showError(msg) { $('opErrMsg').textContent = msg; show('opError'); }

function render(scoreRes, citeRes) {
  const parts = [];

  // 1) HEADLINE — real citation (private: named competitors + evidence)
  parts.push(renderCitation(citeRes));

  // 2) Improvement guidance — credibility-graded (content-citability = only proven lever)
  parts.push(renderImprovements(scoreRes));

  // 3) FOOTNOTE — page-hygiene score (necessary-condition, NOT a citation predictor)
  parts.push(renderHygiene(scoreRes));

  $('opResult').innerHTML = parts.join('');
  show('opResult');
}

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
    // operator-only: cited evidence URLs + the named competitor clinics AI surfaced for this query
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
