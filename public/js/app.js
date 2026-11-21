/* Small progressive-enhancement script for the public site and portals. No dependencies. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // personal theme: apply instantly, save in the background (form still works without JS)
  $$('[data-theme-form]').forEach(form => {
    const root = document.documentElement;
    const apply = () => {
      const mode = (form.querySelector('[name=mode]:checked') || {}).value;
      const pal = form.querySelector('[name=palette]:checked');
      if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode); else root.removeAttribute('data-theme');
      if (pal) root.style.setProperty('--brand', pal.dataset.color);
    };
    const save = async extra => {
      const body = new URLSearchParams(new FormData(form));
      if (extra) Object.entries(extra).forEach(([k, v]) => body.set(k, v));
      try {
        const r = await fetch('/theme', { method: 'POST', body, headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        return r.ok ? r.json() : null;
      } catch (e) { return null; }
    };
    form.addEventListener('change', () => { apply(); save(); });
    const applyBtn = form.querySelector('[data-theme-apply]');
    if (applyBtn) applyBtn.hidden = true;
    const reset = form.querySelector('[data-theme-reset]');
    if (reset) reset.addEventListener('click', async ev => {
      ev.preventDefault();
      const j = await save({ reset: '1' });
      if (!j) return form.submit();
      const m = form.querySelector(`[name=mode][value="${j.mode}"]`); if (m) m.checked = true;
      const p = form.querySelector(`[name=palette][value="${j.palette}"]`); if (p) p.checked = true;
      apply();
    });
  });
  document.addEventListener('click', ev => {
    $$('[data-theme-picker][open]').forEach(d => { if (!d.contains(ev.target)) d.removeAttribute('open'); });
  });

  // mobile nav
  const toggle = $('[data-nav-toggle]');
  const nav = $('[data-nav]');
  if (toggle && nav) toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // hero slider
  $$('[data-slider]').forEach(slider => {
    const slides = $$('.slide', slider);
    const dots = $$('.slider-dots button', slider);
    if (slides.length < 2) return;
    let i = 0, timer;
    const show = n => {
      slides[i].classList.remove('active'); dots[i] && dots[i].classList.remove('active');
      i = (n + slides.length) % slides.length;
      slides[i].classList.add('active'); dots[i] && dots[i].classList.add('active');
    };
    const start = () => { timer = setInterval(() => show(i + 1), 5500); };
    dots.forEach((d, n) => d.addEventListener('click', () => { clearInterval(timer); show(n); start(); }));
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) start();
  });

  // popup notices: public/js/site.js (carousel on every page)

  // EMI calculator (live): number inputs, range sliders, rate presets, principal/interest bar
  const emi = $('[data-emi]');
  if (emi) {
    const fmt = n => Math.round(n).toLocaleString('en-IN');
    const tenureEl = $('[data-emi-tenure]', emi);
    const calc = () => {
      const P = parseFloat($('[name=amount]', emi).value) || 0;
      const r = (parseFloat($('[name=rate]', emi).value) || 0) / 1200;
      const t = parseInt(tenureEl.value, 10) || 0;
      const n = tenureEl.dataset.unit === 'years' ? t * 12 : t;
      if (!P || !n) return;
      const m = r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n;
      $('[data-emi-monthly]').textContent = 'Rs. ' + fmt(m);
      $('[data-emi-interest]').textContent = 'Rs. ' + fmt(m * n - P);
      $('[data-emi-total]').textContent = 'Rs. ' + fmt(m * n);
      const pct = Math.round(P / (m * n) * 100), bar = $('[data-emi-bar]'), lbl = $('[data-emi-pct]');
      if (bar) bar.style.width = pct + '%';
      if (lbl) lbl.textContent = pct;
    };
    $$('input[type=range][data-sync]', emi).forEach(range => {
      const box = range.dataset.sync === 'tenure' ? tenureEl : $('[name=' + range.dataset.sync + ']', emi);
      range.addEventListener('input', () => { box.value = range.value; calc(); });
      box.addEventListener('input', () => { range.value = box.value; });
    });
    $$('[data-emi-rate]', emi).forEach(a => a.addEventListener('click', e => { e.preventDefault(); $('[name=rate]', emi).value = a.dataset.emiRate; const rr = $('[data-sync=rate]', emi); if (rr) rr.value = a.dataset.emiRate; calc(); }));
    $$('input', emi).forEach(i => i.addEventListener('input', calc));
  }

  // confirm buttons
  $$('[data-confirm]').forEach(el => el.addEventListener('click', e => {
    if (!window.confirm(el.dataset.confirm)) e.preventDefault();
  }));

  // file input preview name
  $$('input[type=file][data-preview]').forEach(inp => inp.addEventListener('change', () => {
    const img = document.getElementById(inp.dataset.preview);
    if (img && inp.files[0] && inp.files[0].type.startsWith('image/')) {
      img.src = URL.createObjectURL(inp.files[0]); img.hidden = false;
    }
  }));

  // auto-submit selects in filter bars
  $$('[data-autosubmit]').forEach(el => el.addEventListener('change', () => el.form && el.form.submit()));
})();

document.querySelectorAll('[data-print]').forEach(b => b.addEventListener('click', () => window.print()));

/* Web push opt-in (member portal) */
(function () {
  const box = document.querySelector('[data-push-box]');
  const btn = document.querySelector('[data-push-enable]');
  if (!box || !btn || !('serviceWorker' in navigator) || !('PushManager' in window) || Notification.permission === 'denied') return;
  const toKey = b64 => { const p = '='.repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, c => c.charCodeAt(0)); };
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(async reg => {
    const existing = await reg.pushManager.getSubscription();
    if (existing && Notification.permission === 'granted') return;
    box.hidden = false;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const { key } = await (await fetch('/member/push/key', { credentials: 'same-origin' })).json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(key) });
        const r = await fetch('/member/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': btn.dataset.csrf }, body: JSON.stringify(sub) });
        if (r.ok) box.hidden = true; else btn.disabled = false;
      } catch (e) { btn.disabled = false; }
    });
  }).catch(() => {});
})();

