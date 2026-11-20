'use strict';
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const settings = require('../lib/settings');
const navigation = require('../lib/navigation');
const forms = require('../lib/forms');
const modules = require('../modules/applications');
const { resources, GROUPS } = require('../modules/resources');
const { upload, remove } = require('../lib/uploads');
const { flash } = require('../lib/security');
const notify = require('../lib/notify');
const tenants = require('../lib/tenants');
const totp = require('../lib/totp');
const QRCode = require('qrcode');
const push = require('../lib/push');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const { requireAdmin } = auth;

router.use((req, res, next) => {
  res.locals.resources = resources;
  res.locals.GROUPS = GROUPS;
  res.locals.modules = req.admin && auth.roleLevel(req.admin.role) < auth.roleLevel('admin')
    ? Object.fromEntries(Object.entries(modules).filter(([, m]) => !m.adminOnly)) : modules;
  res.locals.roleLevel = auth.roleLevel;
  res.locals.iconNames = require('../lib/icons').names;
  res.locals.faToNode = require('../lib/icons').faToNode;
  next();
});

// ---------------------------------------------------------------- auth
router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { layout: 'auth', title: 'Admin login', error: null, username: '' });
});

router.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const { error, user, needs2fa, licenseBlocked } = await auth.adminLogin(req, username, String(req.body.password || ''));
  if (licenseBlocked) return res.redirect('/admin/license/blocked');
  if (error) return res.status(401).render('admin/login', { layout: 'auth', title: 'Admin login', error, username });
  if (needs2fa) return res.redirect('/admin/login/2fa' + (req.query.next ? '?next=' + encodeURIComponent(req.query.next) : ''));
  res.redirect(user.must_change_password ? '/admin/password' : auth.safeNext(req.query.next, '/admin'));
}));

// second factor (TOTP or backup code)
const usedSteps = new Map(); // "<schema>:<adminId>" -> last accepted TOTP step (replay protection)
function pending2fa(req) {
  const p = req.session.pending2fa;
  return p && p.tenantId === req.tenant.id && Date.now() - p.at < 5 * 60_000 ? p : null;
}
const render2fa = async (req, res, p, extra = {}) => {
  let qr = null;
  if (p.mode === 'setup') {
    const user = await db.one('SELECT username FROM admin_users WHERE id = $1', [p.id]);
    qr = await QRCode.toDataURL(totp.provisioningUri(res.locals.siteName || req.tenant.name, user ? user.username : 'admin', p.secret), { margin: 1, width: 220 });
  }
  res.status(extra.status || 200).render('admin/login-2fa', { layout: 'auth', title: '2FA', error: null, mode: p.mode, qr, secret: p.mode === 'setup' ? p.secret : null, codes: null, ...extra });
};
router.get('/login/2fa', ah(async (req, res) => {
  const p = pending2fa(req);
  if (!p) return res.redirect('/admin/login');
  if (p.mode === 'ack') return res.redirect('/admin/login'); // backup codes are shown once only
  await render2fa(req, res, p);
}));
router.post('/login/2fa', ah(async (req, res) => {
  const p = pending2fa(req);
  if (!p || p.mode === 'ack') return res.redirect('/admin/login');
  const setup = p.mode === 'setup';
  const user = await db.one("SELECT * FROM admin_users WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'", [p.id]);
  if (!user || (!setup && !user.twofa_enabled) || (setup && user.twofa_enabled) || require('../lib/license').loginBlocked(req.tenant, user)) { delete req.session.pending2fa; return res.redirect('/admin/login'); }
  const key = db.currentSchema() + ':' + user.id;
  if (await auth.tooManyAttempts('2fa:' + user.username, req.ip)) return render2fa(req, res, p, { status: 429, error: res.locals.t('धेरै गलत प्रयास। १५ मिनेटपछि प्रयास गर्नुहोस्।', 'Too many attempts. Try again in 15 minutes.') });
  const code = String(req.body.code || '').trim();
  let ok = false;
  const step = totp.verify(setup ? p.secret : user.twofa_secret, code);
  if (step !== null && step > (usedSteps.get(key) || 0)) { usedSteps.set(key, step); ok = true; }
  if (!ok && !setup && code.replace(/[^A-Za-z0-9]/g, '').length >= 8) {
    const remaining = await totp.consumeBackupCode(code, user.twofa_backup_codes);
    if (remaining) { await db.query('UPDATE admin_users SET twofa_backup_codes = $1 WHERE id = $2', [JSON.stringify(remaining), user.id]); ok = true; }
  }
  if (!ok) {
    await auth.recordFailure('2fa:' + user.username, req.ip);
    return render2fa(req, res, p, { status: 401, error: res.locals.t('कोड मिलेन।', 'Invalid code.') });
  }
  if (setup) {
    // forced enrolment (legacy admin/index.php setup → backup_ack): save, then show the backup codes once before signing in
    const { codes, hashes } = await totp.backupCodes();
    await db.query('UPDATE admin_users SET twofa_enabled = 1, twofa_secret = $1, twofa_backup_codes = $2, twofa_enabled_at = now(), session_version = COALESCE(session_version, 1) + 1 WHERE id = $3', [p.secret, JSON.stringify(hashes), user.id]);
    await auth.audit(req, '2fa_enable', 'admin_users', user.id, '2FA enrolled at login (policy)', { actorId: user.id, actorName: user.username });
    req.session.pending2fa = { id: user.id, tenantId: req.tenant.id, at: Date.now(), mode: 'ack' };
    return res.render('admin/login-2fa', { layout: 'auth', title: '2FA', error: null, mode: 'ack', qr: null, secret: null, codes });
  }
  await auth.completeAdminLogin(req, user);
  res.redirect(user.must_change_password ? '/admin/password' : auth.safeNext(req.query.next, '/admin'));
}));
// "I have saved my backup codes" → finish the sign-in that the forced enrolment started
router.post('/login/2fa/ack', ah(async (req, res) => {
  const p = pending2fa(req);
  if (!p || p.mode !== 'ack') return res.redirect('/admin/login');
  const user = await db.one("SELECT * FROM admin_users WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active' AND twofa_enabled = 1", [p.id]);
  if (!user || require('../lib/license').loginBlocked(req.tenant, user)) { delete req.session.pending2fa; return res.redirect('/admin/login'); }
  await auth.completeAdminLogin(req, user);
  res.redirect(user.must_change_password ? '/admin/password' : auth.safeNext(req.query.next, '/admin'));
}));

// ---------------------------------------------------------------- licence expired: renewal notice without a session
const licenseLimiter = require('express-rate-limit')({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => (req.tenant?.slug || '') + ':' + require('express-rate-limit').ipKeyGenerator(req.ip) });
const blockedStash = req => { const b = req.session.licenseBlocked; return b && b.tenantId === req.tenant.id && Date.now() - b.at < 30 * 60_000 ? b : null; };
router.get('/license/blocked', ah(async (req, res) => {
  const b = blockedStash(req);
  if (!b) return res.redirect('/admin/login');
  const st = require('../lib/license').status(req.tenant);
  const notices = await db.many("SELECT * FROM site_license_renewal_notices WHERE status = 'pending' ORDER BY id DESC LIMIT 5");
  res.render('admin/license-blocked', { layout: 'auth', title: res.locals.t('सेवा नवीकरण', 'Licence renewal'), st, pay: require('../lib/license').payInfo(), notices, username: b.username });
}));
router.post('/license/blocked', licenseLimiter, ah(async (req, res) => {
  const b = blockedStash(req);
  if (!b) return res.redirect('/admin/login');
  await submitLicenseNotice(req, res, { adminId: b.adminId, username: b.username });
  res.redirect('/admin/license/blocked');
}));

/** Store a renewal payment notice and tell the vendor (LICENSE_VENDOR_EMAIL). Returns false when invalid. */
async function submitLicenseNotice(req, res, who) {
  const b = req.body, t = res.locals.t;
  const txn = String(b.txn_reference || '').trim().slice(0, 120);
  if (!txn) { flash(req, 'error', t('कारोबार नम्बर चाहिन्छ।', 'Transaction reference is required.')); return false; }
  const gateway = ['esewa', 'khalti', 'bank', 'cash', 'other'].includes(b.gateway) ? b.gateway : 'other';
  const amount = String(b.amount || '').slice(0, 40), note = String(b.note || '').slice(0, 1000) || null;
  await db.query(`INSERT INTO site_license_renewal_notices (status, gateway, txn_reference, amount_reported, note, submitted_by_admin_id, submitted_by_username, created_at) VALUES ('pending', $1, $2, $3, $4, $5, $6, now())`,
    [gateway, txn, amount, note, who.adminId, who.username]);
  await auth.audit(req, 'license_notice', 'site_license_renewal_notices', null, `Renewal notice ${txn}`, { actorId: who.adminId, actorName: who.username });
  const vendor = require('../lib/license').payInfo().vendorEmail;
  if (vendor && util.isEmail(vendor)) {
    notify.later(() => notify.sendEmail('license_notice', vendor, `Licence renewal notice: ${req.tenant.name}`,
      `Cooperative: ${req.tenant.name} (${req.tenant.slug})\nBy: ${who.username}\nVia: ${gateway}\nReference: ${txn}\nAmount: ${amount}\nNote: ${note || ''}`));
  }
  flash(req, 'success', t('भुक्तानी सूचना पठाइयो। प्लेटफर्मले प्रमाणित गरेपछि म्याद थपिनेछ।', 'Payment notice sent. The licence is extended once the platform verifies it.'));
  return true;
}

