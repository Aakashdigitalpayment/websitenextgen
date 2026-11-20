'use strict';
/**
 * Site licence per tenant (platform.tenants.license_valid_until, AD date).
 * Expired → public site shows a notice and only super-admins may sign in (same rule as the PHP app).
 */
const nd = require('./nepali-date');

function todayKathmandu() {
  return new Date(Date.now() + (5 * 60 + 45) * 60_000).toISOString().slice(0, 10);
}

function status(tenant) {
  const until = tenant.license_valid_until ? String(tenant.license_valid_until).slice(0, 10) : null;
  if (!until) return { configured: false, expired: false, daysLeft: null, until: null, untilBs: null };
  const days = Math.round((Date.parse(until) - Date.parse(todayKathmandu())) / 86400_000);
  return { configured: true, expired: days < 0, daysLeft: days, until, untilBs: nd.adToBs(until) };
}

const isSuper = role => role === 'superadmin' || role === 'super_admin';

/** Express middleware (after auth.loadUsers). */
function guard(req, res, next) {
  const st = status(req.tenant);
  res.locals.license = st;
  if (!st.expired) return next();
  const p = req.path;
  if (p.startsWith('/static') || p.startsWith('/uploads') || p === '/robots.txt' || p === '/healthz') return next();
  if (p.startsWith('/admin')) {
    if (p === '/admin/login' || p.startsWith('/admin/login/') || p === '/admin/logout' || p === '/admin/license/blocked') return next();
    if (req.admin && isSuper(req.admin.role)) return next();
    if (req.admin) { delete req.session.adminId; }
    return res.status(403).render('public/license-expired', { layout: false, st, adminBlocked: true });
  }
  return res.status(503).render('public/license-expired', { layout: false, st, adminBlocked: false });
}

/**
 * Where to pay (shown to the tenant): platform-wide env LICENSE_RENEWAL_AMOUNT, LICENSE_ESEWA_ID, LICENSE_KHALTI_ID,
 * LICENSE_BANK_DETAILS, LICENSE_VENDOR_EMAIL; amount / eSewa / Khalti may be overridden per tenant by the platform
 * operator (site-license.php save_renewal_settings) — tenant settings license_renewal_amount / license_esewa_id / license_khalti_id.
 * @param {object} s  the tenant's settings (res.locals.settings)
 */
const PAY_KEYS = { amount: 'license_renewal_amount', esewa: 'license_esewa_id', khalti: 'license_khalti_id' };
function payInfo(s = {}) {
  const e = k => String(process.env[k] || '').trim().slice(0, 120);
  const o = k => String((s && s[PAY_KEYS[k]]) || '').trim().slice(0, 120);
  return { amount: o('amount') || e('LICENSE_RENEWAL_AMOUNT'), esewa: o('esewa') || e('LICENSE_ESEWA_ID'), khalti: o('khalti') || e('LICENSE_KHALTI_ID'), bank: e('LICENSE_BANK_DETAILS'), vendorEmail: e('LICENSE_VENDOR_EMAIL') };
}

/** Licence date typed by the operator: A.D. YYYY-MM-DD, or B.S. (year 2050 or later) converted to A.D. */
function parseUntil(v) {
  const s = nd.toLatinDigits(String(v || '').trim());
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) return null;
  if (Number(s.slice(0, 4)) >= 2050) return nd.bsToAd(s);
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Block non-super-admin logins while expired (called from the login route). */
function loginBlocked(tenant, user) {
  return status(tenant).expired && !isSuper(user.role);
}

module.exports = { status, guard, loginBlocked, todayKathmandu, payInfo, parseUntil, PAY_KEYS };
