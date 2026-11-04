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
const memberImport = require('../lib/member-import');
const push = require('../lib/push');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const { requireAdmin } = auth;

router.use((req, res, next) => {
  res.locals.resources = resources;
  res.locals.GROUPS = GROUPS;
  res.locals.modules = modules;
  res.locals.roleLevel = auth.roleLevel;
  next();
});

// ---------------------------------------------------------------- auth
router.get('/login', (req, res) => {
  if (req.admin) return res.redirect('/admin');
  res.render('admin/login', { layout: 'auth', title: 'Admin login', error: null, username: '' });
});

router.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const { error, user, needs2fa } = await auth.adminLogin(req, username, String(req.body.password || ''));
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
router.get('/login/2fa', (req, res) => {
  if (!pending2fa(req)) return res.redirect('/admin/login');
  res.render('admin/login-2fa', { layout: 'auth', title: '2FA', error: null });
});
router.post('/login/2fa', ah(async (req, res) => {
  const p = pending2fa(req);
  if (!p) return res.redirect('/admin/login');
  const user = await db.one("SELECT * FROM admin_users WHERE id = $1 AND is_active = 1 AND deleted_at IS NULL AND COALESCE(status, 'active') = 'active'", [p.id]);
  if (!user || !user.twofa_enabled || require('../lib/license').loginBlocked(req.tenant, user)) { delete req.session.pending2fa; return res.redirect('/admin/login'); }
  const key = db.currentSchema() + ':' + user.id;
  if (await auth.tooManyAttempts('2fa:' + user.username, req.ip)) return res.status(429).render('admin/login-2fa', { layout: 'auth', title: '2FA', error: res.locals.t('धेरै गलत प्रयास। १५ मिनेटपछि प्रयास गर्नुहोस्।', 'Too many attempts. Try again in 15 minutes.') });
  const code = String(req.body.code || '').trim();
  let ok = false;
  const step = totp.verify(user.twofa_secret, code);
  if (step !== null && step > (usedSteps.get(key) || 0)) { usedSteps.set(key, step); ok = true; }
  if (!ok && code.replace(/[^A-Za-z0-9]/g, '').length >= 8) {
    const remaining = await totp.consumeBackupCode(code, user.twofa_backup_codes);
    if (remaining) { await db.query('UPDATE admin_users SET twofa_backup_codes = $1 WHERE id = $2', [JSON.stringify(remaining), user.id]); ok = true; }
  }
  if (!ok) {
    await auth.recordFailure('2fa:' + user.username, req.ip);
    return res.status(401).render('admin/login-2fa', { layout: 'auth', title: '2FA', error: res.locals.t('कोड मिलेन।', 'Invalid code.') });
  }
  await auth.completeAdminLogin(req, user);
  res.redirect(user.must_change_password ? '/admin/password' : auth.safeNext(req.query.next, '/admin'));
}));

router.post('/logout', ah(async (req, res) => {
  await auth.logout(req);
  res.redirect('/admin/login');
}));

router.use(requireAdmin('editor'));

// a temporary / reset password must be replaced before anything else
router.use((req, res, next) => {
  if (!req.admin.must_change_password || req.path === '/password' || req.path === '/logout') return next();
  if (req.method === 'GET') return res.redirect('/admin/password');
  return res.status(403).render('admin/denied', { title: 'Change password first' });
});

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
  res.render('admin/dashboard', { title: res.locals.t('ड्यासबोर्ड', 'Dashboard'), recent: recent.slice(0, 12), stats: { members, pendingMembers, notices, news }, visitors });
}));

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
    const textCols = fields.filter(f => ['text', 'textarea', 'richtext', 'url'].includes(f.type)).map(f => f.name).slice(0, 6);
    if (textCols.length) { params.push('%' + q + '%'); where.push('(' + textCols.map(c => `${c}::text ILIKE $1`).join(' OR ') + ')'); }
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = await db.value(`SELECT count(*) FROM ${r.table} ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 25);
  const rows = await db.many(`SELECT * FROM ${r.table} ${w} ORDER BY ${r.order || 'id DESC'} LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  const options = await refOptions(fields.filter(f => f.list && f.type === 'select'));
  res.render('admin/resource-list', { title: res.locals.t(...r.title), r, fields, listFields: fields.filter(f => f.list), rows, pg, q, options, hasActive: cols.has('is_active') });
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
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors[f.name] = 'YYYY-MM-DD'; continue; }
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
  const [mw, csrf] = upload(req.resource.key.replace(/_/g, '-'), fileFields.map(f => ({ name: f.name, kind: f.type === 'image' ? 'image' : 'any' })), { maxMb: 20, private: !!req.resource.privateFiles });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}

