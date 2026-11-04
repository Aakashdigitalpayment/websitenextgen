'use strict';
/** Starter designs, per-tenant layout (menu placement / home style / corners) and language policy. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'dsn.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const settings = require('../src/lib/settings');
const starter = require('../src/lib/starter');
const { createApp } = require('../src/app');

const SFX = Date.now().toString(36).slice(-5);
const A = 'da' + SFX, B = 'db' + SFX;
const host = s => `${s}.dsn.local`;
let app;

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'कृषि सहकारी', domains: [host(A)], adminPassword: 'Admin@12345!', design: 'agriculture' });
  await tenants.createTenant({ slug: B, name: 'Plain Coop', domains: [host(B)], adminPassword: 'Admin@12345!', starterContent: false });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  for (const s of [A, B]) {
    await db.query(`DROP SCHEMA IF EXISTS tenant_${s} CASCADE`);
    await db.query('DELETE FROM platform.tenants WHERE slug = $1', [s]);
  }
  await db.pool.end();
});

test('a new tenant is born with its design: layout classes, colour and starter content', async () => {
  const r = await request(app).get('/').set('Host', host(A));
  assert.equal(r.status, 200);
  assert.match(r.text, /<body class="hdr-bar home-banner corners-soft"/);
  assert.match(r.text, /--brand:#15803d/);
  assert.match(r.text, /\/starter-art\/farm\.svg/);
  await db.withSchema(`tenant_${A}`, async () => {
    assert.ok(Number(await db.value('SELECT count(*) FROM services')) >= 6);
    assert.ok(Number(await db.value('SELECT count(*) FROM faqs')) >= 5);
    assert.equal(Number(await db.value('SELECT count(*) FROM committee_tenures WHERE is_current = 1')), 4);
    assert.equal(Number(await db.value('SELECT count(*) FROM committee_members')), 0, 'no fake people');
  });
  const art = await request(app).get('/starter-art/farm.svg').set('Host', host(A)).buffer(true).parse((res, cb) => { let d = ''; res.on('data', c => { d += c; }); res.on('end', () => cb(null, d)); });
  assert.equal(art.status, 200);
  assert.match(art.headers['content-type'], /image\/svg\+xml/);
  assert.match(art.body, /#15803d/);
  assert.equal((await request(app).get('/starter-art/nope.svg').set('Host', host(A))).status, 404);
});

test('starterContent:false keeps the site empty but still applies the look', async () => {
  const r = await request(app).get('/').set('Host', host(B));
  assert.match(r.text, /hdr-classic home-split/);
  await db.withSchema(`tenant_${B}`, async () => assert.equal(Number(await db.value('SELECT count(*) FROM services')), 0));
});

test('applying a design again never duplicates content', async () => {
  await db.withSchema(`tenant_${A}`, async () => {
    const before = Number(await db.value('SELECT count(*) FROM services'));
    await starter.apply('women', { content: true });
    assert.equal(Number(await db.value('SELECT count(*) FROM services')), before);
    assert.equal(await settings.get('layout_header'), 'centered');
  });
});

test('language policy: tenant default, explicit choice, single-language sites', async () => {
  await db.withSchema(`tenant_${B}`, async () => { await settings.set('lang_default', 'en', { group: 'appearance' }); });
  let r = await request(app).get('/').set('Host', host(B));
  assert.match(r.text, /<html lang="en"/, 'default language applied');
  r = await request(app).get('/').set('Host', host(B)).set('Cookie', 'lang=np');
  assert.match(r.text, /<html lang="ne"/, 'visitor choice wins');
  await db.withSchema(`tenant_${B}`, async () => { await settings.set('lang_enabled', 'np', { group: 'appearance' }); });
  r = await request(app).get('/').set('Host', host(B)).set('Cookie', 'lang=en');
  assert.match(r.text, /<html lang="ne"/, 'only Nepali offered');
  assert.doesNotMatch(r.text, /class="lang-switch"/);
  const sw = await request(app).get('/lang/en?next=/').set('Host', host(B));
  assert.match(sw.headers['set-cookie'].join(';'), /lang=np/);
});

test('invalid layout values fall back safely', () => {
  const L = require('../src/lib/layouts');
  assert.equal(L.resolve({ layout_header: '"><script>', layout_home: 'x' }).bodyClass, 'hdr-classic home-split corners-rounded');
});
