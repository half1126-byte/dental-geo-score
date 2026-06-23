// Pure, DOM-free HTML builder for the agent-actionability card. Extracted from operator.js so the
// honesty contract is UNIT-TESTABLE without a browser: (a) measurement-limited/no-form/no-controls
// never say bare "실패/낙제"; (b) the measured card never emits a 0-100/등급; (c) all interpolated
// values pass through esc(). Takes esc + card as injected deps so it has zero document/DOM access.
export function agentCardHtml(a, { esc, card }) {
  const title = '에이전트 실행성 — AI가 예약·문의를 수행할 수 있나';
  // Affirmatively NON-CAUSAL toward citation (not merely "별개"): fixing labels does not move the score.
  const sub = '<p class="muted small" style="margin-top:8px">"ChatGPT가 예약해줘" 류 에이전트가 이 폼을 조작할 수 있나. <b>라벨을 고쳐도 AI 인용·점수에는 영향 없음</b> — 에이전트 조작 가능성만 올라갑니다. 정적 분석 하한선(JS 렌더 폼은 측정 제한).</p>';

  if (!a) return card(title, '<p class="muted">측정 불가.</p>' + sub);
  if (a.status === 'measurement-limited')
    return card(title, '<p class="muted">측정 제한 — JS로 렌더되는 폼이라 정적 분석으로 라벨을 확인할 수 없음 (<b>실패 아님</b>). 정밀 측정은 헤드리스 필요.</p>' + sub);
  if (a.status === 'no-controls')
    return card(title, '<p class="muted">폼은 있으나 정적으로 읽을 입력칸이 없음 — JS로 구성된 폼일 수 있음 (<b>실패 아님</b>). 정밀 측정은 헤드리스 필요.</p>' + sub);
  if (a.status === 'no-form')
    return card(title, '<p class="muted">예약/문의 폼 없음 — 전화·지도 기반 예약일 수 있음 (<b>실패 아님</b>).</p>' + sub);

  // Single source of truth for the %: the server's coverage fraction (named/total by construction).
  const covPct = Math.round((a.coverage || 0) * 100);
  const cov = `<p><b>입력칸 ${a.controlsTotal}개 중 ${a.controlsNamed}개</b> 기계가 읽을 이름 있음 · 커버리지 <b>${a.controlsNamed}/${a.controlsTotal}</b> (${covPct}%)${a.bookingForms ? ` · 예약/문의 폼 ${a.bookingForms}개` : ''}</p>`;
  const checks = (a.checks || []).map((c) => `<div style="padding:4px 0"><span class="mark ${c.pass ? 'ok' : 'warn'}">${c.pass ? '✓' : '!'}</span> ${esc(c.label)}</div>`).join('');
  const frac = `<p class="small muted">에이전트 준비 체크 <b>${a.passed}/${a.total}</b> 통과 (통과율 · <b>점수 아님</b>).</p>`;
  const weak = a.placeholderOnly ? `<p class="small muted">${a.placeholderOnly}개는 placeholder(사라지는 힌트)에만 의존 — 정식 라벨 권장.</p>` : '';
  const unnamed = (a.unnamedSamples && a.unnamedSamples.length)
    ? `<p class="small muted">이름 없는 컨트롤: ${a.unnamedSamples.map((u) => esc(u)).join(', ')} → aria-label 또는 &lt;label&gt; 연결.</p>` : '';
  return card(title, cov + checks + frac + weak + unnamed + sub);
}