async function saveResource(req, res, existing) {
  const r = req.resource;
  const fields = await resourceFields(r);
  const { data, errors } = readResourceForm(fields, req.body, req.uploaded, existing);
  if (req.uploadError) errors._upload = req.uploadError;
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
    const clean = await db.pick(r.table, data);
    const row = existing ? await db.update(r.table, existing.id, clean) : await db.insert(r.table, clean);
    if (existing) for (const f of r.fileFields) if (clean[f.name] !== undefined && existing[f.name] && existing[f.name] !== clean[f.name]) remove(req, existing[f.name]);
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
  if (action === 'delete') {
    if (r.softDelete && cols.has('deleted_at')) await db.query(`UPDATE ${r.table} SET deleted_at = now() WHERE id = ANY($1::int[])`, [ids]);
    else for (const row of await db.many(`DELETE FROM ${r.table} WHERE id = ANY($1::int[]) RETURNING *`, [ids])) for (const f of r.fileFields) remove(req, row[f.name]);
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

router.post('/r/:resource/:id/delete', getResource, ah(async (req, res) => {
  const r = req.resource;
  const id = util.int(req.params.id);
  const cols = await db.columns(r.table);
  if (r.softDelete && cols.has('deleted_at')) await db.query(`UPDATE ${r.table} SET deleted_at = now() WHERE id = $1`, [id]);
  else {
    const row = await db.one(`DELETE FROM ${r.table} WHERE id = $1 RETURNING *`, [id]);
    if (row) for (const f of r.fileFields) remove(req, row[f.name]);
  }
  await auth.audit(req, 'delete', r.table, id, `${r.title[1]} #${id}`);
  navigation.invalidate();
  flash(req, 'success', res.locals.t('हटाइयो।', 'Deleted.'));
  res.redirect(`/admin/r/${r.key}`);
}));

// ---------------------------------------------------------------- application inboxes
function getModule(req, res, next) {
  const m = Object.hasOwn(modules, req.params.module) ? modules[req.params.module] : null;
  if (!m) return next('route');
  if (auth.roleLevel(req.admin.role) < auth.roleLevel('staff')) return res.status(403).render('admin/denied', { title: 'Access denied' });
  req.mod = m;
  next();
}

async function inboxQuery(req, m) {
  const cols = await db.columns(m.table);
  const where = [], params = [];
  if (cols.has('deleted_at')) where.push('deleted_at IS NULL');
  const status = String(req.query.status || '');
  if (status && cols.has('status')) { params.push(status); where.push(`status = $${params.length}`); }
  const q = String(req.query.q || '').trim();
  if (q) {
    params.push('%' + q + '%');
    const search = [m.nameCol, m.phoneCol, 'email', 'tracking_id', m.memberCol].filter(c => c && cols.has(c));
    where.push('(' + search.map(c => `${c}::text ILIKE $${params.length}`).join(' OR ') + ')');
  }
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
  if (isDate(req.query.from)) { params.push(req.query.from); where.push(`created_at >= $${params.length}::date`); }
  if (isDate(req.query.to)) { params.push(req.query.to); where.push(`created_at < $${params.length}::date + 1`); }
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params, cols, status, q };
}

router.get('/inbox/:module', getModule, ah(async (req, res) => {
  const m = req.mod;
  const { w, params, cols, status, q } = await inboxQuery(req, m);
  const total = await db.value(`SELECT count(*) FROM ${m.table} ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 25);
  const rows = await db.many(`SELECT * FROM ${m.table} ${w} ORDER BY created_at DESC NULLS LAST, id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  const statuses = cols.has('status') && !m.noStatus ? await forms.statusesFor(m.table) : [];
  const options = await forms.resolveOptions(m);
  res.render('admin/inbox-list', { title: res.locals.t(...m.title), m, rows, pg, statuses, status, q, options, hasRead: cols.has('is_read') });
}));

router.get('/inbox/:module/export.csv', getModule, ah(async (req, res) => {
  const m = req.mod;
  const { w, params } = await inboxQuery(req, m);
  const rows = await db.many(`SELECT * FROM ${m.table} ${w} ORDER BY created_at DESC NULLS LAST LIMIT 10000`, params);
  const cols = ['tracking_id', ...m.fields.filter(f => f.type !== 'file' && f.type !== 'image').map(f => f.name), 'status', 'created_at'].filter((c, i, a) => a.indexOf(c) === i && (!rows[0] || c in rows[0]));
  await auth.audit(req, 'export', m.table, null, `CSV export (${rows.length} rows)`);
  res.type('text/csv; charset=utf-8').attachment(`${m.key}-${new Date().toISOString().slice(0, 10)}.csv`)
    .send(util.toCsv(cols, rows));
}));

router.get('/inbox/:module/:id', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await db.one(`SELECT * FROM ${m.table} WHERE id = $1`, [util.int(req.params.id)]);
  if (!row) return next();
  const cols = await db.columns(m.table);
  if (cols.has('is_read') && !row.is_read) await db.query(`UPDATE ${m.table} SET is_read = 1 WHERE id = $1`, [row.id]);
  const history = await db.many('SELECT * FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at DESC', [m.key, row.id]);
  const statuses = cols.has('status') && !m.noStatus ? await forms.statusesFor(m.table) : [];
  const options = await forms.resolveOptions(m);
  res.render('admin/inbox-view', { title: res.locals.t(...m.title), m, row, history, statuses, options, hasRemarks: cols.has(m.remarksCol) });
}));

