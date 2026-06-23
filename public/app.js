'use strict';
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');

$('scoreForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  let url = $('urlInput').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

  hide('result'); hide('error'); show('loading');
  $('goBtn').disabled = true; $('goBtn').textContent = '측정 중...';

  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    hide('loading');
    if (!res.ok) {
      showError(data);
      return;
    }
    render(data);
  } catch (err) {
    hide('loading');
    showError({ message: '네트워크 오류로 측정하지 못했습니다. 잠시 후 다시 시도해 주세요.' });
  } finally {
    $('goBtn').disabled = false; $('goBtn').textContent = '측정';
  }
});

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
}

function render(d) {
  // score meter
  $('scoreNum').innerHTML = `${d.score}<small>/100</small>`;
  $('bandLabel').textContent = d.band;
  $('verdict').textContent = verdictLine(d);
  show('result');
  requestAnimationFrame(() => { $('scoreBar').style.width = d.score + '%'; });

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
  for (const x of d.breakdown) {
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
  const url = $('urlInput').value.trim();
  $('leadBtn').disabled = true;
  $('leadBtn').textContent = '신청 중...';
  let data = null;
  try {
    const res = await fetch('/api/citation', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, url }),
    });
    data = await res.json().catch(() => null);
  } catch (_) { /* non-blocking */ }
  hide('leadForm');
  if (data && Array.isArray(data.perEngine) && data.perEngine.length) {
    $('leadOk').innerHTML = renderCitation(data);
  } else {
    $('leadOk').textContent = (data && data.message) || '신청되었습니다. 실측 인용 결과를 이메일로 보내드리겠습니다.';
  }
  show('leadOk');
});

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
    } else {
      v = `이 표본엔 미인용 (0/${p.validRuns}) — "추천 안 함"이 아니라 이번 표본 미관측`;
    }
    return `<div style="padding:5px 0;border-top:1px solid var(--border)"><b>${esc(label[p.engine] || p.engine)}</b> — ${esc(v)}</div>`;
  }).join('');
  return `<div><b>실측 인용 결과 — ${esc(d.clinicDomain || d.domain || '')}</b>${rows}` +
    `<div class="muted small" style="margin-top:8px">이 수치는 <b>개발자 API</b> 기준이며 일반 ChatGPT 앱 결과와 다를 수 있습니다. 특정 시점 관측이라 환자 대상 광고에 "추천·1위·인증"으로 인용 금지(의료광고법).</div>` +
    (d.note ? `<div class="muted small">${esc(d.note)}</div>` : '') + `</div>`;
}
