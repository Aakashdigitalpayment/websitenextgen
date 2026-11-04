'use strict';
/**
 * Admin application inboxes (one per module in src/modules/applications.js): list with filters,
 * quick status, bulk actions, detail with office reply attachment and internal note, bank-style
 * print form, CSV export (single record + filtered list), KYM tools (member link, profile edit,
 * risk review cycle), membership approval with a Member ID, per-programme honour categories.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const forms = require('../lib/forms');
const kym = require('../lib/kym');
const pii = require('../lib/pii-crypto');
const modules = require('../modules/applications');
const { upload, remove, sendStored } = require('../lib/uploads');
const { flash } = require('../lib/security');
const notify = require('../lib/notify');
const settings = require('../lib/settings');
const exportsLib = require('../lib/application-export');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const { requireAdmin } = auth;
const ADMIN = auth.roleLevel('admin');

/** Staff+ for inboxes; kyc / loan / digital / account / grievance / job are admin+ (admin/print-form.php:26). */
function getModule(req, res, next) {
  const m = Object.hasOwn(modules, req.params.module) ? modules[req.params.module] : null;
  if (!m) return next('route');
  const need = m.adminOnly ? 'admin' : 'staff';
  if (auth.roleLevel(req.admin.role) < auth.roleLevel(need)) return res.status(403).render('admin/denied', { title: 'Access denied' });
  req.mod = m;
  next();
}
const back = (req, fallback) => {
  const r = String(req.body._back || '');
  return /^\/admin\/inbox\/[a-z]+(\?[^\s]*)?$/.test(r) ? r : fallback;
};

async function inboxQuery(req, m) {
  const cols = await db.columns(m.table);
  const where = [], params = [];
  if (cols.has('deleted_at')) where.push('deleted_at IS NULL');
  const status = String(req.query.status || '');
  if (status && cols.has('status')) { params.push(status); where.push(`status = $${params.length}`); }
  const q = String(req.query.q || '').trim().slice(0, 200);
  if (q) {
    params.push('%' + q + '%');
    const search = [m.nameCol, m.phoneCol, 'email', 'tracking_id', m.memberCol, 'full_name_en', 'national_id_number'].filter((c, i, a) => c && cols.has(c) && a.indexOf(c) === i);
    const conds = search.map(c => `${c}::text ILIKE $${params.length}`);
    // exact match on the encrypted citizenship number (deterministic encryption)
    if (cols.has('citizenship_no')) { params.push(q); params.push(pii.encrypt(q, db.currentSchema())); conds.push(`citizenship_no = $${params.length - 1}`, `citizenship_no = $${params.length}`); }
    where.push('(' + conds.join(' OR ') + ')');
  }
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
  if (isDate(req.query.from)) { params.push(req.query.from); where.push(`created_at >= $${params.length}::date`); }
  if (isDate(req.query.to)) { params.push(req.query.to); where.push(`created_at < $${params.length}::date + 1`); }
  if (m.key === 'job' && util.int(req.query.career)) { params.push(util.int(req.query.career)); where.push(`career_id = $${params.length}`); }
  if (cols.has('is_read') && req.query.unread === '1') where.push('is_read = 0');
  if (m.key === 'kyc' && ['low', 'medium', 'high'].includes(req.query.risk)) { params.push(req.query.risk); where.push(`risk_category = $${params.length}`); }
  return { w: where.length ? 'WHERE ' + where.join(' AND ') : '', params, cols, status, q };
}

