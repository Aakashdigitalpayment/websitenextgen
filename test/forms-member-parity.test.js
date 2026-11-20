'use strict';
/** Public forms + member portal parity (docs/parity/2-forms-member.md). */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
process.env.PII_KEY = process.env.PII_KEY || 'test-only-pii-key-0123456789abcdef0123456789';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const forms = require('../src/lib/forms');
const modules = require('../src/modules/applications');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'fm' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
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
    async multipart(url, data, files = {}, tokenUrl = url) {
      const tok = await this.token(tokenUrl);
      let r = agent.post(url + (url.includes('?') ? '&' : '?') + '_csrf=' + encodeURIComponent(tok)).set('Host', host).field('_csrf', tok);
      for (const [k, v] of Object.entries(data)) for (const x of [].concat(v)) r = r.field(k, x);
      for (const [k, v] of Object.entries(files)) r = r.attach(k, v, k + '.jpg');
      return r;
    },
  };
}
async function memberClient(identifier, password) {
  const c = client();
  const r = await c.form('/member/login', { identifier, password });
  assert.equal(r.status, 302, 'member login ' + identifier + ': ' + r.text.slice(0, 200));
  return c;
}
const hash = pw => require('bcryptjs').hash(pw, 4);

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Forms A', domains: [HA], adminPassword: PW });
  await inA(async () => {
    await db.query('UPDATE admin_users SET must_change_password = 0');
    await require('../src/lib/settings').set('spam_math_captcha', '0');
  });
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

// ---------------------------------------------------------------- P1-3 digital services
test('digital service: fields follow the chosen service; share amount required', async () => {
  const opts = { service_type: await inA(() => require('../src/lib/forms').optionSources.digitalTypes()) };
  const base = { requester_name: 'A', phone: '9841000000' };
  let r = forms.validate(modules.digital, { ...base, service_type: 'share_refund' }, {}, opts, 'en');
  assert.ok(r.errors.service_amount, 'amount required for a share refund');
  r = forms.validate(modules.digital, { ...base, service_type: 'mobile_recharge', recharge_number: '9841000001', recharge_amount: '100', statement_from: '2024-01-01', biller_name: 'NEA' }, {}, opts, 'en');
  assert.deepEqual(r.errors, {});
  assert.equal(r.data.recharge_amount, 100);
  assert.equal(r.data.statement_from, undefined, 'statement dates only for a statement request');
  assert.equal(r.data.biller_name, undefined);
  r = forms.validate(modules.digital, { ...base, service_type: 'statement_request', statement_from: '2024-01-01' }, {}, opts, 'en');
  assert.equal(r.data.statement_from, '2024-01-01');
});

// ---------------------------------------------------------------- P1-4 auction bids
test('auction bid: open window, minimum price, mobile, 24 h duplicate, BID tracking id', async () => {
  const auctions = require('../src/lib/auctions');
  // 2024-01-01 17:00 Nepal time = 11:15 UTC
  assert.equal(auctions.endTimestamp({ auction_date: '2024-01-01', auction_time: '5:00 PM' }), Date.UTC(2024, 0, 1, 11, 15));
  assert.equal(auctions.endTimestamp({ auction_date: '2024-01-01', auction_time: '' }), Date.UTC(2024, 0, 1, 23, 59, 59) - 345 * 60_000);
  const [open, past] = await inA(async () => [
    await db.one("INSERT INTO auction_notices (title, minimum_price, auction_date, status, is_active) VALUES ('Open land', 100000, CURRENT_DATE + 5, 'ongoing', 1) RETURNING id"),
    await db.one("INSERT INTO auction_notices (title, minimum_price, auction_date, auction_time, status, is_active) VALUES ('Old land', 1, CURRENT_DATE - 2, '10:00', 'ongoing', 1) RETURNING id"),
  ]);
  const c = client();
  const page = await c.get('/apply/bid');
  assert.match(page.text, /Open land/);
  assert.doesNotMatch(page.text, /Old land/, 'ended auctions are not offered');
  const detail = await c.get('/auctions/' + past.id);
  assert.doesNotMatch(detail.text, /apply\/bid\?auction=/);
  const bid = { auction_id: String(open.id), bidder_name: 'Bidder', bidder_phone: '9841000001', bid_amount: '50000' };
  let r = await c.form('/apply/bid', bid);
  assert.equal(r.status, 422);
  assert.match(r.text, /कम्तीमा रु\./);
  r = await c.form('/apply/bid', { ...bid, auction_id: String(past.id), bid_amount: '500' });
  assert.equal(r.status, 422);
  r = await c.form('/apply/bid', { ...bid, bidder_phone: '014412345', bid_amount: '150000' });
  assert.equal(r.status, 422, 'landline rejected');
  r = await c.form('/apply/bid', { ...bid, bid_amount: '150000' });
  assert.equal(r.status, 302, r.text.slice(0, 400));
  const row = await inA(() => db.one('SELECT * FROM auction_bids WHERE auction_id = $1', [open.id]));
  assert.match(row.tracking_id, /^BID-/);
  r = await c.form('/apply/bid', { ...bid, bid_amount: '160000' });
  assert.equal(r.status, 422, 'second pending bid within 24 h');
  const tr = await c.get(`/track?id=${row.tracking_id}&phone=9841000001`);
  assert.match(tr.text, new RegExp(row.tracking_id));
  assert.match(tr.text, /Bidder/);
});
