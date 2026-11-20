'use strict';
/** Gaps closed from docs/parity/coverage.md (SM-n = Part A §6, B-n = Part B §7). */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
process.env.PII_KEY = process.env.PII_KEY || 'test-only-pii-key-0123456789abcdef0123456789';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'cg' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
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
async function adminClient() {
  const c = client();
  const r = await c.form('/admin/login', { username: 'admin', password: PW });
  assert.equal(r.status, 302, 'admin login');
  return c;
}
async function seedMember(sid, phone, { name = 'Member ' + sid, kycName = 'KYC ' + sid } = {}) {
  return inA(async () => {
    const m = await db.one(`INSERT INTO members (name, name_np, phone, email, sadasyata_number, approval_status, is_active)
                            VALUES ($1, $2, $3, $4, $5, 'approved', 1) RETURNING *`, [name, 'सदस्य ' + sid, phone, sid.toLowerCase() + '@example.com', sid]);
    const k = await db.one(`INSERT INTO kyc_applications (tracking_id, member_id, full_name, full_name_en, mobile, email, permanent_address, citizenship_no, status, father_name, dob_bs, photo)
                            VALUES ($1, $2, $3, $4, $5, $6, 'Kathmandu-5', '11-22-3334567', 'approved', $7, '2040-01-15', 'kyc/p.jpg') RETURNING *`,
    ['KY-' + sid, sid, kycName, kycName, phone, 'kyc.' + sid.toLowerCase() + '@example.com', 'Father of ' + kycName]);
    await db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2', [k.id, m.id]);
    return { m, k };
  });
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Coverage A', domains: [HA], adminPassword: PW });
  await inA(async () => {
    await db.query('UPDATE admin_users SET must_change_password = 0');
    await require('../src/lib/settings').set('spam_math_captcha', '0');
  });
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

// ---------------------------------------------------------------- SM-1 derived CVV on PHP-issued cards
test('SM-1: PHP derived CVV (name + Member ID) verifies; Node 4-digit CVV still works; wrong tries lock', async () => {
  const portal = require('../src/lib/member-portal');
  assert.equal(portal.deriveCardCvv('Sujan Sharma', 'MEM-2081-0123'), 'SUJ0123');
  assert.equal(portal.deriveCardCvv('  jo   doe', '7'), 'JOX0007');
  assert.equal(portal.deriveCardCvv('सुजन शर्मा', 'A-12345'), 'सुज2345');
  assert.equal(portal.deriveCardCvv('रा', ''), 'राX0000');
  assert.equal(portal.cvvMatches(' suj 0123 ', '1234', ['SUJ0123']), true);
  assert.equal(portal.cvvMatches('1234', '1234', ['SUJ0123']), true);
  assert.equal(portal.cvvMatches('SUJ0124', '1234', ['SUJ0123']), false);
  assert.equal(portal.cvvMatches('', '', []), false);

  const { m } = await seedMember('CV-0123', '9841600001', { kycName: 'Sujan Sharma' });
  await inA(() => db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status)
                            VALUES ($1, 'CARD-2081-0001', 'TST-CVVA-BBBB', 'SUJ0123', CURRENT_DATE, CURRENT_DATE + 365, 'active')`, [String(m.id)]));
  const c = client();
  let r = await c.form('/verify', { mode: 'code', code: 'TST-CVVA-BBBB', cvv: 'suj0123' });
  assert.match(r.text, /badge-ok/, 'lower-case derived CVV verifies');
  assert.match(r.text, /name="cvv" maxlength="20"/);
  r = await c.form('/verify', { mode: 'name', name: 'Sujan Sharma', member_no: 'CV-0123', mobile: '9841600001', cvv: 'SUJ0123' });
  assert.match(r.text, /badge-ok/, 'derived CVV accepted on the name path');
  assert.equal(await inA(() => db.value("SELECT failed_verify_count FROM member_id_cards WHERE card_no = 'CARD-2081-0001'")), 0);

  // a Node card (random 4 digits) still verifies with its stored CVV
  const { m: m2 } = await seedMember('CV-0200', '9841600002');
  await inA(() => db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status)
                            VALUES ($1, 'CARD-2081-0002', 'TST-CVVB-BBBB', '4321', CURRENT_DATE, CURRENT_DATE + 365, 'active')`, [String(m2.id)]));
  r = await c.form('/verify', { mode: 'code', code: 'TST-CVVB-BBBB', cvv: '४३२१' });
  assert.match(r.text, /badge-ok/);
  for (let i = 0; i < 5; i++) r = await c.form('/verify', { mode: 'code', code: 'TST-CVVA-BBBB', cvv: 'SUJ0124' });
  assert.match(r.text, /LOCK/, 'wrong derived CVV counts toward the lock');
});

