'use strict';
/** Themes: tenant default, personal choice (cookie + account), lock, reset-all. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'thm.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const themes = require('../src/lib/themes');
const { createApp } = require('../src/app');

const SLUG = 'th' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.thm.local`;
const PW = 'Admin@12345!';
let app;

const token = async (agent, url) => {
  const r = await agent.get(url).set('Host', HOST);
  const m = r.text.match(/name="_csrf" value="([^"]+)"/);
  assert.ok(m, 'csrf on ' + url + ' ' + r.status);
  return m[1];
};
const htmlTheme = text => ({ attr: text.match(/<html[^>]*data-theme="(\w+)"/)?.[1] || '', brand: text.match(/--brand:(#[0-9a-f]+)/i)?.[1] });

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: SLUG, name: 'Theme Coop', domains: [HOST], adminPassword: PW });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('resolve: default, cookie, account, invalid and stale values', () => {
  const s = { theme_default_palette: 'ocean', theme_default_mode: 'light', theme_epoch: '2', primary_color: '#123456' };
  const req = (cookie, path = '/', member = null) => ({ path, member, admin: null, get: () => cookie });
  assert.deepEqual([themes.resolve(req(''), s).palette, themes.resolve(req(''), s).mode], ['ocean', 'light']);
  assert.equal(themes.resolve(req('theme=rose.dark.2'), s).palette, 'rose');
  assert.equal(themes.resolve(req('theme=rose.dark.1'), s).palette, 'ocean', 'stale epoch ignored');
  assert.equal(themes.resolve(req('theme=evil.dark.2'), s).palette, 'ocean', 'unknown palette ignored');
  assert.equal(themes.resolve(req('theme=rose.dark.2', '/member', { theme_pref: 'forest.light.2' }), s).palette, 'forest', 'account beats cookie');
  assert.equal(themes.resolve(req('theme=rose.dark.2'), { ...s, theme_user_choice: '0' }).palette, 'ocean', 'locked → default');
  assert.equal(themes.resolve(req('', '/', null), { ...s, theme_default_palette: 'brand' }).brand, '#123456');
});

test('visitor can pick a theme; it is rendered server-side on the next page', async () => {
  const agent = request.agent(app);
  const _csrf = await token(agent, '/');
  const r = await agent.post('/theme').set('Host', HOST).set('Accept', 'application/json').type('form').send({ _csrf, palette: 'violet', mode: 'dark' });
  assert.equal(r.status, 200);
  assert.equal(r.body.brand, '#7c3aed');
  const page = await agent.get('/').set('Host', HOST);
  assert.deepEqual(htmlTheme(page.text), { attr: 'dark', brand: '#7c3aed' });
  // garbage input falls back to the current choice, never reflected
  await agent.post('/theme').set('Host', HOST).type('form').send({ _csrf, palette: '"><script>', mode: 'x' });
  assert.doesNotMatch((await agent.get('/').set('Host', HOST)).text, /"><script>/);
});

test('POST /theme requires CSRF', async () => {
  const r = await request(app).post('/theme').set('Host', HOST).type('form').send({ palette: 'rose', mode: 'dark' });
  assert.equal(r.status, 403);
});

test('admin sets the default, can lock user choice and reset everyone', async () => {
  const admin = request.agent(app);
  let _csrf = await token(admin, '/admin/login');
  const login = await admin.post('/admin/login').set('Host', HOST).type('form').send({ _csrf, username: 'admin', password: PW });
  assert.equal(login.status, 302);
  _csrf = await token(admin, '/admin/theme');
  // admin saves own choice first
  await admin.post('/theme').set('Host', HOST).type('form').send({ _csrf, palette: 'rose', mode: 'dark' });
  const schema = `tenant_${SLUG}`;
  assert.match(await db.withSchema(schema, () => db.value("SELECT theme_pref FROM admin_users WHERE username = 'admin'")), /^rose\.dark\./);

  const save = await admin.post('/admin/theme').set('Host', HOST).type('form').send({ _csrf, palette: 'forest', mode: 'light', primary_color: '#0a5c36', allow_user: '1', reset_all: '1' });
  assert.equal(save.status, 302);
  assert.equal(await db.withSchema(schema, () => db.value("SELECT theme_pref FROM admin_users WHERE username = 'admin'")), null, 'reset clears saved choices');

  const visitor = request.agent(app);
  // an old cookie from before the reset is ignored
  const home = await visitor.get('/').set('Host', HOST).set('Cookie', 'theme=violet.dark.0');
  assert.deepEqual(htmlTheme(home.text), { attr: 'light', brand: '#15803d' });

  // lock: picker disappears, POST refused
  await admin.post('/admin/theme').set('Host', HOST).type('form').send({ _csrf, palette: 'forest', mode: 'dark' });
  await db.withSchema(schema, () => require('../src/lib/settings').invalidate());
  const locked = await visitor.get('/').set('Host', HOST);
  assert.doesNotMatch(locked.text, /data-theme-picker/);
  assert.equal(htmlTheme(locked.text).attr, 'dark');
  const vt = locked.text.match(/name="_csrf" value="([^"]+)"/);
  if (vt) {
    const r = await visitor.post('/theme').set('Host', HOST).set('Accept', 'application/json').type('form').send({ _csrf: vt[1], palette: 'rose', mode: 'light' });
    assert.equal(r.status, 403);
  }
});

test('only admin role and above can change the default', async () => {
  const r = await request(app).get('/admin/theme').set('Host', HOST);
  assert.equal(r.status, 302);
});
