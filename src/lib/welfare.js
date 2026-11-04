'use strict';
/**
 * Institutional-profile welfare (relief) totals: pre-portal opening balances + approved member welfare claims,
 * snapshotted per monthly profile (legacy includes/institutional-profile-welfare.php).
 */
const db = require('../db');
const nd = require('./nepali-date');

const SLUG = /^[a-z0-9_-]{1,60}$/i;
const PAID = ['approved', 'paid', 'completed'];
// approved amount when set, otherwise the claimed amount
const SUM = 'COALESCE(sum(CASE WHEN COALESCE(approved_amount, 0) > 0 THEN approved_amount ELSE COALESCE(claim_amount, 0) END), 0)';
const DAY_EXPR = 'COALESCE(claim_date_ad, updated_at::date, created_at::date)';

const types = () => db.many('SELECT slug, name_np, name_en, color, is_active FROM welfare_claim_types ORDER BY display_order, id');

async function openingMap() {
  const rows = await db.many('SELECT claim_type, opening_count, opening_amount, note FROM institutional_welfare_opening ORDER BY claim_type');
  return Object.fromEntries(rows.map(r => [r.claim_type, { count: Number(r.opening_count), amount: Number(r.opening_amount), note: r.note || '' }]));
}

/** Replace all opening rows; empty rows are dropped. rows: { slug: { count, amount, note } } */
async function saveOpening(rows) {
  await db.transaction(async () => {
    await db.query('DELETE FROM institutional_welfare_opening');
    for (const [slug, v] of Object.entries(rows)) {
      if (!SLUG.test(slug)) continue;
      const count = Math.max(0, parseInt(v.count, 10) || 0), amount = Math.max(0, Number(v.amount) || 0), note = String(v.note || '').trim().slice(0, 255);
      if (!count && !amount && !note) continue;
      await db.query('INSERT INTO institutional_welfare_opening (claim_type, opening_count, opening_amount, note, updated_at) VALUES ($1, $2, $3, $4, now())', [slug, count, amount, note]);
    }
  });
}

/** Approved claims aggregated per type: mode 'upto' (≤ to) or 'period' (from..to inclusive). */
async function claimsAgg(mode, to, from = null) {
  const rows = mode === 'period'
    ? await db.many(`SELECT claim_type AS slug, count(*) AS n, ${SUM} AS amt FROM member_welfare_claims WHERE status = ANY($3) AND ${DAY_EXPR} BETWEEN $1 AND $2 GROUP BY claim_type`, [from, to, PAID])
    : await db.many(`SELECT claim_type AS slug, count(*) AS n, ${SUM} AS amt FROM member_welfare_claims WHERE status = ANY($2) AND ${DAY_EXPR} <= $1 GROUP BY claim_type`, [to, PAID]);
  return Object.fromEntries(rows.filter(r => r.slug).map(r => [r.slug, { count: Number(r.n), amount: Number(r.amt) }]));
}

function merge(...maps) {
  const out = {};
  for (const m of maps) for (const [k, v] of Object.entries(m || {})) {
    out[k] = out[k] || { count: 0, amount: 0 };
    out[k].count += Number(v.count) || 0; out[k].amount += Number(v.amount) || 0;
  }
  return out;
}

