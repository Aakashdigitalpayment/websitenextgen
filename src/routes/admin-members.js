'use strict';
/**
 * Admin: members (list / filters / export / archive), member view (activity timeline, notify, 2FA reset, ID card + unlock),
 * CSV import (full + monthly-saving field update), duplicate membership numbers, the member-portal queue
 * (registrations, profile changes, policy) and password reset requests.
 * PHP: admin/members.php, admin/member-online-portal.php, admin/member-activities.php, admin/member-import.php,
 *      admin/member-ssot-duplicates.php, admin/security-settings.php.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const settings = require('../lib/settings');
const notify = require('../lib/notify');
const memberImport = require('../lib/member-import');
const portal = require('../lib/member-portal');
const { upload } = require('../lib/uploads');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const { requireAdmin } = auth;
const memberById = id => db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [util.int(id)]);

// ---------------------------------------------------------------- list, filters, export, archive
function memberFilter(req) {
  const q = String(req.query.q || '').trim().slice(0, 100);
  const st = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : '';
  const ms = ['1', '0', 'unset'].includes(req.query.ms) ? req.query.ms : '';
  const view = req.query.view === 'arch' ? 'arch' : 'live';
  const where = [view === 'arch' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'], params = [];
  if (q) {
    params.push('%' + q + '%');
    const p = `$${params.length}`;
    where.push(`(name ILIKE ${p} OR name_np ILIKE ${p} OR phone ILIKE ${p} OR email ILIKE ${p} OR sadasyata_number ILIKE ${p} OR member_card_no ILIKE ${p})`);
  }
  if (st) { params.push(st); where.push(`approval_status = $${params.length}`); }
  if (ms === 'unset') where.push('monthly_saving_regular IS NULL');
  else if (ms) { params.push(Number(ms)); where.push(`monthly_saving_regular = $${params.length}`); }
  return { q, st, ms, view, w: 'WHERE ' + where.join(' AND '), params };
}

router.get('/members', requireAdmin('staff'), ah(async (req, res) => {
  const f = memberFilter(req);
  const total = await db.value(`SELECT count(*) FROM members ${f.w}`, f.params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 30);
  const rows = await db.many(`SELECT * FROM members ${f.w} ORDER BY ${f.view === 'arch' ? 'deleted_at DESC' : 'id DESC'} LIMIT ${pg.perPage} OFFSET ${pg.offset}`, f.params);
  const counts = await db.one('SELECT count(*) FILTER (WHERE deleted_at IS NULL) AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL) AS arch FROM members');
  const qs = new URLSearchParams(Object.entries({ q: f.q, status: f.st, ms: f.ms, view: f.view === 'arch' ? 'arch' : '' }).filter(([, v]) => v)).toString();
  res.render('admin/members', { title: res.locals.t('सदस्यहरू', 'Members'), rows, pg, q: f.q, st: f.st, ms: f.ms, view: f.view, counts, qs });
}));

const EXPORT_COLS = [
  ['Member ID', r => r.sadasyata_number], ['Name (English)', r => r.name], ['नाम (नेपाली)', r => r.name_np], ['Mobile', r => r.phone], ['Email', r => r.email],
  ['Address', r => r.address], ['DOB (AD)', r => (r.dob ? String(r.dob).slice(0, 10) : '')], ['जन्म मिति (बि.सं.)', r => (r.dob ? nd.adToBs(String(r.dob).slice(0, 10)) || '' : '')],
  ['Gender', r => r.gender], ['मासिक बचत', r => portal.msLabel(portal.msFromDb(r.monthly_saving_regular))], ['Card no.', r => r.member_card_no],
  ['KYM linked', r => (r.kyc_application_id ? 'Yes' : 'No')], ['Portal login', r => (r.password_hash ? 'Yes' : 'No')], ['2FA', r => (Number(r.twofa_enabled) ? 'Yes' : 'No')],
  ['Status', r => (Number(r.is_active) ? 'Active' : 'Inactive')], ['Approval', r => r.approval_status], ['Created at', r => (r.created_at ? new Date(r.created_at).toISOString().slice(0, 19).replace('T', ' ') : '')],
  ['Archived at', r => (r.deleted_at ? new Date(r.deleted_at).toISOString().slice(0, 19).replace('T', ' ') : '')],
];
const xmlEsc = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** Excel 2003 XML workbook — opens in Excel / LibreOffice without a spreadsheet library; every cell is text (no formulas). */
const spreadsheetXml = (sheet, header, rows) => `<?xml version="1.0" encoding="UTF-8"?>\n<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="h"><Font ss:Bold="1"/></Style></Styles>
<Worksheet ss:Name="${xmlEsc(sheet)}"><Table>
<Row>${header.map(h => `<Cell ss:StyleID="h"><Data ss:Type="String">${xmlEsc(h)}</Data></Cell>`).join('')}</Row>
${rows.map(r => `<Row>${r.map(v => `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`).join('')}</Row>`).join('\n')}
</Table></Worksheet></Workbook>`;

