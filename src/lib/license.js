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
    if (p === '/admin/login' || p.startsWith('/admin/login/') || p === '/admin/logout') return next();
    if (req.admin && isSuper(req.admin.role)) return next();
    if (req.admin) { delete req.session.adminId; }
    return res.status(403).render('public/license-expired', { layout: false, st, adminBlocked: true });
  }
  return res.status(503).render('public/license-expired', { layout: false, st, adminBlocked: false });
}

/** Block non-super-admin logins while expired (called from the login route). */
function loginBlocked(tenant, user) {
  return status(tenant).expired && !isSuper(user.role);
}

module.exports = { status, guard, loginBlocked, todayKathmandu };