// ---------------------------------------------------------------- SM-2 legacy /assets/uploads URLs
test('SM-2: /assets/uploads/<public folder> redirects to /uploads; gated folders are never public', async () => {
  const up = require('../src/lib/uploads');
  const dir = path.join(config.uploadDir, A);
  fs.mkdirSync(path.join(dir, 'news'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'news', 'x.jpg'), 'img');
  let r = await client().get('/assets/uploads/news/x.jpg?v=2');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, '/uploads/news/x.jpg?v=2');
  assert.equal((await client().get('/uploads/news/x.jpg')).status, 200);
  assert.equal((await client().get('/assets/uploads/kyc/x.jpg')).status, 404);
  assert.equal((await client().get('/assets/uploads/admin-replies/r.pdf')).status, 404);
  assert.equal((await client().get('/assets/uploads/_private/kyc/x.jpg')).status, 404);
  const admin = await adminClient();
  r = await admin.get('/assets/uploads/kyc/x.jpg');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/admin/files/_private/kyc/x.jpg');
  assert.equal(up.mediaUrl('assets/images/logo.png'), '');
  assert.equal(up.mediaUrl('assets/uploads/loan/a.pdf'), '/admin/files/_private/loan/a.pdf');
});

// ---------------------------------------------------------------- SM-3 gated folders → private storage
test('SM-3: migration moves every file of the PHP-gated folders to private storage and rewrites stored paths', async () => {
  const mig = require('../src/lib/site-migration');
  const dir = path.join(config.uploadDir, A);
  const put = (rel, body = 'x') => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), body); };
  for (const f of ['kyc/a.jpg', 'kyc/orphan.jpg', 'loan/b.pdf', 'loan/c.pdf', 'admin-replies/r.pdf', 'welfare_claims/sub/w.pdf', 'news/n.jpg']) put(f);
  assert.equal((await client().get('/uploads/kyc/orphan.jpg')).status, 404, 'gated folder blocked even before the move');
  const ids = await inA(async () => {
    await require('../src/lib/settings').set('site_url', 'https://www.oldcoop.example');
    const loan = await db.value(`INSERT INTO loan_applications (full_name, mobile, documents, admin_attachment) VALUES ('L', '9841000000', 'assets/uploads/loan/b.pdf, loan/c.pdf', 'admin-replies/r.pdf') RETURNING id`);
    const news = await db.value(`INSERT INTO news (title, content) VALUES ('N', $1) RETURNING id`,
      ['<p><img src="https://oldcoop.example/assets/uploads/news/n.jpg"> <a href="/assets/uploads/kyc/a.jpg">doc</a> see loan/b.pdf in text</p>']);
    return { loan, news };
  });
  const r = await inA(() => mig.protectGatedUploads(dir));
  assert.ok(r.moved >= 6, 'moved ' + r.moved);
  for (const f of ['kyc/a.jpg', 'kyc/orphan.jpg', 'loan/b.pdf', 'loan/c.pdf', 'admin-replies/r.pdf', 'welfare_claims/sub/w.pdf']) {
    assert.ok(fs.existsSync(path.join(dir, '_private', f)), f + ' is private');
    assert.ok(!fs.existsSync(path.join(dir, f)), f + ' left the public folder');
  }
  assert.ok(fs.existsSync(path.join(dir, 'news/n.jpg')), 'public folders stay');
  const loan = await inA(() => db.one('SELECT documents, admin_attachment FROM loan_applications WHERE id = $1', [ids.loan]));
  assert.equal(loan.documents, '_private/loan/b.pdf,_private/loan/c.pdf');
  assert.equal(loan.admin_attachment, '_private/admin-replies/r.pdf');
  const news = await inA(() => db.value('SELECT content FROM news WHERE id = $1', [ids.news]));
  assert.match(news, /src="\/uploads\/news\/n\.jpg"/);
  assert.match(news, /href="\/admin\/files\/_private\/kyc\/a\.jpg"/);
  assert.match(news, /see loan\/b\.pdf in text/, 'free text untouched');
  // re-run is a no-op
  const again = await inA(() => mig.protectGatedUploads(dir));
  assert.equal(again.moved, 0);
  assert.equal(await inA(() => db.value('SELECT documents FROM loan_applications WHERE id = $1', [ids.loan])), '_private/loan/b.pdf,_private/loan/c.pdf');
  assert.ok(mig.fileColumns().loan_applications.some(c => c.col === 'admin_attachment' && c.private));
  const admin = await adminClient();
  assert.equal((await admin.get('/admin/files/_private/loan/c.pdf')).status, 200);
});

