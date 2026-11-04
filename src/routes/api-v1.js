'use strict';
/**
 * Integration API v1 — for core banking (CBS) and document management (DMS) systems.
 * Mounted at /api/v1 on each tenant's host. Auth: Authorization: Bearer <api key>. JSON in/out.
 * Full reference: docs/API.md and docs/openapi.yaml
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const nd = require('../lib/nepali-date');
const util = require('../lib/util');
const forms = require('../lib/forms');
const notify = require('../lib/notify');
const webhooks = require('../lib/webhooks');
const modules = require('../modules/applications');
const { upload, resolveStored, remove } = require('../lib/uploads');
const { ApiError, authenticate, requireScope, idempotent, encodeCursor, decodeCursor } = require('../lib/api');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(express.json({ limit: '2mb' }));
router.use(authenticate);

// ---------------------------------------------------------------- helpers
const str = (v, n = 255) => (v === undefined ? undefined : v === null ? null : String(v).trim().slice(0, n));
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
const num = v => { if (v === undefined || v === null || v === '') return v === '' ? null : v; const n = Number(v); if (!Number.isFinite(n) || Math.abs(n) > 1e15) throw new ApiError(422, 'invalid', `Not a number: ${v}`); return n; };
const limitOf = (q, def = 100, max = 500) => Math.min(max, Math.max(1, util.int(q, def)));

function memberOut(m) {
  return {
    id: m.id, member_no: m.sadasyata_number || null, card_no: m.member_card_no || null, external_id: m.external_id || null,
    name: m.name, name_np: m.name_np || null, phone: m.phone || null, email: m.email || null, address: m.address || null,
    dob: m.dob || null, gender: m.gender || null, approval_status: m.approval_status, active: !!Number(m.is_active),
    created_at: m.created_at, updated_at: m.updated_at || m.created_at,
  };
}

/** Validate an incoming member payload → columns (only provided fields). */
function memberIn(b, { requireName }) {
  const errors = {};
  const d = {};
  if (b.name !== undefined) d.name = str(b.name, 255);
  if (b.name_np !== undefined) d.name_np = str(b.name_np, 255) || '';
  if (requireName && !d.name && !d.name_np) errors.name = 'required';
  if (d.name === '' || (requireName && !d.name)) d.name = d.name_np || d.name;
  if (b.phone !== undefined) {
    const raw = b.phone === null ? '' : String(b.phone).trim();
    d.phone = raw ? nd.toLatinDigits(raw).replace(/[^\d+]/g, '').slice(0, 20) : null;
    if (raw && !util.isPhone(d.phone)) errors.phone = 'invalid';
  }
  if (b.email !== undefined) { d.email = b.email ? String(b.email).trim().toLowerCase().slice(0, 255) : null; if (d.email && !util.isEmail(d.email)) errors.email = 'invalid'; }
  if (b.address !== undefined) d.address = str(b.address, 1000);
  if (b.card_no !== undefined) d.member_card_no = str(b.card_no, 50);
  if (b.external_id !== undefined) d.external_id = str(b.external_id, 80);
  if (b.dob !== undefined) { if (b.dob && !isDate(b.dob)) errors.dob = 'YYYY-MM-DD (AD)'; else d.dob = b.dob || null; }
  if (b.dob_bs !== undefined && b.dob_bs) { const ad = nd.bsToAd(b.dob_bs); if (!ad) errors.dob_bs = 'invalid BS date'; else d.dob = ad; }
  if (b.gender !== undefined) { if (b.gender && !['male', 'female', 'other'].includes(b.gender)) errors.gender = 'male|female|other'; else d.gender = b.gender || null; }
  if (b.active !== undefined) d.is_active = b.active ? 1 : 0;
  if (b.approval_status !== undefined) { if (!['pending', 'approved', 'rejected'].includes(b.approval_status)) errors.approval_status = 'pending|approved|rejected'; else d.approval_status = b.approval_status; }
  if (Object.keys(errors).length) throw new ApiError(422, 'validation_failed', 'Invalid member data', errors);
  return d;
}

async function findMember(no) {
  const v = String(no || '').trim();
  if (!v) return null;
  return db.one(`SELECT * FROM members WHERE deleted_at IS NULL AND (sadasyata_number = $1 OR (external_source IS NOT NULL AND external_id = $1)) ORDER BY (sadasyata_number = $1) DESC LIMIT 1`, [v]);
}
async function mustMember(no) {
  const m = await findMember(no);
  if (!m) throw new ApiError(404, 'member_not_found', `No member with member_no "${no}"`);
  return m;
}

