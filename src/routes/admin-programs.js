'use strict';
/** Admin: programmes, QR codes, occurrences, attendance desk, requests, reports. Mounted at /admin/programs */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const att = require('../lib/attendance');
const notify = require('../lib/notify');
const nd = require('../lib/nepali-date');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('staff'));
const reports = require('./admin-program-reports');
const rep = require('../lib/program-reports');
router.use('/reports', reports);
router.use('/', reports.extra);

const origin = req => `${req.protocol}://${req.get('host')}`;
const qrUrl = (req, token) => `${origin(req)}/attend?t=${encodeURIComponent(token)}`;
const toLocal = v => (v ? new Date(v) : null);

router.get('/', ah(async (req, res) => {
  const rows = await db.many(`SELECT p.*,
      (SELECT count(*) FROM member_program_attendance a WHERE a.program_id = p.id AND a.attendance_status = 'VALID') AS attended,
      (SELECT count(*) FROM member_program_preregistrations r WHERE r.program_id = p.id) AS registered,
      (SELECT count(*) FROM member_program_attendance_requests q WHERE q.program_id = p.id AND q.status = 'pending') AS pending
    FROM upcoming_programs p WHERE p.parent_program_id IS NULL ORDER BY p.event_date DESC NULLS LAST, p.id DESC LIMIT 200`);
  res.render('admin/programs', { title: res.locals.t('कार्यक्रम तथा उपस्थिति', 'Programmes & attendance'), rows });
}));

