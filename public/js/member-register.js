/* Member registration: live duplicate check (GET /member/check-availability) — advisory only, the server re-checks. */
(() => {
  const form = document.querySelector('[data-register-form]');
  if (!form) return;
  const timers = {};
  form.querySelectorAll('[data-check]').forEach(input => {
    const field = input.dataset.check;
    const msg = form.querySelector(`[data-check-msg="${field}"]`);
    const run = async () => {
      const value = input.value.trim();
      if (!msg) return;
      if (!value) { msg.textContent = ''; msg.style.color = ''; return; }
      try {
        const r = await fetch(`/member/check-availability?field=${encodeURIComponent(field)}&value=${encodeURIComponent(value)}`, { headers: { accept: 'application/json' }, credentials: 'same-origin' });
        const j = await r.json();
        msg.textContent = j.available ? '✓' : (j.message || '');
        msg.style.color = j.available ? 'var(--ok)' : 'var(--bad)';
      } catch { msg.textContent = ''; }
    };
    input.addEventListener('input', () => { clearTimeout(timers[field]); timers[field] = setTimeout(run, 600); });
    input.addEventListener('blur', run);
  });
})();
