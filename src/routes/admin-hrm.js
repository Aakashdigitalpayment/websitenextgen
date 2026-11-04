'use strict';
/** HRM (admin level). Mounted at /admin/hrm. Employee CRUD itself uses the generic resource editor. */
const express = require('express');
const QRCode = require('qrcode');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const { upload, remove } = require('../lib/uploads');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('admin'));

const LEAVE_TYPES = [['casual', 'भैपरी आउने', 'Casual'], ['sick', 'बिरामी', 'Sick'], ['annual', 'घर बिदा', 'Annual'], ['maternity', 'प्रसूति', 'Maternity'], ['paternity', 'प्रसूति स्याहार', 'Paternity'], ['mourning', 'किरिया', 'Mourning'], ['unpaid', 'बेतलबी', 'Unpaid'], ['other', 'अन्य', 'Other']];
const DOC_TYPES = [['citizenship', 'नागरिकता', 'Citizenship'], ['certificate', 'प्रमाणपत्र', 'Certificate'], ['appointment', 'नियुक्ति पत्र', 'Appointment letter'], ['cv', 'बायोडाटा', 'CV'], ['training', 'तालिम', 'Training'], ['other', 'अन्य', 'Other']];
const date = v => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
const today = () => new Date().toISOString().slice(0, 10);

router.get('/', ah(async (req, res) => {
  const [byStatus, byDept, expiringContracts, expiringDocs, onLeave, recentJoins] = await Promise.all([
    db.many('SELECT status, count(*) AS n FROM hrm_employees GROUP BY status'),
    db.many(`SELECT COALESCE(d.name_np, '—') AS name, count(e.id) AS n FROM hrm_employees e LEFT JOIN hrm_departments d ON d.id = e.department_id
             WHERE e.status IN ('active','on_leave') GROUP BY d.name_np ORDER BY n DESC`),
    db.many(`SELECT c.*, e.full_name, e.employee_code FROM hrm_contracts c JOIN hrm_employees e ON e.id = c.employee_id
             WHERE c.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 45 AND e.status IN ('active','on_leave') ORDER BY c.end_date`),
    db.many(`SELECT d.*, e.full_name, e.employee_code FROM hrm_documents d JOIN hrm_employees e ON e.id = d.employee_id
             WHERE d.expires_on BETWEEN CURRENT_DATE - 30 AND CURRENT_DATE + 45 ORDER BY d.expires_on`),
    db.many(`SELECT l.*, e.full_name, e.employee_code FROM hrm_leaves l JOIN hrm_employees e ON e.id = l.employee_id
             WHERE l.status = 'approved' AND CURRENT_DATE BETWEEN l.from_date AND l.to_date ORDER BY l.to_date`),
    db.many("SELECT id, full_name, designation, join_date FROM hrm_employees WHERE join_date >= CURRENT_DATE - 90 ORDER BY join_date DESC LIMIT 8"),
  ]);
  const counts = Object.fromEntries(byStatus.map(r => [r.status, r.n]));
  res.render('admin/hrm-dashboard', { title: res.locals.t('मानव संसाधन', 'Human resources'), counts, byDept, expiringContracts, expiringDocs, onLeave, recentJoins });
}));

async function loadEmployee(req, res, next) {
  const e = await db.one(`SELECT e.*, d.name_np AS department_np, d.name_en AS department_en FROM hrm_employees e
                          LEFT JOIN hrm_departments d ON d.id = e.department_id WHERE e.id = $1`, [util.int(req.params.id)]);
  if (!e) return next('route');
  req.employee = e;
  next();
}

router.get('/employees/:id', ah(loadEmployee), ah(async (req, res) => {
  const e = req.employee;
  const [contracts, documents, leaves] = await Promise.all([
    db.many('SELECT * FROM hrm_contracts WHERE employee_id = $1 ORDER BY start_date DESC', [e.id]),
    db.many('SELECT * FROM hrm_documents WHERE employee_id = $1 ORDER BY created_at DESC', [e.id]),
    db.many('SELECT * FROM hrm_leaves WHERE employee_id = $1 ORDER BY from_date DESC LIMIT 100', [e.id]),
  ]);
  const fy = Number(nd.todayBs().slice(0, 4)) - (Number(nd.todayBs().slice(5, 7)) < 4 ? 1 : 0); // fiscal year starts Shrawan (month 4)
  const fyStartAd = nd.bsToAd(`${fy}-04-01`);
  const leaveTotals = {};
  for (const l of leaves) if (l.status === 'approved' && l.from_date >= fyStartAd) leaveTotals[l.leave_type] = (leaveTotals[l.leave_type] || 0) + Number(l.days);
  res.render('admin/hrm-employee', { title: e.full_name, e, contracts, documents, leaves, leaveTotals, fy, LEAVE_TYPES, DOC_TYPES });
}));

const fileUpload = folder => (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload(folder, [{ name: 'file', kind: 'any' }], { maxMb: 15 });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
};