router.get('/members/export', requireAdmin('admin'), ah(async (req, res) => {
  const f = memberFilter(req);
  const rows = await db.many(`SELECT * FROM members ${f.w} ORDER BY id LIMIT 60000`, f.params);
  const format = req.query.format === 'xls' ? 'xls' : 'csv';
  await auth.audit(req, 'export', 'members', null, `Members ${format.toUpperCase()} export (${rows.length} rows, ${f.view})`);
  const name = `members-${f.view === 'arch' ? 'archived' : 'active'}-${new Date().toISOString().slice(0, 10)}`;
  const header = EXPORT_COLS.map(c => c[0]);
  const data = rows.map(r => EXPORT_COLS.map(c => c[1](r) ?? ''));
  if (format === 'xls') return res.type('application/vnd.ms-excel; charset=utf-8').attachment(name + '.xls').send(spreadsheetXml('Members', header, data));
  res.type('text/csv; charset=utf-8').attachment(name + '.csv').send(util.toCsv(header, data.map(r => Object.fromEntries(r.map((v, i) => [header[i], v])))));
}));

router.post('/members/:id/restore', requireAdmin('admin'), ah(async (req, res) => {
  const m = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NOT NULL', [util.int(req.params.id)]);
  if (!m) return res.redirect('/admin/members?view=arch');
  if (m.sadasyata_number && await portal.sadasyataTaken(m.sadasyata_number, m.id)) {
    flash(req, 'error', res.locals.t('यो सदस्यता नम्बर अर्को सक्रिय सदस्यमा छ — पहिले मिलाउनुहोस्।', 'Another active member already has this membership number — fix that first.'));
    return res.redirect('/admin/members?view=arch');
  }
  try { await db.query('UPDATE members SET deleted_at = NULL, is_active = 1 WHERE id = $1', [m.id]); } catch (e) {
    if (e.code !== '23505') throw e;
    flash(req, 'error', res.locals.t('यो सदस्यता नम्बर / इमेल अर्को सदस्यमा छ।', 'The membership number or email is used by another member.'));
    return res.redirect('/admin/members?view=arch');
  }
  await auth.audit(req, 'restore', 'members', m.id, 'Member restored from archive');
  flash(req, 'success', res.locals.t('सदस्य पुनर्स्थापित भयो।', 'Member restored.'));
  res.redirect('/admin/members/' + m.id);
}));

// ---------------------------------------------------------------- duplicate membership numbers + UNIQUE guard
router.get('/members/duplicates', requireAdmin('admin'), ah(async (req, res) => {
  const [dups, empty, guard] = await Promise.all([
    portal.duplicateReport(),
    db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND trim(COALESCE(sadasyata_number, '')) = ''"),
    portal.uniqueGuardExists(),
  ]);
  res.render('admin/member-duplicates', { title: res.locals.t('दोहोरो सदस्यता नम्बर', 'Duplicate member IDs'), dups, empty, guard });
}));
router.post('/members/duplicates/guard', requireAdmin('admin'), ah(async (req, res) => {
  const r = await portal.tryUniqueGuard();
  if (r.ok) await auth.audit(req, 'unique_guard', 'members', null, 'Membership-number UNIQUE guard');
  flash(req, r.ok ? 'success' : 'error', res.locals.t(...r.message));
  res.redirect('/admin/members/duplicates');
}));

// ---------------------------------------------------------------- CSV import (full + field update)
const importJobs = () => db.many('SELECT * FROM member_import_jobs ORDER BY id DESC LIMIT 20');
const renderImport = async (req, res, extra = {}, status = 200) => res.status(status).render('admin/member-import', {
  title: res.locals.t('सदस्य CSV आयात', 'Import members (CSV)'), jobs: await importJobs(), error: null, fu: req.session.fieldUpdate || null, ...extra,
});
router.get('/members/import', requireAdmin('admin'), ah((req, res) => renderImport(req, res)));
router.get('/members/import/sample.csv', requireAdmin('admin'), (req, res) => res.type('text/csv; charset=utf-8').attachment('members-sample.csv').send(memberImport.SAMPLE));
router.get('/members/import/field-sample.csv', requireAdmin('admin'), (req, res) => res.type('text/csv; charset=utf-8').attachment('monthly-saving-update-sample.csv')
  .send('﻿member_id,monthly_saving\nA-1001,नियमित\nA-1002,नियमित नभएको\nA-1003,1\n'));

function csvUpload(field) {
  return (req, res, next) => {
    const [mw, csrf] = upload('imports', [{ name: field, kind: 'doc' }], { maxMb: 20 });
    mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
  };
}
function readUploaded(req, stored) {
  const file = path.join(require('../lib/uploads').tenantDir(req), stored);
  try { return fs.readFileSync(file); } finally { fs.rm(file, { force: true }, () => {}); }
}

