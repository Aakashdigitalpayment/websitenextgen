'use strict';
/** Sector features: calculators, base-rate disclosure, payment channels, centres, client protection. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'sct.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const fin = require('../src/lib/finance-tools');
const { createApp } = require('../src/app');

const SLUG = 'sc' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.sct.local`;
let app;

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: SLUG, name: 'Sector MF', domains: [HOST], adminPassword: 'Admin@12345!', design: 'microfinance' });
  await db.withSchema(`tenant_${SLUG}`, async () => {
    await db.insert('rate_disclosures', { fiscal_year: '2082/83', month_bs: 7, base_rate: 8.12, spread: 4.1, is_active: 1 });
    await db.insert('payment_channels', { kind: 'bank', name: 'Test Bank', account_number: '0101017500123', is_active: 1 });
    await db.insert('group_centres', { name: 'Siddhartha Centre', name_np: 'सिद्धार्थ केन्द्र', address: 'Kirtipur', meeting_frequency: 'weekly', meeting_day: 2, meeting_time: '7:00', is_active: 1 });
    await db.insert('group_centres', { name: 'Hidden', is_active: 0 });
  });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('calculators: known values', () => {
  const fd = fin.fixedDeposit({ principal: 100000, rate: 9, months: 12, compounding: 'quarterly', tax: 5 });
  assert.equal(fd.gross, 9308.33);
  assert.equal(fd.maturity, 108842.92);
  assert.equal(fin.fixedDeposit({ principal: 100000, rate: 10, months: 6, compounding: 'simple', tax: 0 }).gross, 5000);
  const el = fin.loanEligibility({ income: 50000, existing: 0, rate: 13, months: 60, ratio: 50 });
  assert.equal(el.maxEmi, 25000);
  assert.ok(el.amount > 1090000 && el.amount < 1100000);
  assert.equal(fin.loanEligibility({ income: 10000, existing: 9000, rate: 13, months: 12, ratio: 50 }).amount, 0);
  assert.equal(fin.recurringSaving({ deposit: 1000, rate: 0, months: 12 }).maturity, 12000);
  assert.equal(fin.num(''), 0); assert.equal(fin.num('', 5), 5); assert.equal(fin.num('-3', 7), 7); assert.equal(fin.num('1,00,000'), 100000);
});

test('tool pages render with defaults and with input; tax default comes from settings', async () => {
  const fd = await request(app).get('/tools/fixed-deposit').set('Host', HOST);
  assert.equal(fd.status, 200);
  assert.match(fd.text, /name="tax"[^>]*value="5"/);
  assert.equal((await request(app).get('/tools/saving?deposit=abc').set('Host', HOST)).status, 200);
  assert.match((await request(app).get('/tools/loan-eligibility?income=60000').set('Host', HOST)).text, /Rs\. [\d,]+/);
  assert.equal((await request(app).get('/tools').set('Host', HOST)).status, 200);
});

test('disclosure, payment channels and centres show active rows; menu gains the links', async () => {
  assert.match((await request(app).get('/rates/disclosure').set('Host', HOST)).text, /८\.१२/, 'Nepali digits in Nepali');
  assert.match((await request(app).get('/pay').set('Host', HOST)).text, /0101017500123/);
  const c = await request(app).get('/centres').set('Host', HOST);
  assert.match(c.text, /सिद्धार्थ केन्द्र/);
  assert.doesNotMatch(c.text, /Hidden/);
  assert.match((await request(app).get('/centres?q=' + encodeURIComponent('%')).set('Host', HOST)).text, /केन्द्र भेटिएन|No centres/, 'LIKE wildcards are escaped');
  const home = await request(app).get('/').set('Host', HOST);
  for (const href of ['/pay', '/centres', '/rates/disclosure', '/tools/fixed-deposit', '/client-protection']) assert.match(home.text, new RegExp(`href="${href}"`));
});

test('client protection page follows the regulator (microfinance → NRB)', async () => {
  const r = await request(app).get('/client-protection').set('Host', HOST);
  assert.equal(r.status, 200);
  assert.match(r.text, /gunaso\.nrb\.org\.np/);
});
