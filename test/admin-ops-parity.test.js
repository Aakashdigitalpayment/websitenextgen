'use strict';
/**
 * Admin operational parity (docs/parity/4-admin-ops.md): delete guards, exclusive auction winner,
 * inbox status cards / filters, notify audit, welfare paid stage, KYC SSOT tools, member stats + audience notify,
 * import parity, occurrence edit, desk lookup + eligibility, cross-programme register, PII CLI.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'aop.local';
process.env.PLATFORM_HOST = 'platform.aop.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const auth = require('../src/lib/auth');
const config = require('../src/config');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'ao' + SUFFIX;
const HA = `${A}.aop.local`;
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

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Ops A', domains: [HA], adminPassword: PW });
  await inA(async () => {
    await db.query('UPDATE admin_users SET must_change_password = 0');
    const hash = await auth.hashPassword('Member@1234');
    await db.query(`INSERT INTO members (name, name_np, phone, sadasyata_number, password_hash, approval_status, is_active, gender) VALUES
      ('Ram', 'राम', '9841000001', 'M-1', $1, 'approved', 1, 'male'), ('Sita', 'सीता', '9841000002', 'M-2', NULL, 'approved', 1, 'female'),
      ('Hari', 'हरि', '9841000003', 'M-3', $1, 'pending', 1, NULL), ('Gita', 'गीता', '9841000004', 'M-4', $1, 'approved', 0, NULL)`, [hash]);
  });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  admin = client();
  const r = await admin.form('/admin/login', { username: 'admin', password: PW });
  assert.equal(r.status, 302);
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${A} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [A]);
  fs.rmSync(path.join(config.uploadDir, A), { recursive: true, force: true });
  await db.pool.end();
});

const memberId = no => inA(() => db.value('SELECT id FROM members WHERE sadasyata_number = $1', [no]));
const del = (res, id) => admin.form(`/admin/r/${res}/${id}/delete`, {}, `/admin/r/${res}`);

// ---------------------------------------------------------------- b-1 delete guards
test('delete guards: in-use rows are deactivated, unused rows deleted with their children', async () => {
  const m1 = await memberId('M-1');
  const ids = await inA(async () => {
    const used = await db.value("INSERT INTO upcoming_programs (title, is_active) VALUES ('Used', 1) RETURNING id");
    const free = await db.value("INSERT INTO upcoming_programs (title, is_active) VALUES ('Free', 1) RETURNING id");
    await db.query("INSERT INTO program_occurrences (parent_program_id, location_name) VALUES ($1, 'Hall')", [free]);
    await db.query('INSERT INTO program_registration_desks (parent_program_id) VALUES ($1)', [free]);
    await db.query("INSERT INTO member_program_preregistrations (member_id, program_id, program_title) VALUES ($1, $2, 'Used')", [m1, used]);
    const cyBallot = await db.value("INSERT INTO election_cycles (title_np) VALUES ('E-ballot') RETURNING id");
    const cyFree = await db.value("INSERT INTO election_cycles (title_np) VALUES ('E-free') RETURNING id");
    await db.query('INSERT INTO election_vote_submissions (cycle_id, member_id) VALUES ($1, $2)', [cyBallot, m1]);
    const posFree = await db.value("INSERT INTO election_positions (cycle_id, title_np) VALUES ($1, 'P') RETURNING id", [cyFree]);
    await db.query("INSERT INTO election_candidates (cycle_id, position_id, name) VALUES ($1, $2, 'C')", [cyFree, posFree]);
    const posVoted = await db.value("INSERT INTO election_positions (cycle_id, title_np) VALUES ($1, 'PV') RETURNING id", [cyBallot]);
    const candVoted = await db.value("INSERT INTO election_candidates (cycle_id, position_id, name) VALUES ($1, $2, 'CV') RETURNING id", [cyBallot, posVoted]);
    await db.query('INSERT INTO election_votes (cycle_id, position_id, candidate_id, member_id) VALUES ($1, $2, $3, 0)', [cyBallot, posVoted, candVoted]);
    const dtBuiltin = await db.value("INSERT INTO digital_service_types (slug, name_np, is_builtin) VALUES ('mob', 'मोबाइल', 1) RETURNING id");
    const dtFree = await db.value("INSERT INTO digital_service_types (slug, name_np) VALUES ('free', 'खाली') RETURNING id");
    const wtUsed = await db.value("INSERT INTO welfare_claim_types (slug, name_np) VALUES ('death', 'मृत्यु') RETURNING id");
    await db.query("INSERT INTO member_welfare_claims (member_name, phone, claim_type) VALUES ('Ram', '9841000001', 'death')");
    const auction = await db.value("INSERT INTO auction_notices (title) VALUES ('Land') RETURNING id");
    await db.query("INSERT INTO auction_bids (auction_id, bidder_name, bidder_phone, bid_amount) VALUES ($1, 'B', '9800000000', 100)", [auction]);
    return { used, free, cyBallot, cyFree, posFree, posVoted, candVoted, dtBuiltin, dtFree, wtUsed, auction };
  });
  await del('upcoming_programs', ids.used);
  await del('upcoming_programs', ids.free);
  await del('election_cycles', ids.cyBallot);
  await del('election_cycles', ids.cyFree);
  await del('election_candidates', ids.candVoted);
  await del('election_positions', ids.posVoted);
  await del('digital_service_types', ids.dtBuiltin);
  await del('digital_service_types', ids.dtFree);
  await del('welfare_claim_types', ids.wtUsed);
  const r = await del('auction_notices', ids.auction);
  assert.equal(r.status, 302);
  const s = await inA(async () => ({
    used: await db.value('SELECT is_active FROM upcoming_programs WHERE id = $1', [ids.used]),
    free: await db.value('SELECT count(*) FROM upcoming_programs WHERE id = $1', [ids.free]),
    freeChildren: await db.value('SELECT (SELECT count(*) FROM program_occurrences WHERE parent_program_id = $1) + (SELECT count(*) FROM program_registration_desks WHERE parent_program_id = $1)', [ids.free]),
    cyBallot: await db.value('SELECT count(*) FROM election_cycles WHERE id = $1', [ids.cyBallot]),
    cyFree: await db.value('SELECT count(*) FROM election_cycles WHERE id = $1', [ids.cyFree]),
    cyFreeTree: await db.value('SELECT (SELECT count(*) FROM election_positions WHERE cycle_id = $1) + (SELECT count(*) FROM election_candidates WHERE cycle_id = $1)', [ids.cyFree]),
    cand: await db.value('SELECT is_active FROM election_candidates WHERE id = $1', [ids.candVoted]),
    pos: await db.value('SELECT is_active FROM election_positions WHERE id = $1', [ids.posVoted]),
    dtBuiltin: await db.value('SELECT is_active FROM digital_service_types WHERE id = $1', [ids.dtBuiltin]),
    dtFree: await db.value('SELECT count(*) FROM digital_service_types WHERE id = $1', [ids.dtFree]),
    wtUsed: await db.value('SELECT is_active FROM welfare_claim_types WHERE id = $1', [ids.wtUsed]),
    auction: await db.value('SELECT count(*) FROM auction_notices WHERE id = $1', [ids.auction]),
    audit: await db.value("SELECT count(*) FROM audit_log WHERE action = 'deactivate'"),
  }));
  assert.equal(Number(s.used), 0);
  assert.equal(s.free, 0);
  assert.equal(s.freeChildren, 0);
  assert.equal(s.cyBallot, 1);
  assert.equal(s.cyFree, 0);
  assert.equal(s.cyFreeTree, 0);
  assert.equal(Number(s.cand), 0);
  assert.equal(Number(s.pos), 0);
  assert.equal(Number(s.dtBuiltin), 0);
  assert.equal(s.dtFree, 0);
  assert.equal(Number(s.wtUsed), 0);
  assert.equal(s.auction, 1);
  assert.ok(s.audit >= 5, 'deactivations audited');
  // a builtin type keeps its code on edit
  await admin.form(`/admin/r/digital_service_types/${ids.dtBuiltin}`, { slug: 'renamed', name_np: 'मोबाइल', display_order: '0', is_active: '1' }, `/admin/r/digital_service_types/${ids.dtBuiltin}/edit`);
  assert.equal(await inA(() => db.value('SELECT slug FROM digital_service_types WHERE id = $1', [ids.dtBuiltin])), 'mob');
});

// ---------------------------------------------------------------- b-2 auction bids
async function staffClient() {
  const hash = await auth.hashPassword('Staff@12345!');
  await inA(() => db.query(`INSERT INTO admin_users (username, password, full_name, role, is_active, status, must_change_password)
                            SELECT 'staff1', $1, 'Staff', 'staff', 1, 'active', 0 WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE username = 'staff1')`, [hash]));
  const c = client();
  const r = await c.form('/admin/login', { username: 'staff1', password: 'Staff@12345!' });
  assert.equal(r.status, 302);
  return c;
}

test('auction bids: exclusive winner, reopen on reject, per-auction view sorted by amount, admin-only changes', async () => {
  const ids = await inA(async () => {
    const a = await db.value("INSERT INTO auction_notices (title, status, minimum_price) VALUES ('Plot 7', 'ongoing', 1000) RETURNING id");
    const other = await db.value("INSERT INTO auction_notices (title, status) VALUES ('Other', 'ongoing') RETURNING id");
    const bid = amt => db.value("INSERT INTO auction_bids (auction_id, bidder_name, bidder_phone, bid_amount) VALUES ($1, $2, '9800000001', $3) RETURNING id", [a, 'Bidder ' + amt, amt]);
    const b1 = await bid(1500), b2 = await bid(3000), b3 = await bid(2000);
    const bx = await db.value("INSERT INTO auction_bids (auction_id, bidder_name, bidder_phone, bid_amount) VALUES ($1, 'Elsewhere', '9800000002', 9999) RETURNING id", [other]);
    return { a, other, b1, b2, b3, bx };
  });
  // per-auction list: only this auction's bids, highest first, title in the header
  let page = await admin.get('/admin/inbox/bid?auction=' + ids.a);
  assert.equal(page.status, 200);
  assert.match(page.text, /Plot 7/);
  assert.doesNotMatch(page.text, /Elsewhere/);
  const order = ['Bidder 3000', 'Bidder 2000', 'Bidder 1500'].map(n => page.text.indexOf(n));
  assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2], 'sorted by amount');
  // staff can look but not decide
  const staff = await staffClient();
  assert.equal((await staff.get('/admin/inbox/bid?auction=' + ids.a)).status, 200);
  let r = await staff.form(`/admin/inbox/bid/${ids.b2}/status`, { status: 'accepted' }, '/admin/inbox/bid');
  assert.equal(r.status, 403);
  // admin accepts the highest bid
  r = await admin.form(`/admin/inbox/bid/${ids.b2}/status`, { status: 'accepted' }, `/admin/inbox/bid/${ids.b2}`);
  assert.equal(r.status, 302);
  const st = await inA(async () => ({
    bids: Object.fromEntries((await db.many('SELECT id, status FROM auction_bids')).map(b => [b.id, b.status])),
    auction: await db.value('SELECT status FROM auction_notices WHERE id = $1', [ids.a]),
    other: await db.value('SELECT status FROM auction_notices WHERE id = $1', [ids.other]),
    hist: await db.value("SELECT count(*) FROM request_status_history WHERE module = 'bid' AND new_status = 'rejected'"),
  }));
  assert.deepEqual([st.bids[ids.b1], st.bids[ids.b2], st.bids[ids.b3], st.bids[ids.bx]], ['rejected', 'accepted', 'rejected', 'pending']);
  assert.equal(st.auction, 'completed');
  assert.equal(st.other, 'ongoing');
  assert.equal(st.hist, 2);
  // a completed auction still shows its title in the inbox (admin option source lists every auction)
  page = await admin.get('/admin/inbox/bid');
  assert.match(page.text, />Plot 7</);
  // rejecting the winner reopens the auction
  await admin.form(`/admin/inbox/bid/${ids.b2}/status`, { status: 'rejected' }, `/admin/inbox/bid/${ids.b2}`);
  assert.equal(await inA(() => db.value('SELECT status FROM auction_notices WHERE id = $1', [ids.a])), 'ongoing');
  // the auction list links to its bids
  page = await admin.get('/admin/r/auction_notices');
  assert.match(page.text, new RegExp(`/admin/inbox/bid\\?auction=${ids.a}`));
});

// ---------------------------------------------------------------- b-3 inbox cards / filters / order
test('inbox: status cards, module filters (whitelisted), job buckets and appointment order', async () => {
  await inA(async () => {
    await db.query(`INSERT INTO appointments (tracking_id, name, phone, visit_kind, preferred_date, preferred_time, status) VALUES
      ('AP-1', 'Org Visit', '9800000011', 'cooperative', '2026-12-01', '10:00', 'pending'),
      ('AP-2', 'Member Early', '9800000012', 'member', '2026-11-01', '10:00', 'confirmed'),
      ('AP-3', 'Member Late', '9800000013', 'member', '2027-01-01', '10:00', 'pending')`);
    await db.query(`INSERT INTO job_applications (tracking_id, career_id, full_name, email, phone, status) VALUES
      ('JB-1', 0, 'Applicant Pending', 'a@x.np', '9800000021', 'pending'), ('JB-2', 0, 'Applicant Selected', 'b@x.np', '9800000022', 'selected'),
      ('JB-3', 0, 'Applicant Interviewed', 'c@x.np', '9800000023', 'interviewed')`);
  });
  let page = await admin.get('/admin/inbox/appointment');
  assert.equal(page.status, 200);
  assert.ok(page.text.indexOf('Member Late') < page.text.indexOf('Org Visit') && page.text.indexOf('Org Visit') < page.text.indexOf('Member Early'), 'preferred_date DESC');
  assert.match(page.text, /status=pending">[^<]*<b>(2|२)<\/b>/);
  page = await admin.get('/admin/inbox/appointment?kind=cooperative');
  assert.match(page.text, /Org Visit/);
  assert.doesNotMatch(page.text, /Member Late/);
  page = await admin.get('/admin/inbox/appointment?kind=evil%27--');
  assert.match(page.text, /Member Late/); // not a known option: ignored
  // job: active bucket by default (pipeline order), done bucket, explicit status overrides
  page = await admin.get('/admin/inbox/job');
  assert.match(page.text, /Applicant Pending/);
  assert.doesNotMatch(page.text, /Applicant Selected/);
  assert.ok(page.text.indexOf('Applicant Pending') < page.text.indexOf('Applicant Interviewed'));
  page = await admin.get('/admin/inbox/job?bucket=done');
  assert.match(page.text, /Applicant Selected/);
  assert.doesNotMatch(page.text, /Applicant Pending/);
  page = await admin.get('/admin/inbox/job?status=selected');
  assert.match(page.text, /Applicant Selected/);
  const csv = await admin.get('/admin/inbox/appointment/export.csv?kind=member');
  assert.equal(csv.status, 200);
  assert.doesNotMatch(csv.text, /Org Visit/);
});

// ---------------------------------------------------------------- b-4 notify outcome / b-5 welfare paid stage
async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise(r => setTimeout(r, 50));
  }
}

test('status history records the per-channel notification outcome; quick status notifies when the setting is on', async () => {
  const id = await inA(() => db.value(`INSERT INTO member_welfare_claims (tracking_id, member_name, phone, email, claim_type, claim_amount, status)
                                       VALUES ('WF-1', 'Ram', '9841000001', 'ram@example.com', 'death', 5000, 'pending') RETURNING id`));
  let r = await admin.form(`/admin/inbox/welfare/${id}/status`, { status: 'under_review', comment: 'checking', notify: '1' }, `/admin/inbox/welfare/${id}`);
  assert.equal(r.status, 302);
  const h = await waitFor(() => inA(() => db.one("SELECT * FROM request_status_history WHERE module = 'welfare' AND request_id = $1 AND new_status = 'under_review' AND notify_sms_status <> 'not_attempted'", [id])));
  assert.ok(h, 'outcome written');
  assert.equal(Number(h.admin_chose_to_notify), 1);
  assert.equal(h.notify_sms_status, 'skipped'); // SMS is switched off in a new tenant
  assert.equal(h.notify_sms_reason, 'sms disabled');
  assert.equal(h.notify_email_status, 'skipped');
  assert.equal(Number(h.notify_sent), 0);
  const page = await admin.get(`/admin/inbox/welfare/${id}`);
  assert.match(page.text, /title="9841000001 — sms disabled"/);

  // paid stage stamps paid_at once
  r = await admin.form(`/admin/inbox/welfare/${id}/status`, { status: 'paid', approved_amount: '4500' }, `/admin/inbox/welfare/${id}`);
  assert.equal(r.status, 302);
  const claim = await inA(() => db.one('SELECT * FROM member_welfare_claims WHERE id = $1', [id]));
  assert.equal(claim.status, 'paid');
  assert.ok(claim.paid_at);
  assert.equal(claim.approved_amount, 4500);

  // quick status from the list: no notification unless inbox_quick_status_notify = 1
  await admin.form(`/admin/inbox/welfare/${id}/status`, { status: 'completed', quick: '1' }, '/admin/inbox/welfare');
  assert.equal(await inA(() => db.value("SELECT admin_chose_to_notify FROM request_status_history WHERE module = 'welfare' AND request_id = $1 AND new_status = 'completed'", [id])), 0);
  await inA(() => db.query("UPDATE site_settings SET setting_value = '1' WHERE setting_key = 'inbox_quick_status_notify'"));
  await inA(async () => require('../src/lib/settings').invalidate());
  await admin.form(`/admin/inbox/welfare/${id}/status`, { status: 'approved', quick: '1' }, '/admin/inbox/welfare');
  assert.equal(await inA(() => db.value("SELECT admin_chose_to_notify FROM request_status_history WHERE module = 'welfare' AND request_id = $1 AND new_status = 'approved'", [id])), 1);
  await inA(() => db.query("UPDATE site_settings SET setting_value = '0' WHERE setting_key = 'inbox_quick_status_notify'"));
  await inA(async () => require('../src/lib/settings').invalidate());
});

// ---------------------------------------------------------------- b-6 KYC SSOT tools / b-8 partner services
test('KYC inbox: member link filter + badge, divergence alert, member ↔ KYM links; member page partner services', async () => {
  const [m1, m2, m3] = [await memberId('M-1'), await memberId('M-2'), await memberId('M-3')];
  const k = await inA(async () => {
    const ins = (mid, name, mobile) => db.value("INSERT INTO kyc_applications (tracking_id, member_id, full_name, full_name_en, mobile, status) VALUES ($1, $2, $3, $3, $4, 'pending') RETURNING id", ['KY-' + name, mid, name, mobile]);
    const k1 = await ins('M-1', 'Kym Linked', '9800009999'); // phone differs from the member row
    const k2 = await ins('m-2', 'Kym Nopass', '9841000002');
    const k3 = await ins('M-3', 'Kym Unlinked', '9841000003');
    const k4 = await ins('ZZ-9', 'Kym Orphan', '9841000009');
    await db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2', [k1, m1]);
    await db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2', [k2, m2]);
    await db.query('INSERT INTO member_partner_services (member_id, partner_name, service_name, service_taken) VALUES ($1, $2, $3, 1)', [m1, 'City Clinic', 'Checkup']);
    return { k1, k2, k3, k4 };
  });
  const names = async link => (await admin.get('/admin/inbox/kyc?link=' + link)).text;
  let t = await names('linked');
  assert.match(t, /Kym Linked/); assert.doesNotMatch(t, /Kym Nopass|Kym Unlinked|Kym Orphan/);
  t = await names('no_password');
  assert.match(t, /Kym Nopass/); assert.doesNotMatch(t, /Kym Linked|Kym Orphan/);
  t = await names('unlinked_member');
  assert.match(t, /Kym Unlinked/); assert.doesNotMatch(t, /Kym Linked|Kym Nopass/);
  t = await names('kym_only');
  assert.match(t, /Kym Orphan/); assert.doesNotMatch(t, /Kym Linked/);
  // the unfiltered list shows a badge per row
  t = (await admin.get('/admin/inbox/kyc')).text;
  assert.match(t, /badge badge-ok">(लिंक|Linked)/);
  assert.match(t, /badge badge-info">(KYM मात्र|KYM only)/);
  // divergence: member phone 9841000001 vs KYM 9800009999; back link to the member
  t = (await admin.get(`/admin/inbox/kyc/${k.k1}?from_member=${m1}`)).text;
  assert.match(t, /9841000001<\/td><td>9800009999/);
  assert.match(t, new RegExp(`href="/admin/members/${m1}">←`));
  // member page links to the KYM, lists partner services and the attendance rating
  t = (await admin.get('/admin/members/' + m1)).text;
  assert.match(t, new RegExp(`/admin/inbox/kyc/${k.k1}\\?from_member=${m1}`));
  assert.match(t, /City Clinic/);
  t = (await admin.get(`/admin/members/${m1}/activities`)).text;
  assert.match(t, /City Clinic — Checkup/);
  assert.ok(m3);
});
