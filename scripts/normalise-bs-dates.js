#!/usr/bin/env node
'use strict';
/** One-off: convert BS dates typed into AD DATE columns (PHP imports) for every tenant, or only --tenant=<slug>. */
const db = require('../src/db');
const bsDates = require('../src/lib/bs-dates');

(async () => {
  const only = (process.argv.find(a => a.startsWith('--tenant=')) || '').split('=')[1];
  const all = await db.many('SELECT slug, schema_name FROM platform.tenants ORDER BY id');
  for (const t of all) {
    if (only && t.slug !== only) continue;
    const fixed = await db.withSchema(t.schema_name, () => bsDates.normalise());
    console.log(t.slug, Object.keys(fixed).length ? JSON.stringify(fixed) : 'nothing to convert');
  }
  await db.pool.end();
})().catch(e => { console.error(e); process.exit(1); });