router.post('/employees/:id/contracts', ah(loadEmployee), fileUpload('hrm'), ah(async (req, res) => {
  const b = req.body;
  if (req.uploadError || !date(b.start_date) || (b.end_date && !date(b.end_date)) || (b.end_date && b.end_date < b.start_date)) {
    flash(req, 'error', req.uploadError || res.locals.t('मिति मिलेन।', 'Check the dates.'));
  } else {
    await db.insert('hrm_contracts', { employee_id: req.employee.id, contract_type: String(b.contract_type || 'employment').slice(0, 40), start_date: b.start_date, end_date: date(b.end_date),
      salary: b.salary ? Number(nd.toLatinDigits(b.salary).replace(/,/g, '')) || null : null, document: req.uploaded?.file || null, notes: String(b.notes || '').slice(0, 2000) || null, created_by: req.admin.id });
    await auth.audit(req, 'hrm_contract', 'hrm_employees', req.employee.id, 'Contract added');
  }
  res.redirect(`/admin/hrm/employees/${req.employee.id}#contracts`);
}));

router.post('/employees/:id/documents', ah(loadEmployee), fileUpload('hrm'), ah(async (req, res) => {
  const b = req.body;
  if (req.uploadError || !req.uploaded?.file || !String(b.title || '').trim()) flash(req, 'error', req.uploadError || res.locals.t('शीर्षक र फाइल चाहिन्छ।', 'Title and file are required.'));
  else {
    await db.insert('hrm_documents', { employee_id: req.employee.id, title: String(b.title).trim().slice(0, 200), doc_type: DOC_TYPES.some(d => d[0] === b.doc_type) ? b.doc_type : 'other',
      file_path: req.uploaded.file, expires_on: date(b.expires_on), created_by: req.admin.id });
    await auth.audit(req, 'hrm_document', 'hrm_employees', req.employee.id, 'Document added');
  }
  res.redirect(`/admin/hrm/employees/${req.employee.id}#documents`);
}));

router.post('/employees/:id/leaves', ah(loadEmployee), ah(async (req, res) => {
  const b = req.body;
  let from = date(b.from_date), to = date(b.to_date);
  // accept BS dates too
  if (!from && nd.bsToAd(b.from_date)) from = nd.bsToAd(b.from_date);
  if (!to && nd.bsToAd(b.to_date)) to = nd.bsToAd(b.to_date);
  if (!from || !to || to < from) { flash(req, 'error', res.locals.t('मिति मिलेन।', 'Check the dates.')); return res.redirect(`/admin/hrm/employees/${req.employee.id}#leaves`); }
  const calDays = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  const days = b.half_day ? 0.5 : Math.min(calDays, Number(b.days) || calDays);
  await db.insert('hrm_leaves', { employee_id: req.employee.id, leave_type: LEAVE_TYPES.some(l => l[0] === b.leave_type) ? b.leave_type : 'other', from_date: from, to_date: to, days,
    status: 'approved', reason: String(b.reason || '').slice(0, 1000) || null, created_by: req.admin.id });
  res.redirect(`/admin/hrm/employees/${req.employee.id}#leaves`);
}));

router.post('/employees/:id/:kind/:rid/delete', ah(loadEmployee), ah(async (req, res, next) => {
  const table = { contracts: 'hrm_contracts', documents: 'hrm_documents', leaves: 'hrm_leaves' }[req.params.kind];
  if (!table) return next();
  const row = await db.one(`DELETE FROM ${table} WHERE id = $1 AND employee_id = $2 RETURNING *`, [util.int(req.params.rid), req.employee.id]);
  if (row) remove(req, row.document || row.file_path);
  await auth.audit(req, 'hrm_delete_' + req.params.kind, 'hrm_employees', req.employee.id, `${req.params.kind} #${req.params.rid} deleted`);
  res.redirect(`/admin/hrm/employees/${req.employee.id}#${req.params.kind}`);
}));

router.get('/employees/:id/id-card', ah(loadEmployee), ah(async (req, res) => {
  const e = req.employee;
  const qr = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}/staff/${encodeURIComponent(e.employee_code)}`, { margin: 1, width: 160 });
  res.render('admin/hrm-id-card', { layout: false, e, qr });
}));

router.get('/directory.csv', ah(async (req, res) => {
  const rows = await db.many(`SELECT e.employee_code, e.full_name, e.full_name_en, e.designation, d.name_np AS department, e.branch, e.phone, e.email, e.employment_type, e.status, e.join_date
                              FROM hrm_employees e LEFT JOIN hrm_departments d ON d.id = e.department_id ORDER BY e.employee_code`);
  const cols = Object.keys(rows[0] || { employee_code: 1 });
  const esc = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : /^[=+\-@]/.test(s) ? "'" + s : s; };
  await auth.audit(req, 'export', 'hrm_employees', null, 'Staff directory CSV');
  res.type('text/csv; charset=utf-8').attachment(`staff-${today()}.csv`).send('﻿' + [cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n'));
}));

module.exports = router;
