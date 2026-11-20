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
