'use strict';
/** Per-tenant site_settings, cached briefly per schema. */
const db = require('../db');

const cache = new Map(); // schema -> { at, map }
const TTL = 15_000;

async function all() {
  const schema = db.currentSchema();
  const hit = cache.get(schema);
  if (hit && Date.now() - hit.at < TTL) return hit.map;
  const rows = await db.many('SELECT setting_key, setting_value FROM site_settings');
  const map = Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value ?? '']));
  cache.set(schema, { at: Date.now(), map });
  return map;
}

async function get(key, fallback = '') {
  const v = (await all())[key];
  return v === undefined || v === '' ? fallback : v;
}

async function set(key, value, meta = {}) {
  await db.query(
    `INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP`,
    [key, value, meta.type || 'text', meta.label || key, meta.group || 'general']);
  cache.delete(db.currentSchema());
}

async function grouped() {
  return db.many('SELECT * FROM site_settings ORDER BY setting_group, id');
}

module.exports = { all, get, set, grouped, invalidate: () => cache.delete(db.currentSchema()) };
