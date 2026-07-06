'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

let lastScoreData = null;
let lastScoredUrl = '';
let emailGatePassed = false; // 이메일 제출 후 재스캔 시에도 게이트 항목 유지

// URL ?key= 자동 저장 (베타 공유용)
(function () {
  const k = new URLSearchParams(location.search).get('key');
  if (k) { localStorage.setItem('opKey', k); history.replaceState(null, '', location.pathname); }
})();

// scoreForm submit → URL 검증 후 바로 진단 (value-first: 점수를 먼저 보여주고, 리드는 결과 뒤 이메일 게이트에서)
$('scoreForm').addEventListener('submit', (e) => {
  e.preventDefault();
  let url = $('urlInput').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  $('urlInput').value = url;
  lastScoredUrl = url;
  runScan();
});

// 실제 진단 실행
async function runScan() {
  const url = lastScoredUrl;
  if (!url) return;
  hide('result'); hide('error'); show('loading');
  $('goBtn').disabled = true; $('goBtn').textContent = '진단 중...';
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    hide('loading');
    if (!res.ok) { showError(data); return; }
    render(data);
  } catch (err) {
    hide('loading');
    showError({ message: '네트워크 오류로 측정하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  } finally {
    $('goBtn').disabled = false; $('goBtn').textContent = '진단받기';
  }
}

// Unmeasurable != failure != score 0 (AD-17). Distinguish the reason so a citable site that we
// simply couldn't read (expired cert, block, timeout) reads as "측정 불가 + 고칠 거리", not "낙제".
function showError(data) {
  const reason = (data && data.reason) || '';
  const detail = (data && data.detail) || '';
  let msg;
  if (/cert|certificate|TLS|SSL|self.?signed|expired/i.test(detail) || reason === 'tls-cert') {
    msg = '이 사이트는 보안 인증서가 만료·오류 상태라 AI도 안전하게 읽지 못합니다. 점수가 낮은 게 아니라 측정 불가 — 인증서부터 고치면 AI 노출의 기본 조건이 갖춰집니다.';
  } else if (reason === 'blocked-ip' || reason === 'dns-failed' || reason === 'dns-empty' || reason === 'invalid-url') {
    msg = '해당 주소를 찾을 수 없습니다. 홈페이지 주소가 맞는지 확인해 주세요 (존재하지 않거나 내부 주소일 수 있습니다).';
  } else if (reason === 'timeout' || reason === 'connect-failed' || reason === 'read-failed') {
    msg = '사이트 응답이 없어 측정하지 못했습니다 (차단·시간초과). 측정 불가이며 점수 0이 아닙니다 — 잠시 후 다시 시도해 주세요.';
  } else if (reason === 'too-many-redirects') {
    msg = '리다이렉트가 너무 많아 측정하지 못했습니다.';
  } else {
    msg = (data && data.message) || '잠시 후 다시 시도해 주세요.';
  }
  $('errMsg').textContent = msg;
  show('error');
  requestAnimationFrame(() => {
    $('error').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function render(d) {
  lastScoreData = d;
  // score meter — clamp to 0–100 so a malformed score never renders broken text/bar
  const score = Math.max(0, Math.min(100, Number(d.score) || 0));
  $('scoreNum').innerHTML = `${score}<small style="font-size:.45em;color:var(--text-2);font-weight:400">/100</small>`;
  $('bandLabel').textContent = d.band;
  $('verdict').textContent = verdictLine(d);
  show('result');
  requestAnimationFrame(() => { $('scoreBar').style.width = score + '%'; });

  // render-mode honesty note
  if (d.renderMode && d.renderMode.startsWith('js-shell')) {
    $('renderNote').textContent = '⚠ 자바스크립트로 그려지는 사이트라 일부 신호를 읽지 못했습니다 — 정밀 측정은 상세 감사가 필요합니다.';
    show('renderNote');
  } else {
    hide('renderNote');
  }

  // breakdown
  const bd = $('breakdown');
  bd.innerHTML = '';
  for (const x of (d.breakdown || [])) { // defensive: missing breakdown shouldn't throw mid-render
    const mark = x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗';
    const el = document.createElement('div');
    el.className = 'item';
    el.innerHTML =
      `<span class="mark ${x.status}">${mark}</span>` +
      `<div class="t"><b>${esc(x.label)}</b><small>${esc(x.note || '')}</small>` +
      (x.why ? `<small class="why">왜: ${esc(x.why)}</small>` : '') + `</div>` +
      `<span class="pts">${x.points}/${x.max}</span>`;
    bd.appendChild(el);
  }

  // fixes
  const fx = $('fixes');
  fx.innerHTML = '';
  if (!d.topFixes || d.topFixes.length === 0) {
    fx.innerHTML = '<p class="muted small">기본 구조는 잘 갖춰져 있습니다. 실측 인용 결과로 다음 단계를 잡으세요.</p>';
  }
  (d.topFixes || []).forEach((f) => {
    const el = document.createElement('div');
    el.className = 'fix';
    el.innerHTML = `<span class="gain">+${f.gain}<small>점</small></span><div>${esc(f.fix)}` +
      `<small class="muted" style="display:block">${esc(f.gainLabel || '구조 위생 점수 · 인용 예측 아님')}</small></div>`;
    fx.appendChild(el);
  });

  // meta
  const when = d.measuredAt ? new Date(d.measuredAt).toLocaleString('ko-KR') : '';
  $('meta').textContent = `측정 ${when} · 방법론 ${d.methodologyVersion || 'v0.1'} · 대상 ${d.domain || ''} · ${d.renderMode || ''}`;

  // 이메일 게이트 이하 항목 — 이미 제출했으면 바로 공개, 아니면 숨김
  const _fc = document.getElementById('fixesCard');
  const _rc = document.getElementById('resultCtaCard');
  const _cc = document.getElementById('compareCard');
  if (emailGatePassed) {
    [_fc, _rc, _cc].forEach(el => { if (el) el.classList.remove('hidden'); });
    hide('leadForm');
  } else {
    [_fc, _rc, _cc].forEach(el => { if (el) el.classList.add('hidden'); });
    show('leadForm');
    hide('leadOk');
  }

  // 결과 섹션으로 스크롤
  requestAnimationFrame(() => {
    document.getElementById('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // 운영자 키 있으면 이메일 게이트 생략 — 직접 실측 패널 + 게이트 항목 표시
  const _opKey = localStorage.getItem('opKey');
  if (_opKey) {
    hide('leadForm');
    [_fc, _rc, _cc].forEach(el => { if (el) el.classList.remove('hidden'); });
    $('citationPanel').innerHTML = '<p class="muted small" style="padding:8px 0">AI 실측 중 (ChatGPT·Perplexity·Gemini)...</p>';
    show('citationPanel');
    autoFetchCitation(_opKey);
  }
}

async function autoFetchCitation(key) {
  const url = lastScoredUrl || $('urlInput').value.trim();
  if (!url) return;
  try {
    const res = await fetch('/api/citation', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-operator-key': key },
      body: JSON.stringify({ url, clinicName: (lastScoreData && lastScoreData.clinicNameGuess) || '' }),
    });
    const data = await res.json().catch(() => null);
    if (data && Array.isArray(data.perEngine) && data.perEngine.length) {
      $('citationPanel').innerHTML = renderCitation(data);
    } else {
      $('citationPanel').innerHTML = `<div class="muted small">${esc(data?.message || '실측 결과 준비 중입니다.')}</div>`;
    }
  } catch {
    $('citationPanel').innerHTML = '';
    hide('citationPanel');
    show('leadForm');
  }
}

// Opportunity framing — never grades/낙제, attribute gaps to page structure, not the dentist.
function verdictLine(d) {
  if (d.score >= 75) return 'AI가 인용하기 좋은 구조를 잘 갖추고 있습니다.';
  if (d.score >= 50) return '기본기는 갖췄고, 몇 가지만 보완하면 인용 가능성이 더 올라갑니다.';
  if (d.score >= 30) return '개선 여지가 큽니다 — 아래 항목이 채워지면 AI가 찾기 쉬워집니다.';
  return '아직 AI가 인용할 구조가 거의 비어 있습니다. 좋은 소식은, 대부분 몇 가지 수정으로 채울 수 있다는 점입니다.';
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Email gate → real-citation panel (/api/citation). Pending (lead-captured) until keys enabled.
$('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('emailInput').value.trim();
  const url = lastScoredUrl || $('urlInput').value.trim(); // 실측은 점수 낸 URL로 — 입력란 수정돼도 불일치 방지
  $('leadBtn').disabled = true;
  $('leadBtn').textContent = '신청 중...';
  let data = null;
  try {
    const res = await fetch('/api/citation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, url, clinicName: (lastScoreData && lastScoreData.clinicNameGuess) || '' }),
    });
    data = await res.json().catch(() => null);
  } catch (_) { /* non-blocking */ }
  emailGatePassed = true;
  hide('leadForm');
  // 게이트 항목 공개
  const _gfc = document.getElementById('fixesCard');
  const _grc = document.getElementById('resultCtaCard');
  const _gcc = document.getElementById('compareCard');
  [_gfc, _grc, _gcc].forEach(el => { if (el) el.classList.remove('hidden'); });
  if (_gfc) _gfc.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (data && Array.isArray(data.perEngine) && data.perEngine.length) {
    const citationHtml = renderCitation(data);
    $('citationPanel').innerHTML = citationHtml;
    show('citationPanel');
    $('leadOk').textContent = '';
    show('leadOk');
  } else {
    $('leadOk').textContent = (data && !data.error && data.message) || '신청되었습니다. 개선 가이드와 실측 결과를 이메일로 보내드리겠습니다.';
    show('leadOk');
  }
});

// ── 경쟁 치과 비교 분석 ──────────────────────────────────────────
$('compareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let compUrl = $('compareUrl').value.trim();
  if (!compUrl) return;
  if (!/^https?:\/\//i.test(compUrl)) compUrl = 'https://' + compUrl;

  const btn = $('compareBtn');
  btn.disabled = true; btn.textContent = '분석 중...';
  $('compareResult').innerHTML = '';
  show('compareLoading');

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: compUrl }),
    });
    const compData = await res.json();
    hide('compareLoading');
    if (!res.ok) {
      $('compareResult').innerHTML = `<div class="err"><b>분석 실패</b> — ${esc(compData.message || 'URL을 확인해주세요.')}</div>`;
    } else {
      $('compareResult').innerHTML = renderComparePanel(compData);
      requestAnimationFrame(() => {
        const bar = $('compareResult').querySelector('.cmp-score-bar-fill');
        if (bar) bar.style.width = bar.dataset.pct + '%';
      });
    }
  } catch {
    hide('compareLoading');
    $('compareResult').innerHTML = `<div class="err"><b>네트워크 오류</b> — 잠시 후 다시 시도해주세요.</div>`;
  } finally {
    btn.disabled = false; btn.textContent = '비교 분석';
  }
});

