'use strict';
/** Public forms + member portal parity (docs/parity/2-forms-member.md). */
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
const forms = require('../src/lib/forms');
const modules = require('../src/modules/applications');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'fm' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
// second tenant: the public form rate limit (20 per 10 min) is per tenant + IP
const B = 'fn' + SUFFIX, HB = `${B}.app.local`;
const inB = fn => db.withSchema('tenant_' + B, fn);
let app;
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');

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
    async multipart(url, data, files = {}, tokenUrl = url) {
      const tok = await this.token(tokenUrl);
      let r = agent.post(url + (url.includes('?') ? '&' : '?') + '_csrf=' + encodeURIComponent(tok)).set('Host', host).field('_csrf', tok);
      // files: { field: Buffer | Buffer[] }
      for (const [k, v] of Object.entries(data)) for (const x of [].concat(v)) r = r.field(k, x);
      for (const [k, v] of Object.entries(files)) r = r.attach(k, v, k + '.jpg');
      return r;
    },
  };
}
async function memberClient(identifier, password) {
  const c = client();
  const r = await c.form('/member/login', { identifier, password });
  assert.equal(r.status, 302, 'member login ' + identifier + ': ' + r.text.slice(0, 200));
  return c;
}
const hash = pw => require('bcryptjs').hash(pw, 4);
/** Field errors of a 422 form page (for assertion messages). */
const errs = r => [...String(r.text || '').matchAll(/<label[^>]*>([^<]*)[\s\S]{0,1500}?field-error">([^<]*)/g)].map(m => m[1] + ': ' + m[2]).join(' | ') + (String(r.text || '').match(/alert-error[^>]*>[\s\S]{0,200}?<span>([^<]*)/) || [])[1];

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Forms A', domains: [HA], adminPassword: PW });
  await tenants.createTenant({ slug: B, name: 'Forms B', domains: [HB], adminPassword: PW });
  for (const s of [A, B]) {
    await db.withSchema('tenant_' + s, async () => {
      await db.query('UPDATE admin_users SET must_change_password = 0');
      await require('../src/lib/settings').set('spam_math_captcha', '0');
    });
  }
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  for (const s of [A, B]) {
    await db.query(`DROP SCHEMA IF EXISTS tenant_${s} CASCADE`);
    await db.query('DELETE FROM platform.tenants WHERE slug = $1', [s]);
    fs.rmSync(path.join(config.uploadDir, s), { recursive: true, force: true });
  }
  await db.pool.end();
});

// ---------------------------------------------------------------- P1-3 digital services
test('digital service: fields follow the chosen service; share amount required', async () => {
  const opts = { service_type: await inA(() => require('../src/lib/forms').optionSources.digitalTypes()) };
  const base = { requester_name: 'A', phone: '9841000000' };
  let r = forms.validate(modules.digital, { ...base, service_type: 'share_refund' }, {}, opts, 'en');
  assert.ok(r.errors.service_amount, 'amount required for a share refund');
  r = forms.validate(modules.digital, { ...base, service_type: 'mobile_recharge', recharge_number: '9841000001', recharge_amount: '100', statement_from: '2024-01-01', biller_name: 'NEA' }, {}, opts, 'en');
  assert.deepEqual(r.errors, {});
  assert.equal(r.data.recharge_amount, 100);
  assert.equal(r.data.statement_from, undefined, 'statement dates only for a statement request');
  assert.equal(r.data.biller_name, undefined);
  r = forms.validate(modules.digital, { ...base, service_type: 'statement_request', statement_from: '2024-01-01' }, {}, opts, 'en');
  assert.equal(r.data.statement_from, '2024-01-01');
});