router.post('/members/import', requireAdmin('admin'), csvUpload('csv'), ah(async (req, res) => {
  const stored = req.uploaded && req.uploaded.csv;
  if (req.uploadError || !stored || !/\.csv$/i.test(stored)) return renderImport(req, res, { error: req.uploadError || res.locals.t('.csv फाइल छान्नुहोस्', 'Choose a .csv file') }, 422);
  try {
    const job = await memberImport.stage(readUploaded(req, stored), req.body.original_name || stored.split('/').pop(), req.admin.id, req.body.mode === 'skip' ? 'skip' : 'update');
    await auth.audit(req, 'import_stage', 'member_import_jobs', job.id, `CSV staged: ${job.valid} valid, ${job.invalid} invalid`);
    res.redirect('/admin/members/import/' + job.id);
  } catch (e) { return renderImport(req, res, { error: e.message }, 422); }
}));

// field-only update: member_id + monthly_saving (never creates members, never touches other fields)
router.post('/members/import/field-update', requireAdmin('admin'), csvUpload('fu_file'), ah(async (req, res) => {
  const stored = req.uploaded && req.uploaded.fu_file;
  if (req.uploadError || !stored || !/\.csv$/i.test(stored)) return renderImport(req, res, { error: req.uploadError || res.locals.t('Excel लाई CSV UTF-8 (.csv) मा Save गरेर मात्र upload गर्नुहोस्।', 'Save the sheet as CSV UTF-8 (.csv) and upload that.') }, 422);
  const r = await portal.monthlySavingFieldUpdate(memberImport.parseCsv(readUploaded(req, stored).toString('utf8')));
  if (!r.ok) { delete req.session.fieldUpdate; return renderImport(req, res, { error: r.error }, 422); }
  await auth.audit(req, 'member_monthly_saving_import', 'members', null, `मासिक बचत field update: ${r.changed} changed, ${r.unchanged} unchanged, ${r.not_found} not found, ${r.invalid} invalid`);
  req.session.fieldUpdate = { ...r, problems: r.problems.slice(0, 500), at: Date.now() };
  flash(req, 'success', res.locals.t(`मासिक बचत अपडेट: ${r.changed} परिवर्तन, ${r.unchanged} उस्तै, ${r.not_found} भेटिएन, ${r.invalid} गलत`, `Monthly saving update: ${r.changed} changed, ${r.unchanged} unchanged, ${r.not_found} not found, ${r.invalid} invalid`));
  res.redirect('/admin/members/import#field-update');
}));
router.get('/members/import/field-update/problems.csv', requireAdmin('admin'), (req, res) => {
  const probs = (req.session.fieldUpdate && req.session.fieldUpdate.problems) || [];
  res.type('text/csv; charset=utf-8').attachment('monthly-saving-update-problems.csv')
    .send(util.toCsv(['row', 'member_id', 'monthly_saving', 'reason'], probs.map(([row, member_id, monthly_saving, reason]) => ({ row, member_id, monthly_saving, reason }))));
});

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

// ---------------------------------------------------------------- create / view / edit
const MEMBER_FIELDS = ['name', 'name_np', 'email', 'phone', 'sadasyata_number', 'member_card_no', 'address', 'dob', 'gender', 'approval_status', 'is_active', 'information_room_enabled'];

async function memberView(item) {
  const [cards, accounts, docs, timeline, changes, resets] = await Promise.all([
    db.many('SELECT * FROM member_id_cards WHERE member_id IN ($1, $2, $3) ORDER BY id DESC', [String(item.id), item.sadasyata_number || '-', item.member_card_no || '-']),
    db.many('SELECT * FROM member_accounts WHERE member_id = $1 ORDER BY kind, account_no', [item.id]),
    db.many('SELECT id, title, doc_type, file_path, source, visible_to_member, created_at FROM member_documents WHERE member_id = $1 ORDER BY created_at DESC', [item.id]),
    portal.activities(item),
    db.many("SELECT * FROM member_profile_change_requests WHERE member_id = $1 AND status = 'pending' ORDER BY id DESC", [item.id]),
    db.many("SELECT * FROM member_password_reset_requests WHERE member_id = $1 AND status = 'pending' ORDER BY id DESC", [item.id]),
  ]);
  return { cards, accounts, docs, timeline: timeline.slice(0, 15), timelineTotal: timeline.length, changes, resets };
}
const renderMemberForm = async (res, item, values, errors = {}, status = 200) => res.status(status).render('admin/member-form', {
  title: item ? item.name_np || item.name : res.locals.t('नयाँ सदस्य', 'New member'), item, values, errors,
  ...(item ? await memberView(item) : { cards: [] }),
});