const addDays = (ad, n) => new Date(Date.parse(ad + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/**
 * AD bounds of a profile's BS report month. Fiscal year "2082/83" starts in Shrawan (month 4), so months 4–12 fall in 2082
 * and 1–3 in 2083. Month 0 (annual) = the whole fiscal year.
 */
function reportBounds(profile) {
  const fy = parseInt(String(profile.fiscal_year || '').match(/^(\d{4})/)?.[1], 10);
  if (!fy) return null;
  const m = Number(profile.report_month) || 0;
  const pad = n => String(n).padStart(2, '0');
  let fromBs, nextBs;
  if (m >= 1 && m <= 12) {
    const y = m >= 4 ? fy : fy + 1;
    fromBs = `${y}-${pad(m)}-01`;
    nextBs = m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
  } else { fromBs = `${fy}-04-01`; nextBs = `${fy + 1}-04-01`; }
  const from = nd.bsToAd(fromBs), next = nd.bsToAd(nextBs);
  return from && next ? { from, to: addDays(next, -1) } : null;
}

const fyMonthKey = p => { const fy = parseInt(String(p.fiscal_year || '').match(/^(\d{4})/)?.[1], 10) || 0; const m = Number(p.report_month) || 0; return fy * 100 + (m === 0 ? 99 : m >= 4 ? m - 3 : m + 9); };

/** Latest profile before this one (by fiscal year + month) that has a saved welfare snapshot. */
async function previousSnapshot(profile) {
  const rows = await db.many('SELECT * FROM institutional_profile WHERE id <> $1 ORDER BY id DESC LIMIT 1000', [profile.id || 0]);
  const key = fyMonthKey(profile);
  const prev = rows.filter(r => fyMonthKey(r) < key).sort((a, b) => fyMonthKey(b) - fyMonthKey(a))[0];
  if (!prev) return null;
  const saved = await loadProfileRows(prev.id);
  return Object.keys(saved).length ? { profile: prev, rows: saved } : null;
}

async function loadProfileRows(profileId) {
  const rows = await db.many('SELECT claim_type, month_count, month_amount, cum_count, cum_amount FROM institutional_profile_welfare WHERE profile_id = $1 ORDER BY claim_type', [profileId]);
  return Object.fromEntries(rows.map(r => [r.claim_type, { month_count: Number(r.month_count), month_amount: Number(r.month_amount), cum_count: Number(r.cum_count), cum_amount: Number(r.cum_amount) }]));
}

async function saveProfileRows(profileId, rows) {
  await db.transaction(async () => {
    await db.query('DELETE FROM institutional_profile_welfare WHERE profile_id = $1', [profileId]);
    for (const [slug, v] of Object.entries(rows)) {
      if (!SLUG.test(slug)) continue;
      const mc = Math.max(0, parseInt(v.month_count, 10) || 0), ma = Math.max(0, Number(v.month_amount) || 0);
      const cc = Math.max(0, parseInt(v.cum_count, 10) || 0), ca = Math.max(0, Number(v.cum_amount) || 0);
      if (!mc && !ma && !cc && !ca) continue;
      await db.query(`INSERT INTO institutional_profile_welfare (profile_id, claim_type, month_count, month_amount, cum_count, cum_amount, updated_at)
                      VALUES ($1, $2, $3, $4, $5, $6, now())`, [profileId, slug, mc, ma, cc, ca]);
    }
  });
}

/**
 * Suggested values for a profile month (legacy coopIpWelfarePrefillForMonth):
 * month = approved claims in the month; cumulative = previous snapshot + month, or opening + all approved claims up to month end.
 */
async function prefill(profile) {
  const b = reportBounds(profile);
  if (!b) return [];
  const [opening, month, upto, prev, typeRows] = await Promise.all([openingMap(), claimsAgg('period', b.to, b.from), claimsAgg('upto', b.to), previousSnapshot(profile), types()]);
  let prevAgg;
  if (prev) prevAgg = Object.fromEntries(Object.entries(prev.rows).map(([k, v]) => [k, { count: v.cum_count, amount: v.cum_amount }]));
  else prevAgg = merge(opening, await claimsAgg('upto', addDays(b.from, -1)));
  const cum = prev ? merge(prevAgg, month) : merge(opening, upto);
  const slugs = [...new Set([...typeRows.map(t => t.slug), ...Object.keys(month), ...Object.keys(cum), ...Object.keys(prevAgg)])];
  return slugs.map(slug => {
    const ty = typeRows.find(t => t.slug === slug) || {};
    return {
      slug, label: [ty.name_np || ty.name_en || slug, ty.name_en || ty.name_np || slug], color: ty.color || '#6b7280',
      prev_count: prevAgg[slug]?.count || 0, prev_amount: prevAgg[slug]?.amount || 0, month_count: month[slug]?.count || 0, month_amount: month[slug]?.amount || 0,
      cum_count: cum[slug]?.count || 0, cum_amount: cum[slug]?.amount || 0,
    };
  }).sort((a, b) => a.label[0].localeCompare(b.label[0]));
}

/** Public list for a profile: saved snapshot, else opening + live approved claims up to the month end (legacy coopIpWelfareResolveForProfile). */
async function forProfile(profile) {
  const typeRows = await types();
  const saved = profile.id ? await loadProfileRows(profile.id) : {};
  let agg;
  if (Object.keys(saved).length) agg = Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, { count: v.cum_count, amount: v.cum_amount }]));
  else {
    const b = reportBounds(profile);
    agg = merge(await openingMap(), b ? await claimsAgg('upto', b.to) : {});
  }
  const out = typeRows.filter(t => agg[t.slug] && (agg[t.slug].count || agg[t.slug].amount)).map(t => ({ slug: t.slug, label: [t.name_np || t.slug, t.name_en || t.name_np || t.slug], color: t.color || '#ff9800', ...agg[t.slug] }));
  for (const [slug, v] of Object.entries(agg)) if (!typeRows.some(t => t.slug === slug) && (v.count || v.amount)) out.push({ slug, label: [slug, slug], color: '#6b7280', ...v });
  return out;
}

module.exports = { types, openingMap, saveOpening, claimsAgg, merge, reportBounds, loadProfileRows, saveProfileRows, prefill, forProfile };
