'use strict';
/**
 * Old-site migration from files (public_html .zip + phpMyAdmin .sql) and the platform's demo data.
 * Runs against the real PostgreSQL (DATABASE_URL) with a throw-away tenant.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const IMPORT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-import-'));
process.env.IMPORT_DIR = IMPORT_ROOT;
process.env.UPLOAD_DIR = path.join(IMPORT_ROOT, 'uploads');
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'test.local';
process.env.PLATFORM_HOST = 'platform.test.local';
process.env.PLATFORM_ADMIN_USER = 'op' + Date.now().toString(36).slice(-4);
process.env.PLATFORM_ADMIN_PASSWORD = 'Operator@123456';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const dump = require('../src/lib/sql-dump');
const archive = require('../src/lib/site-archive');
const siteImport = require('../src/lib/site-import');
const demo = require('../src/lib/demo-data');

const SLUG = 'mig' + Date.now().toString(36).slice(-5);
let tenant;

/** Minimal zip writer (deflate) for test archives. entries: [[name, Buffer|string]] */
function makeZip(file, entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc >>> 0, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc >>> 0, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...locals, cd, end]));
}

// a phpMyAdmin-style export of the old site: the real legacy schema + a few rows
const BCRYPT = '$2y$10$abcdefghijklmnopqrstuuJ3kG1b4m8lX1yVJ9c0dQ5QqvQvE2pXu';
function legacyDump() {
  const schema = fs.readFileSync(path.join(__dirname, '../db/legacy/install.sql'), 'utf8');
  return `-- phpMyAdmin SQL Dump\n-- version 5.2.1\n/*!40101 SET NAMES utf8mb4 */;\nSET time_zone = "+00:00";\n\n${schema}\n
INSERT INTO \`admin_users\` (\`id\`, \`username\`, \`password\`, \`full_name\`, \`email\`, \`role\`, \`is_active\`) VALUES
(7, 'oldadmin', '${BCRYPT}', 'पुरानो एडमिन', 'old@example.np', 'superadmin', 1);
INSERT INTO \`members\` (\`id\`, \`name\`, \`name_np\`, \`email\`, \`phone\`, \`sadasyata_number\`, \`password_hash\`, \`approval_status\`, \`is_active\`, \`created_at\`) VALUES
(1, 'Ram Thapa', 'राम थापा', 'ram@example.np', '9800000001', 'M-001', '${BCRYPT}', 'approved', 1, '2079-01-01 10:00:00'),
(2, 'Sita K''C', 'सीता केसी', NULL, '9800000002', 'M-002', NULL, 'approved', 1, '0000-00-00 00:00:00');
INSERT INTO \`notices\` (\`id\`, \`title\`, \`title_np\`, \`content_np\`, \`notice_date\`, \`attachment\`, \`is_active\`) VALUES
(3, 'AGM', 'साधारण सभा; सूचना', 'पहिलो लाइन\\nदोस्रो लाइन', '2024-01-02', 'notices/agm.pdf', 1);
INSERT INTO \`news\` (\`id\`, \`title\`, \`title_np\`, \`image\`, \`is_active\`) VALUES (5, 'Hall', 'हल', 'assets/uploads/news/hall.jpg', 1);
INSERT INTO \`site_settings\` (\`setting_key\`, \`setting_value\`, \`setting_type\`, \`setting_group\`) VALUES ('site_name', 'पुरानो सहकारी', 'text', 'general');
`;
}

