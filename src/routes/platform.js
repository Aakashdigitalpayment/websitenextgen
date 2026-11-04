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
const QRCode = require('qrcode');
const totp = require('../lib/totp');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use((req, res, next) => {
  Object.assign(res.locals, { settings: {}, siteName: 'Cooperative Cloud', brandColor: '#0f766e', layout: 'platform' });
  next();
});

const render = (res, view, data) => res.render('platform/' + view, { layout: 'platform', ...data });

router.get('/login', (req, res) => render(res, 'login', { title: 'Platform login', error: null }));
// throttle: 5 per (user, IP), 20 per IP, 30 per account in 15 minutes
async function opThrottled(username, ip) {
  const r = await db.one(`SELECT count(*) FILTER (WHERE username = $1 AND ip_address = $2) AS pair, count(*) FILTER (WHERE ip_address = $2) AS by_ip,
                                 count(*) FILTER (WHERE username = $1) AS by_account
                          FROM platform.login_attempts WHERE attempted_at > now() - interval '15 minutes' AND (username = $1 OR ip_address = $2)`, [username, ip]);
  return r.pair >= 5 || r.by_ip >= 20 || r.by_account >= 30;
}
const opFail = (username, ip) => db.query('INSERT INTO platform.login_attempts (username, ip_address) VALUES ($1, $2)', [username, ip]);
const loginError = (res, error, code = 401) => res.status(code).render('platform/login', { layout: 'platform', title: 'Platform login', error });

router.post('/login', ah(async (req, res) => {
  const username = String(req.body.username || '').trim().toLowerCase().slice(0, 60);
  const password = String(req.body.password || '');
  if (await opThrottled(username, req.ip)) return loginError(res, 'Too many attempts. Try again in 15 minutes.', 429);
  let op = await db.one('SELECT * FROM platform.operators WHERE lower(username) = $1', [username]);
  // bootstrap the first operator from env (only while no operator exists)
  if (!op && config.platformUser && config.platformPassword && username === config.platformUser.toLowerCase()
      && crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(password).digest()), Buffer.from(crypto.createHash('sha256').update(config.platformPassword).digest()))
      && !(await db.value('SELECT count(*) FROM platform.operators'))) {
    op = await db.one('INSERT INTO platform.operators (username, password, full_name) VALUES ($1, $2, $3) RETURNING *', [username, await auth.hashPassword(password), 'Platform operator']);
  }
  if (!op || !(await auth.checkPassword(password, op.password))) {
    await opFail(username, req.ip);
    await new Promise(r => setTimeout(r, 400));
    return loginError(res, 'Invalid username or password.');
  }
  await db.query('DELETE FROM platform.login_attempts WHERE username = $1 AND ip_address = $2', [username, req.ip]);
  await new Promise((resolve, reject) => req.session.regenerate(e => (e ? reject(e) : resolve())));
  if (op.twofa_enabled && op.twofa_secret) {
    req.session.pendingOperator = { id: op.id, at: Date.now() };
    return res.redirect('/platform/login/2fa');
  }
  req.session.operatorId = op.id;
  await db.query('UPDATE platform.operators SET last_login = now() WHERE id = $1', [op.id]);
  res.redirect(op.twofa_enabled ? '/platform' : '/platform/2fa');
}));

const usedOpSteps = new Map();
router.get('/login/2fa', (req, res) => {
  const p = req.session.pendingOperator;
  if (!p || Date.now() - p.at > 5 * 60_000) return res.redirect('/platform/login');
  res.render('platform/login-2fa', { layout: 'platform', title: '2FA', error: null });
});
router.post('/login/2fa', ah(async (req, res) => {
  const p = req.session.pendingOperator;
  if (!p || Date.now() - p.at > 5 * 60_000) return res.redirect('/platform/login');
  const op = await db.one('SELECT * FROM platform.operators WHERE id = $1', [p.id]);
  if (!op) return res.redirect('/platform/login');
  if (await opThrottled('2fa:' + op.username, req.ip)) return res.status(429).render('platform/login-2fa', { layout: 'platform', title: '2FA', error: 'Too many attempts. Try again in 15 minutes.' });
  const step = totp.verify(op.twofa_secret, req.body.code);
  if (step === null || step <= (usedOpSteps.get(op.id) || 0)) {
    await opFail('2fa:' + op.username, req.ip);
    return res.status(401).render('platform/login-2fa', { layout: 'platform', title: '2FA', error: 'Invalid code.' });
  }
  usedOpSteps.set(op.id, step);
  delete req.session.pendingOperator;
  req.session.operatorId = op.id;
  await db.query('UPDATE platform.operators SET last_login = now() WHERE id = $1', [op.id]);
  res.redirect('/platform');
}));

router.use(ah(async (req, res, next) => {
  if (!req.session.operatorId) return res.redirect('/platform/login');
  req.operator = await db.one('SELECT id, username, full_name, twofa_enabled FROM platform.operators WHERE id = $1', [req.session.operatorId]);
  if (!req.operator) return res.redirect('/platform/login');
  res.locals.operator = req.operator;
  next();
}));

router.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/platform/login')));

