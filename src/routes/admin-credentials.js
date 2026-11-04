'use strict';
/** Office credential manager (superadmin only). Mounted at /admin/credentials. Every reveal/copy is logged. */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const vault = require('../lib/credentials-crypto');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('superadmin'));

async function logAction(req, id, action) {
  await db.query(`INSERT INTO office_credentials_log (credential_id, admin_id, admin_username, action, ip_address, user_agent, created_at) VALUES ($1, $2, $3, $4, $5, $6, now())`,
    [id, req.admin.id, req.admin.username, action, req.ip, String(req.get('user-agent') || '').slice(0, 255)]);
}

router.get('/', ah(async (req, res) => {
  const rows = await db.many('SELECT id, site_name, site_url, username, category, notes, is_active, password_tag IS NULL AS legacy, updated_at FROM office_credentials WHERE is_active = 1 ORDER BY category, sort_order, site_name');
  const logs = await db.many(`SELECT l.*, c.site_name FROM office_credentials_log l LEFT JOIN office_credentials c ON c.id = l.credential_id ORDER BY l.id DESC LIMIT 30`);
  res.render('admin/credentials', { title: res.locals.t('कार्यालय पासवर्ड व्यवस्थापन', 'Office credentials'), rows, logs, enabled: vault.enabled(), edit: null, errors: {} });
}));

router.get('/:id/edit', ah(async (req, res, next) => {
  const edit = await db.one('SELECT id, site_name, site_url, username, category, notes FROM office_credentials WHERE id = $1', [util.int(req.params.id)]);
  if (!edit) return next();
  const rows = await db.many('SELECT id, site_name, site_url, username, category, notes, is_active, password_tag IS NULL AS legacy, updated_at FROM office_credentials WHERE is_active = 1 ORDER BY category, sort_order, site_name');
  res.render('admin/credentials', { title: res.locals.t('कार्यालय पासवर्ड व्यवस्थापन', 'Office credentials'), rows, logs: [], enabled: vault.enabled(), edit, errors: {} });
}));

router.post('/', ah(async (req, res) => {
  if (!vault.enabled()) { flash(req, 'error', 'CREDENTIALS_KEY is not configured on the server.'); return res.redirect('/admin/credentials'); }
  const b = req.body;
  const id = util.int(b.id, 0);
  const data = {
    site_name: String(b.site_name || '').trim().slice(0, 120), site_url: String(b.site_url || '').trim().slice(0, 500),
    username: String(b.username || '').trim().slice(0, 255), category: String(b.category || 'general').trim().slice(0, 60) || 'general',
    notes: String(b.notes || '').trim().slice(0, 2000) || null, updated_by: req.admin.id,
  };
  if (!data.site_name || !data.username || (data.site_url && !/^https?:\/\//i.test(data.site_url))) {
    flash(req, 'error', res.locals.t('नाम, प्रयोगकर्ता र सही URL (https://) चाहिन्छ।', 'Name, username and a valid URL (https://) are required.'));
    return res.redirect('/admin/credentials' + (id ? `/${id}/edit` : ''));
  }
  if (b.password) Object.assign(data, vault.encrypt(String(b.password).slice(0, 500)));
  if (id) {
    await db.update('office_credentials', id, data);
    await logAction(req, id, b.password ? 'edit_password' : 'edit');
  } else {
    if (!b.password) { flash(req, 'error', res.locals.t('पासवर्ड चाहिन्छ।', 'Password is required.')); return res.redirect('/admin/credentials'); }
    const row = await db.insert('office_credentials', { ...data, is_active: 1, sort_order: 0, created_by: req.admin.id });
    await logAction(req, row.id, 'create');
  }
  flash(req, 'success', res.locals.t('सुरक्षित गरियो।', 'Saved.'));
  res.redirect('/admin/credentials');
}));

// reveal: returns the password as JSON (fetched on demand, never rendered into the page)
router.post('/:id/reveal', ah(async (req, res) => {
  const row = await db.one('SELECT * FROM office_credentials WHERE id = $1 AND is_active = 1', [util.int(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'not found' });
  try {
    const { plain, legacy } = vault.decrypt(row);
    if (legacy && vault.enabled()) await db.update('office_credentials', row.id, vault.encrypt(plain)); // upgrade CBC → GCM
    await logAction(req, row.id, req.body.action === 'copy' ? 'copy_pass' : 'view');
    res.set('Cache-Control', 'no-store').json({ password: plain });
  } catch (e) {
    res.status(422).json({ error: e.message });
  }
}));

router.post('/:id/delete', ah(async (req, res) => {
  await db.query('UPDATE office_credentials SET is_active = 0, password_enc = $1, password_iv = $1, password_tag = NULL WHERE id = $2', ['', util.int(req.params.id)]);
  await logAction(req, util.int(req.params.id), 'delete');
  flash(req, 'success', res.locals.t('हटाइयो।', 'Deleted.'));
  res.redirect('/admin/credentials');
}));

module.exports = router;
