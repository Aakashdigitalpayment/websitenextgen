'use strict';
/** Admin: programmes, QR codes, occurrences, attendance desk, requests, reports. Mounted at /admin/programs */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const att = require('../lib/attendance');
const notify = require('../lib/notify');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('staff'));

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

async function loadProgram(req, res, next) {
  const p = await db.one('SELECT * FROM upcoming_programs WHERE id = $1', [util.int(req.params.id)]);
  if (!p) return next('route');
  req.program = p;
  next();
}

router.get('/:id', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const [occurrences, attendance, requests, prereg] = await Promise.all([
    db.many('SELECT * FROM program_occurrences WHERE parent_program_id = $1 ORDER BY event_date NULLS LAST, sort_order, id', [p.id]),
    db.many(`SELECT a.*, m.name, m.name_np, m.sadasyata_number, m.phone FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id
             WHERE a.program_id = $1 ORDER BY a.attended_at DESC LIMIT 500`, [p.id]),
    db.many("SELECT * FROM member_program_attendance_requests WHERE program_id = $1 AND status = 'pending' ORDER BY requested_at", [p.id]),
    db.many('SELECT * FROM member_program_preregistrations WHERE program_id = $1 ORDER BY created_at DESC LIMIT 500', [p.id]),
  ]);
  const qr = p.qr_token ? await QRCode.toDataURL(qrUrl(req, p.qr_token), { margin: 1, width: 260 }) : null;
  for (const o of occurrences) o.qr = o.qr_token ? await QRCode.toDataURL(qrUrl(req, o.qr_token), { margin: 1, width: 180 }) : null;
  res.render('admin/program-detail', { title: p.title, p, occurrences, attendance, requests, prereg, qr, qrLink: p.qr_token ? qrUrl(req, p.qr_token) : null, qrUrl: t => qrUrl(req, t), deskResult: req.session.deskResult || null });
  delete req.session.deskResult;
}));

// QR settings for the programme (or one occurrence)
router.post('/:id/qr', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const occId = util.int(req.body.occurrence_id, 0);
  const table = occId ? 'program_occurrences' : 'upcoming_programs';
  const id = occId || p.id;
  if (occId && !(await db.value('SELECT 1 FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occId, p.id]))) return res.redirect('/admin/programs/' + p.id);
  const data = {
    qr_enabled: req.body.qr_enabled ? 1 : 0,
    attendance_open_at: req.body.open_at ? toLocal(req.body.open_at) : null,
    attendance_close_at: req.body.close_at ? toLocal(req.body.close_at) : null,
  };
  if (req.body.rotate === '1' || !(await db.value(`SELECT qr_token FROM ${table} WHERE id = $1`, [id]))) data.qr_token = att.newToken();
  if (!occId) data.instant_attendance = req.body.instant ? 1 : 0;
  if (!occId && req.body.pre_registration_open !== undefined) data.pre_registration_open = req.body.pre_registration_open === '1' ? 1 : 0;
  await db.update(table, id, await db.pick(table, data));
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

router.post('/:id/occurrences/:occ/delete', ah(loadProgram), ah(async (req, res) => {
  const used = await db.value('SELECT count(*) FROM member_program_attendance WHERE occurrence_id = $1', [util.int(req.params.occ)]);
  if (used) await db.query('UPDATE program_occurrences SET is_active = 0, qr_enabled = 0 WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.occ), req.program.id]);
  else await db.query('DELETE FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [util.int(req.params.occ), req.program.id]);
  res.redirect('/admin/programs/' + req.program.id);
}));

// registration desk: check a member in by membership no. / card / phone
router.post('/:id/desk', ah(loadProgram), ah(async (req, res) => {
  const p = req.program;
  const member = await att.findMember(req.body.q);
  const occId = util.int(req.body.occurrence_id, 0);
  const occurrence = occId ? await db.one('SELECT * FROM program_occurrences WHERE id = $1 AND parent_program_id = $2', [occId, p.id]) : null;
  if (!member) req.session.deskResult = { type: 'error', text: res.locals.t('सदस्य भेटिएन: ', 'Member not found: ') + String(req.body.q || '').slice(0, 40) };
  else {
    const r = await att.record({ member, program: p, occurrence, method: 'ADMIN_MANUAL', source: 'admin_desk', ip: req.ip, staffAdminId: req.admin.id, note: String(req.body.note || '').slice(0, 255) || null });
    req.session.deskResult = r.duplicate
      ? { type: 'warn', text: `${member.name_np || member.name} — ${res.locals.t('पहिले नै उपस्थित', 'already checked in')} (${res.locals.bsDate(r.duplicate.attended_at)})` }
      : { type: 'success', text: `✓ ${member.name_np || member.name} (${member.sadasyata_number || member.phone})` };
  }
  res.redirect('/admin/programs/' + p.id + '#desk');
}));

router.post('/:id/attendance/:aid/void', ah(loadProgram), ah(async (req, res) => {
  const row = await att.voidAttendance(util.int(req.params.aid), req.admin.id, req.body.reason || 'admin void');
  if (row) await auth.audit(req, 'attendance_void', 'member_program_attendance', row.id, `Voided attendance of member #${row.member_id}`);
  res.redirect('/admin/programs/' + req.program.id + '#attendance');
}));

router.post('/:id/requests/:rid', ah(loadProgram), ah(async (req, res) => {
  const r = await db.one("SELECT * FROM member_program_attendance_requests WHERE id = $1 AND program_id = $2 AND status = 'pending'", [util.int(req.params.rid), req.program.id]);
  if (r) {
    const approve = req.body.action === 'approve';
    if (approve) {
      const member = await db.one('SELECT * FROM members WHERE id = $1', [r.member_id]);
      const occurrence = r.occurrence_id ? await db.one('SELECT * FROM program_occurrences WHERE id = $1', [r.occurrence_id]) : null;
      if (member) await att.record({ member, program: req.program, occurrence, method: 'ADMIN_APPROVE', source: 'member_request', ip: r.verified_by_ip, staffAdminId: req.admin.id });
    }
    await db.query('UPDATE member_program_attendance_requests SET status = $1, processed_at = now(), admin_id = $2, admin_note = $3 WHERE id = $4', [approve ? 'approved' : 'rejected', req.admin.id, String(req.body.note || '').slice(0, 255) || null, r.id]);
    await notify.notifyMember(r.member_id, req.program.title + ': ' + (approve ? res.locals.t('उपस्थिति स्वीकृत', 'attendance approved') : res.locals.t('उपस्थिति अस्वीकृत', 'attendance rejected')), null, '/member/programs');
  }
  res.redirect('/admin/programs/' + req.program.id + '#requests');
}));

router.get('/:id/attendance.csv', ah(loadProgram), ah(async (req, res) => {
  const rows = await db.many(`SELECT a.attended_at, a.attendance_status, a.attendance_method, a.location_label, m.sadasyata_number, m.name, m.name_np, m.phone, a.void_reason
                              FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id WHERE a.program_id = $1 ORDER BY a.attended_at`, [req.program.id]);
  const cols = ['attended_at', 'attendance_status', 'attendance_method', 'location_label', 'sadasyata_number', 'name', 'name_np', 'phone', 'void_reason'];
  const esc = v => { const s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : /^[=+\-@]/.test(s) ? "'" + s : s; };
  res.type('text/csv; charset=utf-8').attachment(`attendance-${req.program.id}.csv`).send('﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
}));

module.exports = router;