// ---------------------------------------------------------------- list
router.get('/inbox/:module', getModule, ah(async (req, res) => {
  const m = req.mod;
  const { w, params, cols, status, q } = await inboxQuery(req, m);
  const total = await db.value(`SELECT count(*) FROM ${m.table} ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 25);
  const rows = await db.many(`SELECT * FROM ${m.table} ${w} ORDER BY created_at DESC NULLS LAST, id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  const statuses = cols.has('status') && !m.noStatus ? await forms.statusesFor(m.table) : [];
  const options = await forms.resolveOptions(m);
  const careers = m.key === 'job' ? await db.many('SELECT id, title, title_np FROM careers WHERE deleted_at IS NULL ORDER BY id DESC LIMIT 200') : [];
  res.render('admin/inbox-list', { title: res.locals.t(...m.title), m, rows, pg, statuses, status, q, options, hasRead: cols.has('is_read'), careers, canDelete: auth.roleLevel(req.admin.role) >= ADMIN });
}));

router.get('/inbox/:module/export.csv', getModule, ah(async (req, res) => {
  const m = req.mod;
  const { w, params } = await inboxQuery(req, m);
  const rows = await db.many(`SELECT * FROM ${m.table} ${w} ORDER BY created_at DESC NULLS LAST LIMIT 10000`, params);
  const { header, values } = await exportsLib.table(m, rows);
  await auth.audit(req, 'export', m.table, null, `CSV export (${rows.length} rows)`);
  res.type('text/csv; charset=utf-8').attachment(`${m.key}-${new Date().toISOString().slice(0, 10)}.csv`).send('﻿' + util.toCsv(header, values));
}));

/** Bulk: set status / mark read / unread / delete for the ticked rows. */
router.post('/inbox/:module/bulk', getModule, ah(async (req, res) => {
  const m = req.mod;
  const ids = [].concat(req.body.ids || []).map(x => util.int(x)).filter(Boolean).slice(0, 500);
  const action = String(req.body.action || '');
  const to = back(req, `/admin/inbox/${m.key}`);
  if (!ids.length || !action) { flash(req, 'error', res.locals.t('पङ्क्ति र कारबाही छान्नुहोस्।', 'Choose rows and an action.')); return res.redirect(to); }
  const cols = await db.columns(m.table);
  let done = 0;
  if (action === 'read' || action === 'unread') {
    if (!cols.has('is_read')) return res.redirect(to);
    done = (await db.query(`UPDATE ${m.table} SET is_read = $1 WHERE id = ANY($2)`, [action === 'read' ? 1 : 0, ids])).rowCount;
  } else if (action === 'delete') {
    if (auth.roleLevel(req.admin.role) < ADMIN) return res.status(403).render('admin/denied', { title: 'Access denied' });
    done = cols.has('deleted_at')
      ? (await db.query(`UPDATE ${m.table} SET deleted_at = now() WHERE id = ANY($1) AND deleted_at IS NULL`, [ids])).rowCount
      : (await db.query(`DELETE FROM ${m.table} WHERE id = ANY($1)`, [ids])).rowCount;
    await auth.audit(req, 'delete', m.table, null, `Bulk delete ${done} × ${m.title[1]}`);
  } else if (action.startsWith('status:')) {
    const status = action.slice(7);
    const statuses = await forms.statusesFor(m.table);
    if (!statuses.includes(status) || (m.key === 'membership' && status === 'approved')) { flash(req, 'error', res.locals.t('यो स्थिति यहाँबाट मिल्दैन।', 'That status cannot be set here.')); return res.redirect(to); }
    for (const id of ids) {
      const row = await db.one(`SELECT * FROM ${m.table} WHERE id = $1`, [id]);
      if (!row || row.status === status) continue;
      const r = await changeStatus(req, m, row, { status, comment: '', notifyApplicant: false });
      if (!r.error) done++;
    }
  } else return res.redirect(to);
  flash(req, 'success', res.locals.t(`${done} वटा अद्यावधिक भयो।`, `${done} updated.`));
  res.redirect(to);
}));

// ---------------------------------------------------------------- detail / print / single export
async function loadRow(m, id) {
  return db.one(`SELECT * FROM ${m.table} WHERE id = $1`, [util.int(id)]);
}

router.get('/inbox/:module/:id', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await loadRow(m, req.params.id);
  if (!row) return next();
  const cols = await db.columns(m.table);
  if (cols.has('is_read') && !row.is_read) await db.query(`UPDATE ${m.table} SET is_read = 1 WHERE id = $1`, [row.id]);
  const history = await db.many('SELECT * FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at DESC', [m.key, row.id]);
  const statuses = cols.has('status') && !m.noStatus ? await forms.statusesFor(m.table) : [];
  const options = await forms.resolveOptions(m);
  const extra = {};
  if (m.key === 'kyc') {
    extra.linkedMember = row.member_id ? await kym.findMemberBySadasyata(row.member_id) : null;
    extra.hasMonthlySaving = (await db.columns('members')).has('monthly_saving_regular');
  }
  if (m.key === 'membership' && row.member_pk) extra.linkedMember = await db.one('SELECT id, name, sadasyata_number FROM members WHERE id = $1', [row.member_pk]);
  res.render('admin/inbox-view', { title: res.locals.t(...m.title), m, row, history, statuses, options, hasRemarks: cols.has(m.remarksCol), hasRead: cols.has('is_read'),
    display: forms.displayData(m, row), attachCol: m.attachCol && cols.has(m.attachCol) ? m.attachCol : null, noteCol: m.noteCol && cols.has(m.noteCol) ? m.noteCol : null, ...extra });
}));

