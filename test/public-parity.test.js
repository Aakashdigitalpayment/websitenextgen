'use strict';
/** Public website parity with the PHP site (docs/parity/1-public.md). */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const nd = require('../src/lib/nepali-date');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'pp' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
let app;

const get = (url, agent) => (agent || request(app)).get(url).set('Host', HA);
const setting = (k, v) => inA(() => require('../src/lib/settings').set(k, v));
const clearCaches = () => inA(async () => { require('../src/lib/settings').invalidate(); require('../src/lib/navigation').invalidate(); require('../src/lib/public-cache').clear(); });

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Public A', domains: [HA], adminPassword: PW });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${A} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [A]);
  fs.rmSync(path.join(config.uploadDir, A), { recursive: true, force: true });
  await db.pool.end();
});

// ---------------------------------------------------------------- P1-1 BS dates in DATE columns
test('BS dates typed into DATE columns: display as BS, compare as AD, normalise', async () => {
  assert.equal(nd.isBsLike('2082-03-15'), true);
  assert.equal(nd.isBsLike('2025-06-29'), false);
  assert.equal(nd.toBs('2082-03-15'), '2082-03-15');
  assert.equal(nd.toAd('2082-03-15'), nd.bsToAd('2082-03-15'));
  assert.equal(nd.toBs('2024-01-01'), nd.adToBs('2024-01-01'));
  assert.equal(nd.toAd(''), null);

  const pastBs = nd.adToBs(new Date(Date.now() - 20 * 86400_000).toISOString().slice(0, 10));
  const futureBs = nd.adToBs(new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10));
  await inA(async () => {
    await db.query("INSERT INTO notices (title, title_np, content, notice_date, is_active) VALUES ('BS notice', 'बि.सं. सूचना', 'x', $1, 1)", [pastBs]);
    await db.query("INSERT INTO careers (title, deadline, is_active, allow_online_apply, department) VALUES ('Old BS job', $1, 1, 1, 'Ops'), ('Soon BS job', $2, 1, 1, 'Credit')", [pastBs, futureBs]);
  });
  let r = await get('/notices');
  assert.equal(r.status, 200);
  const [, m, d] = pastBs.split('-').map(Number);
  assert.ok(r.text.includes(nd.MONTHS_NP[m - 1]), 'BS month shown for the BS notice date');
  assert.ok(r.text.includes(nd.toNepaliDigits(d)), 'BS day shown');

  r = await get('/careers');
  assert.ok(r.text.includes('Soon BS job'), 'future BS deadline is open');
  assert.ok(!r.text.includes('Old BS job'), 'past BS deadline is closed (not in the open tab)');
  assert.match(r.text, /Urgent|अत्यावश्यक/);
  r = await get('/careers?status=closed');
  assert.ok(r.text.includes('Old BS job'));
  r = await get('/careers?status=all&dept=Credit');
  assert.ok(r.text.includes('Soon BS job') && !r.text.includes('Old BS job'));

  const fixed = await inA(() => require('../src/lib/bs-dates').normalise());
  assert.equal(fixed['careers.deadline'], 2);
  assert.equal(fixed['notices.notice_date'], 1);
  const ad = await inA(() => db.value("SELECT deadline FROM careers WHERE title = 'Soon BS job'"));
  assert.equal(ad, nd.bsToAd(futureBs));
});

// ---------------------------------------------------------------- P1-7 legacy URLs
test('legacy PHP URLs keep their ids and filters; extensionless PHP paths redirect', async () => {
  const pageId = await inA(() => db.value("INSERT INTO pages (slug, title, content, is_active) VALUES ('old-page', 'Old page', 'x', 1) RETURNING id"));
  const cases = [
    ['/report-file.php?id=7&dl=1', '/reports/7/file?dl=1'],
    ['/institutional-profile-file.php?id=3', '/institutional-profile/3/file'],
    ['/information-room-file.php?id=4', '/member/information-room/4'],
    ['/page.php?id=' + pageId, '/page/by-id/' + pageId],
    ['/reports.php?type=monthly&year=2081/82&id=5', '/reports?type=monthly&year=2081%2F82&id=5'],
    ['/awards.php?id=2', '/awards/2'],
    ['/committees.php?type=3&tenure=9', '/committees/3?tenure=9'],
    ['/gallery.php?type=video&page=2', '/gallery?type=video&page=2'],
    ['/why-choose.php', '/about#why'],
    ['/manifest.json', '/manifest.webmanifest'],
    ['/news-detail?id=5', '/news/5'],
    ['/career', '/careers'],
    ['/sahakari-patro', '/calendar'],
    ['/election-information', '/elections'],
  ];
  for (const [from, to] of cases) {
    const r = await get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.location, to, from);
  }
  let r = await get('/page/by-id/' + pageId);
  assert.equal(r.headers.location, '/page/old-page');
  r = await get('/contact');
  assert.equal(r.status, 200, 'existing Node routes are not redirected');
});
