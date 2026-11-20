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