// ---------------------------------------------------------------- P1-4 auction bids
test('auction bid: open window, minimum price, mobile, 24 h duplicate, BID tracking id', async () => {
  const auctions = require('../src/lib/auctions');
  // 2024-01-01 17:00 Nepal time = 11:15 UTC
  assert.equal(auctions.endTimestamp({ auction_date: '2024-01-01', auction_time: '5:00 PM' }), Date.UTC(2024, 0, 1, 11, 15));
  assert.equal(auctions.endTimestamp({ auction_date: '2024-01-01', auction_time: '' }), Date.UTC(2024, 0, 1, 23, 59, 59) - 345 * 60_000);
  const [open, past] = await inA(async () => [
    await db.one("INSERT INTO auction_notices (title, minimum_price, auction_date, status, is_active) VALUES ('Open land', 100000, CURRENT_DATE + 5, 'ongoing', 1) RETURNING id"),
    await db.one("INSERT INTO auction_notices (title, minimum_price, auction_date, auction_time, status, is_active) VALUES ('Old land', 1, CURRENT_DATE - 2, '10:00', 'ongoing', 1) RETURNING id"),
  ]);
  const c = client();
  const page = await c.get('/apply/bid');
  assert.match(page.text, /Open land/);
  assert.doesNotMatch(page.text, /Old land/, 'ended auctions are not offered');
  const detail = await c.get('/auctions/' + past.id);
  assert.doesNotMatch(detail.text, /apply\/bid\?auction=/);
  const bid = { auction_id: String(open.id), bidder_name: 'Bidder', bidder_phone: '9841000001', bid_amount: '50000' };
  let r = await c.form('/apply/bid', bid);
  assert.equal(r.status, 422);
  assert.match(r.text, /कम्तीमा रु\./);
  r = await c.form('/apply/bid', { ...bid, auction_id: String(past.id), bid_amount: '500' });
  assert.equal(r.status, 422);
  r = await c.form('/apply/bid', { ...bid, bidder_phone: '014412345', bid_amount: '150000' });
  assert.equal(r.status, 422, 'landline rejected');
  r = await c.form('/apply/bid', { ...bid, bid_amount: '150000' });
  assert.equal(r.status, 302, errs(r));
  const row = await inA(() => db.one('SELECT * FROM auction_bids WHERE auction_id = $1', [open.id]));
  assert.match(row.tracking_id, /^BID-/);
  r = await c.form('/apply/bid', { ...bid, bid_amount: '160000' });
  assert.equal(r.status, 422, 'second pending bid within 24 h');
  const tr = await c.get(`/track?id=${row.tracking_id}&phone=9841000001`);
  assert.match(tr.text, new RegExp(row.tracking_id));
  assert.match(tr.text, /Bidder/);
});

// ---------------------------------------------------------------- P1-5 tracker: assigned Member ID
test('tracker shows the Member ID assigned to an approved membership request, with a KYM link', async () => {
  await inA(() => db.query("INSERT INTO membership_applications (tracking_id, full_name, mobile, address, status, assigned_sadasyata) VALUES ('MB-TEST-AS1', 'New Person', '9841222333', 'Ktm', 'approved', 'M-777')"));
  const r = await client().get('/track?id=MB-TEST-AS1&phone=9841222333');
  assert.match(r.text, /M-777/);
  assert.match(r.text, /href="\/apply\/kyc"/);
});

// ---------------------------------------------------------------- P1-1 member identity on public forms
async function seedMember(sid, phone, { kycStatus = 'approved', password = null, name = 'Member ' + sid } = {}) {
  return inA(async () => {
    const m = await db.one(`INSERT INTO members (name, name_np, phone, email, sadasyata_number, approval_status, is_active, password_hash)
                            VALUES ($1, $2, $3, $4, $5, 'approved', 1, $6) RETURNING *`, [name, 'सदस्य ' + sid, phone, sid.toLowerCase() + '@example.com', sid, password ? await hash(password) : null]);
    let k = null;
    if (kycStatus) {
      k = await db.one(`INSERT INTO kyc_applications (tracking_id, member_id, full_name, full_name_en, mobile, email, permanent_address, citizenship_no, status)
                        VALUES ($1, $2, $3, $4, $5, $6, 'Kathmandu-5', '11-22-333', $7) RETURNING *`, ['KY-' + sid, sid, 'केवाइसी ' + sid, 'KYC ' + sid, phone, 'kyc.' + sid.toLowerCase() + '@example.com', kycStatus]);
      await db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2', [k.id, m.id]);
    }
    return { m, k };
  });
}

