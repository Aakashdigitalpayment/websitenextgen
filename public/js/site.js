/* Public-site enhancements (parity with the PHP site). Progressive: every feature works as plain links/forms without JS. */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* storage blocked */ } },
  };

  /** Keep Tab inside `box` while it is open; returns a release function that restores focus. */
  function trapFocus(box) {
    const before = document.activeElement;
    const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select, textarea, iframe, [tabindex]:not([tabindex="-1"])';
    const onKey = e => {
      if (e.key !== 'Tab') return;
      const items = $$(sel, box).filter(el => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    box.addEventListener('keydown', onKey);
    return () => { box.removeEventListener('keydown', onKey); if (before && before.focus) before.focus(); };
  }
  window.coopTrapFocus = trapFocus;

  // ---------------------------------------------------------------- notice popup carousel (once per browser session)
  const pop = $('[data-notice-popup]');
  if (pop) {
    const key = 'popup-seen-' + pop.dataset.noticePopup;
    const slides = $$('[data-np-slide]', pop), dots = $$('[data-np-dot]', pop);
    const bar = $('[data-np-bar]', pop), count = $('[data-np-count]', pop);
    let i = 0, timer = null, paused = false, started = 0, release = null;
    const DURATION = 6000;
    const show = n => {
      slides[i].hidden = true; if (dots[i]) dots[i].classList.remove('active');
      i = (n + slides.length) % slides.length;
      slides[i].hidden = false; if (dots[i]) dots[i].classList.add('active');
      pop.setAttribute('aria-labelledby', 'np-title-' + i);
      if (count) count.textContent = (i + 1) + ' / ' + slides.length;
      started = Date.now();
    };
    const tick = () => {
      if (paused) { started = Date.now() - (bar ? parseFloat(bar.dataset.p || 0) * DURATION : 0); return; }
      const p = Math.min(1, (Date.now() - started) / DURATION);
      if (bar) { bar.style.width = (p * 100) + '%'; bar.dataset.p = p; }
      if (p >= 1) show(i + 1);
    };
    const close = () => {
      pop.classList.remove('open'); pop.hidden = true; clearInterval(timer);
      store.set(key, '1');
      if (release) release();
    };
    if (store.get(key) !== '1') {
      pop.hidden = false; pop.classList.add('open');
      release = trapFocus(pop);
      const btn = $('[data-np-close]', pop); if (btn) btn.focus();
      if (slides.length > 1 && !reduced) { started = Date.now(); timer = setInterval(tick, 100); }
    }
    $$('[data-np-close]', pop).forEach(b => b.addEventListener('click', close));
    pop.addEventListener('click', e => { if (e.target === pop) close(); });
    document.addEventListener('keydown', e => {
      if (pop.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && slides.length > 1) show(i + 1);
      else if (e.key === 'ArrowLeft' && slides.length > 1) show(i - 1);
    });
    const box = $('.modal-box', pop);
    box.addEventListener('mouseenter', () => { paused = true; });
    box.addEventListener('mouseleave', () => { paused = false; });
    box.addEventListener('focusin', () => { paused = true; });
    const prev = $('[data-np-prev]', pop), next = $('[data-np-next]', pop);
    if (prev) prev.addEventListener('click', () => show(i - 1));
    if (next) next.addEventListener('click', () => show(i + 1));
    dots.forEach((d, n) => d.addEventListener('click', () => show(n)));
  }

  // ---------------------------------------------------------------- header menus (<details>): one open at a time, close outside / Escape
  const menus = $$('[data-menu]');
  menus.forEach(d => d.addEventListener('toggle', () => { if (d.open) menus.forEach(o => { if (o !== d) o.open = false; }); }));
  document.addEventListener('click', e => menus.forEach(d => { if (d.open && !d.contains(e.target)) d.open = false; }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') menus.forEach(d => { if (d.open) { d.open = false; const s = d.querySelector('summary'); if (s) s.focus(); } }); });

  // ---------------------------------------------------------------- site search dialog (+ voice input where supported)
  const sdlg = $('[data-search-dialog]');
  if (sdlg && typeof sdlg.showModal === 'function') {
    $$('[data-search-open]').forEach(a => a.addEventListener('click', e => {
      e.preventDefault(); sdlg.showModal(); const i = $('input[name=q]', sdlg); if (i) i.focus();
    }));
    $$('[data-search-close]', sdlg).forEach(b => b.addEventListener('click', () => sdlg.close()));
    sdlg.addEventListener('click', e => { if (e.target === sdlg) sdlg.close(); });
  }
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  $$('[data-search-mic]').forEach(btn => {
    if (!Rec) return;
    btn.hidden = false;
    btn.addEventListener('click', () => {
      const rec = new Rec(); rec.lang = btn.dataset.lang || 'ne-NP'; rec.interimResults = false; rec.maxAlternatives = 1;
      const form = btn.closest('form'), input = form && form.querySelector('input[name=q]');
      btn.classList.add('btn-soft');
      rec.onresult = ev => { const text = ev.results[0][0].transcript; if (input && text) { input.value = text; form.submit(); } };
      rec.onend = () => btn.classList.remove('btn-soft');
      try { rec.start(); } catch (e) { btn.classList.remove('btn-soft'); }
    });
  });

  // ---------------------------------------------------------------- gallery lightbox (photos) and in-page YouTube player (videos)
  const lb = $('[data-lightbox-dialog]');
  if (lb && typeof lb.showModal === 'function') {
    const items = $$('[data-lightbox], [data-video]');
    const body = $('[data-lb-body]', lb), cap = $('[data-lb-caption]', lb);
    let cur = 0;
    const render = n => {
      cur = (n + items.length) % items.length;
      const a = items[cur];
      body.textContent = '';
      if (a.dataset.video && /^[A-Za-z0-9_-]{11}$/.test(a.dataset.video)) {
        const f = document.createElement('iframe');
        f.src = 'https://www.youtube-nocookie.com/embed/' + a.dataset.video + '?autoplay=1&rel=0';
        f.title = a.title || 'Video'; f.allow = 'autoplay; encrypted-media; picture-in-picture'; f.allowFullscreen = true;
        body.appendChild(f);
      } else {
        const img = document.createElement('img'); img.src = a.href; img.alt = a.dataset.caption || ''; body.appendChild(img);
      }
      cap.textContent = a.dataset.caption || a.title || '';
    };
    items.forEach((a, n) => a.addEventListener('click', e => { if (e.ctrlKey || e.metaKey) return; e.preventDefault(); render(n); lb.showModal(); }));
    $('[data-lb-close]', lb).addEventListener('click', () => lb.close());
    $('[data-lb-prev]', lb).addEventListener('click', () => render(cur - 1));
    $('[data-lb-next]', lb).addEventListener('click', () => render(cur + 1));
    lb.addEventListener('close', () => { body.textContent = ''; }); // stops the video
    lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
    lb.addEventListener('keydown', e => { if (e.key === 'ArrowRight') render(cur + 1); else if (e.key === 'ArrowLeft') render(cur - 1); });
    if (items.length < 2) { $('[data-lb-prev]', lb).hidden = true; $('[data-lb-next]', lb).hidden = true; }
  }

  // ---------------------------------------------------------------- legacy about.php#anchors → their own pages
  if (location.pathname === '/about' && location.hash) {
    const h = location.hash.toLowerCase();
    const to = /^#success/.test(h) ? '/success-stories' : /^#chairman/.test(h) ? '/message/chairman' : /^#ceo/.test(h) ? '/message/ceo'
      : /^#(vision|mission)/.test(h) ? '/vision-mission' : /^#(why-choose|why-us)/.test(h) ? '/about#why' : '';
    if (to && to !== location.pathname + location.hash) location.replace(to);
  }

  // ---------------------------------------------------------------- share buttons: Web Share API, else copy the link
  $$('[data-share]').forEach(b => {
    b.hidden = false;
    b.addEventListener('click', async () => {
      const url = new URL(b.dataset.share || location.href, location.href).href;
      try {
        if (navigator.share) { await navigator.share({ title: b.dataset.shareTitle || document.title, url }); return; }
        await navigator.clipboard.writeText(url);
        const old = b.textContent; b.textContent = b.dataset.shareDone || '✓'; setTimeout(() => { b.textContent = old; }, 1800);
      } catch (e) { /* cancelled or blocked */ }
    });
  });

  // deep link to one card (?id= / #r12): scroll into view and highlight
  const focus = $('.is-focus');
  if (focus && !location.hash) focus.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
})();
