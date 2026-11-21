'use strict';
/**
 * PHP → platform data migration, end to end (docs/MIGRATION.md).
 * A synthetic phpMyAdmin export holding EVERY table and column a production PHP database can have
 * (db/legacy/php-runtime-schema.sql) plus dirty legacy data goes through migrate:site: dry run, real run,
 * re-runs, --verify, the quarantine workflow, the mocked live-MySQL path and the PHP install.sql seed data.
 * Real PostgreSQL (DATABASE_URL), throw-away tenants.
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const IMPORT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'coop-legacy-'));
process.env.IMPORT_DIR = IMPORT_ROOT;
process.env.UPLOAD_DIR = path.join(IMPORT_ROOT, 'uploads');
process.env.PII_KEY = process.env.PII_KEY || crypto.randomBytes(32).toString('hex');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const dump = require('../src/lib/sql-dump');
const mig = require('../src/lib/site-migration');
const legacy = require('../src/lib/legacy-map');
const siteImport = require('../src/lib/site-import');
const nd = require('../src/lib/nepali-date');
const icons = require('../src/lib/icons');
const { buildLegacyDump, parseSchema, PII_KEY, mojibake } = require('./fixtures/legacy-dump');
const { makeZip } = require('./fixtures/zip');

const SLUG = 'leg' + Date.now().toString(36).slice(-5);
const SLUG2 = SLUG + 'b';
let tenant, tenant2;
const fx = buildLegacyDump();
const source = () => dump.dumpSource(dump.parseDump(fx.sql), 'fixture dump');
const inT = fn => db.withSchema(tenant.schema_name, fn);
const C = fx.cases;

before(async () => {
  await tenants.applyPlatformSchema();
  tenant = await tenants.createTenant({ slug: SLUG, name: 'Legacy migration test', domains: [], adminPassword: 'Admin@12345!', design: null });
  tenant2 = await tenants.createTenant({ slug: SLUG2, name: 'Legacy seed test', domains: [], adminPassword: 'Admin@12345!', design: null });
});
after(async () => {
  for (const s of [SLUG, SLUG2]) {
    await db.query(`DROP SCHEMA IF EXISTS ${db.ident('tenant_' + s)} CASCADE`);
    await db.query('DELETE FROM platform.tenants WHERE slug = $1', [s]);
  }
  await db.pool.end();
  fs.rmSync(IMPORT_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the map itself
test('inventory: every table and column of the PHP runtime schema has a destination (nothing silently lost)', async () => {
  const php = parseSchema(fs.readFileSync(path.join(__dirname, '../db/legacy/php-runtime-schema.sql'), 'utf8'));
  assert.ok(php.length >= 105, 'install.sql + runtime tables');
  for (const t of ['admin_roles', 'institutional_profile_welfare', 'institutional_welfare_opening', 'member_marketplace_listings', 'program_occurrences']) {
    assert.ok(php.some(x => x.name === t), `runtime-only table ${t} is in the inventory`);
  }
  await inT(async () => {
    const pgTables = new Set((await db.many("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'")).map(r => r.table_name));
    const problems = [];
    for (const t of php) {
      const plan = legacy.tablePlan(t.name, pgTables);
      if (plan.action === 'skip') { assert.equal(t.name, 'schema_migrations'); continue; }
      if (plan.action !== 'copy') { problems.push(`table ${t.name}: ${plan.action}`); continue; }
      const meta = new Map((await db.many('SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [plan.target])).map(r => [r.column_name, { type: r.data_type }]));
      const cp = legacy.columnPlan(t.name, t.cols.map(c => c.name), meta);
      for (const c of cp.unmapped) problems.push(`${t.name}.${c}`);
    }
    assert.deepEqual(problems, [], 'PHP tables/columns without a platform column — add them to a migration or to legacy-map.js');
  });
});

test('legacy values: dates, BS dates, digits, numbers, JSON, mojibake, statuses, roles', () => {
  const D = { type: 'date', nullable: true }, TS = { type: 'timestamp without time zone', nullable: true };
  assert.deepEqual(legacy.cleanDate('0000-00-00', false), { value: null, kind: 'zero_date' });
  assert.deepEqual(legacy.cleanDate('2080-05-01', false), { value: nd.bsToAd('2080-05-01'), kind: 'bs_date' });
  assert.deepEqual(legacy.cleanDate('२०८०-०१-०१', false), { value: nd.bsToAd('2080-01-01'), kind: 'bs_date' });
  assert.equal(legacy.cleanDate('2024-02-30', false).kind, 'invalid_date');
  assert.equal(legacy.cleanValue('2024-01-05 10:11:12', D).value, '2024-01-05', 'datetime into a date column keeps the day');
  assert.equal(legacy.cleanValue('2024-13-45 25:00:00', TS).value, null);
  assert.equal(legacy.cleanValue('2081/01/01', D).value, nd.bsToAd('2081-01-01'));
  assert.deepEqual(legacy.cleanValue('', { type: 'integer', nullable: true }), { value: null, kind: 'empty_number' });
  assert.equal(legacy.cleanValue('1,250', { type: 'integer' }).value, 1250);
  assert.equal(legacy.cleanValue('रु. १,२००.५०', { type: 'numeric' }).value, '1200.50');
  assert.equal(legacy.cleanValue('abc', { type: 'integer' }).kind, 'invalid_number');
  assert.equal(legacy.cleanValue('a:1:{s:1:"a";}', { type: 'jsonb' }).value, JSON.stringify('a:1:{s:1:"a";}'));
  assert.equal(legacy.cleanValue('x'.repeat(30), { type: 'character varying', max: 20 }).kind, 'truncated');
  assert.equal(legacy.fixMojibake(mojibake('नेपाल सहकारी')), 'नेपाल सहकारी');
  assert.equal(legacy.fixMojibake('Itâ€™s â€“ ok'), 'It’s – ok', 'Windows-1252 mojibake');
  assert.equal(legacy.fixMojibake('Café ok'), 'Café ok', 'real Latin-1 text stays');
  assert.equal(legacy.fixMojibake('नेपाल'), 'नेपाल');
  assert.equal(legacy.normaliseStatus('Approved '), 'approved');
  assert.equal(legacy.normaliseStatus('In Progress'), 'in_progress');
  assert.equal(legacy.normaliseStatus('approve'), 'approved');
  assert.equal(legacy.normaliseStatus('VALID'), 'VALID', 'unknown words are not changed');
  assert.equal(legacy.normaliseRole('super_admin'), 'superadmin');
  assert.equal(legacy.normaliseRole('Super Admin'), 'superadmin');
  // older shapes: careers.status → is_active only when the table has no is_active yet
  const meta = new Map([['id', { type: 'integer' }], ['is_active', { type: 'smallint', nullable: true }]]);
  const old = legacy.columnPlan('careers', ['id', 'status'], meta);
  assert.equal(old.mapped.status.to, 'is_active');
  assert.equal(legacy.transformRow('careers', { id: 1, status: 'closed' }, old, meta).values.is_active, 0);
  assert.deepEqual(legacy.columnPlan('careers', ['id', 'status', 'is_active'], meta).unmapped, ['status'], 'both present: the old column is archived');
});

// ---------------------------------------------------------------- the whole dump
let real;
test('dry run rehearses everything and writes nothing', async () => {
  const before = await inT(() => db.value('SELECT count(*) FROM members'));
  const r = await mig.migrate({ tenant: SLUG, source: source(), dryRun: true, mode: 'fresh', piiKey: PII_KEY });
  assert.equal(r.dry_run, true);
  assert.equal(r.accounted, true);
  assert.equal(r.totals.source_rows, fx.total);
  assert.equal(r.totals.quarantined, 1, 'the duplicate primary key is predicted');
  assert.ok(r.tables.some(t => t.table === 'members' && t.status === 'planned'));
  await inT(async () => {
    assert.equal(await db.value('SELECT count(*) FROM members'), before, 'rolled back');
    assert.equal(await db.value('SELECT count(*) FROM import_quarantine'), 0);
    assert.equal(await db.value('SELECT count(*) FROM legacy_archive'), 0);
  });
});

test('real run: every source row is imported, repaired, quarantined or archived', async () => {
  real = await mig.migrate({ tenant: SLUG, source: source(), mode: 'fresh', piiKey: PII_KEY });
  const T = real.totals;
  assert.equal(T.source_rows, fx.total);
  assert.equal(T.imported + T.quarantined + T.archived_rows + T.already_present + T.skipped, fx.total);
  assert.equal(real.accounted, true);
  assert.equal(T.quarantined, 1);
  assert.equal(T.archived_rows, 4, 'HRM + the cooperative\'s own table');
  assert.equal(T.skipped, 1, 'the PHP migration ledger');
  assert.ok(T.repaired >= 20);
  assert.deepEqual(real.errors, []);
  for (const e of real.tables) if (e.action === 'copy') assert.equal(e.imported + e.quarantined, e.source_rows, e.table);
  for (const [t, n] of Object.entries(fx.rows)) {
    const e = real.tables.find(x => x.table === t);
    assert.ok(e, `${t} is in the report`);
    assert.equal(e.source_rows, n, t);
  }
  assert.ok(real.verify_tables.length > 100);
  assert.deepEqual(real.verify_tables.filter(v => !v.ok).map(v => v.table), [], 'source ↔ target match row by row');
  assert.ok(real.unmapped.some(u => u.table === 'news' && u.column === 'legacy_views' && u.samples.includes('1234')));
});

test('members: duplicates kept and reported, legacy columns mapped, dates, mojibake, KYM links', async () => {
  const m = C.members;
  await inT(async () => {
    assert.equal(Number(await db.value('SELECT count(*) FROM members')), fx.rows.members, 'every member, duplicates included');
    const a = await db.one('SELECT * FROM members WHERE id = $1', [m.dupA]);
    const b = await db.one('SELECT * FROM members WHERE id = $1', [m.dupB]);
    assert.equal(a.created_at, null, 'zero date → NULL');
    assert.equal(a.membership_date, nd.bsToAd('2080-04-15'), 'BS date → AD');
    assert.equal(a.approval_status, 'approved');
    assert.equal(a.twofa_enabled, 0, 'NULL in a NOT NULL column takes the default');
    assert.equal(b.sadasyata_number, 'm-dup', 'trimmed');
    assert.equal(b.name_np, 'दोहोरो दुई', 'mojibake repaired');
    assert.equal(b.kyc_application_id, null, 'dangling KYM link cleared');
    assert.equal(b.created_at, null, 'impossible timestamp → NULL');
    assert.equal(b.approval_status, 'approved');
    assert.ok(!(await db.value("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'members_sadasyata_uq'")), 'unique guard waits until the duplicates are fixed');
    const legacyM = await db.one('SELECT * FROM members WHERE id = $1', [m.legacyNamed]);
    assert.equal(legacyM.name, 'Legacy Fullname', 'members.full_name → name');
    assert.equal(legacyM.sadasyata_number, 'M-LEGACY', 'members.member_id → sadasyata_number');
    assert.equal(legacyM.kyc_application_id, C.kyc.blank, 'linked to the KYM with the same membership number');
    assert.ok(legacyM.password_hash.startsWith('$2y$'), 'PHP bcrypt hash kept');
    const dev = await db.one('SELECT * FROM members WHERE id = $1', [m.devDigits]);
    assert.equal(dev.membership_date, nd.bsToAd('2080-01-01'), 'Devanagari digits + BS');
    assert.equal(dev.kyc_application_id, C.kyc.link);
    const arch = await db.one("SELECT data FROM legacy_archive WHERE source_table = 'members' AND source_key = $1 AND kind = 'columns'", [String(m.dupB)]);
    assert.equal(arch.data.kyc_application_id, 9999, 'the cleared link is archived');
  });
  const g = real.guards.find(x => x.index === 'members_sadasyata_uq');
  assert.equal(g.restored, false);
  assert.equal(g.duplicates, 1);
  assert.ok(real.warnings.some(w => /duplicate membership numbers/.test(w)));
});

test('KYM, PII, notices, long values, statuses, roles, settings, help topics', async () => {
  await inT(async () => {
    const k = await db.one('SELECT * FROM kyc_applications WHERE id = $1', [C.kyc.blank]);
    assert.equal(k.status, 'pending', "invalid enum '' → the default");
    assert.equal(k.citizenship_no, C.kyc.pii2Plain, 'pii2 decrypted with the old key (read back through the new encryption)');
    const raw = await db.value("SELECT 'raw:' || citizenship_no FROM kyc_applications WHERE id = $1", [C.kyc.blank]);
    assert.match(raw, /^raw:pii3:/, 'stored with the platform encryption');
    assert.equal(k.dob_ad, null, 'impossible date → NULL (kept in the archive)');
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'kyc_applications' AND source_key = $1", [String(C.kyc.blank)])).dob_ad, '2024-02-30');
    assert.equal(await db.value('SELECT dob_ad FROM kyc_applications WHERE id = $1', [C.kyc.link]), nd.bsToAd('2050-01-15'), 'a birth date in the future is a BS date');
    assert.equal((await db.one('SELECT status FROM kyc_applications WHERE id = $1', [C.kyc.link])).status, 'approved');
    assert.equal(await db.value("SELECT count(*) FROM kyc_applications WHERE citizenship_no LIKE 'pii1:%' OR citizenship_no LIKE 'pii2:%'"), 0);

    assert.equal(await db.value('SELECT notice_date FROM notices WHERE id = $1', [C.notices.bs]), nd.bsToAd('2080-05-01'));
    assert.equal(await db.value('SELECT notice_date FROM notices WHERE id = $1', [C.notices.zero]), null);
    assert.equal(await db.value('SELECT title_np FROM notices WHERE id = $1', [C.notices.zero]), 'शून्य मिति');
    assert.equal(await db.value('SELECT notice_date FROM notices WHERE id = $1', [C.notices.bad]), null);
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'notices' AND source_key = $1", [String(C.notices.bad)])).notice_date, '2024-02-30');

    const ap = await db.one('SELECT * FROM appointments WHERE id = $1', [C.appointments.long]);
    assert.equal([...ap.name].length, 150, 'no longer cut: column widened like PHP');
    assert.equal(ap.preferred_time, '10:00 AM - 11:30 AM (morning)');
    assert.equal(ap.status, 'confirmed');
    const g = await db.one('SELECT * FROM gallery WHERE id = $1', [C.gallery.video]);
    assert.equal(g.media_type, 'video_embed');
    assert.equal(g.album_id, null, 'orphan album link cleared');
    assert.equal(await db.value('SELECT a.name_np FROM gallery g JOIN gallery_albums a ON a.id = g.album_id WHERE g.id = $1', [C.gallery.oldPhoto]), 'पुरानो एल्बम', 'album text of older installs → an album, as PHP did');

    const ip = await db.one('SELECT * FROM institutional_profile WHERE id = $1', [C.institutional_profile.netProfit]);
    assert.equal(Number(ip.profit_loss), 555000, 'net_profit → profit_loss');
    assert.ok(await db.value('SELECT 1 FROM institutional_profile WHERE id = $1', [C.institutional_profile.dup]), 'duplicate year/month kept');
    assert.ok(await db.value("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'institutional_profile_fy_month_idx'"), 'plain index instead of the unique one');

    const admin = await db.one('SELECT * FROM admin_users WHERE id = $1', [C.admin_users.legacy]);
    assert.equal(admin.role, 'superadmin');
    assert.equal(admin.full_name, 'पुरानो नाम', 'admin_users.name → full_name');
    assert.equal(admin.custom_role_id, null);

    const svc = await db.one('SELECT * FROM services WHERE id = $1', [C.services.svc]);
    assert.equal(svc.is_new, 1);
    assert.equal(svc.new_until, nd.bsToAd('2081-01-01'));
    assert.equal(icons.iconFor(svc.icon), 'piggy-bank', 'Font Awesome value resolves to Lucide');
    assert.equal(await db.value('SELECT admin_attachment FROM member_feedback WHERE id = 1'), 'office-replies/reply-1.pdf');
    assert.deepEqual((await db.many('SELECT status FROM member_welfare_claims WHERE id IN (1, 2) ORDER BY id')).map(r => r.status), ['paid', 'completed']);
    const card = await db.one('SELECT * FROM member_id_cards WHERE id = $1', [C.cards.locked]);
    assert.equal(card.status, 'active');
    assert.ok(card.locked_at, 'PHP "locked" status → locked_at');

    const loan = await db.one('SELECT * FROM loan_applications WHERE id = $1', [C.loan.dupTracking]);
    assert.equal(loan.tracking_id, C.loan.tracking + '-dup1', 'duplicate tracking id made unique');
    assert.equal(loan.status, 'processing', '"In Progress" → the closest status this table knows');
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'loan_applications' AND source_key = $1", [String(C.loan.dupTracking)])).tracking_id, C.loan.tracking);

    assert.equal(await db.value('SELECT old_values FROM audit_log WHERE id = $1', [C.audit.serialized]), 'a:2:{s:6:"status";s:7:"pending";}', 'PHP-serialized text kept as a JSON string');
    assert.equal(await db.value('SELECT membership_date FROM member_import_rows WHERE id = 1'), nd.bsToAd('2079-10-10'));
    assert.equal(await db.value('SELECT membership_date FROM member_import_rows WHERE id = 2'), null);

    const s = Object.fromEntries((await db.many('SELECT setting_key, setting_value FROM site_settings')).map(r => [r.setting_key, r.setting_value]));
    assert.equal(s.ai_enabled, '1');
    assert.equal(s.site_tagline, 'पुरानो नारा');
    assert.equal(s.admin_2fa_required, '1');
    assert.ok(await db.value("SELECT 1 FROM chatbot_faqs WHERE question = 'सहायता प्रश्न'"), 'help topics → assistant answers');
    assert.ok((await db.value("SELECT count(*) FROM schema_migrations WHERE version LIKE '066%'")) >= 1, "the platform's own migration ledger is untouched");

    assert.equal(await db.value("SELECT count(*) FROM legacy_archive WHERE source_table = 'hrm_employees' AND kind = 'row'"), 2);
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'coop_sms_log' AND kind = 'row'")).message, 'SMS पठाइयो');
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'news' AND source_key = '1'")).legacy_views, 1234);
    assert.equal((await db.value("SELECT data FROM legacy_archive WHERE source_table = 'careers' AND source_key = '1'")).status, 'closed');
    const q = await db.many('SELECT * FROM import_quarantine WHERE resolved_at IS NULL');
    assert.equal(q.length, 1);
    assert.equal(q[0].source_table, 'faqs');
    assert.equal(q[0].reason, 'duplicate');
    assert.equal(q[0].data.question, 'Duplicate id row', 'the whole source row is kept');
  });
});

test('report: JSON + HTML + summary say what happened', () => {
  const html = mig.htmlReport(real);
  for (const s of ['Every row accounted for', 'Repairs', 'Quarantined rows', 'Columns without a platform equivalent', 'legacy_views', 'Verify: source', 'members_sadasyata_uq']) assert.ok(html.includes(s), s);
  assert.ok(!/<script/i.test(html));
  const text = mig.summary(real);
  assert.match(text, new RegExp(`Rows: ${fx.total} in the old database`));
  assert.match(text, /Every row accounted for: yes/);
  assert.match(text, /--quarantine/);
  const json = JSON.parse(JSON.stringify(real));
  assert.ok(json.tables.every(t => !('_plan' in t) && !('_meta' in t)), 'no internals in the JSON report');
});

test('re-running is idempotent (fresh and incremental)', async () => {
  const counts = () => inT(async () => Object.fromEntries(await Promise.all(['members', 'kyc_applications', 'notices', 'faqs', 'loan_applications', 'legacy_archive', 'import_quarantine', 'chatbot_faqs', 'site_settings']
    .map(async t => [t, Number(await db.value(`SELECT count(*) FROM ${t}`))]))));
  const first = await counts();
  const again = await mig.migrate({ tenant: SLUG, source: source(), mode: 'fresh', piiKey: PII_KEY });
  assert.deepEqual(again.totals, real.totals);
  assert.deepEqual(await counts(), first, 'fresh re-run gives the same data');
  const inc = await mig.migrate({ tenant: SLUG, source: source(), mode: 'incremental', piiKey: PII_KEY });
  assert.equal(inc.accounted, true);
  assert.equal(inc.totals.imported, 0, 'nothing new');
  assert.equal(inc.totals.already_present, fx.total - 4 - 1);
  assert.deepEqual(await counts(), first, 'incremental re-run adds nothing twice');
});

test('--verify compares old and new without writing, and finds a changed row', async () => {
  const ok = await mig.verifyOnly({ tenant: SLUG, source: source(), piiKey: PII_KEY });
  assert.equal(ok.verify_only, true);
  assert.deepEqual(ok.verify_tables.filter(v => !v.ok).map(v => v.table), []);
  assert.equal(ok.verify_tables.find(v => v.table === 'members').checksum_source, ok.verify_tables.find(v => v.table === 'members').checksum_target);
  await inT(() => db.query("UPDATE notices SET title = 'changed by hand' WHERE id = 1"));
  await inT(() => db.query('DELETE FROM news WHERE id = 2'));
  const bad = await mig.verifyOnly({ tenant: SLUG, source: source(), piiKey: PII_KEY });
  const n = bad.verify_tables.find(v => v.table === 'notices');
  assert.equal(n.ok, false);
  assert.deepEqual(n.changed_examples, ['1']);
  assert.notEqual(n.checksum_source, n.checksum_target);
  assert.deepEqual(bad.verify_tables.find(v => v.table === 'news').missing_examples, ['2']);
  assert.match(mig.summary(bad), /2 with differences/);
});

test('quarantine: listed with secrets masked, retried after a fix, or closed', async () => {
  await inT(async () => {
    const list = await mig.listQuarantine();
    assert.equal(list.length, 1);
    // a quarantined KYM row shows no citizenship number in clear
    const masked = mig.maskQuarantineData('kyc_applications', { citizenship_no: '12-34-56789', password_hash: '$2y$x', name: 'A' });
    assert.deepEqual(masked, { citizenship_no: '•••789', password_hash: '•••', name: 'A' });
    let r = await mig.retryQuarantine(null, { by: 'test' });
    assert.deepEqual([r.imported, r.still], [0, 1], 'still a duplicate id');
    await db.query("UPDATE import_quarantine SET data = jsonb_set(data, '{id}', '9001') WHERE resolved_at IS NULL");
    r = await mig.retryQuarantine(null, { by: 'test' });
    assert.equal(r.imported, 1);
    assert.equal(await db.value('SELECT question FROM faqs WHERE id = 9001'), 'Duplicate id row');
    assert.equal(await db.value("SELECT resolution FROM import_quarantine WHERE source_table = 'faqs'"), 'imported');
    assert.equal((await mig.listQuarantine()).length, 0);
    await db.query("INSERT INTO import_quarantine (run_id, source_table, source_key, reason, data) VALUES ('t', 'faqs', 'x', 'error', '{}')");
    const id = await db.value("SELECT id FROM import_quarantine WHERE source_key = 'x'");
    assert.equal(await mig.discardQuarantine(id, { by: 'test' }), true);
    assert.equal(await mig.discardQuarantine(id, { by: 'test' }), false, 'only open rows');
  });
});

test('zip + SQL through the platform job: private comma file lists, safety copy, summary', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legzip-'));
  const zip = path.join(dir, 'public_html.zip');
  makeZip(zip, [
    ['public_html/includes/database.local.php', `<?php define('DB_NAME','old'); define('DB_USER','u'); define('PII_ENC_KEY', '${PII_KEY}');`],
    ['public_html/assets/uploads/loan/a.pdf', '%PDF-1.4 a'],
    ['public_html/assets/uploads/loan/b.pdf', '%PDF-1.4 b'],
    ['public_html/assets/uploads/news/n.jpg', Buffer.from([0xff, 0xd8, 0xff])],
    ['coop.sql', fx.sql],
  ]);
  const t = await tenants.get(tenant.id);
  const { report } = await siteImport.runImport({ tenant: t, zipPath: zip, dryRun: false, mode: 'fresh', log: () => {} });
  assert.equal(report.accounted, true);
  assert.equal(report.totals.source_rows, fx.total);
  assert.ok(report.snapshot);
  await inT(async () => {
    assert.equal(await db.value('SELECT documents FROM loan_applications WHERE id = $1', [C.loan.dupTracking]), '_private/loan/a.pdf,_private/loan/b.pdf');
    assert.equal(await db.value('SELECT citizenship_no FROM kyc_applications WHERE id = $1', [C.kyc.blank]), C.kyc.pii2Plain, 'PII key read from database.local.php');
  });
  const dest = path.join(process.env.UPLOAD_DIR, SLUG);
  assert.ok(fs.existsSync(path.join(dest, '_private/loan/a.pdf')) && !fs.existsSync(path.join(dest, 'loan/a.pdf')), 'gated folder moved to private storage');
  assert.ok(fs.existsSync(path.join(dest, 'news/n.jpg')));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- the live MySQL path (mysql2 mocked)
/** A mysql2/promise stand-in answering the queries mysqlSource() sends, from a parsed dump. */
function fakeMysql(parsed) {
  const src = dump.dumpSource(parsed);
  const sent = [];
  return {
    sent,
    async createConnection(opts) {
      assert.equal(opts.dateStrings, true, 'dates come back as text, like the dump');
      return {
        async query(sql) {
          sent.push(sql);
          let m;
          if (/SELECT VERSION\(\)/.test(sql)) return [[{ v: '10.6.18-MariaDB', cs: 'utf8mb4' }]];
          if (/^SHOW TABLES/.test(sql)) return [[...parsed.tables.keys()].map(t => ({ Tables_in_old: t }))];
          if ((m = sql.match(/^SELECT COUNT\(\*\) AS n FROM `(\w+)`/))) return [[{ n: await src.count(m[1]) }]];
          if ((m = sql.match(/^SHOW COLUMNS FROM `(\w+)`/))) return [(await src.columns(m[1])).map(Field => ({ Field }))];
          if ((m = sql.match(/^SELECT `(\w+)` AS v FROM `(\w+)` WHERE/))) return [(await src.sample(m[2], m[1], 50)).map(v => ({ v }))];
          if ((m = sql.match(/^SELECT (.+) FROM `(\w+)`\s+(?:ORDER BY id\s+)?LIMIT (\d+) OFFSET (\d+)/))) {
            const cols = [...m[1].matchAll(/`(\w+)`/g)].map(x => x[1]);
            return [await src.rows(m[2], cols, Number(m[4]), Number(m[3]))];
          }
          throw new Error('unexpected query ' + sql.slice(0, 80));
        },
        async end() {},
      };
    },
  };
}