/** Upsert by member_no (sadasyata_number). Returns { member, created }. */
async function upsertMember(no, body, client) {
  const memberNo = String(no || '').trim().slice(0, 50);
  if (!memberNo) throw new ApiError(422, 'validation_failed', 'member_no is required');
  const existing = await findMember(memberNo);
  const data = memberIn(body, { requireName: !existing });
  data.sadasyata_number = memberNo;
  if (data.external_id) data.external_source = client.system_type + ':' + client.id;
  try {
    if (existing) {
      const m = Object.keys(data).length ? await db.update('members', existing.id, data) : existing;
      if (data.is_active === 0) await db.query('UPDATE members SET session_version = COALESCE(session_version, 1) + 1 WHERE id = $1', [existing.id]);
      return { member: m, created: false };
    }
    const m = await db.insert('members', { approval_status: 'approved', is_active: 1, is_verified: 1, name_np: '', ...data, approved_at: new Date() });
    return { member: m, created: true };
  } catch (e) {
    if (e.code === '23505') throw new ApiError(409, 'conflict', 'Email or external_id already belongs to another member');
    throw e;
  }
}

const emitMember = (req, member, created) => notify.later(() => webhooks.emit(created ? 'member.created' : 'member.updated', memberOut(member), { originClientId: req.apiClient.id }));

// ---------------------------------------------------------------- meta
router.get('/ping', (req, res) => res.json({ ok: true, tenant: req.tenant.slug, client: req.apiClient.name, scopes: req.apiClient.scopes, server_time: new Date().toISOString() }));

// ---------------------------------------------------------------- members
router.get('/members', requireScope('members:read'), ah(async (req, res) => {
  const limit = limitOf(req.query.limit);
  const cur = decodeCursor(req.query.cursor);
  const since = req.query.updated_since;
  if (since && Number.isNaN(Date.parse(since))) throw new ApiError(400, 'bad_request', 'updated_since must be an ISO date/time');
  const where = ['deleted_at IS NULL'], params = [];
  const ch = "date_trunc('milliseconds', COALESCE(updated_at, created_at))";
  if (since) { params.push(new Date(since)); where.push(`${ch} >= $${params.length}`); }
  if (cur) { params.push(new Date(cur.t), cur.id); where.push(`(${ch}, id) > ($${params.length - 1}, $${params.length})`); }
  if (req.query.q) { params.push('%' + String(req.query.q).slice(0, 60) + '%'); where.push(`(name ILIKE $${params.length} OR name_np ILIKE $${params.length} OR phone ILIKE $${params.length} OR sadasyata_number ILIKE $${params.length})`); }
  const rows = await db.many(`SELECT *, ${ch} AS _changed FROM members WHERE ${where.join(' AND ')} ORDER BY ${ch}, id LIMIT ${limit + 1}`, params);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  res.json({ data: page.map(memberOut), next_cursor: rows.length > limit ? encodeCursor(last._changed, last.id) : null });
}));

router.get('/members/:no', requireScope('members:read'), ah(async (req, res) => {
  const m = await mustMember(req.params.no);
  const [accounts] = await Promise.all([db.many('SELECT * FROM member_accounts WHERE member_id = $1 ORDER BY kind, account_no', [m.id])]);
  res.json({ data: { ...memberOut(m), accounts: accounts.map(accountOut) } });
}));

router.put('/members/:no', requireScope('members:write'), idempotent(ah(async (req, res) => {
  const { member, created } = await upsertMember(req.params.no, req.body || {}, req.apiClient);
  emitMember(req, member, created);
  res.status(created ? 201 : 200).json({ data: memberOut(member), created });
})));

router.post('/members/bulk', requireScope('members:write'), idempotent(ah(async (req, res) => {
  const list = Array.isArray(req.body?.members) ? req.body.members : null;
  if (!list || !list.length || list.length > 500) throw new ApiError(422, 'validation_failed', 'members must be an array of 1–500 items');
  const results = [];
  for (const [i, item] of list.entries()) {
    try {
      const { member, created } = await db.transaction(() => upsertMember(item?.member_no, item || {}, req.apiClient));
      emitMember(req, member, created);
      results.push({ index: i, member_no: member.sadasyata_number, id: member.id, status: created ? 'created' : 'updated' });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      results.push({ index: i, member_no: item?.member_no || null, status: 'error', error: { code: e.code, message: e.message, details: e.details } });
    }
  }
  const counts = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] || 0) + 1 }), {});
  res.json({ data: results, summary: counts });
})));

