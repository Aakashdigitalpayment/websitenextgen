#!/usr/bin/env node
'use strict';
/** Apply the platform schema, then bring every tenant schema up to date. */
const db = require('../src/db');
const tenants = require('../src/lib/tenants');

(async () => {
  await tenants.applyPlatformSchema();
  console.log('✓ platform schema');
  const all = await db.many('SELECT * FROM platform.tenants ORDER BY id');
  for (const t of all) {
    const ran = await tenants.migrateTenant(t);
    console.log(`✓ ${t.slug} (${t.schema_name})${ran.length ? ' — applied ' + ran.join(', ') : ' — up to date'}`);
  }
  if (!all.length) console.log('No tenants yet. Create one: npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --domain=aakash.localhost');
  await db.pool.end();
})().catch(async e => { console.error(e.message); await db.pool.end(); process.exit(1); });
