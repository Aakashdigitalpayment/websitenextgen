'use strict';
/**
 * Admin: programme reports with CSV, live dashboard + JSON stats, programme defaults. Mounted inside /admin/programs.
 * Legacy: admin/program-reports-{absent,breakdown,consolidated,duplicates,location,member}.php, program-member-history.php,
 * program-dashboard.php, api/program-live-stats.php, program-settings.php.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const settings = require('../lib/settings');
const rep = require('../lib/program-reports');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const fmt = v => (v ? new Date(new Date(v).getTime() - new Date(v).getTimezoneOffset() * 60000).toISOString().slice(0, 16).replace('T', ' ') : '');
const en = l => l[1];

/** CSV with our own header row; cells are formula-safe (util.csvCell). */
function sendCsv(res, filename, header, rows) {
  const body = '﻿' + [header, ...rows].map(r => r.map(util.csvCell).join(',')).join('\r\n');
  res.type('text/csv; charset=utf-8').attachment(filename).send(body);
}

const REPORTS = [
  ['consolidated', 'समेकित', 'Consolidated'], ['breakdown', 'विश्लेषण', 'Breakdown'], ['location', 'स्थान अनुसार', 'By location'],
  ['absent', 'अनुपस्थित', 'Absent'], ['duplicates', 'दोहोरो प्रयास', 'Duplicate attempts'], ['member', 'सदस्य अनुसार', 'Member-wise'], ['history', 'सदस्य इतिहास', 'Member history'],
];

async function base(req, kind) {
  const programId = util.int(req.query.program_id, 0);
  return { kind, REPORTS, programs: await rep.programList(), programId, prog: await rep.program(programId), rep, fmt, query: req.query };
}
const render = (res, data) => res.render('admin/program-report', { title: res.locals.t('कार्यक्रम रिपोर्ट', 'Programme reports'), ...data });

router.get('/', (req, res) => res.redirect('/admin/programs/reports/consolidated' + (req.query.program_id ? '?program_id=' + util.int(req.query.program_id) : '')));

router.get('/consolidated', ah(async (req, res) => {
  const d = await base(req, 'consolidated');
  if (d.prog && req.query.export === 'csv') {
    const rows = await rep.validAttendance(d.prog.id, { limit: 0 });
    return sendCsv(res, `program-consolidated-${d.prog.id}.csv`, ['Member ID', 'Name', 'Father', 'Program', 'Location', 'Method', 'Attended At'],
      rows.map(r => [r.member_card_no || r.sadasyata_number, r.member_name, r.father_name, r.program_title, r.location_label, en(rep.methodLabel(r.attendance_method)), fmt(r.attended_at)]));
  }
  if (d.prog) Object.assign(d, { stats: await rep.liveStats(d.prog), rows: await rep.validAttendance(d.prog.id) });
  render(res, d);
}));

router.get('/absent', ah(async (req, res) => {
  const d = await base(req, 'absent');
  if (d.prog && req.query.export === 'csv') {
    const { rows } = await rep.absent(d.prog.id, { limit: 0 });
    return sendCsv(res, `program-absent-${d.prog.id}.csv`, ['Member ID', 'Name', 'Phone'], rows.map(r => [r.sadasyata_number, r.name, r.phone]));
  }
  if (d.prog) Object.assign(d, await rep.absent(d.prog.id));
  render(res, d);
}));

router.get('/location', ah(async (req, res) => {
  const d = await base(req, 'location');
  if (d.prog) {
    const occ = await rep.occurrenceCounts(d.prog.id);
    d.multi = occ.length > 0;
    if (req.query.export === 'csv') {
      const out = [];
      if (d.multi) { for (const o of occ) for (const m of await rep.validAttendance(d.prog.id, { occurrenceId: o.id, limit: 0 })) out.push([o.location_name, m.member_card_no || m.sadasyata_number, m.member_name, en(rep.methodLabel(m.attendance_method)), fmt(m.attended_at)]); }
      else for (const m of await rep.validAttendance(d.prog.id, { limit: 0 })) out.push([m.location_label || d.prog.location || '', m.member_card_no || m.sadasyata_number, m.member_name, en(rep.methodLabel(m.attendance_method)), fmt(m.attended_at)]);
      return sendCsv(res, `program-location-${d.prog.id}.csv`, ['Location', 'Member ID', 'Name', 'Method', 'Attended At'], out);
    }
    if (d.multi) { for (const o of occ) o.members = await rep.validAttendance(d.prog.id, { occurrenceId: o.id }); d.occ = occ; }
    else { d.rows = await rep.validAttendance(d.prog.id); d.total = (await rep.liveStats(d.prog)).attended; }
  }
  render(res, d);
}));