// ---------------------------------------------------------------- accounts & transactions (CBS → portal)
const KINDS = ['saving', 'fixed', 'loan', 'share', 'other'];
function accountOut(a) {
  return { account_no: a.account_no, kind: a.kind, product_name: a.product_name, balance: a.balance, interest_rate: a.interest_rate, opened_on: a.opened_on,
    maturity_date: a.maturity_date, installment_amount: a.installment_amount, next_due_date: a.next_due_date, overdue_amount: a.overdue_amount, status: a.status, as_of: a.as_of };
}
function accountIn(a, i) {
  const bad = msg => { throw new ApiError(422, 'validation_failed', `accounts[${i}]: ${msg}`); };
  if (!a || typeof a !== 'object') bad('must be an object');
  const account_no = str(a.account_no, 60);
  if (!account_no) bad('account_no is required');
  if (!KINDS.includes(a.kind)) bad('kind must be one of ' + KINDS.join('|'));
  for (const k of ['opened_on', 'maturity_date', 'next_due_date']) if (a[k] && !isDate(a[k])) bad(`${k} must be YYYY-MM-DD`);
  if (a.as_of && Number.isNaN(Date.parse(a.as_of))) bad('as_of must be an ISO date/time');
  return {
    account_no, kind: a.kind, product_name: str(a.product_name, 150) || null, balance: num(a.balance) ?? 0, interest_rate: num(a.interest_rate) ?? null,
    opened_on: a.opened_on || null, maturity_date: a.maturity_date || null, installment_amount: num(a.installment_amount) ?? null,
    next_due_date: a.next_due_date || null, overdue_amount: num(a.overdue_amount) ?? null, status: str(a.status, 20) || 'active', as_of: a.as_of ? new Date(a.as_of) : new Date(),
  };
}
async function putAccounts(member, accounts, replace) {
  const rows = accounts.map(accountIn);
  for (const a of rows) {
    await db.query(`INSERT INTO member_accounts (member_id, account_no, kind, product_name, balance, interest_rate, opened_on, maturity_date, installment_amount, next_due_date, overdue_amount, status, as_of)
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
                    ON CONFLICT (member_id, account_no) DO UPDATE SET kind = EXCLUDED.kind, product_name = EXCLUDED.product_name, balance = EXCLUDED.balance,
                      interest_rate = EXCLUDED.interest_rate, opened_on = EXCLUDED.opened_on, maturity_date = EXCLUDED.maturity_date, installment_amount = EXCLUDED.installment_amount,
                      next_due_date = EXCLUDED.next_due_date, overdue_amount = EXCLUDED.overdue_amount, status = EXCLUDED.status, as_of = EXCLUDED.as_of`,
      [member.id, a.account_no, a.kind, a.product_name, a.balance, a.interest_rate, a.opened_on, a.maturity_date, a.installment_amount, a.next_due_date, a.overdue_amount, a.status, a.as_of]);
  }
  if (replace) await db.query('DELETE FROM member_accounts WHERE member_id = $1 AND NOT (account_no = ANY($2))', [member.id, rows.map(r => r.account_no)]);
  return rows.length;
}

router.put('/members/:no/accounts', requireScope('accounts:write'), idempotent(ah(async (req, res) => {
  const accounts = req.body?.accounts;
  if (!Array.isArray(accounts) || accounts.length > 200) throw new ApiError(422, 'validation_failed', 'accounts must be an array (max 200)');
  const m = await mustMember(req.params.no);
  const n = await db.transaction(() => putAccounts(m, accounts, req.body.replace !== false));
  res.json({ data: { member_no: m.sadasyata_number, accounts: n } });
})));

router.post('/accounts/bulk', requireScope('accounts:write'), idempotent(ah(async (req, res) => {
  const list = req.body?.members;
  if (!Array.isArray(list) || !list.length || list.length > 500) throw new ApiError(422, 'validation_failed', 'members must be an array of 1–500 items');
  const results = [];
  for (const [i, item] of list.entries()) {
    try {
      const m = await mustMember(item?.member_no);
      if (!Array.isArray(item.accounts)) throw new ApiError(422, 'validation_failed', 'accounts must be an array');
      const n = await db.transaction(() => putAccounts(m, item.accounts, item.replace !== false));
      results.push({ index: i, member_no: m.sadasyata_number, status: 'ok', accounts: n });
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      results.push({ index: i, member_no: item?.member_no || null, status: 'error', error: { code: e.code, message: e.message } });
    }
  }
  res.json({ data: results });
})));