router.post('/inbox/:module/:id/status', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await db.one(`SELECT * FROM ${m.table} WHERE id = $1`, [util.int(req.params.id)]);
  if (!row) return next();
  const statuses = await forms.statusesFor(m.table);
  const status = String(req.body.status || '');
  const comment = String(req.body.comment || '').trim().slice(0, 2000);
  const cols = await db.columns(m.table);
  const data = {};
  if (statuses.includes(status)) data.status = status;
  if (cols.has(m.remarksCol) && comment) data[m.remarksCol] = comment;
  if (cols.has('reviewed_by')) data.reviewed_by = req.admin.username;
  if (cols.has('reviewed_at')) data.reviewed_at = new Date();
  if (m.key === 'grievance' && status === 'resolved') data.resolved_at = new Date();
  if (m.key === 'welfare' && req.body.approved_amount) data.approved_amount = Number(nd.toLatinDigits(req.body.approved_amount)) || null;
  await db.transaction(async () => {
    await db.update(m.table, row.id, await db.pick(m.table, data));
    await db.query(`INSERT INTO request_status_history (module, request_id, old_status, new_status, admin_comment, actor_admin_id, actor_name, created_at, notify_sent, admin_chose_to_notify)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 0, 0)`, [m.key, row.id, row.status || null, data.status || row.status || null, comment || null, req.admin.id, req.admin.full_name || req.admin.username]);
    // notify the member in-portal when we can match them
    const memberKey = (m.memberCol && row[m.memberCol]) || row[m.phoneCol];
    if (memberKey) {
      const member = await db.one('SELECT id FROM members WHERE deleted_at IS NULL AND (sadasyata_number = $1 OR member_card_no = $1 OR phone = $1) LIMIT 1', [String(memberKey)]);
      if (member) await notify.notifyMember(member.id, m.title[0] + ': ' + forms.statusLabel(data.status || row.status), comment || null, row.tracking_id ? '/track?id=' + encodeURIComponent(row.tracking_id) : null, 'status');
    }
  });
  if (data.status && data.status !== row.status) {
    notify.later(() => require('../lib/webhooks').emit('application.status_changed', { type: m.key, id: row.id, tracking_id: row.tracking_id || null, status: data.status, previous_status: row.status || null, remarks: comment || null, changed_by: req.admin.username }));
  }
  const notifyApplicant = req.body.notify === '1' && data.status && data.status !== row.status;
  if (notifyApplicant && row.tracking_id) {
    notify.later(() => notify.applicationEvent('status_changed', { name: row[m.nameCol], tracking_id: row.tracking_id, module: m.title[0], status: forms.statusLabel(data.status), remarks: comment }, { phone: row[m.phoneCol], email: row.email }));
    await db.query('UPDATE request_status_history SET admin_chose_to_notify = 1, notify_sent = 1 WHERE id = (SELECT max(id) FROM request_status_history WHERE module = $1 AND request_id = $2)', [m.key, row.id]);
  }
  await auth.audit(req, 'status', m.table, row.id, `${row.status} → ${data.status || row.status}`, { old: { status: row.status }, new: data });
  flash(req, 'success', res.locals.t('स्थिति अद्यावधिक भयो।', 'Status updated.'));
  res.redirect(`/admin/inbox/${m.key}/${row.id}`);
}));

router.post('/inbox/:module/:id/delete', getModule, ah(async (req, res) => {
  const m = req.mod;
  if (auth.roleLevel(req.admin.role) < auth.roleLevel('admin')) return res.status(403).render('admin/denied', { title: 'Access denied' });
  const cols = await db.columns(m.table);
  const id = util.int(req.params.id);
  if (cols.has('deleted_at')) await db.query(`UPDATE ${m.table} SET deleted_at = now() WHERE id = $1`, [id]);
  else await db.query(`DELETE FROM ${m.table} WHERE id = $1`, [id]);
  await auth.audit(req, 'delete', m.table, id, `${m.title[1]} #${id}`);
  flash(req, 'success', res.locals.t('हटाइयो।', 'Deleted.'));
  res.redirect(`/admin/inbox/${m.key}`);
}));

// confidential uploads (application documents, information room) — signed-in staff only
router.get('/files/*rest', requireAdmin('staff'), (req, res, next) => {
  const rest = [].concat(req.params.rest || []).join('/');
  if (!rest.startsWith('_private/')) return next();
  if (rest.startsWith('_private/information-room-items/') && auth.roleLevel(req.admin.role) < auth.roleLevel('admin')) return res.status(403).end();
  require('../lib/uploads').sendStored(req, res, next, rest);
});

router.use('/programs', require('./admin-programs'));
router.use('/marketplace', require('./marketplace').admin);
router.use('/credentials', require('./admin-credentials'));
router.use('/integrations', require('./admin-integrations'));

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

