'use strict';
// AI검색 동향 — 운영자 수기 큐레이션 필드노트 + 자체 측정 벤치마크.
// 진단 흐름에 종속: CTA 1개로 #measure 복귀. 정적 JSON, 크론·KV·요청시 LLM 0.
// STALE_MAX_DAYS는 lib/news/fieldnotes.js와 동일하게 유지(둘 다 21일).
(function () {
  var STALE_MAX_DAYS = 21;
  var sec = document.getElementById('aiTrendSection');
  if (!sec) return;
  function hide() { sec.classList.add('hidden'); }

  function daysSince(reviewedAt) {
    var t = Date.parse(reviewedAt);
    if (isNaN(t)) return Infinity;            // 누락·파싱불가 → 숨김(부패 노출 방지, 안전 실패)
    return (Date.now() - t) / 86400000;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isHttp(u) { return typeof u === 'string' && /^https?:\/\//i.test(u); }

  fetch('/data/fieldnotes.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return hide();
      var reviewedAt = data.reviewedAt || data.updatedAt || '';
      if (daysSince(reviewedAt) > STALE_MAX_DAYS) return hide();   // stale → 통째 숨김

      var notes = (Array.isArray(data.notes) ? data.notes : [])
        .filter(function (n) { return n && n.title && n.summary && isHttp(n.url); })
        .slice(0, 3);
      var benches = (Array.isArray(data.benchmarks) ? data.benchmarks : [])
        .filter(function (b) { return b && b.label && b.metric; })
        .slice(0, 2);
      if (!notes.length && !benches.length) return hide();

      var benchHtml = benches.map(function (b) {
        return '<div class="trend-bench">'
          + '<div class="trend-bench-label">' + esc(b.label) + (b.asOf ? ' · ' + esc(b.asOf) : '') + '</div>'
          + '<div class="trend-bench-metric">' + esc(b.metric) + '</div>'
          + (b.note ? '<div class="trend-bench-note">' + esc(b.note) + '</div>' : '')
          + (b.sampleNote ? '<div class="trend-bench-sample">' + esc(b.sampleNote) + '</div>' : '')
          + '</div>';
      }).join('');

      var noteHtml = notes.map(function (n) {
        return '<a class="trend-card" href="' + esc(n.url) + '" target="_blank" rel="noopener noreferrer">'
          + '<div class="trend-meta"><span class="trend-src">' + esc(n.source || '출처') + '</span>'
          + (n.date ? '<span class="trend-date">' + esc(n.date) + '</span>' : '') + '</div>'
          + '<div class="trend-title">' + esc(n.title) + '</div>'
          + '<div class="trend-sum">' + esc(n.summary) + '</div>'
          + (n.clientAction ? '<div class="trend-act">→ ' + esc(n.clientAction) + '</div>' : '')
          + '</a>';
      }).join('');

      document.getElementById('aiTrendBody').innerHTML =
        (benchHtml ? '<div class="trend-bench-row">' + benchHtml + '</div>' : '')
        + (noteHtml ? '<div class="trend-cards">' + noteHtml + '</div>' : '');

      var rev = document.getElementById('aiTrendReviewed');
      if (rev && reviewedAt) rev.textContent = '최근 검토: ' + esc(reviewedAt);

      sec.classList.remove('hidden'); // 성공적으로 채워졌을 때만 노출
    })
    .catch(hide);
})();
