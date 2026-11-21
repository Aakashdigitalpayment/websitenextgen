/* Information room viewer: copy / screenshot deterrence for items with "Block copy / print" (best effort; the
   watermark and the access log are the real controls). Port of the PHP assets/js/information-room-viewer.js. */
(function () {
  'use strict';
  const wrap = document.getElementById('irViewerWrap');
  if (!wrap || !wrap.classList.contains('ir-restricted')) return;
  const inside = t => t && wrap.contains(t);
  ['contextmenu', 'copy', 'cut', 'dragstart'].forEach(ev => document.addEventListener(ev, e => { if (inside(e.target)) e.preventDefault(); }));
  document.addEventListener('keydown', e => {
    if (!inside(e.target) && !inside(document.activeElement) && e.key !== 'PrintScreen') return;
    const key = (e.key || '').toLowerCase();
    if (key === 'printscreen' || (e.ctrlKey && ['s', 'p', 'c', 'u', 'a'].includes(key)) || (e.metaKey && ['s', 'p', 'c', 'a'].includes(key))) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => wrap.classList.toggle('ir-blurred', document.hidden));
  wrap.querySelectorAll('img').forEach(img => img.setAttribute('draggable', 'false'));
})();