router.get('/inbox/:module/:id/print', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await loadRow(m, req.params.id);
  if (!row) return next();
  const options = await forms.resolveOptions(m);
  await auth.audit(req, 'print', m.table, row.id, `Print ${m.title[1]} #${row.id}`);
  res.render('admin/inbox-print', { layout: false, m, row, options, display: forms.displayData(m, row), s: await settings.all(), autoprint: req.query.autoprint === '1' });
}));

router.get('/inbox/:module/:id/export.csv', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await loadRow(m, req.params.id);
  if (!row) return next();
  const { header, values } = await exportsLib.table(m, [row]);
  await auth.audit(req, 'export', m.table, row.id, `CSV export of #${row.id}`);
  res.type('text/csv; charset=utf-8').attachment(`${m.key}-${row.id}-${new Date().toISOString().slice(0, 10)}.csv`).send('﻿' + util.toCsv(header, values));
}));

// ---------------------------------------------------------------- status change (shared by the form, quick select and bulk)
async function changeStatus(req, m, row, { status, comment = '', note, attachment, notifyApplicant = false, risk, memberId, approvedAmount } = {}) {
  const statuses = await forms.statusesFor(m.table);
  const cols = await db.columns(m.table);
  const data = {};
  if (statuses.includes(status)) data.status = status;
  if (cols.has(m.remarksCol) && comment) data[m.remarksCol] = comment;
  if (m.noteCol && note !== undefined && cols.has(m.noteCol)) data[m.noteCol] = note || null;
  if (m.attachCol && attachment && cols.has(m.attachCol)) data[m.attachCol] = attachment;
  if (cols.has('reviewed_by')) data.reviewed_by = cols.get('reviewed_by') === 'integer' ? req.admin.id : req.admin.username;
  if (cols.has('reviewed_at')) data.reviewed_at = new Date();
  if (cols.has('updated_at')) data.updated_at = new Date();
  if (m.key === 'grievance' && status === 'resolved') data.resolved_at = new Date();
  if (m.key === 'welfare' && approvedAmount) data.approved_amount = Number(nd.toLatinDigits(approvedAmount).replace(/,/g, '')) || null;
  if (m.key === 'membership' && data.status === 'approved' && row.status !== 'approved') delete data.status; // needs a Member ID: approve form
  if (m.key === 'kyc') {
    if (memberId !== undefined) {
      const id = kym.normalizeId(memberId);
      if (!id) return { error: ['Member ID खाली राख्न मिल्दैन।', 'Member ID cannot be empty.'] };
      const dup = await db.value(`SELECT id FROM kyc_applications WHERE upper(member_id) = $1 AND id <> $2 AND deleted_at IS NULL
                                  AND status IN ('pending','approved','incomplete','partial') LIMIT 1`, [id, row.id]);
      if (dup) return { error: ['यो Member ID अर्को active KYM मा प्रयोग भएको छ।', 'This Member ID is used by another active KYM.'] };
      data.member_id = id;
    }
    if (kym.REVIEW_YEARS[risk]) data.risk_category = risk;
  }
  await db.transaction(async () => {
    await db.update(m.table, row.id, await db.pick(m.table, data));
    await db.query(`INSERT INTO request_status_history (module, request_id, old_status, new_status, admin_comment, actor_admin_id, actor_name, created_at, notify_sent, admin_chose_to_notify)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, now(), 0, 0)`, [m.key, row.id, row.status || null, data.status || row.status || null, comment || null, req.admin.id, req.admin.full_name || req.admin.username]);
    const memberKey = (m.memberCol && row[m.memberCol]) || row[m.phoneCol];
    if (memberKey) {
      const member = await db.one('SELECT id FROM members WHERE deleted_at IS NULL AND (sadasyata_number = $1 OR member_card_no = $1 OR phone = $1) LIMIT 1', [String(memberKey)]);
      if (member) await notify.notifyMember(member.id, m.title[0] + ': ' + forms.statusLabel(data.status || row.status), comment || null, row.tracking_id ? '/track?id=' + encodeURIComponent(row.tracking_id) : null, 'status');
    }
  });
  const out = {};
  if (m.key === 'kyc') {
    // verified time + review due date, shared contact sync to members, ID card on approval when asked
    await kym.applyStatus(row.id, data.status || row.status, data.risk_category);
    await kym.afterKycWrite(row.id);
    if ((data.status || row.status) === 'approved') out.card = await kym.autoIssueIdCard(row.id, req.admin.id, req.tenant.slug);
  }
  if (data.status && data.status !== row.status) {
    notify.later(() => require('../lib/webhooks').emit('application.status_changed', { type: m.key, id: row.id, tracking_id: row.tracking_id || null, status: data.status, previous_status: row.status || null, remarks: comment || null, changed_by: req.admin.username }));
  }
  if (notifyApplicant && data.status && data.status !== row.status && row.tracking_id) {
    notify.later(() => notify.applicationEvent('status_changed', { name: row[m.nameCol], tracking_id: row.tracking_id, module: m.title[0], status: forms.statusLabel(data.status), remarks: comment }, { phone: row[m.phoneCol], email: row.email }, m));
    await db.query('UPDATE request_status_history SET admin_chose_to_notify = 1, notify_sent = 1 WHERE id = (SELECT max(id) FROM request_status_history WHERE module = $1 AND request_id = $2)', [m.key, row.id]);
  }
  await auth.audit(req, 'status', m.table, row.id, `${row.status} → ${data.status || row.status}`, { old: { status: row.status }, new: { ...data, [m.attachCol || '_']: undefined } });
  return out;
}

