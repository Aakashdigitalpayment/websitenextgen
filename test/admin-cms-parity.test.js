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

// ---------------------------------------------------------------- P1-2 settings registry
const pngBuf = () => require('sharp')({ create: { width: 4, height: 4, channels: 3, background: '#0f766e' } }).png().toBuffer();
async function postSettings(c, tab, fields, files = {}) {
  const tok = await c.token('/admin/settings?tab=' + tab);
  let r = c.agent.post('/admin/settings?_csrf=' + encodeURIComponent(tok)).set('Host', HA).field('_csrf', tok).field('_tab', tab);
  for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
  for (const [k, buf] of Object.entries(files)) r = r.attach(k, buf, 'x.png');
  return r;
}
test('settings: registry-driven tabs, validation, unseeded keys, image remove, secret clear', async () => {
  let r = await admin.get('/admin/settings?tab=sections');
  assert.match(r.text, /name="s_values_content_en"/);
  assert.match(r.text, /data-richtext/);
  // invalid URL: nothing saved
  r = await postSettings(admin, 'social', { s_facebook_url: 'javascript:alert(1)', s_twitter_url: 'https://x.com/coop' });
  assert.equal(r.status, 422);
  assert.equal(await inA(() => settings.get('twitter_url')), '');
  r = await postSettings(admin, 'social', { s_facebook_url: 'https://facebook.com/coop', s_twitter_url: 'https://x.com/coop' });
  assert.equal(r.status, 302);
  await inA(() => settings.invalidate());
  assert.equal(await inA(() => settings.get('twitter_url')), 'https://x.com/coop');
  // rich text is sanitised; a key that was never seeded gets a row
  await postSettings(admin, 'about', { s_history_content_en: '<p>Founded <script>x()</script><strong>2050</strong></p>', s_years_experience: '२५' });
  await inA(() => settings.invalidate());
  const s = await inA(() => settings.all());
  assert.equal(s.history_content_en, '<p>Founded <strong>2050</strong></p>');
  assert.equal(s.years_experience, '25');
  // favicon (any image def) uploads; then remove
  r = await postSettings(admin, 'general', { s_site_name: 'CMS A' }, { file_site_favicon: await pngBuf() });
  assert.equal(r.status, 302);
  await inA(() => settings.invalidate());
  assert.match(await inA(() => settings.get('site_favicon')), /^settings\//);
  await postSettings(admin, 'general', { s_site_name: 'CMS A', remove_site_favicon: '1' });
  await inA(() => settings.invalidate());
  assert.equal(await inA(() => settings.get('site_favicon')), '');
  // map link → embed URL; secret kept when blank, cleared on request; per-module office alert toggles
  await postSettings(admin, 'contact', { s_map_embed_url: 'https://www.google.com/maps/place/Kathmandu/@27.7,85.3,15z' });
  await postSettings(admin, 'notify', { s_smtp_password: 'pw1', _event_toggles: '1', notify_email_loan: '1' });
  await inA(() => settings.invalidate());
  let s2 = await inA(() => settings.all());
  assert.equal(s2.map_embed_url, 'https://www.google.com/maps?q=27.7%2C85.3&z=15&output=embed');
  assert.equal(s2.smtp_password, 'pw1');
  assert.equal(s2.notify_sms_loan, '0');
  assert.equal(s2.notify_email_loan ?? '1', '1');
  await postSettings(admin, 'notify', { s_smtp_password: '' });
  await inA(() => settings.invalidate());
  assert.equal(await inA(() => settings.get('smtp_password')), 'pw1');
  await postSettings(admin, 'notify', { clear_smtp_password: '1' });
  await inA(() => settings.invalidate());
  s2 = await inA(() => settings.all());
  assert.equal(s2.smtp_password, '');
});

// ---------------------------------------------------------------- P1-3 PHP setting names
test('legacy PHP setting keys are read under the Node names, and mapLegacy stores them', async () => {
  const crypto = require('crypto');
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', crypto.createHash('sha256').update('php-master-key-123').digest(), iv);
  const enc = 'enc:v1:' + iv.toString('hex') + ':' + Buffer.concat([c.update('sk-test-123'), c.final()]).toString('base64');
  const saved = process.env.CREDENTIALS_LEGACY_KEY;
  delete process.env.CREDENTIALS_LEGACY_KEY;
  await inA(async () => {
    await db.query("DELETE FROM site_settings WHERE setting_key IN ('ai_enabled', 'notify_admin_emails', 'map_embed_url')");
    for (const [k, v] of [['ai_chat_enabled', '1'], ['notify_email_recipients', 'a@x.np'], ['map_lat', '27.7'], ['map_lng', '85.3'], ['site_slogan', 'हाम्रो स्लोगन'], ['ai_api_key', enc], ['notify_email_grievance', '0'], ['ai_welcome', 'नमस्ते']]) await settings.set(k, v);
    settings.invalidate();
  });
  let s = await inA(() => settings.all());
  assert.equal(s.ai_enabled, '1');
  assert.equal(s.notify_admin_emails, 'a@x.np');
  assert.equal(s.map_embed_url, 'https://www.google.com/maps?q=27.7%2C85.3&z=17&output=embed');
  assert.equal(s.site_tagline, 'हाम्रो स्लोगन');
  assert.equal(s.notify_email_grievance, '0');
  assert.equal(s.ai_api_key, ''); // encrypted and no legacy key configured → not used
  const mapped = await inA(() => settings.mapLegacy('php-master-key-123'));
  if (saved !== undefined) process.env.CREDENTIALS_LEGACY_KEY = saved;
  assert.ok(mapped.includes('ai_api_key'));
  s = await inA(async () => { settings.invalidate(); return settings.all(); });
  assert.equal(s.ai_api_key, 'sk-test-123');
  assert.equal(await inA(() => db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'ai_enabled'")), '1');
});

// ---------------------------------------------------------------- P1-4 about sections
test('vision / mission / values: English text and stored titles on the English page', async () => {
  await setSetting('vision_content_np', 'नेपाली दृष्टि');
  await setSetting('vision_content_en', 'English vision');
  await setSetting('vision_content_title_en', 'Our Vision 2090');
  const c = client();
  await c.get('/lang/en');
  const r = await c.get('/vision-mission');
  assert.match(r.text, /English vision/);
  assert.match(r.text, /Our Vision 2090/);
  assert.doesNotMatch(r.text, /नेपाली दृष्टि/);
});

// ---------------------------------------------------------------- P1-5 audit log
test('audit log: filters (admin, action, BS/AD dates, text), legacy PHP rows, CSV export', async () => {
  await inA(async () => {
    const id = await db.value("SELECT id FROM admin_users WHERE username = 'admin'");
    await db.query("INSERT INTO admin_activity_log (admin_id, action, target_type, target_id, details, ip, created_at) VALUES ($1, 'php_legacy_edit', 'news', 7, '{\"x\":1}', '1.2.3.4', '2024-01-15 10:00')", [id]);
    await db.query("INSERT INTO audit_log (actor_type, actor_id, actor_name, action, entity_type, summary, created_at) VALUES ('admin', $1, 'admin', 'zz_old', 'notices', 'very old thing', '2020-05-01')", [id]);
  });
  let r = await admin.get('/admin/audit?action=php_legacy_edit');
  assert.equal(r.status, 200);
  assert.match(r.text, /php_legacy_edit/);
  assert.match(r.text, /legacy|पुरानो/);
  r = await admin.get('/admin/audit?from=2020-04-01&to=2020-05-30');
  assert.match(r.text, /very old thing/);
  assert.doesNotMatch(r.text, /php_legacy_edit<\/span>/);
  r = await admin.get('/admin/audit?from=' + encodeURIComponent('२०८०-०९-३०') + '&to=2080-10-01'); // BS 2080-09-30 = 2024-01-15
  assert.match(r.text, /php_legacy_edit/);
  r = await admin.get('/admin/audit?q=very+old');
  assert.match(r.text, /very old thing/);
  r = await admin.get('/admin/audit?entity=notices&format=csv');
  assert.match(r.headers['content-type'], /text\/csv/);
  assert.match(r.text, /very old thing/);
});

// ---------------------------------------------------------------- P1-6 institutional profile
test('institutional profile: new indicators, BS date fills month + AD date, one record per FY and month', async () => {
  const form = (data, url = '/admin/r/institutional_profile') => admin.form(url, data, '/admin/r/institutional_profile/new');
  let r = await form({ fiscal_year: '2081/82', report_month: '0', report_date_bs: '२०८१-०५-१५', liquidity_percent: '18.5', npl_percent: '2.25', reserved_fund: '1000', report_note: 'Q note' });
  assert.equal(r.status, 302);
  const row = await inA(() => db.one("SELECT * FROM institutional_profile WHERE fiscal_year = '2081/82'"));
  assert.equal(Number(row.report_month), 5);
  assert.equal(row.report_date_bs, '2081-05-15');
  assert.ok(row.report_date_ad);
  assert.equal(Number(row.liquidity_percent), 18.5);
  assert.equal(Number(row.npl_percent), 2.25);
  r = await form({ fiscal_year: '2081/82', report_month: '5' });
  assert.equal(r.status, 422);
  assert.match(r.text, /already exists|पहिले नै छ/);
  r = await form({ fiscal_year: '2081/82', report_month: '6' });
  assert.equal(r.status, 302);
  // editing the same record keeps its own FY/month
  r = await form({ fiscal_year: '2081/82', report_month: '5', liquidity_percent: '19' }, `/admin/r/institutional_profile/${row.id}`);
  assert.equal(r.status, 302);
  r = await admin.get('/admin/r/institutional_profile/new');
  assert.match(r.text, /name="liquidity_percent"/);
  assert.match(r.text, /<option value="2081\/82"/);
});

// ---------------------------------------------------------------- P2-1 / P2-2 / P2-3 accounts
test('profile: edit own name and email (validated, audited)', async () => {
  let r = await admin.form('/admin/profile', { full_name: 'Head Admin', email: 'not-an-email' });
  assert.equal(r.status, 422);
  r = await admin.form('/admin/profile', { full_name: 'Head Admin', email: 'Boss@Coop.NP' });
  assert.equal(r.status, 302);
  const u = await inA(() => db.one("SELECT full_name, email FROM admin_users WHERE username = 'admin'"));
  assert.deepEqual([u.full_name, u.email], ['Head Admin', 'boss@coop.np']);
  assert.ok(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'profile_update'")));
});

test('admin session: idle timeout and browser binding', async () => {
  const sidCookie = r => [].concat(r.headers['set-cookie'] || []).map(x => x.split(';')[0]).find(x => x.startsWith('coop.sid='));
  const c = client();
  let r = await c.form('/admin/login', { username: 'admin2', password: PW }, '/admin/login');
  const cookie = sidCookie(r);
  assert.ok(cookie);
  assert.equal((await c.get('/admin')).status, 200);
  // another browser presenting the same cookie is signed out
  const stolen = await request(app).get('/admin').set('Host', HA).set('Cookie', cookie).set('User-Agent', 'Other/1.0');
  assert.equal(stolen.status, 302);
  assert.equal((await c.get('/admin')).status, 302); // the session was dropped
  // idle: last activity older than the limit
  const c2 = client();
  r = await c2.form('/admin/login', { username: 'admin2', password: PW }, '/admin/login');
  const sid = decodeURIComponent(sidCookie(r).slice('coop.sid='.length)).slice(2).split('.')[0];
  await db.query(`UPDATE platform.user_sessions SET sess = jsonb_set(sess::jsonb, '{adminSeen}', to_jsonb((extract(epoch from now()) * 1000)::bigint - 3600000))::json WHERE sid = $1`, [sid]);
  assert.equal((await c2.get('/admin')).status, 302);
});

test('admin users: an admin manages admin/staff/editor, never superadmins; edit name/email', async () => {
  const c = client();
  await c.form('/admin/login', { username: 'admin2', password: PW }, '/admin/login');
  assert.equal((await c.get('/admin/users')).status, 200);
  let r = await c.form('/admin/users', { username: 'super2', password: 'LongPassword1', role: 'superadmin', full_name: 'X' }, '/admin/users');
  assert.equal(r.status, 422);
  r = await c.form('/admin/users', { username: 'staff9', password: 'LongPassword1', role: 'staff', full_name: 'Staff Nine', email: 'S9@x.np' }, '/admin/users');
  assert.equal(r.status, 302);
  const staffId = await inA(() => db.value("SELECT id FROM admin_users WHERE username = 'staff9'"));
  const superId = await inA(() => db.value("SELECT id FROM admin_users WHERE username = 'admin'"));
  await c.form(`/admin/users/${staffId}`, { action: 'role', role: 'superadmin' }, '/admin/users');
  assert.equal(await inA(() => db.value('SELECT role FROM admin_users WHERE id = $1', [staffId])), 'staff');
  await c.form(`/admin/users/${staffId}`, { action: 'edit', full_name: 'Staff 9', email: 'nine@x.np' }, '/admin/users');
  assert.equal(await inA(() => db.value('SELECT email FROM admin_users WHERE id = $1', [staffId])), 'nine@x.np');
  await c.form(`/admin/users/${superId}`, { action: 'disable' }, '/admin/users');
  await c.form(`/admin/users/${superId}`, { action: 'reset' }, '/admin/users');
  assert.equal(Number(await inA(() => db.value('SELECT is_active FROM admin_users WHERE id = $1', [superId]))), 1);
  await c.form(`/admin/users/${staffId}`, { action: 'reset2fa' }, '/admin/users');
  assert.ok(!(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'user_reset2fa'"))));
  // an editor still cannot open it
  const ed = client();
  await ed.form('/admin/login', { username: 'staff9', password: 'LongPassword1' }, '/admin/login');
  assert.notEqual((await ed.get('/admin/users')).status, 200);
});

// ---------------------------------------------------------------- P2-5 … P2-13 generic CRUD
test('resources: icon picker, BS dates, rich-text hook, auto slug / tracking no. / area, member-of-year per year', async () => {
  let r = await admin.get('/admin/r/why_choose_features/new');
  assert.match(r.text, /class="icon-picker"/);
  r = await admin.get('/admin/r/news/new');
  assert.match(r.text, /data-richtext/);
  assert.match(r.text, /\/static\/js\/rich-editor\.js/);
  r = await admin.get('/admin/r/notices/new');
  assert.match(r.text, /data-ad-date/);
  // B.S. date typed directly is stored as A.D.
  r = await admin.form('/admin/r/notices', { title_np: 'BS सूचना', notice_date: '२०८१-०१-०१', content_np: '<p>x<script>y</script></p>' }, '/admin/r/notices/new');
  assert.equal(r.status, 302);
  const n = await inA(() => db.one("SELECT notice_date, content_np FROM notices WHERE title_np = 'BS सूचना'"));
  assert.equal(String(n.notice_date).slice(0, 10), '2024-04-13');
  assert.equal(n.content_np, '<p>x</p>');
  // icon field keeps a legacy Font Awesome value and renders the mapped icon
  await inA(() => db.query("INSERT INTO useful_links (title, url, icon, is_active) VALUES ('Old', 'https://x.np', 'fas fa-university', 1)"));
  r = await admin.get('/admin/r/useful_links');
  assert.equal(r.status, 200);
  // pages: blank slug from the English title; footer + menu → about
  r = await admin.form('/admin/r/pages', { title_np: 'नीति', title_en: 'Loan Policy', menu_position: 'footer', show_in_menu: '1', menu_icon: 'file' }, '/admin/r/pages/new');
  assert.equal(r.status, 302);
  const pg = await inA(() => db.one("SELECT slug, menu_position, menu_icon FROM pages WHERE title_en = 'Loan Policy'"));
  assert.deepEqual([pg.slug, pg.menu_position, pg.menu_icon], ['loan-policy', 'about', 'file']);
  // digital service type: slug from the name, unique; locked on edit
  await admin.form('/admin/r/digital_service_types', { name_np: 'क्यूआर', name_en: 'QR Pay', icon: 'qr' }, '/admin/r/digital_service_types/new');
  await admin.form('/admin/r/digital_service_types', { name_np: 'क्यूआर २', name_en: 'QR Pay', icon: 'qr' }, '/admin/r/digital_service_types/new');
  const slugs = (await inA(() => db.many("SELECT slug FROM digital_service_types WHERE name_en = 'QR Pay' ORDER BY id"))).map(x => x.slug);
  assert.deepEqual(slugs, ['qr_pay', 'qr_pay_2']);
  const dsId = await inA(() => db.value("SELECT id FROM digital_service_types WHERE slug = 'qr_pay'"));
  await admin.form(`/admin/r/digital_service_types/${dsId}`, { slug: 'hacked', name_np: 'क्यूआर', name_en: 'QR Pay' }, `/admin/r/digital_service_types/${dsId}/edit`);
  assert.equal(await inA(() => db.value('SELECT slug FROM digital_service_types WHERE id = $1', [dsId])), 'qr_pay');
  // auction: notice number and area text are filled
  r = await admin.form('/admin/r/auction_notices', { title: 'जग्गा लिलाम', area_ropani: '2', area_aana: '4', status: 'upcoming' }, '/admin/r/auction_notices/new');
  assert.equal(r.status, 302);
  const au = await inA(() => db.one("SELECT tracking_number, area FROM auction_notices WHERE title = 'जग्गा लिलाम'"));
  assert.match(au.tracking_number, /^AUC-\d{6}-\d{4}$/);
  assert.equal(au.area, '2 रोपनी 4 आना');
  r = await admin.get('/admin/r/auction_notices?q=' + au.tracking_number);
  assert.match(r.text, /जग्गा लिलाम/);
  // member of the year: one per year
  await admin.form('/admin/r/member_of_year', { spotlight_year: '2081', member_name: 'A' }, '/admin/r/member_of_year/new');
  r = await admin.form('/admin/r/member_of_year', { spotlight_year: '2081', member_name: 'B' }, '/admin/r/member_of_year/new');
  assert.equal(r.status, 422);
});

test('resources: list filters and live / archive tabs', async () => {
  await inA(() => db.query("INSERT INTO interest_rates (category, name_np, name, rate, is_active) VALUES ('saving', 'बचत क', 'Saving K', 5, 1), ('loan', 'ऋण ख', 'Loan K', 12, 1), ('loan', 'ऋण ग', 'Loan Old', 14, 0)"));
  let r = await admin.get('/admin/r/interest_rates?f_category=loan');
  assert.match(r.text, /ऋण ख/);
  assert.doesNotMatch(r.text, /बचत क/);
  r = await admin.get('/admin/r/interest_rates?f_category=loan&active=0');
  assert.match(r.text, /ऋण ग/);
  assert.doesNotMatch(r.text, /ऋण ख/);
  assert.match(r.text, /name="f_category"/);
});

test('delete guards: album with photos, service group, committee, designation are kept', async () => {
  const ids = await inA(async () => ({
    album: await db.value("INSERT INTO gallery_albums (name_np, is_active) VALUES ('एल्बम', 1) RETURNING id"),
    emptyAlbum: await db.value("INSERT INTO gallery_albums (name_np, is_active) VALUES ('खाली', 1) RETURNING id"),
    cat: await db.value("INSERT INTO service_categories (name_np, name, is_active) VALUES ('समूह', 'G', 1) RETURNING id"),
    ct: await db.value("INSERT INTO committee_types (name, name_np, is_active) VALUES ('Board X', 'बोर्ड', 1) RETURNING id"),
  }));
  await inA(async () => {
    await db.query("INSERT INTO gallery (title, image, album_id, is_active) VALUES ('p', 'x.jpg', $1, 1)", [ids.album]);
    await db.query("INSERT INTO services (title, title_np, service_category_id, is_active) VALUES ('S', 'स', $1, 1)", [ids.cat]);
    await db.query("INSERT INTO committee_tenures (committee_type_id, tenure_name, start_date, end_date, is_active) VALUES ($1, '2080-85', '2023-01-01', '2028-01-01', 1)", [ids.ct]);
  });
  const del = (res, id) => admin.form(`/admin/r/${res}/${id}/delete`, {}, `/admin/r/${res}`);
  await del('gallery_albums', ids.album);
  await del('gallery_albums', ids.emptyAlbum);
  await del('service_categories', ids.cat);
  await del('committee_types', ids.ct);
  const left = await inA(async () => [
    await db.value('SELECT count(*) FROM gallery_albums WHERE id = $1', [ids.album]), await db.value('SELECT count(*) FROM gallery_albums WHERE id = $1', [ids.emptyAlbum]),
    await db.value('SELECT count(*) FROM service_categories WHERE id = $1', [ids.cat]), await db.value('SELECT count(*) FROM committee_types WHERE id = $1', [ids.ct])].map(Number));
  assert.deepEqual(left, [1, 0, 1, 1]);
});

test('auction gallery: photos are added, and only the record\'s own photos can be removed', async () => {
  const id = await inA(() => db.value("INSERT INTO auction_notices (title, status, images, tracking_number) VALUES ('Gal', 'upcoming', '[\"auction-notices/a.jpg\"]', 'AUC-1') RETURNING id"));
  const tok = await admin.token(`/admin/r/auction_notices/${id}/edit`);
  const png = await pngBuf();
  const r = await admin.agent.post(`/admin/r/auction_notices/${id}?_csrf=${encodeURIComponent(tok)}`).set('Host', HA).field('_csrf', tok).field('title', 'Gal').field('status', 'upcoming')
    .field('remove_images', 'auction-notices/a.jpg').field('remove_images', 'settings/logo.png').attach('images', png, 'n.png').attach('images', png, 'm.png');
  assert.equal(r.status, 302);
  const imgs = JSON.parse(await inA(() => db.value('SELECT images FROM auction_notices WHERE id = $1', [id])));
  assert.equal(imgs.length, 2);
  assert.ok(imgs.every(x => /^auction-notices\/[0-9a-f]{32}\.png$/.test(x)));
});

// ---------------------------------------------------------------- P2-4 dashboard, P2-9 credentials
test('dashboard: KPI widgets and every tab render', async () => {
  let r = await admin.get('/admin');
  assert.equal(r.status, 200);
  assert.match(r.text, /KYC/);
  assert.match(r.text, /href="\/admin\/password-requests"/);
  for (const tab of ['members', 'welfare', 'programs', 'credentials']) {
    r = await admin.get('/admin?tab=' + tab);
    assert.equal(r.status, 200, tab);
  }
  r = await admin.get('/admin?tab=programs');
  assert.match(r.text, /Check-ins|कुल उपस्थिति/);
});

test('office credentials: staff can open the list, only admins+ change entries or see logs', async () => {
  await inA(() => db.query("INSERT INTO admin_users (username, password, full_name, role, is_active, status) VALUES ('staff1', $1, 'St', 'staff', 1, 'active')", [require('bcryptjs').hashSync(PW, 4)]));
  await inA(() => db.query("INSERT INTO office_credentials (site_name, site_url, username, category, password_enc, password_iv, is_active, sort_order, created_by) VALUES ('Bank', 'https://bank.example.np/login', 'coop1', 'bank', '', '', 1, 0, 1)"));
  const st = client();
  await st.form('/admin/login', { username: 'staff1', password: PW }, '/admin/login');
  let r = await st.get('/admin/credentials');
  assert.equal(r.status, 200);
  assert.match(r.text, /bank\.example\.np\/favicon\.ico/);
  assert.doesNotMatch(r.text, /name="site_logo"/);
  const id = await inA(() => db.value("SELECT id FROM office_credentials WHERE site_name = 'Bank'"));
  r = await st.form(`/admin/credentials/${id}/delete`, {}, '/admin/credentials');
  assert.equal(r.status, 403);
  assert.equal((await st.get(`/admin/credentials/${id}/log`)).status, 403);
  r = await admin.get(`/admin/credentials/${id}/log`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Access log|पहुँच लग/);
});

// ---------------------------------------------------------------- P2-10 notifications
test('notifications: one-member push with type, push log, clear old subscriptions, template test, per-module office alerts', async () => {
  const mid = await inA(() => db.value("INSERT INTO members (name, name_np, phone, sadasyata_number, approval_status, is_active) VALUES ('Push M', 'पुश', '9841999999', 'PM-1', 'approved', 1) RETURNING id"));
  let r = await admin.form('/admin/notifications/push', { title: 'तपाईंको कार्ड तयार', body: 'x', target: 'PM-1', type: 'success' }, '/admin/notifications');
  assert.equal(r.status, 302);
  const n = await inA(() => db.many('SELECT member_id, type FROM member_notifications WHERE title = $1', ['तपाईंको कार्ड तयार']));
  assert.deepEqual(n.map(x => [x.member_id, x.type]), [[mid, 'success']]);
  await inA(() => db.query("INSERT INTO member_push_subscriptions (member_id, endpoint, p256dh, auth, created_at) VALUES ($1, 'https://fcm.googleapis.com/x', 'p', 'a', now() - interval '120 days')", [mid]));
  await admin.form('/admin/notifications/push/clear-expired', {}, '/admin/notifications');
  assert.equal(Number(await inA(() => db.value('SELECT count(*) FROM member_push_subscriptions WHERE member_id = $1', [mid]))), 0);
  const tid = await inA(() => db.value("INSERT INTO notification_templates (event_type, audience, channel, body, enabled) VALUES ('grievance', 'admin', 'sms', 'नमस्ते {{name}} {{tracking_id}}', 1) ON CONFLICT (event_type, audience, channel) DO UPDATE SET enabled = 1 RETURNING id"));
  r = await admin.get('/admin/notifications');
  assert.match(r.text, /name="target"/);
  assert.match(r.text, new RegExp(`<option value="${tid}">`));
  await admin.form('/admin/notifications/template-test', { template_id: String(tid), to: '9841000000' }, '/admin/notifications');
  assert.ok(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'template_test'")));
  // office alert toggles: email for grievances switched off → adminEvent sends no email
  const notify = require('../src/lib/notify');
  await setSetting('notify_admin_emails', 'office@x.np');
  await setSetting('notify_email_grievance', '0');
  const before = Number(await inA(() => db.value("SELECT count(*) FROM notification_log WHERE channel = 'email'")));
  await inA(() => notify.adminEvent(require('../src/modules/applications').grievance, { name: 'X' }));
  assert.equal(Number(await inA(() => db.value("SELECT count(*) FROM notification_log WHERE channel = 'email'"))), before);
});

// ---------------------------------------------------------------- P2-14 licence
test('licence expired: a non-superadmin with the right password can send a payment notice, not sign in; notices can be withdrawn', async () => {
  process.env.LICENSE_ESEWA_ID = '98000-PAY';
  await db.query("UPDATE platform.tenants SET license_valid_until = CURRENT_DATE - 3 WHERE slug = $1", [A]);
  tenants.clearCache();
  try {
    const c = client();
    let r = await c.form('/admin/login', { username: 'admin2', password: 'wrong-password' }, '/admin/login');
    assert.equal(r.status, 401);
    assert.equal((await c.get('/admin/license/blocked')).headers.location, '/admin/login');
    r = await c.form('/admin/login', { username: 'admin2', password: PW }, '/admin/login');
    assert.equal(r.headers.location, '/admin/license/blocked');
    r = await c.get('/admin/license/blocked');
    assert.equal(r.status, 200);
    assert.match(r.text, /98000-PAY/);
    r = await c.form('/admin/license/blocked', { gateway: 'esewa', txn_reference: 'TXN-777', amount: '5000' }, '/admin/license/blocked');
    assert.equal(r.headers.location, '/admin/license/blocked');
    assert.equal((await c.get('/admin')).status, 403); // still not signed in (licence page)
    const n = await inA(() => db.one("SELECT * FROM site_license_renewal_notices WHERE txn_reference = 'TXN-777'"));
    assert.equal(n.submitted_by_username, 'admin2');
  } finally {
    await db.query('UPDATE platform.tenants SET license_valid_until = NULL WHERE slug = $1', [A]);
    tenants.clearCache();
    delete process.env.LICENSE_ESEWA_ID;
  }
  const id = await inA(() => db.value("SELECT id FROM site_license_renewal_notices WHERE txn_reference = 'TXN-777'"));
  await admin.form('/admin/license/cancel', { id: String(id) }, '/admin/license');
  assert.equal(await inA(() => db.value('SELECT status FROM site_license_renewal_notices WHERE id = $1', [id])), 'cancelled');
});
