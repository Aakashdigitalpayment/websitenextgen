'use strict';
/**
 * Integration tests against a real PostgreSQL (DATABASE_URL).
 * Creates two throw-away tenants and removes them afterwards.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'test.local';
process.env.PLATFORM_HOST = 'platform.test.local';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const nd = require('../src/lib/nepali-date');
const util = require('../src/lib/util');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'ta' + SUFFIX, B = 'tb' + SUFFIX;
const HOST_A = `${A}.test.local`, HOST_B = `${B}.test.local`;
const PW = 'Admin@12345!';
let app;

/** Agent bound to a host that keeps cookies and knows the current CSRF token. */
function client(host) {
  const agent = request.agent(app);
  return {
    agent,
    get: url => agent.get(url).set('Host', host),
    async token(url = '/contact') {
      const r = await agent.get(url).set('Host', host);
      const m = r.text.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(m, 'csrf token on ' + url);
      return m[1];
    },
    post: url => agent.post(url).set('Host', host),
    /** fetch a fresh token from tokenUrl, then POST the form (cookies attach at request creation) */
    async form(url, data, tokenUrl = url) {
      const _csrf = await this.token(tokenUrl);
      return agent.post(url).set('Host', host).type('form').send({ _csrf, ...data });
    },
  };
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Tenant A', domains: [HOST_A], adminPassword: PW });
  await tenants.createTenant({ slug: B, name: 'Tenant B', domains: [HOST_B], adminPassword: PW });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  for (const s of [A, B]) {
    await db.query(`DROP SCHEMA IF EXISTS tenant_${s} CASCADE`);
    await db.query('DELETE FROM platform.tenants WHERE slug = $1', [s]);
  }
  await db.pool.end();
});

test('BS ⇄ AD conversion matches known dates', () => {
  assert.equal(nd.bsToAd('2081-01-01'), '2024-04-13');
  assert.equal(nd.adToBs('2024-04-13'), '2081-01-01');
  assert.equal(nd.bsToAd('2000-09-17'), '1944-01-01');
  assert.equal(nd.bsToAd('2081-13-01'), null);
  assert.equal(nd.toLatinDigits('२०८१-०१-०१'), '2081-01-01');
});

test('sanitizer strips scripts and handlers', () => {
  const out = util.sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:alert(1)">x</a><img src=x onerror=alert(1)>');
  assert.ok(!/script|onclick|onerror|javascript:/i.test(out), out);
  assert.match(out, /<p>Hi<\/p>/);
});

test('each tenant site resolves by host; unknown host is 404', async () => {
  const a = await request(app).get('/').set('Host', HOST_A);
  assert.equal(a.status, 200);
  assert.match(a.text, /Tenant A/);
  const b = await request(app).get('/').set('Host', HOST_B);
  assert.match(b.text, /Tenant B/);
  const x = await request(app).get('/').set('Host', 'nobody.example.org');
  assert.equal(x.status, 404);
});

test('POST without CSRF token is rejected (urlencoded and multipart)', async () => {
  const r1 = await request(app).post('/contact').set('Host', HOST_A).type('form').send({ name: 'x', subject: 'y', message: 'z' });
  assert.equal(r1.status, 403);
  const r2 = await request(app).post('/apply/grievance').set('Host', HOST_A).field('name', 'x');
  assert.equal(r2.status, 403);
});

