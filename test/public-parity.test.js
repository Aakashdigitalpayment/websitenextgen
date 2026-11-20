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

// ---------------------------------------------------------------- P1-8 popup carousel on every page
test('popup notices: carousel of up to 5 on every public page, not on forms; expired ones hidden', async () => {
  const expiredBs = nd.adToBs(new Date(Date.now() - 5 * 86400_000).toISOString().slice(0, 10));
  await inA(async () => {
    for (let i = 1; i <= 6; i++) await db.query("INSERT INTO notices (title, content, is_active, is_popup, attachment) VALUES ($1, 'Body', 1, 1, $2)", ['Popup ' + i, i === 6 ? 'notices/x.pdf' : null]);
    await db.query("INSERT INTO notices (title, content, is_active, is_popup, popup_expires_at) VALUES ('Expired popup', 'x', 1, 1, $1)", [expiredBs]);
  });
  await clearCaches();
  let r = await get('/about');
  assert.equal(r.status, 200);
  const m = r.text.match(/data-notice-popup="([^"]+)"/);
  assert.ok(m, 'popup on /about');
  assert.equal(m[1].split('-').length, 5, 'at most 5 slides');
  assert.ok(!r.text.includes('Expired popup'));
  assert.match(r.text, /View full notice|पूरा सूचना हेर्नुहोस्/);
  assert.ok(!/<script>/.test(r.text), 'no inline scripts');
  r = await get('/apply/loan');
  assert.ok(!r.text.includes('data-notice-popup'), 'no popup on application forms');
  await inA(() => db.query('UPDATE notices SET is_popup = 0'));
  await clearCaches();
});

// ---------------------------------------------------------------- P1-6 reports, P1-5 institutional profile
test('reports: type / year / month filters, grouping, view-only download refused, ?dl=1 attachment, signed links', async () => {
  const dir = path.join(config.uploadDir, A, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'm.pdf'), '%PDF-1.4 test');
  const [mid, vid, aid] = await inA(async () => [
    await db.value("INSERT INTO reports (title, report_type, report_year, report_month, file_path, is_active) VALUES ('Shrawan report', 'monthly', '2081/82', '4', 'reports/m.pdf', 1) RETURNING id"),
    await db.value("INSERT INTO reports (title, report_type, report_year, file_path, view_only, is_active) VALUES ('Audit 80', 'audit', '2080/81', 'reports/m.pdf', 1, 1) RETURNING id"),
    await db.value("INSERT INTO reports (title, report_type, report_year, file_path, is_active) VALUES ('Annual 81', 'Annual Report', '2081/82', 'reports/m.pdf', 1) RETURNING id"),
  ]);
  let r = await get('/reports?type=monthly');
  assert.equal(r.status, 200);
  assert.ok(r.text.includes('Shrawan report') && !r.text.includes('Annual 81'));
  assert.ok(r.text.includes(nd.MONTHS_NP[3]), 'BS month label');
  r = await get('/reports?type=annual');
  assert.ok(r.text.includes('Annual 81'), '"Annual Report" counts as annual');
  r = await get('/reports?year=2080/81');
  assert.ok(r.text.includes('Audit 80') && !r.text.includes('Shrawan report'));
  r = await get('/reports?type=monthly&month=5');
  assert.ok(!r.text.includes('Shrawan report'));
  r = await get('/reports?id=' + mid);
  assert.match(r.text, /<title>Shrawan report/);
  assert.ok(r.text.includes(`id="r${mid}"`));
  r = await get('/reports');
  assert.ok(!r.text.includes(`/reports/${vid}/file?dl=1`), 'no download link for a view-only report');
  r = await get(`/reports/${vid}/file?dl=1`);
  assert.equal(r.status, 403);
  r = await get(`/reports/${mid}/file?dl=1`);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-disposition'] || '', /attachment/);
  r = await get(`/reports/${mid}/file`);
  assert.ok(!/attachment/.test(r.headers['content-disposition'] || ''), 'inline view by default');
  // members-only: blocked without unlock, opens with a valid signed token only
  await inA(() => db.query("UPDATE reports SET access_level = 'member' WHERE id = $1", [aid]));
  assert.equal((await get(`/reports/${aid}/file`)).status, 403);
  const ma = require('../src/lib/member-access');
  const tenant = await tenants.resolveHost(HA);
  const fake = { tenant };
  assert.equal((await get(`/reports/${aid}/file?t=${ma.fileToken(fake, 'report', aid)}`)).status, 200);
  assert.equal((await get(`/reports/${aid}/file?t=${ma.fileToken(fake, 'report', mid)}`)).status, 403, 'token bound to the id');
  assert.equal((await get(`/reports/${aid}/file?t=zz.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`)).status, 403);
});

test('institutional profile: latest 2 by default, FY / month filters, growth chips, charts, members-only hidden', async () => {
  await inA(async () => {
    const cols = await db.columns('institutional_profile');
    for (let m = 1; m <= 4; m++) {
      const row = { fiscal_year: '2081/82', report_month: m, total_members: 1000 + m, deposit: 5e6 + m * 1e5, loan: 4e6, total_assets: 7e6, is_active: 1, access_level: 'none' };
      if (cols.has('deposit_percent')) row.deposit_percent = 2.5;
      await db.insert('institutional_profile', row);
    }
    await db.insert('institutional_profile', { fiscal_year: '2080/81', report_month: 0, total_members: 900, deposit: 4e6, is_active: 1, access_level: 'member' });
  });
  let r = await get('/institutional-profile');
  assert.equal(r.status, 200);
  assert.equal((r.text.match(/class="card ip-card"/g) || []).length, 2, 'latest two');
  assert.ok(r.text.includes('chart-svg'), 'trend charts');
  assert.ok(r.text.includes('id="unlock"'), 'unlock form for members-only rows');
  r = await get('/institutional-profile?fy=2081/82&month=2');
  assert.equal((r.text.match(/class="card ip-card"/g) || []).length, 1);
  r = await get('/institutional-profile?all=1');
  assert.equal((r.text.match(/class="card ip-card"/g) || []).length, 4, 'members-only stays hidden');
});