router.get('/2fa', ah(async (req, res) => {
  const op = await db.one('SELECT twofa_enabled FROM platform.operators WHERE id = $1', [req.operator.id]);
  let qr = null;
  if (!op.twofa_enabled) {
    req.session.opTwofaSetup = req.session.opTwofaSetup || totp.generateSecret();
    qr = await QRCode.toDataURL(totp.provisioningUri('Cooperative Cloud', req.operator.username, req.session.opTwofaSetup), { margin: 1, width: 220 });
  }
  render(res, '2fa', { title: 'Two-factor authentication', enabled: op.twofa_enabled, qr, secret: req.session.opTwofaSetup || null });
}));
router.post('/2fa', ah(async (req, res) => {
  const op = await db.one('SELECT * FROM platform.operators WHERE id = $1', [req.operator.id]);
  const secret = req.session.opTwofaSetup;
  if (!secret || !(await auth.checkPassword(req.body.password, op.password)) || totp.verify(secret, req.body.code) === null) {
    flash(req, 'error', 'Password or code is wrong.');
    return res.redirect('/platform/2fa');
  }
  await db.query('UPDATE platform.operators SET twofa_secret = $1, twofa_enabled = true WHERE id = $2', [secret, op.id]);
  delete req.session.opTwofaSetup;
  flash(req, 'success', '2FA is on for your operator account.');
  res.redirect('/platform');
}));

/** Shared domain actions for the platform console and the tenant admin page. */
async function domainAction(tenantId, b) {
  const did = Number(b.domain_id) || 0;
  const owns = async () => !!(await db.value('SELECT 1 FROM platform.tenant_domains WHERE id = $1 AND tenant_id = $2', [did, tenantId]));
  switch (b.action) {
    case 'add': {
      const row = await tenants.addDomain(tenantId, b.domain);
      return row.status === 'active' ? `${row.domain} is active.` : `${row.domain} added — waiting for DNS. ${row.check && row.check.reason ? '(' + row.check.reason + ')' : ''}`;
    }
    case 'verify': {
      if (!(await owns())) throw new Error('Domain not found');
      const r = await tenants.verifyDomain(did);
      return r.status === 'active' ? `${r.domain} verified (${r.check.method}) and active.` : `${r.domain}: ${r.check.reason}`;
    }
    case 'primary':
      if (!(await owns())) throw new Error('Domain not found');
      await tenants.setPrimary(tenantId, did);
      return 'Primary domain changed.';
    case 'remove':
      await tenants.removeDomain(tenantId, b.domain);
      return 'Domain removed.';
    case 'redirect':
      await db.query('UPDATE platform.tenants SET redirect_to_primary = $1 WHERE id = $2', [b.value === '1', tenantId]);
      tenants.clearCache();
      return b.value === '1' ? 'Other addresses now redirect to the primary domain.' : 'Redirect turned off.';
    default: throw new Error('Unknown action');
  }
}

router.get('/', ah(async (req, res) => {
  const list = await tenants.list();
  for (const t of list) {
    t.stats = await db.withSchema(t.schema_name, async () => ({
      members: await db.value('SELECT count(*) FROM members WHERE deleted_at IS NULL'),
      pending: await db.value("SELECT count(*) FROM loan_applications WHERE status = 'pending' AND deleted_at IS NULL"),
      notices: await db.many("SELECT * FROM site_license_renewal_notices WHERE status = 'pending' ORDER BY id DESC"),
    })).catch(() => ({ members: '?', pending: '?', notices: [] }));
    t.license = require('../lib/license').status(t);
  }
  render(res, 'tenants', { title: 'Tenants', list, errors: {}, values: {}, baseDomain: config.baseDomain, dnsHelp: require('../lib/domains').instructions });
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
    render(res.status(422), 'tenants', { title: 'Tenants', list, errors: { _: e.message }, values: b, baseDomain: config.baseDomain, dnsHelp: require('../lib/domains').instructions });
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
    if (!(await tenants.get(id))) throw new Error('Tenant not found');
    flash(req, 'success', await domainAction(id, req.body));
  } catch (e) { flash(req, 'error', e.code === '23505' ? 'That domain is already used by a cooperative.' : e.message); }
  res.redirect('/platform#tenant-' + id);
}));

router.post('/tenants/:id/license', ah(async (req, res) => {
  const t = await tenants.get(Number(req.params.id));
  if (!t) return res.redirect('/platform');
  const until = /^\d{4}-\d{2}-\d{2}$/.test(req.body.until || '') ? req.body.until : null;
  await db.query('UPDATE platform.tenants SET license_valid_until = $1, license_note = $2, updated_at = now() WHERE id = $3', [until, String(req.body.note || '').slice(0, 500) || null, t.id]);
  const nid = Number(req.body.notice_id) || 0;
  if (nid) await db.withSchema(t.schema_name, () => db.query("UPDATE site_license_renewal_notices SET status = $1 WHERE id = $2", [req.body.notice_action === 'cancel' ? 'cancelled' : 'cleared', nid]));
  tenants.clearCache();
  flash(req, 'success', `Licence for ${t.slug}: ${until || 'no expiry'}`);
  res.redirect('/platform');
}));

router.post('/tenants/:id/migrate', ah(async (req, res) => {
  const t = await tenants.get(Number(req.params.id));
  const ran = t ? await tenants.migrateTenant(t) : [];
  flash(req, 'success', ran.length ? 'Applied: ' + ran.join(', ') : 'Already up to date.');
  res.redirect('/platform');
}));

module.exports = router;
module.exports.domainAction = domainAction;