// ---------------------------------------------------------------- members
router.get('/members', requireAdmin('staff'), ah(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const st = String(req.query.status || '');
  const where = ['deleted_at IS NULL'], params = [];
  if (q) { params.push('%' + q + '%'); where.push(`(name ILIKE $${params.length} OR name_np ILIKE $${params.length} OR phone ILIKE $${params.length} OR email ILIKE $${params.length} OR sadasyata_number ILIKE $${params.length} OR member_card_no ILIKE $${params.length})`); }
  if (st) { params.push(st); where.push(`approval_status = $${params.length}`); }
  const w = 'WHERE ' + where.join(' AND ');
  const total = await db.value(`SELECT count(*) FROM members ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 30);
  const rows = await db.many(`SELECT * FROM members ${w} ORDER BY id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  res.render('admin/members', { title: res.locals.t('सदस्यहरू', 'Members'), rows, pg, q, st });
}));

const MEMBER_FIELDS = ['name', 'name_np', 'email', 'phone', 'sadasyata_number', 'member_card_no', 'address', 'dob', 'gender', 'approval_status', 'is_active', 'information_room_enabled'];

// ---------------------------------------------------------------- bulk member import (CSV)
router.get('/members/import', requireAdmin('admin'), ah(async (req, res) => {
  const jobs = await db.many('SELECT * FROM member_import_jobs ORDER BY id DESC LIMIT 20');
  res.render('admin/member-import', { title: res.locals.t('सदस्य CSV आयात', 'Import members (CSV)'), jobs, error: null });
}));
router.get('/members/import/sample.csv', requireAdmin('admin'), (req, res) => res.type('text/csv; charset=utf-8').attachment('members-sample.csv').send(memberImport.SAMPLE));
router.post('/members/import', requireAdmin('admin'), (req, res, next) => {
  const [mw, csrf] = upload('imports', [{ name: 'csv', kind: 'doc' }], { maxMb: 10 });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}, ah(async (req, res) => {
  const fail = async error => res.status(422).render('admin/member-import', { title: res.locals.t('सदस्य CSV आयात', 'Import members (CSV)'), jobs: await db.many('SELECT * FROM member_import_jobs ORDER BY id DESC LIMIT 20'), error });
  const stored = req.uploaded && req.uploaded.csv;
  if (req.uploadError || !stored || !/\.csv$/i.test(stored)) return fail(req.uploadError || res.locals.t('.csv फाइल छान्नुहोस्', 'Choose a .csv file'));
  const fs = require('fs');
  const file = require('path').join(require('../lib/uploads').tenantDir(req), stored);
  try {
    const job = await memberImport.stage(fs.readFileSync(file), req.body.original_name || stored.split('/').pop(), req.admin.id, req.body.mode === 'skip' ? 'skip' : 'update');
    await auth.audit(req, 'import_stage', 'member_import_jobs', job.id, `CSV staged: ${job.valid} valid, ${job.invalid} invalid`);
    res.redirect('/admin/members/import/' + job.id);
  } catch (e) { return fail(e.message); } finally { fs.rm(file, { force: true }, () => {}); }
}));
router.get('/members/import/:id', requireAdmin('admin'), ah(async (req, res, next) => {
  const job = await db.one('SELECT * FROM member_import_jobs WHERE id = $1', [util.int(req.params.id)]);
  if (!job) return next();
  const filter = ['invalid', 'pending', 'created', 'updated', 'skipped', 'failed'].includes(req.query.status) ? req.query.status : '';
  const counts = Object.fromEntries((await db.many('SELECT status, count(*) AS n FROM member_import_rows WHERE job_id = $1 GROUP BY status', [job.id])).map(r => [r.status, r.n]));
  const rows = await db.many(`SELECT * FROM member_import_rows WHERE job_id = $1 ${filter ? 'AND status = $2' : ''} ORDER BY row_num LIMIT 300`, filter ? [job.id, filter] : [job.id]);
  res.render('admin/member-import-job', { title: res.locals.t('आयात', 'Import') + ' #' + job.id, job, rows, counts, filter });
}));
router.post('/members/import/:id/commit', requireAdmin('admin'), ah(async (req, res) => {
  const id = util.int(req.params.id);
  try {
    const r = await memberImport.commit(id, req.admin.id);
    await auth.audit(req, 'import_commit', 'member_import_jobs', id, `CSV import: ${r.ok} ok, ${r.skip} skipped, ${r.fail} failed`);
    flash(req, 'success', res.locals.t(`आयात सम्पन्न: ${r.ok} सफल, ${r.skip} छोडियो, ${r.fail} असफल`, `Import done: ${r.ok} saved, ${r.skip} skipped, ${r.fail} failed`));
  } catch (e) { flash(req, 'error', e.message); }
  res.redirect('/admin/members/import/' + id);
}));

