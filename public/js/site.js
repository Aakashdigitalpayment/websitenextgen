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