router.post('/logout', ah(async (req, res) => {
  await auth.logout(req);
  res.redirect('/admin/login');
}));

router.use(requireAdmin('editor'));
router.use(require('../lib/legacy-admin-urls').adminRedirects); // PHP-era admin/<x>.php links (old SMS / emails / bookmarks)

// a temporary / reset password must be replaced before anything else
router.use((req, res, next) => {
  if (!req.admin.must_change_password || req.path === '/password' || req.path === '/logout') return next();
  if (req.method === 'GET') return res.redirect('/admin/password');
  return res.status(403).render('admin/denied', { title: 'Change password first' });
});

// 2FA policy on, but this admin signed in before enrolling: enrol first (legacy PHP forced it at every login)
router.use(ah(async (req, res, next) => {
  if (Number(req.admin.twofa_enabled) || ['/2fa', '/2fa/enable', '/logout', '/password'].includes(req.path) || !(await auth.admin2faRequired())) return next();
  if (req.method === 'GET') { flash(req, 'warn', res.locals.t('दुई-चरण प्रमाणीकरण अनिवार्य छ — पहिले सक्रिय गर्नुहोस्।', 'Two-step sign-in is required — turn it on first.')); return res.redirect('/admin/2fa'); }
  return res.status(403).render('admin/denied', { title: '2FA required' });
}));

// date fields: pick in B.S. (default, like the PHP admin) or plain A.D. (Settings → General)
router.use(ah(async (req, res, next) => { res.locals.bsDates = (await settings.get('admin_date_input', 'bs')) !== 'ad'; next(); }));

// custom roles (per-section matrix) + superadmin menu-group hiding
router.use(require('../lib/admin-perms').middleware);

// sidebar badge counts (pending items per inbox)
router.use(ah(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const counts = {};
  await Promise.all(Object.values(modules).map(async m => {
    const cols = await db.columns(m.table);
    const where = cols.has('status') && !m.noStatus ? "status = 'pending'" : cols.has('is_read') ? 'is_read = 0' : null;
    if (!where) return;
    counts[m.key] = await db.value(`SELECT count(*) FROM ${m.table} WHERE ${where}${cols.has('deleted_at') ? ' AND deleted_at IS NULL' : ''}`);
  }));
  res.locals.pendingCounts = counts;
  next();
}));
router.use(require('./admin-members').badges); // member portal queue count in the sidebar

// subscription plan: sections outside the tenant's plan show an upgrade page
router.use((req, res, next) => {
  const P = require('../lib/plans');
  const f = P.featureFor('/admin' + req.path);
  if (!f || res.locals.plan.has(f.key)) return next();
  res.status(403).render('admin/locked', { title: res.locals.t('यो सुविधा तपाईंको प्लानमा छैन', 'Not in your plan'), feature: f, need: P.info(f.plan) });
});

// ---------------------------------------------------------------- dashboard
router.get('/', ah(async (req, res) => {
  const recent = [];
  for (const m of Object.values(modules)) {
    const cols = await db.columns(m.table);
    const rows = await db.many(`SELECT * FROM ${m.table} ${cols.has('deleted_at') ? 'WHERE deleted_at IS NULL' : ''} ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 5`);
    rows.forEach(r => recent.push({ mod: m, row: r }));
  }
  recent.sort((a, b) => new Date(b.row.created_at) - new Date(a.row.created_at));
  const [members, pendingMembers, notices, news, visitors] = await Promise.all([
    db.value('SELECT count(*) FROM members WHERE deleted_at IS NULL'),
    db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND approval_status = 'pending'"),
    db.value('SELECT count(*) FROM notices WHERE deleted_at IS NULL AND is_active = 1'),
    db.value('SELECT count(*) FROM news WHERE deleted_at IS NULL AND is_active = 1'),
    db.many(`SELECT d::date AS day, COALESCE(v.page_views, 0) AS views FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, '1 day') d
             LEFT JOIN visitor_stats v ON v.visit_date = d::date ORDER BY d`),
  ]);
  const w = await dashboardWidgets(req, res);
  res.render('admin/dashboard', { title: res.locals.t('ड्यासबोर्ड', 'Dashboard'), recent: recent.slice(0, 12), stats: { members, pendingMembers, notices, news }, visitors, w,
    tab: ['office', 'members', 'welfare', 'programs', 'credentials'].includes(req.query.tab) ? req.query.tab : 'office' });
}));

/** Legacy dashboard.php widgets; each block only for admins who may open that section, and never fatal. */
async function dashboardWidgets(req, res) {
  const can = res.locals.can || (() => true);
  const ok = (section, path) => can(section) && (!res.locals.plan || res.locals.plan.allows(path)); // role matrix + subscription plan
  const lvl = auth.roleLevel(req.admin.role);
  const safe = async (fn, fallback = null) => { try { return await fn(); } catch { return fallback; } };
  const w = {};
  if (lvl >= 2 && ok('inbox:kyc', '/admin/inbox/kyc')) {
    w.kyc = await safe(() => db.one(`SELECT count(*) FILTER (WHERE status IN ('pending', 'incomplete')) AS pending,
      count(*) FILTER (WHERE status = 'approved' AND risk_review_status = 'due_review') AS due FROM kyc_applications WHERE deleted_at IS NULL`));
  }
  if (lvl >= 2 && ok('inbox:loan', '/admin/inbox/loan')) w.loans = await safe(() => db.value("SELECT count(*) FROM loan_applications WHERE status = 'pending' AND deleted_at IS NULL"));
  if (lvl >= 2 && ok('password_requests', '/admin/password-requests')) w.pwRequests = await safe(() => db.value("SELECT count(*) FROM member_password_reset_requests WHERE status = 'pending'"));
  if (lvl >= 2 && ok('members', '/admin/members')) w.pendingMembers = await safe(() => db.many("SELECT id, name, name_np, phone, created_at FROM members WHERE approval_status = 'pending' AND deleted_at IS NULL ORDER BY id DESC LIMIT 5"), []);
  if (lvl >= 2 && ok('programs', '/admin/programs')) {
    w.programs = await safe(async () => ({
      totals: await db.one('SELECT count(*) AS total, count(DISTINCT member_id) AS members FROM member_program_attendance'),
      pending: await db.value("SELECT count(*) FROM member_program_attendance_requests WHERE status = 'pending'"),
      recent: await db.many('SELECT a.program_title, a.member_card_no, a.attended_at, m.name, m.name_np FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id ORDER BY a.attended_at DESC NULLS LAST, a.id DESC LIMIT 10'),
      top: await db.many("SELECT COALESCE(program_title, '—') AS title, count(*) AS n FROM member_program_attendance GROUP BY 1 ORDER BY 2 DESC LIMIT 8"),
    }));
  }
  if (lvl >= 2 && ok('inbox:welfare', '/admin/inbox/welfare')) {
    w.welfare = await safe(async () => ({
      counts: await db.one("SELECT count(*) FILTER (WHERE status = 'pending') AS pending, count(*) FILTER (WHERE status = 'under_review') AS review, count(*) FILTER (WHERE status = 'approved') AS approved FROM member_welfare_claims"),
      byType: await db.many('SELECT claim_type, count(*) AS n, COALESCE(sum(claim_amount), 0) AS amount FROM member_welfare_claims GROUP BY 1 ORDER BY 2 DESC LIMIT 10'),
      recent: await db.many('SELECT id, claim_type, claim_amount, status, created_at FROM member_welfare_claims ORDER BY id DESC LIMIT 5'),
    }));
  }
  if (lvl >= 2 && ok('credentials', '/admin/credentials')) w.credentials = await safe(() => db.many('SELECT id, site_name, site_url, username, category FROM office_credentials WHERE is_active = 1 ORDER BY category, sort_order, site_name LIMIT 60'), []);
  if (lvl >= 3 && ok('audit', '/admin/audit')) w.activity = await safe(() => db.many("SELECT actor_name, action, summary, created_at FROM audit_log WHERE actor_type IN ('admin', 'superadmin') ORDER BY id DESC LIMIT 10"), []);
  return w;
}

// ---------------------------------------------------------------- generic content CRUD
async function resourceFields(r) {
  const cols = await db.columns(r.table);
  return r.fields.filter(f => cols.has(f.name));
}

