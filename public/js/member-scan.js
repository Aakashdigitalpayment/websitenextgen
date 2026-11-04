/*
 * Member portal programme QR scanner (member/scan.php).
 * Uses the browser's BarcodeDetector on the live camera (or on a photo); where it is not available the member
 * types / pastes the link printed under the QR. Only same-site attendance links are followed.
 */
(() => {
  const root = document.querySelector('[data-scan]');
  if (!root) return;
  const $ = s => root.querySelector(s);
  const video = $('[data-scan-video]'), box = $('[data-scan-box]'), err = $('[data-scan-err]'), ok = $('[data-scan-ok]');
  const startBtn = $('[data-scan-start]'), stopBtn = $('[data-scan-stop]'), photo = $('[data-scan-photo]'), photoLabel = $('[data-scan-photo-label]');
  let stream = null, timer = null, detector = null;

  const show = (el, text) => { el.textContent = text; el.hidden = !text; };
  const fail = text => { show(ok, ''); show(err, text); };

  /** Attendance token from a scanned value: /attend?t=…, /member/attend?t=…, legacy attend.php?token=|qr_token=, or a bare token. */
  function tokenFrom(raw) {
    const v = String(raw || '').trim();
    if (/^[A-Za-z0-9_-]{16,200}$/.test(v)) return v;
    let u;
    try { u = new URL(v, location.origin); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!/(^|\/)(member\/)?attend(\.php)?$/.test(u.pathname.replace(/\/+$/, ''))) return null;
    const t = u.searchParams.get('t') || u.searchParams.get('token') || u.searchParams.get('qr_token') || '';
    return /^[A-Za-z0-9_-]{16,200}$/.test(t) ? t : null;
  }

  function handle(raw) {
    const t = tokenFrom(raw);
    if (!t) { fail(root.dataset.msgBad); return false; }
    stop();
    show(err, ''); show(ok, root.dataset.msgOk);
    location.href = '/member/attend?t=' + encodeURIComponent(t);
    return true;
  }

  async function getDetector() {
    if (detector) return detector;
    if (!('BarcodeDetector' in window)) return null;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (!formats.includes('qr_code')) return null;
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      return detector;
    } catch { return null; }
  }

  function stop() {
    clearInterval(timer); timer = null;
    if (stream) stream.getTracks().forEach(tr => tr.stop());
    stream = null; box.hidden = true; stopBtn.hidden = true; startBtn.hidden = false;
  }

  async function start() {
    show(err, '');
    const det = await getDetector();
    if (!det || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fail(root.dataset.msgNocam); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch { fail(root.dataset.msgDenied); return; }
    video.srcObject = stream;
    box.hidden = false; stopBtn.hidden = false; startBtn.hidden = true;
    await video.play().catch(() => {});
    let busy = false;
    timer = setInterval(async () => {
      if (busy || video.readyState < 2) return;
      busy = true;
      try {
        const codes = await det.detect(video);
        if (codes && codes.length) handle(codes[0].rawValue);
      } catch { /* next frame */ }
      busy = false;
    }, 250);
  }

  startBtn.addEventListener('click', start);
  stopBtn.addEventListener('click', stop);
  window.addEventListener('pagehide', stop);

  // photo fallback (still image through BarcodeDetector — works where live video is blocked)
  getDetector().then(det => { if (det) photoLabel.hidden = false; });
  photo.addEventListener('change', async () => {
    const file = photo.files && photo.files[0];
    const det = await getDetector();
    if (!file || !det) return;
    try {
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      if (!codes.length || !handle(codes[0].rawValue)) fail(root.dataset.msgBad);
    } catch { fail(root.dataset.msgBad); }
    photo.value = '';
  });

  $('[data-scan-manual]').addEventListener('submit', e => {
    e.preventDefault();
    handle(e.target.elements.code.value);
  });
})();
