'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const db = require('../src/db');
const mig = require('../src/lib/site-migration');

after(() => db.pool.end());

test('reads DB settings, uploads and vault key from an old PHP site folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phpsite-'));
  fs.mkdirSync(path.join(root, 'includes'));
  fs.mkdirSync(path.join(root, 'assets/uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'includes/database.local.php'), `<?php
if (!defined('DB_HOST')) define('DB_HOST', 'db.example:3307');
if (!defined('DB_NAME')) define('DB_NAME', 'coop_db');
if (!defined('DB_USER')) define("DB_USER", "coop_user");
if (!defined('DB_PASS')) define('DB_PASS', 'p@ss:w/rd\\'x');`);
  fs.writeFileSync(path.join(root, 'includes/.cred-master.key'), 'abc123abc123abc123\n');
  const s = mig.readPhpSite(root);
  assert.equal(s.mysqlUrl, 'mysql://coop_user:' + encodeURIComponent("p@ss:w/rd'x") + '@db.example:3307/coop_db');
  assert.equal(s.uploads, path.join(root, 'assets/uploads'));
  assert.equal(s.credKey, 'abc123abc123abc123');
  assert.equal(mig.redact(s.mysqlUrl), 'mysql://coop_user:***@db.example:3307/coop_db');
  fs.rmSync(root, { recursive: true, force: true });
});

test('legacy values are cleaned (zero dates, NUL bytes, JSON)', () => {
  assert.equal(mig.fixValue('0000-00-00 00:00:00', 'timestamp without time zone'), null);
  assert.equal(mig.fixValue('a\u0000b', 'text'), 'ab');
  assert.equal(mig.fixValue({ a: 1 }, 'jsonb'), '{"a":1}');
  assert.equal(mig.fixValue('not json', 'jsonb'), '"not json"');
});

test('application file columns are marked private', () => {
  const cols = mig.fileColumns();
  assert.ok(cols.grievances.some(c => c.col === 'attachment' && c.private));
  assert.ok(cols.kyc_applications.some(c => c.col === 'citizenship_front' && c.private));
  assert.ok(cols.information_room_items.some(c => c.col === 'file_path' && c.private));
  assert.ok(cols.news.some(c => c.col === 'image' && !c.private));
});

test('HTML report escapes content', () => {
  const html = mig.htmlReport({ tenant: '<x>', steps: [{ name: '<script>', status: 'ok', detail: '' }], warnings: ['"w"'], errors: [], tables: [], files: {}, verify: {}, mode: 'fresh', source: 's', started_at: '', finished_at: '' });
  assert.ok(!html.includes('<script>') && html.includes('&lt;script&gt;'));
});