router.get('/members/new', requireAdmin('staff'), (req, res) => res.render('admin/member-form', { title: res.locals.t('नयाँ सदस्य', 'New member'), item: null, values: { approval_status: 'approved', is_active: 1 }, errors: {} }));
router.get('/members/:id', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [util.int(req.params.id)]);
  if (!item) return next();
  const cards = await db.many('SELECT * FROM member_id_cards WHERE member_id IN ($1, $2, $3) ORDER BY id DESC', [String(item.id), item.sadasyata_number || '-', item.member_card_no || '-']);
  const [accounts, docs] = await Promise.all([
    db.many('SELECT * FROM member_accounts WHERE member_id = $1 ORDER BY kind, account_no', [item.id]),
    db.many('SELECT id, title, doc_type, file_path, source, visible_to_member, created_at FROM member_documents WHERE member_id = $1 ORDER BY created_at DESC', [item.id]),
  ]);
  res.render('admin/member-form', { title: item.name_np || item.name, item, values: item, errors: {}, cards, accounts, docs });
}));

async function saveMember(req, res, item) {
  const b = req.body, errors = {};
  const data = {};
  for (const k of MEMBER_FIELDS) data[k] = typeof b[k] === 'string' ? b[k].trim() || null : null;
  data.is_active = b.is_active ? 1 : 0;
  data.information_room_enabled = b.information_room_enabled ? 1 : 0;
  data.sadasyata_number = data.sadasyata_number || '';
  data.name_np = data.name_np || '';
  if (!data.name) errors.name = 'आवश्यक छ / required';
  if (data.email && !util.isEmail(data.email)) errors.email = 'Invalid email';
  if (data.phone) data.phone = nd.toLatinDigits(data.phone);
  if (!['pending', 'approved', 'rejected'].includes(data.approval_status)) data.approval_status = 'pending';
  const pw = String(b.password || '');
  if (pw && pw.length < 8) errors.password = 'कम्तीमा ८ अक्षर / min 8 characters';
  if (Object.keys(errors).length) return res.status(422).render('admin/member-form', { title: 'Member', item, values: { ...item, ...b }, errors, cards: [] });
  if (pw) { data.password_hash = await auth.hashPassword(pw); data.must_change_password = 1; }
  if (data.approval_status === 'approved' && (!item || item.approval_status !== 'approved')) { data.approved_at = new Date(); data.approved_by = req.admin.id; }
  try {
    const row = item ? await db.update('members', item.id, data) : await db.insert('members', { ...data, created_by: req.admin.id, is_verified: 1 });
    if (item && (pw || !data.is_active)) await auth.bumpSessionVersion('members', item.id);
    notify.later(() => require('../lib/webhooks').emit(item ? 'member.updated' : 'member.created', { id: row.id, member_no: row.sadasyata_number || null, name: row.name, name_np: row.name_np || null, phone: row.phone || null, email: row.email || null, active: !!Number(row.is_active), approval_status: row.approval_status, changed_by: req.admin.username }));
    await auth.audit(req, item ? 'update' : 'create', 'members', row.id, `Member ${row.name}`);
    flash(req, 'success', res.locals.t('सदस्य विवरण सुरक्षित भयो।', 'Member saved.'));
    res.redirect('/admin/members/' + row.id);
  } catch (e) {
    if (e.code === '23505') return res.status(422).render('admin/member-form', { title: 'Member', item, values: { ...item, ...b }, errors: { email: res.locals.t('यो इमेल पहिले नै छ', 'Email already used') }, cards: [] });
    throw e;
  }
}
router.post('/members', requireAdmin('staff'), ah((req, res) => saveMember(req, res, null)));
router.post('/members/:id', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [util.int(req.params.id)]);
  if (!item) return next();
  await saveMember(req, res, item);
}));

