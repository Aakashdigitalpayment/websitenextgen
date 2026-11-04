'use strict';
/**
 * Members & member portal: self-registration, approval queue, OTP password reset, member 2FA, profile changes,
 * KYC documents, monthly saving, export / archive, duplicate guard, activity, ID card lock, tracker, legacy URLs.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'mem.local';
process.env.PLATFORM_HOST = 'platform.mem.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const totp = require('../src/lib/totp');
const auth = require('../src/lib/auth');
const portal = require('../src/lib/member-portal');
const legacy = require('../src/lib/legacy-urls');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'ma' + SUFFIX;
const HA = `${A}.mem.local`;
const PW = 'Admin@12345!';
let app;

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
const inA = fn => db.withSchema('tenant_' + A, fn);
const setting = (k, v) => inA(() => require('../src/lib/settings').set(k, v));
async function adminClient() {
  const c = client();
  const r = await c.form('/admin/login', { username: 'admin', password: PW });
  assert.equal(r.status, 302);
  return c;
}
async function memberClient(identifier, password) {
  const c = client();
  const r = await c.form('/member/login', { identifier, password });
  return { c, r };
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Members A', domains: [HA], adminPassword: PW });
  await inA(() => db.query('UPDATE admin_users SET must_change_password = 0'));
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${A} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [A]);
  await db.pool.end();
});

test('unit: id / mobile normalisation, monthly saving parser, signed card links', () => {
  assert.equal(portal.normalizeId(' a-१०२ '), 'A-102');
  assert.deepEqual(portal.idVariants('A-12'), ['A-12', 'A-१२']);
  assert.equal(portal.normalizeMobile('+977-9841-000001'), '9841000001');
  assert.ok(portal.phonesMatch('9841000001', '977 9841000001'));
  assert.deepEqual(portal.parseMonthlySaving('नियमित'), { ok: true, value: 1 });
  assert.deepEqual(portal.parseMonthlySaving('Not Regular'), { ok: true, value: 0 });
  assert.deepEqual(portal.parseMonthlySaving(''), { ok: true, value: null });
  assert.equal(portal.parseMonthlySaving('maybe').ok, false);
  const t = (np, en) => en;
  assert.match(portal.passwordPolicyError('short', t), /8/);
  assert.match(portal.passwordPolicyError('alllower1', t), /capital/);
  assert.equal(portal.passwordPolicyError('Good1234', t), null);
  db.withSchema('tenant_' + A, () => {
    const link = portal.signCardLink(42);
    const u = new URL(link, 'http://x');
    assert.equal(portal.checkCardLink(u.searchParams.get('mid'), u.searchParams.get('exp'), u.searchParams.get('sig')), 'ok');
    assert.equal(portal.checkCardLink('43', u.searchParams.get('exp'), u.searchParams.get('sig')), 'bad-signature');
    assert.equal(portal.checkCardLink('42', String(Math.floor(Date.now() / 1000) - 5), u.searchParams.get('sig')), 'expired');
  });
});

test('legacy PHP URLs redirect (301) to the new routes', async () => {
  const c = client();
  const cases = [
    ['/attend.php?token=abcdefghijklmnopqrstuv', '/member/attend?t=abcdefghijklmnopqrstuv'],
    ['/attend.php?qr_token=abcdefghijklmnopqrstuv', '/member/attend?t=abcdefghijklmnopqrstuv'],
    ['/verify.php?id=A-1', '/verify'],
    ['/application-tracker.php?id=GR-123456-ABCD', '/track?id=GR-123456-ABCD'],
    ['/news-detail.php?id=7', '/news/7'],
    ['/login.php', '/member/login'],
    ['/member/login.php?tab=register', '/member/register'],
    ['/member/attend.php?qr_token=abcdefghijklmnopqrstuv', '/member/attend?t=abcdefghijklmnopqrstuv'],
    ['/member/profile.php', '/member/profile'],
    ['/member/password-reset-request.php', '/member/forgot'],
    ['/notices.php?id=x', '/notices'],
  ];
  for (const [from, to] of cases) {
    const r = await c.get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.headers.location, to, from);
  }
  assert.ok(Object.keys(legacy.PUBLIC).length > 50);
  assert.equal((await c.get('/unknown-page.php')).status, 404);
});

test('self-registration attaches a password to the ledger member; pending until approved, then notified', async () => {
  await inA(() => db.query("INSERT INTO members (name, name_np, phone, sadasyata_number, approval_status, is_active) VALUES ('Ram Thapa', 'राम थापा', '9841100001', 'R-100', 'pending', 1)"));
  const c = client();
  // live availability check
  const av = await c.get('/member/check-availability?field=sadasyata_number&value=R-100');
  assert.equal(av.body.available, true);
  // wrong mobile
  let r = await c.form('/member/register', { sadasyata_number: 'r-100', phone: '9800000000', email: 'ram@example.com', password: 'Secret123', confirm: 'Secret123' });
  assert.equal(r.status, 422);
  assert.match(r.text, /do not match|मिलेन/);
  // unknown member number without KYM
  r = await c.form('/member/register', { sadasyata_number: 'NOPE-1', phone: '9841100001', email: 'x@example.com', password: 'Secret123', confirm: 'Secret123' });
  assert.equal(r.status, 422);
  // weak password
  r = await c.form('/member/register', { sadasyata_number: 'R-100', phone: '9841100001', email: 'ram@example.com', password: 'secret', confirm: 'secret' });
  assert.equal(r.status, 422);
  r = await c.form('/member/register', { sadasyata_number: 'r-100', phone: '9841100001', email: 'Ram@Example.com', password: 'Secret123', confirm: 'Secret123' });
  assert.equal(r.status, 302, r.text.slice(0, 400));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'R-100'"));
  assert.ok(m.password_hash);
  assert.equal(m.email, 'ram@example.com');
  assert.equal((await c.get('/member/check-availability?field=sadasyata_number&value=R-100')).body.available, false);
  // registering twice is refused
  r = await c.form('/member/register', { sadasyata_number: 'R-100', phone: '9841100001', email: 'ram@example.com', password: 'Secret123', confirm: 'Secret123' });
  assert.equal(r.status, 422);
  // pending: cannot sign in yet
  let login = await memberClient('9841100001', 'Secret123');
  assert.equal(login.r.status, 401);
  assert.match(login.r.text, /approval|स्वीकृत/);
  // admin sees it in the queue and approves
  const adm = await adminClient();
  const q = await adm.get('/admin/member-portal');
  assert.match(q.text, /राम थापा/);
  r = await adm.form(`/admin/members/${m.id}/approve`, {}, '/admin/member-portal');
  assert.equal(r.status, 302);
  const after = await inA(() => db.one('SELECT * FROM members WHERE id = $1', [m.id]));
  assert.equal(after.approval_status, 'approved');
  assert.ok(after.card_expires_at);
  assert.ok(await inA(() => db.value("SELECT 1 FROM member_notifications WHERE member_id = $1 AND title LIKE '%स्वीकृत%'", [m.id])));
  login = await memberClient('R-100', 'Secret123');
  assert.equal(login.r.status, 302);
  assert.equal(login.r.headers.location, '/member');
});

test('registration from KYM creates a pending member; rejection shows the reason at sign-in', async () => {
  await inA(() => db.query(`INSERT INTO kyc_applications (tracking_id, member_id, full_name, full_name_en, mobile, email, status, dob_ad, gender)
                            VALUES ('KY-T-1', 'K-200', 'सीता शर्मा', 'Sita Sharma', '9841200002', 'sita@example.com', 'pending', '1990-01-20', 'female')`));
  const c = client();
  const r = await c.form('/member/register', { sadasyata_number: 'K-200', phone: '9841200002', email: 'sita@example.com', password: 'Secret123', confirm: 'Secret123' });
  assert.equal(r.status, 302, r.text.slice(0, 400));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'K-200'"));
  assert.equal(m.name, 'Sita Sharma');
  assert.equal(m.name_np, 'सीता शर्मा');
  assert.equal(m.approval_status, 'pending');
  assert.ok(m.kyc_application_id);
  const adm = await adminClient();
  await adm.form(`/admin/members/${m.id}/reject`, { reason: 'KYM incomplete' }, '/admin/member-portal');
  const login = await memberClient('9841200002', 'Secret123');
  assert.equal(login.r.status, 401);
  assert.match(login.r.text, /KYM incomplete/);
});

test('OTP password reset: generic response, OTP verify, new password works and old sessions end', async () => {
  await setting('notify_email_enabled', '1');
  await setting('smtp_host', '127.0.0.1');
  await setting('smtp_port', '1');
  await inA(async () => db.query("INSERT INTO members (name, phone, email, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Hari', '9841300003', 'hari@example.com', 'H-300', $1, 'approved', 1)", [await auth.hashPassword('OldPass123')]));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'H-300'"));
  const old = await memberClient('H-300', 'OldPass123');
  assert.equal(old.r.status, 302);

  // unknown account: same next step (no enumeration)
  const stranger = client();
  let r = await stranger.form('/member/forgot', { identifier: 'nobody@example.com', action: 'otp' });
  assert.match(r.text, /name="otp"/);
  r = await stranger.form('/member/forgot/verify', { otp: '123456' }, '/member/forgot');
  assert.equal(r.status, 422);

  const c = client();
  r = await c.form('/member/forgot', { identifier: 'hari@example.com', action: 'otp' });
  assert.match(r.text, /name="otp"/);
  const row = await inA(() => db.one("SELECT * FROM member_otp_tokens WHERE member_id = $1 AND purpose = 'password_reset' ORDER BY id DESC LIMIT 1", [m.id]));
  assert.equal(row.otp_code.length, 64, 'OTP stored hashed');
  assert.equal(row.channel, 'email');
  // swap in a known OTP (the real one went to the unreachable test SMTP)
  const otp = await inA(() => portal.createOtp(m.id, 'password_reset', 'email', m.email));
  r = await c.form('/member/forgot/verify', { otp: '000000' === otp ? '111111' : '000000' }, '/member/forgot');
  assert.equal(r.status, 422);
  r = await c.form('/member/forgot/verify', { otp }, '/member/forgot');
  assert.match(r.text, /name="confirm"/);
  r = await c.form('/member/forgot/password', { password: 'weak', confirm: 'weak' }, '/member/forgot');
  assert.equal(r.status, 422);
  r = await c.form('/member/forgot/password', { password: 'NewPass123', confirm: 'NewPass123' }, '/member/forgot');
  assert.equal(r.status, 302);
  assert.equal((await old.c.get('/member')).status, 302, 'old session signed out');
  assert.equal((await memberClient('H-300', 'NewPass123')).r.status, 302);
  // the OTP cannot be replayed
  assert.equal((await inA(() => portal.verifyOtp(m.id, otp, 'password_reset'))).ok, false);
});

test('office reset requests: admin can set a password (member notified) or reject with a reason', async () => {
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Gita', '9841400004', 'G-400', $1, 'approved', 1)", [await auth.hashPassword('OldPass123')]));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'G-400'"));
  const c = client();
  let r = await c.form('/member/forgot', { identifier: 'G-400', action: 'office' });
  assert.match(r.text, /office|कार्यालय/);
  const req1 = await inA(() => db.one("SELECT * FROM member_password_reset_requests WHERE member_id = $1 AND status = 'pending'", [m.id]));
  assert.ok(req1);
  assert.ok(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'password_reset_request' AND entity_id = $1", [m.id])));
  const adm = await adminClient();
  r = await adm.form(`/admin/password-requests/${req1.id}/set`, { new_password: 'Office1234', must_change: '1' }, '/admin/password-requests');
  assert.equal(r.status, 302);
  assert.equal((await inA(() => db.one('SELECT status FROM member_password_reset_requests WHERE id = $1', [req1.id]))).status, 'approved');
  assert.ok(await inA(() => db.value("SELECT 1 FROM member_notifications WHERE member_id = $1 AND title LIKE 'पासवर्ड Reset स्वीकृत%'", [m.id])));
  assert.equal((await memberClient('G-400', 'Office1234')).r.status, 302);
  // second request → rejected
  await c.form('/member/forgot', { identifier: 'G-400', action: 'office' });
  const req2 = await inA(() => db.one("SELECT * FROM member_password_reset_requests WHERE member_id = $1 AND status = 'pending'", [m.id]));
  await adm.form(`/admin/password-requests/${req2.id}/reject`, { note: 'not verified' }, '/admin/password-requests');
  assert.equal((await inA(() => db.one('SELECT status, admin_note FROM member_password_reset_requests WHERE id = $1', [req2.id]))).admin_note, 'not verified');
  assert.ok(await inA(() => db.value("SELECT 1 FROM member_notifications WHERE member_id = $1 AND title LIKE '%अस्वीकृत%'", [m.id])));
});

test('member 2FA: optional enable from profile, then required at sign-in; policy forces setup', async () => {
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Tika', '9841500005', 'T-500', $1, 'approved', 1)", [await auth.hashPassword('Secret123')]));
  const { c } = await memberClient('T-500', 'Secret123');
  const page = await c.get('/member/profile/2fa');
  const secret = page.text.match(/<code style="word-break:break-all">([A-Z2-7]+)<\/code>/)[1];
  let r = await c.form('/member/profile/2fa/enable', { password: 'Secret123', code: totp.codeAt(secret, totp.currentStep()) }, '/member/profile/2fa');
  assert.equal(r.status, 200);
  assert.match(r.text, /backup/i);
  // password alone no longer signs in
  const second = await memberClient('T-500', 'Secret123');
  assert.equal(second.r.headers.location, '/member/login/2fa');
  assert.equal((await second.c.get('/member')).status, 302);
  r = await second.c.form('/member/login/2fa', { code: '000000' }, '/member/login/2fa');
  assert.equal(r.status, 401);
  r = await second.c.form('/member/login/2fa', { code: totp.codeAt(secret, totp.currentStep() + 1) }, '/member/login/2fa');
  assert.equal(r.status, 302);
  assert.equal((await second.c.get('/member')).status, 200);

  // policy: every member must set up 2FA at sign-in
  await setting('member_2fa_required', '1');
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Puja', '9841500006', 'P-501', $1, 'approved', 1)", [await auth.hashPassword('Secret123')]));
  const third = await memberClient('P-501', 'Secret123');
  assert.equal(third.r.headers.location, '/member/login/2fa');
  const setup = await third.c.get('/member/login/2fa');
  const s2 = setup.text.match(/<code style="word-break:break-all">([A-Z2-7]+)<\/code>/)[1];
  r = await third.c.form('/member/login/2fa', { code: totp.codeAt(s2, totp.currentStep()) }, '/member/login/2fa');
  assert.match(r.text, /backup/i);
  r = await third.c.form('/member/login/2fa', {}, '/member/login/2fa');
  assert.equal(r.status, 302);
  assert.equal((await third.c.get('/member')).status, 200);
  assert.equal(Number((await inA(() => db.one("SELECT twofa_enabled FROM members WHERE sadasyata_number = 'P-501'"))).twofa_enabled), 1);
  await setting('member_2fa_required', '0');
  // admin can reset a member's 2FA
  const adm = await adminClient();
  const p = await inA(() => db.one("SELECT id FROM members WHERE sadasyata_number = 'P-501'"));
  await adm.form(`/admin/members/${p.id}/2fa-reset`, {}, `/admin/members/${p.id}`);
  assert.equal(Number((await inA(() => db.one('SELECT twofa_enabled FROM members WHERE id = $1', [p.id]))).twofa_enabled), 0);
});

test('profile: details saved, mobile change goes to the office without SMS, KYC documents only fill gaps', async () => {
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Mina', '9841600007', 'M-600', $1, 'approved', 1)", [await auth.hashPassword('Secret123')]));
  await inA(() => db.query("INSERT INTO members (name, phone, sadasyata_number, approval_status, is_active) VALUES ('Other', '9841600099', 'O-699', 'approved', 1)"));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'M-600'"));
  const { c } = await memberClient('M-600', 'Secret123');
  let r = await c.form('/member/profile/details', { name: 'Mina Rai', name_np: 'मिना राई', phone: '9841600099', dob: '1992-02-02', gender: 'female' }, '/member/profile');
  assert.equal(r.status, 422, 'someone else’s number is refused');
  r = await c.form('/member/profile/details', { name: 'Mina Rai', name_np: 'मिना राई', phone: '9841600008', dob: '1992-02-02', gender: 'female' }, '/member/profile');
  assert.equal(r.status, 302);
  const saved = await inA(() => db.one('SELECT * FROM members WHERE id = $1', [m.id]));
  assert.equal(saved.name_np, 'मिना राई');
  assert.equal(saved.phone, '9841600007', 'mobile is not changed until approved');
  const change = await inA(() => db.one("SELECT * FROM member_profile_change_requests WHERE member_id = $1 AND status = 'pending'", [m.id]));
  assert.equal(change.new_value, '9841600008');
  const adm = await adminClient();
  r = await adm.form(`/admin/member-portal/changes/${change.id}`, { action: 'approve' }, '/admin/member-portal?tab=changes');
  assert.equal(r.status, 302);
  assert.equal((await inA(() => db.one('SELECT phone FROM members WHERE id = $1', [m.id]))).phone, '9841600008');

  // KYC documents: only missing ones are accepted
  const kyc = await inA(() => db.one("INSERT INTO kyc_applications (tracking_id, member_id, full_name, mobile, status, photo) VALUES ('KY-T-6', 'M-600', 'मिना', '9841600008', 'approved', 'kyc/existing.jpg') RETURNING id"));
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const tok = await c.token('/member/profile');
  r = await c.agent.post('/member/profile/kyc-docs?_csrf=' + encodeURIComponent(tok)).set('Host', HA)
    .field('_csrf', tok).attach('signature', png, 'sig.png');
  assert.equal(r.status, 302);
  const k = await inA(() => db.one('SELECT * FROM kyc_applications WHERE id = $1', [kyc.id]));
  assert.match(k.signature, /^_private\/kyc\//);
  assert.equal((await c.get('/member/profile/kyc-file/signature')).status, 200);
  // approved KYM locks the personal details
  r = await c.form('/member/profile/details', { name: 'X', name_np: 'X', phone: '9841600008' }, '/member/profile');
  assert.equal(r.status, 302);
  assert.equal((await inA(() => db.one('SELECT name FROM members WHERE id = $1', [m.id]))).name, 'Mina Rai');
});

test('admin: monthly saving, notify one member, activity CSV, export CSV/Excel with filters, archive and restore', async () => {
  const adm = await adminClient();
  const m = await inA(() => db.one("INSERT INTO members (name, phone, sadasyata_number, approval_status, is_active) VALUES ('Saving Member', '9841700009', 'S-700', 'approved', 1) RETURNING *"));
  let r = await adm.form(`/admin/members/${m.id}`, { name: 'Saving Member', sadasyata_number: 'S-700', phone: '9841700009', approval_status: 'approved', is_active: '1', monthly_saving: '1' }, `/admin/members/${m.id}`);
  assert.equal(r.status, 302, r.text.slice(0, 300));
  assert.equal(Number((await inA(() => db.one('SELECT monthly_saving_regular FROM members WHERE id = $1', [m.id]))).monthly_saving_regular), 1);
  assert.match((await adm.get('/admin/members?ms=1')).text, /Saving Member/);
  assert.doesNotMatch((await adm.get('/admin/members?ms=0')).text, /Saving Member/);

  r = await adm.form(`/admin/members/${m.id}/notify`, { title: 'Hello member', message: 'AGM on Friday', type: 'info' }, `/admin/members/${m.id}`);
  assert.equal(r.status, 302);
  assert.ok(await inA(() => db.value("SELECT 1 FROM member_notifications WHERE member_id = $1 AND title = 'Hello member'", [m.id])));
  const act = await adm.get(`/admin/members/${m.id}/activities.csv`);
  assert.equal(act.status, 200);
  assert.match(act.text, /Timeline Date,Activity Type/);
  assert.match(act.text, /Hello member/);
  assert.match((await adm.get(`/admin/members/${m.id}/activities`)).text, /Hello member/);

  const csv = await adm.get('/admin/members/export?ms=1');
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /S-700/);
  assert.match(csv.text, /नियमित/);
  assert.doesNotMatch(csv.text, /9841100001/, 'filter respected');
  const xls = await adm.get('/admin/members/export?format=xls&q=Saving');
  assert.match(xls.headers['content-type'], /ms-excel/);
  assert.match(xls.text, /<Workbook/);
  assert.match(xls.text, /S-700/);

  await adm.form(`/admin/members/${m.id}/delete`, {}, `/admin/members/${m.id}`);
  assert.doesNotMatch((await adm.get('/admin/members?q=Saving')).text, /Saving Member/);
  assert.match((await adm.get('/admin/members?view=arch')).text, /Saving Member/);
  r = await adm.form(`/admin/members/${m.id}/restore`, {}, '/admin/members?view=arch');
  assert.equal(r.status, 302);
  assert.equal((await inA(() => db.one('SELECT deleted_at FROM members WHERE id = $1', [m.id]))).deleted_at, null);
});

test('monthly saving field-update import touches only that flag of existing members', async () => {
  const adm = await adminClient();
  await inA(() => db.query("INSERT INTO members (name, phone, sadasyata_number, approval_status, is_active, monthly_saving_regular) VALUES ('F1', '9841800001', 'F-801', 'approved', 1, NULL), ('F2', '9841800002', 'F-802', 'approved', 1, 1)"));
  const tok = await adm.token('/admin/members/import');
  const csv = '﻿member_id,monthly_saving\nf-801,नियमित\nF-802,0\nF-999,1\nF-801,\nF-802,maybe\n';
  const r = await adm.agent.post('/admin/members/import/field-update?_csrf=' + encodeURIComponent(tok)).set('Host', HA)
    .field('_csrf', tok).attach('fu_file', Buffer.from(csv), 'ms.csv');
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const rows = await inA(() => db.many("SELECT sadasyata_number, monthly_saving_regular, name FROM members WHERE sadasyata_number LIKE 'F-8%' ORDER BY 1"));
  assert.equal(Number(rows[0].monthly_saving_regular), 1);
  assert.equal(Number(rows[1].monthly_saving_regular), 0, 'a later invalid row writes nothing; the valid value applies');
  assert.equal(await inA(() => db.value("SELECT count(*) FROM members WHERE sadasyata_number = 'F-999'")), 0, 'never creates members');
  const probs = await adm.get('/admin/members/import/field-update/problems.csv');
  assert.match(probs.text, /F-999/);
  assert.match(probs.text, /maybe/);
});

test('duplicate membership numbers are listed and blocked; the unique guard can be added once clean', async () => {
  const adm = await adminClient();
  // the base tenant has no duplicates, so the migration already added the guard
  assert.equal(await inA(() => portal.uniqueGuardExists()), true);
  await inA(() => db.query('DROP INDEX members_sadasyata_uq'));
  await inA(() => db.query("INSERT INTO members (name, sadasyata_number, approval_status, is_active) VALUES ('D1', 'DUP-1', 'approved', 1), ('D2', 'dup-1 ', 'approved', 1)"));
  let page = await adm.get('/admin/members/duplicates');
  assert.match(page.text, /DUP-1/);
  let r = await adm.form('/admin/members/duplicates/guard', {}, '/admin/members/duplicates');
  assert.equal(await inA(() => portal.uniqueGuardExists()), false);
  // the edit form refuses a duplicate number
  const d3 = await inA(() => db.one("INSERT INTO members (name, sadasyata_number, approval_status, is_active) VALUES ('D3', 'D-3', 'approved', 1) RETURNING id"));
  r = await adm.form(`/admin/members/${d3.id}`, { name: 'D3', sadasyata_number: 'Dup-1', approval_status: 'approved', is_active: '1' }, `/admin/members/${d3.id}`);
  assert.equal(r.status, 422);
  await inA(() => db.query("UPDATE members SET sadasyata_number = 'DUP-2' WHERE name = 'D2'"));
  r = await adm.form('/admin/members/duplicates/guard', {}, '/admin/members/duplicates');
  assert.equal(await inA(() => portal.uniqueGuardExists()), true);
  await assert.rejects(inA(() => db.query("INSERT INTO members (name, sadasyata_number) VALUES ('D4', ' dup-2')")), /duplicate key/);
});

test('ID card: card_prefix honoured, member notified, 5 wrong CVVs lock it, member asks, admin unlocks', async () => {
  await setting('card_prefix', 'XYZ');
  const adm = await adminClient();
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Card Holder', '9841900001', 'C-900', $1, 'approved', 1)", [await auth.hashPassword('Secret123')]));
  const m = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'C-900'"));
  await adm.form(`/admin/members/${m.id}/card`, {}, `/admin/members/${m.id}`);
  const card = await inA(() => db.one("SELECT * FROM member_id_cards WHERE member_id = $1 AND status = 'active'", [String(m.id)]));
  assert.match(card.verification_code, /^XYZ-/);
  assert.ok(await inA(() => db.value("SELECT 1 FROM member_notifications WHERE member_id = $1 AND title LIKE 'डिजिटल परिचयपत्र%'", [m.id])));
  const pub = client();
  let r = await pub.form('/verify', { code: card.verification_code, cvv: card.cvv });
  assert.match(r.text, /Card Holder/);
  for (let i = 0; i < 5; i++) r = await pub.form('/verify', { code: card.verification_code, cvv: card.cvv === '0000' ? '1111' : '0000' });
  assert.match(r.text, /LOCK|locked/);
  r = await pub.form('/verify', { code: card.verification_code, cvv: card.cvv });
  assert.doesNotMatch(r.text, /Card Holder/, 'locked card does not verify even with the right CVV');
  const { c } = await memberClient('C-900', 'Secret123');
  assert.match((await c.get('/member/id-card')).text, /unlock-request/);
  await c.form('/member/id-card/unlock-request', {}, '/member/id-card');
  assert.equal(Number((await inA(() => db.one('SELECT unlock_requested FROM member_id_cards WHERE id = $1', [card.id]))).unlock_requested), 1);
  assert.match((await adm.get('/admin/member-portal?tab=cards')).text, new RegExp(card.verification_code));
  await adm.form(`/admin/members/${m.id}/card/unlock`, {}, `/admin/members/${m.id}`);
  const after = await inA(() => db.one('SELECT * FROM member_id_cards WHERE id = $1', [card.id]));
  assert.equal(after.locked_at, null);
  assert.equal(after.failed_verify_count, 0);
});

test('tracker: phone + email + one tracking number lists all requests and offers a signed ID-card preview', async () => {
  await inA(async () => {
    await db.query("INSERT INTO grievances (tracking_id, name, phone, email, subject, description, status) VALUES ('GR-T-0001', 'Card Holder', '9841900001', 'holder@example.com', 's', 'd', 'pending'), ('GR-T-0002', 'Card Holder', '9841900001', 'holder@example.com', 's2', 'd', 'resolved'), ('GR-T-0003', 'Other', '9841111111', 'o@example.com', 's3', 'd', 'pending')");
    await db.query("UPDATE members SET email = 'holder@example.com' WHERE sadasyata_number = 'C-900'");
  });
  const c = client();
  let r = await c.form('/track', { phone: '9841900001', email: 'holder@example.com', proof: 'GR-T-9999' }, '/track?mode=contact');
  assert.match(r.text, /alert-error/);
  r = await c.form('/track', { phone: '9841900001', email: 'wrong@example.com', proof: 'GR-T-0001' }, '/track?mode=contact');
  assert.doesNotMatch(r.text, /GR-T-0002/);
  r = await c.form('/track', { phone: '9841900001', email: 'HOLDER@example.com', proof: 'gr-t-0001' }, '/track?mode=contact');
  assert.match(r.text, /GR-T-0001/);
  assert.match(r.text, /GR-T-0002/);
  assert.doesNotMatch(r.text, /GR-T-0003/);
  const link = r.text.match(/href="(\/track\/id-card\?[^"]+)"/)[1].replace(/&amp;/g, '&');
  const card = await c.get(link);
  assert.equal(card.status, 200);
  assert.match(card.text, /Card Holder/);
  assert.match(card.headers['cache-control'], /no-store/);
  assert.equal((await c.get(link.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64)))).status, 403);
  // existing id + phone lookup keeps working
  assert.match((await c.get('/track?id=GR-T-0002&phone=9841900001')).text, /badge-ok/);
});

test('scan page and Facebook sign-in are wired (Facebook only when configured)', async () => {
  await inA(async () => db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Scanner', '9841990001', 'SC-1', $1, 'approved', 1)", [await auth.hashPassword('Secret123')]));
  const { c } = await memberClient('SC-1', 'Secret123');
  const scan = await c.get('/member/scan');
  assert.equal(scan.status, 200);
  assert.match(scan.text, /member-scan\.js/);
  assert.doesNotMatch((await client().get('/member/login')).text, /oauth\/facebook/);
  assert.equal((await client().get('/member/oauth/facebook')).headers.location, '/member/login');
  await setting('facebook_app_id', '123');
  await setting('facebook_app_secret', 'abc');
  const login = await client().get('/member/login');
  assert.match(login.text, /oauth\/facebook/);
  const go = await client().get('/member/oauth/facebook');
  assert.match(go.headers.location, /^https:\/\/www\.facebook\.com\/v18\.0\/dialog\/oauth\?/);
  assert.match(go.headers.location, /redirect_uri=http%3A%2F%2F[^&]+%2Fmember%2Foauth%2Ffacebook%2Fcallback/);
  // a callback without the matching state is refused
  const cb = await client().get('/member/oauth/facebook/callback?code=x&state=forged');
  assert.equal(cb.headers.location, '/member/login');
});