// ---------------------------------------------------------------- cross-programme register + exports (legacy program-attendance.php)
const fmt = v => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ') : '');
/** 'YYYY-MM-DD' in AD, or BS when the year is above 2050 (legacy programFilterBsDateToAd). */
function filterDate(raw) {
  const v = nd.toLatinDigits(String(raw || '').trim()).replace(/[/.]/g, '-');
  const m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  if (Number(m[1]) > 2050) return nd.bsToAd(iso);
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
const REGISTER_TABS = ['attendance', 'prereg', 'requests'];
function registerQuery(tab, f) {
  const p = [], w = [];
  const add = v => { p.push(v); return '$' + p.length; };
  const T = { attendance: ['a', 'attended_at'], prereg: ['r', 'created_at'], requests: ['q', 'requested_at'] }[tab];
  const [al, dateCol] = T;
  if (f.programId) w.push(`${al}.program_id = ${add(f.programId)}`);
  if (f.from) w.push(`${al}.${dateCol} >= ${add(f.from)}::date`);
  if (f.to) w.push(`${al}.${dateCol} < ${add(f.to)}::date + 1`);
  if (f.activeOnly) w.push('p.is_active = 1');
  const like = f.q ? add('%' + f.q + '%') : null;
  let from;
  if (tab === 'attendance') {
    from = `FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id LEFT JOIN kyc_applications k ON k.id = m.kyc_application_id
            LEFT JOIN upcoming_programs p ON p.id = a.program_id LEFT JOIN program_registration_desks d ON d.id = a.desk_id LEFT JOIN admin_users u ON u.id = a.staff_admin_id`;
    if (like) w.push(`(m.name ILIKE ${like} OR m.name_np ILIKE ${like} OR m.sadasyata_number ILIKE ${like} OR m.phone ILIKE ${like} OR a.member_card_no ILIKE ${like})`);
  } else if (tab === 'prereg') {
    from = `FROM member_program_preregistrations r LEFT JOIN upcoming_programs p ON p.id = r.program_id LEFT JOIN members m ON m.id = r.member_id`;
    if (like) w.push(`(r.member_name ILIKE ${like} OR r.member_card_no ILIKE ${like} OR r.phone ILIKE ${like} OR m.sadasyata_number ILIKE ${like})`);
  } else {
    from = `FROM member_program_attendance_requests q LEFT JOIN upcoming_programs p ON p.id = q.program_id LEFT JOIN program_occurrences o ON o.id = q.occurrence_id`;
    if (!f.showDone) w.push("q.status = 'pending'");
    if (like) w.push(`(q.member_name ILIKE ${like} OR q.member_card_no ILIKE ${like} OR q.member_phone ILIKE ${like})`);
  }
  return { from: from + (w.length ? ' WHERE ' + w.join(' AND ') : ''), params: p };
}
const REGISTER_SELECT = {
  attendance: ['a.*, m.name, m.name_np, m.sadasyata_number, m.phone, COALESCE(k.father_name, \'\') AS father_name, p.title AS parent_title, d.desk_label, COALESCE(u.full_name, u.username) AS staff_name', 'a.attended_at DESC, a.id DESC'],
  prereg: [`r.*, p.title AS parent_title, m.sadasyata_number, EXISTS (SELECT 1 FROM member_program_attendance x WHERE x.member_id = r.member_id AND x.program_id = r.program_id AND x.attendance_status = 'VALID') AS attended`, 'r.created_at DESC, r.id DESC'],
  requests: ['q.*, p.title AS parent_title, o.location_name', 'q.requested_at DESC, q.id DESC'],
};
const REGISTER_CSV = {
  attendance: [['Member ID', r => r.sadasyata_number || r.member_card_no], ['Name', r => r.name_np || r.name], ['Father', r => r.father_name], ['Phone', r => r.phone],
    ['Program', r => r.parent_title || r.program_title], ['Location', r => r.location_label], ['Method', r => r.attendance_method], ['Desk', r => r.desk_label], ['Staff', r => r.staff_name],
    ['Status', r => r.attendance_status], ['Attended At', r => fmt(r.attended_at)], ['Void reason', r => r.void_reason]],
  prereg: [['Name', r => r.member_name], ['Member ID', r => r.member_card_no || r.sadasyata_number], ['Phone', r => r.phone], ['Program', r => r.parent_title || r.program_title],
    ['Source', r => r.source], ['Created', r => fmt(r.created_at)], ['Attended?', r => (r.attended ? 'Yes' : 'No')]],
  requests: [['Name', r => r.member_name], ['Card no', r => r.member_card_no], ['Phone', r => r.member_phone], ['Address', r => r.member_address], ['Program', r => r.parent_title || r.program_title],
    ['Location', r => r.location_name], ['Status', r => r.status], ['Requested at', r => fmt(r.requested_at)], ['Processed at', r => fmt(r.processed_at)], ['Admin note', r => r.admin_note]],
};

router.get('/register', ah(async (req, res) => {
  const exp = REGISTER_TABS.includes(req.query.export) ? req.query.export : null;
  const tab = exp || (REGISTER_TABS.includes(req.query.tab) ? req.query.tab : 'attendance');
  const f = { programId: util.int(req.query.program_id, 0), q: String(req.query.q || '').trim().slice(0, 100), from: filterDate(req.query.date_from), to: filterDate(req.query.date_to),
    activeOnly: req.query.active_only === '1', showDone: req.query.show_done === '1' };
  const { from, params } = registerQuery(tab, f);
  const [sel, order] = REGISTER_SELECT[tab];
  if (exp) {
    const rows = await db.many(`SELECT ${sel} ${from} ORDER BY ${order} LIMIT 50000`, params);
    await auth.audit(req, 'program_report_export', 'upcoming_programs', f.programId || null, `Register export: ${exp} (${rows.length} rows)`);
    return util.sendCsv(res, `program-${exp}-${new Date().toISOString().slice(0, 10)}.csv`, REGISTER_CSV[exp].map(c => c[0]), rows.map(r => REGISTER_CSV[exp].map(c => c[1](r) ?? '')));
  }
  const total = Number(await db.value(`SELECT count(*) ${from}`, params));
  const pg = util.paginate(total, util.int(req.query.page, 1), 50);
  const rows = await db.many(`SELECT ${sel} ${from} ORDER BY ${order} LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  const programs = await db.many('SELECT id, title, event_date FROM upcoming_programs WHERE parent_program_id IS NULL ORDER BY event_date DESC NULLS LAST, id DESC LIMIT 300');
  res.render('admin/program-register', { title: res.locals.t('उपस्थिति दर्ता (सबै कार्यक्रम)', 'Attendance register (all programmes)'), tab, rows, pg, programs, f, fmt });
}));

async function loadProgram(req, res, next) {
  const p = await db.one('SELECT * FROM upcoming_programs WHERE id = $1', [util.int(req.params.id)]);
  if (!p) return next('route');
  req.program = p;
  next();
}

router.get('/:id', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const [occurrences, attendance, requests, prereg, desks, staff] = await Promise.all([
    db.many('SELECT * FROM program_occurrences WHERE parent_program_id = $1 ORDER BY event_date NULLS LAST, sort_order, id', [p.id]),
    db.many(`SELECT a.*, m.name, m.name_np, m.sadasyata_number, m.phone, d.desk_label FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id
             LEFT JOIN program_registration_desks d ON d.id = a.desk_id WHERE a.program_id = $1 ORDER BY a.attended_at DESC LIMIT 500`, [p.id]),
    req.query.show_done === '1'
      ? db.many('SELECT * FROM member_program_attendance_requests WHERE program_id = $1 ORDER BY (status = \'pending\') DESC, requested_at DESC LIMIT 200', [p.id])
      : db.many("SELECT * FROM member_program_attendance_requests WHERE program_id = $1 AND status = 'pending' ORDER BY requested_at", [p.id]),
    db.many(`SELECT r.*, EXISTS (SELECT 1 FROM member_program_attendance a WHERE a.member_id = r.member_id AND a.program_id = r.program_id AND a.attendance_status = 'VALID') AS attended
             FROM member_program_preregistrations r WHERE r.program_id = $1 ORDER BY r.created_at DESC LIMIT 500`, [p.id]),
    rep.desksFor(p.id),
    db.many("SELECT id, username, full_name FROM admin_users WHERE COALESCE(is_active, 1) = 1 AND deleted_at IS NULL ORDER BY full_name, username LIMIT 300"),
  ]);
  // the desk this staff member is assigned to is preselected (legacy program-registration-desk.php)
  const myDesk = desks.find(d => Number(d.is_active) && d.assigned_staff_admin_id === req.admin.id);
  const qr = p.qr_token ? await QRCode.toDataURL(qrUrl(req, p.qr_token), { margin: 1, width: 260 }) : null;
  for (const o of occurrences) o.qr = o.qr_token ? await QRCode.toDataURL(qrUrl(req, o.qr_token), { margin: 1, width: 180 }) : null;
  res.render('admin/program-detail', { title: p.title, p, occurrences, showDone: req.query.show_done === '1', attendance, requests, prereg, desks, staff, myDeskId: myDesk ? myDesk.id : 0, smsResult: req.session.smsResult || null, qr, qrLink: p.qr_token ? qrUrl(req, p.qr_token) : null, qrUrl: t => qrUrl(req, t), deskResult: req.session.deskResult || null, canVoid: a => att.canVoid(req.admin, a, req.permCtx) });
  delete req.session.deskResult;
  delete req.session.smsResult;
}));

// QR settings for the programme (or one occurrence)
router.post('/:id/qr', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const occId = util.int(req.body.occurrence_id, 0);
  const table = occId ? 'program_occurrences' : 'upcoming_programs';
  const id = occId || p.id;
  if (occId && !(await db.value('SELECT 1 FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occId, p.id]))) return res.redirect('/admin/programs/' + p.id);
  // clear: no token, QR off (legacy clear_qr)
  if (req.body.clear === '1') {
    await db.query(`UPDATE ${table} SET qr_token = NULL, qr_enabled = 0 WHERE id = $1`, [id]);
    await auth.audit(req, 'program_qr_clear', table, id, 'QR token cleared');
    flash(req, 'success', res.locals.t('QR हटाइयो।', 'QR cleared.'));
    return res.redirect('/admin/programs/' + p.id);
  }
  const firstToken = !(await db.value(`SELECT qr_token FROM ${table} WHERE id = $1`, [id]));
  const data = {
    qr_enabled: req.body.qr_enabled ? 1 : 0,
    attendance_open_at: req.body.open_at ? toLocal(req.body.open_at) : null,
    attendance_close_at: req.body.close_at ? toLocal(req.body.close_at) : null,
  };
  if (req.body.rotate === '1' || !(await db.value(`SELECT qr_token FROM ${table} WHERE id = $1`, [id]))) data.qr_token = att.newToken();
  if (!occId) data.instant_attendance = req.body.instant ? 1 : 0;
  if (!occId && req.body.pre_registration_open !== undefined) data.pre_registration_open = req.body.pre_registration_open === '1' ? 1 : 0;
  await db.update(table, id, await db.pick(table, data));
  // first token and no window: event day 00:00 → next day 23:59 (Nepal time), or now → +7 days without a date (legacy gen_qr)
  if (firstToken && !data.attendance_open_at && !data.attendance_close_at) {
    await db.query(`UPDATE ${table} t SET
        attendance_open_at = CASE WHEN d.day IS NULL THEN now()::timestamp ELSE d.day::timestamp END,
        attendance_close_at = CASE WHEN d.day IS NULL THEN now()::timestamp + interval '7 days' ELSE (d.day + 1)::timestamp + interval '23 hours 59 minutes' END
      FROM (SELECT COALESCE(${occId ? '(SELECT event_date FROM program_occurrences WHERE id = $1)' : 'NULL::date'}, (SELECT event_date FROM upcoming_programs WHERE id = $2)) AS day) d
      WHERE t.id = $1`, [id, p.id]);
  }
  await auth.audit(req, 'program_qr', table, id, data.qr_token ? 'QR token (re)generated' : 'QR settings updated');
  flash(req, 'success', res.locals.t('QR सेटिङ सुरक्षित भयो।', 'QR settings saved.'));
  res.redirect('/admin/programs/' + p.id);
}));

router.post('/:id/occurrences', ah(loadProgram), ah(async (req, res) => {
  const b = req.body;
  if (!String(b.location_name || '').trim()) { flash(req, 'error', res.locals.t('स्थान चाहिन्छ', 'Location required')); return res.redirect('/admin/programs/' + req.program.id); }
  await db.insert('program_occurrences', {
    parent_program_id: req.program.id, location_name: String(b.location_name).trim().slice(0, 200), event_date: /^\d{4}-\d{2}-\d{2}$/.test(b.event_date || '') ? b.event_date : req.program.event_date,
    start_time: String(b.start_time || '').slice(0, 20) || null, end_time: String(b.end_time || '').slice(0, 20) || null, qr_token: att.newToken(), qr_enabled: 1, is_active: 1, sort_order: 0,
  });
  await db.query('UPDATE upcoming_programs SET is_multi_location = 1 WHERE id = $1', [req.program.id]);
  flash(req, 'success', res.locals.t('स्थान थपियो।', 'Location added.'));
  res.redirect('/admin/programs/' + req.program.id);
}));

// edit one location / session (legacy program-occurrences.php save with id)
router.post('/:id/occurrences/:occ', ah(loadProgram), ah(async (req, res) => {
  const p = req.program, b = req.body;
  const back = '/admin/programs/' + p.id + '#locations';
  const occ = await db.one('SELECT * FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.occ), p.id]);
  if (!occ) return res.redirect(back);
  const name = String(b.location_name || '').trim().slice(0, 180);
  if (!name) { flash(req, 'error', res.locals.t('स्थान चाहिन्छ', 'Location required')); return res.redirect(back); }
  let date = null;
  if (String(b.event_date || '').trim()) {
    date = filterDate(b.event_date);
    if (!date) { flash(req, 'error', res.locals.t('मिति मिलेन (YYYY-MM-DD, वि.सं. वा ई.सं.)', 'Invalid date (YYYY-MM-DD, BS or AD)')); return res.redirect(back); }
  }
  const active = b.is_active === '1' ? 1 : 0;
  const data = { location_name: name, event_date: date, start_time: String(b.start_time || '').trim().slice(0, 20) || null, end_time: String(b.end_time || '').trim().slice(0, 20) || null,
    sort_order: util.int(b.sort_order, 0), is_active: active, updated_at: new Date() };
  if (!active) data.qr_enabled = 0;
  await db.update('program_occurrences', occ.id, data);
  await auth.audit(req, 'program_occurrence_update', 'program_occurrences', occ.id, `${p.title}: ${name}${active ? '' : ' (inactive)'}`);
  flash(req, 'success', res.locals.t('स्थान अद्यावधिक भयो।', 'Location updated.'));
  res.redirect(back);
}));

router.post('/:id/occurrences/:occ/delete', ah(loadProgram), ah(async (req, res) => {
  const used = await db.value('SELECT count(*) FROM member_program_attendance WHERE occurrence_id = $1', [util.int(req.params.occ)]);
  if (used) await db.query('UPDATE program_occurrences SET is_active = 0, qr_enabled = 0 WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.occ), req.program.id]);
  else await db.query('DELETE FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.occ), req.program.id]);
  res.redirect('/admin/programs/' + req.program.id);
}));

/** Desk member lookup (legacy api/program-desk-lookup.php): card, eligibility, existing check-in, history summary. */
const VOID_OWN_MINUTES = 30;
router.get('/:id/desk/lookup', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const q = String(req.query.q || '').trim().slice(0, 60);
  const member = q ? await rep.findMemberByNo(q) : null;
  if (!member) return res.json({ ok: false, error: res.locals.t('सदस्य भेटिएन।', 'Member not found.') });
  const occId = util.int(req.query.occurrence_id, 0);
  const deskId = util.int(req.query.desk_id, 0);
  const desk = deskId ? await db.one('SELECT occurrence_id FROM program_registration_desks WHERE id = $1 AND parent_program_id = $2', [deskId, p.id]) : null;
  const occurrence = (occId || (desk && desk.occurrence_id)) ? await db.one('SELECT id FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occId || desk.occurrence_id, p.id]) : null;
  const [kyc, existing, history] = await Promise.all([
    member.kyc_application_id ? db.one('SELECT photo, father_name FROM kyc_applications WHERE id = $1', [member.kyc_application_id]) : null,
    att.existing(member.id, p.id, occurrence?.id),
    rep.memberHistorySummary(member.id, p.id),
  ]);
  const bad = att.eligibility(member);
  const ms = member.monthly_saving_regular;
  res.json({
    ok: true,
    member: { id: member.id, name: member.name, name_np: member.name_np, sadasyata_number: member.sadasyata_number, phone: member.phone, address: member.address,
      father_name: (kyc && kyc.father_name) || member.father_name || '', photo: res.locals.mediaUrl((kyc && kyc.photo) || member.avatar_url || '') || null,
      monthly_saving: ms === null || ms === undefined ? '' : String(Number(ms)) },
    eligible: !bad, reason: bad ? res.locals.t(bad[0], bad[1]) : null,
    existing: existing ? { id: existing.id, attended_at: existing.attended_at, when: res.locals.bsDate(existing.attended_at) + ' ' + fmt(existing.attended_at).slice(11), location: existing.location_label,
      can_void: existing.staff_admin_id === req.admin.id && Date.now() - new Date(existing.attended_at).getTime() < VOID_OWN_MINUTES * 60_000 } : null,
    history,
  });
}));

// registration desk: check a member in by membership no. / card / phone (or the exact member from the lookup)
router.post('/:id/desk', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const byId = util.int(req.body.member_id, 0);
  const member = byId ? await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [byId]) : await rep.findMemberByNo(req.body.q);
  // named desk (optional): must belong to this programme and be active; a location desk implies its location
  const deskId = util.int(req.body.desk_id, 0);
  const desk = deskId ? await db.one('SELECT * FROM program_registration_desks WHERE id = $1 AND parent_program_id = $2 AND is_active = 1', [deskId, p.id]) : null;
  const occId = util.int(req.body.occurrence_id, 0) || (desk && desk.occurrence_id) || 0;
  const occurrence = occId ? await db.one('SELECT * FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occId, p.id]) : null;
  if (!member) req.session.deskResult = { type: 'error', text: res.locals.t('सदस्य भेटिएन: ', 'Member not found: ') + String(req.body.q || '').slice(0, 40) };
  else {
    const r = await att.record({ member, program: p, occurrence, method: 'ADMIN_MANUAL', source: desk ? 'registration_desk' : 'admin_desk', ip: req.ip, staffAdminId: req.admin.id, deskId: desk ? desk.id : null, note: String(req.body.note || '').slice(0, 255) || (desk ? desk.desk_label : null), checkEligible: true });
    req.session.deskResult = r.ineligible
      ? { type: 'error', text: `${member.name_np || member.name} — ${res.locals.t(r.ineligible[0], r.ineligible[1])}` }
      : r.duplicate
        ? { type: 'warn', text: `${member.name_np || member.name} — ${res.locals.t('पहिले नै उपस्थित', 'already checked in')} (${res.locals.bsDate(r.duplicate.attended_at)})` }
        : { type: 'success', text: `✓ ${member.name_np || member.name} (${member.sadasyata_number || member.phone})` };
    // monthly saving captured at the desk (legacy coop_monthly_saving_set … 'Registration desk')
    const ms = String(req.body.monthly_saving ?? '');
    if (!r.ineligible && (ms === '1' || ms === '0') && String(member.monthly_saving_regular ?? '') !== ms) {
      await db.query('UPDATE members SET monthly_saving_regular = $1 WHERE id = $2', [Number(ms), member.id]);
      await auth.audit(req, 'member_monthly_saving', 'members', member.id, `मासिक बचत → ${ms === '1' ? 'नियमित' : 'नियमित नभएको'} (Registration desk)`);
    }
  }
  res.redirect('/admin/programs/' + p.id + (deskId ? '?desk=' + deskId : '') + '#desk');
}));

// ---------------------------------------------------------------- named registration desks (legacy program-detail.php add/update/toggle_desk)
const deskStaff = async id => (id && (await db.value('SELECT id FROM admin_users WHERE id = $1 AND deleted_at IS NULL', [id]))) || null;
router.post('/:id/desks', auth.requireAdmin('admin'), ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const label = String(req.body.desk_label || '').trim().slice(0, 60);
  const occ = util.int(req.body.occurrence_id, 0);
  const occurrenceId = occ && (await db.value('SELECT id FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occ, p.id])) ? occ : null;
  if (!label) flash(req, 'error', res.locals.t('डेस्कको नाम चाहिन्छ।', 'Desk name is required.'));
  else if (await db.value('SELECT 1 FROM program_registration_desks WHERE parent_program_id = $1 AND lower(trim(desk_label)) = lower($2) AND is_active = 1', [p.id, label])) {
    flash(req, 'error', res.locals.t(`«${label}» नामको डेस्क पहिले नै छ।`, `A desk named “${label}” already exists.`));
  } else {
    const d = await db.insert('program_registration_desks', { parent_program_id: p.id, occurrence_id: occurrenceId, desk_label: label, assigned_staff_admin_id: await deskStaff(util.int(req.body.staff_id, 0)), is_active: 1 });
    await auth.audit(req, 'program_desk_add', 'program_registration_desks', d.id, `${p.title}: ${label}`);
    flash(req, 'success', res.locals.t('डेस्क थपियो।', 'Desk added.'));
  }
  res.redirect('/admin/programs/' + p.id + '#desks');
}));
router.post('/:id/desks/:did', auth.requireAdmin('admin'), ah(loadProgram), ah(async (req, res) => {
  const d = await db.one('SELECT * FROM program_registration_desks WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.did), req.program.id]);
  if (d && req.body.action === 'toggle') {
    await db.query('UPDATE program_registration_desks SET is_active = $1 WHERE id = $2', [Number(d.is_active) ? 0 : 1, d.id]);
    flash(req, 'success', Number(d.is_active) ? res.locals.t('डेस्क निष्क्रिय गरियो (पुराना दर्ता रिपोर्टमा रहन्छन्)।', 'Desk deactivated (past check-ins stay in reports).') : res.locals.t('डेस्क सक्रिय गरियो।', 'Desk activated.'));
  } else if (d) {
    await db.query('UPDATE program_registration_desks SET assigned_staff_admin_id = $1 WHERE id = $2', [await deskStaff(util.int(req.body.staff_id, 0)), d.id]);
    flash(req, 'success', res.locals.t('डेस्क स्टाफ तोकियो।', 'Desk staff assigned.'));
  }
  res.redirect('/admin/programs/' + req.program.id + '#desks');
}));

// ---------------------------------------------------------------- pre-registrations: bulk SMS/email (+ test) and mark attended (legacy program-attendance.php)
router.post('/:id/prereg/notify', auth.requireAdmin('admin'), ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const back = '/admin/programs/' + p.id + '#prereg';
  const ids = [...new Set([].concat(req.body.prereg_ids || []).map(Number).filter(Boolean))];
  const channel = ['sms', 'email', 'both'].includes(req.body.channel) ? req.body.channel : 'sms';
  const message = String(req.body.message || '').trim().slice(0, 600);
  const test = req.body.mode === 'test';
  if (!ids.length) { flash(req, 'error', res.locals.t('पहिले कम्तीमा एक पूर्व दर्ता सदस्य छान्नुहोस्।', 'Select at least one pre-registered member first.')); return res.redirect(back); }
  if (!message) { flash(req, 'error', res.locals.t('सन्देश खाली राख्न मिल्दैन।', 'The message cannot be empty.')); return res.redirect(back); }
  let targets = await db.many(`SELECT r.*, COALESCE(NULLIF(m.name_np, ''), NULLIF(m.name, ''), r.member_name) AS display_name, COALESCE(NULLIF(m.phone, ''), r.phone) AS to_phone, COALESCE(NULLIF(m.email, ''), r.email) AS to_email
                               FROM member_program_preregistrations r LEFT JOIN members m ON m.id = r.member_id WHERE r.program_id = $1 AND r.id = ANY($2::int[]) ORDER BY r.id`, [p.id, ids]);
  if (test) targets = targets.slice(0, 1);
  if (!targets.length) { flash(req, 'error', res.locals.t('छानिएका सदस्य फेला परेनन्।', 'The selected members were not found.')); return res.redirect(back); }
  const site = res.locals.siteName || '';
  const text = t => `${message}\n${res.locals.t('कार्यक्रम', 'Programme')}: ${p.title}${p.event_date ? ' | ' + res.locals.t('मिति', 'Date') + ': ' + res.locals.bsDate(p.event_date) : ''}${p.location ? ' | ' + p.location : ''}`;
  const sendOne = async t => {
    const out = [];
    if (channel !== 'email' && t.to_phone) out.push(await notify.sendSms(test ? 'test' : 'program_prereg_notice', t.to_phone, text(t)));
    if (channel !== 'sms' && t.to_email) out.push(await notify.sendEmail(test ? 'test' : 'program_prereg_notice', t.to_email, `${p.title} — ${site}`, text(t)));
    return out;
  };
  if (test) {
    const out = await sendOne(targets[0]);
    const ok = out.some(r => r.ok);
    req.session.smsResult = { type: ok ? 'success' : 'warn', text: res.locals.t('परीक्षण सन्देश', 'Test message') + ` → ${targets[0].display_name}: ` + (ok ? res.locals.t('पठाइयो', 'sent') : out.map(r => r.skipped || r.error).filter(Boolean).join(', ') || res.locals.t('सम्पर्क छैन', 'no contact')) };
  } else {
    // sent after the response; each send is logged in notification_log (daily caps apply)
    notify.later(async () => { for (const t of targets) await sendOne(t).catch(e => console.error('prereg notify:', e.message)); });
    req.session.smsResult = { type: 'success', text: res.locals.t(`${targets.length} सदस्यलाई सन्देश पठाउँदै (${channel})।`, `Sending to ${targets.length} members (${channel}).`) };
  }
  await auth.audit(req, test ? 'program_prereg_notify_test' : 'program_prereg_notify', 'upcoming_programs', p.id, `${channel}: ${targets.length} recipient(s)`);
  res.redirect(back);
}));

router.post('/:id/prereg/:rid/attend', auth.requireAdmin('staff'), ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const r = await db.one('SELECT * FROM member_program_preregistrations WHERE id = $1 AND program_id = $2', [util.int(req.params.rid), p.id]);
  const member = r ? await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [r.member_id]) : null;
  const hasLocations = await db.value('SELECT 1 FROM program_occurrences WHERE parent_program_id = $1 AND is_active = 1 LIMIT 1', [p.id]);
  if (!member) flash(req, 'error', res.locals.t('पूर्व दर्ता रेकर्ड फेला परेन।', 'Pre-registration not found.'));
  else if (hasLocations) flash(req, 'error', res.locals.t('बहु-स्थान कार्यक्रममा दर्ता डेस्क वा स्वीकृतिबाट स्थान सहित दर्ता गर्नुहोस्।', 'For multi-location programmes, check in at the desk with a location.'));
  else {
    const rec = await att.record({ member, program: p, method: 'ADMIN_PREREG', source: 'admin_prereg', ip: req.ip, staffAdminId: req.admin.id, note: 'Pre-registration बाट attendance mark', checkEligible: true });
    if (rec.ineligible) flash(req, 'error', res.locals.t(rec.ineligible[0], rec.ineligible[1]));
    else flash(req, rec.duplicate ? 'error' : 'success', rec.duplicate ? res.locals.t('यो सदस्यको उपस्थिति पहिल्यै दर्ता भइसकेको छ।', 'This member is already checked in.') : res.locals.t('पूर्व दर्ताबाट उपस्थिति दर्ता भयो।', 'Marked as attended from pre-registration.'));
  }
  res.redirect('/admin/programs/' + p.id + '#prereg');
}));

// ---------------------------------------------------------------- attendance requests from non-members: link to a member / create a member (legacy :349, :379)
router.post('/:id/requests/:rid/link', auth.requireAdmin('staff'), ah(loadProgram), ah(async (req, res) => {
  const no = String(req.body.member_no || '').trim().slice(0, 60);
  const member = no ? await rep.findMemberByNo(no) : null;
  if (!member) flash(req, 'error', res.locals.t(`सदस्य नं. "${no}" फेला परेन।`, `Member no. “${no}” not found.`));
  else {
    const u = await db.query(`UPDATE member_program_attendance_requests SET member_id = $1, member_name = $2, member_card_no = $3,
                                member_phone = COALESCE(NULLIF(member_phone, ''), $4), member_address = COALESCE(NULLIF(member_address, ''), $5)
                              WHERE id = $6 AND program_id = $7 AND status = 'pending'`,
      [member.id, member.name_np || member.name, member.sadasyata_number || member.member_card_no || '', member.phone || '', member.address || '', util.int(req.params.rid), req.program.id]);
    flash(req, u.rowCount ? 'success' : 'error', u.rowCount ? res.locals.t(`अनुरोध सदस्य ${member.sadasyata_number || member.id} सँग जोडियो। अब स्वीकृत गर्न सकिन्छ।`, `Request linked to member ${member.sadasyata_number || member.id}. You can approve it now.`) : res.locals.t('अनुरोध फेला परेन वा पहिले नै प्रक्रिया भइसकेको छ।', 'Request not found or already processed.'));
  }
  res.redirect('/admin/programs/' + req.program.id + '#requests');
}));

router.post('/:id/requests/:rid/create-member', auth.requireAdmin('admin'), ah(loadProgram), ah(async (req, res) => {
  const back = '/admin/programs/' + req.program.id + '#requests';
  const r = await db.one("SELECT * FROM member_program_attendance_requests WHERE id = $1 AND program_id = $2 AND status = 'pending'", [util.int(req.params.rid), req.program.id]);
  if (!r) { flash(req, 'error', res.locals.t('अनुरोध फेला परेन।', 'Request not found.')); return res.redirect(back); }
  const cardNo = String(r.member_card_no || '').trim().slice(0, 60);
  const existing = cardNo ? await rep.findMemberByNo(cardNo) : null;
  if (existing) {
    await db.query('UPDATE member_program_attendance_requests SET member_id = $1, member_card_no = $2 WHERE id = $3', [existing.id, existing.sadasyata_number || cardNo, r.id]);
    flash(req, 'success', res.locals.t(`सदस्य नं. ${existing.sadasyata_number || cardNo} पहिले नै छ — नयाँ नबनाई जोडियो।`, `Member ${existing.sadasyata_number || cardNo} already exists — linked instead.`));
    return res.redirect(back);
  }
  const name = String(r.member_name || '').trim().slice(0, 200), phone = String(r.member_phone || '').trim().slice(0, 20);
  if (!name || !phone) { flash(req, 'error', res.locals.t('नयाँ सदस्य बनाउन नाम र फोन आवश्यक छ।', 'Name and phone are needed to create a member.')); return res.redirect(back); }
  const created = await db.transaction(async () => {
    let no = cardNo;
    if (!no) { // MEM-<year>-NNNN, first free number (legacy create_member_from_attendance_request)
      let seq = Number(await db.value('SELECT count(*) FROM members')) + 1;
      do no = `MEM-${new Date().getFullYear()}-${String(seq++).padStart(4, '0')}`; while (await db.value('SELECT 1 FROM members WHERE sadasyata_number = $1', [no]));
    }
    const m = await db.insert('members', { sadasyata_number: no, name, name_np: name, phone, address: String(r.member_address || '').slice(0, 255) || null, approval_status: 'approved', is_active: 1, is_verified: 1, approved_at: new Date(), approved_by: req.admin.id, created_by: req.admin.id });
    await db.query('UPDATE member_program_attendance_requests SET member_id = $1, member_card_no = $2 WHERE id = $3', [m.id, no, r.id]);
    return m;
  });
  await auth.audit(req, 'create', 'members', created.id, `Member ${created.name} from programme attendance request #${r.id}`);
  flash(req, 'success', res.locals.t('नयाँ सदस्य बन्यो र अनुरोध जोडियो। अब स्वीकृत गर्न सकिन्छ।', 'Member created and linked. You can approve the request now.'));
  res.redirect(back);
}));

router.post('/:id/attendance/:aid/void', ah(loadProgram), ah(async (req, res) => {
  const rec = await db.one('SELECT id, staff_admin_id FROM member_program_attendance WHERE id = $1 AND program_id = $2', [util.int(req.params.aid), req.program.id]);
  if (rec && !att.canVoid(req.admin, rec, req.permCtx)) {
    flash(req, 'error', res.locals.t('तपाईंले आफूले लिएको उपस्थिति मात्र रद्द गर्न सक्नुहुन्छ।', 'You can only void check-ins you recorded yourself.'));
    return res.redirect('/admin/programs/' + req.program.id + '#attendance');
  }
  const belongs = !!rec;
  const row = belongs ? await att.voidAttendance(util.int(req.params.aid), req.admin.id, req.body.reason || 'admin void', req.ip) : null;
  if (row) await auth.audit(req, 'attendance_void', 'member_program_attendance', row.id, `Voided attendance of member #${row.member_id}`);
  res.redirect('/admin/programs/' + req.program.id + '#attendance');
}));

router.post('/:id/requests/:rid', ah(loadProgram), ah(async (req, res) => {
  const r = await db.one("SELECT * FROM member_program_attendance_requests WHERE id = $1 AND program_id = $2 AND status = 'pending'", [util.int(req.params.rid), req.program.id]);
  if (r && req.body.action === 'approve' && !(Number(r.member_id) > 0)) {
    flash(req, 'error', res.locals.t('यो अनुरोध कुनै सदस्यसँग जोडिएको छैन। पहिले सदस्य जोड्नुहोस् वा नयाँ बनाउनुहोस्।', 'This request is not linked to a member. Link or create the member first.'));
  } else if (r) {
    const approve = req.body.action === 'approve';
    if (approve) {
      const member = await db.one('SELECT * FROM members WHERE id = $1', [r.member_id]);
      const occurrence = r.occurrence_id ? await db.one('SELECT * FROM program_occurrences WHERE id = $1', [r.occurrence_id]) : null;
      const rec = member ? await att.record({ member, program: req.program, occurrence, method: 'ADMIN_APPROVE', source: 'member_request', ip: r.verified_by_ip, staffAdminId: req.admin.id, checkEligible: true }) : null;
      if (!rec || rec.ineligible) {
        flash(req, 'error', rec ? res.locals.t(rec.ineligible[0], rec.ineligible[1]) : res.locals.t('सदस्य फेला परेन।', 'Member not found.'));
        return res.redirect('/admin/programs/' + req.program.id + '#requests');
      }
    }
    await db.query('UPDATE member_program_attendance_requests SET status = $1, processed_at = now(), admin_id = $2, admin_note = $3 WHERE id = $4', [approve ? 'approved' : 'rejected', req.admin.id, String(req.body.note || '').slice(0, 255) || null, r.id]);
    await notify.notifyMember(r.member_id, req.program.title + ': ' + (approve ? res.locals.t('उपस्थिति स्वीकृत', 'attendance approved') : res.locals.t('उपस्थिति अस्वीकृत', 'attendance rejected')), null, '/member/programs');
  }
  res.redirect('/admin/programs/' + req.program.id + '#requests');
}));

router.get('/:id/attendance.csv', ah(loadProgram), ah(async (req, res) => {
  const { from, params } = registerQuery('attendance', { programId: req.program.id });
  const rows = await db.many(`SELECT ${REGISTER_SELECT.attendance[0]} ${from} ORDER BY a.attended_at, a.id`, params);
  await auth.audit(req, 'program_report_export', 'upcoming_programs', req.program.id, `Attendance CSV (${rows.length} rows)`);
  util.sendCsv(res, `attendance-${req.program.id}.csv`, REGISTER_CSV.attendance.map(c => c[0]), rows.map(r => REGISTER_CSV.attendance.map(c => c[1](r) ?? '')));
}));

module.exports = router;
