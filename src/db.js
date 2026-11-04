'use strict';
/**
 * PostgreSQL access with schema-per-tenant isolation.
 *
 * Every tenant (cooperative) lives in its own schema, e.g. tenant_aakash.
 * The current tenant is carried in AsyncLocalStorage for the lifetime of a
 * request; each query checks a client out of the pool and makes sure its
 * search_path points at that tenant's schema before running. Shared platform
 * tables (tenants, sessions) live in the "platform" schema and are always
 * schema-qualified.
 */
const { AsyncLocalStorage } = require('async_hooks');
const pg = require('pg');
const config = require('./config');

pg.types.setTypeParser(1082, v => v);                                  // DATE -> 'YYYY-MM-DD'
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));    // NUMERIC -> number
pg.types.setTypeParser(20, v => (v === null ? null : Number(v)));      // BIGINT -> number

const pool = new pg.Pool({
  connectionString: config.databaseUrl, max: Number(process.env.PG_POOL_MAX || 10),
  options: `-c TimeZone=${process.env.TZ || 'Asia/Kathmandu'} -c statement_timeout=30000`,
});
const als = new AsyncLocalStorage();
const clientSchema = new WeakMap(); // pg client -> schema its search_path currently points at

const IDENT = /^[a-z_][a-z0-9_]*$/;
function ident(name) {
  if (typeof name !== 'string' || !IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return name;
}

/** Run fn with every query inside it bound to `schema`. */
function withSchema(schema, fn) { return als.run({ schema: ident(schema) }, fn); }
function currentSchema() { return als.getStore()?.schema || null; }

async function bindClient(client, schema) {
  const want = schema || 'platform';
  if (clientSchema.get(client) !== want) {
    await client.query(`SET search_path TO ${ident(want)}, platform, public`);
    clientSchema.set(client, want);
  }
}

async function query(text, params = []) {
  const store = als.getStore();
  if (store?.tx) return store.tx.query(text, params);
  const client = await pool.connect();
  try {
    await bindClient(client, store?.schema);
    return await client.query(text, params);
  } finally { client.release(); }
}

/** Run fn inside a transaction on the current tenant schema. */
async function transaction(fn) {
  const store = als.getStore() || {};
  const client = await pool.connect();
  try {
    await bindClient(client, store.schema);
    await client.query('BEGIN');
    const result = await als.run({ ...store, tx: client }, fn);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { client.release(); }
}

async function many(text, params) { return (await query(text, params)).rows; }
async function one(text, params) { return (await query(text, params)).rows[0] || null; }
async function value(text, params) {
  const row = await one(text, params);
  return row ? Object.values(row)[0] : null;
}

/** INSERT a row from a plain object; returns the inserted row. */
async function insert(table, data) {
  const keys = Object.keys(data).map(ident);
  const sql = `INSERT INTO ${ident(table)} (${keys.join(', ')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(', ')}) RETURNING *`;
  return (await query(sql, Object.values(data))).rows[0];
}

/** UPDATE table SET data WHERE id = $n; returns the updated row. */
async function update(table, id, data) {
  const keys = Object.keys(data).map(ident);
  if (!keys.length) return one(`SELECT * FROM ${ident(table)} WHERE id = $1`, [id]);
  const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  return (await query(`UPDATE ${ident(table)} SET ${sets} WHERE id = $${keys.length + 1} RETURNING *`, [...Object.values(data), id])).rows[0] || null;
}

/** Column names of a table in the current tenant schema (cached per schema). */
const colCache = new Map();
async function columns(table) {
  const schema = currentSchema() || 'platform';
  const key = schema + '.' + table;
  if (!colCache.has(key)) {
    const rows = await many(
      'SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [schema, table]);
    colCache.set(key, new Map(rows.map(r => [r.column_name, r.data_type])));
  }
  return colCache.get(key);
}

/** Keep only keys that are real columns of `table`. */
async function pick(table, data) {
  const cols = await columns(table);
  return Object.fromEntries(Object.entries(data).filter(([k, v]) => cols.has(k) && v !== undefined));
}

module.exports = { pool, query, many, one, value, insert, update, columns, pick, ident, withSchema, currentSchema, transaction };