async function refOptions(fields) {
  const out = {};
  for (const f of fields) {
    if (f.optionsFn) out[f.name] = await f.optionsFn();
    else if (f.options) out[f.name] = f.options;
    else if (f.ref) {
      const cols = await db.columns(f.ref.table);
      const label = cols.has(f.ref.label) ? f.ref.label : [...cols.keys()].find(c => /name|title/.test(c)) || 'id';
      const rows = await db.many(`SELECT id, ${db.ident(label)} AS label FROM ${db.ident(f.ref.table)} ORDER BY id DESC LIMIT 500`);
      out[f.name] = rows.map(r => [String(r.id), r.label || '#' + r.id, r.label || '#' + r.id]);
    }
  }
  return out;
}

/** Filter controls for a resource list: [{ name, label, options: [[value, np, en]] }] (columns that exist only). */
async function listFilters(r, cols, fields) {
  const out = [];
  for (const flt of r.filters || []) {
    if (!cols.has(flt.name)) continue;
    const f = fields.find(x => x.name === flt.name) || { name: flt.name, label: [flt.name, flt.name] };
    let options;
    if (flt.type === 'bool') options = [['1', 'हो', 'Yes'], ['0', 'होइन', 'No']];
    else if (flt.type === 'distinct') options = (await db.many(`SELECT DISTINCT ${db.ident(flt.name)}::text AS v FROM ${r.table} WHERE ${db.ident(flt.name)} IS NOT NULL AND ${db.ident(flt.name)}::text <> '' ORDER BY 1 DESC LIMIT 100`)).map(x => [x.v, x.v, x.v]);
    else options = (await refOptions([f]))[f.name] || [];
    out.push({ name: flt.name, label: f.label, options });
  }
  return out;
}

function getResource(req, res, next) {
  const r = Object.hasOwn(resources, req.params.resource) ? resources[req.params.resource] : null;
  if (!r) return next('route');
  if (r.minRole && auth.roleLevel(req.admin.role) < auth.roleLevel(r.minRole)) return res.status(403).render('admin/denied', { title: 'Access denied' });
  req.resource = r;
  next();
}

router.get('/r/:resource', getResource, ah(async (req, res) => {
  const r = req.resource;
  const fields = await resourceFields(r);
  const cols = await db.columns(r.table);
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (r.softDelete && cols.has('deleted_at')) where.push('deleted_at IS NULL');
  if (q) {
    const textCols = [...new Set([...fields.filter(f => ['text', 'textarea', 'richtext', 'url'].includes(f.type)).map(f => f.name).slice(0, 6), ...(r.searchExtra || []).filter(c => cols.has(c))])];
    if (textCols.length) { params.push('%' + q + '%'); where.push('(' + textCols.map(c => `${c}::text ILIKE $1`).join(' OR ') + ')'); }
  }
  // per-resource list filters (?f_<col>=…) and the Live / Archive tabs (?active=1|0)
  const filters = await listFilters(r, cols, fields);
  const fvals = {};
  for (const flt of filters) {
    const v = String(req.query['f_' + flt.name] ?? '').trim();
    if (v === '' || v.length > 100) continue;
    fvals[flt.name] = v;
    params.push(v); where.push(`${db.ident(flt.name)}::text = $${params.length}`);
  }
  const active = cols.has('is_active') && ['0', '1'].includes(String(req.query.active)) ? String(req.query.active) : '';
  const baseWhere = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const counts = cols.has('is_active') ? await db.one(`SELECT count(*) FILTER (WHERE is_active = 1) AS live, count(*) FILTER (WHERE COALESCE(is_active, 0) <> 1) AS archived FROM ${r.table} ${baseWhere}`, params) : null;
  if (active) where.push(active === '1' ? 'is_active = 1' : 'COALESCE(is_active, 0) <> 1');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = await db.value(`SELECT count(*) FROM ${r.table} ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 25);
  const rows = await db.many(`SELECT * FROM ${r.table} ${w} ORDER BY ${r.order || 'id DESC'} LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  const options = await refOptions(fields.filter(f => f.list && f.type === 'select'));
  res.render('admin/resource-list', { title: res.locals.t(...r.title), r, fields, listFields: fields.filter(f => f.list), rows, pg, q, options, hasActive: cols.has('is_active'), filters, fvals, active, counts });
}));

router.get('/r/:resource/new', getResource, ah(async (req, res) => {
  const fields = await resourceFields(req.resource);
  const values = Object.fromEntries(fields.filter(f => f.default !== undefined).map(f => [f.name, f.default]));
  res.render('admin/resource-form', { title: res.locals.t(...req.resource.title), r: req.resource, fields, values, errors: {}, options: await refOptions(fields), item: null });
}));

router.get('/r/:resource/:id/edit', getResource, ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM ${req.resource.table} WHERE id = $1`, [util.int(req.params.id)]);
  if (!item) return next();
  const fields = await resourceFields(req.resource);
  res.render('admin/resource-form', { title: res.locals.t(...req.resource.title), r: req.resource, fields, values: item, errors: {}, options: await refOptions(fields), item });
}));

function readResourceForm(fields, body, uploaded, existing) {
  const data = {}, errors = {};
  for (const f of fields) {
    if (f.type === 'readonly') continue;
    if (f.readonlyOnEdit && existing) continue; // e.g. a type code that requests already reference
    if (f.type === 'images') {
      // gallery JSON (legacy auctions.php): keep stored photos minus the ticked ones, add the new uploads
      let list = [];
      try { list = JSON.parse((existing && existing[f.name]) || '[]'); } catch { list = []; }
      if (!Array.isArray(list)) list = [];
      list = list.filter(x => typeof x === 'string');
      const drop = new Set([].concat(body['remove_' + f.name] || []).map(String).filter(x => list.includes(x))); // only this record's own photos
      list = list.filter(x => !drop.has(x)).concat([].concat((uploaded && uploaded[f.name]) || []));
      data[f.name] = JSON.stringify(list.slice(0, f.max || 10));
      data['_removed_' + f.name] = [...drop];
      continue;
    }
    if (f.type === 'icon') {
      const v = String(body[f.name] || '').trim();
      data[f.name] = /^[a-z0-9 -]{1,80}$/i.test(v) ? v : (f.default ?? null);
      continue;
    }
    if (f.type === 'image' || f.type === 'file') {
      if (uploaded && uploaded[f.name]) data[f.name] = uploaded[f.name];
      else if (body['remove_' + f.name] === '1') data[f.name] = null;
      else if (f.required && !(existing && existing[f.name])) errors[f.name] = 'आवश्यक छ / required';
      continue;
    }
    if (f.type === 'bool') { data[f.name] = body[f.name] ? 1 : 0; continue; }
    let v = body[f.name];
    v = typeof v === 'string' ? v.trim() : '';
    if (v === '') {
      if (f.required) errors[f.name] = 'आवश्यक छ / required';
      else data[f.name] = f.default !== undefined ? f.default : null;
      continue;
    }
    if (f.type === 'number') {
      const n = Number(nd.toLatinDigits(v).replace(/,/g, ''));
      if (!Number.isFinite(n)) { errors[f.name] = 'अंक चाहिन्छ / number'; continue; }
      v = n;
    } else if (f.type === 'date') {
      v = nd.toLatinDigits(v);
      if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(v)) { errors[f.name] = 'YYYY-MM-DD'; continue; }
      if (Number(v.slice(0, 4)) >= 2050) { // a B.S. date typed directly (legacy coop-date-ui.php) → A.D.
        const ad = nd.bsToAd(v);
        if (!ad) { errors[f.name] = 'वि.सं. मिति मिलेन / invalid B.S. date'; continue; }
        v = ad;
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors[f.name] = 'YYYY-MM-DD'; continue; }
    } else if (f.type === 'url') {
      if (!/^(https?:\/\/|\/)/i.test(v)) { errors[f.name] = 'URL https:// बाट सुरु हुनुपर्छ'; continue; }
    } else if (f.type === 'richtext') {
      v = util.sanitizeHtml(v);
    } else if (f.name === 'slug') {
      v = util.slugify(v);
    }
    data[f.name] = v;
  }
  return { data, errors };
}

function resourceUpload(req, res, next) {
  const fileFields = req.resource.fileFields;
  if (!fileFields.length || !req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload(req.resource.key.replace(/_/g, '-'), fileFields.map(f => ({ name: f.name, kind: f.kind || (f.type === 'file' ? 'any' : 'image'), maxCount: f.type === 'images' ? (f.max || 10) : 1 })), { maxMb: 20, private: !!req.resource.privateFiles });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}

async function saveResource(req, res, existing) {
  const r = req.resource;
  const fields = await resourceFields(r);
  const { data, errors } = readResourceForm(fields, req.body, req.uploaded, existing);
  if (req.uploadError) errors._upload = req.uploadError;
  // per-resource rules (defaults, cross-field checks); may fill data and report field errors
  if (r.beforeSave && !Object.keys(errors).length) Object.assign(errors, await r.beforeSave(data, { db, body: req.body, existing }) || {});
  // keep legacy single-language columns in sync so old PHP-era queries still find text
  const cols = await db.columns(r.table);
  for (const base of ['title', 'name', 'content', 'description']) {
    if (cols.has(base) && !data[base] && !(existing && existing[base] && data[base] === undefined)) {
      const fallback = data[base + '_np'] || data[base + '_en'];
      if (fallback) data[base] = fallback;
    }
  }
  if (Object.keys(errors).length) {
    return res.status(422).render('admin/resource-form', { title: res.locals.t(...r.title), r, fields, values: { ...existing, ...req.body }, errors, options: await refOptions(fields), item: existing });
  }
  try {
    const removedImages = Object.keys(data).filter(k => k.startsWith('_removed_')).flatMap(k => { const v = data[k]; delete data[k]; return v; });
    const clean = await db.pick(r.table, data);
    const row = existing ? await db.update(r.table, existing.id, clean) : await db.insert(r.table, clean);
    if (existing) for (const f of r.fileFields) if (f.type !== 'images' && clean[f.name] !== undefined && existing[f.name] && existing[f.name] !== clean[f.name]) remove(req, existing[f.name]);
    for (const x of removedImages) remove(req, x);
    if (r.afterSave) await r.afterSave(row, req);
    await auth.audit(req, existing ? 'update' : 'create', r.table, row.id, `${r.title[1]} #${row.id}`);
    settings.invalidate(); navigation.invalidate();
    flash(req, 'success', res.locals.t('सुरक्षित गरियो।', 'Saved.'));
    res.redirect(`/admin/r/${r.key}`);
  } catch (e) {
    if (e.code === '23505') { // unique violation
      return res.status(422).render('admin/resource-form', { title: res.locals.t(...r.title), r, fields, values: { ...existing, ...req.body }, errors: { _upload: res.locals.t('यो मान पहिले नै प्रयोग भइसकेको छ।', 'That value is already in use.') }, options: await refOptions(fields), item: existing });
    }
    throw e;
  }
}

