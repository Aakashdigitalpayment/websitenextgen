'use strict';
/**
 * PHP admins often typed Bikram Sambat dates into AD DATE columns (notices.notice_date, careers.deadline …).
 * normalise() rewrites those rows (year ≥ 2070) to the matching AD date so ordering and deadline checks work.
 * Views keep a display fallback (nd.toBs) for values typed later.
 */
const db = require('../db');
const nd = require('./nepali-date');

const COLUMNS = [
  ['notices', 'notice_date'], ['notices', 'popup_expires_at'], ['careers', 'deadline'], ['auction_notices', 'auction_date'],
  ['election_milestones', 'event_date'], ['upcoming_programs', 'event_date'], ['awards', 'award_date'],
];

/** Run inside a tenant schema. Returns { 'table.column': rowsFixed }. Columns that are missing or not DATE are skipped. */
async function normalise() {
  const out = {};
  for (const [table, col] of COLUMNS) {
    const type = await db.value('SELECT data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2', [table, col]);
    if (type !== 'date') continue;
    const c = db.ident(col), t = db.ident(table);
    const rows = await db.many(`SELECT id, ${c} AS v FROM ${t} WHERE EXTRACT(YEAR FROM ${c}) >= 2070`);
    let n = 0;
    for (const r of rows) {
      const ad = nd.bsToAd(r.v);
      if (!ad) continue;
      await db.query(`UPDATE ${t} SET ${c} = $1 WHERE id = $2`, [ad, r.id]);
      n++;
    }
    if (n) out[table + '.' + col] = n;
  }
  return out;
}

module.exports = { normalise, COLUMNS };