router.get('/members/new', requireAdmin('staff'), ah((req, res) => renderMemberForm(res, null, { approval_status: 'approved', is_active: 1 })));
router.get('/members/:id', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await memberById(req.params.id);
  if (!item) return next();
  await renderMemberForm(res, item, item);
}));

async function saveMember(req, res, item) {
  const b = req.body, errors = {}, t = res.locals.t;
  const data = {};
  for (const k of MEMBER_FIELDS) data[k] = typeof b[k] === 'string' ? b[k].trim() || null : null;
  data.is_active = b.is_active ? 1 : 0;
  data.information_room_enabled = b.information_room_enabled ? 1 : 0;
  data.sadasyata_number = data.sadasyata_number ? portal.normalizeId(data.sadasyata_number) : '';
  data.name_np = data.name_np || '';
  if (data.email) data.email = data.email.toLowerCase();
  if (!data.name) errors.name = 'आवश्यक छ / required';
  if (data.email && !util.isEmail(data.email)) errors.email = 'Invalid email';
  if (data.phone) data.phone = nd.toLatinDigits(data.phone);
  if (!['pending', 'approved', 'rejected'].includes(data.approval_status)) data.approval_status = 'pending';
  if (Object.hasOwn(b, 'monthly_saving')) {
    const ms = portal.parseMonthlySaving(b.monthly_saving);
    if (ms.ok) data.monthly_saving_regular = ms.value;
  }
  const reason = String(b.rejection_reason || '').trim().slice(0, 500);
  // one membership number per live member (member-ssot UNIQUE guard)
  if (data.sadasyata_number && await portal.sadasyataTaken(data.sadasyata_number, item?.id)) errors.sadasyata_number = t('यो सदस्यता नम्बर अर्को सदस्यमा छ', 'Another member already has this membership number');
  const pw = String(b.password || '');
  if (pw && pw.length < 8) errors.password = 'कम्तीमा ८ अक्षर / min 8 characters';
  if (Object.keys(errors).length) return renderMemberForm(res, item, { ...item, ...b }, errors, 422);
  if (pw) { data.password_hash = await auth.hashPassword(pw); data.must_change_password = 1; }
  const becameApproved = data.approval_status === 'approved' && (!item || item.approval_status !== 'approved');
  const becameRejected = item && data.approval_status === 'rejected' && item.approval_status !== 'rejected';
  if (becameApproved) { data.approved_at = new Date(); data.approved_by = req.admin.id; }
  try {
    const row = item ? await db.update('members', item.id, data) : await db.insert('members', { ...data, created_by: req.admin.id, is_verified: 1 });
    if (item && (pw || !data.is_active)) await auth.bumpSessionVersion('members', item.id);
    // status changes made on the edit form notify the member like the approval queue does
    if (item && becameApproved) await portal.approve(item.id, req.admin.id, req);
    if (becameRejected) await portal.reject(item.id, reason, req.admin.id);
    if (item && portal.msFromDb(item.monthly_saving_regular) !== portal.msFromDb(row.monthly_saving_regular)) {
      await auth.audit(req, 'member_monthly_saving', 'members', row.id, `मासिक बचत: ${portal.msLabel(portal.msFromDb(item.monthly_saving_regular))} → ${portal.msLabel(portal.msFromDb(row.monthly_saving_regular))} (Members edit)`);
    }
    notify.later(() => require('../lib/webhooks').emit(item ? 'member.updated' : 'member.created', { id: row.id, member_no: row.sadasyata_number || null, name: row.name, name_np: row.name_np || null, phone: row.phone || null, email: row.email || null, active: !!Number(row.is_active), approval_status: row.approval_status, changed_by: req.admin.username }));
    await auth.audit(req, item ? 'update' : 'create', 'members', row.id, `Member ${row.name}`);
    flash(req, 'success', t('सदस्य विवरण सुरक्षित भयो।', 'Member saved.'));
    res.redirect('/admin/members/' + row.id);
  } catch (e) {
    if (e.code === '23505') return renderMemberForm(res, item, { ...item, ...b }, /sadasyata/.test(e.constraint || '') ? { sadasyata_number: t('यो सदस्यता नम्बर अर्को सदस्यमा छ', 'Another member already has this membership number') } : { email: t('यो इमेल पहिले नै छ', 'Email already used') }, 422);
    throw e;
  }
}
router.post('/members', requireAdmin('staff'), ah((req, res) => saveMember(req, res, null)));
router.post('/members/:id', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await memberById(req.params.id);
  if (!item) return next();
  await saveMember(req, res, item);
}));