router.post('/r/:resource', getResource, resourceUpload, ah((req, res) => saveResource(req, res, null)));
// bulk status actions on list pages (resources with bulk: true)
router.post('/r/:resource/bulk', getResource, ah(async (req, res) => {
  const r = req.resource;
  const ids = [].concat(req.body.ids || []).map(x => util.int(x)).filter(x => x > 0).slice(0, 500);
  const action = String(req.body.action || '');
  const cols = await db.columns(r.table);
  if (!r.bulk || !ids.length || !['activate', 'deactivate', 'delete'].includes(action)) {
    flash(req, 'error', res.locals.t('कुनै रेकर्ड वा कार्य छानिएन।', 'Select records and an action.'));
    return res.redirect(`/admin/r/${r.key}`);
  }
  if (action === 'delete' && (r.beforeDelete || r.afterDelete)) {
    // guarded resources: each row goes through the same rules as a single delete
    const tally = { deleted: 0, deactivated: 0, blocked: 0 };
    for (const id of ids) tally[(await guardedDelete(req, r, id, cols)).outcome]++;
    if (tally.deactivated || tally.blocked) flash(req, 'warn', res.locals.t(`${tally.deactivated} निष्क्रिय, ${tally.blocked} रोकियो (प्रयोगमा छन्)।`, `${tally.deactivated} deactivated and ${tally.blocked} kept because they are in use.`));
  } else if (action === 'delete') {
    if (r.softDelete && cols.has('deleted_at')) await db.query(`UPDATE ${r.table} SET deleted_at = now() WHERE id = ANY($1::int[])`, [ids]);
    else for (const row of await db.many(`DELETE FROM ${r.table} WHERE id = ANY($1::int[]) RETURNING *`, [ids])) removeRowFiles(req, r, row);
  } else if (cols.has('is_active')) {
    await db.query(`UPDATE ${r.table} SET is_active = $1 WHERE id = ANY($2::int[])`, [action === 'activate' ? 1 : 0, ids]);
  }
  await auth.audit(req, 'bulk_' + action, r.table, null, `${r.title[1]}: ${action} ${ids.length} (#${ids.join(', #')})`);
  navigation.invalidate();
  flash(req, 'success', res.locals.t(`${ids.length} रेकर्डमा कार्य सम्पन्न भयो।`, `Done for ${ids.length} records.`));
  res.redirect(`/admin/r/${r.key}`);
}));
router.post('/r/:resource/:id', getResource, resourceUpload, ah(async (req, res, next) => {
  const existing = await db.one(`SELECT * FROM ${req.resource.table} WHERE id = $1`, [util.int(req.params.id)]);
  if (!existing) return next();
  await saveResource(req, res, existing);
}));

router.post('/r/:resource/:id/toggle', getResource, ah(async (req, res) => {
  await db.query(`UPDATE ${req.resource.table} SET is_active = 1 - COALESCE(is_active, 0) WHERE id = $1`, [util.int(req.params.id)]);
  navigation.invalidate();
  let back = `/admin/r/${req.resource.key}`;
  try { const u = new URL(req.get('referer') || '', 'http://x'); if (u.pathname.startsWith('/admin/r/')) back = u.pathname + u.search; } catch { /* keep default */ }
  res.redirect(back);
}));

function removeRowFiles(req, r, row) {
  for (const f of r.fileFields) {
    if (f.type !== 'images') { remove(req, row[f.name]); continue; }
    try { for (const x of JSON.parse(row[f.name] || '[]')) if (typeof x === 'string') remove(req, x); } catch { /* not JSON */ }
  }
}

/**
 * Delete one resource row through its rules. beforeDelete(id, {db}) may return [np, en] (block) or
 * { deactivate: true, message: [np, en] } (data references the row: set is_active = 0 instead, like the PHP app).
 * afterDelete(id, {db}) removes dependent rows in the same transaction as the delete.
 */
async function guardedDelete(req, r, id, cols) {
  const verdict = r.beforeDelete ? await r.beforeDelete(id, { db }) : null;
  if (verdict && verdict.deactivate && cols.has('is_active')) {
    await db.query(`UPDATE ${r.table} SET is_active = 0 WHERE id = $1`, [id]);
    await auth.audit(req, 'deactivate', r.table, id, `${r.title[1]} #${id} (in use, not deleted)`);
    return { outcome: 'deactivated', message: verdict.message };
  }
  if (verdict) return { outcome: 'blocked', message: Array.isArray(verdict) ? verdict : verdict.message };
  let row = null;
  await db.transaction(async () => {
    if (r.softDelete && cols.has('deleted_at')) return db.query(`UPDATE ${r.table} SET deleted_at = now() WHERE id = $1`, [id]);
    if (r.afterDelete) await r.afterDelete(id, { db });
    row = await db.one(`DELETE FROM ${r.table} WHERE id = $1 RETURNING *`, [id]);
  });
  if (row) removeRowFiles(req, r, row);
  await auth.audit(req, 'delete', r.table, id, `${r.title[1]} #${id}`);
  return { outcome: 'deleted' };
}

router.post('/r/:resource/:id/delete', getResource, ah(async (req, res) => {
  const r = req.resource;
  const { outcome, message } = await guardedDelete(req, r, util.int(req.params.id), await db.columns(r.table));
  navigation.invalidate();
  if (outcome === 'blocked') flash(req, 'error', res.locals.t(...message));
  else if (outcome === 'deactivated') flash(req, 'warn', res.locals.t(...(message || ['प्रयोगमा भएकाले निष्क्रिय गरियो।', 'In use, so it was deactivated instead of deleted.'])));
  else flash(req, 'success', res.locals.t('हटाइयो।', 'Deleted.'));
  res.redirect(`/admin/r/${r.key}`);
}));

// ---------------------------------------------------------------- application inboxes, KYM tools, private files
router.use(require('./admin-applications'));

router.use('/programs', require('./admin-programs'));
router.use('/elections', require('./admin-elections'));
router.use('/partners', require('./admin-partners'));
router.use('/institutional-welfare', require('./admin-welfare'));
router.use('/marketplace', require('./marketplace').admin);
router.use('/credentials', require('./admin-credentials'));
router.use('/integrations', require('./admin-integrations'));
router.use('/', require('./sector').admin);

