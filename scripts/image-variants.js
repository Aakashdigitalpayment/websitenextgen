#!/usr/bin/env node
'use strict';
/**
 * Create responsive AVIF/WebP variants (up to 8K) for images that were uploaded before the
 * image pipeline existed, or that were copied in by the migration tool.
 *   npm run images:variants            # every tenant
 *   npm run images:variants -- aakash  # one tenant
 * Private uploads (_private/) are skipped; already-processed images are skipped quickly.
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const images = require('../src/lib/images');

if (!images.available()) { console.error('✗ sharp is not installed'); process.exit(1); }
const only = process.argv[2];
const VARIANT = /\.w\d+\.(avif|webp)$/i;

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '_private' && !e.name.startsWith('.')) yield* walk(p); }
    else if (images.RASTER.test(e.name) && !VARIANT.test(e.name)) yield p;
  }
}

(async () => {
  if (!fs.existsSync(config.uploadDir)) return console.log('no uploads yet');
  const tenants = fs.readdirSync(config.uploadDir).filter(t => !only || t === only);
  let done = 0, skipped = 0, failed = 0;
  for (const t of tenants) {
    const dir = path.join(config.uploadDir, t);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of walk(dir)) {
      if (images.info(file)) { skipped++; continue; }
      try { const r = await images.makeVariants(file); if (r) { done++; process.stdout.write(`✓ ${t}/${path.relative(dir, file)} ${r.width}×${r.height}\n`); } else skipped++; }
      catch (e) { failed++; console.error(`✗ ${t}/${path.relative(dir, file)}: ${e.message}`); }
    }
  }
  console.log(`done: ${done} processed, ${skipped} skipped, ${failed} failed`);
})();
