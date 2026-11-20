#!/usr/bin/env node
'use strict';
/**
 * PII column maintenance (port of the PHP scripts/pii-encrypt.php).
 *
 *   npm run pii -- status   [--tenant=slug | --all]            encrypted vs plaintext per table/column
 *   npm run pii -- keygen                                      print a new PII_KEY (never written to disk)
 *   npm run pii -- migrate  [--tenant=slug | --all] [--dry-run] encrypt plaintext (and legacy pii1/pii2) values
 *   npm run pii -- decrypt  [--tenant=slug | --all] [--dry-run] roll back to plaintext
 *
 * Values are read with raw pool queries (no transparent decryption), each new value is checked with a round
 * trip before it is written, and every UPDATE is guarded with "WHERE col = <old value>" so a row changed in
 * the meantime is left alone.
 */
const crypto = require('crypto');
const db = require('../src/db');
const pii = require('../src/lib/pii-crypto');

const BATCH = 500;
const q = (sql, params) => db.pool.query(sql, params); // raw: values come back exactly as stored

async function columnInfo(schema, table, col) {
  const r = await q(`SELECT data_type, character_maximum_length AS len FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`, [schema, table, col]);
  return r.rows[0] || null;
}

/** Counts per PII column of one tenant schema. */
async function status(schema) {
  const out = [];
  for (const [table, cols] of Object.entries(pii.PII_COLUMNS)) {
    for (const col of cols) {
      if (!(await columnInfo(schema, table, col))) continue;
      const t = `${db.ident(schema)}.${db.ident(table)}`, c = db.ident(col);
      const r = (await q(`SELECT count(*) FILTER (WHERE ${c} LIKE 'pii3:%') AS encrypted, count(*) FILTER (WHERE ${c} ~ '^pii[12]:') AS legacy,
                                 count(*) FILTER (WHERE COALESCE(${c}, '') <> '' AND ${c} !~ '^pii[123]:') AS plaintext FROM ${t}`)).rows[0];
      out.push({ table, column: col, encrypted: Number(r.encrypted), legacy: Number(r.legacy), plaintext: Number(r.plaintext) });
    }
  }
  return out;
}

/**
 * Encrypt (mode 'migrate') or decrypt (mode 'decrypt') every PII value of one schema.
 * Returns [{ table, column, changed, skipped }]; nothing is written with dryRun.
 */
async function convert(schema, mode, { dryRun = false } = {}) {
  if (mode === 'migrate' && !pii.enabled()) throw new Error('PII_KEY is not set (64 hex chars, or any string of 32+ chars)');
  const out = [];
  for (const [table, cols] of Object.entries(pii.PII_COLUMNS)) {
    for (const col of cols) {
      const info = await columnInfo(schema, table, col);
      if (!info) continue;
      const t = `${db.ident(schema)}.${db.ident(table)}`, c = db.ident(col);
      if (mode === 'migrate' && !dryRun && info.data_type === 'character varying' && Number(info.len) < 512) {
        await q(`ALTER TABLE ${t} ALTER COLUMN ${c} TYPE VARCHAR(512)`); // room for the encoded value
      }
      const want = mode === 'migrate' ? `COALESCE(${c}, '') <> '' AND ${c} NOT LIKE 'pii3:%'` : `${c} ~ '^pii[123]:'`;
      let lastId = 0, changed = 0, skipped = 0;
      for (;;) {
        const rows = (await q(`SELECT id, ${c} AS v FROM ${t} WHERE id > $1 AND ${want} ORDER BY id LIMIT ${BATCH}`, [lastId])).rows;
        if (!rows.length) break;
        for (const { id, v } of rows) {
          lastId = id;
          let next = null;
          if (mode === 'migrate') {
            const plain = pii.isEncrypted(v) ? pii.decrypt(v, schema) : v; // legacy pii1/pii2 needs PII_LEGACY_KEY
            const enc = pii.isEncrypted(plain) ? null : pii.encrypt(plain, schema);
            if (enc && pii.isEncrypted(enc) && pii.decrypt(enc, schema) === plain) next = enc;
          } else {
            const plain = pii.decrypt(v, schema);
            if (!pii.isEncrypted(plain)) next = plain;
          }
          if (next === null || next === v) { skipped++; continue; }
          if (!dryRun) {
            const u = await q(`UPDATE ${t} SET ${c} = $1 WHERE id = $2 AND ${c} = $3`, [next, id, v]);
            if (!u.rowCount) { skipped++; continue; }
          }
          changed++;
        }
      }
      out.push({ table, column: col, changed, skipped });
    }
  }
  return out;
}

async function schemas(args) {
  if (args.tenant) {
    const t = (await q('SELECT schema_name FROM platform.tenants WHERE slug = $1', [args.tenant])).rows[0];
    if (!t) throw new Error(`tenant "${args.tenant}" not found`);
    return [t.schema_name];
  }
  if (!args.all) throw new Error('choose --tenant=<slug> or --all');
  return (await q('SELECT schema_name FROM platform.tenants ORDER BY id')).rows.map(r => r.schema_name);
}

async function main(argv) {
  const cmd = argv[0];
  const args = Object.fromEntries(argv.slice(1).map(x => x.match(/^--([\w-]+)(?:=(.*))?$/)).filter(Boolean).map(m => [m[1], m[2] === undefined ? true : m[2]]));
  if (cmd === 'keygen') {
    console.log(crypto.randomBytes(32).toString('hex'));
    console.error('Put this in PII_KEY (.env) and back it up offline. Losing it makes encrypted values unreadable; never change it once data is encrypted.');
    return;
  }
  if (!['status', 'migrate', 'decrypt'].includes(cmd)) {
    console.error('Usage: npm run pii -- status|keygen|migrate|decrypt [--tenant=<slug> | --all] [--dry-run]');
    process.exitCode = 2;
    return;
  }
  console.log(`PII_KEY: ${pii.enabled() ? 'configured' : 'NOT configured'}`);
  for (const schema of await schemas(args)) {
    const rows = cmd === 'status' ? await status(schema) : await convert(schema, cmd, { dryRun: !!args['dry-run'] });
    console.log(`\n${schema}${args['dry-run'] ? ' (dry run)' : ''}`);
    for (const r of rows) {
      console.log(cmd === 'status'
        ? `  ${r.table}.${r.column}: ${r.encrypted} encrypted, ${r.legacy} legacy (PHP), ${r.plaintext} plaintext`
        : `  ${r.table}.${r.column}: ${r.changed} ${cmd === 'migrate' ? 'encrypted' : 'decrypted'}, ${r.skipped} skipped`);
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(() => db.pool.end()).catch(async e => { console.error('✗ ' + e.message); await db.pool.end(); process.exit(1); });
}

module.exports = { status, convert };
