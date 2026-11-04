'use strict';
/**
 * Restore a tenant from the JSON export written by POST /admin/backup
 * ({ tenant, schema, exported_at, tables: { name: [rows] } }).
 *
 * Strict: the file must belong to this tenant, every table and column must exist here, rows must be
 * plain objects. Accounts, roles, audit trail, credentials vault, OTPs and migrations are never touched,
 * and values the export redacted (password hashes, secret settings) keep their current value.
 * Everything runs in one transaction — any error rolls the whole restore back.
 */
const db = require('../db');

// tables that are never overwritten by a restore
const KEEP = new Set(['schema_migrations', 'admin_users', 'admin_roles', 'audit_log', 'login_attempts', 'member_otp_tokens', 'office_credentials', 'app_error_log']);
const SECRET_SETTING = /password|api_key|token|secret|private/;
const MAX_ROWS = 200000;

class RestoreError extends Error {}

/** Validate a parsed backup against the current schema. Returns a plan: [{ table, rows, columns }] + skipped. */
async function validate(data, tenant) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new RestoreError('Not a backup file (JSON object expected).');
  if (data.tenant !== tenant.slug) throw new RestoreError(`This backup belongs to "${String(data.tenant || '?').slice(0, 60)}", not "${tenant.slug}".`);
  if (!data.tables || typeof data.tables !== 'object' || Array.isArray(data.tables)) throw new RestoreError('Backup has no "tables" object.');
  const schema = db.currentSchema();
  const existing = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [schema])).map(r => r.table_name));
  const plan = [], skipped = [];
  for (const [table, rows] of Object.entries(data.tables)) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) throw new RestoreError(`Invalid table name: ${table.slice(0, 60)}`);
    if (!existing.has(table)) throw new RestoreError(`Unknown table in backup: ${table}`);
    if (!Array.isArray(rows)) throw new RestoreError(`Table ${table}: rows must be a list.`);
    if (rows.length > MAX_ROWS) throw new RestoreError(`Table ${table}: too many rows.`);
    if (KEEP.has(table)) { skipped.push({ table, rows: rows.length }); continue; }
    const cols = await db.columns(table);
    const used = new Set();
    for (const [i, r] of rows.entries()) {
      if (!r || typeof r !== 'object' || Array.isArray(r)) throw new RestoreError(`Table ${table}, row ${i + 1}: not an object.`);
      for (const k of Object.keys(r)) {
        if (!cols.has(k)) throw new RestoreError(`Table ${table}: unknown column "${k.slice(0, 60)}".`);
        used.add(k);
      }
    }
    plan.push({ table, rows: rows.length, columns: [...used] });
  }
  if (!plan.length) throw new RestoreError('Backup contains no restorable tables.');
  return { plan, skipped, exportedAt: typeof data.exported_at === 'string' ? data.exported_at.slice(0, 40) : null };
}

const pad = n => String(n).padStart(2, '0');
/** node-postgres read "timestamp without time zone" as local time; undo that so wall-clock values survive. */
function localWallClock(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function convert(value, type) {
  if (value === null || value === undefined) return null;
  if (type === 'timestamp without time zone' && typeof value === 'string' && /Z$|[+-]\d\d:\d\d$/.test(value)) return localWallClock(value);
  if (type === 'bytea' && value && value.type === 'Buffer' && Array.isArray(value.data)) return '\\x' + Buffer.from(value.data).toString('hex');
  return value;
}

/** Apply a validated backup. Returns { tables, rows }. */
async function apply(data, tenant) {
  const { plan } = await validate(data, tenant);
  return db.transaction(async () => {
    let total = 0;
    for (const { table, columns } of plan) {
      const t = db.ident(table);
      const types = await db.columns(table);
      let rows = data.tables[table];
      if (table === 'members') {
        // the export redacts password hashes: keep the current hash of each member id
        const hashes = new Map((await db.many('SELECT id, password_hash FROM members')).map(r => [r.id, r.password_hash]));
        rows = rows.map(r => (r.password_hash == null && hashes.has(r.id) ? { ...r, password_hash: hashes.get(r.id) } : r));
      }
      if (table === 'site_settings') {
        const current = new Map((await db.many('SELECT setting_key, setting_value FROM site_settings')).map(r => [r.setting_key, r.setting_value]));
        rows = rows.map(r => (SECRET_SETTING.test(r.setting_key) && r.setting_value == null && current.has(r.setting_key) ? { ...r, setting_value: current.get(r.setting_key) } : r));
      }
      await db.query(`DELETE FROM ${t}`);
      if (rows.length && columns.length) {
        const list = columns.map(db.ident).join(', ');
        for (let i = 0; i < rows.length; i += 1000) {
          const batch = rows.slice(i, i + 1000).map(r => Object.fromEntries(columns.map(c => [c, convert(r[c], types.get(c))])));
          await db.query(`INSERT INTO ${t} (${list}) SELECT ${list} FROM json_populate_recordset(NULL::${t}, $1::json)`, [JSON.stringify(batch)]);
        }
      }
      if (types.has('id')) {
        const seq = await db.value('SELECT pg_get_serial_sequence($1, $2)', [table, 'id']);
        if (seq) await db.query(`SELECT setval($1, GREATEST(COALESCE((SELECT max(id) FROM ${t}), 0), 1))`, [seq]);
      }
      total += rows.length;
    }
    return { tables: plan.length, rows: total };
  });
}

module.exports = { validate, apply, RestoreError, KEEP };
