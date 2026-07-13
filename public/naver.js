// 네이버 AI 진단 — 독립 페이지 (naver.html)
// AI탭·플레이스·예약 준비도: 판정 → 격차 → 수동 확인 → 상품 매핑.
// GEO 진단(operator.html)과 세션 공유(HttpOnly 쿠키), API는 /api/naver-place만 사용.
import { REGION_TERMS } from './kr-regions.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (id) => $(id) && $(id).classList.remove('hidden');
const hide = (id) => $(id) && $(id).classList.add('hidden');

// ── 로그인 (operator.html과 동일 세션) ─────────────────────────
async function validateSession() {
  try { return (await fetch('/api/auth-check', { method: 'POST' })).status === 200; }
  catch { return false; }
}
function showLogin(msg) {
  show('setupCard'); hide('keySaved'); hide('inputCard');
  const note = $('keyValidationNote');
  if (note) { note.textContent = msg || ''; note.classList.toggle('hidden', !msg); }
}
function showReady() { hide('setupCard'); show('keySaved'); show('inputCard'); }
(async () => { (await validateSession()) ? showReady() : showLogin(); })();

$('keySaveBtn').addEventListener('click', async () => {
  const val = $('opKey').value.trim();
  if (!val) return;
  const btn = $('keySaveBtn');
  btn.disabled = true; btn.textContent = '확인 중...';
  let r = null;
  try {
    r = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: val }) });
  } catch { /* handled below */ }
  btn.disabled = false; btn.textContent = '로그인';
  if (!(r && r.ok)) { showLogin('비밀번호가 맞지 않습니다.'); return; }
  $('opKey').value = '';
  showReady();
});
$('opKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('keySaveBtn').click(); });
$('keyChangeBtn').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch { /* UI still resets */ }
  showLogin();
});

// ── 입력 ────────────────────────────────────────────────────────
$('regionList').innerHTML = REGION_TERMS.map((r) => `<option value="${esc(r)}">`).join('');

const PROCEDURES = ['치아교정', '임플란트', '충치치료', '스케일링', '잇몸치료', '신경치료', '사랑니', '미백', '보철(크라운)', '턱관절'];
let selectedProc = PROCEDURES[0];
function renderProcChips() {
  $('nvProcChips').innerHTML = PROCEDURES.map((p) =>
    `<button type="button" class="chip${p === selectedProc ? ' on' : ''}" data-proc="${esc(p)}">${esc(p)}</button>`).join('');
}
renderProcChips();
$('nvProcChips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-proc]'); if (!b) return;
  selectedProc = b.getAttribute('data-proc');
  renderProcChips();
});

// ── 진단 실행 ───────────────────────────────────────────────────
let _abort = null;
$('nvRunBtn').addEventListener('click', async () => {
  const region = $('nvRegion').value.trim();
  const clinicName = $('nvName').value.trim();
  const clinicPhone = $('nvPhone').value.trim();
  hide('nvError'); hide('nvResult'); hide('printBar');
  if (!region || !selectedProc) { fail('지역과 진료 과목을 입력해주세요.'); return; }
  if (!clinicName && !clinicPhone) { fail('치과명 또는 전화번호 중 하나는 필요합니다 (플레이스 매칭 기준).'); return; }

  _abort?.abort(); _abort = new AbortController();
  show('nvLoading');
  $('nvRunBtn').disabled = true;
  try {
    const r = await fetch('/api/naver-place', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ region, procedure: selectedProc, clinicName, clinicPhone }),
      signal: _abort.signal,
    });
    const data = await r.json().catch(() => ({}));
    hide('nvLoading');
    $('nvRunBtn').disabled = false;
    if (r.status === 401) { showLogin('로그인 세션이 만료되었습니다. 다시 로그인해주세요.'); return; }
    if (!r.ok || data.error) { fail('네이버 플레이스 조회 실패 — 잠시 후 재시도하세요.'); return; }
    $('nvResult').innerHTML = render(data, { region, procedure: selectedProc, clinicName });
    show('nvResult'); show('printBar');
    $('nvResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    hide('nvLoading');
    $('nvRunBtn').disabled = false;
    if (e?.name !== 'AbortError') fail('네트워크 오류 — 다시 시도해주세요.');
  }
});
function fail(msg) { $('nvError').innerHTML = `<p style="font-size:.88rem;color:#f05e6a">${esc(msg)}</p>`; show('nvError'); }

// ── 렌더: ① 판정 ② 플레이스·격차 ③ AI탭 수동 ④ 상품 매핑 ─────
const fmt = (n) => (n != null ? Number(n).toLocaleString('ko-KR') : '—');

