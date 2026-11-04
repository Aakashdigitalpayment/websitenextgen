#!/usr/bin/env node
'use strict';
/**
 * Copy a legacy MySQL database (the PHP site) into one tenant's PostgreSQL schema.
 *
 *   node scripts/import-from-mysql.js --tenant=aakash --mysql=mysql://user:pass@host:3306/dbname \
 *        [--uploads=/path/to/old-site/assets/uploads] [--truncate]
 *
 * - Only tables/columns that exist on both sides are copied.
 * - MySQL zero dates (0000-00-00) become NULL; strings are trimmed to fit nothing — Postgres
 *   VARCHAR limits match the converted schema.
 * - Sequences are reset to MAX(id) afterwards.
 * - --uploads copies the old assets/uploads tree into uploads/<tenant>/ so stored paths keep working.
 * - --truncate empties the tenant tables first (otherwise rows with existing ids are skipped).
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const config = require('../src/config');

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function fixValue(v, pgType) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^0000-00-00/.test(v)) return null;
  if (Buffer.isBuffer(v)) return pgType === 'bytea' ? v : v.toString('utf8');
  if (pgType === 'jsonb' && typeof v === 'object') return JSON.stringify(v);
  if (pgType === 'jsonb' && typeof v === 'string') { try { JSON.parse(v); return v; } catch { return JSON.stringify(v); } }
  if (typeof v === 'string') return v.replace(/\u0000/g, '');
  return v;
}

async function copyDir(src, dst) {
  await fs.promises.mkdir(dst, { recursive: true });
  for (const e of await fs.promises.readdir(src, { withFileTypes: true })) {
    if (e.name.startsWith('.') || /\.(php|phtml|phar|htaccess|html?|js)$/i.test(e.name)) continue; // never carry executable/HTML content over
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.promises.copyFile(s, d);
  }
}

(async () => {
  const a = args();
  if (!a.tenant || !(a.mysql || process.env.MYSQL_URL)) {
    console.error('Usage: node scripts/import-from-mysql.js --tenant=<slug> --mysql=mysql://user:pass@host/db [--uploads=dir] [--truncate]');
    process.exit(2);
  }
  let mysql;
  try { mysql = require('mysql2/promise'); } catch { console.error('Install mysql2 first: npm install mysql2'); process.exit(2); }
  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [a.tenant]);
  if (!tenant) throw new Error(`Tenant "${a.tenant}" not found — create it first with npm run tenant:create`);

  const my = await mysql.createConnection({ uri: a.mysql || process.env.MYSQL_URL, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4' });
  const [myTables] = await my.query('SHOW TABLES');
  const tables = myTables.map(r => Object.values(r)[0]);

  await db.withSchema(tenant.schema_name, async () => {
    const pgTables = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [tenant.schema_name])).map(r => r.table_name));
    const report = [];
    for (const table of tables) {
      if (!pgTables.has(table) || table === 'schema_migrations') { report.push([table, 'skipped (not in new schema)']); continue; }
      const pgCols = await db.columns(table);
      const [myColsRows] = await my.query(`SHOW COLUMNS FROM \`${table}\``);
      const cols = myColsRows.map(c => c.Field).filter(c => pgCols.has(c));
      if (!cols.length) { report.push([table, 'skipped (no shared columns)']); continue; }
      const [[{ n: srcRows }]] = await my.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
      if (!Number(srcRows)) { report.push([table, 'empty in source']); continue; }
      if (a.truncate) await db.query(`TRUNCATE ${db.ident(table)} RESTART IDENTITY CASCADE`);
      const hasId = cols.includes('id');
      let copied = 0, skipped = 0, offset = 0;
      const BATCH = 500;
      for (;;) {
        const [rows] = await my.query(`SELECT ${cols.map(c => '`' + c + '`').join(', ')} FROM \`${table}\` ${hasId ? 'ORDER BY id' : ''} LIMIT ${BATCH} OFFSET ${offset}`);
        if (!rows.length) break;
        offset += rows.length;
        await db.transaction(async () => {
          for (const row of rows) {
            const vals = cols.map(c => fixValue(row[c], pgCols.get(c)));
            const sql = `INSERT INTO ${db.ident(table)} (${cols.map(db.ident).join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING`;
            await db.query('SAVEPOINT r');
            try {
              const r = await db.query(sql, vals);
              if (r.rowCount) copied++; else skipped++;
              await db.query('RELEASE SAVEPOINT r');
            } catch (e) {
              await db.query('ROLLBACK TO SAVEPOINT r');
              skipped++;
              if (skipped <= 3) console.warn(`  ! ${table} id=${row.id ?? '?'}: ${e.message}`);
            }
          }
        });
      }
      if (hasId) {
        await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${db.ident(table)}), 1), (SELECT COUNT(*) > 0 FROM ${db.ident(table)}))`, [tenant.schema_name + '.' + table])
          .catch(() => {});
      }
      report.push([table, `${copied} copied${skipped ? `, ${skipped} skipped` : ''}`]);
    }
    console.table(report.filter(([, r]) => r !== 'empty in source').map(([t, r]) => ({ table: t, result: r })));
    if (!(await db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL AND is_active = 1'))) {
      console.warn(`! No active admin in ${tenant.slug}. Create one: npm run tenant:admin -- --tenant=${tenant.slug} --username=admin --password=...`);
    }
  });
  await my.end();

  if (a.uploads) {
    const dst = path.join(config.uploadDir, tenant.slug);
    await copyDir(path.resolve(String(a.uploads)), dst);
    console.log(`✓ uploads copied to ${dst}`);
  }
  console.log(`✓ import into ${tenant.schema_name} finished`);
  await db.pool.end();
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end(); process.exit(1); });