/** The status form is multipart when the module takes an office reply attachment. */
function statusUpload(req, res, next) {
  if (!req.mod.attachCol || !req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload('office-replies', [{ name: 'admin_attachment', kind: 'any' }], { private: true });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}

router.post('/inbox/:module/:id/status', getModule, statusUpload, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await loadRow(m, req.params.id);
  if (!row) return next();
  const quick = req.body.quick === '1';
  const to = quick ? back(req, `/admin/inbox/${m.key}`) : `/admin/inbox/${m.key}/${row.id}`;
  if (req.uploadError) { flash(req, 'error', req.uploadError); return res.redirect(to); }
  const comment = String(req.body.comment ?? '').trim().slice(0, 2000);
  const r = await changeStatus(req, m, row, {
    status: String(req.body.status || ''),
    comment: quick ? '' : comment,
    note: quick || req.body.admin_note === undefined ? undefined : String(req.body.admin_note).trim().slice(0, 5000),
    attachment: req.uploaded?.admin_attachment,
    notifyApplicant: req.body.notify === '1',
    risk: req.body.risk_category,
    memberId: m.key === 'kyc' && !quick && req.body.member_id !== undefined ? req.body.member_id : undefined,
    approvedAmount: req.body.approved_amount,
  });
  if (r.error) { flash(req, 'error', res.locals.t(...r.error)); return res.redirect(to); }
  if (req.uploaded?.admin_attachment && row[m.attachCol] && row[m.attachCol] !== req.uploaded.admin_attachment) remove(req, row[m.attachCol]);
  let msg = res.locals.t('स्थिति अद्यावधिक भयो।', 'Status updated.');
  if (r.card) msg += ' ' + res.locals.t(`डिजिटल परिचयपत्र जारी भयो (कोड ${r.card.card.code}, CVV ${r.card.card.cvv})।`, `Digital ID card issued (code ${r.card.card.code}, CVV ${r.card.card.cvv}).`);
  flash(req, 'success', msg);
  res.redirect(to);
}));

router.post('/inbox/:module/:id/attachment/remove', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const row = await loadRow(m, req.params.id);
  if (!row || !m.attachCol) return next();
  if (row[m.attachCol]) {
    await db.query(`UPDATE ${m.table} SET ${db.ident(m.attachCol)} = NULL WHERE id = $1`, [row.id]);
    remove(req, row[m.attachCol]);
    await auth.audit(req, 'update', m.table, row.id, 'Office reply attachment removed');
  }
  flash(req, 'success', res.locals.t('संलग्न फाइल हटाइयो।', 'Attachment removed.'));
  res.redirect(`/admin/inbox/${m.key}/${row.id}`);
}));

