#!/usr/bin/env node
'use strict';
/**
 * Fill a tenant with sample content (the same as Platform console → Demo data):
 *   npm run demo:seed -- aakash            add
 *   npm run demo:seed -- aakash --remove   remove exactly what was added
 */
const db = require('../src/db');
const demo = require('../src/lib/demo-data');

const slug = process.argv[2] || 'aakash';
const remove = process.argv.includes('--remove');

(async () => {
  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [slug]);
  if (!tenant) throw new Error('tenant not found: ' + slug);
  const r = await db.withSchema(tenant.schema_name, () => (remove ? demo.remove() : demo.insert()));
  console.log(remove ? `✓ demo data removed from ${slug} (${r.rows} rows)` : `✓ demo data added to ${slug} (${r.rows} rows, ${r.settings} empty settings filled)`);
  await db.pool.end();
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end(); process.exit(1); });
