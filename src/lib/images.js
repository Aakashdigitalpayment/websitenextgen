'use strict';
/**
 * Responsive images up to 8K UHD.
 *
 * Every public image upload gets AVIF + WebP variants at 640 / 1280 / 1920 / 3840 (4K) / 7680 (8K) px wide
 * (never upscaled), written next to the original as  <name>.w<width>.avif|webp  plus a  <name>.meta.json
 * sidecar with the original size. Views emit srcset/sizes, so an 8K or Retina display downloads the 8K file
 * and a phone on mobile data downloads the 640 px one. Variants are made in the background and are
 * stripped of EXIF/GPS metadata. Originals are kept untouched.
 */
const fs = require('fs');
const path = require('path');

let sharp = null;
try { sharp = require('sharp'); sharp.cache(false); sharp.concurrency(1); } catch { /* optional: without sharp, originals are served as-is */ }

const WIDTHS = [640, 1280, 1920, 3840, 7680];
const RASTER = /\.(jpe?g|png|webp)$/i;          // gif (animation) and svg are served as uploaded
const MAX_PIXELS = 7680 * 4320 * 2;              // allow up to ~66 MP (8K and a bit), refuse decompression bombs

const variantPath = (abs, w, fmt) => abs.replace(/\.[a-z0-9]+$/i, `.w${w}.${fmt}`);
const metaPath = abs => abs.replace(/\.[a-z0-9]+$/i, '.meta.json');

/** Create the variants for one stored image (absolute path). Resolves to { width, height, made } or null. */
async function makeVariants(abs) {
  if (!sharp || !RASTER.test(abs) || !fs.existsSync(abs)) return null;
  const meta = await sharp(abs, { limitInputPixels: MAX_PIXELS }).metadata();
  const rotated = (meta.orientation || 1) >= 5; // EXIF 5-8 swap width/height
  const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
  if (!width || !height) return null;
  // standard widths below the original, plus the original width itself (capped at 8K) — never upscaled
  const widths = WIDTHS.filter(w => w < width);
  const top = Math.min(width, 7680);
  if (!widths.includes(top)) widths.push(top);
  const made = [];
  for (const w of widths) {
    for (const [fmt, opts] of [['avif', { quality: 50, effort: 4 }], ['webp', { quality: 80 }]]) {
      const out = variantPath(abs, w, fmt);
      if (fs.existsSync(out)) continue;
      await sharp(abs, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: w, withoutEnlargement: true })[fmt](opts).toFile(out + '.tmp');
      fs.renameSync(out + '.tmp', out);
      made.push(path.basename(out));
    }
  }
  fs.writeFileSync(metaPath(abs), JSON.stringify({ width, height, widths: listWidths(abs) }));
  return { width, height, made };
}

function listWidths(abs) {
  const dir = path.dirname(abs), base = path.basename(abs).replace(/\.[a-z0-9]+$/i, '');
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const re = new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.w(\\d+)\\.webp$');
  return names.map(n => (n.match(re) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b);
}

// ---------------------------------------------------------------- background queue (one encode at a time)
const queue = [];
let running = false;
function enqueue(abs) {
  if (!sharp || !RASTER.test(abs)) return;
  queue.push(abs);
  if (!running) drain();
}
async function drain() {
  running = true;
  while (queue.length) {
    const abs = queue.shift();
    try { await makeVariants(abs); } catch (e) { console.error('[images]', path.basename(abs), e.message); }
  }
  running = false;
}
const idle = () => new Promise(r => { const t = setInterval(() => { if (!running && !queue.length) { clearInterval(t); r(); } }, 50); });

// ---------------------------------------------------------------- view helpers
const infoCache = new Map(); // abs -> { at, info }
function info(abs) {
  const hit = infoCache.get(abs);
  if (hit && Date.now() - hit.at < 60_000) return hit.info;
  let v = null;
  try { v = JSON.parse(fs.readFileSync(metaPath(abs), 'utf8')); } catch { /* not processed (yet) */ }
  if (infoCache.size > 5000) infoCache.clear();
  infoCache.set(abs, { at: Date.now(), info: v });
  return v;
}

/** srcset for a stored path ('news/abc.jpg') given the absolute file and its public URL. */
function srcsetFor(abs, url, fmt = 'webp') {
  const i = info(abs);
  if (!i || !i.widths || !i.widths.length) return '';
  return i.widths.map(w => `${url.replace(/\.[a-z0-9]+$/i, `.w${w}.${fmt}`)} ${w}w`).join(', ');
}

/** Remove variants + sidecar of an image. */
function removeVariants(abs) {
  const dir = path.dirname(abs), base = path.basename(abs).replace(/\.[a-z0-9]+$/i, '');
  try {
    for (const n of fs.readdirSync(dir)) if (n.startsWith(base + '.w') || n === base + '.meta.json') fs.rmSync(path.join(dir, n), { force: true });
  } catch { /* gone already */ }
  infoCache.delete(abs);
}

module.exports = { WIDTHS, makeVariants, enqueue, idle, info, srcsetFor, removeVariants, available: () => !!sharp, RASTER };
