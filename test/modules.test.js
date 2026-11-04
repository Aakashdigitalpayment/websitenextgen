'use strict';
/** Unit tests for the add-on modules (no HTTP). */
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');

after(() => db.pool.end());

test('TOTP matches RFC 6238 vectors and rejects bad codes', () => {
  const t = require('../src/lib/totp');
  const secret = t.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(t.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(t.codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.notEqual(t.verify(secret, t.codeAt(secret, t.currentStep())), null);
  assert.equal(t.verify(secret, '000000x'), null);
});

test('TOTP backup codes are single use', async () => {
  const t = require('../src/lib/totp');
  const { codes, hashes } = await t.backupCodes(3);
  const left = await t.consumeBackupCode(codes[1], JSON.stringify(hashes));
  assert.equal(left.length, 2);
  assert.equal(await t.consumeBackupCode(codes[1], JSON.stringify(left)), null);
});

test('CSV parser handles quotes, commas, BOM and CRLF', () => {
  const { parseCsv } = require('../src/lib/member-import');
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n\r\n2,,z\n');
  assert.deepEqual(rows, [['a', 'b', 'c'], ['1', 'x, y', 'say "hi"'], ['2', '', 'z']]);
});

test('member import date of birth: BS/AD and invalid dates', () => {
  const { normDob } = require('../src/lib/member-import');
  assert.equal(normDob('2045-05-12', 'bs').value, '1988-08-28');
  assert.equal(normDob('२०४५-०५-१२', 'bs').value, '1988-08-28');
  assert.equal(normDob('1990-02-28', 'ad').value, '1990-02-28');
  assert.ok(normDob('1990-02-30', 'ad').error);
  assert.ok(normDob('2045-13-01', 'bs').error);
});

test('credential vault: GCM round trip, tamper detection, per-tenant keys', () => {
  process.env.CREDENTIALS_KEY = 'test-key-0123456789-0123456789-0123456789';
  const vault = require('../src/lib/credentials-crypto');
  const encA = db.withSchema('tenant_a', () => vault.encrypt('p@ss'));
  assert.equal(db.withSchema('tenant_a', () => vault.decrypt(encA).plain), 'p@ss');
  assert.throws(() => db.withSchema('tenant_b', () => vault.decrypt(encA)));
  const tampered = { ...encA, password_enc: Buffer.from('xxxx').toString('base64') };
  assert.throws(() => db.withSchema('tenant_a', () => vault.decrypt(tampered)));
});

test('licence status', () => {
  const lic = require('../src/lib/license');
  const day = n => new Date(Date.parse(lic.todayKathmandu()) + n * 86400_000).toISOString().slice(0, 10);
  assert.equal(lic.status({}).configured, false);
  assert.equal(lic.status({ license_valid_until: day(5) }).daysLeft, 5);
  assert.equal(lic.status({ license_valid_until: day(0) }).expired, false);
  assert.equal(lic.status({ license_valid_until: day(-1) }).expired, true);
  assert.equal(lic.loginBlocked({ license_valid_until: day(-1) }, { role: 'admin' }), true);
  assert.equal(lic.loginBlocked({ license_valid_until: day(-1) }, { role: 'superadmin' }), false);
});

test('webhook URLs must be public https', async () => {
  const { safeHttpsUrl } = require('../src/lib/notify');
  assert.equal(await safeHttpsUrl('http://example.com/x'), null);
  assert.equal(await safeHttpsUrl('https://127.0.0.1/hook'), null);
  assert.equal(await safeHttpsUrl('https://10.0.0.5/hook'), null);
  assert.equal(await safeHttpsUrl('https://user:pw@example.com/'), null);
  assert.equal(await safeHttpsUrl('not a url'), null);
});

test('notification templates render variables', () => {
  const { render } = require('../src/lib/notify');
  assert.equal(render('नमस्ते {{name}},\\n{{tracking_id}}', { name: 'राम', tracking_id: 'GR-1' }), 'नमस्ते राम,\nGR-1');
});