/* Website assistant widget */
(function () {
  const root = document.querySelector('[data-chat]');
  if (!root) return;
  const panel = root.querySelector('.chat-panel');
  const log = root.querySelector('[data-chat-log]');
  const form = root.querySelector('[data-chat-form]');
  const history = [];
  root.querySelectorAll('[data-chat-toggle]').forEach(b => b.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) form.m.focus();
  }));
  const add = (text, who) => {
    const d = document.createElement('div');
    d.className = 'chat-msg ' + who;
    d.textContent = text; // never innerHTML: answers are untrusted text
    log.appendChild(d); log.scrollTop = log.scrollHeight;
    return d;
  };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = form.m.value.trim();
    if (!msg) return;
    form.m.value = ''; add(msg, 'me');
    const wait = add('…', 'bot typing');
    try {
      const r = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': root.dataset.csrf }, body: JSON.stringify({ message: msg }) });
      const j = await r.json();
      wait.remove(); add(j.answer || '—', 'bot');
      // suggested pages: same-site paths only, rendered as text links (never HTML from the server)
      const links = Array.isArray(j.links) ? j.links.filter(u => typeof u === 'string' && /^\/(?!\/)[\w\-/?=&#.]*$/.test(u)).slice(0, 3) : [];
      if (links.length) {
        const row = document.createElement('div'); row.className = 'chat-chips';
        links.forEach(u => { const a = document.createElement('a'); a.className = 'tab'; a.href = u; a.textContent = u; row.appendChild(a); });
        log.appendChild(row); log.scrollTop = log.scrollHeight;
      }
      history.push({ role: 'user', content: msg }, { role: 'assistant', content: j.answer || '' });
      history.splice(0, Math.max(0, history.length - 8));
    } catch (err) { wait.remove(); add(root.dataset.lang === 'en' ? 'Connection problem. Please try again.' : 'जडानमा समस्या भयो। फेरि प्रयास गर्नुहोस्।', 'bot'); }
  });
})();