router.post('/inbox/:module/:id/read', getModule, ah(async (req, res, next) => {
  const m = req.mod;
  const cols = await db.columns(m.table);
  if (!cols.has('is_read')) return next();
  await db.query(`UPDATE ${m.table} SET is_read = $1 WHERE id = $2`, [req.body.read === '0' ? 0 : 1, util.int(req.params.id)]);
  res.redirect(back(req, `/admin/inbox/${m.key}`));
}));

router.post('/inbox/:module/:id/delete', getModule, ah(async (req, res) => {
  const m = req.mod;
  if (auth.roleLevel(req.admin.role) < ADMIN) return res.status(403).render('admin/denied', { title: 'Access denied' });
  const cols = await db.columns(m.table);
  const id = util.int(req.params.id);
  if (cols.has('deleted_at')) await db.query(`UPDATE ${m.table} SET deleted_at = now() WHERE id = $1`, [id]);
  else await db.query(`DELETE FROM ${m.table} WHERE id = $1`, [id]);
  await auth.audit(req, 'delete', m.table, id, `${m.title[1]} #${id}`);
  flash(req, 'success', res.locals.t('हटाइयो।', 'Deleted.'));
  res.redirect(`/admin/inbox/${m.key}`);
}));

// ---------------------------------------------------------------- KYM: member link, profile correction
router.post('/inbox/kyc/:id/link-member', requireAdmin('admin'), ah(async (req, res, next) => {
  const row = await loadRow(modules.kyc, req.params.id);
  if (!row) return next();
  const r = await kym.upsertMemberFromKyc(row);
  if (r.ok) {
    await auth.audit(req, r.created ? 'create' : 'update', 'members', r.memberId, `Member ${r.created ? 'stub created' : 'linked'} from KYM #${row.id}`);
    flash(req, 'success', r.created ? res.locals.t('सदस्य stub बनाइयो (Member ID SSOT)। पोर्टल पासवर्ड सेट/स्वीकृत गर्नुहोस्।', 'Member stub created from this KYM. Set a portal password / approve the member.')
      : res.locals.t('अवस्थित सदस्य खातासँग KYM लिंक भयो।', 'KYM linked to the existing member account.'));
  } else flash(req, 'error', res.locals.t(...r.message));
  res.redirect(`/admin/inbox/kyc/${row.id}`);
}));

const PROFILE_FIELDS = ['full_name', 'full_name_en', 'mobile', 'email', 'permanent_address', 'temporary_address', 'gender', 'dob_bs', 'marital_status', 'nationality',
  'citizenship_no', 'citizenship_issued_date', 'citizenship_issued_place', 'national_id_number', 'father_name', 'mother_name', 'grandfather_name', 'spouse_name',
  'occupation', 'organization_name', 'monthly_income'];
router.post('/inbox/kyc/:id/profile', requireAdmin('admin'), ah(async (req, res, next) => {
  const row = await loadRow(modules.kyc, req.params.id);
  if (!row) return next();
  const b = req.body, data = {};
  for (const k of PROFILE_FIELDS) data[k] = String(b[k] ?? '').trim().slice(0, k.endsWith('address') ? 500 : 200) || null;
  if (!data.full_name) { flash(req, 'error', res.locals.t('पूरा नाम (नेपाली) अनिवार्य छ।', 'Full name (Nepali) is required.')); return res.redirect(`/admin/inbox/kyc/${row.id}#profile`); }
  data.mobile = kym.normalizeMobile(data.mobile) || null;
  data.email = data.email && util.isEmail(data.email) ? data.email.toLowerCase() : null;
  if (data.gender && !['male', 'female', 'other'].includes(data.gender)) data.gender = null;
  if (data.marital_status && !['single', 'married', 'divorced', 'widow', 'widowed'].includes(data.marital_status)) data.marital_status = null;
  data.dob_ad = data.dob_bs ? nd.bsToAd(nd.toLatinDigits(data.dob_bs)) : null;
  data.updated_at = new Date();
  await db.update('kyc_applications', row.id, await db.pick('kyc_applications', pii.encryptFields('kyc_applications', data, db.currentSchema())));
  const sync = await kym.afterKycWrite(row.id); // name / mobile / email / address / gender / dob → members
  // मासिक बचत lives on the linked member (SSOT): blank = unknown, 1 = regular, 0 = not regular
  if (sync?.memberId && ['', '0', '1'].includes(String(b.monthly_saving ?? 'x')) && (await db.columns('members')).has('monthly_saving_regular')) {
    await db.query('UPDATE members SET monthly_saving_regular = $1 WHERE id = $2', [b.monthly_saving === '' ? null : Number(b.monthly_saving), sync.memberId]);
  }
  await auth.audit(req, 'kyc_profile_update', 'kyc_applications', row.id, 'Admin updated KYM profile (synced to member): ' + data.full_name);
  flash(req, 'success', res.locals.t('KYM विवरण अपडेट भयो। नाम/मोबाइल/इमेल/ठेगाना सदस्यमा sync भयो।', 'KYM updated; name, mobile, email and address synced to the member.'));
  res.redirect(`/admin/inbox/kyc/${row.id}`);
}));

