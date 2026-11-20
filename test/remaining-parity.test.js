'use strict';
/** Remaining PHP parity items: help guide, map short links, public UX extras, ticker, admin photo capture. */
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
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'rp' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
let app;

const get = (url, agent) => (agent || request(app)).get(url).set('Host', HA);
const setting = (k, v) => inA(() => require('../src/lib/settings').set(k, v));
const clearCaches = () => inA(async () => { require('../src/lib/settings').invalidate(); require('../src/lib/navigation').invalidate(); require('../src/lib/public-cache').clear(); });
const csrfOf = html => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

async function adminAgent() {
  const agent = request.agent(app);
  const page = await get('/admin/login', agent);
  const r = await agent.post('/admin/login').set('Host', HA).type('form').send({ _csrf: csrfOf(page.text), username: 'admin', password: PW });
  assert.equal(r.status, 302, 'admin login');
  return agent;
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Remaining A', domains: [HA], adminPassword: PW });
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

// ---------------------------------------------------------------- notice ticker
test('notice ticker: list rendered twice (seamless loop), copy hidden from screen readers, speed from length', async () => {
  await inA(() => db.query("INSERT INTO notices (title, title_np, content, is_active) VALUES ('Ticker one', 'टिकर एक', 'x', 1), ('Ticker two', 'टिकर दुई', 'x', 1)"));
  await clearCaches();
  const r = await get('/');
  assert.equal(r.status, 200);
  const track = (r.text.match(/<ul class="ticker-list"[\s\S]*?<\/ul>/) || [''])[0];
  assert.match(track, /--ticker-dur:\d+s/);
  assert.equal((track.match(/टिकर एक/g) || []).length, 2, 'two copies');
  const lis = (track.match(/<li/g) || []).length;
  assert.ok(lis >= 4 && lis % 2 === 0);
  assert.equal((track.match(/<li aria-hidden="true"/g) || []).length, lis / 2, 'second copy aria-hidden');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/site.css'), 'utf8');
  assert.match(css, /@keyframes ticker \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(-50%\); \} \}/);
});