function render(data, q) {
  const target = data.target;
  const comps = data.competitors || [];
  const top = comps[0] || null;
  const booking = target ? Number(target.bookingReviews || 0) : 0;
  const bookingOk = !!target && booking > 0;
  const reviewGapBig = !!(target && top && (Number(top.visitorReviews || 0) >= Number(target.visitorReviews || 0) * 2
    || Number(top.blogReviews || 0) >= Number(target.blogReviews || 0) * 2));

  return `
    ${sectionLabel('1', '판정 — AI탭 실행 플로우에 탑승 가능한가')}
    ${renderVerdict(target, booking, bookingOk)}
    ${sectionLabel('2', '플레이스 현황과 경쟁 격차')}
    ${renderPlace(data, target, comps, top)}
    ${sectionLabel('3', 'AI탭·AI브리핑 — 직접 확인 (수동)')}
    ${renderAitabCheck(q)}
    ${sectionLabel('4', '개선 → 담당 상품')}
    ${renderProductMap({ bookingOk, targetFound: !!target, reviewGapBig })}`;
}

function sectionLabel(n, text) {
  return `<div class="nv-section-label"><span class="num">${n}</span> ${esc(text)}</div>`;
}

function renderVerdict(target, booking, bookingOk) {
  if (!target) return `<div class="result-verdict na"><span class="rv-icon">—</span><span class="rv-text"><b>플레이스에서 이 치과를 식별하지 못했습니다</b> — 이름·전화 정합부터 확인이 필요합니다. AI탭은 플레이스·예약 데이터로 실행하는 검색이라, 여기서 안 잡히면 시작점이 없습니다.</span></div>`;
  if (bookingOk) return `<div class="result-verdict ok"><span class="rv-icon">✓</span><span class="rv-text"><b>네이버 예약 운영 확인</b> — 예약리뷰 ${fmt(booking)}건. AI탭의 "예약 가능한 치과" 실행 질의에서 후보 조건을 갖췄습니다. 다음 단계는 인용 자산(블로그·리뷰) 축적입니다.</span></div>`;
  return `<div class="result-verdict warn"><span class="rv-icon">🟡</span><span class="rv-text"><b>네이버 예약 리뷰 0건</b> — 예약 미운영 또는 이용 초기로 보입니다. AI탭은 예약까지 실행하는 검색이라, "예약 가능한" 조건이 붙는 질의에서 후보가 되기 어렵습니다. 예약 연동 여부를 확인하세요.</span></div>`;
}

function gapBars(target, top) {
  if (!target || !top) return '';
  const row = (label, mine, theirs) => {
    const m = Number(mine || 0), t = Number(theirs || 0);
    const max = Math.max(m, t, 1);
    const gapTxt = t > m && m > 0 ? `격차 ×${(t / m).toFixed(1)}` : t > m ? '격차 큼' : '우위';
    const gapColor = t > m ? '#f05e6a' : 'var(--ngreen)';
    const bar = (v, color) => `<div style="height:8px;border-radius:4px;background:${color};width:${Math.max(2, (v / max) * 100).toFixed(1)}%"></div>`;
    return `<div style="margin-top:8px">
      <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-2)">
        <span>${label}</span><span style="color:${gapColor};font-weight:700">${gapTxt}</span>
      </div>
      <div style="display:grid;grid-template-columns:52px 1fr 60px;gap:6px;align-items:center;margin-top:3px;font-size:.7rem;color:var(--text-2)">
        <span>우리</span>${bar(m, 'rgba(3,199,90,.75)')}<span style="text-align:right">${m.toLocaleString('ko-KR')}</span>
        <span>경쟁 1위</span>${bar(t, 'rgba(240,94,106,.6)')}<span style="text-align:right">${t.toLocaleString('ko-KR')}</span>
      </div>
    </div>`;
  };
  return `<div style="margin-top:10px">${row('방문자리뷰', target.visitorReviews, top.visitorReviews)}${row('블로그리뷰', target.blogReviews, top.blogReviews)}</div>`;
}

function renderPlace(data, target, comps, top) {
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
        ${gapBars(target, top)}
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
  return `<div class="nv-card">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <b>📍 "${esc(data.query)}"</b>
      ${total != null ? `<span class="muted small">총 ${total}개</span>` : ''}
    </div>
    ${targetBlock}
    ${compBlock}
    <p class="np-note">${parsedAt ? `파싱 기준 ${parsedAt} · ` : ''}${esc(data.dataNote || '')} · 네이버 공식: AI브리핑 인용 콘텐츠의 70%가 블로그·카페 등 자사 UGC</p>
  </div>`;
}