// ---------------------------------------------------------------- membership: approve with a Member ID (membershipApproveWithMemberId)
router.post('/inbox/membership/:id/approve', requireAdmin('staff'), ah(async (req, res, next) => {
  const app = await loadRow(modules.membership, req.params.id);
  if (!app) return next();
  const to = `/admin/inbox/membership/${app.id}`;
  const sid = kym.normalizeId(req.body.sadasyata);
  const remarks = String(req.body.comment || '').trim().slice(0, 2000);
  if (!sid) { flash(req, 'error', res.locals.t('Member ID (सदस्यता नं.) अनिवार्य छ।', 'A Member ID is required.')); return res.redirect(to); }
  if (app.status === 'approved' && app.member_pk) { flash(req, 'info', res.locals.t('पहिले नै स्वीकृत छ।', 'Already approved.')); return res.redirect(to); }
  if (await kym.findMemberBySadasyata(sid)) { flash(req, 'error', res.locals.t('यो Member ID पहिले नै सदस्य सूचीमा छ। अर्को नम्बर हाल्नुहोस्।', 'That Member ID is already on the members list. Use another number.')); return res.redirect(to); }
  const email = app.email && util.isEmail(app.email) ? app.email.toLowerCase() : null;
  const cardNo = `M-${new Date().getFullYear()}-${String(require('crypto').randomInt(1, 100000)).padStart(5, '0')}`;
  let memberPk;
  try {
    memberPk = await db.transaction(async () => {
      const mem = await db.one(`INSERT INTO members (name, email, phone, sadasyata_number, password_hash, member_card_no, address, approval_status, is_active, created_at, updated_at, created_by)
                                VALUES ($1, $2, $3, $4, NULL, $5, $6, 'pending', 1, now(), now(), $7) RETURNING id`,
        [app.full_name || 'Member ' + sid, email, kym.normalizeMobile(app.mobile) || null, sid, cardNo, app.address || null, req.admin.id]);
      await db.query(`UPDATE membership_applications SET status = 'approved', assigned_sadasyata = $1, member_pk = $2, admin_remarks = COALESCE($3, admin_remarks), reviewed_by = $4, reviewed_at = now(), updated_at = now() WHERE id = $5`,
        [sid, mem.id, remarks || null, req.admin.id, app.id]);
      await db.query(`INSERT INTO request_status_history (module, request_id, old_status, new_status, admin_comment, actor_admin_id, actor_name, created_at, notify_sent, admin_chose_to_notify)
                      VALUES ('membership', $1, $2, 'approved', $3, $4, $5, now(), 0, 0)`, [app.id, app.status, `Member ID ${sid}` + (remarks ? ' — ' + remarks : ''), req.admin.id, req.admin.full_name || req.admin.username]);
      return mem.id;
    });
  } catch (e) {
    if (e.code !== '23505') throw e;
    flash(req, 'error', res.locals.t('Member ID वा इमेल दोहोरो भयो।', 'Duplicate Member ID or email.'));
    return res.redirect(to);
  }
  await auth.audit(req, 'approve', 'membership_applications', app.id, `Approved with Member ID ${sid} → member #${memberPk}`);
  if (req.body.notify === '1' && app.tracking_id) {
    notify.later(() => notify.applicationEvent('status_changed', { name: app.full_name, tracking_id: app.tracking_id, module: modules.membership.title[0], status: forms.statusLabel('approved') + ' — Member ID ' + sid, remarks }, { phone: app.mobile, email: app.email }, modules.membership));
  }
  flash(req, 'success', res.locals.t(`स्वीकृत। Member ID ${sid} — सदस्य stub बन्यो। अब अनलाइन केवाइएम भर्न सकिन्छ।`, `Approved. Member ID ${sid} — member stub created; the applicant can now fill in the online KYM.`));
  res.redirect(to);
}));

