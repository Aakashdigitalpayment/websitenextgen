'use strict';
/** Integration API (CBS / DMS) tests. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'api.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.CREDENTIALS_KEY = process.env.CREDENTIALS_KEY || 'test-key-0123456789-0123456789-0123456789';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const crypto = require('crypto');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const api = require('../src/lib/api');
const webhooks = require('../src/lib/webhooks');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5);
const A = 'ia' + SUFFIX, B = 'ib' + SUFFIX;
const HA = `${A}.api.local`, HB = `${B}.api.local`;
let app, KEY, READONLY, KEY_B;

async function makeClient(slug, scopes, extra = {}) {
  const k = api.newKey();
  await db.withSchema('tenant_' + slug, () => db.insert('api_clients', { name: 'test ' + scopes.join(','), system_type: 'cbs', key_prefix: k.prefix, key_hash: k.hash, scopes, ...extra }));
  return k.key;
}
const call = (method, url, key = KEY, host = HA) => request(app)[method]('/api/v1' + url).set('Host', host).set('Authorization', 'Bearer ' + key);

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'API A', domains: [HA], adminPassword: 'Admin@12345!' });
  await tenants.createTenant({ slug: B, name: 'API B', domains: [HB], adminPassword: 'Admin@12345!' });
  KEY = await makeClient(A, Object.keys(api.SCOPES));
  READONLY = await makeClient(A, ['members:read']);
  KEY_B = await makeClient(B, Object.keys(api.SCOPES));
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

test('authentication: missing, malformed, wrong and other-tenant keys are rejected', async () => {
  assert.equal((await request(app).get('/api/v1/ping').set('Host', HA)).status, 401);
  assert.equal((await call('get', '/ping', 'cbk_000000000000.' + 'x'.repeat(43))).status, 401);
  assert.equal((await call('get', '/ping', KEY.slice(0, -2) + 'zz')).status, 401);
  assert.equal((await call('get', '/ping', KEY_B)).status, 401, "tenant B's key must not work on tenant A");
  const ok = await call('get', '/ping');
  assert.equal(ok.status, 200);
  assert.equal(ok.body.tenant, A);
});

test('scopes are enforced', async () => {
  assert.equal((await call('get', '/members', READONLY)).status, 200);
  const r = await call('put', '/members/X-1', READONLY).send({ name: 'x' });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, 'insufficient_scope');
});

test('IP allow-list', async () => {
  const k = await makeClient(A, ['members:read'], { allowed_ips: '203.0.113.0/24' });
  assert.equal((await call('get', '/ping', k)).status, 403);
  const k2 = await makeClient(A, ['members:read'], { allowed_ips: '127.0.0.1, ::1' });
  assert.equal((await call('get', '/ping', k2)).status, 200);
});

test('member upsert, validation, idempotency and isolation', async () => {
  const body = { name: 'Krishna Thapa', name_np: 'कृष्ण थापा', phone: '9851000001', dob_bs: '2040-02-15', external_id: 'CIF-1' };
  const r1 = await call('put', '/members/C-1').set('Idempotency-Key', 'idem-key-000001').send(body);
  assert.equal(r1.status, 201);
  assert.equal(r1.body.data.dob, '1983-05-29');
  const replay = await call('put', '/members/C-1').set('Idempotency-Key', 'idem-key-000001').send(body);
  assert.equal(replay.headers['idempotent-replay'], 'true');
  assert.equal(replay.body.data.id, r1.body.data.id);
  const mismatch = await call('put', '/members/C-1').set('Idempotency-Key', 'idem-key-000001').send({ ...body, name: 'Other' });
  assert.equal(mismatch.status, 422);
  const upd = await call('put', '/members/C-1').send({ email: 'k@example.com' });
  assert.equal(upd.status, 200);
  assert.equal(upd.body.data.name, 'Krishna Thapa');
  assert.equal((await call('put', '/members/C-2').send({ name: 'x', phone: 'abc' })).status, 422);
  assert.equal((await call('put', '/members/C-3').send({ phone: '9851000003' })).status, 422, 'new member needs a name');
  assert.equal((await call('get', '/members/C-1', KEY_B, HB)).status, 404, 'not visible to tenant B');
});

test('bulk upsert reports per-row results', async () => {
  const r = await call('post', '/members/bulk').send({ members: [{ member_no: 'B-1', name: 'One' }, { member_no: 'B-2', email: 'bad' }, { name: 'no number' }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.data.map(x => x.status), ['created', 'error', 'error']);
  assert.equal((await call('post', '/members/bulk').send({ members: Array(501).fill({}) })).status, 422);
});

test('change feed paginates by cursor without gaps', async () => {
  for (let i = 0; i < 5; i++) await call('put', '/members/F-' + i).send({ name: 'Feed ' + i });
  const seen = [];
  let cursor = null;
  do {
    const r = await call('get', '/members?limit=2' + (cursor ? '&cursor=' + cursor : ''));
    assert.equal(r.status, 200);
    seen.push(...r.body.data.map(m => m.member_no));
    cursor = r.body.next_cursor;
  } while (cursor);
  for (let i = 0; i < 5; i++) assert.ok(seen.includes('F-' + i));
  assert.equal(new Set(seen).size, seen.length, 'no duplicates');
  assert.equal((await call('get', '/members?cursor=garbage')).status, 400);
});

test('accounts and transactions are shown to the member', async () => {
  const acc = await call('put', '/members/C-1/accounts').send({ accounts: [
    { account_no: 'S-1', kind: 'saving', balance: 1000.5, product_name: 'Regular' },
    { account_no: 'L-1', kind: 'loan', balance: 50000, next_due_date: '2026-12-01', installment_amount: 2500 }] });
  assert.equal(acc.status, 200);
  assert.equal((await call('put', '/members/C-1/accounts').send({ accounts: [{ account_no: 'S-1', kind: 'gold' }] })).status, 422);
  const tx = await call('post', '/members/C-1/transactions').send({ transactions: [{ account_no: 'S-1', txn_id: 'T-1', txn_date: '2026-11-01T10:00:00+05:45', credit: 500 }] });
  assert.equal(tx.status, 200);
  // replace=true removes accounts no longer sent
  await call('put', '/members/C-1/accounts').send({ accounts: [{ account_no: 'S-1', kind: 'saving', balance: 2000 }] });
  const m = await call('get', '/members/C-1');
  assert.deepEqual(m.body.data.accounts.map(a => a.account_no), ['S-1']);
  assert.equal(m.body.data.accounts[0].balance, 2000);
});

test('applications: pull, update status with history, files, unknown type', async () => {
  await db.withSchema('tenant_' + A, () => db.query("INSERT INTO grievances (tracking_id, name, phone, subject, description, status) VALUES ('GR-API-TEST1', 'Ram', '9841000001', 's', 'd', 'pending')"));
  const list = await call('get', '/applications/grievance?status=pending');
  assert.equal(list.status, 200);
  assert.ok(list.body.data.some(a => a.tracking_id === 'GR-API-TEST1'));
  const bad = await call('patch', '/applications/grievance/GR-API-TEST1').send({ status: 'hacked' });
  assert.equal(bad.status, 422);
  const ok = await call('patch', '/applications/grievance/GR-API-TEST1').send({ status: 'resolved', remarks: 'done in CBS' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.data.status, 'resolved');
  const one = await call('get', '/applications/grievance/GR-API-TEST1');
  assert.equal(one.body.data.history.length, 1);
  assert.match(one.body.data.history[0].actor_name, /^API: /);
  assert.equal((await call('get', '/applications/constructor')).status, 404);
  assert.equal((await call('get', '/applications/grievance/GR-API-TEST1/files/../../etc')).status, 404);
});

test('documents: upload, list, download, delete; content-type checked', async () => {
  const up = await call('post', '/members/C-1/documents').field('title', 'KYC').field('doc_type', 'kyc').attach('file', Buffer.from('%PDF-1.4 test'), 'kyc.pdf');
  assert.equal(up.status, 201, JSON.stringify(up.body));
  const fake = await call('post', '/members/C-1/documents').attach('file', Buffer.from('<?php system($_GET[c]); ?>'), 'x.pdf');
  assert.equal(fake.status, 422, 'magic-byte check');
  const list = await call('get', '/members/C-1/documents');
  assert.equal(list.body.data.length, 1);
  const dl = await call('get', `/members/C-1/documents/${up.body.data.id}/file`);
  assert.equal(dl.status, 200);
  assert.equal((await request(app).get('/uploads/' + 'x').set('Host', HA)).status, 404);
  assert.equal((await call('delete', `/members/C-1/documents/${up.body.data.id}`)).status, 204);
});

test('webhooks: events are queued for subscribers (not echoed to the origin) and signed', async () => {
  const k = api.newKey();
  const vault = require('../src/lib/credentials-crypto');
  const client = await db.withSchema('tenant_' + A, async () => {
    const e = vault.encrypt('whsec_test');
    return db.insert('api_clients', { name: 'hook', system_type: 'cbs', key_prefix: k.prefix, key_hash: k.hash, scopes: ['members:write'],
      webhook_url: 'https://hooks.example.com/x', webhook_events: ['member.updated', 'member.created'], webhook_secret_enc: e.password_enc, webhook_secret_iv: e.password_iv, webhook_secret_tag: e.password_tag });
  });
  // change made by THIS client: no echo
  await call('put', '/members/H-1', k.key).send({ name: 'Hook' });
  // change made by another client: delivered to the subscriber
  await call('put', '/members/H-1').send({ name: 'Hook 2' });
  await new Promise(r => setTimeout(r, 200));
  const q = await db.withSchema('tenant_' + A, () => db.many('SELECT event, payload FROM api_webhook_deliveries WHERE client_id = $1 ORDER BY id', [client.id]));
  assert.equal(q.length, 1);
  assert.equal(q[0].event, 'member.updated');
  assert.equal(q[0].payload.name, 'Hook 2');
  // receiver-side verification of the signature scheme
  const body = '{"x":1}', ts = 1700000000;
  const expected = crypto.createHmac('sha256', 'whsec_test').update(`${ts}.${body}`).digest('hex');
  assert.equal(webhooks.sign('whsec_test', ts, body), expected);
});

test('rate limit per API client', async () => {
  process.env.API_RATE_PER_MIN = '5';
  const k = await makeClient(A, ['members:read']);
  let last;
  for (let i = 0; i < 8; i++) last = await call('get', '/ping', k);
  assert.equal(last.status, 429);
  delete process.env.API_RATE_PER_MIN;
});