test('live MySQL source (mocked mysql2): same import, same accounting; import-from-mysql uses it too', async () => {
  const driver = fakeMysql(dump.parseDump(fx.sql));
  const r = await mig.migrate({ tenant: SLUG, mysqlUrl: 'mysql://u:secret@old-host:3306/coop', mysqlDriver: driver, mode: 'fresh', piiKey: PII_KEY });
  assert.equal(r.source, 'mysql://u:***@old-host:3306/coop', 'password never in the report');
  assert.equal(r.accounted, true);
  assert.deepEqual(r.totals, real.totals);
  assert.deepEqual(r.verify_tables.filter(v => !v.ok).map(v => v.table), []);
  assert.ok(driver.sent.some(s => /ORDER BY id LIMIT/.test(s)));
  assert.match(fs.readFileSync(path.join(__dirname, '../scripts/import-from-mysql.js'), 'utf8'), /mig\.migrate\(/, 'the older script runs the same engine');
});

// ---------------------------------------------------------------- the PHP install seed data
// install.sql itself holds no rows (only the schema); the seed rows a fresh PHP install has come from install.sql plus
// the runtime ensure*() functions (welfare claim types, digital service types, honor categories, settings, ledger).
// test/fixtures/php-fresh-install.sql.gz is a mysqldump of such a database, made by the PHP code itself
// (scripts/legacy/inventory-php-schema.php against MariaDB).
test('a fresh PHP install (install.sql + runtime seed rows, real mysqldump) imports cleanly', async () => {
  assert.equal(dump.parseDump(fs.readFileSync(path.join(__dirname, '../db/legacy/install.sql'), 'utf8')).tables.size > 80, true, 'install.sql parses');
  const parsed = dump.parseDump(dump.readDumpFile(path.join(__dirname, 'fixtures/php-fresh-install.sql.gz')));
  const seeded = [...parsed.tables.values()].reduce((a, t) => a + t.rows.length, 0);
  assert.ok(parsed.tables.size >= 105 && seeded >= 20, 'every table, with the seed rows');
  const r = await mig.migrate({ tenant: SLUG2, source: dump.dumpSource(parsed, 'php-fresh-install.sql.gz'), mode: 'fresh' });
  assert.equal(r.accounted, true);
  assert.equal(r.totals.source_rows, seeded);
  assert.equal(r.totals.quarantined, 0);
  assert.equal(r.totals.archived_rows, 0, 'no table without a home');
  assert.deepEqual(r.unmapped, []);
  assert.deepEqual(r.verify_tables.filter(v => !v.ok).map(v => v.table), []);
  await db.withSchema(tenant2.schema_name, async () => {
    assert.ok(Number(await db.value('SELECT count(*) FROM welfare_claim_types')) >= 6);
    assert.ok(Number(await db.value('SELECT count(*) FROM digital_service_types')) >= 10);
  });
});