router.get('/breakdown', ah(async (req, res) => {
  const d = await base(req, 'breakdown');
  d.f = rep.breakdownFilters(req.query);
  if (d.prog) {
    if (req.query.export === 'csv') {
      const data = await rep.breakdown(d.prog.id, d.f);
      const groups = { gender: 'Gender', staff: 'Staff / user', location: 'Location', desk: 'Desk', method: 'Method' };
      const out = [];
      for (const [k, label] of Object.entries(groups)) for (const r of data[k]) out.push([label, en(r.label), r.count]);
      return sendCsv(res, `program-breakdown-summary-${d.prog.id}.csv`, ['Group', 'Value', 'Attendance'], out);
    }
    if (req.query.export === 'detail') {
      const { total, rows } = await rep.breakdownDetail(d.prog.id, d.f);
      await auth.audit(req, 'program_report_export', 'upcoming_programs', d.prog.id, `Attendance detail export (${total} rows)`);
      return sendCsv(res, `program-attendance-detail-${d.prog.id}.csv`, ['S.N.', 'Member ID', 'Name', 'Father', 'Gender', 'Phone', 'Address', 'Location', 'Desk', 'Staff / user', 'Username', 'Method', 'Attended At'],
        rows.map((r, i) => [i + 1, r.member_card_no || r.sadasyata_number, r.name, r.father_name, en(rep.GENDER_LABELS[rep.genderKey(r.gender_raw)]), r.phone, r.address, r.loc,
          r.desk_id ? r.desk_label || 'Desk #' + r.desk_id : '', r.staff_admin_id ? r.staff_name || 'Admin #' + r.staff_admin_id : 'No staff', r.staff_user || '', en(rep.methodLabel(r.attendance_method)), fmt(r.attended_at)]));
    }
    const active = Object.values(d.f).some(Boolean);
    d.data = await rep.breakdown(d.prog.id, d.f);
    d.all = active ? await rep.breakdown(d.prog.id, rep.breakdownFilters({})) : d.data;
    d.total = d.data.method.reduce((s, r) => s + r.count, 0);
    d.grandTotal = d.all.method.reduce((s, r) => s + r.count, 0);
    const page = Math.max(1, util.int(req.query.page, 1));
    d.detail = await rep.breakdownDetail(d.prog.id, d.f, { limit: 100, offset: (page - 1) * 100 });
    d.page = page;
  }
  render(res, d);
}));

router.get('/duplicates', ah(async (req, res) => {
  const d = await base(req, 'duplicates');
  d.result = rep.ATTEMPT_RESULTS[req.query.result] ? req.query.result : '';
  Object.assign(d, await rep.attempts(d.programId || null, d.result));
  render(res, d);
}));

router.get('/member', ah(async (req, res) => {
  const d = await base(req, 'member');
  d.q = String(req.query.q || '').trim().slice(0, 100);
  if (req.query.export === 'csv') {
    const { rows } = await rep.memberRegister(d.q, { limit: 0 });
    return sendCsv(res, 'program-member-attendance.csv', ['Member ID', 'Name', 'Father', 'Program', 'Location', 'Method', 'Attended At'],
      rows.map(r => [r.member_card_no || r.sadasyata_number, r.member_name, r.father_name, r.program_title, r.location_label, en(rep.methodLabel(r.attendance_method)), fmt(r.attended_at)]));
  }
  Object.assign(d, await rep.memberRegister(d.q));
  render(res, d);
}));

router.get('/history', ah(async (req, res) => {
  const d = await base(req, 'history');
  d.q = String(req.query.member_id || '').trim().slice(0, 60);
  d.type = req.query.type === '' ? '' : rep.TYPES[req.query.type] ? req.query.type : 'AGM';
  d.member = d.q ? await rep.findMemberByNo(d.q) : null;
  if (d.member) {
    d.log = await rep.memberLog(d.member.id);
    d.register = await rep.memberTypeRegister(d.member.id, d.type, 10);
    if (req.query.export === 'csv') {
      const sid = d.member.sadasyata_number || d.member.member_card_no || String(d.member.id);
      return sendCsv(res, `member-attendance-${sid.replace(/[^A-Za-z0-9_-]/g, '_')}.csv`, ['Member ID', 'Name', 'Father', 'Program', 'Type', 'Program Date', 'Location', 'Method', 'Attended At'],
        d.log.map(r => [sid, d.member.name, d.member.father_name, r.parent_title || r.program_title, r.program_type || '', r.event_date || '', r.location_label || '', en(rep.methodLabel(r.attendance_method)), fmt(r.attended_at)]));
    }
    const byType = {};
    for (const r of d.log) { const k = r.program_type || 'General'; byType[k] = (byType[k] || 0) + 1; }
    d.byType = Object.entries(byType).sort((a, b) => b[1] - a[1]);
  }
  render(res, d);
}));

