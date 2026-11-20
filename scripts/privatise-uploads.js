#!/usr/bin/env node
'use strict';
/**
 * Fix-up for tenants migrated from the PHP site before the gated-folder move (docs/parity/coverage.md SM-3):
 * moves every file in the folders the PHP upload gate protected (KYC, loan, welfare, office replies …) to
 * uploads/<tenant>/_private/ and points every stored path (single or comma-separated) at the private copy.
 * Safe to re-run.
 *
 *   node scripts/privatise-uploads.js --tenant=aakash
 *   node scripts/privatise-uploads.js --all
 */
const path = require('path');
const db = require('../src/db');
const config = require('../src/config');
const mig = require('../src/lib/site-migration');

(async () => {
  const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
  const all = process.argv.includes('--all');
  const slug = arg('tenant');
  if (!all && !slug) throw new Error('usage: node scripts/privatise-uploads.js --tenant=<slug> | --all');
  const list = all ? await db.many('SELECT * FROM platform.tenants ORDER BY id') : await db.many('SELECT * FROM platform.tenants WHERE slug = $1', [slug]);
  if (!list.length) throw new Error(`tenant "${slug}" not found`);
  for (const t of list) {
    const r = await db.withSchema(t.schema_name, () => mig.protectGatedUploads(path.join(config.uploadDir, t.slug)));
    console.log(`✓ ${t.slug}: ${r.moved} files moved (${r.folders.join(', ') || 'no gated folders'}); ${r.rows} stored paths, ${r.html} rich-text links updated`);
  }
  await db.pool.end();
})().catch(async e => { console.error(e.message); await db.pool.end(); process.exit(1); });
