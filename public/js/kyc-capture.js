/* KYM capture tools (assets/js/kyc-capture.js in the PHP site): camera with crop / zoom / rotate, signature pad and a photo
   quality score. The result is posted as <field>_data (a data: URL); the server checks type, size and magic bytes again.
   Progressive enhancement: the normal file inputs keep working without JavaScript or a camera.
   Admin forms (form[data-capture-form]) reuse the camera: inputs marked data-capture-file get the photo put into the file
   input itself (DataTransfer), so the normal multipart upload path and its checks apply. */
(function () {
  'use strict';
  document.querySelectorAll('form[data-app-form], form[data-capture-form]').forEach(init);
  function init(form) {
  const np = (form.dataset.lang || '') !== 'en';
  const T = (a, b) => (np ? a : b);
  const toNp = s => String(s).replace(/[0-9]/g, d => '०१२३४५६७८९'[d]);
  const MAX = 1600;
  const el = (tag, attrs = {}, text) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    if (text !== undefined) e.textContent = text;
    return e;
  };

  // ------------------------------------------------------------ result: hidden <field>_data + preview
  function setData(input, dataUrl) {
    if (input.hasAttribute('data-capture-file') && typeof DataTransfer === 'function') {
      const [head, b64] = dataUrl.split(',');
      const mime = (/^data:([^;]+)/.exec(head) || [])[1] || 'image/jpeg';
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'camera-' + Date.now() + (mime === 'image/png' ? '.png' : '.jpg'), { type: mime }));
      input.files = dt.files;
      let pv = input.parentElement.querySelector('img.file-preview');
      if (!pv) { pv = el('img', { class: 'file-preview', alt: '' }); input.insertAdjacentElement('afterend', pv); }
      pv.src = dataUrl;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    let hidden = form.querySelector(`input[type=hidden][name="${input.name}_data"]`);
    if (!hidden) { hidden = el('input', { type: 'hidden', name: input.name + '_data' }); input.insertAdjacentElement('afterend', hidden); }
    hidden.value = dataUrl;
    input.value = '';
    input.required = false;
    let img = input.parentElement.querySelector('img.file-preview');
    if (!img) { img = el('img', { class: 'file-preview', alt: '' }); hidden.insertAdjacentElement('afterend', img); }
    img.src = dataUrl;
    if (input.hasAttribute('data-quality')) scoreFrom(dataUrl, input);
    form.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // choosing a file again replaces an earlier camera / pad result
  form.addEventListener('change', ev => {
    const inp = ev.target;
    if (!inp.matches || !inp.matches('input[type=file][data-capture-field]') || !inp.files || !inp.files[0]) return;
    const hidden = form.querySelector(`input[type=hidden][name="${inp.name}_data"]`);
    if (hidden) hidden.value = '';
    if (inp.hasAttribute('data-quality')) { const r = new FileReader(); r.onload = () => scoreFrom(r.result, inp); r.readAsDataURL(inp.files[0]); }
  });

  // ------------------------------------------------------------ photo quality (brightness, contrast, sharpness → 0-100)
  function quality(canvas) {
    const w = 256, h = Math.max(1, Math.round(canvas.height * (256 / canvas.width)));
    const c = el('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const L = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) { L[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]; sum += L[i]; }
    const mean = sum / (w * h);
    let vs = 0; for (let i = 0; i < w * h; i++) vs += (L[i] - mean) ** 2;
    const std = Math.sqrt(vs / (w * h));
    let lsum = 0, lsq = 0, n = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      lsum += lap; lsq += lap * lap; n++;
    }
    const lapVar = n ? lsq / n - (lsum / n) ** 2 : 0;
    const bright = Math.max(0, 100 - Math.abs(mean - 140) / 1.1);
    const sharp = Math.min(100, Math.sqrt(Math.max(0, lapVar)) * 5);
    const contrast = Math.min(100, std * 2);
    return Math.max(1, Math.min(100, Math.round(0.4 * bright + 0.4 * sharp + 0.2 * contrast)));
  }
  function scoreFrom(src, input) {
    const img = new Image();
    img.onload = () => {
      const c = el('canvas'); c.width = img.naturalWidth || 1; c.height = img.naturalHeight || 1;
      c.getContext('2d').drawImage(img, 0, 0);
      const s = quality(c);
      const hidden = form.querySelector('input[name="photo_quality_score"]');
      if (hidden) hidden.value = String(s);
      let hint = input.parentElement.querySelector('[data-quality-out]');
      if (!hint) { hint = el('div', { class: 'field-hint', 'data-quality-out': '' }); input.parentElement.appendChild(hint); }
      hint.textContent = T(`फोटो गुणस्तर: ${toNp(s)}/१०० (७०+ सिफारिस)`, `Photo quality: ${s}/100 (70+ recommended)`) + (s < 30 ? T(' — धेरै कम, फेरि खिच्नुहोस्।', ' — too low, please retake.') : '');
      hint.style.color = s < 30 ? 'var(--bad)' : s < 70 ? 'var(--warn)' : 'var(--ok)';
    };
    img.src = src;
  }

  // ------------------------------------------------------------ camera with crop / zoom / rotate
  const canCamera = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && typeof HTMLDialogElement === 'function';
  let dlg = null, stream = null, target = null, facing = 'user';
  const st = { src: null, rot: 0, zoom: 1, dx: 0, dy: 0, aspect: 0 };
  function stop() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
  function buildDialog() {
    dlg = el('dialog', { class: 'cam-dialog', 'aria-label': T('क्यामेरा', 'Camera') });
    dlg.innerHTML = '<div class="cam-stage"><video playsinline muted autoplay></video><canvas class="cam-crop" hidden></canvas></div>'
      + '<div class="cam-msg small muted"></div><div class="cam-zoom" hidden><label class="small"></label><input type="range" min="1" max="3" step="0.05" value="1"></div>'
      + '<div class="cam-actions"></div>';
    const actions = dlg.querySelector('.cam-actions');
    const btn = (key, label, cls = 'btn btn-outline btn-sm') => { const b = el('button', { type: 'button', class: cls, 'data-cam': key }, label); actions.appendChild(b); return b; };
    btn('switch', T('क्यामेरा बदल्नुहोस्', 'Switch camera'));
    btn('shoot', T('फोटो खिच्नुहोस्', 'Take photo'), 'btn btn-primary btn-sm');
    btn('rotate', T('घुमाउनुहोस् ⟳', 'Rotate ⟳'));
    btn('retake', T('फेरि खिच्नुहोस्', 'Retake'));
    btn('use', T('यो फोटो प्रयोग गर्नुहोस्', 'Use this photo'), 'btn btn-primary btn-sm');
    btn('cancel', T('रद्द', 'Cancel'), 'btn btn-ghost btn-sm');
    dlg.querySelector('.cam-zoom label').textContent = T('जुम / काट्ने (तान्नुहोस्)', 'Zoom / crop (drag to move)');
    document.body.appendChild(dlg);
    dlg.addEventListener('close', stop);
    actions.addEventListener('click', ev => {
      const b = ev.target.closest('[data-cam]'); if (!b) return;
      const k = b.dataset.cam;
      if (k === 'cancel') dlg.close();
      else if (k === 'switch') { facing = facing === 'user' ? 'environment' : 'user'; start(); }
      else if (k === 'shoot') shoot();
      else if (k === 'retake') start();
      else if (k === 'rotate') { st.rot = (st.rot + 1) % 4; st.dx = st.dy = 0; draw(); }
      else if (k === 'use') { setData(target, exportCrop()); dlg.close(); }
    });
    dlg.querySelector('.cam-zoom input').addEventListener('input', e => { st.zoom = Number(e.target.value) || 1; draw(); });
    const crop = dlg.querySelector('.cam-crop');
    let drag = null;
    crop.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, dx: st.dx, dy: st.dy }; crop.setPointerCapture(e.pointerId); });
    crop.addEventListener('pointermove', e => {
      if (!drag) return;
      const r = crop.getBoundingClientRect();
      st.dx = drag.dx - (e.clientX - drag.x) / r.width / st.zoom;
      st.dy = drag.dy - (e.clientY - drag.y) / r.height / st.zoom;
      draw();
    });
    crop.addEventListener('pointerup', () => { drag = null; });
  }
  function mode(shooting) {
    dlg.querySelector('video').hidden = !shooting;
    dlg.querySelector('.cam-crop').hidden = shooting;
    dlg.querySelector('.cam-zoom').hidden = shooting;
    for (const [k, on] of Object.entries({ switch: shooting, shoot: shooting, rotate: !shooting, retake: !shooting, use: !shooting })) dlg.querySelector(`[data-cam="${k}"]`).hidden = !on;
  }
  async function start() {
    stop();
    mode(true);
    const msg = dlg.querySelector('.cam-msg');
    msg.textContent = T('क्यामेरा खुल्दैछ…', 'Opening the camera…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = dlg.querySelector('video');
      v.srcObject = stream;
      await v.play().catch(() => {});
      msg.textContent = st.aspect && st.aspect < 1 ? T('अनुहार सिधा, दुवै आँखा र कान देखिने गरी राख्नुहोस्।', 'Face the camera; both eyes and ears visible.') : T('कागजात पूरै फ्रेमभित्र राख्नुहोस्।', 'Keep the whole document inside the frame.');
    } catch (e) {
      msg.textContent = T('क्यामेरा खोल्न सकिएन — अनुमति दिनुहोस् वा फाइल छान्नुहोस्।', 'Could not open the camera — allow access or choose a file instead.');
    }
  }
  function shoot() {
    const v = dlg.querySelector('video');
    if (!v.videoWidth) return;
    const c = el('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    st.src = c; st.rot = 0; st.zoom = 1; st.dx = st.dy = 0;
    dlg.querySelector('.cam-zoom input').value = '1';
    stop();
    mode(false);
    draw();
  }
  function rotated() {
    const s = st.src, odd = st.rot % 2 === 1;
    const c = el('canvas'); c.width = odd ? s.height : s.width; c.height = odd ? s.width : s.height;
    const ctx = c.getContext('2d');
    ctx.translate(c.width / 2, c.height / 2); ctx.rotate(st.rot * Math.PI / 2); ctx.drawImage(s, -s.width / 2, -s.height / 2);
    return c;
  }
  /** Crop rectangle in rotated-source pixels: the aspect box, shrunk by zoom, moved by the drag offset (clamped). */
  function rect(r) {
    const a = st.aspect || r.width / r.height;
    let w = r.width, h = w / a;
    if (h > r.height) { h = r.height; w = h * a; }
    w /= st.zoom; h /= st.zoom;
    const maxX = (r.width - w) / 2, maxY = (r.height - h) / 2;
    const cx = Math.max(-maxX, Math.min(maxX, st.dx * r.width)), cy = Math.max(-maxY, Math.min(maxY, st.dy * r.height));
    st.dx = r.width ? cx / r.width : 0; st.dy = r.height ? cy / r.height : 0;
    return { x: (r.width - w) / 2 + cx, y: (r.height - h) / 2 + cy, w, h };
  }
  function draw() {
    if (!st.src) return;
    const r = rotated(), q = rect(r), crop = dlg.querySelector('.cam-crop');
    const scale = Math.min(1, 640 / q.w);
    crop.width = Math.round(q.w * scale); crop.height = Math.round(q.h * scale);
    crop.getContext('2d').drawImage(r, q.x, q.y, q.w, q.h, 0, 0, crop.width, crop.height);
  }
  function exportCrop() {
    const r = rotated(), q = rect(r);
    const scale = Math.min(1, MAX / Math.max(q.w, q.h));
    const c = el('canvas'); c.width = Math.round(q.w * scale); c.height = Math.round(q.h * scale);
    c.getContext('2d').drawImage(r, q.x, q.y, q.w, q.h, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.88);
  }
  function openCamera(input) {
    if (!dlg) buildDialog();
    target = input;
    facing = input.dataset.facing === 'environment' ? 'environment' : 'user';
    st.aspect = Number(input.dataset.aspect) || 0;
    st.src = null;
    dlg.showModal();
    start();
  }

  // ------------------------------------------------------------ signature pad
  function signaturePad(input) {
    const box = el('div', { class: 'sig-pad', hidden: '' });
    const canvas = el('canvas', { width: '900', height: '300', 'aria-label': T('हस्ताक्षर गर्ने ठाउँ', 'Signature area') });
    const bar = el('div', { class: 'flex gap-1 mt-1' });
    const clear = el('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, T('मेटाउनुहोस्', 'Clear'));
    const use = el('button', { type: 'button', class: 'btn btn-primary btn-sm' }, T('हस्ताक्षर प्रयोग गर्नुहोस्', 'Use signature'));
    bar.append(clear, use); box.append(canvas, bar);
    const ctx = canvas.getContext('2d');
    const reset = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.strokeStyle = '#111'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; drawn = false; };
    let drawing = false, drawn = false;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) * canvas.width / r.width, (e.clientY - r.top) * canvas.height / r.height]; };
    canvas.addEventListener('pointerdown', e => { drawing = true; drawn = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
    canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); });
    canvas.addEventListener('pointerup', () => { drawing = false; });
    clear.addEventListener('click', reset);
    use.addEventListener('click', () => { if (!drawn) return; setData(input, canvas.toDataURL('image/png')); box.hidden = true; });
    reset();
    return box;
  }

  // ------------------------------------------------------------ buttons next to each image field
  form.querySelectorAll('input[type=file][data-capture-field]').forEach(input => {
    const tools = el('div', { class: 'flex gap-1 wrap mt-1 capture-tools' });
    if (canCamera && !input.hasAttribute('data-sign')) {
      const b = el('button', { type: 'button', class: 'btn btn-soft btn-sm', 'data-cam-open': input.name }, T('क्यामेराबाट खिच्नुहोस्', 'Use the camera'));
      b.addEventListener('click', () => openCamera(input));
      tools.appendChild(b);
    }
    if (input.hasAttribute('data-sign')) {
      const pad = signaturePad(input);
      const b = el('button', { type: 'button', class: 'btn btn-soft btn-sm' }, T('यहीँ हस्ताक्षर गर्नुहोस्', 'Sign here'));
      b.addEventListener('click', () => { pad.hidden = !pad.hidden; });
      tools.appendChild(b);
      input.insertAdjacentElement('afterend', pad);
    }
    if (tools.children.length) input.insertAdjacentElement('afterend', tools);
  });
  }
})();