router.post('/members/:no/transactions', requireScope('accounts:write'), idempotent(ah(async (req, res) => {
  const list = req.body?.transactions;
  if (!Array.isArray(list) || !list.length || list.length > 1000) throw new ApiError(422, 'validation_failed', 'transactions must be an array of 1–1000 items');
  const m = await mustMember(req.params.no);
  let upserted = 0;
  await db.transaction(async () => {
    for (const [i, t] of list.entries()) {
      const bad = msg => { throw new ApiError(422, 'validation_failed', `transactions[${i}]: ${msg}`); };
      if (!t || !str(t.account_no) || !str(t.txn_id)) bad('account_no and txn_id are required');
      if (!t.txn_date || Number.isNaN(Date.parse(t.txn_date))) bad('txn_date must be an ISO date/time');
      await db.query(`INSERT INTO member_transactions (member_id, account_no, txn_id, txn_date, description, debit, credit, balance_after)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                      ON CONFLICT (member_id, account_no, txn_id) DO UPDATE SET txn_date = EXCLUDED.txn_date, description = EXCLUDED.description,
                        debit = EXCLUDED.debit, credit = EXCLUDED.credit, balance_after = EXCLUDED.balance_after`,
        [m.id, str(t.account_no, 60), str(t.txn_id, 80), new Date(t.txn_date), str(t.description, 255) || null, num(t.debit) || 0, num(t.credit) || 0, num(t.balance_after) ?? null]);
      upserted++;
    }
    // keep the latest 500 lines per member
    await db.query(`DELETE FROM member_transactions WHERE member_id = $1 AND id NOT IN (SELECT id FROM member_transactions WHERE member_id = $1 ORDER BY txn_date DESC, id DESC LIMIT 500)`, [m.id]);
  });
  res.json({ data: { member_no: m.sadasyata_number, transactions: upserted } });
})));

// ---------------------------------------------------------------- applications (portal → CBS/DMS)
function moduleOf(key) {
  const m = Object.hasOwn(modules, key) ? modules[key] : null;
  if (!m) throw new ApiError(404, 'unknown_module', `Unknown application type "${key}". Use one of: ${Object.keys(modules).join(', ')}`);
  return m;
}
function applicationOut(mod, row, base) {
  const fields = {};
  for (const f of mod.fields) if (f.type !== 'file' && f.type !== 'image' && row[f.name] !== undefined) fields[f.name] = row[f.name];
  for (const f of mod.fields) if (f.adCol && row[f.adCol]) fields[f.adCol] = row[f.adCol];
  const ref = row.tracking_id || String(row.id);
  return {
    id: row.id, tracking_id: row.tracking_id || null, type: mod.key, status: row.status || null, remarks: row[mod.remarksCol] || null,
    applicant: { name: row[mod.nameCol] || null, phone: row[mod.phoneCol] || null, email: row.email || null, member_no: mod.memberCol ? row[mod.memberCol] || null : null },
    fields,
    files: mod.fileFields.filter(f => row[f.name]).map(f => ({ field: f.name, label: f.label[1], url: `${base}/applications/${mod.key}/${encodeURIComponent(ref)}/files/${f.name}` })),
    created_at: row.created_at, updated_at: row.updated_at || row.created_at,
  };
}
const apiBase = req => `${req.protocol}://${req.get('host')}/api/v1`;
async function findApplication(mod, ref) {
  const cols = await db.columns(mod.table);
  const where = cols.has('tracking_id') && !/^\d+$/.test(ref) ? 'upper(tracking_id) = upper($1)' : 'id = $1::int';
  if (where === 'id = $1::int' && !/^\d+$/.test(ref)) return null;
  const row = await db.one(`SELECT * FROM ${mod.table} WHERE ${where} ${cols.has('deleted_at') ? 'AND deleted_at IS NULL' : ''} LIMIT 1`, [ref]);
  return row;
}

router.get('/applications', requireScope('applications:read'), (req, res) => {
  res.json({ data: Object.values(modules).map(m => ({ type: m.key, name: m.title[1], name_np: m.title[0], has_tracking: !m.noTracking, has_status: !m.noStatus })) });
});