module.exports = router;

// ---------------------------------------------------------------- dashboard (+ live JSON) and default settings
const extra = express.Router();

extra.get('/dashboard', ah(async (req, res) => {
  const [active, pending, today, duplicates, eligible, recent, list] = await Promise.all([
    db.value('SELECT count(*) FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL'),
    db.value("SELECT count(*) FROM member_program_attendance_requests WHERE status = 'pending'"),
    db.value("SELECT count(*) FROM member_program_attendance WHERE attendance_status = 'VALID' AND attended_at::date = CURRENT_DATE"),
    db.value("SELECT count(*) FROM program_attendance_attempts WHERE result = 'DUPLICATE_BLOCKED'"),
    rep.eligibleCount(),
    db.many(`SELECT a.*, m.name AS member_name, m.name_np AS member_name_np FROM member_program_attendance a LEFT JOIN members m ON m.id = a.member_id
             WHERE a.attendance_status = 'VALID' ORDER BY a.attended_at DESC LIMIT 12`),
    db.many(`SELECT id, title, program_type, is_multi_location, event_date, location FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL
             ORDER BY COALESCE(event_date, '9999-12-31'), id DESC LIMIT 8`),
  ]);
  const selected = util.int(req.query.program_id, 0);
  const prog = selected ? await rep.program(selected) : null;
  res.render('admin/program-dashboard', {
    title: res.locals.t('कार्यक्रम ड्यासबोर्ड', 'Programme dashboard'), counts: { active, pending, today, duplicates, eligible }, recent, list, prog, live: prog ? await rep.liveStats(prog) : null, rep, fmt,
  });
}));

// polled every 15 s by /static/js/program-live.js (legacy admin/api/program-live-stats.php)
extra.get('/:id/live.json', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const prog = await rep.program(util.int(req.params.id));
  if (!prog) return res.status(404).json({ ok: false, error: 'not found' });
  const s = await rep.liveStats(prog);
  res.json({
    ok: true, attended: s.attended, prereg: s.prereg, eligible: s.eligible, pct: s.pct,
    occurrences: s.occurrences.map(o => ({ id: o.id, location_name: o.location_name, event_date: o.event_date, attended_count: Number(o.attended_count) })),
    recent: s.recent.map(r => ({ name: r.name_np || r.name, sadasyata_number: r.sadasyata_number, location_label: r.location_label, attendance_method: r.attendance_method, attended_at: fmt(r.attended_at) })),
  });
}));

const SCOPES = [['all_active', 'सबै सक्रिय सदस्य', 'All active members'], ['shareholders', 'शेयरधनी मात्र (भविष्य)', 'Shareholders only (future)'], ['voters', 'योग्य मतदाता मात्र (भविष्य)', 'Eligible voters only (future)']];
extra.get('/settings', ah(async (req, res) => {
  const s = await settings.all();
  res.render('admin/program-settings', {
    title: res.locals.t('कार्यक्रम सेटिङ', 'Programme settings'), SCOPES,
    v: { instant: s.program_default_instant_attendance === '1', shared: (s.program_default_shared_qr ?? '1') !== '0', scope: s.program_default_eligible_scope || 'all_active' },
  });
}));
extra.post('/settings', auth.requireAdmin('admin'), ah(async (req, res) => {
  const meta = label => ({ group: 'programs', label });
  await settings.set('program_default_instant_attendance', req.body.default_instant_attendance ? '1' : '0', meta('Default: instant QR attendance'));
  await settings.set('program_default_shared_qr', req.body.default_shared_qr ? '1' : '0', meta('Default: shared parent QR for multi-location'));
  await settings.set('program_default_eligible_scope', SCOPES.some(x => x[0] === req.body.eligible_scope) ? req.body.eligible_scope : 'all_active', meta('Default eligible member scope'));
  await auth.audit(req, 'settings', 'site_settings', null, 'Programme defaults updated');
  flash(req, 'success', res.locals.t('सेटिङ सुरक्षित भयो।', 'Settings saved.'));
  res.redirect('/admin/programs/settings');
}));

module.exports.extra = extra;