// own website domains (CNAME to the generated target)
router.get('/domains', requireAdmin('superadmin'), ah(async (req, res) => {
  const t = await db.one('SELECT * FROM platform.tenants WHERE id = $1', [req.tenant.id]);
  res.render('admin/domains', { title: res.locals.t('वेबसाइट डोमेन', 'Website domain'), tn: t, rows: await tenants.domainsOf(req.tenant.id), dnsHelp: require('../lib/domains').instructions });
}));
router.post('/domains', requireAdmin('superadmin'), ah(async (req, res) => {
  try {
    flash(req, 'success', await require('./platform').domainAction(req.tenant.id, req.body));
    await auth.audit(req, 'domain_' + req.body.action, 'tenant_domains', null, String(req.body.domain || req.body.domain_id || ''));
  } catch (e) { flash(req, 'error', e.code === '23505' ? res.locals.t('यो डोमेन अर्को सहकारीमा प्रयोग भइसकेको छ।', 'That domain is already used by another cooperative.') : e.message); }
  res.redirect('/admin/domains');
}));
router.use('/', require('./admin-system'));
router.use('/', require('./admin-tools'));

// ---------------------------------------------------------------- members, member portal queue, password requests
router.use(require('./admin-members'));

// ---------------------------------------------------------------- settings (driven by the registry in lib/setting-defs.js)
const SD = require('../lib/setting-defs');
async function settingsPage(req, res, { tab, errors = {}, posted = null, status = 200 } = {}) {
  const isSuper = auth.roleLevel(req.admin.role) >= 4;
  tab = Object.hasOwn(SD.TABS, tab) || (tab === 'other' && isSuper) ? tab : 'general';
  const values = { ...(await settings.all()), ...(posted || {}) };
  const other = isSuper ? (await settings.grouped()).filter(r => !SD.byKey[r.setting_key] && !SD.MANAGED_GROUPS.has(r.setting_group) && !SD.MANAGED_KEY.test(r.setting_key)) : [];
  res.status(status).render('admin/settings', {
    title: res.locals.t('सेटिङ', 'Settings'), tabs: SD.TABS, tab, defs: SD.DEFS.filter(d => d.group === tab), values, errors, other, isSuper, aiModels: SD.AI_MODELS,
    eventToggles: tab === 'notify' ? Object.values(modules).map(m => ({ key: m.key, title: m.title })) : [],
    oauthRedirect: `${req.protocol}://${req.get('host')}/member/oauth/google/callback`, facebookRedirect: `${req.protocol}://${req.get('host')}/member/oauth/facebook/callback`,
  });
}
router.get('/settings', requireAdmin('admin'), ah((req, res) => settingsPage(req, res, { tab: String(req.query.tab || 'general') })));

router.post('/settings', requireAdmin('admin'), (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload('settings', SD.DEFS.filter(d => d.type === 'image').map(d => ({ name: 'file_' + d.key, kind: 'image' })));
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}, ah(async (req, res) => {
  const t = res.locals.t;
  const tab = String(req.body._tab || 'general');
  if (req.uploadError) {
    for (const p of Object.values(req.uploaded || {})) remove(req, p);
    flash(req, 'error', t('फाइल अपलोड भएन: ', 'Upload failed: ') + req.uploadError + t(' — केही सुरक्षित गरिएन।', ' — nothing was saved.'));
    return res.redirect('/admin/settings?tab=' + encodeURIComponent(tab));
  }
  const defs = SD.DEFS.filter(d => d.group === tab);
  const current = await settings.all();
  const errors = {}, changes = [];
  for (const def of defs) {
    const meta = { type: SD.storeType(def.type), group: def.group, label: def.label[1], sync: true };
    if (def.type === 'image') {
      const up = req.uploaded && req.uploaded['file_' + def.key];
      if (up) changes.push([def.key, up, meta, current[def.key]]);
      else if (req.body['remove_' + def.key] === '1' && current[def.key]) changes.push([def.key, '', meta, current[def.key]]);
      continue;
    }
    if (def.type === 'secret' && req.body['clear_' + def.key] === '1') { changes.push([def.key, '', meta]); continue; }
    if (def.type !== 'bool' && req.body['s_' + def.key] === undefined) continue; // not on the form (e.g. a role cannot see it)
    const raw = req.body['s_' + def.key];
    const r = SD.clean(def, Array.isArray(raw) ? raw[raw.length - 1] : raw, util);
    if (r.error) errors[def.key] = r.error;
    else if (!r.skip && r.value !== (current[def.key] ?? '')) changes.push([def.key, r.value, meta]);
  }
  if (Object.keys(errors).length) {
    for (const p of Object.values(req.uploaded || {})) remove(req, p);
    const posted = Object.fromEntries(defs.filter(d => d.type !== 'secret' && d.type !== 'image').map(d => [d.key, String(req.body['s_' + d.key] ?? '')]));
    return settingsPage(req, res, { tab, errors, posted, status: 422 });
  }
  // per-module notification toggles (notify_email_<module> / notify_sms_<module>, '1' when absent)
  if (tab === 'notify' && req.body._event_toggles === '1') {
    for (const m of Object.values(modules)) for (const ch of ['email', 'sms']) {
      const k = `notify_${ch}_${m.key}`, v = req.body[k] === '1' ? '1' : '0';
      if ((current[k] ?? '1') !== v) changes.push([k, v, { type: 'text', group: 'notify', label: `${ch === 'email' ? 'Email' : 'SMS'} office on new ${m.title[1]}` }]);
    }
  }
  for (const [key, val, meta, old] of changes) {
    await settings.set(key, val, meta);
    if (old && old !== val && SD.byKey[key]?.type === 'image') remove(req, old);
  }
  await auth.audit(req, 'update', 'site_settings', null, `Settings (${tab}): ${changes.map(c => c[0]).join(', ').slice(0, 400) || 'no changes'}`);
  flash(req, 'success', t('सेटिङ सुरक्षित भयो।', 'Settings saved.'));
  res.redirect('/admin/settings?tab=' + encodeURIComponent(tab));
}));

