/*
 * Programme registration desk (legacy program-registration-desk.php + api/program-desk-lookup.php):
 * typing a Member ID looks the member up, shows a card (photo, eligibility, existing check-in, history,
 * monthly saving) and the Check in button confirms it. Without JS the form still checks in directly.
 */
(function () {
  'use strict';
  var form = document.querySelector('form[data-desk-lookup]');
  if (!form || !window.fetch) return;
  var url = form.getAttribute('data-desk-lookup');
  var input = form.querySelector('input[name="q"]');
  var memberId = form.querySelector('input[name="member_id"]');
  var card = form.querySelector('[data-desk-card]');
  var labels = (form.querySelector('[data-desk-labels]') || document.createElement('template')).dataset;
  var $ = function (sel) { return card.querySelector(sel); };
  var timer = null, seq = 0;

  function reset() { memberId.value = ''; card.hidden = true; }
  function text(el, v) { if (el) el.textContent = v == null ? '' : String(v); }
  function setStatus(msg, cls) {
    var el = $('[data-desk-status]');
    el.textContent = '';
    var b = document.createElement('span');
    b.className = 'badge ' + cls;
    b.textContent = msg;
    el.appendChild(b);
  }

  function show(d) {
    if (!d.ok) { card.hidden = false; text($('[data-desk-name]'), labels.notfound || d.error); text($('[data-desk-meta]'), ''); text($('[data-desk-father]'), ''); text($('[data-desk-status]'), ''); text($('[data-desk-history]'), ''); $('[data-desk-ms]').hidden = true; $('[data-desk-photo]').hidden = true; $('[data-desk-void]').hidden = true; memberId.value = ''; return; }
    var m = d.member;
    memberId.value = m.id;
    card.hidden = false;
    text($('[data-desk-name]'), (m.name_np || m.name) + (m.name_np && m.name ? ' (' + m.name + ')' : ''));
    text($('[data-desk-meta]'), [m.sadasyata_number, m.phone, m.address].filter(Boolean).join(' · '));
    text($('[data-desk-father]'), m.father_name ? (labels.father || 'Father') + ': ' + m.father_name : '');
    var img = $('[data-desk-photo]');
    if (m.photo) { img.src = m.photo; img.hidden = false; } else { img.removeAttribute('src'); img.hidden = true; }
    if (d.existing) setStatus((labels.attended || 'Already checked in') + ' — ' + d.existing.when + (d.existing.location ? ' · ' + d.existing.location : ''), 'badge-warn');
    else if (!d.eligible) setStatus(d.reason, 'badge-bad');
    else setStatus(labels.eligible || 'Eligible', 'badge-ok');
    var h = d.history || {};
    var parts = [(labels.total || 'Total') + ': ' + (h.total || 0)];
    if (h.agm_last3_total) parts.push((labels.agm || 'AGM') + ': ' + h.agm_last3_attended + '/' + h.agm_last3_total + (h.agm_streak ? ' (' + (labels.streak || 'streak') + ' ' + h.agm_streak + ')' : ''));
    (h.recent || []).forEach(function (r) { parts.push(r.title + (r.date ? ' ' + r.date : '')); });
    text($('[data-desk-history]'), parts.join(' · '));
    var ms = $('[data-desk-ms]');
    ms.hidden = false;
    ms.querySelectorAll('input[name="monthly_saving"]').forEach(function (r) { r.checked = r.value === ''; });
    var voidBox = $('[data-desk-void]');
    voidBox.hidden = !(d.existing && d.existing.can_void);
    voidBox.dataset.attendanceId = d.existing ? d.existing.id : '';
  }

  function lookup() {
    var q = input.value.trim();
    if (q.length < 2) { reset(); return; }
    var params = new URLSearchParams({ q: q });
    var desk = form.querySelector('[name="desk_id"]'), occ = form.querySelector('[name="occurrence_id"]');
    if (desk && desk.value) params.set('desk_id', desk.value);
    if (occ && occ.value) params.set('occurrence_id', occ.value);
    var mine = ++seq;
    fetch(url + '?' + params.toString(), { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d && mine === seq) show(d); })
      .catch(function () { /* offline: the plain form still works */ });
  }

  input.addEventListener('input', function () { memberId.value = ''; clearTimeout(timer); timer = setTimeout(lookup, 350); });
  form.querySelectorAll('[name="desk_id"], [name="occurrence_id"]').forEach(function (el) { el.addEventListener('change', lookup); });

  // void the desk's own recent entry through the existing void route (same CSRF token)
  var voidBtn = card.querySelector('[data-desk-void-btn]');
  if (voidBtn) voidBtn.addEventListener('click', function () {
    var id = card.querySelector('[data-desk-void]').dataset.attendanceId;
    if (!id || !window.confirm(voidBtn.textContent + '?')) return;
    var f = document.createElement('form');
    f.method = 'post';
    f.action = form.getAttribute('action').replace(/\/desk$/, '/attendance/' + encodeURIComponent(id) + '/void');
    [['_csrf', form.querySelector('[name="_csrf"]').value], ['reason', 'desk correction']].forEach(function (kv) {
      var i = document.createElement('input'); i.type = 'hidden'; i.name = kv[0]; i.value = kv[1]; f.appendChild(i);
    });
    document.body.appendChild(f);
    f.submit();
  });
})();
