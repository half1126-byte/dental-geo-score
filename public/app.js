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

function showError(data) {
  const reasonMsg = {
    'fetch-blocked': '해당 주소를 불러올 수 없습니다 (접근 차단·내부 주소·존재하지 않는 사이트일 수 있습니다). 홈페이지 주소가 맞는지 확인해 주세요.',
  };
  $('errMsg').textContent = reasonMsg[data.error] || data.message || '잠시 후 다시 시도해 주세요.';
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
      `<div class="t"><b>${esc(x.label)}</b><small>${esc(x.note || '')}</small></div>` +
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
    el.innerHTML = `<span class="gain">+${f.gain}</span><div>${esc(f.fix)}</div>`;
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

// Email gate (Phase 1 stub: captures intent; Phase 2 wires the real ChatGPT/Perplexity panel)
$('leadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('emailInput').value.trim();
  const url = $('urlInput').value.trim();
  $('leadBtn').disabled = true;
  try {
    await fetch('/api/lead', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, url }),
    });
  } catch (_) { /* stub — non-blocking */ }
  hide('leadForm');
  show('leadOk');
});
