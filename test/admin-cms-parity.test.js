'use strict';
/**
 * Admin panel / CMS parity (docs/parity/3-admin-system.md): admin 2FA policy + forced enrolment,
 * security page, settings registry, legacy setting keys, about sections, audit filters,
 * institutional profile indicators, profile, idle timeout, users for admins, resource extras.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'acp.local';
process.env.PLATFORM_HOST = 'platform.acp.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const auth = require('../src/lib/auth');
const totp = require('../src/lib/totp');
const settings = require('../src/lib/settings');
const config = require('../src/config');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'acp' + SUFFIX;
const HA = `${A}.acp.local`;
const PW = 'Admin@12345!';
let app, admin;
const inA = fn => db.withSchema('tenant_' + A, fn);

function client(host = HA) {
  const agent = request.agent(app);
  return {
    agent,
    get: url => agent.get(url).set('Host', host),
    async token(url) {
      const r = await agent.get(url).set('Host', host);
      const m = r.text.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(m, 'csrf token on ' + url + ' (' + r.status + ')');
      return m[1];
    },
    async form(url, data, tokenUrl = url) {
      const _csrf = await this.token(tokenUrl);
      return agent.post(url).set('Host', host).type('form').send({ _csrf, ...data });
    },
  };
}
const setSetting = (k, v) => inA(async () => { await settings.set(k, v); settings.invalidate(); });

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'CMS A', domains: [HA], adminPassword: PW });
  await inA(async () => {
    await db.query('UPDATE admin_users SET must_change_password = 0');
    await db.query(`INSERT INTO admin_users (username, password, full_name, role, is_active, status) VALUES ('editor1', $1, 'Ed', 'editor', 1, 'active'), ('admin2', $1, 'Ad', 'admin', 1, 'active')`, [await auth.hashPassword(PW)]);
  });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  admin = client();
  const r = await admin.form('/admin/login', { username: 'admin', password: PW }, '/admin/login');
  assert.equal(r.status, 302);
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${A} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [A]);
  fs.rmSync(path.join(config.uploadDir, A), { recursive: true, force: true });
  await db.pool.end();
});

// ---------------------------------------------------------------- P1-1 admin 2FA policy
test('admin 2FA policy: off by default; when required, sign-in enrols, shows backup codes once, then signs in', async () => {
  assert.equal(await inA(() => settings.get('admin_2fa_required')), '0');
  // policy off: an editor without 2FA signs straight in
  let c = client();
  let r = await c.form('/admin/login', { username: 'editor1', password: PW }, '/admin/login');
  assert.equal(r.headers.location, '/admin');

  await setSetting('admin_2fa_required', '1');
  // the session that signed in before the policy is sent to enrol
  r = await c.get('/admin/r/news');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/admin/2fa');

  c = client();
  r = await c.form('/admin/login', { username: 'editor1', password: PW }, '/admin/login');
  assert.equal(r.headers.location, '/admin/login/2fa');
  r = await c.get('/admin/login/2fa');
  assert.match(r.text, /data:image\/png;base64/);
  const secret = r.text.match(/class="secret-key">([A-Z2-7 ]+)</)[1].replace(/ /g, '');
  r = await c.form('/admin/login/2fa', { code: '000000' }, '/admin/login/2fa');
  assert.equal(r.status, 401);
  r = await c.form('/admin/login/2fa', { code: totp.codeAt(secret, totp.currentStep()) }, '/admin/login/2fa');
  assert.equal(r.status, 200);
  const codes = [...r.text.matchAll(/<div>([A-Z0-9-]{8,})<\/div>/g)].map(m => m[1]);
  assert.equal(codes.length, 8);
  const tok = r.text.match(/name="_csrf" value="([^"]+)"/)[1];
  // not signed in until the codes are acknowledged
  assert.equal((await c.get('/admin')).status, 302);
  r = await c.agent.post('/admin/login/2fa/ack').set('Host', HA).type('form').send({ _csrf: tok, saved: '1' });
  assert.equal(r.headers.location, '/admin');
  assert.equal((await c.get('/admin')).status, 200);
  const u = await inA(() => db.one("SELECT twofa_enabled, twofa_secret FROM admin_users WHERE username = 'editor1'"));
  assert.equal(Number(u.twofa_enabled), 1);
  assert.equal(u.twofa_secret, secret);
  // cannot be turned off while required
  r = await c.form('/admin/2fa/disable', { password: PW, code: totp.codeAt(secret, totp.currentStep()) }, '/admin/2fa');
  assert.equal(Number(await inA(() => db.value("SELECT twofa_enabled FROM admin_users WHERE username = 'editor1'"))), 1);
  // next sign-in verifies with the enrolled secret
  const c2 = client();
  r = await c2.form('/admin/login', { username: 'editor1', password: PW }, '/admin/login');
  assert.equal(r.headers.location, '/admin/login/2fa');
  r = await c2.form('/admin/login/2fa', { code: codes[0] }, '/admin/login/2fa');
  assert.equal(r.headers.location, '/admin');
  await setSetting('admin_2fa_required', '0');
});

test('security page: superadmin only, password confirmed, audited', async () => {
  assert.equal((await admin.get('/admin/security')).status, 200);
  let r = await admin.form('/admin/security', { admin_2fa_required: '1', admin_idle_minutes: '2', confirm_password: 'wrong' }, '/admin/security');
  assert.equal(await inA(() => settings.get('admin_2fa_required')), '0');
  r = await admin.form('/admin/security', { admin_idle_minutes: '2', turnstile_site_key: 'abc', turnstile_secret_key: 'sec', confirm_password: PW }, '/admin/security');
  assert.equal(r.status, 302);
  await inA(() => settings.invalidate());
  const s = await inA(() => settings.all());
  assert.equal(s.admin_idle_minutes, '5'); // clamped
  assert.equal(s.turnstile_secret_key, 'sec');
  await admin.form('/admin/security', { admin_idle_minutes: '30', turnstile_site_key: 'abc', turnstile_clear_secret: '1', confirm_password: PW }, '/admin/security');
  await inA(() => settings.invalidate());
  assert.equal(await inA(() => settings.get('turnstile_secret_key')), '');
  assert.ok(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'security_settings_update'")));
  const ed = client();
  await ed.form('/admin/login', { username: 'admin2', password: PW }, '/admin/login');
  assert.equal((await ed.get('/admin/security')).status, 403);
});