function renderComparePanel(compData) {
  if (!lastScoreData || !compData) return '<p class="muted small" style="padding:12px">비교 데이터를 불러올 수 없습니다.</p>';

  const uD = lastScoreData;
  const cD = compData;
  const uBreakdown = uD.breakdown || [];
  const cBreakdown = cD.breakdown || [];
  const uDomain = uD.domain || '우리 사이트';
  const cDomain = cD.domain || '비교 사이트';

  const compMap = Object.fromEntries(cBreakdown.map((c) => [c.label, c]));
  const gaps = [], same = [], uBetter = [];
  for (const u of uBreakdown) {
    const c = compMap[u.label];
    if (!c) continue;
    const uOk = u.status === 'ok';
    const cOk = c.status === 'ok';
    if (!uOk && cOk) gaps.push({ label: u.label, note: c.note });
    else if (uOk && cOk) same.push({ label: u.label });
    else if (uOk && !cOk) uBetter.push({ label: u.label });
  }

  const row = (label, uOk, cOk) => `<div class="cmp-row">
    <div class="cmp-label">${esc(label)}</div>
    <div class="cmp-val ${uOk ? 'ok' : 'fail'}">${uOk ? '✓' : '✗'}</div>
    <div class="cmp-val ${cOk ? 'ok' : 'fail'}">${cOk ? '✓' : '✗'}</div>
  </div>`;

  const secHead = (text) => `<div class="cmp-section-head">${text}</div>`;

  return `<div class="card cmp-result-card">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <b>📊 GEO 신호 비교</b>
      <button type="button" onclick="document.getElementById('compareResult').innerHTML=''" class="btn s" style="padding:6px 12px;font-size:.75rem">닫기</button>
    </div>
    <div class="cmp-domains">
      <div class="cmp-domain-chip user-chip">
        <div class="cmp-chip-label">📍 ${esc(uDomain)}</div>
        <div class="cmp-chip-score">${uD.score}<small>/100</small></div>
      </div>
      <div class="cmp-vs-text">vs</div>
      <div class="cmp-domain-chip comp-chip">
        <div class="cmp-chip-label">🔍 ${esc(cDomain)}</div>
        <div class="cmp-chip-score">${cD.score}<small>/100</small></div>
        <div class="cmp-score-bar-wrap"><div class="cmp-score-bar-fill" data-pct="${cD.score}" style="width:0%"></div></div>
      </div>
    </div>
    <div style="font-size:.72rem;color:var(--text-2);margin-bottom:4px;text-align:right">${esc(uDomain)} · ${esc(cDomain)}</div>
    ${gaps.length ? secHead(`⬆️ 경쟁사에 있고 우리에 없는 항목 (${gaps.length}개)`) + `<div class="cmp-note">이 항목들이 AI 추천 격차의 구조적 원인일 수 있습니다</div>` + gaps.map((g) => row(g.label, false, true)).join('') : ''}
    ${same.length ? secHead(`✅ 양쪽 모두 통과 (${same.length}개)`) + same.map((g) => row(g.label, true, true)).join('') : ''}
    ${uBetter.length ? secHead(`📌 우리만 통과 (${uBetter.length}개)`) + uBetter.map((g) => row(g.label, true, false)).join('') : ''}
    ${!gaps.length && !same.length && !uBetter.length ? '<p class="muted small" style="margin-top:8px">비교 가능한 신호 데이터가 없습니다.</p>' : ''}
    <p class="small muted" style="margin-top:12px;font-size:.73rem">기술 점수 비교 — AI 추천과 직접 인과관계 없음 (구조 위생 지표)</p>
  </div>`;
}

