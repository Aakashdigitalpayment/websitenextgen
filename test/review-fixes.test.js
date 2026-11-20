'use strict';
/** Regression tests for bugs found in the PHP-parity review (8c2c296..claude/tender-ramanujan-e5xzgu). */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const nd = require('../src/lib/nepali-date');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'rf' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
let app;

function client() {
  const agent = request.agent(app);
  return {
    get: url => agent.get(url).set('Host', HA),
    async form(url, data, tokenUrl = url) {
      const r = await agent.get(tokenUrl).set('Host', HA);
      const m = r.text.match(/name="_csrf" value="([^"]+)"/);
      assert.ok(m, 'csrf token on ' + tokenUrl);
      return agent.post(url).set('Host', HA).type('form').send({ _csrf: m[1], ...data });
    },
  };
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Review A', domains: [HA], adminPassword: PW });
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

test('audit: a summary longer than the 255-char column is truncated, not dropped', async () => {
  const auth = require('../src/lib/auth');
  const req = { admin: { id: 1, username: 'admin' }, ip: '127.0.0.1', get: () => 'test-agent' };
  await inA(async () => {
    await auth.audit(req, 'update', 'site_settings', null, 'Settings (general): ' + 'site_name, '.repeat(40));
    const row = await db.one("SELECT summary FROM audit_log WHERE entity_type = 'site_settings' AND action = 'update' ORDER BY id DESC LIMIT 1");
    assert.ok(row, 'audit row stored');
    assert.equal(row.summary.length, 255);
  });
});

test('careers: a BS deadline typed into the DATE column that has passed closes online applications', async () => {
  const pastBs = nd.adToBs(new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10));
  const futureBs = nd.adToBs(new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10));
  const forms = require('../src/lib/forms');
  const { hooks } = require('../src/lib/submissions');
  await inA(async () => {
    const closed = await db.value("INSERT INTO careers (title, deadline, is_active, allow_online_apply) VALUES ('Closed BS job', $1, 1, 1) RETURNING id", [pastBs]);
    const open = await db.value("INSERT INTO careers (title, deadline, is_active, allow_online_apply) VALUES ('Open BS job', $1, 1, 1) RETURNING id", [futureBs]);
    const ids = (await forms.optionSources.careers()).map(o => o[0]);
    assert.ok(!ids.includes(String(closed)), 'closed BS job not offered');
    assert.ok(ids.includes(String(open)), 'open BS job offered');
    assert.ok((await forms.optionSources.careers({ admin: true })).some(o => o[0] === String(closed)), 'admin list keeps every job');
    const ctx = (careerId, n) => ({ data: { career_id: careerId, email: `a${n}@example.com`, phone: '98410000' + String(n).padStart(2, '0') }, lang: 'en' });
    const blocked = await hooks.job(ctx(closed, 1));
    assert.ok(blocked && blocked.errors && /closed/.test(blocked.errors.career_id), 'past BS deadline rejected');
    assert.equal(await hooks.job(ctx(open, 2)), null, 'future BS deadline accepted');
  });
});

test('member notification: opening its link never redirects off-site', async () => {
  const hash = await require('bcryptjs').hash('Member@12345!', 4);
  const mid = await inA(async () => {
    const id = await db.value(`INSERT INTO members (name, phone, sadasyata_number, approval_status, is_active, password_hash)
                               VALUES ('Notif Member', '9841555666', 'RF-1', 'approved', 1, $1) RETURNING id`, [hash]);
    return id;
  });
  const c = client();
  const login = await c.form('/member/login', { identifier: '9841555666', password: 'Member@12345!' });
  assert.equal(login.status, 302);
  const nid = await inA(() => db.value("INSERT INTO member_notifications (member_id, title, link, is_read, created_at) VALUES ($1, 'x', '/\\evil.example', 0, now()) RETURNING id", [mid]));
  const r = await c.form(`/member/notifications/${nid}/read`, { go: '1' }, '/member/notifications');
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, '/member/notifications');
  const ok = await inA(() => db.value("INSERT INTO member_notifications (member_id, title, link, is_read, created_at) VALUES ($1, 'y', '/member/requests', 0, now()) RETURNING id", [mid]));
  const r2 = await c.form(`/member/notifications/${ok}/read`, { go: '1' }, '/member/notifications');
  assert.equal(r2.headers.location, '/member/requests');
});
