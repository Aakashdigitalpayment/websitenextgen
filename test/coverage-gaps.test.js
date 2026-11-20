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
