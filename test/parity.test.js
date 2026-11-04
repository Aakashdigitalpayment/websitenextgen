'use strict';
/**
 * Legacy-parity features: elections (window, desk, finalise, winners → committee), programme reports / desks / pre-reg,
 * partner service log, vendor → partner, institutional welfare + gated attachments, marketplace expiry.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'par.local';
process.env.PLATFORM_HOST = 'platform.par.local';
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
const A = 'pa' + SUFFIX;
const HA = `${A}.par.local`;
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
  await tenants.createTenant({ slug: A, name: 'Parity A', domains: [HA], adminPassword: PW });
  await inA(async () => {
    await db.query('UPDATE admin_users SET must_change_password = 0');
    const hash = await auth.hashPassword('Member@1234');
    await db.query(`INSERT INTO members (name, name_np, phone, sadasyata_number, password_hash, approval_status, is_active, gender) VALUES
      ('Ram', 'राम', '9841000001', 'M-1', $1, 'approved', 1, 'male'), ('Sita', 'सीता', '9841000002', 'M-2', $1, 'approved', 1, 'female'),
      ('=HYPERLINK("x")', 'हरि', '9841000003', 'M-3', $1, 'approved', 1, NULL)`, [hash]);
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
async function memberClient(phone) {
  const c = client();
  const r = await c.form('/member/login', { identifier: phone, password: 'Member@1234' });
  assert.equal(r.status, 302);
  return c;
}

// ---------------------------------------------------------------- elections
test('election window states follow voting_enabled + Nepal-time window', () => {
  const el = require('../src/lib/elections');
  const now = new Date();
  const h = n => new Date(now.getTime() + n * 3600_000);
  assert.equal(el.windowState({ is_published: 0 }), 'draft');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 0 }), 'disabled');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 1 }), 'unset');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 1, vote_start_at: h(1), vote_end_at: h(2) }), 'upcoming');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 1, vote_start_at: h(-1), vote_end_at: h(1) }), 'open');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 0, vote_start_at: h(-1), vote_end_at: h(1) }), 'disabled');
  assert.equal(el.windowState({ is_published: 1, voting_enabled: 1, vote_start_at: h(-2), vote_end_at: h(-1) }), 'ended');
});

test('elections: switch/window enforced, attendance-only then online ballot, manual duplicates blocked, winners → committee', async () => {
  const ids = await inA(async () => {
    const ct = await db.one("INSERT INTO committee_types (name, name_np) VALUES ('Board', 'सञ्चालक समिति') RETURNING id");
    const cy = await db.one("INSERT INTO election_cycles (title_np, is_published, voting_enabled) VALUES ('निर्वाचन', 1, 0) RETURNING id");
    const pos = await db.one('INSERT INTO election_positions (cycle_id, title_np, title_en, seats, max_votes_per_voter, committee_type_id, is_active) VALUES ($1, $2, $3, 1, 1, $4, 1) RETURNING id', [cy.id, 'अध्यक्ष', 'Chair', ct.id]);
    const c1 = await db.one("INSERT INTO election_candidates (cycle_id, position_id, name, is_active) VALUES ($1, $2, 'क', 1) RETURNING id", [cy.id, pos.id]);
    const c2 = await db.one("INSERT INTO election_candidates (cycle_id, position_id, name, is_active) VALUES ($1, $2, 'ख', 1) RETURNING id", [cy.id, pos.id]);
    return { ct: ct.id, cy: cy.id, pos: pos.id, c1: c1.id, c2: c2.id };
  });
  const m1 = await memberClient('9841000001');
  // voting switched off: the ballot is not offered and a forged POST records nothing
  let page = await m1.get('/member/elections/' + ids.cy);
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.text, /name="pos_/);
  await m1.form('/member/elections/' + ids.cy, { ['pos_' + ids.pos]: String(ids.c1) }, '/member/profile');
  assert.equal(await inA(() => db.value('SELECT count(*) FROM election_votes WHERE cycle_id = $1', [ids.cy])), 0);

  // admin: enabling voting requires both times
  let r = await admin.form('/admin/r/election_cycles/' + ids.cy, { title_np: 'निर्वाचन', is_published: '1', voting_enabled: '1', sort_order: '0' }, `/admin/r/election_cycles/${ids.cy}/edit`);
  assert.equal(r.status, 422);
  await inA(() => db.query("UPDATE election_cycles SET voting_enabled = 1, vote_start_at = now() - interval '1 hour', vote_end_at = now() + interval '1 hour' WHERE id = $1", [ids.cy]));

  // in-person desk: attendance only (no candidates) for M-1; the member can still vote online afterwards
  r = await admin.form(`/admin/elections/${ids.cy}/desk`, { member_key: 'M-1', proof_type: 'citizenship', note: 'gate 1' });
  assert.equal(r.status, 302);
  let sub = await inA(async () => db.one('SELECT s.* FROM election_vote_submissions s JOIN members m ON m.id = s.member_id WHERE s.cycle_id = $1 AND m.sadasyata_number = $2', [ids.cy, 'M-1']));
  assert.equal(Number(sub.is_ballot), 0);
  assert.equal(sub.source, 'manual_attendance');
  assert.equal(sub.proof_type, 'citizenship');
  page = await m1.get('/member/elections/' + ids.cy);
  assert.match(page.text, /name="pos_/);
  r = await m1.form('/member/elections/' + ids.cy, { ['pos_' + ids.pos]: String(ids.c1) });
  assert.equal(r.status, 302);
  sub = await inA(() => db.one('SELECT * FROM election_vote_submissions WHERE id = $1', [sub.id]));
  assert.equal(Number(sub.is_ballot), 1);
  assert.equal(sub.source, 'member_portal');
  // a second ballot (online or at the desk) is refused
  await admin.form(`/admin/elections/${ids.cy}/desk`, { member_key: 'M-1', proof_type: 'id_card', ['pos_' + ids.pos]: String(ids.c2) });
  // manual ballot for M-2
  await admin.form(`/admin/elections/${ids.cy}/desk`, { phone: '9841000002', proof_type: 'id_card', ['pos_' + ids.pos]: String(ids.c1) });
  const counts = await inA(() => db.one(`SELECT count(*) FILTER (WHERE candidate_id = $2) AS c1, count(*) FILTER (WHERE candidate_id = $3) AS c2, count(*) FILTER (WHERE member_id IS NOT NULL) AS named FROM election_votes WHERE cycle_id = $1`, [ids.cy, ids.c1, ids.c2]));
  assert.deepEqual([counts.c1, counts.c2, counts.named], [2, 0, 0]);

  // results hidden while voting is open; convert is refused by the UI but finalising closes voting
  page = await admin.get('/admin/elections/' + ids.cy);
  assert.match(page.text, /For secrecy|गोपनीयता/);
  r = await admin.form(`/admin/elections/${ids.cy}/convert`, { tenure_name: 'Tenure 2083', start_date: '2026-01-01', end_date: '2030-01-01' }, '/admin/elections/' + ids.cy);
  assert.equal(r.status, 302);
  const result = await inA(async () => ({
    cycle: await db.one('SELECT * FROM election_cycles WHERE id = $1', [ids.cy]),
    tenures: await db.many('SELECT * FROM committee_tenures WHERE committee_type_id = $1', [ids.ct]),
    members: await db.many('SELECT cm.* FROM committee_members cm JOIN committee_tenures t ON t.id = cm.tenure_id WHERE t.committee_type_id = $1', [ids.ct]),
  }));
  assert.equal(Number(result.cycle.results_finalized), 1);
  assert.equal(Number(result.cycle.voting_enabled), 0);
  assert.equal(result.tenures.length, 1);
  assert.equal(Number(result.tenures[0].is_current), 1);
  assert.deepEqual(result.members.map(m => [m.name, m.position, m.position_en]), [['क', 'अध्यक्ष', 'Chair']]);
  // converting again does not duplicate members in a tenure, but a new tenure becomes current
  await admin.form(`/admin/elections/${ids.cy}/convert`, { tenure_name: 'Tenure 2083' }, '/admin/elections/' + ids.cy);
  assert.equal(await inA(() => db.value('SELECT count(*) FROM committee_tenures WHERE committee_type_id = $1 AND is_current = 1', [ids.ct])), 1);
  // closed now: the member ballot page says so and results are visible
  page = await admin.get('/admin/elections/' + ids.cy);
  assert.doesNotMatch(page.text, /For secrecy|गोपनीयता/);
});

test('election post master fills a position and cannot be deleted while used', async () => {
  const { did, cy } = await inA(async () => ({
    did: (await db.one("INSERT INTO designations (title_np, title_en) VALUES ('कोषाध्यक्ष', 'Treasurer') RETURNING id")).id,
    cy: (await db.one("INSERT INTO election_cycles (title_np, is_published) VALUES ('E2', 0) RETURNING id")).id,
  }));
  const created = await admin.form('/admin/r/election_posts', { designation_id: String(did), default_seats: '2', default_max_votes: '2', display_order: '0', is_active: '1' }, '/admin/r/election_posts/new');
  assert.equal(created.status, 302);
  const post = await inA(() => db.one('SELECT * FROM election_posts ORDER BY id DESC LIMIT 1'));
  assert.equal(post.title_np, 'कोषाध्यक्ष');
  let r = await admin.form('/admin/r/election_positions', { cycle_id: String(cy), post_id: String(post.id), display_order: '0', is_active: '1' }, '/admin/r/election_positions/new');
  assert.equal(r.status, 302);
  const pos = await inA(() => db.one('SELECT * FROM election_positions WHERE cycle_id = $1', [cy]));
  assert.deepEqual([pos.title_np, pos.title_en, pos.seats, pos.max_votes_per_voter, pos.post_id], ['कोषाध्यक्ष', 'Treasurer', 2, 2, post.id]);
  r = await admin.form(`/admin/r/election_posts/${post.id}/delete`, {}, '/admin/r/election_posts');
  assert.equal(await inA(() => db.value('SELECT count(*) FROM election_posts WHERE id = $1', [post.id])), 1);
});

// ---------------------------------------------------------------- programmes
test('programmes: defaults from settings, desks, pre-reg mark attended, reports + CSV, live JSON', async () => {
  let r = await admin.form('/admin/programs/settings', { default_instant_attendance: '1', eligible_scope: 'all_active' });
  assert.equal(r.status, 302);
  r = await admin.form('/admin/r/upcoming_programs', { title: 'AGM 2083', program_type: 'AGM', event_date: '2026-11-04', is_active: '1' }, '/admin/r/upcoming_programs/new');
  assert.equal(r.status, 302);
  const p = await inA(() => db.one("SELECT * FROM upcoming_programs WHERE title = 'AGM 2083'"));
  assert.equal(Number(p.instant_attendance), 1);
  assert.equal(Number(p.shared_qr_mode), 0);

  // named desk with assigned staff; a check-in through it is attributed to the desk
  const adminId = await inA(() => db.value("SELECT id FROM admin_users WHERE username = 'admin'"));
  await admin.form(`/admin/programs/${p.id}/desks`, { desk_label: 'Gate A', staff_id: String(adminId) }, '/admin/programs/' + p.id);
  const desk = await inA(() => db.one('SELECT * FROM program_registration_desks WHERE parent_program_id = $1', [p.id]));
  assert.equal(desk.assigned_staff_admin_id, adminId);
  const detail = await admin.get('/admin/programs/' + p.id);
  assert.match(detail.text, new RegExp(`<option value="${desk.id}" selected>Gate A`));
  await admin.form(`/admin/programs/${p.id}/desk`, { q: 'M-1', desk_id: String(desk.id) }, '/admin/programs/' + p.id);
  await admin.form(`/admin/programs/${p.id}/desk`, { q: 'M-1', desk_id: String(desk.id) }, '/admin/programs/' + p.id); // duplicate → attempt log
  const att = await inA(() => db.one("SELECT * FROM member_program_attendance WHERE program_id = $1 AND attendance_status = 'VALID'", [p.id]));
  assert.equal(att.desk_id, desk.id);
  assert.equal(await inA(() => db.value("SELECT desk_id FROM program_attendance_attempts WHERE parent_program_id = $1 AND result = 'DUPLICATE_BLOCKED'", [p.id])), desk.id);
  // toggle off: desk no longer offered
  await admin.form(`/admin/programs/${p.id}/desks/${desk.id}`, { action: 'toggle' }, '/admin/programs/' + p.id);
  assert.equal(await inA(() => db.value('SELECT is_active FROM program_registration_desks WHERE id = $1', [desk.id])), 0);

  // pre-registration → mark attended (method ADMIN_PREREG); test SMS goes to the first selected only
  const m2 = await memberId('M-2');
  const pr = await inA(() => db.one("INSERT INTO member_program_preregistrations (member_id, member_name, phone, program_id, program_title) VALUES ($1, 'Sita', '9841000002', $2, 'AGM 2083') RETURNING id", [m2, p.id]));
  r = await admin.form(`/admin/programs/${p.id}/prereg/${pr.id}/attend`, {}, '/admin/programs/' + p.id);
  assert.equal(await inA(() => db.value("SELECT attendance_method FROM member_program_attendance WHERE program_id = $1 AND member_id = $2 AND attendance_status = 'VALID'", [p.id, m2])), 'ADMIN_PREREG');
  r = await admin.form(`/admin/programs/${p.id}/prereg/notify`, { prereg_ids: String(pr.id), message: 'Reminder', channel: 'sms', mode: 'test' }, '/admin/programs/' + p.id);
  assert.equal(r.status, 302);
  assert.match((await admin.get('/admin/programs/' + p.id)).text, /Test message|परीक्षण सन्देश/);

  // reports
  const csv = await admin.get(`/admin/programs/reports/absent?program_id=${p.id}&export=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers['content-type'], /text\/csv/);
  assert.match(csv.text, /M-3/);
  assert.doesNotMatch(csv.text, /M-1,/);
  assert.match(csv.text, /'=HYPERLINK/); // formula neutralised
  const cons = await admin.get(`/admin/programs/reports/consolidated?program_id=${p.id}&export=csv`);
  assert.equal(cons.text.trim().split(/\r\n/).length, 3); // header + 2 members
  const bd = await admin.get(`/admin/programs/reports/breakdown?program_id=${p.id}&gender=female&export=detail`);
  assert.match(bd.text, /Sita/);
  assert.doesNotMatch(bd.text, /Ram/);
  const dup = await admin.get(`/admin/programs/reports/duplicates?program_id=${p.id}`);
  assert.match(dup.text, /Gate A/);
  const hist = await admin.get('/admin/programs/reports/history?member_id=M-1&type=AGM');
  assert.match(hist.text, /AGM 2083/);
  for (const k of ['location', 'member', 'breakdown']) assert.equal((await admin.get(`/admin/programs/reports/${k}?program_id=${p.id}`)).status, 200);
  const live = await admin.get(`/admin/programs/${p.id}/live.json`);
  assert.equal(live.body.ok, true);
  assert.equal(live.body.attended, 2);
  assert.equal((await admin.get(`/admin/programs/dashboard?program_id=${p.id}`)).status, 200);
  // members cannot reach admin reports
  const mc = await memberClient('9841000001');
  assert.notEqual((await mc.get(`/admin/programs/${p.id}/live.json`)).status, 200);
});

test('programme requests from non-members: approve blocked until linked; link and create member', async () => {
  const p = await inA(() => db.one("INSERT INTO upcoming_programs (title, is_active) VALUES ('Training', 1) RETURNING *"));
  const [r1, r2] = await inA(() => Promise.all([
    db.one("INSERT INTO member_program_attendance_requests (member_id, member_name, member_phone, program_id, program_title, status) VALUES (0, 'Walk-in', '9800000009', $1, 'Training', 'pending') RETURNING id", [p.id]),
    db.one("INSERT INTO member_program_attendance_requests (member_id, member_name, member_phone, program_id, program_title, status) VALUES (0, 'New Person', '9800000010', $1, 'Training', 'pending') RETURNING id", [p.id]),
  ]));
  await admin.form(`/admin/programs/${p.id}/requests/${r1.id}`, { action: 'approve' }, '/admin/programs/' + p.id);
  assert.equal(await inA(() => db.value('SELECT status FROM member_program_attendance_requests WHERE id = $1', [r1.id])), 'pending');
  await admin.form(`/admin/programs/${p.id}/requests/${r1.id}/link`, { member_no: 'M-3' }, '/admin/programs/' + p.id);
  assert.equal(await inA(() => db.value('SELECT member_id FROM member_program_attendance_requests WHERE id = $1', [r1.id])), await memberId('M-3'));
  await admin.form(`/admin/programs/${p.id}/requests/${r1.id}`, { action: 'approve' }, '/admin/programs/' + p.id);
  assert.equal(await inA(() => db.value('SELECT status FROM member_program_attendance_requests WHERE id = $1', [r1.id])), 'approved');
  await admin.form(`/admin/programs/${p.id}/requests/${r2.id}/create-member`, {}, '/admin/programs/' + p.id);
  const created = await inA(() => db.one("SELECT m.* FROM members m JOIN member_program_attendance_requests r ON r.member_id = m.id WHERE r.id = $1", [r2.id]));
  assert.equal(created.phone, '9800000010');
  assert.match(created.sadasyata_number, /^MEM-\d{4}-\d{4}$/);
});

// ---------------------------------------------------------------- partners
test('partner desk: PIN set by admin, service logged on /verify only after a card is verified, member sees history', async () => {
  const mid = await memberId('M-1');
  const partner = await inA(async () => {
    await db.query("INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, status, issued_date) VALUES ($1, 'C-1', 'PAR-TEST-0001', '4321', 'active', CURRENT_DATE)", [String(mid)]);
    return db.one("INSERT INTO partner_facilities (partner_name, is_active) VALUES ('City Clinic', 1) RETURNING id");
  });
  let r = await admin.form(`/admin/partners/${partner.id}/pin`, { pin: '12' }, '/admin/partners');
  assert.equal(await inA(() => db.value('SELECT pin_hash FROM partner_facilities WHERE id = $1', [partner.id])), null);
  r = await admin.form(`/admin/partners/${partner.id}/pin`, { pin: '246813' }, '/admin/partners');
  const row = await inA(() => db.one('SELECT pin_hash, partner_code FROM partner_facilities WHERE id = $1', [partner.id]));
  assert.ok(row.pin_hash && row.partner_code.startsWith('PF-'));

  const desk = client();
  // no verified card in this session → refused
  r = await desk.form('/verify/service', { member_id: String(mid), partner_id: String(partner.id), partner_pin: '246813' }, '/verify');
  assert.equal(r.status, 403);
  r = await desk.form('/verify', { code: 'PAR-TEST-0001', cvv: '4321' });
  assert.match(r.text, /Log service|सेवा लग गर्नुहोस्/);
  r = await desk.form('/verify/service', { member_id: String(mid), partner_id: String(partner.id), partner_pin: '000000', service_name: 'Check-up' }, '/verify');
  assert.equal(r.status, 422);
  r = await desk.form('/verify/service', { member_id: String(mid), partner_id: String(partner.id), partner_pin: '246813', service_name: 'Check-up', service_taken: 'yes' }, '/verify');
  assert.equal(r.status, 200);
  r = await desk.form('/verify/service', { member_id: String(mid), partner_id: String(partner.id), partner_pin: '246813' }, '/verify');
  assert.equal(r.status, 422); // 90-second duplicate guard
  assert.equal(await inA(() => db.value('SELECT count(*) FROM member_partner_services WHERE member_id = $1', [mid])), 1);
  const m = await memberClient('9841000001');
  const dash = await m.get('/member');
  assert.match(dash.text, /City Clinic/);
  assert.match(dash.text, /Check-up/);
});

test('vendor approval promotes it to a partner facility once', async () => {
  const v = await inA(() => db.one("INSERT INTO vendors (tracking_id, company_name, phone, email, business_type, status) VALUES ('VN-T1', 'Hardware Co', '01-5555555', 'HW@X.COM', 'supplier', 'pending') RETURNING id"));
  await admin.form(`/admin/inbox/vendor/${v.id}/status`, { status: 'approved' }, `/admin/inbox/vendor/${v.id}`);
  const p = await inA(() => db.one('SELECT * FROM partner_facilities WHERE vendor_id = $1', [v.id]));
  assert.equal(p.partner_name, 'Hardware Co');
  assert.equal(p.facility_type, 'आपूर्तिकर्ता');
  assert.equal(p.contact_email, 'hw@x.com');
  assert.equal(await inA(() => db.value('SELECT linked_partner_id FROM vendors WHERE id = $1', [v.id])), p.id);
  await admin.form(`/admin/partners/promote-vendor/${v.id}`, {}, `/admin/inbox/vendor/${v.id}`);
  assert.equal(await inA(() => db.value('SELECT count(*) FROM partner_facilities WHERE vendor_id = $1', [v.id])), 1);
});

// ---------------------------------------------------------------- institutional welfare + attachment gate
test('institutional welfare: BS month bounds, opening + approved claims, saved snapshot shown publicly', async () => {
  const w = require('../src/lib/welfare');
  assert.deepEqual(w.reportBounds({ fiscal_year: '2081/82', report_month: 4 }), { from: '2024-07-16', to: '2024-08-16' }); // Shrawan 2081 has 32 days
  assert.equal(w.reportBounds({ fiscal_year: '2081/82', report_month: 1 }).from, '2025-04-14');
  await inA(() => db.query("INSERT INTO welfare_claim_types (slug, name_np, name_en) VALUES ('medical', 'औषधि उपचार', 'Medical') ON CONFLICT DO NOTHING"));
  await admin.form('/admin/institutional-welfare', { claim_type: 'medical', opening_count: '5', opening_amount: '50000', note: 'pre-portal' });
  const profile = await inA(async () => {
    await db.query("INSERT INTO member_welfare_claims (member_name, phone, claim_type, claim_amount, approved_amount, status, claim_date_ad) VALUES ('A', '9800000001', 'medical', 9000, 7000, 'approved', '2024-07-20'), ('B', '9800000002', 'medical', 3000, NULL, 'approved', '2024-06-01'), ('C', '9800000003', 'medical', 1000, NULL, 'pending', '2024-07-20')");
    return db.one("INSERT INTO institutional_profile (fiscal_year, report_month, total_members, is_active, access_level) VALUES ('2081/82', 4, 100, 1, 'none') RETURNING *");
  });
  const rows = await inA(() => w.prefill(profile));
  const med = rows.find(r => r.slug === 'medical');
  assert.deepEqual([med.month_count, med.month_amount, med.cum_count, med.cum_amount, med.prev_count], [1, 7000, 7, 60000, 6]);
  let page = await client().get('/institutional-profile');
  assert.match(page.text, /60,000|६०,०००/);
  await admin.form('/admin/institutional-welfare/' + profile.id, { welfare_slug: 'medical', month_count: '1', month_amount: '7000', cum_count: '8', cum_amount: '61000' });
  page = await client().get('/institutional-profile');
  assert.match(page.text, /61,000|६१,०००/);
});

test('members-only institutional report files are served only through the gated route', async () => {
  const dir = path.join(config.uploadDir, A, '_private', 'institutional-profile');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'r.pdf'), '%PDF-1.4 test');
  const id = await inA(async () => (await db.one("INSERT INTO institutional_profile (fiscal_year, report_month, is_active, access_level, attachment_path) VALUES ('2082/83', 2, 1, 'member', '_private/institutional-profile/r.pdf') RETURNING id")).id);
  assert.equal((await client().get(`/uploads/_private/institutional-profile/r.pdf`)).status, 404);
  const anon = await client().get(`/institutional-profile/${id}/file`);
  assert.equal(anon.status, 302);
  assert.match(anon.headers.location, /\/member\/login/);
  const m = await memberClient('9841000002');
  const ok = await m.get(`/institutional-profile/${id}/file`);
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers['cache-control']), /no-store/);
});

// ---------------------------------------------------------------- marketplace
test('marketplace: admin expire / extend, stale approved listings auto-expire', async () => {
  const mid = await memberId('M-1');
  const [a, b] = await inA(() => Promise.all([
    db.one("INSERT INTO member_marketplace_listings (member_id, listing_type, title, description, status, available_until) VALUES ($1, 'product', 'Honey', 'x', 'approved', now() - interval '1 day') RETURNING id", [mid]),
    db.one("INSERT INTO member_marketplace_listings (member_id, listing_type, title, description, status, available_until) VALUES ($1, 'product', 'Ghee', 'x', 'approved', now() + interval '5 days') RETURNING id", [mid]),
  ]));
  assert.equal(await inA(() => require('../src/routes/marketplace').expireStale()), 1);
  assert.equal(await inA(() => db.value('SELECT status FROM member_marketplace_listings WHERE id = $1', [a.id])), 'expired');
  await admin.form(`/admin/marketplace/${b.id}`, { action: 'expire' }, '/admin/marketplace?status=approved');
  assert.equal(await inA(() => db.value('SELECT status FROM member_marketplace_listings WHERE id = $1', [b.id])), 'expired');
  await admin.form(`/admin/marketplace/${a.id}`, { action: 'extend', until_date: '2020-01-01' }, '/admin/marketplace?status=expired');
  assert.equal(await inA(() => db.value('SELECT status FROM member_marketplace_listings WHERE id = $1', [a.id])), 'expired');
  await admin.form(`/admin/marketplace/${a.id}`, { action: 'extend', until_date: '2099-01-01', until_time: '18:00' }, '/admin/marketplace?status=expired');
  const row = await inA(() => db.one('SELECT status, available_until FROM member_marketplace_listings WHERE id = $1', [a.id]));
  assert.equal(row.status, 'pending');
  assert.equal(new Date(row.available_until).getFullYear(), 2099);
});
