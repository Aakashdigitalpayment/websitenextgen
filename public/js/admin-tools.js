/* Admin panel helpers: top-bar quick search, role permission matrix, bulk-select on list pages. No dependencies. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- quick search (GET /admin/quick-search?q=)
  const box = $('[data-qsearch]');
  if (box) {
    const input = $('input', box), out = $('[data-qsearch-results]', box);
    let timer = null, seq = 0, active = -1;
    const close = () => { out.hidden = true; active = -1; };
    const links = () => $$('a', out);
    const highlight = i => { links().forEach((a, n) => a.classList.toggle('active', n === i)); active = i; };
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) return close();
      const my = ++seq;
      try {
        const r = await fetch('/admin/quick-search?q=' + encodeURIComponent(q), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!r.ok || my !== seq) return;
        const j = await r.json();
        out.innerHTML = j.total ? j.groups.map(g => '<h6>' + esc(g.label) + '</h6>' + g.items.map(it =>
          '<a href="' + esc(it.url) + '"><span>' + esc(it.title) + (it.sub ? ' <span class="faint small">' + esc(it.sub) + '</span>' : '') + '</span>' + (it.badge ? '<small>' + esc(it.badge) + '</small>' : '') + '</a>').join('')).join('')
          : '<div class="qsearch-empty">' + esc(box.dataset.empty || 'No results') + '</div>';
        out.hidden = false; active = -1;
      } catch (e) { /* offline */ }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 220); });
    input.addEventListener('keydown', e => {
      const l = links();
      if (e.key === 'ArrowDown' && l.length) { e.preventDefault(); highlight((active + 1) % l.length); }
      else if (e.key === 'ArrowUp' && l.length) { e.preventDefault(); highlight((active - 1 + l.length) % l.length); }
      else if (e.key === 'Enter' && active >= 0 && l[active]) { e.preventDefault(); location.href = l[active].href; }
      else if (e.key === 'Escape') close();
    });
    document.addEventListener('click', e => { if (!box.contains(e.target)) close(); });
    document.addEventListener('keydown', e => {
      if (e.key === '/' && !/input|textarea|select/i.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); input.focus(); }
    });
  }

  // ---- role permission matrix
  const form = $('[data-role-form]');
  if (form) {
    const rows = $$('tr[data-row]', form);
    const boxes = tr => $$('input[data-flag]', tr);
    const count = $('[data-role-count]', form);
    const syncRow = tr => {
      const b = boxes(tr), v = b.find(x => x.dataset.flag === 'v');
      if (b.some(x => x.dataset.flag !== 'v' && x.checked)) v.checked = true;
      $('[data-all]', tr).checked = b.every(x => x.checked);
    };
    const syncAll = () => {
      rows.forEach(syncRow);
      $$('tbody[data-group]', form).forEach(tb => $$('[data-col]', tb).forEach(c => {
        const bs = $$('input[data-flag="' + c.dataset.col + '"]', tb); c.checked = bs.length > 0 && bs.every(x => x.checked);
      }));
      if (count) count.textContent = rows.filter(tr => boxes(tr).some(x => x.checked)).length + ' menu';
    };
    form.addEventListener('change', e => {
      const el = e.target, tr = el.closest('tr');
      if (el.dataset.flag === 'v' && !el.checked) boxes(tr).forEach(x => { x.checked = false; });
      else if (el.hasAttribute('data-all')) boxes(tr).forEach(x => { x.checked = el.checked; });
      else if (el.dataset.col) $$('tr[data-row]', el.closest('tbody')).forEach(r => {
        const b = $('input[data-flag="' + el.dataset.col + '"]', r); b.checked = el.checked;
        if (el.dataset.col === 'v' && !el.checked) boxes(r).forEach(x => { x.checked = false; });
      });
      syncAll();
    });
    const preset = $('[data-role-preset]', form);
    if (preset) preset.addEventListener('change', () => {
      if (!preset.value) return;
      let p = {}; try { p = JSON.parse(preset.dataset.presets)[preset.value] || {}; } catch (e) { /* none */ }
      rows.forEach(tr => boxes(tr).forEach(x => { const [key, fl] = x.value.split(/\|(?=[vced]$)/); x.checked = (p[key] || '').indexOf(fl) !== -1; }));
      preset.value = ''; syncAll();
    });
    syncAll();
  }

  // ---- bulk select on list pages
  $$('[data-bulk-all]').forEach(all => all.addEventListener('change', () => {
    $$('input[name="ids"][form="' + all.dataset.bulkAll + '"]').forEach(x => { x.checked = all.checked; });
  }));
  $$('form[data-bulk]').forEach(f => f.addEventListener('submit', e => {
    const n = $$('input[name="ids"][form="' + f.id + '"]:checked').length;
    const act = f.querySelector('[name=action]').value;
    if (!n || !act) { e.preventDefault(); return; }
    if (act === 'delete' && !window.confirm(f.dataset.confirmDelete || 'Delete?')) e.preventDefault();
  }));
})();
