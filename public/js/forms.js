/* Application forms: B.S. date picker, Nepal address cascade, repeatable rows, conditional fields.
   Progressive enhancement only — every form still posts without JavaScript. Data: /js/form-data.js */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const np = (document.documentElement.lang || '').startsWith('ne') || ($('[data-lang]') || {}).dataset?.lang !== 'en';
  const T = (a, b) => (np ? a : b);
  const toNp = s => String(s).replace(/[0-9]/g, d => '०१२३४५६७८९'[d]);
  const toLatin = s => String(s || '').replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c));
  const pad = n => String(n).padStart(2, '0');

  // ------------------------------------------------------------ B.S. calendar (same table + reference as src/lib/nepali-date.js)
  const DAYS = window.BS_MONTH_DAYS || {};
  const YEARS = Object.keys(DAYS).map(Number).sort((a, b) => a - b);
  const MIN = YEARS[0], MAX = YEARS[YEARS.length - 1];
  const MONTHS = np ? ['बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत']
    : ['Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
  const WEEK = np ? ['आ', 'सो', 'मं', 'बु', 'बि', 'शु', 'श'] : ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const ord = (y, m, d) => { let n = 0; for (let yy = MIN; yy < y; yy++) n += DAYS[yy].reduce((a, b) => a + b, 0); for (let mm = 1; mm < m; mm++) n += DAYS[y][mm - 1]; return n + d - 1; };
  const REF = YEARS.length ? ord(2000, 9, 17) : 0, REF_UTC = Date.UTC(1944, 0, 1), DAY = 864e5;
  const parse = s => { const m = toLatin(s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); return m ? [+m[1], +m[2], +m[3]] : null; };
  const validBs = p => p && DAYS[p[0]] && p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= DAYS[p[0]][p[1] - 1];
  function bsToAd(s) {
    const p = parse(s); if (!validBs(p)) return null;
    const t = new Date(REF_UTC + (ord(...p) - REF) * DAY);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  }
  function adToBs(s) {
    const p = parse(s); if (!p) return null;
    let n = REF + Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - REF_UTC) / DAY);
    let y = MIN; while (y <= MAX) { const yd = DAYS[y].reduce((a, b) => a + b, 0); if (n < yd) break; n -= yd; y++; }
    if (y > MAX || n < 0) return null;
    let m = 1; while (n >= DAYS[y][m - 1]) { n -= DAYS[y][m - 1]; m++; }
    return `${y}-${pad(m)}-${pad(n + 1)}`;
  }
  const todayBs = () => { const k = new Date(Date.now() + 345 * 6e4); return adToBs(`${k.getUTCFullYear()}-${pad(k.getUTCMonth() + 1)}-${pad(k.getUTCDate())}`); };

  let pop = null;
  function closePicker() { if (pop) { pop.remove(); pop = null; } }
  function openPicker(input, onPick) {
    closePicker();
    if (!YEARS.length) return;
    let cur = parse(input.value); if (!validBs(cur)) cur = parse(todayBs()) || [2081, 1, 1];
    let [y, m] = cur;
    pop = document.createElement('div');
    pop.className = 'bs-picker'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', T('वि.सं. पात्रो', 'B.S. calendar'));
    const draw = () => {
      const first = new Date(REF_UTC + (ord(y, m, 1) - REF) * DAY).getUTCDay();
      const sel = parse(input.value), today = parse(todayBs());
      let html = `<div class="bs-head"><button type="button" data-nav="-1" aria-label="${T('अघिल्लो महिना', 'Previous month')}">‹</button>
        <select data-m aria-label="${T('महिना', 'Month')}">${MONTHS.map((x, i) => `<option value="${i + 1}" ${i + 1 === m ? 'selected' : ''}>${x}</option>`).join('')}</select>
        <select data-y aria-label="${T('वर्ष', 'Year')}">${YEARS.map(v => `<option value="${v}" ${v === y ? 'selected' : ''}>${np ? toNp(v) : v}</option>`).join('')}</select>
        <button type="button" data-nav="1" aria-label="${T('अर्को महिना', 'Next month')}">›</button></div><div class="bs-grid">`;
      html += WEEK.map(w => `<span class="bs-w">${w}</span>`).join('') + '<span></span>'.repeat(first);
      for (let d = 1; d <= DAYS[y][m - 1]; d++) {
        const on = sel && sel[0] === y && sel[1] === m && sel[2] === d, td = today && today[0] === y && today[1] === m && today[2] === d;
        html += `<button type="button" data-d="${d}" class="${on ? 'on' : ''} ${td ? 'today' : ''}">${np ? toNp(d) : d}</button>`;
      }
      pop.innerHTML = html + `</div><div class="bs-foot"><button type="button" data-today>${T('आज', 'Today')}</button><button type="button" data-close>${T('बन्द', 'Close')}</button></div>`;
    };
    draw();
    pop.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b) return;
      ev.preventDefault();
      if (b.dataset.nav) { m += +b.dataset.nav; if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; } y = Math.min(MAX, Math.max(MIN, y)); draw(); return; }
      if (b.dataset.d) { onPick(`${y}-${pad(m)}-${pad(b.dataset.d)}`); closePicker(); input.focus(); return; }
      if (b.hasAttribute('data-today')) { onPick(todayBs()); closePicker(); return; }
      if (b.hasAttribute('data-close')) closePicker();
    });
    pop.addEventListener('change', ev => { if (ev.target.matches('[data-m]')) m = +ev.target.value; if (ev.target.matches('[data-y]')) y = +ev.target.value; draw(); });
    input.insertAdjacentElement('afterend', pop);
  }
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closePicker(); });
  document.addEventListener('click', ev => { if (pop && !pop.contains(ev.target) && !ev.target.matches('[data-bsdate],[data-bs-for]')) closePicker(); });

  const adHint = (input, hint) => {
    if (!hint) return;
    const ad = bsToAd(input.value);
    hint.textContent = input.value ? (ad ? T('ई.सं. ', 'A.D. ') + ad : T('मिति मिलेन (YYYY-MM-DD)', 'Invalid date (YYYY-MM-DD)')) : hint.dataset.orig;
  };
  // B.S. text fields
  $$('input[data-bsdate]').forEach(input => {
    const hint = input.parentElement.querySelector('[data-bsdate-hint]');
    if (hint) hint.dataset.orig = hint.textContent;
    const pick = v => { input.value = v; adHint(input, hint); input.dispatchEvent(new Event('change', { bubbles: true })); };
    input.addEventListener('focus', () => openPicker(input, pick));
    input.addEventListener('input', () => adHint(input, hint));
    adHint(input, hint);
  });
  // A.D. date fields: in the Nepali UI pick in B.S., the A.D. value is what gets posted (coop-date-ui.php)
  $$('input[data-ad-date]').forEach(ad => {
    if (!YEARS.length) return;
    const bs = document.createElement('input');
    bs.className = 'input'; bs.type = 'text'; bs.placeholder = 'YYYY-MM-DD (वि.सं.)'; bs.autocomplete = 'off'; bs.setAttribute('data-bs-for', ad.id);
    bs.setAttribute('aria-label', (ad.labels && ad.labels[0] ? ad.labels[0].textContent : '') + ' (वि.सं.)');
    if (ad.value) bs.value = adToBs(ad.value) || '';
    const hint = document.createElement('div'); hint.className = 'field-hint'; hint.dataset.orig = T('वि.सं. मिति; ई.सं. मा स्वतः बदलिन्छ', 'B.S. date; converted to A.D. automatically');
    hint.textContent = hint.dataset.orig;
    ad.hidden = true; ad.insertAdjacentElement('afterend', bs); bs.insertAdjacentElement('afterend', hint);
    const sync = () => { const v = bsToAd(bs.value); ad.value = v || ''; adHint(bs, hint); };
    bs.addEventListener('focus', () => openPicker(bs, v => { bs.value = v; sync(); }));
    bs.addEventListener('input', sync);
    if (ad.labels && ad.labels[0]) ad.labels[0].htmlFor = '';
    if (bs.value) adHint(bs, hint);
  });

  // ------------------------------------------------------------ Nepal address cascade (province → district → municipality → ward)
  const ADDR = window.NEPAL_ADDRESS || {};
  const fill = (sel, list, keep) => {
    const first = sel.options[0] ? sel.options[0].outerHTML : '<option value=""></option>';
    sel.innerHTML = first + list.map(v => `<option value="${String(v).replace(/"/g, '&quot;')}">${np ? toNp(v) : v}</option>`).join('');
    if (keep && list.map(String).includes(String(keep))) sel.value = keep;
  };
  $$('[data-address]').forEach(grid => {
    const part = k => grid.querySelector(`[data-addr-part="${k}"]`);
    const [p, d, m, w] = ['province', 'district', 'municipality', 'ward'].map(part);
    if (!p || !Object.keys(ADDR).length) return;
    const muni = () => (ADDR[p.value]?.[d.value] || []).find(x => x[0] === m.value);
    const onP = keep => { fill(d, Object.keys(ADDR[p.value] || {}), keep); onD(keep === undefined ? undefined : m.dataset.value); };
    const onD = keep => { fill(m, (ADDR[p.value]?.[d.value] || []).map(x => x[0]), keep); onM(keep === undefined ? undefined : w.dataset.value); };
    const onM = keep => { const x = muni(); fill(w, x ? Array.from({ length: x[1] }, (_, i) => String(i + 1)) : [], keep); };
    fill(p, Object.keys(ADDR), p.dataset.value);
    onP(d.dataset.value);
    p.addEventListener('change', () => onP());
    d.addEventListener('change', () => onD());
    m.addEventListener('change', () => onM());
  });

  // ------------------------------------------------------------ conditional fields (showIf / requiredIf / filterBy)
  const form = $('[data-app-form]');
  const controlValue = (name, meta) => {
    if (!form) return '';
    const els = $$(`[name="${name}"]`, form);
    let el = els.find(e => (e.type === 'radio' || e.type === 'checkbox') ? e.checked : true);
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked ? el.value : '';
    if (meta && el.tagName === 'SELECT') {
      const o = el.selectedOptions[0];
      try { const md = o && o.dataset.meta ? JSON.parse(o.dataset.meta) : null; if (md && md[meta] !== undefined) return md[meta]; } catch (e) { /* ignore */ }
      return meta === 'profile' ? el.value : '';
    }
    return el.value;
  };
  function refresh() {
    $$('[data-show-field]', form || document).forEach(box => {
      const v = String(controlValue(box.dataset.showField, box.dataset.showMeta) ?? '');
      let show;
      if (box.dataset.showIn !== undefined) show = box.dataset.showIn.split(',').includes(v);
      else if (box.dataset.showEq !== undefined) show = v === box.dataset.showEq;
      else if (box.dataset.showNe !== undefined) show = v !== box.dataset.showNe;
      else show = !!v;
      box.hidden = !show;
    });
    $$('[data-req-field]', form || document).forEach(box => {
      const star = box.querySelector('[data-req-star]');
      if (star) star.hidden = !controlValue(box.dataset.reqField, box.dataset.reqMeta);
    });
    $$('select[data-filter-field]', form || document).forEach(sel => {
      const other = controlValue(sel.dataset.filterField), key = sel.dataset.filterMeta;
      const opts = Array.from(sel.options).slice(1);
      const mapped = opts.some(o => { try { return (JSON.parse(o.dataset.meta || '{}')[key] || []).includes(other); } catch (e) { return false; } });
      opts.forEach(o => { let ok = true; if (mapped) { try { ok = (JSON.parse(o.dataset.meta || '{}')[key] || []).includes(other); } catch (e) { ok = true; } } o.hidden = !ok; o.disabled = !ok; });
      if (sel.selectedOptions[0] && sel.selectedOptions[0].disabled) sel.value = '';
    });
    // same-as-permanent hides the temporary address
    const same = form && form.querySelector('[name="same_as_permanent"]');
    const temp = form && form.querySelector('[data-address="temporary"]');
    if (same && temp) temp.closest('.field').hidden = same.checked;
  }
  if (form) { form.addEventListener('change', refresh); refresh(); }

  // ------------------------------------------------------------ repeatable rows + totals + nominee from family
  const money = n => (Math.round(n * 100) / 100).toLocaleString(np ? 'ne-NP' : 'en-IN');
  function sums() {
    const totals = {};
    $$('table[data-sum]').forEach(tb => {
      const tot = $$('[data-amount]', tb).reduce((a, i) => a + (parseFloat(toLatin(i.value).replace(/[^0-9.]/g, '')) || 0), 0);
      totals[tb.dataset.sum] = tot;
      const out = tb.querySelector('[data-sum-out]'); if (out) out.textContent = tot ? 'रु. ' + money(tot) : '—';
    });
    const net = $('[data-net-out]');
    if (net && (totals.income_source || totals.expense_source)) net.textContent = 'रु. ' + money((totals.income_source || 0) - (totals.expense_source || 0));
    const dl = $('#nominee_family');
    if (dl) dl.innerHTML = $$('[name="family_member_name"]').map(i => i.value.trim()).filter(Boolean).map(v => `<option value="${v.replace(/"/g, '&quot;')}">`).join('');
  }
  document.addEventListener('click', ev => {
    const add = ev.target.closest('[data-repeat-add]');
    if (add) {
      const tb = $(`table[data-repeat="${add.dataset.repeatAdd}"] tbody`);
      const rows = tb ? $$('[data-repeat-row]', tb) : [];
      if (!rows.length || rows.length >= 30) return;
      const row = rows[rows.length - 1].cloneNode(true);
      $$('input', row).forEach(i => { i.value = ''; }); $$('select', row).forEach(s => { s.selectedIndex = 0; });
      tb.appendChild(row); (row.querySelector('input,select') || {}).focus?.();
      return;
    }
    const rm = ev.target.closest('[data-repeat-remove]');
    if (rm) {
      const row = rm.closest('[data-repeat-row]'), tb = row.parentElement;
      if ($$('[data-repeat-row]', tb).length > 1) row.remove();
      else { $$('input', row).forEach(i => { i.value = ''; }); $$('select', row).forEach(s => { s.selectedIndex = 0; }); }
      sums();
    }
  });
  document.addEventListener('input', ev => { if (ev.target.matches('[data-amount],[name="family_member_name"]')) sums(); });
  sums();

  // ------------------------------------------------------------ geolocation
  $$('[data-geo-btn]').forEach(btn => {
    const input = document.getElementById(btn.dataset.geoBtn);
    const box = btn.closest('.field'), msg = box && box.querySelector('[data-geo-msg]'), link = box && box.querySelector('[data-geo-map]');
    const showLink = () => { const m = (input.value || '').match(/^\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*$/); if (link) { link.hidden = !m; if (m) link.href = `https://www.openstreetmap.org/?mlat=${m[1]}&mlon=${m[2]}#map=17/${m[1]}/${m[2]}`; } };
    if (!('geolocation' in navigator)) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      btn.disabled = true;
      navigator.geolocation.getCurrentPosition(pos => {
        input.value = pos.coords.latitude.toFixed(6) + ', ' + pos.coords.longitude.toFixed(6);
        btn.disabled = false; showLink();
      }, () => { btn.disabled = false; if (msg) msg.firstChild.textContent = T('स्थान लिन सकिएन — अनुमति दिनुहोस् वा हातैले लेख्नुहोस्। ', 'Could not read the location — allow access or type it. '); }, { enableHighAccuracy: true, timeout: 15000 });
    });
    input.addEventListener('input', showLink); showLink();
  });

  // ------------------------------------------------------------ image preview
  $$('input[type=file][data-preview]').forEach(inp => inp.addEventListener('change', () => {
    let img = inp.parentElement.querySelector('img.file-preview');
    const f = inp.files && inp.files[0];
    if (!f || !/^image\//.test(f.type)) { if (img) img.remove(); return; }
    if (!img) { img = document.createElement('img'); img.className = 'file-preview'; img.alt = ''; inp.insertAdjacentElement('afterend', img); }
    img.src = URL.createObjectURL(f);
  }));

  window.CoopDate = { bsToAd, adToBs, todayBs, openPicker };
})();
