'use strict';
const bcrypt = require('bcryptjs');
const db = require('../db');

// PHP password_hash() writes $2y$ — same algorithm as $2b$
const normHash = h => String(h || '').replace(/^\$2y\$/, '$2b$');
async function checkPassword(plain, hash) {
  if (!hash || !plain) return false;
  try { return await bcrypt.compare(String(plain), normHash(hash)); } catch { return false; }
}
const hashPassword = plain => bcrypt.hash(String(plain), 12);

// Role levels (legacy roles kept: superadmin / super_admin / admin / staff / editor)
const LEVEL = { editor: 1, staff: 2, admin: 3, superadmin: 4, super_admin: 4 };
const roleLevel = role => LEVEL[role] || 0;

/** Brute-force throttle using the legacy login_attempts table. */
const MAX_ATTEMPTS = 5, WINDOW_MIN = 15;
async function tooManyAttempts(username, ip) {
  const n = await db.value(
    `SELECT count(*) FROM login_attempts WHERE (username = $1 OR ip_address = $2) AND attempted_at > now() - interval '${WINDOW_MIN} minutes'`,
    [String(username).slice(0, 100), ip]);
  return n >= MAX_ATTEMPTS * 2 || (await db.value(
    `SELECT count(*) FROM login_attempts WHERE username = $1 AND attempted_at > now() - interval '${WINDOW_MIN} minutes'`, [String(username).slice(0, 100)])) >= MAX_ATTEMPTS;
}
async function recordFailure(username, ip) {
  await db.query('INSERT INTO login_attempts (username, ip_address, attempted_at) VALUES ($1, $2, now())', [String(username).slice(0, 100), ip]);
}
async function clearFailures(username) {
  await db.query('DELETE FROM login_attempts WHERE username = $1', [String(username).slice(0, 100)]);
}

/** Regenerate session id on login (prevents fixation), keep tenant binding. */
function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate(err => (err ? reject(err) : resolve())));
}

async function adminLogin(req, username, password) {
  const ip = req.ip;
  if (await tooManyAttempts(username, ip)) return { error: `धेरै पटक गलत प्रयास भयो। ${WINDOW_MIN} मिनेटपछि फेरि प्रयास गर्नुहोस्।` };
  const user = await db.one(
    `SELECT * FROM admin_users WHERE lower(username) = lower($1) AND deleted_at IS NULL`, [username]);
  const ok = user && (await checkPassword(password, user.password));
  if (!ok || !user.is_active || (user.status && user.status !== 'active')) {
    await recordFailure(username, ip);
    return { error: 'प्रयोगकर्ता नाम वा पासवर्ड मिलेन।' };
  }
  if (require('./license').loginBlocked(req.tenant, user)) {
    return { error: 'वेबसाइट सेवाको म्याद सकिएको छ। सुपर प्रशासकले मात्र लगइन गर्न सक्छन्। (Licence expired — super admin only.)' };
  }
  await clearFailures(username);
  await regenerate(req);
  req.session.tenantId = req.tenant.id;
  if (user.twofa_enabled && user.twofa_secret) {
    // password ok — second factor still required
    req.session.pending2fa = { id: user.id, at: Date.now() };
    return { user, needs2fa: true };
  }
  return completeAdminLogin(req, user);
}

async function completeAdminLogin(req, user) {
  delete req.session.pending2fa;
  req.session.adminId = user.id;
  await db.query('UPDATE admin_users SET last_login = now() WHERE id = $1', [user.id]);
  await audit(req, 'login', 'admin_users', user.id, `Admin login: ${user.username}`, { actorId: user.id, actorName: user.username });
  return { user };
}

async function memberLogin(req, identifier, password) {
  const ip = req.ip;
  const key = 'm:' + identifier;
  if (await tooManyAttempts(key, ip)) return { error: `धेरै पटक गलत प्रयास भयो। ${WINDOW_MIN} मिनेटपछि फेरि प्रयास गर्नुहोस्।` };
  const m = await db.one(
    `SELECT * FROM members WHERE deleted_at IS NULL AND (phone = $1 OR lower(email) = lower($1) OR sadasyata_number = $1 OR member_card_no = $1)
     ORDER BY id LIMIT 1`, [identifier]);
  const ok = m && (await checkPassword(password, m.password_hash));
  if (!ok) { await recordFailure(key, ip); return { error: 'सदस्य विवरण वा पासवर्ड मिलेन।' }; }
  if (!m.is_active) return { error: 'तपाईंको खाता निष्क्रिय छ। कार्यालयमा सम्पर्क गर्नुहोस्।' };
  if (m.approval_status && m.approval_status !== 'approved') return { error: 'तपाईंको खाता स्वीकृत हुन बाँकी छ।' };
  await clearFailures(key);
  await regenerate(req);
  req.session.tenantId = req.tenant.id;
  req.session.memberId = m.id;
  await db.query('UPDATE members SET last_login = now() WHERE id = $1', [m.id]);
  return { member: m };
}

/** Load the signed-in admin/member for this request (tenant-bound). */
async function loadUsers(req, res, next) {
  try {
    if (req.session.tenantId && req.session.tenantId !== req.tenant.id) {
      // session from another tenant (e.g. shared parent domain cookie) — drop identities
      delete req.session.adminId; delete req.session.memberId; req.session.tenantId = req.tenant.id;
    }
    if (req.session.adminId) {
      req.admin = await db.one(`SELECT id, username, full_name, email, role, is_active, must_change_password FROM admin_users
                                WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL`, [req.session.adminId]);
      if (!req.admin) delete req.session.adminId;
    }
    if (req.session.memberId) {
      req.member = await db.one(`SELECT * FROM members WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL`, [req.session.memberId]);
      if (!req.member) delete req.session.memberId;
    }
    res.locals.admin = req.admin || null;
    res.locals.member = req.member || null;
    next();
  } catch (e) { next(e); }
}

function requireAdmin(minRole = 'editor') {
  return (req, res, next) => {
    if (!req.admin) return res.redirect('/admin/login?next=' + encodeURIComponent(req.originalUrl));
    if (roleLevel(req.admin.role) < roleLevel(minRole)) {
      return res.status(403).render('admin/denied', { title: 'Access denied', layout: 'admin' });
    }
    next();
  };
}

function requireMember(req, res, next) {
  if (!req.member) return res.redirect('/member/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}

/** Write to the legacy audit_log table. */
async function audit(req, action, entityType, entityId, summary, extra = {}) {
  try {
    await db.query(
      `INSERT INTO audit_log (actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, old_values, new_values, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [req.admin ? 'admin' : req.member ? 'member' : 'system',
        extra.actorId ?? req.admin?.id ?? req.member?.id ?? null,
        extra.actorName ?? req.admin?.username ?? req.member?.name ?? null,
        action, entityType, entityId || null, String(summary || '').slice(0, 500),
        extra.old ? JSON.stringify(extra.old) : null, extra.new ? JSON.stringify(extra.new) : null,
        req.ip, String(req.get('user-agent') || '').slice(0, 255)]);
  } catch (e) { console.error('audit failed:', e.message); }
}

function safeNext(url, fallback) {
  return typeof url === 'string' && /^\/(?!\/)[^\s]*$/.test(url) ? url : fallback;
}

module.exports = {
  checkPassword, hashPassword, roleLevel, adminLogin, completeAdminLogin, recordFailure, tooManyAttempts, memberLogin, loadUsers, requireAdmin, requireMember, audit, safeNext, regenerate,
};
