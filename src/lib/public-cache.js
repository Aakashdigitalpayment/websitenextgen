'use strict';
/** Small per-tenant (per-schema) TTL cache for public-site queries (home payload, popups, bell, ticker, nav counts). */
const db = require('../db');

const store = new Map(); // `${schema}|${key}` -> { at, ttl, value }
const inflight = new Map();

/** Cached value of loader() for `ttlMs`, per tenant schema. Concurrent misses share one load. */
async function cached(key, ttlMs, loader) {
  const k = db.currentSchema() + '|' + key;
  const hit = store.get(k);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  if (inflight.has(k)) return inflight.get(k);
  const p = Promise.resolve().then(loader).then(value => { store.set(k, { at: Date.now(), value }); return value; }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

/** Drop this tenant's cached entries (all, or one key). */
function clear(key) {
  const prefix = db.currentSchema() + '|';
  for (const k of store.keys()) if (k.startsWith(prefix) && (!key || k === prefix + key)) store.delete(k);
}

module.exports = { cached, clear };