test('member gate: Member ID + mobile checked against the KYM, identity taken from the KYM', async () => {
  await seedMember('G-100', '9841500001');
  await seedMember('G-101', '9841500002', { kycStatus: 'pending' });
  const c = client();
  const g = { is_coop_member: 'yes', member_id: 'g-100', phone: '9841500009', name: 'Typed Name', email: 'typed@example.com', subject: 'S', description: 'D', category: 'service' };
  let r = await c.form('/apply/grievance', g);
  assert.equal(r.status, 422, 'mobile does not match the Member ID');
  assert.match(r.text, /मोबाइल नम्बर मिलेन/);
  r = await c.form('/apply/grievance', { ...g, phone: '9841500001' });
  assert.equal(r.status, 302, errs(r));
  const row = await inA(() => db.one("SELECT * FROM grievances WHERE member_id = 'G-100' ORDER BY id DESC LIMIT 1"));
  assert.equal(row.name, 'केवाइसी G-100', 'name from the KYM, not the POST');
  assert.equal(row.email, 'kyc.g-100@example.com');
  // grievance needs an approved KYM; a loan accepts any KYM
  r = await c.form('/apply/grievance', { ...g, member_id: 'G-101', phone: '9841500002' });
  assert.equal(r.status, 422);
  assert.match(r.text, /approved/);
  const loanType = (await inA(() => forms.optionSources.loanTypes()))[0][0];
  r = await c.form('/apply/loan', { is_coop_member: 'yes', member_id: 'G-101', mobile: '9841500002', loan_type: loanType, loan_amount: '50000', loan_purpose: 'shop', full_name: 'Someone else' });
  assert.equal(r.status, 302, errs(r));
  const loan = await inA(() => db.one("SELECT * FROM loan_applications WHERE member_id = 'G-101'"));
  assert.equal(loan.full_name, 'केवाइसी G-101');
  assert.equal(loan.citizenship_no, '11-22-333');
  // not a member: a typed Member ID is never stored
  r = await c.form('/apply/grievance', { ...g, is_coop_member: 'no', member_id: 'G-100', phone: '9841500077' });
  assert.equal(r.status, 302);
  assert.equal(await inA(() => db.value("SELECT member_id FROM grievances WHERE phone = '9841500077'")), null);
  // welfare claims always verify the Member ID
  r = await c.form('/apply/welfare', { member_id: 'G-100', phone: '9841500003', claim_type: 'medical', description: 'x' });
  assert.equal(r.status, 422);
});

test('signed-in member: identity fields are read-only and come from the server', async () => {
  await seedMember('G-200', '9841600001', { password: 'Member@12345' });
  const c = await memberClient('9841600001', 'Member@12345');
  const page = await c.get('/apply/grievance');
  assert.match(page.text, /केवाइसी G-200/);
  assert.doesNotMatch(page.text, /name="phone"/, 'phone input not rendered for members');
  const r = await c.form('/apply/grievance', { phone: '9800000000', name: 'Hacker', member_id: 'G-100', subject: 'S', description: 'D', category: 'service' });
  assert.equal(r.status, 302, errs(r));
  const row = await inA(() => db.one("SELECT * FROM grievances WHERE subject = 'S' AND member_portal_id IS NOT NULL ORDER BY id DESC LIMIT 1"));
  assert.equal(row.phone, '9841600001');
  assert.equal(row.member_id, 'G-200');
  assert.equal(row.name, 'केवाइसी G-200');
  const mine = await c.get('/member/requests');
  assert.match(mine.text, new RegExp(row.tracking_id));
});