router.post('/members/:id/card', requireAdmin('staff'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [util.int(req.params.id)]);
  if (!m) return res.redirect('/admin/members');
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rnd = n => Array.from(crypto.randomBytes(n), x => alphabet[x % alphabet.length]).join('');
  const prefix = (req.tenant.slug.slice(0, 3) || 'MEM').toUpperCase();
  const code = `${prefix}-${rnd(4)}-${rnd(4)}`;
  const cvv = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const cardNo = m.member_card_no || `${prefix}${String(m.id).padStart(6, '0')}`;
  const expiry = new Date(Date.now() + 5 * 365 * 86400_000).toISOString().slice(0, 10);
  await db.transaction(async () => {
    await db.query("UPDATE member_id_cards SET status = 'revoked' WHERE member_id = $1 AND status = 'active'", [String(m.id)]);
    await db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status, created_by, created_at)
                    VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'active', $6, now())`, [String(m.id), cardNo + '-' + rnd(3), code, cvv, expiry, req.admin.id]);
    await db.query('UPDATE members SET member_card_no = $1, id_card_generated = 1, id_card_generated_at = now(), card_expires_at = $2 WHERE id = $3', [cardNo, expiry, m.id]);
  });
  await auth.audit(req, 'card', 'members', m.id, 'Issued ID card');
  flash(req, 'success', res.locals.t(`परिचयपत्र जारी भयो। कोड ${code}, CVV ${cvv}`, `ID card issued. Code ${code}, CVV ${cvv}`));
  res.redirect('/admin/members/' + m.id);
}));

router.post('/members/:id/delete', requireAdmin('admin'), ah(async (req, res) => {
  await db.query('UPDATE members SET deleted_at = now(), is_active = 0 WHERE id = $1', [util.int(req.params.id)]);
  await auth.audit(req, 'delete', 'members', util.int(req.params.id), 'Member deleted');
  flash(req, 'success', res.locals.t('सदस्य हटाइयो।', 'Member removed.'));
  res.redirect('/admin/members');
}));

router.get('/password-requests', requireAdmin('staff'), ah(async (req, res) => {
  const rows = await db.many(`SELECT r.*, m.name, m.phone, m.sadasyata_number FROM member_password_reset_requests r LEFT JOIN members m ON m.id = r.member_id ORDER BY r.status = 'pending' DESC, r.requested_at DESC LIMIT 100`);
  res.render('admin/password-requests', { title: res.locals.t('पासवर्ड रिसेट अनुरोध', 'Password reset requests'), rows, temp: req.session.tempPassword });
  delete req.session.tempPassword;
}));

router.post('/password-requests/:id/resolve', requireAdmin('staff'), ah(async (req, res) => {
  const r = await db.one("SELECT * FROM member_password_reset_requests WHERE id = $1 AND status = 'pending'", [util.int(req.params.id)]);
  if (r) {
    const temp = crypto.randomBytes(5).toString('base64url');
    await db.query('UPDATE members SET password_hash = $1, must_change_password = 1 WHERE id = $2', [await auth.hashPassword(temp), r.member_id]);
    await auth.bumpSessionVersion('members', r.member_id);
    await db.query("UPDATE member_password_reset_requests SET status = 'resolved', admin_id = $1, resolved_at = now() WHERE id = $2", [req.admin.id, r.id]);
    await auth.audit(req, 'password_reset', 'members', r.member_id, 'Temporary password issued');
    req.session.tempPassword = { id: r.id, temp };
  }
  res.redirect('/admin/password-requests');
}));

// ---------------------------------------------------------------- settings
const SETTING_GROUPS = {
  general: ['सामान्य', 'General'], contact: ['सम्पर्क', 'Contact'], about: ['परिचय', 'About'],
  social: ['सामाजिक सञ्जाल', 'Social'], apps: ['एप/बैंकिङ', 'Apps'], seo: ['SEO', 'SEO'],
  notify: ['SMS / इमेल', 'SMS / email'], ai: ['AI च्याट', 'AI chat'], oauth: ['Google लगइन', 'Google sign-in'],
  security: ['स्प्याम सुरक्षा', 'Anti-spam'],
};
const SECRET_KEY = /password|api_key|token|secret|private/;
router.get('/settings', requireAdmin('admin'), ah(async (req, res) => {
  const rows = await settings.grouped();
  res.render('admin/settings', { title: res.locals.t('सेटिङ', 'Settings'), rows, groups: SETTING_GROUPS, tab: req.query.tab || 'general', oauthRedirect: `${req.protocol}://${req.get('host')}/member/oauth/google/callback` });
}));