router.get('/applications/:module', requireScope('applications:read'), ah(async (req, res) => {
  const mod = moduleOf(req.params.module);
  const cols = await db.columns(mod.table);
  const changed = `date_trunc('milliseconds', ${cols.has('updated_at') ? 'COALESCE(updated_at, created_at)' : 'created_at'})`;
  const limit = limitOf(req.query.limit);
  const cur = decodeCursor(req.query.cursor);
  const where = [], params = [];
  if (cols.has('deleted_at')) where.push('deleted_at IS NULL');
  if (req.query.status) { params.push(String(req.query.status)); where.push(`status = $${params.length}`); }
  if (req.query.updated_since) {
    if (Number.isNaN(Date.parse(req.query.updated_since))) throw new ApiError(400, 'bad_request', 'updated_since must be an ISO date/time');
    params.push(new Date(req.query.updated_since)); where.push(`${changed} >= $${params.length}`);
  }
  if (cur) { params.push(new Date(cur.t), cur.id); where.push(`(${changed}, id) > ($${params.length - 1}, $${params.length})`); }
  const rows = await db.many(`SELECT *, ${changed} AS _changed FROM ${mod.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${changed}, id LIMIT ${limit + 1}`, params);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  res.json({ data: page.map(r => applicationOut(mod, r, apiBase(req))), next_cursor: rows.length > limit ? encodeCursor(last._changed, last.id) : null });
}));

router.get('/applications/:module/:ref', requireScope('applications:read'), ah(async (req, res) => {
  const mod = moduleOf(req.params.module);
  const row = await findApplication(mod, req.params.ref);
  if (!row) throw new ApiError(404, 'not_found', 'Application not found');
  const history = await db.many('SELECT old_status, new_status, admin_comment, actor_name, created_at FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at', [mod.key, row.id]);
  res.json({ data: { ...applicationOut(mod, row, apiBase(req)), history } });
}));

router.patch('/applications/:module/:ref', requireScope('applications:write'), idempotent(ah(async (req, res) => {
  const mod = moduleOf(req.params.module);
  const row = await findApplication(mod, req.params.ref);
  if (!row) throw new ApiError(404, 'not_found', 'Application not found');
  const cols = await db.columns(mod.table);
  const statuses = cols.has('status') && !mod.noStatus ? await forms.statusesFor(mod.table) : [];
  const status = req.body?.status;
  const remarks = req.body?.remarks === undefined ? undefined : String(req.body.remarks || '').slice(0, 2000);
  if (status !== undefined && !statuses.includes(status)) throw new ApiError(422, 'validation_failed', `status must be one of: ${statuses.join(', ') || '(none)'}`);
  const data = {};
  if (status !== undefined) data.status = status;
  if (remarks !== undefined && cols.has(mod.remarksCol)) data[mod.remarksCol] = remarks;
  if (cols.has('reviewed_by')) data.reviewed_by = ('API: ' + req.apiClient.name).slice(0, 100);
  if (cols.has('reviewed_at')) data.reviewed_at = new Date();
  if (!Object.keys(data).length) throw new ApiError(422, 'validation_failed', 'Nothing to update (status / remarks)');
  const updated = await db.transaction(async () => {
    const u = await db.update(mod.table, row.id, await db.pick(mod.table, data));
    if (status !== undefined && status !== row.status) {
      await db.query(`INSERT INTO request_status_history (module, request_id, old_status, new_status, admin_comment, actor_admin_id, actor_name, created_at, notify_sent, admin_chose_to_notify)
                      VALUES ($1, $2, $3, $4, $5, NULL, $6, now(), 0, $7)`, [mod.key, row.id, row.status || null, status, remarks || null, ('API: ' + req.apiClient.name).slice(0, 100), req.body.notify ? 1 : 0]);
    }
    return u;
  });
  if (status !== undefined && status !== row.status) {
    const label = forms.statusLabel(status);
    if (req.body.notify && row.tracking_id) {
      notify.later(() => notify.applicationEvent('status_changed', { name: row[mod.nameCol], tracking_id: row.tracking_id, module: mod.title[0], status: label, remarks }, { phone: row[mod.phoneCol], email: row.email }));
    }
    notify.later(() => webhooks.emit('application.status_changed', { ...applicationOut(mod, updated, apiBase(req)), previous_status: row.status }, { originClientId: req.apiClient.id }));
  }
  res.json({ data: applicationOut(mod, updated, apiBase(req)) });
})));