// ---------------------------------------------------------------- activity timeline + CSV
const dateQ = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '');
router.get('/members/:id/activities', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await memberById(req.params.id);
  if (!item) return next();
  const from = dateQ(req.query.from), to = dateQ(req.query.to);
  const rows = await portal.activities(item, { from, to });
  res.render('admin/member-activities', { title: res.locals.t('सदस्य गतिविधि', 'Member activity'), item, rows, from, to });
}));
router.get('/members/:id/activities.csv', requireAdmin('staff'), ah(async (req, res, next) => {
  const item = await memberById(req.params.id);
  if (!item) return next();
  const from = dateQ(req.query.from), to = dateQ(req.query.to);
  const rows = await portal.activities(item, { from, to });
  await auth.audit(req, 'export', 'members', item.id, `Member activity CSV (${rows.length} rows)`);
  const head = [['Member', item.name], ['Member ID', item.id], ['Membership No', item.sadasyata_number || ''], ['Date From', from], ['Date To', to], []]
    .map(r => r.map(util.csvCell).join(',')).join('\r\n');
  const cols = ['Timeline Date', 'Activity Type', 'Status', 'Detail'];
  const body = util.toCsv(cols, rows.map(r => ({ [cols[0]]: r.date ? new Date(r.date).toISOString().slice(0, 19).replace('T', ' ') : '', [cols[1]]: r.type[1], [cols[2]]: r.status, [cols[3]]: r.detail }))).replace(/^﻿/, '');
  res.type('text/csv; charset=utf-8').attachment(`member-activities-${item.id}-${new Date().toISOString().slice(0, 10)}.csv`).send('﻿' + head + '\r\n' + body);
}));

// ---------------------------------------------------------------- notify one member (admin/members.php send_notif)
router.post('/members/:id/notify', requireAdmin('staff'), ah(async (req, res, next) => {
  const m = await memberById(req.params.id);
  if (!m) return next();
  const t = res.locals.t;
  const title = String(req.body.title || '').trim().slice(0, 200);
  const message = String(req.body.message || '').trim().slice(0, 2000);
  const type = ['info', 'success', 'warning', 'error'].includes(req.body.type) ? req.body.type : 'info';
  if (!title) { flash(req, 'error', t('शीर्षक राख्नुहोस्।', 'Enter a title.')); return res.redirect('/admin/members/' + m.id + '#notify'); }
  await notify.notifyMember(m.id, title, message || null, '/member/notifications', type);
  const sent = ['portal'];
  const site = res.locals.siteName || '';
  if (req.body.sms === '1' && m.phone) { const r = await notify.sendSms('member_notice', m.phone, `${site}: ${title}${message ? ' — ' + message : ''}`.slice(0, 300)); if (r.ok) sent.push('sms'); }
  if (req.body.email === '1' && m.email) { const r = await notify.sendEmail('member_notice', m.email, `${title} — ${site}`, message || title); if (r.ok) sent.push('email'); }
  await auth.audit(req, 'notify', 'members', m.id, `Notification "${title}" → ${sent.join('+')}`);
  flash(req, 'success', t('सूचना पठाइयो: ', 'Notification sent: ') + sent.join(', '));
  res.redirect('/admin/members/' + m.id);
}));

// ---------------------------------------------------------------- 2FA reset, approval shortcuts, archive
router.post('/members/:id/2fa-reset', requireAdmin('admin'), ah(async (req, res) => {
  const id = util.int(req.params.id);
  await db.query('UPDATE members SET twofa_enabled = 0, twofa_secret = NULL, twofa_backup_codes = NULL, twofa_enabled_at = NULL WHERE id = $1', [id]);
  await auth.bumpSessionVersion('members', id);
  await auth.audit(req, 'member_2fa_reset', 'members', id, 'Member 2FA reset');
  flash(req, 'success', res.locals.t('सदस्यको 2FA reset भयो। अर्को लगइनमा नयाँ QR स्क्यान गर्नुपर्छ।', 'Member 2FA reset. A new QR is scanned at the next sign-in.'));
  res.redirect('/admin/members/' + id);
}));

router.post('/members/:id/approve', requireAdmin('staff'), ah(async (req, res) => {
  const m = await portal.approve(util.int(req.params.id), req.admin.id, req);
  if (m) {
    await auth.audit(req, 'approve', 'members', m.id, `Member portal account approved: ${m.name}`);
    notify.later(() => require('../lib/webhooks').emit('member.updated', { id: m.id, member_no: m.sadasyata_number || null, name: m.name, approval_status: 'approved', changed_by: req.admin.username }));
    flash(req, 'success', res.locals.t('सदस्य दर्ता स्वीकृत भयो र सूचना पठाइयो।', 'Member approved and notified.'));
  }
  res.redirect(auth.safeNext(req.body.back, '/admin/member-portal'));
}));
router.post('/members/:id/reject', requireAdmin('staff'), ah(async (req, res) => {
  const m = await portal.reject(util.int(req.params.id), req.body.reason, req.admin.id);
  if (m) {
    await auth.audit(req, 'reject', 'members', m.id, `Member portal registration rejected: ${m.name}${m.rejection_reason ? ' — ' + m.rejection_reason : ''}`);
    flash(req, 'success', res.locals.t('सदस्य दर्ता अस्वीकृत भयो।', 'Registration rejected.'));
  }
  res.redirect(auth.safeNext(req.body.back, '/admin/member-portal'));
}));