router.post('/settings', requireAdmin('admin'), (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload('settings', [{ name: 'file_logo', kind: 'image' }, { name: 'file_chairman_photo', kind: 'image' }, { name: 'file_ceo_photo', kind: 'image' }, { name: 'file_history_photo', kind: 'image' }, { name: 'file_seo_og_image', kind: 'image' }]);
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}, ah(async (req, res) => {
  const rows = await settings.grouped();
  const known = new Map(rows.map(r => [r.setting_key, r]));
  for (const [k, v] of Object.entries(req.body)) {
    if (!k.startsWith('s_')) continue;
    const key = k.slice(2);
    if (!/^[a-z0-9_]{2,100}$/.test(key) || !known.has(key)) continue;
    let val = String(v).slice(0, 20000);
    if (SECRET_KEY.test(key) && val === '') continue; // blank = keep existing secret
    if (key === 'primary_color' && !/^#[0-9a-f]{3,8}$/i.test(val)) continue;
    // accept the whole <meta name="google-site-verification" content="…"> tag or just the code
    if (key === 'google_site_verification') val = val.replace(/^[\s\S]*content=["']?([^"'\s>]+)[\s\S]*$/i, '$1').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 100);
    if ((key === 'seo_title' || key === 'seo_title_en') && val.length > 70) val = val.slice(0, 70);
    await settings.set(key, val, known.get(key));
  }
  for (const [field, path] of Object.entries(req.uploaded || {})) {
    if (path) await settings.set(field.replace(/^file_/, ''), path, { type: 'image', group: field === 'file_logo' ? 'general' : 'about', label: field });
  }
  await auth.audit(req, 'update', 'site_settings', null, 'Settings updated');
  flash(req, 'success', res.locals.t('सेटिङ सुरक्षित भयो।', 'Settings saved.'));
  res.redirect('/admin/settings?tab=' + encodeURIComponent(String(req.body._tab || 'general')));
}));

// ---------------------------------------------------------------- theme (admin + superadmin choose the default)
const themes = require('../lib/themes');
router.get('/theme', requireAdmin('admin'), ah(async (req, res) => {
  const pol = themes.policy(await settings.all());
  const counts = {
    members: Number(await db.value('SELECT count(*) FROM members WHERE theme_pref IS NOT NULL AND deleted_at IS NULL')) || 0,
    admins: Number(await db.value('SELECT count(*) FROM admin_users WHERE theme_pref IS NOT NULL AND deleted_at IS NULL')) || 0,
  };
  res.render('admin/theme', { title: res.locals.t('रूप / थिम', 'Theme'), pol, swatches: themes.swatches(pol.orgColor), modes: themes.MODES, counts });
}));
router.post('/theme', requireAdmin('admin'), ah(async (req, res) => {
  const b = req.body, s = await settings.all();
  const meta = { group: 'appearance' };
  if (/^#[0-9a-f]{6}$/i.test(b.primary_color || '')) await settings.set('primary_color', b.primary_color, { type: 'color', label: 'Brand colour', group: 'theme' });
  if (themes.isPalette(b.palette)) await settings.set('theme_default_palette', b.palette, { ...meta, label: 'Default theme palette' });
  if (themes.isMode(b.mode)) await settings.set('theme_default_mode', b.mode, { ...meta, label: 'Default theme mode' });
  await settings.set('theme_user_choice', b.allow_user === '1' ? '1' : '0', { ...meta, label: 'Users may change the theme' });
  if (b.reset_all === '1') {
    await settings.set('theme_epoch', String((Number(s.theme_epoch) || 0) + 1), { ...meta, label: 'Theme reset counter' });
    await db.query('UPDATE members SET theme_pref = NULL WHERE theme_pref IS NOT NULL');
    await db.query('UPDATE admin_users SET theme_pref = NULL WHERE theme_pref IS NOT NULL');
  }
  await auth.audit(req, 'update', 'site_settings', null, `Theme default ${b.palette}/${b.mode}${b.reset_all === '1' ? ' (reset all)' : ''}`);
  flash(req, 'success', res.locals.t('रूप सुरक्षित भयो।', 'Theme saved.'));
  res.redirect('/admin/theme');
}));

// ---------------------------------------------------------------- admin users (super admin)
router.get('/users', requireAdmin('superadmin'), ah(async (req, res) => {
  const rows = await db.many('SELECT id, username, full_name, email, role, is_active, last_login, created_at, twofa_enabled, custom_role_id FROM admin_users WHERE deleted_at IS NULL ORDER BY id');
  const customRoles = await db.many('SELECT id, name FROM admin_roles ORDER BY name');
  res.render('admin/users', { title: res.locals.t('प्रशासक प्रयोगकर्ता', 'Admin users'), rows, customRoles, errors: {}, values: { role: 'staff' } });
}));

router.post('/users', requireAdmin('superadmin'), ah(async (req, res) => {
  const b = req.body, errors = {};
  const username = String(b.username || '').trim().toLowerCase();
  if (!/^[a-z0-9_.-]{3,50}$/.test(username)) errors.username = '3–50: a-z 0-9 _ . -';
  if (String(b.password || '').length < 10) errors.password = 'min 10 characters';
  if (!['superadmin', 'admin', 'staff', 'editor'].includes(b.role)) errors.role = 'role';
  if (!Object.keys(errors).length && await db.value('SELECT 1 FROM admin_users WHERE lower(username) = $1', [username])) errors.username = res.locals.t('यो नाम पहिले नै छ', 'Username taken');
  if (Object.keys(errors).length) {
    const rows = await db.many('SELECT id, username, full_name, email, role, is_active, last_login, created_at, twofa_enabled, custom_role_id FROM admin_users WHERE deleted_at IS NULL ORDER BY id');
    return res.status(422).render('admin/users', { title: res.locals.t('प्रशासक प्रयोगकर्ता', 'Admin users'), rows, customRoles: await db.many('SELECT id, name FROM admin_roles ORDER BY name'), errors, values: b });
  }
  const roleId = b.role !== 'superadmin' ? util.int(b.custom_role_id, 0) : 0;
  const customRole = roleId ? await db.value('SELECT id FROM admin_roles WHERE id = $1', [roleId]) : null;
  const row = await db.insert('admin_users', { username, password: await auth.hashPassword(b.password), full_name: String(b.full_name || username).slice(0, 100), email: b.email || null, role: b.role, custom_role_id: customRole || null, is_active: 1, status: 'active', must_change_password: 1, created_by: req.admin.id });
  await auth.audit(req, 'create', 'admin_users', row.id, `Admin user ${username} (${b.role})`);
  flash(req, 'success', res.locals.t('प्रयोगकर्ता थपियो।', 'User added.'));
  res.redirect('/admin/users');
}));

router.post('/users/:id', requireAdmin('superadmin'), ah(async (req, res) => {
  const id = util.int(req.params.id);
  if (id === req.admin.id && (req.body.action === 'disable' || req.body.action === 'delete')) {
    flash(req, 'error', res.locals.t('आफ्नै खाता निष्क्रिय गर्न मिल्दैन।', 'You cannot disable your own account.'));
    return res.redirect('/admin/users');
  }
  const action = req.body.action;
  if (action === 'role' && ['superadmin', 'admin', 'staff', 'editor'].includes(req.body.role)) await db.query('UPDATE admin_users SET role = $1 WHERE id = $2', [req.body.role, id]);
  if (action === 'custom_role') {
    const rid = util.int(req.body.custom_role_id, 0);
    await db.query('UPDATE admin_users SET custom_role_id = $1 WHERE id = $2', [rid && (await db.value('SELECT id FROM admin_roles WHERE id = $1', [rid])) ? rid : null, id]);
  }
  if (action === 'disable') await db.query("UPDATE admin_users SET is_active = 0, status = 'disabled' WHERE id = $1", [id]);
  if (action === 'enable') await db.query("UPDATE admin_users SET is_active = 1, status = 'active' WHERE id = $1", [id]);
  if (action === 'delete') await db.query('UPDATE admin_users SET deleted_at = now(), is_active = 0 WHERE id = $1', [id]);
  if (action === 'reset2fa') await db.query('UPDATE admin_users SET twofa_enabled = 0, twofa_secret = NULL, twofa_backup_codes = NULL WHERE id = $1', [id]);
  if (['role', 'disable', 'delete', 'reset2fa', 'reset'].includes(action)) await auth.bumpSessionVersion('admin_users', id);
  if (action === 'reset') {
    const temp = crypto.randomBytes(8).toString('base64url');
    await db.query('UPDATE admin_users SET password = $1, must_change_password = 1 WHERE id = $2', [await auth.hashPassword(temp), id]);
    flash(req, 'info', res.locals.t('अस्थायी पासवर्ड: ', 'Temporary password: ') + temp);
  }
  await auth.audit(req, 'user_' + action, 'admin_users', id, `Admin user ${action}`);
  res.redirect('/admin/users');
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
  res.render('admin/notifications', { title: res.locals.t('सूचना पठाइएको विवरण', 'Notifications'), rows, pg, subs });
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
  const members = await db.many('SELECT id FROM members WHERE is_active = 1 AND deleted_at IS NULL');
  for (const m of members) await db.query(`INSERT INTO member_notifications (member_id, title, message, type, link, is_read, created_at) VALUES ($1, $2, $3, 'broadcast', $4, 0, now())`, [m.id, title, body || null, url]);
  const r = await push.sendToAll({ title, body, url });
  await auth.audit(req, 'broadcast', 'member_notifications', null, `Broadcast "${title}" → ${members.length} members, push ${r.sent} sent / ${r.failed} failed`);
  flash(req, 'success', res.locals.t(`${members.length} सदस्यलाई सूचना, push ${r.sent} पठाइयो।`, `Notified ${members.length} members; ${r.sent} push messages sent.`));
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
  res.render('admin/twofa', { title: res.locals.t('दुई-चरण प्रमाणीकरण', 'Two-factor authentication'), user, qr, secret, remaining, codes: null, error: null });
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
  res.render('admin/license', { title: res.locals.t('वेबसाइट सेवा नवीकरण', 'Website licence'), notices });
}));
router.post('/license', requireAdmin('admin'), ah(async (req, res) => {
  const b = req.body;
  const txn = String(b.txn_reference || '').trim().slice(0, 120);
  if (!txn) { flash(req, 'error', res.locals.t('कारोबार नम्बर चाहिन्छ।', 'Transaction reference is required.')); return res.redirect('/admin/license'); }
  await db.query(`INSERT INTO site_license_renewal_notices (status, gateway, txn_reference, amount_reported, note, submitted_by_admin_id, submitted_by_username, created_at) VALUES ('pending', $1, $2, $3, $4, $5, $6, now())`,
    [['esewa', 'khalti', 'bank', 'cash', 'other'].includes(b.gateway) ? b.gateway : 'other', txn, String(b.amount || '').slice(0, 40), String(b.note || '').slice(0, 1000) || null, req.admin.id, req.admin.username]);
  await auth.audit(req, 'license_notice', 'site_license_renewal_notices', null, `Renewal notice ${txn}`);
  flash(req, 'success', res.locals.t('भुक्तानी सूचना पठाइयो। प्लेटफर्मले प्रमाणित गरेपछि म्याद थपिनेछ।', 'Payment notice sent. The licence is extended once the platform verifies it.'));
  res.redirect('/admin/license');
}));

// ---------------------------------------------------------------- audit log
router.get('/audit', requireAdmin('admin'), ah(async (req, res) => {
  const total = await db.value('SELECT count(*) FROM audit_log');
  const pg = util.paginate(total, util.int(req.query.page, 1), 50);
  const rows = await db.many(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`);
  res.render('admin/audit', { title: res.locals.t('अडिट लग', 'Audit log'), rows, pg });
}));

module.exports = router;