// ---------------------------------------------------------------- P1-2 public KYM: verify first, locked fields
test('public KYM: verify-first gate, values on file are locked and masked, only empty fields are filled', async () => {
  const { k } = await seedMember('K-100', '9841700001', { kycStatus: 'approved' });
  await inA(() => db.query(`UPDATE kyc_applications SET aml_details_json = '{"pan_no":"PAN-1"}', photo = 'x/p.jpg', citizenship_front = 'x/f.jpg', citizenship_back = 'x/b.jpg', signature = 'x/s.jpg', risk_category = 'low' WHERE id = $1`, [k.id]));
  const c = client();
  let r = await c.get('/apply/kyc');
  assert.match(r.text, /apply\/membership/, 'path selector links to membership');
  r = await c.form('/apply/kyc/verify', { member_id: 'K-100', mobile: '9841700009' }, '/apply/kyc');
  assert.equal(r.status, 422);
  r = await c.form('/apply/kyc/verify', { member_id: 'k-100', mobile: '+977-9841700001' }, '/apply/kyc');
  assert.equal(r.status, 302);
  r = await c.get('/apply/kyc');
  assert.match(r.text, /data-locked/);
  assert.match(r.text, /केवाइसी K-100/, 'name on file is shown');
  assert.doesNotMatch(r.text, /11-22-333/, 'citizenship number is masked');
  assert.match(r.text, /•+33/);
  assert.doesNotMatch(r.text, /name="full_name"/, 'locked field is not an input');
  assert.match(r.text, /name="occupation"/, 'empty field stays editable');
  r = await c.multipart('/apply/kyc', { member_id: 'X-999', mobile: '9800000000', full_name: 'Changed', citizenship_no: '99', occupation: 'agriculture', pan_no: 'PAN-2', passport_no: 'P-77', email: 'x@y.co', risk_category: 'high', declaration: '1', permanent_address: 'Somewhere' });
  assert.equal(r.status, 302, errs(r));
  const after = await inA(() => db.one('SELECT * FROM kyc_applications WHERE id = $1', [k.id]));
  assert.equal(after.full_name, 'केवाइसी K-100');
  assert.equal(after.citizenship_no, '11-22-333');
  assert.equal(after.member_id, 'K-100');
  assert.equal(after.occupation, 'agriculture');
  const aml = JSON.parse(after.aml_details_json);
  assert.equal(aml.pan_no, 'PAN-1', 'existing AML value kept');
  assert.equal(aml.passport_no, 'P-77', 'empty AML key filled');
  // the verification ends with the submission
  r = await c.get('/apply/kyc');
  assert.match(r.text, /action="\/apply\/kyc\/verify"/);
});

