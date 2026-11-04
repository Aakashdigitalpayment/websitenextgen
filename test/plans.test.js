'use strict';
/** Plans: Lite / Basic / Advance / Extra Advance feature gating. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'pln.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const plans = require('../src/lib/plans');
const { createApp } = require('../src/app');

const SLUG = 'pl' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.pln.local`;
const PW = 'Admin@12345!';
let app, tenantId;

const setPlan = async p => { await db.query('UPDATE platform.tenants SET plan = $1 WHERE id = $2', [p, tenantId]); tenants.clearCache(); };
const adminAgent = async () => {
  const a = request.agent(app);
  const page = await a.get('/admin/login').set('Host', HOST);
  const _csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await a.post('/admin/login').set('Host', HOST).type('form').send({ _csrf, username: 'admin', password: PW });
  assert.equal(r.status, 302);
  return a;
};

before(async () => {
  await tenants.applyPlatformSchema();
  const t = await tenants.createTenant({ slug: SLUG, name: 'Plan Coop', domains: [HOST], adminPassword: PW, plan: 'lite', starterContent: false });
  tenantId = t.id;
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('feature map: longest prefix wins, resources and segment boundaries', () => {
  assert.equal(plans.featureFor('/member/programs').key, 'programmes');
  assert.equal(plans.featureFor('/member/login').key, 'member_portal');
  assert.equal(plans.featureFor('/admin/r/election_cycles').key, 'elections');
  assert.equal(plans.featureFor('/admin/r/notices'), null);
  assert.equal(plans.featureFor('/members-area'), null, 'segment boundary');
  assert.equal(plans.featureFor('/apply/loan').key, 'applications');
  assert.equal(plans.has('basic', 'applications'), true);
  assert.equal(plans.has('basic', 'member_portal'), false);
  assert.equal(plans.has('nonsense', 'api'), true, 'unknown plan = everything (legacy rows)');
});

test('Lite: website works; applications, member portal, API are blocked; links hidden', async () => {
  await setPlan('lite');
  const home = await request(app).get('/').set('Host', HOST);
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, /href="\/member\/login"/);
  assert.doesNotMatch(home.text, /class="quick-link" href="\/apply/);
  assert.equal((await request(app).get('/notices').set('Host', HOST)).status, 200);
  assert.equal((await request(app).get('/apply/loan').set('Host', HOST)).status, 404);
  assert.equal((await request(app).get('/member/login').set('Host', HOST)).status, 404);
  const api = await request(app).get('/api/v1/ping').set('Host', HOST);
  assert.equal(api.status, 403);
  assert.equal(api.body.error.code, 'plan_required');

  const a = await adminAgent();
  const dash = await a.get('/admin').set('Host', HOST);
  assert.equal(dash.status, 200);
  assert.doesNotMatch(dash.text, /href="\/admin\/inbox\//, 'sidebar links outside the plan are removed');
  assert.match(dash.text, /href="\/admin\/plan"/);
  const locked = await a.get('/admin/members').set('Host', HOST);
  assert.equal(locked.status, 403);
  assert.match(locked.text, /href="\/admin\/plan"/);
  assert.equal((await a.get('/admin/plan').set('Host', HOST)).status, 200);
});

test('Basic unlocks applications; Advance unlocks the member portal; Extra unlocks the API', async () => {
  await setPlan('basic');
  assert.equal((await request(app).get('/apply/loan').set('Host', HOST)).status, 200);
  assert.equal((await request(app).get('/member/login').set('Host', HOST)).status, 404);
  await setPlan('advance');
  assert.equal((await request(app).get('/member/login').set('Host', HOST)).status, 200);
  assert.equal((await request(app).get('/api/v1/ping').set('Host', HOST)).status, 403);
  await setPlan('extra');
  assert.equal((await request(app).get('/api/v1/ping').set('Host', HOST)).status, 401, 'reaches the API (no key)');
});

test('staff user limit follows the plan', async () => {
  await setPlan('lite'); // 2 staff
  const a = await adminAgent();
  const page = await a.get('/admin/users').set('Host', HOST);
  const _csrf = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  const add = n => a.post('/admin/users').set('Host', HOST).type('form').send({ _csrf, username: 'staff' + n, full_name: 'Staff ' + n, password: 'Staff@12345!', role: 'staff' });
  await add(1);
  await add(2);
  const n = await db.withSchema(`tenant_${SLUG}`, () => db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL'));
  assert.equal(Number(n), 2);
});