// 4 honest states. Never a bare "측정 안 됨"=0; never a CI/upper-bound next to 0 cited (의료광고법 A-2).
function renderCitation(d) {
  const label = { chatgpt: 'ChatGPT (API)', perplexity: 'Perplexity (API)', claude: 'Claude (API)' };
  const pct = (x) => Math.round((x || 0) * 100);
  const rows = (d.perEngine || []).map((p) => {
    let v;
    if (!p.measured) {
      const why = p.unmeasurable === 'engine-error' ? '엔진 오류로 측정 실패'
        : p.unmeasurable === 'no-search' ? '엔진이 이 회차 검색을 안 함'
        : '측정 전 (키 필요)';
      v = `측정 안 됨 — ${why} · 0% 아님`;
    } else if (p.cited) {
      const ci = p.ci ? ` · 신뢰구간 ${pct(p.ci.low)}–${pct(p.ci.high)}%` : '';
      v = `✓ ${p.validRuns}회 중 ${p.citedRuns}회 추천 (${pct(p.hitRate)}%${ci}) · N=${p.validRuns} 소표본`;
    } else if (p.namedRuns > 0) {
      v = `≈ 이름으로 ${p.namedRuns}회 언급 (직접 링크는 없음) — 노출은 되나 출처 연결이 약함`;
    } else {
      v = `이 표본엔 미인용 (0/${p.validRuns}) — "추천 안 함"이 아니라 이번 표본 미관측`;
    }
    return `<div style="padding:5px 0;border-top:1px solid var(--border)"><b>${esc(label[p.engine] || p.engine)}</b> — ${esc(v)}</div>`;
  }).join('');
  return `<div><b>실측 인용 결과 — ${esc(d.clinicDomain || d.domain || '')}</b>${rows}` +
    `<div class="muted small" style="margin-top:8px">이 수치는 <b>개발자 API</b> 기준이며 일반 ChatGPT 앱 결과와 다를 수 있습니다. 특정 시점 관측이라 규제 업종(의료 등) 광고에 "추천·1위·인증"으로 인용 금지(의료광고법).</div>` +
    (d.note ? `<div class="muted small">${esc(d.note)}</div>` : '') + `</div>`;
}