// ---------------------------------------------------------------- SM-5 members-only reports private
test('SM-5: report / institutional-profile files are private; migrated members-only files are moved up front', async () => {
  const mig = require('../src/lib/site-migration');
  const { resources } = require('../src/modules/resources');
  assert.ok(resources.reports.privateFiles && resources.institutional_profile.privateFiles, 'uploads go to _private from the start');
  const dir = path.join(config.uploadDir, A);
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'agm.pdf'), '%PDF-1.4');
  const id = await inA(() => db.value(`INSERT INTO reports (title, title_np, file_path, access_level, is_active) VALUES ('AGM', 'साधारण सभा', 'assets/uploads/reports/agm.pdf', 'member', 1) RETURNING id`));
  await inA(() => mig.privatiseFileColumns(dir));
  assert.equal(await inA(() => db.value('SELECT file_path FROM reports WHERE id = $1', [id])), '_private/reports/agm.pdf');
  assert.equal((await client().get('/uploads/reports/agm.pdf')).status, 404);
  assert.equal((await client().get('/reports/' + id + '/file')).status, 403, 'members only');
});

// ---------------------------------------------------------------- SM-6 / SM-7 card lookup and partner QR
test('SM-6: card lookup by code without dashes or by card number; SM-7: verify.php keeps the partner', async () => {
  const { m } = await seedMember('CL-0300', '9841600003', { kycName: 'Hari Prasad' });
  await inA(() => db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status)
                            VALUES ($1, 'BAN-2026-00031', 'BAN-AB12-CD34', '5555', CURRENT_DATE, CURRENT_DATE + 365, 'active')`, [String(m.id)]));
  const c = client();
  let r = await c.form('/verify', { mode: 'code', code: 'banab12cd34', cvv: '5555' });
  assert.match(r.text, /badge-ok/, 'code without dashes');
  r = await c.form('/verify', { mode: 'code', code: 'BAN202600031', cvv: 'HAR0300' });
  assert.match(r.text, /badge-ok/, 'card number without dashes + derived CVV');
  r = await c.form('/verify', { mode: 'code', code: 'BAN-2026-00031', cvv: '5555' });
  assert.match(r.text, /badge-ok/, 'card number as printed');
  const legacy = require('../src/lib/legacy-urls');
  assert.equal(legacy.PUBLIC['verify.php']({ partner: 'HOSP1' }), '/verify?partner=HOSP1');
  assert.equal(legacy.PUBLIC['verify.php']({ partner_id: '7', x: 'y' }), '/verify?partner_id=7');
  r = await client().get('/verify.php?partner=HOSP1');
  assert.equal(r.status, 301);
  assert.equal(r.headers.location, '/verify?partner=HOSP1');
});

async function memberClient(sid) {
  await inA(async () => db.query('UPDATE members SET password_hash = $1 WHERE sadasyata_number = $2', [await require('bcryptjs').hash('Member@12345', 4), sid]));
  const c = client();
  const r = await c.form('/member/login', { identifier: sid, password: 'Member@12345' });
  assert.equal(r.status, 302, 'member login ' + sid);
  return c;
}

// ---------------------------------------------------------------- SM-8 certificate KYM details
test('SM-8: membership certificate shows the linked KYM details, citizenship masked', async () => {
  await seedMember('CT-0400', '9841600004', { kycName: 'Gita Rai' });
  await inA(() => db.query("UPDATE kyc_applications SET account_type = 'Saving' WHERE member_id = 'CT-0400'"));
  const c = await memberClient('CT-0400');
  const r = await c.get('/member/certificate');
  assert.equal(r.status, 200);
  assert.match(r.text, /Father of Gita Rai/);
  assert.match(r.text, /Kathmandu-5/);
  assert.match(r.text, /Saving/);
  assert.match(r.text, /•+4567/);
  assert.doesNotMatch(r.text, /11-22-3334567/, 'citizenship number is masked');
  assert.match(r.text, /src="\/member\/kyc-print\/file\/photo"/);
});
