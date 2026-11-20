/* Small self-hosted rich-text editor for textarea[data-richtext] (admin only; no CDN, CSP-safe).
   Toolbar: paragraph / H2 / H3, bold, italic, link, bullet / numbered list, quote, undo / redo, HTML source.
   The textarea stays the form field (kept in sync); the server sanitises the HTML again on save. */
(function () {
  'use strict';
  const np = (document.documentElement.lang || '').startsWith('ne');
  const T = (a, b) => (np ? a : b);
  const BTNS = [
    ['p', 'P', T('अनुच्छेद', 'Paragraph'), () => exec('formatBlock', '<p>')],
    ['h2', 'H2', T('शीर्षक', 'Heading'), () => exec('formatBlock', '<h2>')],
    ['h3', 'H3', T('उपशीर्षक', 'Sub-heading'), () => exec('formatBlock', '<h3>')],
    ['b', 'B', T('बोल्ड', 'Bold'), () => exec('bold')],
    ['i', 'I', T('इटालिक', 'Italic'), () => exec('italic')],
    ['a', '🔗', T('लिङ्क', 'Link'), link],
    ['ul', '•', T('बुँदा सूची', 'Bulleted list'), () => exec('insertUnorderedList')],
    ['ol', '1.', T('अंक सूची', 'Numbered list'), () => exec('insertOrderedList')],
    ['q', '❝', T('उद्धरण', 'Quote'), () => exec('formatBlock', '<blockquote>')],
    ['undo', '↶', T('पूर्ववत्', 'Undo'), () => exec('undo')],
    ['redo', '↷', T('फेरि', 'Redo'), () => exec('redo')],
    ['src', '</>', T('HTML हेर्ने', 'HTML source'), null],
  ];
  // defence in depth (CSP already blocks inline handlers): drop scripts, handlers and javascript: links before editing
  function clean(html) {
    const doc = new DOMParser().parseFromString('<body>' + html, 'text/html');
    doc.body.querySelectorAll('script,style,iframe,object,embed,form,input,button,link,meta').forEach(n => n.remove());
    doc.body.querySelectorAll('*').forEach(n => Array.from(n.attributes).forEach(a => {
      if (/^on/i.test(a.name) || (/^(href|src|xlink:href|action)$/i.test(a.name) && /^\s*(javascript|data|vbscript):/i.test(a.value) && !/^data:image\//i.test(a.value))) n.removeAttribute(a.name);
    }));
    return doc.body.innerHTML;
  }
  function exec(cmd, arg) { document.execCommand(cmd, false, arg); }
  function link() {
    const url = window.prompt(T('लिङ्क (https://…)', 'Link (https://…)'), 'https://');
    if (url === null) return;
    const u = url.trim();
    if (!u) return exec('unlink');
    if (!/^(https?:\/\/|mailto:|tel:|\/(?!\/))/i.test(u)) return window.alert(T('https://, mailto: वा / बाट सुरु हुनुपर्छ', 'Must start with https://, mailto: or /'));
    exec('createLink', u);
  }
  document.querySelectorAll('textarea[data-richtext]').forEach(ta => {
    if (ta.dataset.richReady) return;
    ta.dataset.richReady = '1';
    const wrap = document.createElement('div');
    wrap.className = 'rte';
    const bar = document.createElement('div');
    bar.className = 'rte-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', T('ढाँचा', 'Formatting'));
    const ed = document.createElement('div');
    ed.className = 'rte-area prose'; ed.contentEditable = 'true'; ed.setAttribute('role', 'textbox'); ed.setAttribute('aria-multiline', 'true');
    const lab = ta.id && document.querySelector('label[for="' + ta.id + '"]');
    if (lab) ed.setAttribute('aria-label', lab.textContent.trim());
    const looksHtml = /<\/?(p|br|ul|ol|li|h[1-6]|div|strong|em|b|i|a|blockquote|table)\b/i.test(ta.value);
    // plain text from the old site becomes paragraphs (escaped — never parsed as HTML)
    if (looksHtml) ed.innerHTML = clean(ta.value);
    else ta.value.split(/\n{2,}/).filter(Boolean).forEach(par => { const p = document.createElement('p'); par.split('\n').forEach((line, i) => { if (i) p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(line)); }); ed.appendChild(p); });
    let source = false;
    const sync = () => { if (!source) ta.value = ed.innerHTML.trim() === '<br>' ? '' : ed.innerHTML; };
    BTNS.forEach(([key, text, title, fn]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'rte-btn rte-' + key; b.textContent = text; b.title = title; b.setAttribute('aria-label', title);
      b.addEventListener('mousedown', e => e.preventDefault()); // keep the selection in the editor
      b.addEventListener('click', () => {
        if (key === 'src') {
          source = !source;
          if (source) { sync(); ta.hidden = false; ed.hidden = true; ta.focus(); } else { ed.innerHTML = clean(ta.value); ta.hidden = true; ed.hidden = false; ed.focus(); }
          b.setAttribute('aria-pressed', String(source));
          bar.querySelectorAll('.rte-btn:not(.rte-src)').forEach(x => { x.disabled = source; });
          return;
        }
        ed.focus(); fn(); sync();
      });
      bar.appendChild(b);
    });
    ed.addEventListener('input', sync);
    ed.addEventListener('blur', sync);
    ta.parentNode.insertBefore(wrap, ta);
    wrap.appendChild(bar); wrap.appendChild(ed); wrap.appendChild(ta);
    ta.hidden = true;
    if (ta.form) ta.form.addEventListener('submit', sync);
  });
})();
