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

/**
 * Brute-force throttle (legacy login_attempts table), keys are case-insensitive.
 * - 5 failures for the same account from the same IP   → blocked for that IP
 * - 20 failures from one IP (any account)              → IP blocked
 * - 30 failures for one account from all IPs           → account slowed (distributed guessing)
 * An attacker therefore cannot lock a victim out from a single IP.
 */
const WINDOW_MIN = 15, PER_PAIR = 5, PER_IP = 20, PER_ACCOUNT = 30;
const throttleKey = k => String(k || '').trim().toLowerCase().slice(0, 100);
async function tooManyAttempts(username, ip) {
  const r = await db.one(
    `SELECT count(*) FILTER (WHERE lower(username) = $1 AND ip_address = $2) AS pair,
            count(*) FILTER (WHERE ip_address = $2) AS by_ip,
            count(*) FILTER (WHERE lower(username) = $1) AS by_account
     FROM login_attempts WHERE attempted_at > now() - interval '${WINDOW_MIN} minutes' AND (lower(username) = $1 OR ip_address = $2)`,
    [throttleKey(username), ip]);
  return r.pair >= PER_PAIR || r.by_ip >= PER_IP || r.by_account >= PER_ACCOUNT;
}
async function recordFailure(username, ip) {
  await db.query('INSERT INTO login_attempts (username, ip_address, attempted_at) VALUES ($1, $2, now())', [throttleKey(username), ip]);
}
async function clearFailures(username, ip) {
  await db.query('DELETE FROM login_attempts WHERE lower(username) = $1 AND ip_address = $2', [throttleKey(username), ip]);
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
  await clearFailures(username, ip);
  await regenerate(req);
  req.session.tenantId = req.tenant.id;
  if (user.twofa_enabled && user.twofa_secret) {
    // password ok — second factor still required (bound to this tenant)
    req.session.pending2fa = { id: user.id, tenantId: req.tenant.id, at: Date.now() };
    return { user, needs2fa: true };
  }
  return completeAdminLogin(req, user);
}

async function completeAdminLogin(req, user) {
  delete req.session.pending2fa;
  req.session.adminId = user.id;
  req.session.adminVer = user.session_version || 1;
  await db.query('UPDATE admin_users SET last_login = now() WHERE id = $1', [user.id]);
  await audit(req, 'login', 'admin_users', user.id, `Admin login: ${user.username}`, { actorId: user.id, actorName: user.username });
  return { user };
}

async function memberLogin(req, identifier, password, t = np => np) {
  const ip = req.ip;
  const m = await db.one(
    `SELECT * FROM members WHERE deleted_at IS NULL AND (phone = $1 OR lower(email) = lower($1) OR upper(trim(sadasyata_number)) = upper($1) OR member_card_no = $1)
     ORDER BY id LIMIT 1`, [identifier]);
  // throttle on the resolved account, so phone / email / member no. share one counter
  const key = m ? 'member:' + m.id : 'm:' + identifier;
  if (await tooManyAttempts(key, ip)) return { error: t(`धेरै पटक गलत प्रयास भयो। ${WINDOW_MIN} मिनेटपछि फेरि प्रयास गर्नुहोस्।`, `Too many failed attempts. Try again in ${WINDOW_MIN} minutes.`) };
  const ok = m && (await checkPassword(password, m.password_hash));
  if (!ok) { await recordFailure(key, ip); return { error: t('सदस्य विवरण वा पासवर्ड मिलेन।', 'Member details or password did not match.') }; }
  // credentials were right: approval / rejection (with the office's reason) is told to the member
  const gate = require('./member-portal').eligibilityError(m, t);
  if (gate) { await clearFailures(key, ip); return { error: gate }; }
  await clearFailures(key, ip);
  return startMemberSession(req, m);
}

/** 'verify' when the member uses an authenticator, 'setup' when the cooperative requires one, else null. */
async function member2faMode(m) {
  if (Number(m.twofa_enabled) && m.twofa_secret) return 'verify';
  return (await require('./settings').get('member_2fa_required', '0')) === '1' ? 'setup' : null;
}

/** Password / OAuth succeeded: either sign in, or park the member at the second factor (bound to this tenant). */
async function startMemberSession(req, m) {
  const mode = await member2faMode(m);
  await regenerate(req);
  req.session.tenantId = req.tenant.id;
  if (mode) {
    req.session.memberPending2fa = { id: m.id, tenantId: req.tenant.id, at: Date.now(), mode, secret: mode === 'setup' ? require('./totp').generateSecret() : null };
    return { member: m, needs2fa: mode };
  }
  return completeMemberLogin(req, m);
}

async function completeMemberLogin(req, m) {
  delete req.session.memberPending2fa;
  req.session.tenantId = req.tenant.id;
  req.session.memberId = m.id;
  req.session.memberVer = m.session_version || 1;
  await db.query('UPDATE members SET last_login = now() WHERE id = $1', [m.id]);
  return { member: m };
}

/** Load the signed-in admin/member for this request (tenant-bound). */
async function loadUsers(req, res, next) {
  try {
    if (req.session.tenantId && req.session.tenantId !== req.tenant.id) {
      // session minted for another tenant: drop EVERYTHING it carried (identities, pending 2FA, setup secrets, flash…)
      for (const k of Object.keys(req.session)) if (k !== 'cookie') delete req.session[k];
      req.session.tenantId = req.tenant.id;
    }
    if (req.session.adminId) {
      req.admin = await db.one(`SELECT id, username, full_name, email, role, is_active, must_change_password, session_version, theme_pref FROM admin_users
                                WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL`, [req.session.adminId]);
      // credentials changed since this session signed in → session is no longer valid
      if (!req.admin || (req.admin.session_version || 1) !== (req.session.adminVer || 1)) { req.admin = null; delete req.session.adminId; }
    }
    if (req.session.memberId) {
      req.member = await db.one(`SELECT * FROM members WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL`, [req.session.memberId]);
      if (!req.member || (req.member.session_version || 1) !== (req.session.memberVer || 1)) { req.member = null; delete req.session.memberId; }
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

/** Same-site relative paths only ("/x"), never "//host", "/\\host" or anything a browser treats as absolute. */
function safeNext(url, fallback) {
  if (typeof url !== 'string' || !/^\/(?![/\\])[^\s\\]*$/.test(url)) return fallback;
  try { return new URL(url, 'http://x.invalid').origin === 'http://x.invalid' ? url : fallback; } catch { return fallback; }
}

/** Invalidate every other session of a user after a credential change. Pass req to keep the current one. */
async function bumpSessionVersion(table, id, req = null) {
  const r = await db.one(`UPDATE ${table === 'members' ? 'members' : 'admin_users'} SET session_version = COALESCE(session_version, 1) + 1 WHERE id = $1 RETURNING session_version`, [id]);
  if (req && r) { if (table === 'members') req.session.memberVer = r.session_version; else req.session.adminVer = r.session_version; }
}

/** Log out: destroy server-side state and issue a fresh session id. */
function logout(req) {
  return new Promise(resolve => req.session.regenerate(() => { req.session.tenantId = req.tenant?.id; resolve(); }));
}

module.exports = {
  checkPassword, hashPassword, roleLevel, adminLogin, completeAdminLogin, recordFailure, tooManyAttempts, clearFailures, bumpSessionVersion, logout, memberLogin, loadUsers,
  member2faMode, startMemberSession, completeMemberLogin, requireAdmin, requireMember, audit, safeNext, regenerate,
};
