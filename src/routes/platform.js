'use strict';
/**
 * Platform console (served only on PLATFORM_HOST): operators create and manage tenants.
 * Operators live in platform.operators; the first one can be bootstrapped from
 * PLATFORM_ADMIN_USER / PLATFORM_ADMIN_PASSWORD.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const auth = require('../lib/auth');
const tenants = require('../lib/tenants');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  Object.assign(res.locals, { settings: {}, siteName: 'Cooperative Cloud', brandColor: '#0f766e', layout: 'platform' });
  next();
});

const render = (res, view, data) => res.render('platform/' + view, { layout: 'platform', ...data });

router.get('/login', (req, res) => render(res, 'login', { title: 'Platform login', error: null }));
router.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  let op = await db.one('SELECT * FROM platform.operators WHERE lower(username) = lower($1)', [username]);
  // bootstrap the first operator from env
  if (!op && config.platformUser && config.platformPassword && username === config.platformUser
      && crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(password).digest()), Buffer.from(crypto.createHash('sha256').update(config.platformPassword).digest()))
      && !(await db.value('SELECT count(*) FROM platform.operators'))) {
    op = await db.one('INSERT INTO platform.operators (username, password, full_name) VALUES ($1, $2, $3) RETURNING *', [username, await auth.hashPassword(password), 'Platform operator']);
  }
  if (!op || !(await auth.checkPassword(password, op.password))) {
    await new Promise(r => setTimeout(r, 600));
    return res.status(401).render('platform/login', { layout: 'platform', title: 'Platform login', error: 'Invalid username or password.' });
  }
  await new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));
  req.session.operatorId = op.id;
  await db.query('UPDATE platform.operators SET last_login = now() WHERE id = $1', [op.id]);
  res.redirect('/platform');
}));

router.use(ah(async (req, res, next) => {
  if (!req.session.operatorId) return res.redirect('/platform/login');
  req.operator = await db.one('SELECT id, username, full_name FROM platform.operators WHERE id = $1', [req.session.operatorId]);
  if (!req.operator) return res.redirect('/platform/login');
  res.locals.operator = req.operator;
  next();
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/platform/login')));

router.get('/', ah(async (req, res) => {
  const list = await tenants.list();
  for (const t of list) {
    t.stats = await db.withSchema(t.schema_name, async () => ({
      members: await db.value('SELECT count(*) FROM members WHERE deleted_at IS NULL'),
      pending: await db.value("SELECT count(*) FROM loan_applications WHERE status = 'pending' AND deleted_at IS NULL"),
    })).catch(() => ({ members: '?', pending: '?' }));
  }
  render(res, 'tenants', { title: 'Tenants', list, errors: {}, values: {}, baseDomain: config.baseDomain });
}));

router.post('/tenants', ah(async (req, res) => {
  const b = req.body;
  const domains = String(b.domains || '').split(/[\s,]+/).filter(Boolean);
  if (!domains.length && b.slug) domains.push(`${String(b.slug).toLowerCase()}.${config.baseDomain}`);
  const password = b.admin_password || crypto.randomBytes(9).toString('base64url');
  try {
    const t = await tenants.createTenant({ slug: b.slug, name: b.name, nameEn: b.name_en, domains, adminUsername: b.admin_username || 'admin', adminPassword: password, contactEmail: b.contact_email || null });
    flash(req, 'success', `Tenant "${t.slug}" created. Admin login: ${b.admin_username || 'admin'} / ${password} — share it securely; they must change it.`);
    res.redirect('/platform');
  } catch (e) {
    const list = await tenants.list();
    render(res.status(422), 'tenants', { title: 'Tenants', list, errors: { _: e.message }, values: b, baseDomain: config.baseDomain });
  }
}));

router.post('/tenants/:id/status', ah(async (req, res) => {
  await tenants.setStatus(Number(req.params.id), req.body.status);
  flash(req, 'success', 'Status updated.');
  res.redirect('/platform');
}));

router.post('/tenants/:id/domains', ah(async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (req.body.action === 'remove') await tenants.removeDomain(id, req.body.domain);
    else if (/^[a-z0-9.-]{3,253}$/i.test(String(req.body.domain || '').trim())) await tenants.addDomain(id, req.body.domain.trim());
    else throw new Error('Invalid domain');
    flash(req, 'success', 'Domains updated.');
  } catch (e) { flash(req, 'error', e.code === '23505' ? 'That domain is already mapped.' : e.message); }
  res.redirect('/platform');
}));

router.post('/tenants/:id/migrate', ah(async (req, res) => {
  const t = await tenants.get(Number(req.params.id));
  const ran = t ? await tenants.migrateTenant(t) : [];
  flash(req, 'success', ran.length ? 'Applied: ' + ran.join(', ') : 'Already up to date.');
  res.redirect('/platform');
}));

module.exports = router;