test('application submit → tracking id → tracker needs matching phone', async () => {
  const c = client(HOST_A);
  const tok = await c.token('/apply/grievance');
  const r = await c.post(`/apply/grievance?_csrf=${encodeURIComponent(tok)}`)
    .field('_csrf', tok).field('name', 'राम').field('phone', '9841000001').field('subject', 'ढिलाइ').field('description', 'विवरण').field('category', 'service');
  assert.equal(r.status, 302, r.text.slice(0, 300));
  const done = await c.get('/apply/grievance/done');
  const id = done.text.match(/tracking-id">([^<]+)/)[1];
  assert.match(id, /^GR-\d{6}-[A-Z0-9]{8}$/);
  const ok = await request(app).get(`/track?id=${id}&phone=9841000001`).set('Host', HOST_A);
  assert.match(ok.text, /badge-warn/);
  const wrong = await request(app).get(`/track?id=${id}&phone=9800000000`).set('Host', HOST_A);
  assert.match(wrong.text, /alert-error/);
  // the same tracking id does not exist for tenant B
  const other = await request(app).get(`/track?id=${id}&phone=9841000001`).set('Host', HOST_B);
  assert.match(other.text, /alert-error/);
});

test('validation errors are returned with 422', async () => {
  const c = client(HOST_A);
  const tok = await c.token('/apply/loan');
  const r = await c.post(`/apply/loan?_csrf=${encodeURIComponent(tok)}`).field('_csrf', tok).field('full_name', 'x').field('mobile', '123');
  assert.equal(r.status, 422);
  assert.match(r.text, /field-error/);
});

test('admin login, content is isolated between tenants, sessions do not cross tenants', async () => {
  const c = client(HOST_A);
  const bad = await c.form('/admin/login', { username: 'admin', password: 'wrong' });
  assert.equal(bad.status, 401);
  const good = await c.form('/admin/login', { username: 'admin', password: PW });
  assert.equal(good.status, 302);
  const created = await c.form('/admin/r/notices', { title_np: 'केवल A को सूचना', is_active: '1', notice_date: '2026-01-01' }, '/admin/r/notices/new');
  assert.equal(created.status, 302, created.text.slice(0, 300));
  assert.match((await request(app).get('/notices').set('Host', HOST_A)).text, /केवल A को सूचना/);
  assert.doesNotMatch((await request(app).get('/notices').set('Host', HOST_B)).text, /केवल A को सूचना/);
  // replaying tenant A's session cookie against tenant B must not grant admin
  const cross = await c.agent.get('/admin').set('Host', HOST_B);
  assert.equal(cross.status, 302);
  assert.match(cross.headers.location, /\/admin\/login/);
});

test('editor role cannot open settings or application inboxes', async () => {
  const hash = await require('../src/lib/auth').hashPassword('Editor@12345');
  await db.withSchema('tenant_' + A, () => db.query("INSERT INTO admin_users (username, password, full_name, role, is_active, status) VALUES ('ed', $1, 'Ed', 'editor', 1, 'active')", [hash]));
  const c = client(HOST_A);
  await c.form('/admin/login', { username: 'ed', password: 'Editor@12345' });
  assert.equal((await c.get('/admin/r/news')).status, 200);
  assert.equal((await c.get('/admin/settings')).status, 403);
  assert.equal((await c.get('/admin/inbox/loan')).status, 403);
});

test('member can vote once per election', async () => {
  const auth = require('../src/lib/auth');
  await db.withSchema('tenant_' + A, async () => {
    await db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('Voter', '9841999999', 'V-1', $1, 'approved', 1)", [await auth.hashPassword('Voter@1234')]);
    const cy = await db.one("INSERT INTO election_cycles (title_np, is_published, date_from, date_to, voting_enabled, vote_start_at, vote_end_at) VALUES ('निर्वाचन', 1, CURRENT_DATE - 1, CURRENT_DATE + 1, 1, now() - interval '1 hour', now() + interval '1 hour') RETURNING id");
    const pos = await db.one("INSERT INTO election_positions (cycle_id, title_np, seats, max_votes_per_voter, is_active) VALUES ($1, 'अध्यक्ष', 1, 1, 1) RETURNING id", [cy.id]);
    await db.query("INSERT INTO election_candidates (cycle_id, position_id, name, is_active) VALUES ($1, $2, 'क', 1), ($1, $2, 'ख', 1)", [cy.id, pos.id]);
  });
  const { cid, pid, cand } = await db.withSchema('tenant_' + A, async () => {
    const cy = await db.one('SELECT id FROM election_cycles ORDER BY id DESC LIMIT 1');
    const p = await db.one('SELECT id FROM election_positions WHERE cycle_id = $1', [cy.id]);
    const ca = await db.one('SELECT id FROM election_candidates WHERE position_id = $1 ORDER BY id LIMIT 1', [p.id]);
    return { cid: cy.id, pid: p.id, cand: ca.id };
  });
  const c = client(HOST_A);
  const login = await c.form('/member/login', { identifier: '9841999999', password: 'Voter@1234' });
  assert.equal(login.status, 302);
  const v1 = await c.form('/member/elections/' + cid, { ['pos_' + pid]: String(cand) });
  assert.equal(v1.status, 302);
  // second attempt: the ballot form is gone, so post with a token from the dashboard
  await c.form('/member/elections/' + cid, { ['pos_' + pid]: String(cand) }, '/member/profile');
  const votes = await db.withSchema('tenant_' + A, () => db.value('SELECT count(*) FROM election_votes WHERE cycle_id = $1', [cid]));
  assert.equal(votes, 1);
});

test('uploaded files are served only to their own tenant', async () => {
  const fs = require('fs');
  const path = require('path');
  const config = require('../src/config');
  const dir = path.join(config.uploadDir, A, 'news');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'hello');
  assert.equal((await request(app).get('/uploads/news/probe.txt').set('Host', HOST_A)).status, 200);
  assert.equal((await request(app).get('/uploads/news/probe.txt').set('Host', HOST_B)).status, 404);
  assert.equal((await request(app).get('/uploads/../../package.json').set('Host', HOST_A)).status, 404);
  fs.rmSync(path.join(config.uploadDir, A), { recursive: true, force: true });
});
