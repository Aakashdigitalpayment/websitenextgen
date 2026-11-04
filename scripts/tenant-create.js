#!/usr/bin/env node
'use strict';
/**
 * Create a tenant from the command line.
 *   npm run tenant:create -- --slug=aakash --name="आकाश सहकारी" --name-en="Aakash Cooperative" \
 *       --domain=aakash.localhost --domain=www.aakashsaccos.com.np --admin=admin --password=Secret@123
 */
const db = require('../src/db');
const tenants = require('../src/lib/tenants');

function args() {
  const out = { domain: [] };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'domain') out.domain.push(m[2]); else out[m[1]] = m[2];
  }
  return out;
}

(async () => {
  const a = args();
  await tenants.applyPlatformSchema();
  const password = a.password || process.env.ADMIN_PASSWORD;
  const t = await tenants.createTenant({
    slug: a.slug, name: a.name, nameEn: a['name-en'], domains: a.domain,
    adminUsername: a.admin || process.env.ADMIN_USERNAME || 'admin', adminPassword: password, contactEmail: a.email,
  });
  console.log(`✓ tenant "${t.slug}" created in schema ${t.schema_name}`);
  console.log(`  admin login: /admin  user: ${a.admin || process.env.ADMIN_USERNAME || 'admin'}`);
  await db.pool.end();
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end(); process.exit(1); });
