'use strict';
/** Applications parity: PII crypto, KYM form engine, KYM submit + approval, membership, inbox tools, notifications. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
process.env.PII_KEY = 'test-only-pii-key-0123456789abcdef0123456789';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const pii = require('../src/lib/pii-crypto');
const forms = require('../src/lib/forms');
const modules = require('../src/modules/applications');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'ap' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
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
  };
}
async function adminClient() {
  const c = client();
  const r = await c.form('/admin/login', { username: 'admin', password: PW });
  assert.equal(r.status, 302);
  return c;
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'App A', domains: [HA], adminPassword: PW });
  await inA(() => db.query('UPDATE admin_users SET must_change_password = 0'));
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

// ---------------------------------------------------------------- PII
test('PII: PHP pii1 (sodium secretbox) and pii2 (AES-GCM) values decrypt with the old key', () => {
  const K = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  // produced by includes/pii-crypto.php pii_enc() with PII_ENC_KEY = K
  assert.equal(pii.decryptLegacy('pii1:YxQfrRJBT2hms7CqAZ7Ym/E7ufFxk4ROYTjfk+sSHOkN3SD/THRjzYLcCsb2/q4t6OlPb0kf', K), '12-01-71-04521');
  assert.equal(pii.decryptLegacy('pii1:KwPN2KzXCKuA6JshWtxGwjgi7TxbG6duZBae5Y0ZVMzzukhd58NVEYpaXBk6u0Yp/o2+G33JJaRHvjC4mNgTeLtVp0GND3LvVCg=', K), 'नागरिकता १२३');
  assert.equal(pii.decryptLegacy('pii2:k4sPZ1P8u7NnCpZzwQIcDRJfmFQ29Q+LibpPlECgzqIPgXVCRLzu0w==', K), '27-01-123456');
  // wrong key / tampered → unchanged, never ''
  const bad = 'pii1:YxQfrRJBT2hms7CqAZ7Ym/E7ufFxk4ROYTjfk+sSHOkN3SD/THRjzYLcCsb2/q4t6OlPb0kX';
  assert.equal(pii.decryptLegacy(bad, K), bad);
  assert.equal(pii.decryptLegacy('pii2:k4sPZ1P8u7NnCpZzwQIcDRJfmFQ29Q+LibpPlECgzqIPgXVCRLzu0w==', 'ff'.repeat(32)).startsWith('pii2:'), true);
});

test('PII: new format is deterministic per tenant and decrypts transparently on read', async () => {
  const e1 = pii.encrypt('12-34-567', 'tenant_x');
  assert.match(e1, /^pii3:/);
  assert.equal(pii.encrypt('12-34-567', 'tenant_x'), e1, 'deterministic for exact-match search');
  assert.notEqual(pii.encrypt('12-34-567', 'tenant_y'), e1, 'per-tenant keys');
  assert.equal(pii.decrypt(e1, 'tenant_x'), '12-34-567');
  assert.equal(pii.decrypt(e1, 'tenant_y'), e1);
  assert.equal(pii.encrypt('', 'tenant_x'), '');
  await inA(async () => {
    const row = await forms.insertSubmission(modules.loan, { full_name: 'PII Test', mobile: '9841000099', address: 'x', loan_type: 'home', loan_amount: 5000, loan_purpose: 'p', citizenship_no: '11-22-333' });
    const raw = await db.value("SELECT 'raw:' || citizenship_no FROM loan_applications WHERE id = $1", [row.id]);
    assert.match(raw, /^raw:pii3:/, 'stored encrypted');
    assert.equal(await db.value('SELECT citizenship_no FROM loan_applications WHERE id = $1', [row.id]), '11-22-333', 'read back decrypted');
  });
});

test('site migration converts PHP pii1/pii2 values to the new format', async () => {
  const mig = require('../src/lib/site-migration');
  const K = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
  await inA(async () => {
    const r = await db.one("INSERT INTO membership_applications (tracking_id, full_name, mobile, citizenship_no) VALUES ('MB-PII-1', 'Old', '9800000001', 'pii2:k4sPZ1P8u7NnCpZzwQIcDRJfmFQ29Q+LibpPlECgzqIPgXVCRLzu0w==') RETURNING id");
    const out = await mig.convertPii(K);
    assert.ok(out.ok >= 1);
    assert.match(await db.value("SELECT 'raw:' || citizenship_no FROM membership_applications WHERE id = $1", [r.id]), /^raw:pii3:/);
    assert.equal(await db.value('SELECT citizenship_no FROM membership_applications WHERE id = $1', [r.id]), '27-01-123456');
  });
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'phpsite-'));
  fs.mkdirSync(path.join(root, 'includes'));
  fs.writeFileSync(path.join(root, 'includes/database.local.php'), `<?php define('DB_NAME', 'x'); define('DB_USER', 'u'); define('PII_ENC_KEY', '${K}');`);
  assert.equal(mig.readPhpSite(root).piiKey, K);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- form engine
test('KYM engine: structured address, family table, AML JSON, hidden branches dropped', () => {
  const opts = {};
  for (const f of modules.kyc.fields) if (f.options) opts[f.name] = f.options;
  opts.citizenship_issued_place = forms.DISTRICTS.map(d => [d, d, d]);
  const body = {
    member_id: 'm-1', full_name: 'राम', mobile: '9841000000', email: 'r@x.co', citizenship_no: '1', risk_category: 'high', declaration: '1',
    permanent_province: 'बागमती प्रदेश', permanent_district: 'काठमाडौं', permanent_municipality: 'काठमाडौं महानगरपालिका', permanent_ward: '5', permanent_tole: 'Baneshwor', same_as_permanent: '1',
    occupation: 'private', business_nature: 'should be dropped', is_rented: 'yes', landlord_name: 'Hari', politically_exposed: 'no',
    family_relation: ['father', 'spouse', 'son'], family_member_name: ['Shyam', 'Sita', ''], family_member_phone: ['', '', ''],
    income_source_name: ['Salary', 'Rent'], income_source_amount: ['40,000', '१०००'], expense_source_name: ['Home'], expense_source_amount: ['15000'],
  };
  const { data, errors } = forms.validate(modules.kyc, body, {}, opts, 'en');
  assert.deepEqual(errors, {});
  assert.equal(data.permanent_address, 'Baneshwor, वडा 5, काठमाडौं महानगरपालिका, काठमाडौं, बागमती प्रदेश');
  assert.equal(data.temporary_ward, '5');
  assert.equal(data.father_name, 'Shyam');
  assert.equal(data.spouse_name, 'Sita');
  assert.equal(JSON.parse(data.family_details_json).length, 2);
  const aml = JSON.parse(data.aml_details_json);
  assert.equal(aml.landlord_name, 'Hari');
  assert.equal(aml.business_nature, undefined, 'business-only fields dropped when not a business');
  assert.equal(aml.income_total, 41000);
  assert.equal(aml.net_saving_estimate, 26000);
  const bad = forms.validate(modules.kyc, { ...body, permanent_municipality: 'Nowhere' }, {}, opts, 'en');
  assert.ok(bad.errors.permanent_address);
  const back = forms.rowToValues(modules.kyc, { ...data, permanent_address: data.permanent_address, temporary_address: data.temporary_address });
  assert.equal(back.landlord_name, 'Hari');
  assert.deepEqual(back.income_source_name, ['Salary', 'Rent']);
});

test('welfare type fields and document requirement follow the claim type', () => {
  const opts = { claim_type: [['death', 'मृत्यु', 'Death', { profile: 'death', requires_document: true }], ['ins', 'बीमा', 'Insurance', { profile: 'insurance' }]] };
  opts.deceased_relation = modules.welfare.fields.find(f => f.name === 'deceased_relation').options;
  const base = { member_name: 'A', member_id: '1', phone: '9841000000', description: 'd', deceased_name: 'X', policy_number: 'P-1' };
  let r = forms.validate(modules.welfare, { ...base, claim_type: 'death' }, {}, opts, 'en');
  assert.ok(r.errors.attachment_path, 'document required');
  assert.equal(r.data.deceased_name, 'X');
  assert.equal(r.data.policy_number, undefined);
  r = forms.validate(modules.welfare, { ...base, claim_type: 'ins' }, {}, opts, 'en');
  assert.deepEqual(r.errors, {});
  assert.equal(r.data.policy_number, 'P-1');
  assert.equal(r.data.deceased_name, undefined);
  // BS posted for an A.D. date field is converted
  assert.equal(forms.normalizeAdDate('२०८१-०१-०१'), '2024-04-13');
});

test('honour categories are limited to the programme and enforce nominee / document', () => {
  const opts = { program_id: [['1', 'P1', 'P1'], ['2', 'P2', 'P2'], ['3', 'P3', 'P3']], category_id: [['10', 'C', 'C', { requires_nominee: true, requires_document: false, programs: ['1'] }], ['11', 'D', 'D', { programs: ['2'] }]] };
  const base = { program_id: '2', category_id: '10', applicant_name: 'A', phone: '9841000000' };
  let r = forms.validate(modules.honor, base, {}, opts, 'en');
  assert.ok(r.errors.category_id, 'not offered in programme 2');
  r = forms.validate(modules.honor, { ...base, program_id: '3' }, {}, opts, 'en');
  assert.equal(r.errors.category_id, undefined, 'a programme without a category list offers all');
  r = forms.validate(modules.honor, { ...base, program_id: '1' }, {}, opts, 'en');
  assert.ok(r.errors.nominee_name);
});

// ---------------------------------------------------------------- KYM flow over HTTP
test('online KYM: Member ID + mobile gate, insert, public fill-empty update, admin approve → review due + ID card', async () => {
  await inA(() => db.query("INSERT INTO members (name, name_np, phone, sadasyata_number, approval_status, is_active) VALUES ('Ram KC', 'राम', '9841111111', 'A-100', 'approved', 1)"));
  const c = client();
  const fields = {
    member_id: 'a-100', full_name: 'राम केसी', full_name_en: 'Ram KC', mobile: '9841111111', email: 'ram@example.com', citizenship_no: '12-34', risk_category: 'high',
    permanent_province: 'बागमती प्रदेश', permanent_district: 'काठमाडौं', permanent_municipality: 'काठमाडौं महानगरपालिका', permanent_ward: '3', declaration: '1', passport_face_confirm: '1', want_id_card: '1', pan_no: 'PAN-9',
  };
  const post = async (data, files = true) => {
    const tok = await c.token('/apply/kyc');
    let r = c.agent.post('/apply/kyc?_csrf=' + encodeURIComponent(tok)).set('Host', HA).field('_csrf', tok);
    for (const [k, v] of Object.entries(data)) r = r.field(k, v);
    if (files) for (const f of ['photo', 'citizenship_front', 'citizenship_back', 'signature']) r = r.attach(f, JPG, f + '.jpg');
    return r;
  };
  // wrong mobile for the Member ID
  let r = await post({ ...fields, mobile: '9841999999' });
  assert.equal(r.status, 422);
  assert.match(r.text, /do not match|मिलेन/);
  r = await post(fields);
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const k = await inA(() => db.one("SELECT * FROM kyc_applications WHERE member_id = 'A-100'"));
  assert.equal(k.status, 'pending');
  assert.equal(JSON.parse(k.aml_details_json).pan_no, 'PAN-9');
  assert.equal(k.citizenship_no, '12-34');
  assert.ok(k.photo.startsWith('_private/'));
  const member = await inA(() => db.one("SELECT * FROM members WHERE sadasyata_number = 'A-100'"));
  assert.equal(member.kyc_application_id, k.id, 'linked on write');
  // second public submit only fills empty fields
  r = await post({ ...fields, full_name: 'Changed', grandfather_name: 'x', occupation: 'agriculture' }, false);
  assert.equal(r.status, 302);
  const k2 = await inA(() => db.one('SELECT * FROM kyc_applications WHERE id = $1', [k.id]));
  assert.equal(k2.full_name, 'राम केसी');
  assert.equal(k2.occupation, 'agriculture');
  assert.equal(await inA(() => db.value("SELECT count(*) FROM kyc_applications WHERE member_id = 'A-100'")), 1);

  const adm = await adminClient();
  const view = await adm.get('/admin/inbox/kyc/' + k.id);
  assert.equal(view.status, 200);
  assert.match(view.text, /PAN-9/);
  const tok = await adm.token('/admin/inbox/kyc/' + k.id);
  r = await adm.agent.post(`/admin/inbox/kyc/${k.id}/status?_csrf=${encodeURIComponent(tok)}`).set('Host', HA)
    .field('_csrf', tok).field('status', 'approved').field('member_id', 'A-100').field('risk_category', 'high').field('comment', 'ok')
    .attach('admin_attachment', Buffer.from('%PDF-1.4 reply'), 'reply.pdf');
  assert.equal(r.status, 302);
  const k3 = await inA(() => db.one('SELECT * FROM kyc_applications WHERE id = $1', [k.id]));
  assert.ok(k3.kyc_verified_at);
  const years = new Date(k3.risk_review_due_at).getFullYear() - new Date(k3.kyc_verified_at).getFullYear();
  assert.equal(years, 1, 'high risk → 1 year');
  assert.ok(k3.admin_attachment);
  assert.equal(await inA(() => db.value("SELECT count(*) FROM member_id_cards WHERE member_id = $1 AND status = 'active'", [String(member.id)])), 1, 'ID card issued');

  // applicant downloads the office reply via the tracker (tracking no. + phone)
  const ok = await request(app).get(`/track/attachment?id=${k3.tracking_id}&phone=9841111111`).set('Host', HA);
  assert.equal(ok.status, 200);
  const no = await request(app).get(`/track/attachment?id=${k3.tracking_id}&phone=9800000000`).set('Host', HA);
  assert.equal(no.status, 404);

  // print, single export (AML flattened), risk review page
  const pr = await adm.get(`/admin/inbox/kyc/${k.id}/print?autoprint=1`);
  assert.equal(pr.status, 200);
  assert.match(pr.text, /data-autoprint/);
  const csv = await adm.get(`/admin/inbox/kyc/${k.id}/export.csv`);
  assert.match(csv.text, /PAN No/);
  assert.match(csv.text, /PAN-9/);
  assert.equal((await adm.get('/admin/kyc-risk-reviews?filter=all')).status, 200);
});

test('membership: soft duplicate on pending mobile, approval assigns Member ID and creates a member stub', async () => {
  const c = client();
  const data = { full_name: 'Gita', mobile: '9842222222', citizenship_no: '9-9', address: 'Lalitpur' };
  let r = await c.form('/apply/membership', data);
  assert.equal(r.status, 302);
  r = await c.form('/apply/membership', data);
  const done = await c.get('/apply/membership/done');
  assert.match(done.text, /already exists|पहिले नै छ/);
  const apps = await inA(() => db.many("SELECT * FROM membership_applications WHERE mobile = '9842222222'"));
  assert.equal(apps.length, 1);
  const adm = await adminClient();
  r = await adm.form(`/admin/inbox/membership/${apps[0].id}/approve`, { sadasyata: 'm-200' }, `/admin/inbox/membership/${apps[0].id}`);
  assert.equal(r.status, 302);
  const a = await inA(() => db.one('SELECT * FROM membership_applications WHERE id = $1', [apps[0].id]));
  assert.equal(a.status, 'approved');
  assert.equal(a.assigned_sadasyata, 'M-200');
  const m = await inA(() => db.one('SELECT * FROM members WHERE id = $1', [a.member_pk]));
  assert.equal(m.sadasyata_number, 'M-200');
  assert.equal(m.password_hash, null);
});

test('inbox: internal note stays internal, bulk status, staff cannot open admin-only inboxes', async () => {
  const g = await inA(() => db.one("INSERT INTO grievances (tracking_id, name, phone, subject, description, status) VALUES ('GR-APPT-1', 'Hari', '9843333333', 's', 'd', 'pending') RETURNING *"));
  const adm = await adminClient();
  const tok = await adm.token('/admin/inbox/grievance/' + g.id);
  let r = await adm.agent.post(`/admin/inbox/grievance/${g.id}/status?_csrf=${encodeURIComponent(tok)}`).set('Host', HA)
    .field('_csrf', tok).field('status', 'in_progress').field('comment', 'We are on it').field('admin_note', 'SECRET-NOTE');
  assert.equal(r.status, 302);
  const t = await request(app).get('/track?id=GR-APPT-1&phone=9843333333').set('Host', HA);
  assert.match(t.text, /We are on it/);
  assert.doesNotMatch(t.text, /SECRET-NOTE/);
  r = await adm.form('/admin/inbox/grievance/bulk', { ids: String(g.id), action: 'status:resolved' }, '/admin/inbox/grievance');
  assert.equal(r.status, 302);
  assert.equal(await inA(() => db.value('SELECT status FROM grievances WHERE id = $1', [g.id])), 'resolved');

  await inA(async () => db.query("INSERT INTO admin_users (username, password, full_name, role, is_active, status, must_change_password) VALUES ('st1', $1, 'Staff', 'staff', 1, 'active', 0)", [await require('../src/lib/auth').hashPassword('Staff@12345!')]));
  const st = client();
  await st.form('/admin/login', { username: 'st1', password: 'Staff@12345!' });
  assert.equal((await st.get('/admin/inbox/kyc')).status, 403);
  assert.equal((await st.get('/admin/inbox/grievance/' + g.id + '/print')).status, 403);
  assert.equal((await st.get('/admin/inbox/appointment')).status, 200);
});

test('notification templates: module template wins, admin SMS recipients get the office message', async () => {
  const notify = require('../src/lib/notify');
  await inA(async () => {
    await db.query("UPDATE site_settings SET setting_value = '1' WHERE setting_key = 'notify_sms_enabled'");
    await db.query("UPDATE site_settings SET setting_value = '9845555555, 9846666666' WHERE setting_key = 'notify_sms_recipients'");
    // webhook gateway on a private address: refused before any network call, but still logged per recipient
    await db.query("UPDATE site_settings SET setting_value = 'webhook' WHERE setting_key = 'notify_sms_gateway'");
    await db.query("UPDATE site_settings SET setting_value = 'https://127.0.0.1/sms' WHERE setting_key = 'notify_sms_api_url'");
    require('../src/lib/settings').invalidate();
    await notify.adminEvent(modules.contact, { name: 'Sita', details: { 'विषय': 'Hello' } });
    const logs = await db.many("SELECT recipient, message FROM notification_log WHERE event_type = 'contact_message:admin' ORDER BY id");
    assert.deepEqual(logs.map(l => l.recipient).sort(), ['9845555555', '9846666666']);
    assert.match(logs[0].message, /New Contact Message from Sita/);
  });
  assert.equal(notify.render('{name} — {{tracking_id}} {unknown}', { name: 'A', tracking_id: 'T' }), 'A — T');
});

test('every module: public form, admin list, detail, print and export render', async () => {
  const adm = await adminClient();
  for (const m of Object.values(modules)) {
    if (m.key !== 'contact') assert.equal((await request(app).get('/apply/' + m.key).set('Host', HA)).status, 200, 'form ' + m.key);
    assert.equal((await adm.get('/admin/inbox/' + m.key)).status, 200, 'list ' + m.key);
    const id = await inA(() => db.value(`SELECT max(id) FROM ${m.table}`));
    if (!id) continue;
    for (const suffix of ['', '/print', '/export.csv']) assert.equal((await adm.get(`/admin/inbox/${m.key}/${id}${suffix}`)).status, 200, m.key + suffix);
  }
});

test('public pages: KYM form renders address cascade + date picker hooks, form data script served', async () => {
  const r = await request(app).get('/apply/kyc').set('Host', HA);
  assert.equal(r.status, 200);
  assert.match(r.text, /data-address="permanent"/);
  assert.match(r.text, /data-bsdate/);
  assert.match(r.text, /name="family_member_name"/);
  const js = await request(app).get('/js/form-data.js').set('Host', HA);
  assert.equal(js.status, 200);
  assert.match(js.text, /BS_MONTH_DAYS/);
  assert.match(js.text, /बागमती प्रदेश/);
  const ap = await request(app).get('/apply/appointment').set('Host', HA);
  assert.match(ap.text, /value="cooperative"/);
});
