'use strict';
/** Security review round 2 — each test reproduces a finding and asserts it no longer works. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'sr2.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const db = require('../src/db');
const config = require('../src/config');
const tenants = require('../src/lib/tenants');
const kym = require('../src/lib/kym');
const portal = require('../src/lib/member-portal');
const plans = require('../src/lib/plans');
const antispam = require('../src/lib/antispam');
const { createApp } = require('../src/app');

const SLUG = 'sr' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.sr2.local`;
const SCHEMA = `tenant_${SLUG}`;
let app;
const inT = fn => db.withSchema(SCHEMA, fn);

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: SLUG, name: 'Sec Coop', domains: [HOST], adminPassword: 'Admin@12345!', starterContent: false });
  const priv = path.join(config.uploadDir, SLUG, '_private', 'reports');
  fs.mkdirSync(priv, { recursive: true });
  fs.writeFileSync(path.join(priv, 'annual-2080.pdf'), '%PDF-1.4 secret');
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  fs.rmSync(path.join(config.uploadDir, SLUG), { recursive: true, force: true });
  await db.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('private uploads cannot be reached through path tricks', async () => {
  for (const p of ['/uploads/_private/reports/annual-2080.pdf', '/uploads//_private/reports/annual-2080.pdf', '/uploads/news/../_private/reports/annual-2080.pdf',
    '/uploads/%2e/_private/reports/annual-2080.pdf', '/uploads/news/%2e%2e/_private/reports/annual-2080.pdf', '/uploads/_PRIVATE/reports/annual-2080.pdf']) {
    const r = await request(app).get(p).set('Host', HOST);
    assert.notEqual(r.status, 200, p);
    assert.doesNotMatch(r.text || '', /secret/, p);
  }
});

test('anti-spam regex is linear on hostile input', () => {
  const t0 = Date.now();
  antispam.looksLikeSpam('-a'.repeat(125_000));
  antispam.looksLikeSpam('a.'.repeat(125_000) + '!');
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  assert.equal(antispam.looksLikeSpam('visit cheap-loans.xyz now'), true);
  assert.equal(antispam.looksLikeSpam('मेरो खाता नम्बर बारे जानकारी चाहियो'), false);
});

test('a public KYM cannot change the member email/phone (account takeover)', async () => {
  await inT(async () => {
    const m = await db.one("INSERT INTO members (name, sadasyata_number, phone, email, approval_status, is_active) VALUES ('Victim', 'V-1', '9811111111', 'victim@coop.np', 'approved', 1) RETURNING id");
    const k = await db.one("INSERT INTO kyc_applications (full_name, member_id, mobile, email, status, created_at) VALUES ('Attacker', 'V-1', '9822222222', 'attacker@x.com', 'pending', now()) RETURNING id");
    await kym.afterKycWrite(k.id, { syncContact: false });
    const after1 = await db.one('SELECT email, phone, name FROM members WHERE id = $1', [m.id]);
    assert.equal(after1.email, 'victim@coop.np');
    assert.equal(after1.phone, '9811111111');
    assert.equal(after1.name, 'Victim');
    // trusted writes (office / the member themself) still sync
    await kym.afterKycWrite(k.id, { syncContact: true });
    assert.equal((await db.one('SELECT email FROM members WHERE id = $1', [m.id])).email, 'attacker@x.com');
  });
});

test('phone matching is exact; registering on an existing record needs office approval', async () => {
  assert.equal(portal.phonesMatch('9811111111', '1111111'), false);
  assert.equal(portal.phonesMatch('1111111', '9811111111'), false);
  assert.equal(portal.phonesMatch('+977 981-1111111', '9811111111'), true);
  assert.equal(kym.phonesMatch('9811111111', '11111111'), false);
  await inT(async () => {
    await db.query("INSERT INTO members (name, sadasyata_number, phone, approval_status, is_active) VALUES ('Stub', 'S-9', '9833333333', 'approved', 1)");
    const r = await portal.register({ sadasyata: 'S-9', email: 'new@x.com', phone: '9833333333', password: 'Str0ng!Passw0rd', confirm: 'Str0ng!Passw0rd' }, (np, en) => en);
    assert.ok(!r.error, r.error);
    assert.equal(r.member.approval_status, 'pending');
  });
});

test('plan gating ignores URL letter case', async () => {
  await db.query("UPDATE platform.tenants SET plan = 'lite' WHERE slug = $1", [SLUG]);
  tenants.clearCache();
  for (const p of ['/MEMBER/login', '/Apply/loan', '/Verify']) assert.equal((await request(app).get(p).set('Host', HOST)).status, 404, p);
  assert.equal(plans.featureFor('/ADMIN/Backup').key, 'backups');
  await db.query("UPDATE platform.tenants SET plan = 'extra' WHERE slug = $1", [SLUG]);
  tenants.clearCache();
});

test('tracker by phone + email never lists rows with a blank email; membership duplicate hides the tracking ID', async () => {
  await inT(async () => {
    await db.query("INSERT INTO grievances (tracking_id, name, phone, email, subject, description, status, created_at) VALUES ('GR-ATT-1', 'Att', '9844444444', 'att@x.com', 's', 'm', 'pending', now()), ('GR-VIC-1', 'Victim', '9844444444', '', 's', 'secret', 'pending', now())");
    await db.query("INSERT INTO membership_applications (tracking_id, full_name, mobile, status, created_at) VALUES ('MB-VIC-1', 'Victim', '9855555555', 'pending', now())").catch(() => {});
  });
  const page = request.agent(app);
  const g = await page.get('/track?mode=contact').set('Host', HOST);
  const _csrf = (g.text.match(/name="_csrf" value="([^"]+)"/) || [])[1];
  const r = await page.post('/track').set('Host', HOST).type('form').send({ _csrf, phone: '9844444444', email: 'att@x.com', proof: 'GR-ATT-1' });
  assert.match(r.text, /GR-ATT-1/, 'own application is listed');
  assert.doesNotMatch(r.text, /GR-VIC-1/);
  const dup = await inT(() => require('../src/lib/submissions').hooks.membership({ data: { mobile: '9855555555' }, lang: 'en' }));
  assert.ok(dup && dup.duplicate);
  assert.equal(dup.row.tracking_id, null);
  assert.doesNotMatch(JSON.stringify(dup.notice), /MB-VIC-1/);
});
