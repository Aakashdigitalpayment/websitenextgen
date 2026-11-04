/* Small progressive-enhancement script for the public site and portals. No dependencies. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

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

  // popup notice (once per session)
  const popup = $('[data-popup]');
  if (popup) {
    const key = 'popup-seen-' + popup.dataset.popup;
    let seen = false;
    try { seen = sessionStorage.getItem(key) === '1'; } catch (e) { /* storage blocked */ }
    if (!seen) popup.classList.add('open');
    const close = () => { popup.classList.remove('open'); try { sessionStorage.setItem(key, '1'); } catch (e) { /* ignore */ } };
    $$('[data-close]', popup).forEach(b => b.addEventListener('click', close));
    popup.addEventListener('click', e => { if (e.target === popup) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  // EMI calculator (live)
  const emi = $('[data-emi]');
  if (emi) {
    const fmt = n => Math.round(n).toLocaleString('en-IN');
    const calc = () => {
      const P = parseFloat($('[name=amount]', emi).value) || 0;
      const r = (parseFloat($('[name=rate]', emi).value) || 0) / 1200;
      const n = parseInt($('[name=months]', emi).value, 10) || 0;
      if (!P || !n) return;
      const m = r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n;
      $('[data-emi-monthly]').textContent = 'Rs. ' + fmt(m);
      $('[data-emi-interest]').textContent = 'Rs. ' + fmt(m * n - P);
      $('[data-emi-total]').textContent = 'Rs. ' + fmt(m * n);
    };
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