before(async () => {
  await tenants.applyPlatformSchema();
  await db.query('INSERT INTO platform.operators (username, password, full_name) VALUES ($1, $2, $3)', [process.env.PLATFORM_ADMIN_USER, await require('../src/lib/auth').hashPassword(process.env.PLATFORM_ADMIN_PASSWORD), 'Test operator']);
  tenant = await tenants.createTenant({ slug: SLUG, name: 'Migration test', domains: [`${SLUG}.test.local`], adminPassword: 'Admin@12345!', design: null });
});
after(async () => {
  await db.query(`DROP SCHEMA IF EXISTS ${db.ident('tenant_' + SLUG)} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.query('DELETE FROM platform.operators WHERE username = $1', [process.env.PLATFORM_ADMIN_USER]).catch(() => {});
  await db.pool.end();
  fs.rmSync(IMPORT_ROOT, { recursive: true, force: true });
});

test('SQL dump parser: quotes, escapes, column lists, multi-row, mysqldump without columns, triggers', () => {
  const p = dump.parseDump(`/*!40101 SET NAMES utf8mb4 */;
-- comment ; with semicolon
CREATE TABLE IF NOT EXISTS \`t\` (\`id\` int NOT NULL, \`a\` varchar(9) DEFAULT 'x,y' COMMENT 'p(q)', \`b\` enum('1','2'), PRIMARY KEY (\`id\`), KEY \`k\` (\`a\`)) ENGINE=InnoDB;
INSERT INTO \`t\` (\`b\`, \`id\`, \`a\`) VALUES ('2', 2, 'it''s'), ('1', 1, 'a\\\\b\\'c\\n');
INSERT IGNORE INTO t VALUES (3, _utf8mb4'ने', NULL), (4, 0x4142, b'1') ON DUPLICATE KEY UPDATE a = VALUES(a);
DELIMITER $$
CREATE TRIGGER x BEFORE INSERT ON t FOR EACH ROW BEGIN INSERT INTO t VALUES (9,'no',NULL); END$$
DELIMITER ;
INSERT INTO \`orphan\` VALUES (1);
`);
  const t = p.tables.get('t');
  assert.deepEqual(t.columns, ['id', 'a', 'b']);
  assert.equal(t.rows.length, 4, 'trigger body is not data');
  const src = dump.dumpSource(p);
  return src.rows('t', ['id', 'a', 'b'], 0, 10).then(rows => {
    assert.deepEqual(rows.map(r => r.id), [1, 2, 3, 4], 'sorted by id');
    assert.equal(rows[0].a, "a\\b'c\n");
    assert.equal(rows[1].a, "it's");
    assert.equal(rows[2].a, 'ने');
    assert.ok(Buffer.isBuffer(rows[3].a));
    assert.equal(rows[3].b, 1);
    assert.ok(p.warnings.some(w => /orphan/.test(w)), 'rows without a column list are reported');
  });
});