// ---------------------------------------------------------------- theme (admin + superadmin choose the default)
const themes = require('../lib/themes');
router.get('/theme', requireAdmin('admin'), ah(async (req, res) => {
  const pol = themes.policy(await settings.all());
  const counts = {
    members: Number(await db.value('SELECT count(*) FROM members WHERE theme_pref IS NOT NULL AND deleted_at IS NULL')) || 0,
    admins: Number(await db.value('SELECT count(*) FROM admin_users WHERE theme_pref IS NOT NULL AND deleted_at IS NULL')) || 0,
  };
  const s = await settings.all();
  res.render('admin/theme', { title: res.locals.t('रूप / थिम', 'Theme'), pol, swatches: themes.swatches(pol.orgColor), modes: themes.MODES, counts,
    L: require('../lib/layouts'), lay: require('../lib/layouts').resolve(s), langDefault: s.lang_default === 'en' ? 'en' : 'np', langEnabled: s.lang_enabled || 'both',
    designs: require('../lib/starter').list(), currentDesign: s.starter_design || '' });
}));
// one-click: apply a complete starter design (look + layout; optionally fill empty sections with starter content)
router.post('/theme/design', requireAdmin('admin'), ah(async (req, res) => {
  const starter = require('../lib/starter');
  if (!starter.DESIGNS[req.body.design]) { flash(req, 'error', 'Unknown design'); return res.redirect('/admin/theme'); }
  await starter.apply(req.body.design, { content: req.body.content === '1' });
  await auth.audit(req, 'update', 'site_settings', null, 'Applied design ' + req.body.design);
  flash(req, 'success', res.locals.t('डिजाइन लागू भयो।', 'Design applied.'));
  res.redirect('/admin/theme');
}));
router.post('/theme', requireAdmin('admin'), ah(async (req, res) => {
  const b = req.body, s = await settings.all();
  const meta = { group: 'appearance' };
  if (/^#[0-9a-f]{6}$/i.test(b.primary_color || '')) await settings.set('primary_color', b.primary_color, { type: 'color', label: 'Brand colour', group: 'theme' });
  if (themes.isPalette(b.palette)) await settings.set('theme_default_palette', b.palette, { ...meta, label: 'Default theme palette' });
  if (themes.isMode(b.mode)) await settings.set('theme_default_mode', b.mode, { ...meta, label: 'Default theme mode' });
  await settings.set('theme_user_choice', b.allow_user === '1' ? '1' : '0', { ...meta, label: 'Users may change the theme' });
  const L = require('../lib/layouts');
  if (b.layout_header) await settings.set('layout_header', L.valid(L.HEADERS, b.layout_header, 'classic'), { ...meta, label: 'Menu placement' });
  if (b.layout_home) await settings.set('layout_home', L.valid(L.HOMES, b.layout_home, 'split'), { ...meta, label: 'Home page style' });
  if (b.layout_corners) await settings.set('layout_corners', L.valid(L.CORNERS, b.layout_corners, 'rounded'), { ...meta, label: 'Corner style' });
  if (b.lang_enabled) await settings.set('lang_enabled', L.valid(L.LANGS, b.lang_enabled, 'both'), { ...meta, label: 'Languages offered' });
  if (b.lang_default) await settings.set('lang_default', b.lang_default === 'en' ? 'en' : 'np', { ...meta, label: 'Default language' });
  if (b.reset_all === '1') {
    await settings.set('theme_epoch', String((Number(s.theme_epoch) || 0) + 1), { ...meta, label: 'Theme reset counter' });
    await db.query('UPDATE members SET theme_pref = NULL WHERE theme_pref IS NOT NULL');
    await db.query('UPDATE admin_users SET theme_pref = NULL WHERE theme_pref IS NOT NULL');
  }
  await auth.audit(req, 'update', 'site_settings', null, `Theme default ${b.palette}/${b.mode}${b.reset_all === '1' ? ' (reset all)' : ''}`);
  flash(req, 'success', res.locals.t('रूप सुरक्षित भयो।', 'Theme saved.'));
  res.redirect('/admin/theme');
}));

// ---------------------------------------------------------------- subscription plan (read-only for the tenant)
router.get('/plan', ah(async (req, res) => {
  const P = require('../lib/plans');
  res.render('admin/plan', { title: res.locals.t('सेवा प्लान', 'Service plan'), PLANS: P.PLANS, FEATURES: P.FEATURES, RANK: P.RANK,
    staffCount: Number(await db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL AND is_active = 1')) || 0 });
}));

// ---------------------------------------------------------------- admin users (admin+; legacy manage-admins.php)
// An admin manages admin / staff / editor accounts; only a superadmin creates or touches superadmins, or resets 2FA.
const ALL_ROLES = ['superadmin', 'admin', 'staff', 'editor'];
const isSuperAdmin = req => auth.roleLevel(req.admin.role) >= 4;
const grantableRoles = req => (isSuperAdmin(req) ? ALL_ROLES : ALL_ROLES.slice(1));
async function usersPage(req, res, { errors = {}, values = { role: 'staff' }, status = 200 } = {}) {
  const rows = await db.many('SELECT id, username, full_name, email, role, is_active, last_login, created_at, twofa_enabled, custom_role_id FROM admin_users WHERE deleted_at IS NULL ORDER BY id');
  const customRoles = await db.many('SELECT id, name FROM admin_roles ORDER BY name');
  res.status(status).render('admin/users', { title: res.locals.t('प्रशासक प्रयोगकर्ता', 'Admin users'), rows, customRoles, errors, values, roles: grantableRoles(req), isSuper: isSuperAdmin(req) });
}
router.get('/users', requireAdmin('admin'), ah((req, res) => usersPage(req, res)));

router.post('/users', requireAdmin('admin'), ah(async (req, res) => {
  const b = req.body, errors = {};
  const maxStaff = res.locals.plan.info.staff;
  if (Number(await db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL AND is_active = 1')) >= maxStaff) {
    flash(req, 'error', res.locals.t(`तपाईंको प्लानमा बढीमा ${maxStaff} कर्मचारी प्रयोगकर्ता मात्र राख्न मिल्छ।`, `Your plan allows up to ${maxStaff} staff users.`));
    return res.redirect('/admin/users');
  }
  const username = String(b.username || '').trim().toLowerCase();
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,50}$/.test(username)) errors.username = '3–50: a-z 0-9 _ . -';
  if (String(b.password || '').length < 10) errors.password = 'min 10 characters';
  if (!grantableRoles(req).includes(b.role)) errors.role = 'role';
  if (email && (!util.isEmail(email) || email.length > 100)) errors.email = res.locals.t('इमेल मिलेन', 'Invalid email');
  if (!Object.keys(errors).length && await db.value('SELECT 1 FROM admin_users WHERE lower(username) = $1', [username])) errors.username = res.locals.t('यो नाम पहिले नै छ', 'Username taken');
  if (Object.keys(errors).length) return usersPage(req, res, { errors, values: b, status: 422 });
  const roleId = b.role !== 'superadmin' ? util.int(b.custom_role_id, 0) : 0;
  const customRole = roleId ? await db.value('SELECT id FROM admin_roles WHERE id = $1', [roleId]) : null;
  const row = await db.insert('admin_users', { username, password: await auth.hashPassword(b.password), full_name: String(b.full_name || username).trim().slice(0, 100), email: email || null, role: b.role, custom_role_id: customRole || null, is_active: 1, status: 'active', must_change_password: 1, created_by: req.admin.id });
  await auth.audit(req, 'create', 'admin_users', row.id, `Admin user ${username} (${b.role})`);
  flash(req, 'success', res.locals.t('प्रयोगकर्ता थपियो।', 'User added.'));
  res.redirect('/admin/users');
}));

router.post('/users/:id', requireAdmin('admin'), ah(async (req, res) => {
  const t = res.locals.t;
  const id = util.int(req.params.id);
  const action = String(req.body.action || '');
  const target = await db.one('SELECT id, role FROM admin_users WHERE id = $1 AND deleted_at IS NULL', [id]);
  if (!target) return res.redirect('/admin/users');
  const deny = msg => { flash(req, 'error', msg); return res.redirect('/admin/users'); };
  if (id === req.admin.id && ['disable', 'delete', 'role'].includes(action)) return deny(t('आफ्नै खाताको भूमिका बदल्न वा निष्क्रिय गर्न मिल्दैन।', 'You cannot change the role of, or disable, your own account.'));
  if (!isSuperAdmin(req) && (auth.roleLevel(target.role) >= 4 || action === 'reset2fa')) return deny(t('सुपर प्रशासकले मात्र यो गर्न सक्छन्।', 'Only a superadmin can do this.'));
  if (action === 'role') {
    if (!grantableRoles(req).includes(req.body.role)) return deny(t('यो भूमिका दिन मिल्दैन।', 'You cannot grant that role.'));
    await db.query('UPDATE admin_users SET role = $1 WHERE id = $2', [req.body.role, id]);
  }
  if (action === 'edit') {
    const fullName = String(req.body.full_name || '').trim().slice(0, 100), email = String(req.body.email || '').trim().toLowerCase();
    if (!fullName) return deny(t('पूरा नाम चाहिन्छ।', 'Full name is required.'));
    if (email && (!util.isEmail(email) || email.length > 100)) return deny(t('इमेल मिलेन।', 'Invalid email.'));
    await db.query('UPDATE admin_users SET full_name = $1, email = $2 WHERE id = $3', [fullName, email || null, id]);
  }
  if (action === 'custom_role') {
    const rid = util.int(req.body.custom_role_id, 0);
    await db.query('UPDATE admin_users SET custom_role_id = $1 WHERE id = $2', [rid && (await db.value('SELECT id FROM admin_roles WHERE id = $1', [rid])) ? rid : null, id]);
  }
  if (action === 'disable') await db.query("UPDATE admin_users SET is_active = 0, status = 'disabled' WHERE id = $1", [id]);
  if (action === 'enable') await db.query("UPDATE admin_users SET is_active = 1, status = 'active' WHERE id = $1", [id]);
  if (action === 'delete') await db.query('UPDATE admin_users SET deleted_at = now(), is_active = 0 WHERE id = $1', [id]);
  if (action === 'reset2fa') await db.query('UPDATE admin_users SET twofa_enabled = 0, twofa_secret = NULL, twofa_backup_codes = NULL WHERE id = $1', [id]);
  if (['role', 'disable', 'delete', 'reset2fa', 'reset', 'custom_role'].includes(action)) await auth.bumpSessionVersion('admin_users', id, id === req.admin.id ? req : null);
  if (action === 'reset') {
    const temp = crypto.randomBytes(8).toString('base64url');
    await db.query('UPDATE admin_users SET password = $1, must_change_password = 1 WHERE id = $2', [await auth.hashPassword(temp), id]);
    flash(req, 'info', t('अस्थायी पासवर्ड: ', 'Temporary password: ') + temp);
  }
  await auth.audit(req, 'user_' + action.slice(0, 20), 'admin_users', id, `Admin user ${action}`);
  res.redirect('/admin/users');
}));

// ---------------------------------------------------------------- own profile (legacy profile.php)
router.get('/profile', (req, res) => res.render('admin/profile', { title: res.locals.t('मेरो प्रोफाइल', 'My profile'), errors: {}, values: req.admin }));
router.post('/profile', ah(async (req, res) => {
  const t = res.locals.t;
  const values = { full_name: String(req.body.full_name || '').trim(), email: String(req.body.email || '').trim().toLowerCase() };
  const errors = {};
  if (!values.full_name || values.full_name.length > 100) errors.full_name = t('१–१०० अक्षर', '1–100 characters');
  if (values.email && (!util.isEmail(values.email) || values.email.length > 100)) errors.email = t('इमेल मिलेन', 'Invalid email');
  if (Object.keys(errors).length) return res.status(422).render('admin/profile', { title: t('मेरो प्रोफाइल', 'My profile'), errors, values: { ...req.admin, ...values } });
  await db.query('UPDATE admin_users SET full_name = $1, email = $2 WHERE id = $3', [values.full_name, values.email || null, req.admin.id]);
  await auth.audit(req, 'profile_update', 'admin_users', req.admin.id, 'Own profile updated', { old: { full_name: req.admin.full_name, email: req.admin.email }, new: values });
  flash(req, 'success', t('प्रोफाइल सुरक्षित भयो।', 'Profile saved.'));
  res.redirect('/admin/profile');
}));

// ---------------------------------------------------------------- own password
router.get('/password', (req, res) => res.render('admin/password', { title: res.locals.t('पासवर्ड परिवर्तन', 'Change password'), errors: {} }));
router.post('/password', ah(async (req, res) => {
  const user = await db.one('SELECT * FROM admin_users WHERE id = $1', [req.admin.id]);
  const errors = {};
  if (!(await auth.checkPassword(req.body.current, user.password))) errors.current = res.locals.t('हालको पासवर्ड मिलेन', 'Current password is wrong');
  const pw = String(req.body.password || '');
  if (pw.length < 10) errors.password = res.locals.t('कम्तीमा १० अक्षर', 'At least 10 characters');
  else if (pw !== req.body.confirm) errors.confirm = res.locals.t('पासवर्ड मिलेन', 'Passwords do not match');
  if (Object.keys(errors).length) return res.status(422).render('admin/password', { title: res.locals.t('पासवर्ड परिवर्तन', 'Change password'), errors });
  if (await auth.checkPassword(pw, user.password)) return res.status(422).render('admin/password', { title: res.locals.t('पासवर्ड परिवर्तन', 'Change password'), errors: { password: res.locals.t('नयाँ पासवर्ड पुरानो जस्तै हुन मिल्दैन', 'Choose a different password') } });
  await db.query('UPDATE admin_users SET password = $1, must_change_password = 0, last_password_change = now() WHERE id = $2', [await auth.hashPassword(pw), user.id]);
  await auth.bumpSessionVersion('admin_users', user.id, req); // other sessions are signed out
  await auth.audit(req, 'password', 'admin_users', user.id, 'Password changed');
  flash(req, 'success', res.locals.t('पासवर्ड परिवर्तन भयो।', 'Password changed.'));
  res.redirect('/admin');
}));

// ---------------------------------------------------------------- notifications log / test / push broadcast
router.get('/notifications', requireAdmin('admin'), ah(async (req, res) => {
  const total = await db.value('SELECT count(*) FROM notification_log');
  const pg = util.paginate(total, util.int(req.query.page, 1), 50);
  const rows = await db.many(`SELECT * FROM notification_log ORDER BY id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`);
  const subs = await db.value('SELECT count(*) FROM member_push_subscriptions');
  const pushLog = await db.many(`SELECT l.*, m.name, m.name_np, n.title FROM member_push_log l LEFT JOIN members m ON m.id = l.member_id
    LEFT JOIN member_notifications n ON n.id = l.notif_id ORDER BY l.id DESC LIMIT 50`);
  const templates = await db.many('SELECT id, event_type, audience, channel FROM notification_templates WHERE enabled = 1 ORDER BY event_type, channel LIMIT 200').catch(() => []);
  res.render('admin/notifications', { title: res.locals.t('सूचना पठाइएको विवरण', 'Notifications'), rows, pg, subs, pushLog, templates });
}));

router.post('/notifications/test', requireAdmin('admin'), ah(async (req, res) => {
  const ch = req.body.channel;
  const to = String(req.body.to || '').trim();
  const r = ch === 'sms'
    ? await notify.sendSms('test', to, `${res.locals.siteName}: test SMS ✓`)
    : await notify.sendEmail('test', to, `${res.locals.siteName}: test email`, 'यो परीक्षण इमेल हो। This is a test email.');
  flash(req, r.ok ? 'success' : 'error', r.ok ? res.locals.t('पठाइयो।', 'Sent.') : (r.skipped || r.error || 'failed'));
  res.redirect('/admin/notifications');
}));

router.post('/notifications/push', requireAdmin('admin'), ah(async (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 120);
  const body = String(req.body.body || '').trim().slice(0, 300);
  const url = /^\/(?!\/)/.test(String(req.body.url || '')) ? req.body.url : '/member/notifications';
  if (!title) { flash(req, 'error', res.locals.t('शीर्षक चाहिन्छ', 'Title required')); return res.redirect('/admin/notifications'); }
  const type = ['info', 'success', 'warning', 'error'].includes(req.body.type) ? req.body.type : 'broadcast';
  // one member (legacy push-notifications.php target) by member no. / card / phone, or everyone
  const target = String(req.body.target || '').trim();
  if (target) {
    const m = await db.one(`SELECT id, name FROM members WHERE deleted_at IS NULL AND is_active = 1 AND (sadasyata_number = $1 OR member_card_no = $1 OR phone = $1) ORDER BY id LIMIT 1`, [target.slice(0, 50)]);
    if (!m) { flash(req, 'error', res.locals.t('सदस्य भेटिएन।', 'Member not found.')); return res.redirect('/admin/notifications'); }
    const nid = await db.value(`INSERT INTO member_notifications (member_id, title, message, type, link, is_read, created_at) VALUES ($1, $2, $3, $4, $5, 0, now()) RETURNING id`, [m.id, title, body || null, type, url]);
    const r = await push.sendToMember(m.id, { title, body, url }, nid);
    await auth.audit(req, 'notify_member', 'member_notifications', nid, `Notification "${title}" → member #${m.id}, push ${r.sent} sent / ${r.failed} failed`);
    flash(req, 'success', res.locals.t(`${m.name} लाई सूचना पठाइयो (push ${r.sent})।`, `Sent to ${m.name} (${r.sent} push).`));
    return res.redirect('/admin/notifications');
  }
  const members = await db.many('SELECT id FROM members WHERE is_active = 1 AND deleted_at IS NULL');
  for (const m of members) await db.query(`INSERT INTO member_notifications (member_id, title, message, type, link, is_read, created_at) VALUES ($1, $2, $3, $4, $5, 0, now())`, [m.id, title, body || null, type, url]);
  const r = await push.sendToAll({ title, body, url });
  await auth.audit(req, 'broadcast', 'member_notifications', null, `Broadcast "${title}" → ${members.length} members, push ${r.sent} sent / ${r.failed} failed`);
  flash(req, 'success', res.locals.t(`${members.length} सदस्यलाई सूचना, push ${r.sent} पठाइयो।`, `Notified ${members.length} members; ${r.sent} push messages sent.`));
  res.redirect('/admin/notifications');
}));

// browser subscriptions older than 90 days are usually dead (legacy push-notifications.php "clear expired")
router.post('/notifications/push/clear-expired', requireAdmin('admin'), ah(async (req, res) => {
  const r = await db.query("DELETE FROM member_push_subscriptions WHERE created_at < now() - interval '90 days'");
  await auth.audit(req, 'push_clear_expired', 'member_push_subscriptions', null, `${r.rowCount} old push subscriptions removed`);
  flash(req, 'success', res.locals.t(`${r.rowCount} पुराना push उपकरण हटाइए।`, `${r.rowCount} old push subscriptions removed.`));
  res.redirect('/admin/notifications');
}));

// send one template with sample values (legacy notification-templates.php test)
router.post('/notifications/template-test', requireAdmin('admin'), ah(async (req, res) => {
  const tpl = await db.one('SELECT * FROM notification_templates WHERE id = $1', [util.int(req.body.template_id)]);
  const to = String(req.body.to || '').trim().slice(0, 200);
  if (!tpl || !to) { flash(req, 'error', res.locals.t('ढाँचा र प्राप्तकर्ता चाहिन्छ।', 'Choose a template and a recipient.')); return res.redirect('/admin/notifications'); }
  const vars = { name: 'राम बहादुर', tracking_id: 'TEST-0001', module: 'परीक्षण', status: 'approved', remarks: 'नमुना', amount: '10,000', date: nd.todayBs(), details: '', site: res.locals.siteName };
  const fill = str => String(str || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (vars[k] ?? ''));
  const r = tpl.channel === 'sms' ? await notify.sendSms('template_test', to, fill(tpl.body).slice(0, 320))
    : await notify.sendEmail('template_test', to, fill(tpl.subject) || 'Test', fill(tpl.body));
  await auth.audit(req, 'template_test', 'notification_templates', tpl.id, `Test of ${tpl.event_type}/${tpl.channel} → ${to}`);
  flash(req, r.ok ? 'success' : 'error', r.ok ? res.locals.t('परीक्षण पठाइयो।', 'Test sent.') : (r.skipped || r.error || 'failed'));
  res.redirect('/admin/notifications');
}));

// ---------------------------------------------------------------- own 2FA
router.get('/2fa', ah(async (req, res) => {
  const user = await db.one('SELECT twofa_enabled, twofa_enabled_at, twofa_backup_codes FROM admin_users WHERE id = $1', [req.admin.id]);
  let qr = null, secret = null;
  if (!user.twofa_enabled) {
    req.session.twofaSetup = req.session.twofaSetup || totp.generateSecret();
    secret = req.session.twofaSetup;
    qr = await QRCode.toDataURL(totp.provisioningUri(res.locals.siteName || req.tenant.name, req.admin.username, secret), { margin: 1, width: 220 });
  }
  let remaining = 0;
  try { remaining = JSON.parse(user.twofa_backup_codes || '[]').length; } catch { /* ignore */ }
  res.render('admin/twofa', { title: res.locals.t('दुई-चरण प्रमाणीकरण', 'Two-factor authentication'), user, qr, secret, remaining, codes: null, error: null, required: await auth.admin2faRequired() });
}));

router.post('/2fa/enable', ah(async (req, res) => {
  const secret = req.session.twofaSetup;
  const me = await db.one('SELECT password FROM admin_users WHERE id = $1', [req.admin.id]);
  if (!(await auth.checkPassword(req.body.password, me.password))) {
    flash(req, 'error', res.locals.t('पासवर्ड मिलेन।', 'Password is wrong.'));
    return res.redirect('/admin/2fa');
  }
  if (!secret || totp.verify(secret, req.body.code) === null) {
    flash(req, 'error', res.locals.t('कोड मिलेन। एपमा देखिएको ६ अंकको कोड राख्नुहोस्।', 'Code did not match. Enter the 6-digit code from the app.'));
    return res.redirect('/admin/2fa');
  }
  const { codes, hashes } = await totp.backupCodes();
  await db.query('UPDATE admin_users SET twofa_enabled = 1, twofa_secret = $1, twofa_backup_codes = $2, twofa_enabled_at = now() WHERE id = $3', [secret, JSON.stringify(hashes), req.admin.id]);
  delete req.session.twofaSetup;
  await auth.bumpSessionVersion('admin_users', req.admin.id, req);
  await auth.audit(req, '2fa_enable', 'admin_users', req.admin.id, '2FA enabled');
  const user = await db.one('SELECT twofa_enabled, twofa_enabled_at FROM admin_users WHERE id = $1', [req.admin.id]);
  res.render('admin/twofa', { title: res.locals.t('दुई-चरण प्रमाणीकरण', 'Two-factor authentication'), user, qr: null, secret: null, remaining: codes.length, codes, error: null });
}));

router.post('/2fa/disable', ah(async (req, res) => {
  if (await auth.admin2faRequired()) {
    flash(req, 'error', res.locals.t('सहकारीले सबै प्रशासकलाई 2FA अनिवार्य गरेको छ — बन्द गर्न मिल्दैन।', 'Two-step sign-in is required for every admin, so it cannot be turned off.'));
    return res.redirect('/admin/2fa');
  }
  const user = await db.one('SELECT * FROM admin_users WHERE id = $1', [req.admin.id]);
  if (!(await auth.checkPassword(req.body.password, user.password)) || totp.verify(user.twofa_secret, req.body.code) === null) {
    flash(req, 'error', res.locals.t('पासवर्ड वा कोड मिलेन।', 'Password or code is wrong.'));
    return res.redirect('/admin/2fa');
  }
  await db.query('UPDATE admin_users SET twofa_enabled = 0, twofa_secret = NULL, twofa_backup_codes = NULL WHERE id = $1', [user.id]);
  await auth.audit(req, '2fa_disable', 'admin_users', user.id, '2FA disabled');
  flash(req, 'success', res.locals.t('2FA बन्द गरियो।', '2FA turned off.'));
  res.redirect('/admin/2fa');
}));

// ---------------------------------------------------------------- site licence (tenant side)
router.get('/license', requireAdmin('admin'), ah(async (req, res) => {
  const notices = await db.many('SELECT * FROM site_license_renewal_notices ORDER BY id DESC LIMIT 20');
  res.render('admin/license', { title: res.locals.t('वेबसाइट सेवा नवीकरण', 'Website licence'), notices, pay: require('../lib/license').payInfo() });
}));
// withdraw a notice sent by mistake (legacy site-license.php cancel)
router.post('/license/cancel', requireAdmin('admin'), ah(async (req, res) => {
  const r = await db.query("UPDATE site_license_renewal_notices SET status = 'cancelled' WHERE status = 'pending' AND id = $1", [util.int(req.body.id)]);
  if (r.rowCount) await auth.audit(req, 'license_notice_cancel', 'site_license_renewal_notices', util.int(req.body.id), 'Renewal notice withdrawn');
  flash(req, r.rowCount ? 'success' : 'error', r.rowCount ? res.locals.t('सूचना रद्द गरियो।', 'Notice withdrawn.') : res.locals.t('बाँकी सूचना भेटिएन।', 'No pending notice found.'));
  res.redirect('/admin/license');
}));
router.post('/license', requireAdmin('admin'), ah(async (req, res) => {
  await submitLicenseNotice(req, res, { adminId: req.admin.id, username: req.admin.username });
  res.redirect('/admin/license');
}));

// ---------------------------------------------------------------- audit log
// legacy PHP admin_activity_log rows (imported) are shown with the new audit_log rows (negative ids)
const AUDIT_SRC = `(SELECT id, created_at, actor_type, actor_id, actor_name, action, entity_type, entity_id, summary, ip_address, old_values::text AS old_values, new_values::text AS new_values FROM audit_log
  UNION ALL SELECT -l.id, l.created_at, 'admin', l.admin_id, u.username, l.action, COALESCE(l.target_type, 'legacy'), l.target_id, left(COALESCE(l.details::text, ''), 255), l.ip, NULL, NULL
  FROM admin_activity_log l LEFT JOIN admin_users u ON u.id = l.admin_id) a`;
/** 'YYYY-MM-DD' in BS (year ≥ 2050) or AD → AD, else null. */
const anyDateToAd = v => {
  const x = nd.toLatinDigits(String(v || '').trim());
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(x)) return null;
  return Number(x.slice(0, 4)) >= 2050 ? nd.bsToAd(x) : x;
};
router.get('/audit', requireAdmin('admin'), ah(async (req, res) => {
  const f = { actor: util.int(req.query.actor, 0), action: String(req.query.action || '').slice(0, 64), entity: String(req.query.entity || '').slice(0, 64),
    from: String(req.query.from || '').slice(0, 12), to: String(req.query.to || '').slice(0, 12), q: String(req.query.q || '').trim().slice(0, 100) };
  const where = [], params = [];
  const add = (sql, v) => { params.push(v); const n = '$' + params.length; where.push(sql.replace(/\?/g, () => n)); }; // every ? = this one value
  if (f.actor) add('a.actor_id = ? AND a.actor_type IN (\'admin\', \'superadmin\')', f.actor);
  if (f.action) add('a.action = ?', f.action);
  if (f.entity) add('a.entity_type = ?', f.entity);
  const from = anyDateToAd(f.from), to = anyDateToAd(f.to);
  if (from) add('a.created_at >= ?::date', from);
  if (to) add('a.created_at < ?::date + 1', to);
  if (f.q) add('(a.summary ILIKE ? OR a.actor_name ILIKE ?)', '%' + f.q + '%');
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  if (req.query.format === 'csv') {
    const rows = await db.many(`SELECT * FROM ${AUDIT_SRC} ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT 50000`, params);
    await auth.audit(req, 'export', 'audit_log', null, `Audit log CSV (${rows.length} rows)`);
    return util.sendCsv(res, 'audit-log.csv', ['time', 'actor', 'actor_type', 'action', 'entity', 'entity_id', 'summary', 'ip', 'old', 'new'],
      rows.map(r => [r.created_at, r.actor_name, r.actor_type, r.action, r.entity_type, r.entity_id, r.summary, r.ip_address, r.old_values, r.new_values]));
  }
  const total = await db.value(`SELECT count(*) FROM ${AUDIT_SRC} ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 30);
  const [rows, actors, actions, entities] = await Promise.all([
    db.many(`SELECT * FROM ${AUDIT_SRC} ${w} ORDER BY a.created_at DESC, a.id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params),
    db.many(`SELECT DISTINCT actor_id, actor_name FROM ${AUDIT_SRC} WHERE actor_type IN ('admin', 'superadmin') AND actor_id IS NOT NULL ORDER BY actor_name LIMIT 300`),
    db.many(`SELECT DISTINCT action FROM ${AUDIT_SRC} ORDER BY 1 LIMIT 200`),
    db.many(`SELECT DISTINCT entity_type FROM ${AUDIT_SRC} ORDER BY 1 LIMIT 200`),
  ]);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, String(v)])).toString();
  res.render('admin/audit', { title: res.locals.t('अडिट लग', 'Audit log'), rows, pg, f, actors, actions: actions.map(r => r.action), entities: entities.map(r => r.entity_type), qs });
}));

module.exports = router;