// ---------------------------------------------------------------- KYC risk review cycle (admin/kyc-risk-reviews.php)
router.get('/kyc-risk-reviews', requireAdmin('staff'), ah(async (req, res) => {
  await kym.refreshReviewCycle();
  const filter = ['due', 'all', 'high'].includes(req.query.filter) ? req.query.filter : 'due';
  let where = "status = 'approved' AND deleted_at IS NULL";
  if (filter === 'due') where += " AND risk_review_status = 'due_review'";
  if (filter === 'high') where += " AND risk_category = 'high'";
  const rows = await db.many(`SELECT id, member_id, full_name, mobile, email, risk_category, kyc_verified_at, risk_review_due_at, risk_review_status
                              FROM kyc_applications WHERE ${where} ORDER BY (risk_review_status = 'due_review') DESC, risk_review_due_at ASC NULLS LAST, id DESC LIMIT 500`);
  const counts = await db.one(`SELECT count(*) FILTER (WHERE risk_review_status = 'due_review') AS due, count(*) FILTER (WHERE risk_category = 'high') AS high, count(*) AS all
                               FROM kyc_applications WHERE status = 'approved' AND deleted_at IS NULL`);
  res.render('admin/kyc-risk-reviews', { title: res.locals.t('KYC जोखिम पुनरावलोकन', 'KYC risk review'), rows, filter, counts });
}));
router.post('/kyc-risk-reviews/:id/reviewed', requireAdmin('admin'), ah(async (req, res) => {
  const id = util.int(req.params.id);
  await kym.markReviewed(id);
  await auth.audit(req, 'kyc_review', 'kyc_applications', id, 'KYC review cycle reset');
  flash(req, 'success', res.locals.t('KYC पुनरावलोकन चक्र रिसेट गरियो।', 'KYC review cycle reset.'));
  res.redirect('/admin/kyc-risk-reviews?filter=' + encodeURIComponent(String(req.body.filter || 'due')));
}));

// ---------------------------------------------------------------- honour programme categories (honor_program_categories)
router.get('/honor-programs/:id/categories', requireAdmin('editor'), ah(async (req, res, next) => {
  const program = await db.one('SELECT * FROM honor_programs WHERE id = $1', [util.int(req.params.id)]);
  if (!program) return next();
  const cats = await db.many(`SELECT c.*, (pc.program_id IS NOT NULL) AS on FROM honor_categories c
                              LEFT JOIN honor_program_categories pc ON pc.category_id = c.id AND pc.program_id = $1 ORDER BY c.display_order, c.id`, [program.id]);
  res.render('admin/honor-program-categories', { title: res.locals.t('कार्यक्रमका विधा', 'Programme categories'), program, cats });
}));
router.post('/honor-programs/:id/categories', requireAdmin('editor'), ah(async (req, res, next) => {
  const program = await db.one('SELECT id FROM honor_programs WHERE id = $1', [util.int(req.params.id)]);
  if (!program) return next();
  const ids = [].concat(req.body.category || []).map(x => util.int(x)).filter(Boolean);
  await db.transaction(async () => {
    await db.query('DELETE FROM honor_program_categories WHERE program_id = $1', [program.id]);
    for (const c of ids) await db.query('INSERT INTO honor_program_categories (program_id, category_id) SELECT $1, id FROM honor_categories WHERE id = $2 ON CONFLICT DO NOTHING', [program.id, c]);
  });
  await auth.audit(req, 'update', 'honor_program_categories', program.id, `${ids.length} categories`);
  flash(req, 'success', res.locals.t('सुरक्षित गरियो।', 'Saved.'));
  res.redirect('/admin/r/honor_programs');
}));

// confidential uploads (application documents, information room) — signed-in staff only
router.get('/files/*rest', requireAdmin('staff'), (req, res, next) => {
  const rest = [].concat(req.params.rest || []).join('/');
  if (!rest.startsWith('_private/')) return next();
  if (rest.startsWith('_private/information-room-items/') && auth.roleLevel(req.admin.role) < ADMIN) return res.status(403).end();
  sendStored(req, res, next, rest);
});

module.exports = router;
module.exports.changeStatus = changeStatus;