test('zip: finds public_html inside, unpacks only uploads, keys and SQL — never PHP or paths outside', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-'));
  const zip = path.join(dir, 'site.zip');
  makeZip(zip, [
    ['public_html/index.php', '<?php echo 1;'],
    ['public_html/includes/database.local.php', "<?php define('DB_HOST','localhost'); define('DB_NAME','old'); define('DB_USER','u'); define('DB_PASS','p'); define('SITE_URL','https://old.example');"],
    ['public_html/includes/.cred-master.key', 'oldvaultkey'],
    ['public_html/assets/uploads/news/hall.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])],
    ['public_html/assets/uploads/notices/agm.pdf', '%PDF-1.4'],
    ['public_html/assets/uploads/shell.php', '<?php system($_GET[1]);'],
    ['public_html/assets/uploads/.htaccess', 'deny'],
    ['backup/coop_old.sql', 'CREATE TABLE a (id int);'],
  ]);
  const work = path.join(dir, 'work');
  const x = await archive.extractSite(zip, work);
  assert.equal(x.root, 'public_html/');
  assert.ok(fs.existsSync(path.join(work, 'site/assets/uploads/news/hall.jpg')));
  assert.ok(fs.existsSync(path.join(work, 'site/includes/database.local.php')));
  assert.ok(!fs.existsSync(path.join(work, 'site/index.php')), 'PHP code is not unpacked');
  assert.ok(!fs.existsSync(path.join(work, 'site/assets/uploads/shell.php')), 'scripts in uploads are left out');
  assert.ok(!fs.existsSync(path.join(work, 'site/assets/uploads/.htaccess')));
  assert.equal(x.sqlFiles.length, 1);
  assert.equal(archive.safeRel('../etc/passwd'), null);
  assert.equal(archive.safeRel('a/../../b'), null);
  assert.equal(archive.safeRel('/abs'), null);
  assert.equal(archive.findRoot(['x/y/includes/database.php', 'x/y/assets/uploads/a.jpg']), 'x/y/');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('zip + SQL: dry run writes nothing, the real run imports rows, files and makes a safety copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-'));
  const zip = path.join(dir, 'public_html.zip');
  makeZip(zip, [
    ['includes/database.local.php', "<?php define('DB_NAME','old'); define('DB_USER','u'); define('DB_PASS','p');"],
    ['assets/uploads/news/hall.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9])],
    ['assets/uploads/notices/agm.pdf', '%PDF-1.4 test'],
    ['coop_old.sql', legacyDump()],
  ]);
  const t = await tenants.get(tenant.id);
  const lines = [];
  const dry = await siteImport.runImport({ tenant: t, zipPath: zip, dryRun: true, mode: 'fresh', log: l => lines.push(l) });
  assert.equal(dry.report.dry_run, true);
  assert.ok(dry.report.tables.some(x => x.table === 'members' && x.status === 'planned' && x.source_rows === 2));
  assert.equal(await db.withSchema(t.schema_name, () => db.value("SELECT count(*) FROM members")), 0, 'dry run wrote nothing');

  const real = await siteImport.runImport({ tenant: t, zipPath: zip, dryRun: false, mode: 'fresh', log: () => {} });
  assert.deepEqual(real.report.errors, []);
  await db.withSchema(t.schema_name, async () => {
    assert.equal(await db.value('SELECT count(*) FROM members'), 2);
    assert.equal(await db.value("SELECT name FROM members WHERE id = 2"), "Sita K'C");
    assert.equal(await db.value("SELECT created_at FROM members WHERE id = 2"), null, 'zero dates become NULL');
    assert.equal(await db.value("SELECT content_np FROM notices WHERE id = 3"), 'पहिलो लाइन\nदोस्रो लाइन');
    assert.equal(await db.value("SELECT username FROM admin_users WHERE deleted_at IS NULL"), 'oldadmin');
    assert.equal(await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'site_name'"), 'पुरानो सहकारी');
  });
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, SLUG, 'news/hall.jpg')), 'uploads copied to the tenant');
  assert.ok(real.report.snapshot && fs.existsSync(path.join(IMPORT_ROOT, 'reports', real.report.snapshot)), 'safety copy written');
  const snap = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(IMPORT_ROOT, 'reports', real.report.snapshot))));
  assert.equal(snap.tenant, SLUG);
  assert.ok(snap.tables.admin_users.length >= 1, 'the admins before the import are in the safety copy');
  assert.ok(fs.existsSync(real.reportFile));
  assert.ok(siteImport.reportsFor(SLUG).length >= 2);
  assert.ok(!fs.readdirSync(path.join(IMPORT_ROOT, '.work')).length, 'work folder cleaned');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('demo data: insert, refuse twice, remove exactly what was added', async () => {
  const t = await tenants.get(tenant.id);
  await db.withSchema(t.schema_name, async () => {
    await db.query("INSERT INTO site_settings (setting_key, setting_value) VALUES ('phone', '061-111111') ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value");
    const own = await db.insert('notices', { title: 'Own', title_np: 'आफ्नै', is_active: 1 });
    const before = Number(await db.value('SELECT count(*) FROM notices'));
    const r = await demo.insert();
    assert.ok(r.rows >= 10);
    assert.equal(Number(await db.value('SELECT count(*) FROM notices')), before + 5);
    assert.equal(await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'phone'"), '061-111111', 'own settings are kept');
    assert.equal((await demo.status()).present, true);
    await assert.rejects(demo.insert(), /already/);
    await db.query("UPDATE site_settings SET setting_value = 'edited' WHERE setting_key = 'mission_content_np'");
    await demo.remove();
    assert.equal(Number(await db.value('SELECT count(*) FROM notices')), before);
    assert.ok(await db.value('SELECT 1 FROM notices WHERE id = $1', [own.id]), "the cooperative's own notice stays");
    assert.equal(await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'mission_content_np'"), 'edited', 'edited settings stay');
    assert.equal(await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'ceo_message_np'"), '', 'demo text cleared');
    assert.equal((await demo.status()).present, false);
  });
});

test('platform console: data page, demo button, upload starts a dry run; operators only', async () => {
  const { createApp } = require('../src/app');
  const app = createApp();
  const H = 'platform.test.local';
  assert.equal((await request(app).get(`/platform/tenants/${tenant.id}/data`).set('Host', H)).status, 302, 'login required');
  const agent = request.agent(app);
  let r = await agent.get('/platform/login').set('Host', H);
  let csrf = r.text.match(/name="_csrf" value="([^"]+)"/)[1];
  r = await agent.post('/platform/login').set('Host', H).type('form').send({ _csrf: csrf, username: process.env.PLATFORM_ADMIN_USER, password: process.env.PLATFORM_ADMIN_PASSWORD });
  assert.equal(r.status, 302);
  r = await agent.get(`/platform/tenants/${tenant.id}/data`).set('Host', H);
  assert.equal(r.status, 200);
  assert.match(r.text, /Insert demo data/);
  csrf = r.text.match(/name="_csrf" value="([^"]+)"/)[1];

  // a real run without the typed slug is refused
  const sql = path.join(IMPORT_ROOT, 'old.sql');
  fs.writeFileSync(sql, legacyDump());
  r = await agent.post(`/platform/tenants/${tenant.id}/import?_csrf=${encodeURIComponent(csrf)}`).set('Host', H)
    .field('_csrf', csrf).field('mode', 'fresh').field('server_sql', 'old.sql');
  assert.equal(r.status, 302);
  assert.match(r.headers.location, /\/data$/);
  // path tricks are refused
  r = await agent.post(`/platform/tenants/${tenant.id}/import?_csrf=${encodeURIComponent(csrf)}`).set('Host', H)
    .field('_csrf', csrf).field('dry_run', '1').field('server_sql', '../old.sql');
  assert.match(r.headers.location, /\/data$/);
  // an uploaded .sql starts a dry run
  r = await agent.post(`/platform/tenants/${tenant.id}/import?_csrf=${encodeURIComponent(csrf)}`).set('Host', H)
    .field('_csrf', csrf).field('dry_run', '1').field('mode', 'fresh').attach('sqldump', Buffer.from(legacyDump()), 'old.sql');
  assert.equal(r.status, 302);
  const m = r.headers.location.match(/\/platform\/imports\/([a-z0-9-]+)$/);
  assert.ok(m, 'redirects to the job page');
  for (let k = 0; k < 100 && siteImport.getJob(m[1]).status === 'running'; k++) await new Promise(res => setTimeout(res, 50));
  const job = siteImport.getJob(m[1]);
  assert.equal(job.status, 'done', job.error || job.lines.join('\n'));
  r = await agent.get(`/platform/imports/${m[1]}`).set('Host', H);
  assert.match(r.text, /Dry run finished/);
  r = await agent.get(`/platform/tenants/${tenant.id}/reports/${m[1]}`).set('Host', H);
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /default-src 'none'/);
  assert.equal((await agent.get(`/platform/tenants/${tenant.id}/reports/..%2F..%2Fx`).set('Host', H)).status, 404);
  assert.ok(!fs.readdirSync(path.join(IMPORT_ROOT, '.incoming')).length, 'uploaded files removed after the job');

  // a wrong file type is refused before anything runs
  r = await agent.post(`/platform/tenants/${tenant.id}/import?_csrf=${encodeURIComponent(csrf)}`).set('Host', H)
    .field('_csrf', csrf).field('dry_run', '1').attach('archive', Buffer.from('<?php'), 'evil.php');
  assert.match(r.headers.location, /\/data$/);

  // demo data through the console
  r = await agent.post(`/platform/tenants/${tenant.id}/demo`).set('Host', H).type('form').send({ _csrf: csrf, action: 'insert' });
  assert.equal(r.status, 302);
  const t = await tenants.get(tenant.id);
  assert.equal((await db.withSchema(t.schema_name, () => demo.status())).present, true);
  r = await agent.post(`/platform/tenants/${tenant.id}/demo`).set('Host', H).type('form').send({ _csrf: csrf, action: 'remove' });
  assert.equal((await db.withSchema(t.schema_name, () => demo.status())).present, false);
});