/* Credential vault: fetch a password only when asked (each request is logged server-side) */
(function () {
  const fetchPw = async (id, csrf, action) => {
    const r = await fetch(`/admin/credentials/${id}/reveal`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf }, body: JSON.stringify({ action }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'error');
    return j.password;
  };
  document.querySelectorAll('[data-reveal]').forEach(b => b.addEventListener('click', async () => {
    const span = document.querySelector(`[data-pw="${b.dataset.reveal}"]`);
    if (span.dataset.shown) { span.textContent = '••••••••'; delete span.dataset.shown; return; }
    try { span.textContent = await fetchPw(b.dataset.reveal, b.dataset.csrf, 'view'); span.dataset.shown = '1'; setTimeout(() => { span.textContent = '••••••••'; delete span.dataset.shown; }, 20000); }
    catch (e) { span.textContent = e.message; }
  }));
  document.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(await fetchPw(b.dataset.copy, b.dataset.csrf, 'copy')); b.textContent = '✓'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); }
    catch (e) { b.textContent = '✗'; }
  }));
})();

/* Register the service worker on public pages (offline fallback). */
if ('serviceWorker' in navigator && !/^\/(admin|platform)\b/.test(location.pathname)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {}));
}

// application received: drop the draft kept on this device; copy the tracking number
document.querySelectorAll('[data-draft-clear]').forEach(el => { try { localStorage.removeItem(el.dataset.draftClear); localStorage.removeItem(el.dataset.draftClear + ':step'); } catch (e) { /* storage blocked */ } });
document.querySelectorAll('[data-copy-text]').forEach(b => b.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(b.dataset.copyText); const s = b.querySelector('span'); if (s) s.textContent = '✓'; } catch (e) { /* clipboard blocked */ }
}));

// ballot: list the chosen candidates per position before the vote is cast (member/election-vote.php confirm modal)
document.querySelectorAll('form[data-ballot]').forEach(form => {
  const btn = form.querySelector('[data-ballot-submit]');
  if (!btn) return;
  btn.addEventListener('click', ev => {
    ev.preventDefault();
    const lines = Array.from(form.querySelectorAll('[data-ballot-position]')).map(box => {
      const picks = Array.from(box.querySelectorAll('input:checked')).map(i => i.dataset.candName);
      return [box.dataset.ballotPosition, picks.length ? picks.join(', ') : btn.dataset.none];
    });
    if (typeof HTMLDialogElement !== 'function') { if (window.confirm(btn.dataset.confirmText + '\n\n' + lines.map(l => l[0] + ': ' + l[1]).join('\n'))) form.submit(); return; }
    const dlg = document.createElement('dialog');
    dlg.className = 'ballot-dialog';
    const h = document.createElement('h3'); h.textContent = btn.dataset.confirmText; dlg.appendChild(h);
    const dl = document.createElement('div'); dl.className = 'kv';
    lines.forEach(([k, v]) => { const a = document.createElement('div'); a.textContent = k; const b = document.createElement('div'); b.textContent = v; b.style.fontWeight = '600'; dl.append(a, b); });
    dlg.appendChild(dl);
    const bar = document.createElement('div'); bar.className = 'flex gap-1 mt-2';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn btn-primary'; ok.textContent = btn.dataset.ok;
    const back = document.createElement('button'); back.type = 'button'; back.className = 'btn btn-ghost'; back.textContent = btn.dataset.back;
    ok.addEventListener('click', () => { ok.disabled = true; form.submit(); });
    back.addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    bar.append(ok, back); dlg.appendChild(bar);
    document.body.appendChild(dlg); dlg.showModal();
  });
});
