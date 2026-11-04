'use strict';
/** Custom domains: generated CNAME targets, DNS verification, serving rules, redirects, TLS ask hook. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'dom.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.SKIP_DNS_VERIFY;
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const domains = require('../src/lib/domains');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const SLUG = 'dm' + SUFFIX;
let app, tenant;

/** fake DNS: { name: { cname: [...], a: [...] } } */
const fakeResolver = zone => {
  const err = () => Object.assign(new Error('nodata'), { code: 'ENODATA' });
  return {
    resolveCname: async n => { if (zone[n]?.cname) return zone[n].cname; throw err(); },
    resolve4: async n => { if (zone[n]?.a) return zone[n].a; throw err(); },
    resolve6: async () => { throw err(); },
  };
};

before(async () => {
  await tenants.applyPlatformSchema();
  tenant = await tenants.createTenant({ slug: SLUG, name: 'Domain Coop', domains: [`${SLUG}.dom.local`], adminPassword: 'Admin@12345!' });
  tenant = await tenants.get(tenant.id);
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('every tenant gets a unique generated CNAME target in the platform zone', async () => {
  assert.match(tenant.cname_target, new RegExp(`^${SLUG}-[a-z2-9]{5}\\.dom\\.local$`));
  const a = domains.generateTarget('x'), b = domains.generateTarget('x');
  assert.notEqual(a, b);
});

test('DNS verification: CNAME, CNAME chain, wrong target, apex A record, nothing yet', async () => {
  const T = 'coop-ab12c.dom.local';
  process.env.SERVER_IPS = '203.0.113.7';
  const z = fakeResolver({
    'www.good.com.np': { cname: [T] },
    'www.chain.com.np': { cname: ['edge.cdn.example'] }, 'edge.cdn.example': { cname: [T + '.'] },
    'www.wrong.com.np': { cname: ['other.example'] },
    'good.com.np': { a: ['203.0.113.7'] },
    'evil.com.np': { a: ['198.51.100.9'] },
  });
  assert.equal((await domains.verify('www.good.com.np', T, z)).ok, true);
  assert.equal((await domains.verify('www.chain.com.np', T, z)).ok, true);
  const wrong = await domains.verify('www.wrong.com.np', T, z);
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /other\.example/);
  assert.equal((await domains.verify('good.com.np', T, z)).method, 'A record');
  assert.equal((await domains.verify('evil.com.np', T, z)).ok, false);
  assert.match((await domains.verify('nothing.com.np', T, z)).reason, /No CNAME or A record/);
  delete process.env.SERVER_IPS;
});

test('DNS instructions: CNAME for subdomains, A/ALIAS + www for apex', () => {
  const T = 'coop-ab12c.dom.local';
  assert.deepEqual(domains.instructions('www.mycoop.com.np', T).map(i => i.type), ['CNAME']);
  assert.equal(domains.isApex('mycoop.com.np'), true);
  assert.equal(domains.isApex('mycoop.org'), true);
  assert.equal(domains.isApex('www.mycoop.com.np'), false);
  assert.ok(domains.instructions('mycoop.com.np', T).some(i => i.host === 'www' && i.value === T));
  assert.ok(domains.validate('not a domain').error);
  assert.equal(domains.validate('WWW.MyCoop.com.np.').domain, 'www.mycoop.com.np');
});

test('the generated target serves the site; an unverified client domain does not', async () => {
  const home = await request(app).get('/').set('Host', tenant.cname_target);
  assert.equal(home.status, 200);
  assert.match(home.text, /Domain Coop/);
  const d = await tenants.addDomain(tenant.id, `www.${SLUG}-client.com.np`, { verifyNow: false });
  assert.equal(d.status, 'pending');
  assert.equal((await request(app).get('/').set('Host', d.domain)).status, 404, 'pending domain must not be served');
  // TLS ask: pending → no certificate; target → yes
  assert.equal((await request(app).get('/__tls/allowed?domain=' + d.domain)).status, 404);
  assert.equal((await request(app).get('/__tls/allowed?domain=' + tenant.cname_target)).status, 200);
});

test('after verification the client domain is served, becomes primary, and other hosts redirect to it', async () => {
  const domain = `www.${SLUG}-client.com.np`;
  await db.query("UPDATE platform.tenant_domains SET status = 'active', verified_at = now() WHERE domain = $1", [domain]);
  await tenants.refreshPrimary(tenant.id);
  tenants.clearCache();
  const onClient = await request(app).get('/about').set('Host', domain);
  assert.equal(onClient.status, 200);
  const viaTarget = await request(app).get('/about?x=1').set('Host', tenant.cname_target);
  assert.equal(viaTarget.status, 301);
  assert.equal(viaTarget.headers.location, `http://${domain}/about?x=1`);
  const viaSub = await request(app).get('/').set('Host', `${SLUG}.dom.local`);
  assert.equal(viaSub.status, 301);
  // the API and the TLS hook are never redirected
  assert.equal((await request(app).get('/api/v1/ping').set('Host', tenant.cname_target)).status, 401);
  assert.equal((await request(app).get('/__tls/allowed?domain=' + domain)).status, 200);
  // turning redirect off keeps every address working
  await db.query('UPDATE platform.tenants SET redirect_to_primary = false WHERE id = $1', [tenant.id]);
  tenants.clearCache();
  assert.equal((await request(app).get('/').set('Host', tenant.cname_target)).status, 200);
});

test('a domain cannot be claimed by two tenants', async () => {
  await assert.rejects(() => tenants.addDomain(tenant.id, `www.${SLUG}-client.com.np`), e => e.code === '23505');
});
