'use strict';
/**
 * Custom roles / menu control / error log / restore / reports gating / SEO / anti-spam / team.
 * Integration parts run against a real PostgreSQL (DATABASE_URL) in a throw-away tenant.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'test.local';
process.env.PLATFORM_HOST = 'platform.test.local';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const perms = require('../src/lib/admin-perms');
const antispam = require('../src/lib/antispam');
const seo = require('../src/lib/seo');
const team = require('../src/lib/team');
const { createApp } = require('../src/app');

const SLUG = 'tt' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.test.local`;
const PW = 'Admin@12345!';
let app;

function client() {
  const agent = request.agent(app);
  return {
    agent,
    get: url => agent.get(url).set('Host', HOST),
    post: url => agent.post(url).set('Host', HOST),
    async token(url = '/contact') {
      const r = await agent.get(url).set('Host', HOST);
      const m = r.text.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(m, 'csrf token on ' + url);
      return m[1];
    },
    async form(url, data, tokenUrl = '/contact') {
      const _csrf = await this.token(tokenUrl);
      return agent.post(url).set('Host', HOST).type('form').send({ _csrf, ...data });
    },
  };
}
const inTenant = fn => db.withSchema('tenant_' + SLUG, fn);
async function adminUser(username, role, customRoleId = null) {
  const hash = await require('../src/lib/auth').hashPassword('Pass@12345678');
  await inTenant(() => db.query(`INSERT INTO admin_users (username, password, full_name, role, is_active, status, custom_role_id) VALUES ($1, $2, $1, $3, 1, 'active', $4)`, [username, hash, role, customRoleId]));
  const c = client();
  const r = await c.form('/admin/login', { username, password: 'Pass@12345678' });
  assert.equal(r.status, 302);
  return c;
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: SLUG, name: 'Tools Tenant', domains: [HOST], adminPassword: PW });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  fs.rmSync(path.join(require('../src/config').uploadDir, SLUG), { recursive: true, force: true });
  await db.pool.end();
});

// ---------------------------------------------------------------- unit
test('permission matrix: normalize, resolve, action flags', () => {
  assert.deepEqual(perms.normalize({ 'r:notices': 'ce', 'r:nope': 'v', members: 'x' }), { 'r:notices': 'vce' });
  assert.deepEqual(perms.normalize('{"r:news":"d"}'), { 'r:news': 'vd' });
  assert.deepEqual(perms.normalize('not json'), {});
  assert.equal(perms.resolve('/r/notices/5/edit').section, 'r:notices');
  assert.equal(perms.resolve('/r/notices_x'), null);
  assert.equal(perms.resolve('/inbox/loan/3').section, 'inbox:loan');
  assert.equal(perms.resolve('/information-room/logs').section, 'r:information_room_items');
  assert.ok(perms.resolve('/users').superOnly);
  assert.ok(perms.resolve('/').always);
  const flag = (method, p, body = {}) => perms.actionFlag({ method, path: p, body }, perms.resolve(p));
  assert.equal(flag('GET', '/r/news'), 'v');
  assert.equal(flag('POST', '/r/news'), 'c');
  assert.equal(flag('POST', '/r/news/4'), 'e');
  assert.equal(flag('POST', '/r/news/4/toggle'), 'e');
  assert.equal(flag('POST', '/r/news/4/delete'), 'd');
  assert.equal(flag('POST', '/r/news/bulk', { action: 'delete' }), 'd');
  assert.equal(flag('POST', '/r/news/bulk', { action: 'activate' }), 'e');
  const ctx = { admin: { role: 'admin' }, perms: { 'r:notices': 'v' }, hidden: [] };
  assert.equal(perms.decide(ctx, { method: 'GET', path: '/r/notices', body: {} }).ok, true);
  assert.equal(perms.decide(ctx, { method: 'POST', path: '/r/notices', body: {} }).ok, false);
  assert.equal(perms.decide(ctx, { method: 'GET', path: '/r/news', body: {} }).ok, false);
  assert.equal(perms.decide(ctx, { method: 'GET', path: '/some-new-page', body: {} }).ok, false, 'unknown pages fail closed for custom roles');
  assert.equal(perms.decide({ ...ctx, perms: null }, { method: 'GET', path: '/some-new-page', body: {} }).ok, true);
  assert.equal(perms.decide({ admin: { role: 'superadmin' }, perms: {}, hidden: ['content'] }, { method: 'GET', path: '/r/news', body: {} }).ok, true);
  assert.equal(perms.decide({ admin: { role: 'admin' }, perms: null, hidden: ['content'] }, { method: 'GET', path: '/r/news', body: {} }).ok, false);
  const html = '<aside class="sidebar"><div class="side-group"><div class="side-title">X</div><a class="side-link " href="/admin/r/news">N</a></div><a class="side-link" href="/admin">D</a></aside>';
  const out = perms.filterSidebar(html, ctx);
  assert.doesNotMatch(out, /r\/news|side-title/);
  assert.match(out, /href="\/admin"/);
});

test('spam heuristics and JSON-LD escaping', () => {
  assert.equal(antispam.looksLikeSpam('मेरो खाता बारे जानकारी चाहियो', 'contact me at ram@example.com'), false);
  assert.equal(antispam.looksLikeSpam('Visit https://spam.example now'), true);
  assert.equal(antispam.looksLikeSpam('earn money: click cheap-loans.xyz'), true);
  assert.equal(antispam.looksLikeSpam('claim now your crypto airdrop'), true);
  assert.equal(antispam.honeypotTripped({ ct_hp: 'x' }), true);
  assert.equal(seo.ldJson({ a: '</script><b>' }).includes('</script>'), false);
  assert.equal(seo.cardColor('#ffffff'), '#595959');
  const req = { protocol: 'https', get: () => 'x.np', path: '/news/', query: { id: '7', lang: 'en', utm_source: 'fb', page: '1' } };
  assert.equal(seo.canonical(req), 'https://x.np/news?id=7');
  assert.equal(seo.documentTitle({ site_name: 'सहकारी', seo_title: 'Custom' }, '', false), 'Custom');
  assert.equal(seo.documentTitle({ site_name: 'सहकारी' }, 'सूचना', false), 'सूचना - सहकारी');
});

test('team org-chart rows', () => {
  assert.equal(team.chartRow({ chart_row: 3 }), 3);
  assert.equal(team.chartRow({ is_ceo: 1 }), 1);
  assert.equal(team.chartRow({ position: 'उपाध्यक्ष' }), 2);
  assert.equal(team.chartRow({ position: 'Chairman' }), 1);
  assert.equal(team.chartRow({ position: 'सचिव' }), 3);
  assert.equal(team.chartRow({ position: 'Driver' }), 4);
  assert.equal(team.isBoardAlias({ name_np: 'सञ्चालक समिति' }), true);
});

// ---------------------------------------------------------------- integration
test('custom role limits sections, hides sidebar links and blocks actions', async () => {
  const sa = client();
  assert.equal((await sa.form('/admin/login', { username: 'admin', password: PW })).status, 302);
  const saved = await sa.form('/admin/roles', { action: 'save_role', role_id: '0', name: 'Notice viewer', perm: ['r:notices|v', 'r:gallery|c'] });
  assert.equal(saved.status, 302);
  const role = await inTenant(() => db.one("SELECT * FROM admin_roles WHERE name = 'Notice viewer'"));
  assert.deepEqual(JSON.parse(role.permissions), { 'r:notices': 'v', 'r:gallery': 'vc' });

  const c = await adminUser('viewer1', 'admin', role.id);
  assert.equal((await c.get('/admin/r/notices')).status, 200);
  assert.equal((await c.get('/admin/r/news')).status, 403);
  assert.equal((await c.get('/admin/settings')).status, 403);
  assert.equal((await c.get('/admin/users')).status, 403);
  const dash = await c.get('/admin');
  assert.equal(dash.status, 200);
  const side = dash.text.slice(dash.text.indexOf('<aside'), dash.text.indexOf('</aside>'));
  assert.match(side, /href="\/admin\/r\/notices"/);
  assert.doesNotMatch(side, /href="\/admin\/r\/news"/);
  assert.doesNotMatch(side, /href="\/admin\/settings"/);
  const create = await c.form('/admin/r/notices', { title_np: 'नहुनुपर्ने', is_active: '1' });
  assert.equal(create.status, 302);
  assert.equal(await inTenant(() => db.value("SELECT count(*) FROM notices WHERE title_np = 'नहुनुपर्ने'")), 0);
  // quick search respects the matrix: no members for this role
  const qs = await c.agent.get('/admin/quick-search?q=ab').set('Host', HOST).set('Accept', 'application/json');
  assert.equal(qs.status, 200);
  assert.ok(!qs.body.groups.some(g => /Member|सदस्य/.test(g.label)));
  // a role in use cannot be deleted
  await sa.form('/admin/roles', { action: 'delete_role', role_id: String(role.id) });
  assert.ok(await inTenant(() => db.value('SELECT 1 FROM admin_roles WHERE id = $1', [role.id])));
});

test('menu control hides a group from admins (password required), not from superadmin', async () => {
  const sa = client();
  await sa.form('/admin/login', { username: 'admin', password: PW });
  await sa.form('/admin/menu-control', { action: 'save', hidden: ['content'], confirm_password: 'wrong' });
  assert.equal(await inTenant(() => db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'admin_hidden_menu_groups'")), '[]');
  await sa.form('/admin/menu-control', { action: 'save', hidden: ['content', 'bogus'], confirm_password: PW });
  assert.equal(await inTenant(() => db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'admin_hidden_menu_groups'")), '["content"]');
  require('../src/lib/settings').invalidate();
  await new Promise(r => setTimeout(r, 20));
  const c = await adminUser('plainadmin', 'admin');
  // settings are cached briefly per schema; clear inside the tenant
  await inTenant(async () => require('../src/lib/settings').invalidate());
  assert.equal((await c.get('/admin/r/notices')).status, 403);
  assert.equal((await c.get('/admin/r/gallery')).status, 200);
  assert.equal((await sa.get('/admin/r/notices')).status, 200);
  await sa.form('/admin/menu-control', { action: 'reset', confirm_password: PW });
  await inTenant(async () => require('../src/lib/settings').invalidate());
  assert.equal((await c.get('/admin/r/notices')).status, 200);
});

test('bulk actions on notices', async () => {
  const sa = client();
  await sa.form('/admin/login', { username: 'admin', password: PW });
  const ids = await inTenant(async () => [
    (await db.insert('notices', { title: 'b1', title_np: 'b1', is_active: 1 })).id,
    (await db.insert('notices', { title: 'b2', title_np: 'b2', is_active: 1 })).id,
  ]);
  assert.equal((await sa.form('/admin/r/notices/bulk', { action: 'deactivate', ids: ids.map(String) })).status, 302);
  assert.equal(await inTenant(() => db.value('SELECT sum(is_active) FROM notices WHERE id = ANY($1::int[])', [ids])), 0);
  await sa.form('/admin/r/notices/bulk', { action: 'delete', ids: ids.map(String) });
  assert.equal(await inTenant(() => db.value('SELECT count(*) FROM notices WHERE id = ANY($1::int[]) AND deleted_at IS NULL', [ids])), 0);
});

test('server errors are captured per tenant and shown to superadmin', async () => {
  const fake = { tenant: { schema_name: 'tenant_' + SLUG }, method: 'GET', originalUrl: '/x?password=hunter2', ip: '127.0.0.1', get: () => 'ua' };
  require('../src/lib/error-log').capture(Object.assign(new Error('boom-test'), { status: 500 }), fake);
  require('../src/lib/error-log').capture(Object.assign(new Error('not-found'), { status: 404 }), fake);
  await new Promise(r => setTimeout(r, 200));
  const rows = await inTenant(() => db.many('SELECT * FROM app_error_log'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].path, '/x?password=***');
  const sa = client();
  await sa.form('/admin/login', { username: 'admin', password: PW });
  assert.match((await sa.get('/admin/error-log')).text, /boom-test/);
});

test('backup → restore round trip keeps admins and member passwords', async () => {
  const sa = client();
  await sa.form('/admin/login', { username: 'admin', password: PW });
  await inTenant(async () => {
    await db.insert('news', { title: 'before-backup', title_np: 'before-backup', is_active: 1 });
    await db.insert('members', { name: 'Restore Member', sadasyata_number: 'RM-1', password_hash: 'keep-this-hash', approval_status: 'approved', is_active: 1 });
  });
  const exp = await sa.form('/admin/backup', {});
  assert.equal(exp.status, 200);
  const backup = JSON.parse(exp.text);
  assert.equal(backup.tenant, SLUG);
  await inTenant(() => db.insert('news', { title: 'after-backup', title_np: 'after-backup', is_active: 1 }));
  // wrong tenant is rejected up front
  const tok = await sa.token('/admin/backup');
  const bad = await sa.post(`/admin/backup/restore?_csrf=${encodeURIComponent(tok)}`).field('_csrf', tok).attach('backup', Buffer.from(JSON.stringify({ ...backup, tenant: 'other' })), 'b.json');
  assert.equal(bad.status, 302);
  const bad2 = await sa.post(`/admin/backup/restore?_csrf=${encodeURIComponent(tok)}`).field('_csrf', tok).attach('backup', Buffer.from(JSON.stringify({ ...backup, tables: { evil_table: [] } })), 'b.json');
  assert.equal(bad2.status, 302);
  const up = await sa.post(`/admin/backup/restore?_csrf=${encodeURIComponent(tok)}`).field('_csrf', tok).attach('backup', Buffer.from(exp.text), 'backup.json');
  assert.equal(up.status, 200, up.text.slice(0, 300));
  assert.match(up.text, /confirm_slug/);
  // wrong confirmation does nothing
  await sa.form('/admin/backup/restore/confirm', { action: 'restore', confirm_slug: 'nope', password: PW }, '/admin/backup');
  assert.equal(await inTenant(() => db.value("SELECT count(*) FROM news WHERE title = 'after-backup'")), 1);
  const up2 = await sa.post(`/admin/backup/restore?_csrf=${encodeURIComponent(tok)}`).field('_csrf', tok).attach('backup', Buffer.from(exp.text), 'backup.json');
  assert.equal(up2.status, 200);
  const done = await sa.form('/admin/backup/restore/confirm', { action: 'restore', confirm_slug: SLUG, password: PW }, '/admin/backup');
  assert.equal(done.status, 302);
  await inTenant(async () => {
    assert.equal(await db.value("SELECT count(*) FROM news WHERE title = 'after-backup'"), 0);
    assert.equal(await db.value("SELECT count(*) FROM news WHERE title = 'before-backup'"), 1);
    assert.equal(await db.value("SELECT password_hash FROM members WHERE sadasyata_number = 'RM-1'"), 'keep-this-hash');
    assert.ok(await db.value("SELECT 1 FROM audit_log WHERE action = 'restore'"));
    const id = (await db.insert('news', { title: 'seq-ok', title_np: 'seq-ok', is_active: 1 })).id;
    assert.ok(id > 0);
  });
  // still able to log in (admin_users untouched)
  const again = client();
  assert.equal((await again.form('/admin/login', { username: 'admin', password: PW })).status, 302);
});

test('members-only report files are gated; unlock by membership number', async () => {
  const dir = path.join(require('../src/config').uploadDir, SLUG, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r1.pdf'), '%PDF-1.4 test');
  const id = await inTenant(async () => {
    await db.insert('members', { name: 'Unlock Member', sadasyata_number: 'UM-77', phone: '9811177777', approval_status: 'approved', is_active: 1 });
    return (await db.insert('reports', { title: 'Secret AGM', title_np: 'गोप्य', file_path: 'reports/r1.pdf', access_level: 'member', is_active: 1 })).id;
  });
  const c = client();
  const list = await c.get('/reports');
  assert.doesNotMatch(list.text, /गोप्य/);
  assert.equal((await c.get(`/reports/${id}/file`)).status, 403);
  await c.form('/reports/unlock', { membership_no: 'WRONG' }, '/reports');
  assert.equal((await c.get(`/reports/${id}/file`)).status, 403);
  await c.form('/reports/unlock', { membership_no: 'um-77', mobile: '9800000000' }, '/reports'); // right number, wrong mobile → still locked
  assert.equal((await c.get(`/reports/${id}/file`)).status, 403);
  await c.form('/reports/unlock', { membership_no: 'um-77', mobile: '9811177777' }, '/reports');
  const file = await c.get(`/reports/${id}/file`);
  assert.equal(file.status, 200);
  // the legacy public copy was moved to private storage
  assert.equal(fs.existsSync(path.join(dir, 'r1.pdf')), false);
  assert.equal((await request(app).get('/uploads/reports/r1.pdf').set('Host', HOST)).status, 404);
  assert.match(await inTenant(() => db.value('SELECT file_path FROM reports WHERE id = $1', [id])), /^_private\//);
});

test('public SEO head, FAQ JSON-LD, share card and leadership message', async () => {
  await inTenant(async () => {
    await db.insert('faqs', { question: 'Q1?', question_np: 'प्रश्न?', answer: 'A1', answer_np: 'उत्तर', is_active: 1 });
    await db.query("UPDATE site_settings SET setting_value = 'abc123' WHERE setting_key = 'google_site_verification'");
    await db.query("UPDATE site_settings SET setting_value = 'Message in English' WHERE setting_key = 'chairman_message_en'");
    await db.insert('team_members', { name: 'हरि', name_en: 'Hari', position: 'अध्यक्ष', category: 'board', is_chairman: 1, is_active: 1 });
    require('../src/lib/settings').invalidate();
  });
  const r = await request(app).get('/faqs?utm_source=x').set('Host', HOST);
  assert.match(r.text, /<link rel="canonical" href="http:\/\/[^"]+\/faqs">/);
  assert.match(r.text, /hreflang="en"/);
  assert.match(r.text, /"@type":"FAQPage"/);
  assert.match(r.text, /"@type":"BreadcrumbList"/);
  assert.match(r.text, /google-site-verification" content="abc123"/);
  const card = await request(app).get('/share-og.svg').set('Host', HOST);
  assert.equal(card.status, 200);
  assert.match(card.headers['content-type'], /svg/);
  const msg = await request(app).get('/message/chairman?lang=en').set('Host', HOST);
  assert.match(msg.text, /Message in English/);
  assert.match(msg.text, /Hari/);
});

test('contact form rejects link spam', async () => {
  const c = client();
  const r = await c.form('/contact', { name: 'Bot', subject: 'Offer', message: 'visit https://cheap.example for loans' });
  assert.equal(r.status, 422);
  assert.equal(await inTenant(() => db.value("SELECT count(*) FROM contact_messages WHERE name = 'Bot'")), 0);
  const ok = await c.form('/contact', { name: 'Ram', subject: 'खाता', message: 'खाता खोल्न के चाहिन्छ?' });
  assert.equal(ok.status, 302);
});