// ---------------------------------------------------------------- P1-6 card verification by name + Member ID + mobile
test('card verify: name + Member ID + mobile (Devanagari or English name), photo only after success, lock after 5 wrong tries', async () => {
  const portal = require('../src/lib/member-portal');
  assert.equal(portal.namesMatch('Ram Bahadur', 'ram bahadur kc'), true);
  assert.equal(portal.namesMatch('sha', 'Sujan Sharma'), false, 'no short substring matches');
  assert.equal(portal.namesMatch('Shree Sujan Sarma', 'Sujan Sharma'), true);
  const { m } = await seedMember('V-100', '9841800001');
  await inA(() => db.query(`UPDATE kyc_applications SET father_name = 'बुबा', dob_bs = '2040-01-01', photo = 'kyc/p.jpg' WHERE member_id = 'V-100'`));
  await inA(() => db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status) VALUES ($1, 'V-100-AAA', 'TST-AAAA-BBBB', '1234', CURRENT_DATE, CURRENT_DATE + 365, 'active')`, [String(m.id)]));
  const c = client();
  assert.equal((await c.get('/verify/photo/' + m.id)).status, 403, 'no photo before verification');
  let r = await c.form('/verify', { mode: 'name', name: 'KYC V-100', member_no: 'v-100', mobile: '9841800001' });
  assert.equal(r.status, 200);
  assert.match(r.text, /badge-ok/);
  assert.match(r.text, /बुबा/);
  assert.match(r.text, /2040-01-01/);
  assert.match(r.text, new RegExp('/verify/photo/' + m.id));
  assert.equal(await inA(() => db.value("SELECT verify_count FROM member_id_cards WHERE card_no = 'V-100-AAA'")), 1);
  r = await c.form('/verify', { mode: 'name', name: 'केवाइसी', member_no: 'V-100', mobile: '9841800001', cvv: '9999' });
  assert.match(r.text, /CVV/, 'optional CVV is checked when given');
  for (let i = 0; i < 4; i++) r = await c.form('/verify', { mode: 'name', name: 'Someone Else', member_no: 'V-100', mobile: '9841800001' });
  assert.match(r.text, /LOCK/);
  assert.ok(await inA(() => db.value("SELECT locked_at FROM member_id_cards WHERE card_no = 'V-100-AAA'")));
});

// ---------------------------------------------------------------- P2-2 / P2-3 / G1 spam scan, 10-digit mobile, guest email
test('every form: link spam scanned, 10-digit mobile, guest email required, anonymous grievance without a name', async () => {
  const c = client();
  const g = { phone: '9841900001', email: 'g@example.com', subject: 'S', description: 'D', category: 'service' };
  let r = await c.form('/apply/grievance', { ...g, name: 'A', email: '' });
  assert.equal(r.status, 422, 'email required for visitors');
  r = await c.form('/apply/grievance', { ...g, name: 'A', phone: '01-4412345' });
  assert.equal(r.status, 422, 'landline is not a 10-digit mobile');
  r = await c.form('/apply/grievance', { ...g, is_anonymous: '1', phone: '+977 9841900001' });
  assert.equal(r.status, 302, errs(r));
  const row = await inA(() => db.one("SELECT * FROM grievances WHERE phone = '9841900001' ORDER BY id DESC LIMIT 1"));
  assert.equal(row.name, 'गोप्य');
  const loanType = (await inA(() => forms.optionSources.loanTypes()))[0][0];
  r = await c.form('/apply/loan', { full_name: 'L', mobile: '9841900002', email: 'l@example.com', address: 'a', loan_type: loanType, loan_amount: '5000', loan_purpose: 'visit https://spam.example now' });
  assert.equal(r.status, 422, 'links in the loan purpose are blocked');
});

// ---------------------------------------------------------------- P2-1 math check when Turnstile is not set
test('math check: required on public forms without Turnstile, one-shot, can be turned off', async () => {
  const settings = require('../src/lib/settings');
  await inA(() => settings.set('spam_math_captcha', '1'));
  try {
    const c = client();
    const solve = html => {
      const m = String(html).match(/([०-९0-9]+) \+ ([०-९0-9]+) = \?/);
      assert.ok(m, 'math prompt rendered');
      const n = s => Number(s.replace(/[०-९]/g, d => '०१२३४५६७८९'.indexOf(d)));
      return String(n(m[1]) + n(m[2]));
    };
    const msg = { name: 'Ram', subject: 'Hello', message: 'खाता खोल्न के चाहिन्छ?' };
    let r = await c.form('/contact', { ...msg, math_answer: '999' });
    assert.equal(r.status, 422);
    assert.match(r.text, /गणित/);
    const page = await c.get('/contact');
    const tok = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
    const answer = solve(page.text);
    r = await c.agent.post('/contact').set('Host', HA).type('form').send({ _csrf: tok, ...msg, math_answer: answer });
    assert.equal(r.status, 302);
    r = await c.agent.post('/contact').set('Host', HA).type('form').send({ _csrf: tok, ...msg, math_answer: answer });
    assert.equal(r.status, 422, 'the same answer cannot be replayed');
  } finally {
    await inA(() => settings.set('spam_math_captcha', '0'));
  }
});

// ---------------------------------------------------------------- P2-6 loan fields and several documents
test('loan: other income, guarantor address and several documents (comma-joined)', async () => {
  const c = client(HB);
  const loanType = (await inB(() => forms.optionSources.loanTypes()))[0][0];
  const tok = await c.token('/apply/loan');
  let r = c.agent.post('/apply/loan?_csrf=' + encodeURIComponent(tok)).set('Host', HB).field('_csrf', tok);
  const data = { full_name: 'Docs', mobile: '9841910001', email: 'd@example.com', address: 'Ktm', loan_type: loanType, loan_amount: '20000', loan_purpose: 'shop', other_income: 'Rent 5000', guarantor_address: 'Lalitpur' };
  for (const [k, v] of Object.entries(data)) r = r.field(k, v);
  r = r.attach('documents', JPG, 'a.jpg').attach('documents', JPG, 'b.jpg');
  r = await r;
  assert.equal(r.status, 302, errs(r));
  const row = await inB(() => db.one("SELECT * FROM loan_applications WHERE mobile = '9841910001'"));
  assert.equal(row.other_income, 'Rent 5000');
  assert.equal(row.guarantor_address, 'Lalitpur');
  assert.equal(row.documents.split(',').length, 2);
});

// ---------------------------------------------------------------- P2-7 appointment slots and PHP option keys
test('appointment: 30-minute slots from office hours, PHP purpose keys, server checks the slot', async () => {
  const settings = require('../src/lib/settings');
  await inB(async () => { await settings.set('office_time_start', '09:30'); await settings.set('office_time_end', '11:00'); });
  const slots = await inB(() => forms.optionSources.officeTimes());
  assert.deepEqual(slots.map(s => s[0]), ['09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM']);
  const c = client(HB);
  const page = await c.get('/apply/appointment');
  assert.match(page.text, /value="kyc_update"/);
  assert.match(page.text, /value="10:30 AM"/);
  const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const appt = { visit_kind: 'member', name: 'Appt', phone: '9841920001', email: 'a@example.com', purpose: 'kyc_update', preferred_date: tomorrow, preferred_time: '04:00 PM' };
  let r = await c.form('/apply/appointment', appt);
  assert.equal(r.status, 422, 'slot outside office hours');
  r = await c.form('/apply/appointment', { ...appt, preferred_time: '10:30 AM' });
  assert.equal(r.status, 302, errs(r));
  // cooperative visit: organisation name becomes the appointment name
  r = await c.form('/apply/appointment', { visit_kind: 'cooperative', is_coop_member: 'yes', organization_name: 'Sathi Coop', name: 'Hari', contact_person: 'Hari', organization_address: 'Pokhara', phone: '9841920002', preferred_date: tomorrow, preferred_time: '10:00 AM', purpose_detail: 'Study visit' });
  assert.equal(r.status, 302, errs(r));
  assert.equal(await inB(() => db.value("SELECT name FROM appointments WHERE phone = '9841920002'")), 'Sathi Coop');
});

// ---------------------------------------------------------------- P2-12 / T6 / W3 details grid, stages, member request detail + filters
test('tracker details grid + stages; welfare approved amount; member request detail page with filters', async () => {
  const { m } = await seedMember('T-100', '9841930001', { password: 'Member@12345' });
  await inB(() => db.query(`INSERT INTO members (name, phone, sadasyata_number, approval_status, is_active) VALUES ('x', '9841930001', 'T-100', 'approved', 1)`)); // other tenant: no leak
  const loan = await inA(() => db.one(`INSERT INTO loan_applications (tracking_id, full_name, mobile, address, loan_type, loan_amount, loan_purpose, citizenship_no, status, repayment_method)
                                      VALUES ('LN-TRK-0001', 'Track Me', '9841930001', 'Ktm', 'home', 250000, 'House repair', '55-66-777', 'processing', 'monthly') RETURNING id`));
  await inA(() => db.query(`INSERT INTO request_status_history (module, request_id, old_status, new_status, admin_comment, created_at) VALUES ('loan', $1, 'pending', 'processing', 'Documents checked', now())`, [loan.id]));
  await inA(() => db.query(`INSERT INTO member_welfare_claims (tracking_id, member_name, member_id, phone, claim_type, claim_amount, approved_amount, description, status)
                            VALUES ('WC-TRK-0001', 'Track Me', 'T-100', '9841930001', 'medical', 50000, 30000, 'd', 'approved')`));
  const pub = client();
  let r = await pub.get('/track?id=LN-TRK-0001&phone=9841930001');
  assert.match(r.text, /House repair/);
  assert.match(r.text, /२,५०,०००|2,50,000/);
  assert.match(r.text, /Monthly EMI|मासिक किस्ता/, 'legacy option key shown with its label');
  assert.doesNotMatch(r.text, /55-66-777/, 'citizenship never on the public tracker');
  assert.match(r.text, /class="stepper"/);
  assert.match(r.text, /is-current/);
  r = await pub.get('/track?id=WC-TRK-0001&phone=9841930001');
  assert.match(r.text, /स्वीकृत रकम/);
  assert.match(r.text, /३०,०००/);

  const c = await memberClient('9841930001', 'Member@12345');
  r = await c.get('/member/requests');
  assert.match(r.text, /LN-TRK-0001/);
  assert.match(r.text, /WC-TRK-0001/);
  r = await c.get('/member/requests?type=welfare');
  assert.doesNotMatch(r.text, /LN-TRK-0001/);
  r = await c.get('/member/requests?q=lN-trk');
  assert.match(r.text, /LN-TRK-0001/);
  assert.doesNotMatch(r.text, /WC-TRK-0001/);
  r = await c.get('/member/requests/loan/' + loan.id);
  assert.equal(r.status, 200);
  assert.match(r.text, /Documents checked/);
  assert.match(r.text, /55-66-777/, 'the owner sees every field');
  const other = await inA(() => db.one(`INSERT INTO loan_applications (tracking_id, full_name, mobile, address, loan_type, loan_amount, loan_purpose) VALUES ('LN-TRK-0002', 'Other', '9800000123', 'x', 'home', 5000, 'p') RETURNING id`));
  assert.equal((await c.get('/member/requests/loan/' + other.id)).status, 404, 'not the member’s request');
  assert.ok(m.id);
});