router.post('/members/:id/delete', requireAdmin('admin'), ah(async (req, res) => {
  await db.query('UPDATE members SET deleted_at = now(), is_active = 0 WHERE id = $1', [util.int(req.params.id)]);
  await auth.bumpSessionVersion('members', util.int(req.params.id));
  await auth.audit(req, 'delete', 'members', util.int(req.params.id), 'Member archived');
  flash(req, 'success', res.locals.t('सदस्य अभिलेखमा सारियो।', 'Member moved to the archive.'));
  res.redirect('/admin/members');
}));

// ---------------------------------------------------------------- ID card: issue (honours card_prefix, notifies) + unlock
router.post('/members/:id/card', requireAdmin('staff'), ah(async (req, res) => {
  const m = await memberById(req.params.id);
  if (!m) return res.redirect('/admin/members');
  const { code, cvv } = await portal.issueCard(m, req.admin.id, req.tenant);
  await auth.audit(req, 'card', 'members', m.id, 'Issued ID card');
  flash(req, 'success', res.locals.t(`परिचयपत्र जारी भयो र सदस्यलाई सूचना पठाइयो। कोड ${code}, CVV ${cvv}`, `ID card issued and the member notified. Code ${code}, CVV ${cvv}`));
  res.redirect('/admin/members/' + m.id);
}));
router.post('/members/:id/card/unlock', requireAdmin('admin'), ah(async (req, res) => {
  const m = await memberById(req.params.id);
  if (!m) return res.redirect('/admin/members');
  await db.query(`UPDATE member_id_cards SET failed_verify_count = 0, locked_at = NULL, unlock_requested = 0, unlock_requested_at = NULL
                  WHERE member_id IN ($1, $2, $3) AND status = 'active'`, [String(m.id), m.sadasyata_number || '-', m.member_card_no || '-']);
  await notify.notifyMember(m.id, 'परिचयपत्र Unlock भयो', 'तपाईंको डिजिटल परिचयपत्र कार्यालयले unlock गर्‍यो। अब प्रमाणीकरण गर्न मिल्छ।', '/member/id-card', 'success');
  await auth.audit(req, 'card_unlock', 'members', m.id, 'ID card unlocked');
  flash(req, 'success', res.locals.t('कार्ड Unlock गरी active बनाइयो।', 'Card unlocked.'));
  res.redirect(auth.safeNext(req.body.back, '/admin/members/' + m.id));
}));

// ---------------------------------------------------------------- member portal queue (admin/member-online-portal.php)
router.get('/member-portal', requireAdmin('staff'), ah(async (req, res) => {
  const tab = ['pending', 'changes', 'cards', 'settings'].includes(req.query.tab) ? req.query.tab : 'pending';
  const [pending, changes, locked, counts] = await Promise.all([
    db.many("SELECT m.*, k.status AS kyc_status, k.full_name AS kyc_name FROM members m LEFT JOIN kyc_applications k ON k.id = m.kyc_application_id WHERE m.deleted_at IS NULL AND m.approval_status = 'pending' ORDER BY m.created_at DESC NULLS LAST, m.id DESC LIMIT 200"),
    db.many("SELECT c.*, m.name, m.name_np, m.sadasyata_number FROM member_profile_change_requests c JOIN members m ON m.id = c.member_id WHERE c.status = 'pending' ORDER BY c.created_at DESC LIMIT 200"),
    db.many(`SELECT c.*, m.id AS member_pk, m.name, m.name_np, m.sadasyata_number, m.phone FROM member_id_cards c
             JOIN members m ON c.member_id IN (m.id::text, m.sadasyata_number, m.member_card_no) AND m.deleted_at IS NULL
             WHERE c.status = 'active' AND c.locked_at IS NOT NULL ORDER BY c.unlock_requested DESC, c.locked_at DESC LIMIT 200`),
    db.one(`SELECT (SELECT count(*) FROM members WHERE deleted_at IS NULL AND approval_status = 'pending') AS pending,
                   (SELECT count(*) FROM member_profile_change_requests WHERE status = 'pending') AS changes,
                   (SELECT count(*) FROM member_id_cards WHERE status = 'active' AND locked_at IS NOT NULL) AS cards`),
  ]);
  res.render('admin/member-portal', { title: res.locals.t('सदस्य पोर्टल', 'Member portal'), tab, pending, changes, locked, counts, s: await settings.all() });
}));

