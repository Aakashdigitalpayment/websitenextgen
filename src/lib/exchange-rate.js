'use strict';
/**
 * Nepal Rastra Bank forex rates (https://www.nrb.org.np/api/forex/v1/rates).
 * Shared by all tenants; cached in memory for 6 hours. Falls back to the last good copy.
 */
const fs = require('fs');
const path = require('path');
const CACHE_MS = 6 * 3600_000;
let cache = null; // { at, data }
let inflight = null;
// last good payload survives a restart during an NRB outage (exchange-rate.php kept a per-day file)
const FILE = () => path.join(require('../config').uploadDir, '_shared', 'nrb-forex.json');
function loadFile() {
  try { const j = JSON.parse(fs.readFileSync(FILE(), 'utf8')); return j && j.data && Array.isArray(j.data.rates) ? j : null; } catch { return null; }
}
function saveFile(c) {
  try { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); fs.writeFileSync(FILE() + '.tmp', JSON.stringify(c)); fs.renameSync(FILE() + '.tmp', FILE()); } catch { /* read-only disk: memory cache only */ }
}

async function latest() {
  if (!cache) cache = loadFile();
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  if (!inflight) inflight = fetchLatest().finally(() => { inflight = null; });
  return inflight;
}

async function fetchLatest() {
  const to = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://www.nrb.org.np/api/forex/v1/rates?per_page=10&page=1&from=${from}&to=${to}`, {
      signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': 'CooperativeWebsite/1.0' },
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const json = await r.json();
    const payload = (json?.data?.payload || []).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    if (!payload) throw new Error('empty payload');
    const data = {
      date: payload.date, source: 'live',
      rates: (payload.rates || []).map(x => ({
        iso: x.currency?.iso3, name: x.currency?.name, unit: x.currency?.unit, buy: Number(x.buy), sell: Number(x.sell),
      })),
    };
    cache = { at: Date.now(), data };
    saveFile(cache);
    return data;
  } catch (e) {
    if (cache) return { ...cache.data, source: 'cached' };
    return { date: null, source: 'unavailable', rates: [], error: e.message };
  }
}

module.exports = { latest };
