/* Programme live dashboard: polls /admin/programs/:id/live.json every 15 s (legacy admin/program-dashboard.php). */
(function () {
  'use strict';
  var box = document.querySelector('[data-live-url]');
  if (!box || !window.fetch) return;
  var url = box.getAttribute('data-live-url');
  var set = function (key, v) { var el = box.querySelector('[data-live="' + key + '"]'); if (el) el.textContent = v; };
  function poll() {
    if (document.hidden) return;
    fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.ok) return;
        set('attended', d.attended); set('prereg', d.prereg); set('pct', d.pct); set('eligible', d.eligible);
        var bar = box.querySelector('[data-live-bar]');
        if (bar) bar.style.width = Math.min(100, Number(d.pct) || 0) + '%';
        (d.occurrences || []).forEach(function (o) {
          var cell = box.querySelector('[data-occ="' + Number(o.id) + '"] [data-occ-count]');
          if (cell) cell.textContent = o.attended_count;
        });
        set('updated', '· ' + new Date().toTimeString().slice(0, 8));
      })
      .catch(function () { /* offline: try again next tick */ });
  }
  setInterval(poll, 15000);
})();
