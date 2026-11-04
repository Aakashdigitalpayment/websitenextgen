/* Admin inbox: "select all" for bulk actions, auto print for the print form. */
(function () {
  'use strict';
  document.querySelectorAll('[data-check-all]').forEach(box => box.addEventListener('change', () => {
    document.querySelectorAll(`input[type=checkbox][name="${box.dataset.checkAll}"]`).forEach(c => { c.checked = box.checked; });
  }));
  if (document.body.hasAttribute('data-autoprint')) window.addEventListener('load', () => setTimeout(() => window.print(), 300));
})();