router.get('/applications/:module/:ref/files/:field', requireScope('documents:read'), ah(async (req, res, next) => {
  const mod = moduleOf(req.params.module);
  const field = mod.fileFields.find(f => f.name === req.params.field);
  const row = field ? await findApplication(mod, req.params.ref) : null;
  if (!row || !row[field.name]) throw new ApiError(404, 'not_found', 'File not found');
  const file = resolveStored(req, row[field.name]);
  if (!file || !fs.existsSync(file)) throw new ApiError(404, 'not_found', 'File missing on disk');
  res.set('Cache-Control', 'no-store');
  res.download(file, `${row.tracking_id || row.id}-${field.name}${path.extname(file)}`, { dotfiles: 'allow' }, err => err && next(err));
}));

// ---------------------------------------------------------------- member documents (DMS ↔ portal)
function docOut(req, m, d) {
  return { id: d.id, doc_type: d.doc_type, title: d.title, mime_type: d.mime_type, size_bytes: d.size_bytes, external_ref: d.external_ref, visible_to_member: !!Number(d.visible_to_member),
    source: d.source, created_at: d.created_at, url: `${apiBase(req)}/members/${encodeURIComponent(m.sadasyata_number)}/documents/${d.id}/file` };
}

router.get('/members/:no/documents', requireScope('documents:read'), ah(async (req, res) => {
  const m = await mustMember(req.params.no);
  const docs = await db.many('SELECT * FROM member_documents WHERE member_id = $1 ORDER BY created_at DESC', [m.id]);
  res.json({ data: docs.map(d => docOut(req, m, d)) });
}));

const docUpload = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next(new ApiError(415, 'unsupported_media_type', 'Send multipart/form-data with a "file" field'));
  const [mw] = upload('dms', [{ name: 'file', kind: 'any' }], { maxMb: 25, private: true });
  mw(req, res, err => (err ? next(err) : next()));
};
router.post('/members/:no/documents', requireScope('documents:write'), docUpload, ah(async (req, res) => {
  const stored = req.uploaded?.file;
  if (req.uploadError || !stored) throw new ApiError(422, 'validation_failed', req.uploadError || 'file is required');
  let m;
  try { m = await mustMember(req.params.no); } catch (e) { remove(req, stored); throw e; }
  const file = resolveStored(req, stored);
  const d = await db.insert('member_documents', {
    member_id: m.id, doc_type: str(req.body.doc_type, 40) || 'other', title: str(req.body.title, 200) || path.basename(file), file_path: stored,
    mime_type: req.files?.file?.[0]?.mimetype || null, size_bytes: fs.statSync(file).size, external_ref: str(req.body.external_ref, 120) || null,
    visible_to_member: ['1', 'true', 'yes'].includes(String(req.body.visible_to_member || '').toLowerCase()) ? 1 : 0, source: (req.apiClient.system_type + ':' + req.apiClient.name).slice(0, 40),
  });
  res.status(201).json({ data: docOut(req, m, d) });
}));

router.get('/members/:no/documents/:id/file', requireScope('documents:read'), ah(async (req, res, next) => {
  const m = await mustMember(req.params.no);
  const d = await db.one('SELECT * FROM member_documents WHERE id = $1 AND member_id = $2', [util.int(req.params.id), m.id]);
  const file = d ? resolveStored(req, d.file_path) : null;
  if (!file || !fs.existsSync(file)) throw new ApiError(404, 'not_found', 'Document not found');
  res.set('Cache-Control', 'no-store');
  res.download(file, (d.title || 'document').replace(/[^\wऀ-ॿ .-]/g, '_').slice(0, 80) + path.extname(file), { dotfiles: 'allow' }, err => err && next(err));
}));

router.delete('/members/:no/documents/:id', requireScope('documents:write'), ah(async (req, res) => {
  const m = await mustMember(req.params.no);
  const d = await db.one('DELETE FROM member_documents WHERE id = $1 AND member_id = $2 RETURNING *', [util.int(req.params.id), m.id]);
  if (!d) throw new ApiError(404, 'not_found', 'Document not found');
  remove(req, d.file_path);
  res.status(204).end();
}));

// ---------------------------------------------------------------- errors (JSON only)
router.use((req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Unknown API endpoint' } }));
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'Body is not valid JSON' } });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: { code: 'too_large', message: 'Request body too large' } });
  console.error('api:', err);
  res.status(500).json({ error: { code: 'server_error', message: 'Internal error' } });
});

module.exports = router;