router.post('/member-portal/settings', requireAdmin('admin'), ah(async (req, res) => {
  const b = req.body;
  const meta = { group: 'members' };
  await settings.set('member_self_register', b.member_self_register === '1' ? '1' : '0', { ...meta, label: 'Members may register online (1 = yes, 0 = no)' });
  // the 2FA policy is a super-admin decision (admin/security-settings.php)
  if (auth.roleLevel(req.admin.role) >= auth.roleLevel('superadmin')) await settings.set('member_2fa_required', b.member_2fa_required === '1' ? '1' : '0', { ...meta, label: 'Member 2FA (authenticator app) required for every member (1 = yes)' });
  const prefix = String(b.card_prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  await settings.set('card_prefix', prefix, { ...meta, label: 'ID card code prefix (3 letters; blank = from the site name)' });
  const mail = String(b.admin_notify_email || '').split(/[,;\s]+/).filter(util.isEmail).join(', ').slice(0, 500);
  await settings.set('admin_notify_email', mail, { ...meta, label: 'Email for member-portal alerts (password reset requests, registrations)' });
  await auth.audit(req, 'update', 'site_settings', null, `Member portal policy: register=${b.member_self_register === '1' ? 1 : 0} 2fa_required=${await settings.get('member_2fa_required', '0')} card_prefix=${prefix || '-'}`);
  flash(req, 'success', res.locals.t('सेटिङ सुरक्षित भयो।', 'Settings saved.'));
  res.redirect('/admin/member-portal?tab=settings');
}));

router.post('/member-portal/changes/:id', requireAdmin('staff'), ah(async (req, res) => {
  const t = res.locals.t;
  const c = await db.one("SELECT * FROM member_profile_change_requests WHERE id = $1 AND status = 'pending'", [util.int(req.params.id)]);
  if (!c) return res.redirect('/admin/member-portal?tab=changes');
  const m = await memberById(c.member_id);
  const note = String(req.body.note || '').trim().slice(0, 500) || null;
  if (req.body.action === 'approve' && m && c.field === 'phone') {
    if (await portal.phoneOwnedByOther(c.new_value, m.id)) { flash(req, 'error', t('यो मोबाइल अर्को सदस्यको खातामा छ।', 'That mobile belongs to another member.')); return res.redirect('/admin/member-portal?tab=changes'); }
    await require('./member-self').applyPhone(m, c.new_value);
    await db.query('UPDATE member_profile_change_requests SET admin_id = $1, admin_note = $2 WHERE id = $3', [req.admin.id, note, c.id]);
    await notify.notifyMember(m.id, 'मोबाइल परिवर्तन स्वीकृत भयो', `तपाईंको मोबाइल नम्बर ${c.new_value} मा परिवर्तन गरियो।`, '/member/profile', 'success');
    await auth.audit(req, 'phone_change', 'members', m.id, `Mobile change approved: ${c.old_value || '—'} → ${c.new_value}`);
    flash(req, 'success', t('परिवर्तन स्वीकृत भयो।', 'Change approved.'));
  } else {
    await db.query("UPDATE member_profile_change_requests SET status = 'rejected', admin_id = $1, admin_note = $2, resolved_at = now() WHERE id = $3", [req.admin.id, note, c.id]);
    if (m) await notify.notifyMember(m.id, 'मोबाइल परिवर्तन अस्वीकृत भयो', 'तपाईंको मोबाइल परिवर्तन अनुरोध स्वीकृत भएन।' + (note ? ' कारण: ' + note : '') + ' थप जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोस्।', '/member/profile', 'error');
    await auth.audit(req, 'phone_change_reject', 'members', c.member_id, 'Mobile change rejected');
    flash(req, 'success', t('अनुरोध अस्वीकृत गरियो।', 'Request rejected.'));
  }
  res.redirect('/admin/member-portal?tab=changes');
}));

// ---------------------------------------------------------------- password reset requests
router.get('/password-requests', requireAdmin('staff'), ah(async (req, res) => {
  const rows = await db.many(`SELECT r.*, m.name, m.name_np, m.phone, m.email, m.sadasyata_number FROM member_password_reset_requests r LEFT JOIN members m ON m.id = r.member_id
                              ORDER BY r.status = 'pending' DESC, r.requested_at DESC LIMIT 100`);
  res.render('admin/password-requests', { title: res.locals.t('पासवर्ड रिसेट अनुरोध', 'Password reset requests'), rows, temp: req.session.tempPassword });
  delete req.session.tempPassword;
}));

async function pendingReset(id) { return db.one("SELECT * FROM member_password_reset_requests WHERE id = $1 AND status = 'pending'", [util.int(id)]); }

// temporary password, read out to the member by phone; the member must choose a new one at sign-in
router.post('/password-requests/:id/resolve', requireAdmin('staff'), ah(async (req, res) => {
  const r = await pendingReset(req.params.id);
  if (r) {
    const temp = crypto.randomBytes(5).toString('base64url');
    await db.query('UPDATE members SET password_hash = $1, must_change_password = 1 WHERE id = $2', [await auth.hashPassword(temp), r.member_id]);
    await auth.bumpSessionVersion('members', r.member_id);
    await db.query("UPDATE member_password_reset_requests SET status = 'resolved', admin_id = $1, resolved_at = now(), temp_password = NULL WHERE id = $2", [req.admin.id, r.id]);
    await notify.notifyMember(r.member_id, 'पासवर्ड Reset स्वीकृत भयो', 'तपाईंको पासवर्ड Reset अनुरोध Admin ले स्वीकृत गर्नुभयो। कार्यालयबाट नयाँ पासवर्ड प्राप्त गर्नुहोस् र लगिन गर्नुहोस्।', '/member/login', 'success');
    await auth.audit(req, 'password_reset', 'members', r.member_id, 'Temporary password issued');
    req.session.tempPassword = { id: r.id, temp };
  }
  res.redirect('/admin/password-requests');
}));

// admin sets the new password (adminApprovePasswordReset) and the member is notified in the portal
router.post('/password-requests/:id/set', requireAdmin('staff'), ah(async (req, res) => {
  const t = res.locals.t;
  const r = await pendingReset(req.params.id);
  const pw = String(req.body.new_password || '');
  if (!r) return res.redirect('/admin/password-requests');
  if (pw.length < 8) { flash(req, 'error', t('नयाँ पासवर्ड कम्तीमा ८ अक्षर हुनुपर्छ।', 'The new password must be at least 8 characters.')); return res.redirect('/admin/password-requests'); }
  await db.query('UPDATE members SET password_hash = $1, must_change_password = $2 WHERE id = $3', [await auth.hashPassword(pw), req.body.must_change === '1' ? 1 : 0, r.member_id]);
  await auth.bumpSessionVersion('members', r.member_id);
  await db.query("UPDATE member_password_reset_requests SET status = 'approved', admin_id = $1, resolved_at = now(), temp_password = NULL WHERE id = $2", [req.admin.id, r.id]);
  await notify.notifyMember(r.member_id, 'पासवर्ड Reset स्वीकृत भयो', 'तपाईंको पासवर्ड Reset अनुरोध Admin ले स्वीकृत गर्नुभयो। कार्यालयबाट नयाँ पासवर्ड प्राप्त गर्नुहोस् र लगिन गर्नुहोस्।', '/member/login', 'success');
  const m = await db.one('SELECT name, phone FROM members WHERE id = $1', [r.member_id]);
  if (req.body.sms === '1' && m?.phone) notify.later(() => notify.sendSms('password_reset_done', m.phone, `${res.locals.siteName || ''}: तपाईंको Member Portal पासवर्ड Reset गरियो। नयाँ पासवर्ड कार्यालयबाट लिनुहोस्।`.slice(0, 160)));
  await auth.audit(req, 'password_reset', 'members', r.member_id, 'Password set by admin');
  flash(req, 'success', t('पासवर्ड Reset स्वीकृत भयो र सदस्यलाई सूचना पठाइयो।', 'Password set and the member notified.'));
  res.redirect('/admin/password-requests');
}));

router.post('/password-requests/:id/reject', requireAdmin('staff'), ah(async (req, res) => {
  const r = await pendingReset(req.params.id);
  if (r) {
    const note = String(req.body.note || '').trim().slice(0, 500) || null;
    await db.query("UPDATE member_password_reset_requests SET status = 'rejected', admin_id = $1, resolved_at = now(), admin_note = $2 WHERE id = $3", [req.admin.id, note, r.id]);
    await notify.notifyMember(r.member_id, 'पासवर्ड Reset अस्वीकृत भयो', 'तपाईंको पासवर्ड Reset अनुरोध Admin ले अस्वीकृत गर्नुभयो।' + (note ? ' कारण: ' + note : '') + ' थप जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोस्।', '/member/login', 'error');
    await auth.audit(req, 'password_reset_reject', 'members', r.member_id, 'Password reset request rejected');
    flash(req, 'success', res.locals.t('पासवर्ड Reset अस्वीकृत गरियो।', 'Reset request rejected.'));
  }
  res.redirect('/admin/password-requests');
}));

/** Sidebar badge: registrations, mobile changes, unlock requests and password requests waiting for the office. */
router.badges = ah(async (req, res, next) => {
  if (req.method !== 'GET' || !res.locals.pendingCounts) return next();
  res.locals.pendingCounts._memberPortal = Number(await db.value(`SELECT (SELECT count(*) FROM members WHERE deleted_at IS NULL AND approval_status = 'pending')
    + (SELECT count(*) FROM member_profile_change_requests WHERE status = 'pending')
    + (SELECT count(*) FROM member_id_cards WHERE status = 'active' AND unlock_requested = 1 AND locked_at IS NOT NULL)
    + (SELECT count(*) FROM member_password_reset_requests WHERE status = 'pending')`)) || 0;
  next();
});

module.exports = router;