let aitabVerdicts = [];
function renderAitabCheck(q) {
  aitabVerdicts = [];
  const region = (q.region || '').trim();
  const proc = (q.procedure || '').trim();
  const queries = [
    `${region} ${proc} 잘하는 치과 추천해줘`.replace(/\s+/g, ' ').trim(),
    `이번 주 토요일에 예약 가능한 ${region} ${proc} 치과 찾아줘`.replace(/\s+/g, ' ').trim(),
    `${region} 치과 ${proc} 후기 정리해줘`.replace(/\s+/g, ' ').trim(),
  ];
  const rows = queries.map((v, i) => `
    <div style="padding:12px 0;border-top:1px solid var(--border)">
      <div style="font-size:.88rem;font-weight:600;color:var(--text-1);margin-bottom:8px;line-height:1.4">"${esc(v)}"</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button type="button" class="chip" data-ncopy="${esc(v)}">📋 복사</button>
        <a class="chip" href="https://search.naver.com/search.naver?query=${encodeURIComponent(v)}" target="_blank" rel="noopener noreferrer">네이버 열기 ↗ (AI탭 선택)</a>
        <span style="flex:1 0 100%;height:4px"></span>
        <button type="button" class="chip" data-nset="${i}:cited">✓ 병원 확인</button>
        <button type="button" class="chip" data-nset="${i}:not">— 병원 없음</button>
        <button type="button" class="chip" data-nset="${i}:unsure">❓ 불확실</button>
      </div>
    </div>`).join('');
  return `<div class="nv-card">
    <p class="muted small" style="margin:0 0 4px">네이버 AI는 자동 측정이 어렵습니다(약관·차단). 같은 질의를 AI탭에서 직접 확인하고 기록하세요. 두 번째 질의는 <b>예약 실행형</b> — AI탭 특화 질의입니다. 인용 출처(플레이스·블로그·홈페이지)는 화면 캡처로 함께 보관하세요.</p>
    ${rows}
    <p class="small muted" id="nTally" style="margin-top:12px;text-align:center">아직 기록 없음</p>
  </div>`;
}

$('nvResult').addEventListener('click', (e) => {
  const cp = e.target.closest('[data-ncopy]');
  if (cp) {
    const t = cp.getAttribute('data-ncopy');
    if (navigator.clipboard) navigator.clipboard.writeText(t).catch(() => {});
    cp.textContent = '📋 복사됨'; setTimeout(() => { cp.textContent = '📋 복사'; }, 1200);
    return;
  }
  const set = e.target.closest('[data-nset]');
  if (set) {
    const [idx, val] = set.getAttribute('data-nset').split(':');
    aitabVerdicts[+idx] = val;
    set.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c === set));
    const n = aitabVerdicts.filter(Boolean).length;
    const cited = aitabVerdicts.filter((v) => v === 'cited').length;
    const el = $('nTally');
    if (el) el.textContent = `네이버 AI(수동): ${n}개 기록 · 병원 확인 ${cited}건`;
  }
});

function renderProductMap({ bookingOk, targetFound, reviewGapBig }) {
  const rows = [];
  if (!bookingOk) rows.push({ gap: targetFound ? '네이버 예약 리뷰 0건 — 예약 미운영 또는 이용 초기' : '플레이스 매칭 실패 — 기본 정보 정합부터', act: '예약 오픈 + 플레이스 정보(NAP·진료시간·사진) 완결성 정비', prod: '예약·플레이스 세팅' });
  rows.push({ gap: '네이버 AI 인용의 70%가 블로그·카페(공식) — 병원 소유 콘텐츠 필요', act: '정보형(원인·방법·주의사항) 구조의 블로그 발행 — 임상사진·경험담 배제, 출처 명시', prod: '네이버 블로그 포스팅' });
  rows.push({ gap: 'AI브리핑이 클립 영상을 인용(ASR·OCR로 음성·자막을 읽음)', act: '대본=완결 정보 문장 + 화면 자막 필수의 주의사항 숏폼을 공식 클립 계정에 축적', prod: '주의사항 숏폼영상' });
  if (reviewGapBig) rows.push({ gap: '경쟁 상위 대비 리뷰 수 격차', act: '진료 후 케어 메시지에 실환자 리뷰 요청 연동(대가 제공 없음)', prod: '실환자 리뷰 (구성 중)' });
  rows.push({ gap: 'AI 추천은 고정·로테이션이 섞여 매번 변동', act: '월 1회 같은 조건 재측정으로 변화 추적', prod: '월간 관측 (구성 중)' });
  return `<div class="nv-card">
    <p class="muted small" style="margin:0 0 6px">아래 항목은 노출 조건 정비이며 특정 노출·순위를 보장하지 않습니다. 효과는 같은 조건의 재측정으로 확인합니다.</p>
    <div style="overflow-x:auto"><table class="nv-table">
      <thead><tr><th>관찰된 갭</th><th>액션</th><th style="white-space:nowrap">담당 상품</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${esc(r.gap)}</td>
        <td>${esc(r.act)}</td>
        <td><span class="nv-tag">${esc(r.prod)}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>
  </div>`;
}
