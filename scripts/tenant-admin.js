#!/usr/bin/env node
'use strict';
/** Create or reset a tenant super-admin:  npm run tenant:admin -- --tenant=aakash --username=admin --password=Secret@12345 */
const db = require('../src/db');
const auth = require('../src/lib/auth');

const a = Object.fromEntries(process.argv.slice(2).map(x => x.match(/^--([\w-]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
(async () => {
  if (!a.tenant || !a.username || !a.password || a.password.length < 10) throw new Error('Usage: --tenant=<slug> --username=<name> --password=<min 10 chars>');
  const t = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [a.tenant]);
  if (!t) throw new Error('tenant not found');
  await db.withSchema(t.schema_name, async () => {
    const hash = await auth.hashPassword(a.password);
    const existing = await db.one('SELECT id FROM admin_users WHERE lower(username) = lower($1)', [a.username]);
    if (existing) await db.query("UPDATE admin_users SET password = $1, is_active = 1, status = 'active', deleted_at = NULL, must_change_password = 1 WHERE id = $2", [hash, existing.id]);
    else await db.query("INSERT INTO admin_users (username, password, full_name, role, is_active, status, must_change_password) VALUES ($1, $2, 'Super Admin', 'superadmin', 1, 'active', 1)", [a.username, hash]);
    console.log(`✓ ${existing ? 'reset' : 'created'} superadmin "${a.username}" in ${t.slug} (must change password at first login)`);
  });
  await db.pool.end();
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end(); process.exit(1); });
