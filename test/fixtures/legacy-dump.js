'use strict';
/**
 * Synthetic phpMyAdmin export of a real PHP cooperative database, for the migration tests.
 *
 * - every table and column a production PHP install can hold (db/legacy/php-runtime-schema.sql: install.sql + all
 *   runtime-created tables/columns), with clean rows generated from the column types;
 * - columns and tables of older installs (admin_users.name, members.full_name / member_id, services.is_new …,
 *   retired HRM tables, a cooperative's own extra table and column);
 * - dirty data the old MySQL accepted: zero and invalid dates, BS dates in AD columns, Devanagari digits,
 *   duplicate membership numbers, a duplicate primary key, orphans, mojibake, legacy statuses / roles / icons /
 *   settings, pii1/pii2 citizenship numbers, $2y$ hashes, PHP-serialized text in JSON columns, values longer
 *   than the new columns, comma-separated file lists in private folders.
 *
 * buildLegacyDump() → { sql, rows: { table: count }, total, cases }
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../../db/legacy/php-runtime-schema.sql'), 'utf8');
const PII_KEY = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
// produced by the PHP includes/pii-crypto.php pii_enc() with PII_ENC_KEY = PII_KEY (test/applications.test.js)
const PII1 = 'pii1:YxQfrRJBT2hms7CqAZ7Ym/E7ufFxk4ROYTjfk+sSHOkN3SD/THRjzYLcCsb2/q4t6OlPb0kf'; // 12-01-71-04521
/** pii2 exactly as PHP writes it: AES-256-GCM, key HMAC-SHA256(key, 'pii-enc-v1'), AAD 'pii2'. */
function pii2(plain) {
  const k = crypto.createHmac('sha256', Buffer.from(PII_KEY, 'hex')).update('pii-enc-v1').digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', k, iv);
  c.setAAD(Buffer.from('pii2'));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'pii2:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
const BCRYPT_2Y = '$2y$10$abcdefghijklmnopqrstuuJ3kG1b4m8lX1yVJ9c0dQ5QqvQvE2pXu';
/** Nepali text as it looks after a UTF-8 → Latin-1 double encoding. */
const mojibake = s => Buffer.from(s, 'utf8').toString('latin1');

/** Parse the CREATE TABLE statements: [{ name, create, cols: [{ name, type, generated, autoInc }], uniques: [[col]] }] */
function parseSchema(sql) {
  const out = [];
  for (const m of sql.matchAll(/CREATE TABLE `(\w+)` \(\n([\s\S]*?)\n\) ENGINE[^;]*;/g)) {
    const cols = [], uniques = [];
    for (const line of m[2].split('\n')) {
      const c = line.match(/^\s+`(\w+)` (.+?),?$/);
      if (c) { cols.push({ name: c[1], type: c[2], generated: /GENERATED ALWAYS/i.test(c[2]), autoInc: /AUTO_INCREMENT/i.test(c[2]) }); continue; }
      const u = line.match(/^\s+(?:UNIQUE KEY `\w+`|PRIMARY KEY) \((.+)\)/);
      if (u) uniques.push([...u[1].matchAll(/`(\w+)`/g)].map(x => x[1]));
    }
    out.push({ name: m[1], create: m[0], cols, uniques });
  }
  return out;
}

const q = v => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`);

/** A clean value for a column (row i, 1-based). */
function value(table, col, i, N) {
  const n = col.name, t = col.type.toLowerCase();
  const len = Number((t.match(/^(?:var)?char\((\d+)\)/) || [])[1] || 0);
  const fit = s => { s = String(s); if (!len || s.length <= len) return s; const sfx = '-' + i; return s.slice(0, Math.max(0, len - sfx.length)) + sfx; };
  const en = col.type.match(/^(enum|set)\((.*?)\)/i);
  if (en) return en[2].match(/'([^']*)'/)[1];
  if (n === 'id') return i;
  if (/^(deleted_at|resolved_at|revoked_at|locked_at)$/.test(n)) return null;
  if (/^(tinyint|smallint|mediumint|int|bigint)/.test(t)) {
    if (/_id$|_pk$/.test(n)) return ((i - 1) % N) + 1;
    if (/^(is_|has_|allow_|show_|can_)/.test(n) || /^tinyint\(1\)/.test(t)) return n === 'is_active' ? 1 : i % 2;
    if (n === 'report_month') return i;
    if (/^tinyint/.test(t)) return i;
    return i * 10;
  }
  if (/^(decimal|float|double)/.test(t)) { const [p, s] = (t.match(/\((\d+),(\d+)\)/) || [0, 12, 2]).slice(1).map(Number); return Math.min(i * 10.5, 10 ** (p - s) - 1).toFixed(s); }
  if (/^date\b/.test(t)) return `2024-0${(i % 9) + 1}-1${i % 9}`;
  if (/^(datetime|timestamp)/.test(t)) return `2024-0${(i % 9) + 1}-1${i % 9} 10:0${i % 9}:00`;
  if (/^time/.test(t)) return '10:30:00';
  if (/^year/.test(t)) return 2024;
  if (/blob|binary/.test(t)) return null;
  if (/text/.test(t)) return /json/.test(n) ? `{"row":${i}}` : /(values|details|payload|permissions)$/.test(n) ? `{"row":${i}}` : `नमूना पाठ ${table} ${i}`;
  // varchar / char
  if (n === 'sadasyata_number' || n === 'member_card_no') return fit(`M-${String(i).padStart(4, '0')}`);
  if (/email/.test(n)) return fit(`u${i}.${table.slice(0, 8)}@example.np`);
  if (/phone|mobile/.test(n)) return fit(`98000${String(i).padStart(5, '0')}`);
  if (n === 'fiscal_year') return fit(`20${80 + i}/${81 + i}`);
  if (/status$/.test(n)) return 'pending';
  if (/date/.test(n)) return fit(`2024-01-1${i % 9}`);
  if (n === 'role') return 'admin';
  if (n === 'icon') return 'fas fa-star';
  if (/password|hash/.test(n)) return BCRYPT_2Y;
  if (/(url|link)$/.test(n)) return fit(`https://example.np/${table}/${i}`);
  if (/_np$/.test(n)) return fit(`नमूना ${i}`);
  return fit(`${n}-${table}-${i}`);
}

/**
 * @param {object} o { rowsPerTable }
 */
function buildLegacyDump({ rowsPerTable = 3 } = {}) {
  const N = rowsPerTable;
  const tables = parseSchema(SCHEMA);
  const byName = Object.fromEntries(tables.map(t => [t.name, t]));
  const rows = {}; // table → [{col: value}]
  const extraCols = {}; // table → [[name, type]] columns of older installs / the cooperative's own

  // older installs and a cooperative's own additions
  extraCols.admin_users = [['name', 'varchar(100) DEFAULT NULL']];
  extraCols.members = [['full_name', 'varchar(255) DEFAULT NULL'], ['member_id', 'varchar(50) DEFAULT NULL']];
  extraCols.careers = [['status', "varchar(20) DEFAULT 'active'"]];
  extraCols.services = [['is_new', 'tinyint(1) DEFAULT 0'], ['new_until', 'date DEFAULT NULL']];
  extraCols.news = [['legacy_views', 'int(11) DEFAULT 0']];

  for (const t of tables) {
    if (t.name === 'schema_migrations') { rows[t.name] = [{ version: 'v13-drop-redundant-indexes-2026', description: 'php ledger' }]; continue; }
    rows[t.name] = [];
    for (let i = 1; i <= N; i++) {
      const r = {};
      for (const c of t.cols) if (!c.generated) r[c.name] = value(t.name, c, i, N);
      rows[t.name].push(r);
    }
  }
  const tableRows = name => rows[name];
  const add = (name, r) => { const i = rows[name].length + 1; const base = {}; for (const c of byName[name].cols) if (!c.generated) base[c.name] = value(name, c, i, N); rows[name].push({ ...base, ...r }); return r; };
  const nextId = name => Math.max(0, ...rows[name].map(r => Number(r.id) || 0)) + 1;
  const cases = {};

  // ---- members: duplicate numbers, Devanagari digits, zero/BS dates, mojibake, legacy name columns, $2y$, dangling KYM link
  for (const r of tableRows('members')) { r.full_name = null; r.member_id = null; r.kyc_application_id = r.id; r.approval_status = 'approved'; r.password_hash = BCRYPT_2Y; }
  const dupA = add('members', { id: nextId('members'), name: 'Dup One', name_np: 'दोहोरो एक', sadasyata_number: 'M-DUP', phone: '9811111111', approval_status: 'Approved ', is_active: 1, created_at: '0000-00-00 00:00:00', membership_date: '2080-04-15', twofa_enabled: null });
  const dupB = add('members', { id: nextId('members'), name: 'Dup Two', name_np: mojibake('दोहोरो दुई'), sadasyata_number: ' m-dup ', phone: '9811111112', approval_status: 'approve', is_active: 1, kyc_application_id: 9999, created_at: '2024-13-45 25:00:00' });
  const legacyNamed = add('members', { id: nextId('members'), name: '', full_name: 'Legacy Fullname', member_id: 'M-LEGACY', sadasyata_number: '', name_np: 'पुरानो', approval_status: 'APPROVED', is_active: 1, password_hash: BCRYPT_2Y, kyc_application_id: null });
  const devDigits = add('members', { id: nextId('members'), name: 'Devanagari Number', name_np: 'देवनागरी', sadasyata_number: 'M-००४२', approval_status: 'pending', is_active: 1, membership_date: '२०८०-०१-०१', kyc_application_id: null });
  cases.members = { dupA: dupA.id, dupB: dupB.id, legacyNamed: legacyNamed.id, devDigits: devDigits.id };

  // ---- KYM: invalid enum '' (non-strict MySQL), pii1/pii2 citizenship numbers, BS date of birth, link by member number
  for (const r of tableRows('kyc_applications')) { r.member_id = `M-${String(r.id).padStart(4, '0')}`; r.citizenship_no = PII1; }
  const kymBlank = add('kyc_applications', { id: nextId('kyc_applications'), member_id: 'M-LEGACY', full_name: 'Legacy Fullname', status: '', citizenship_no: pii2('27-01-123456'), dob_ad: '2024-02-30', mobile: '9822222222', tracking_id: 'KYC-LEGACY-1', aml_details_json: 'a:1:{s:3:"pep";s:2:"no";}' });
  const kymLink = add('kyc_applications', { id: nextId('kyc_applications'), member_id: 'M-००४२', full_name: 'Devanagari Number', status: 'Approved', citizenship_no: '11-22-33', tracking_id: 'KYC-DEV-1', dob_ad: '2050-01-15' });
  cases.kyc = { blank: kymBlank.id, link: kymLink.id, pii2Plain: '27-01-123456' };
  for (const name of ['account_applications', 'loan_applications', 'membership_applications', 'member_import_rows']) if (rows[name]) for (const r of rows[name]) if ('citizenship_no' in r) r.citizenship_no = pii2('99-88-' + r.id);

  // ---- notices: BS / zero / impossible dates, mojibake title, Font Awesome attachment icon stays
  const nBs = add('notices', { id: nextId('notices'), title: 'BS dated', title_np: 'बि.सं. मिति', notice_date: '2080-05-01', is_active: 1 });
  const nZero = add('notices', { id: nextId('notices'), title: 'Zero dated', title_np: mojibake('शून्य मिति'), notice_date: '0000-00-00', is_active: 1 });
  const nBad = add('notices', { id: nextId('notices'), title: 'Impossible date', title_np: 'असम्भव', notice_date: '2024-02-30', is_active: 1 });
  cases.notices = { bs: nBs.id, zero: nZero.id, bad: nBad.id };

  // ---- values longer than the old platform columns (appointments.name 100, preferred_time 20; gallery.media_type 10)
  const longAppt = add('appointments', { id: nextId('appointments'), name: 'क'.repeat(150), phone: '9833333333', preferred_date: '2081-01-10', preferred_time: '10:00 AM - 11:30 AM (morning)', branch: 'शाखा '.repeat(30), status: 'Confirmed', tracking_id: 'APT-LONG-1' });
  const vid = add('gallery', { id: nextId('gallery'), title: 'Video', media_type: 'video_embed', album_id: 777, image: 'gallery/v.jpg', is_active: 1 });
  cases.appointments = { long: longAppt.id };
  const oldPhoto = add('gallery', { id: nextId('gallery'), title: 'Old photo', album: 'पुरानो एल्बम', album_id: null, media_type: 'photo', image: 'gallery/p.jpg', is_active: 1 });
  cases.gallery = { video: vid.id, oldPhoto: oldPhoto.id };

  // ---- institutional profile: two rows for the same year/month; net_profit of older installs
  const ip = tableRows('institutional_profile')[0];
  ip.profit_loss = '0.00'; ip.net_profit = '555000.00';
  const ipDup = add('institutional_profile', { id: nextId('institutional_profile'), fiscal_year: ip.fiscal_year, report_month: ip.report_month, total_members: 99, is_active: 1, profit_loss: '1.00', net_profit: '2.00' });
  cases.institutional_profile = { netProfit: ip.id, dup: ipDup.id };

  // ---- admins: legacy role names, older name column
  const a1 = tableRows('admin_users')[0];
  a1.role = 'super_admin'; a1.full_name = ''; a1.name = 'पुरानो नाम'; a1.username = 'oldsuper'; a1.custom_role_id = 4242;
  cases.admin_users = { legacy: a1.id };

  // ---- careers / services / feedback / welfare: older columns and statuses
  tableRows('careers')[0].status = 'closed';
  const svc = tableRows('services')[0]; svc.is_new = 1; svc.new_until = '2081-01-01'; svc.icon = 'fas fa-piggy-bank';
  tableRows('member_feedback')[0].admin_attachment = 'office-replies/reply-1.pdf';
  tableRows('member_welfare_claims')[0].status = 'Paid';
  tableRows('member_welfare_claims')[1].status = 'Done';
  tableRows('news')[0].legacy_views = 1234;
  cases.services = { svc: svc.id };
  // a card locked by failed verifications (PHP: status 'locked'; the platform: locked_at)
  const card = tableRows('member_id_cards')[0];
  card.status = 'locked'; card.locked_at = '2024-05-01 09:00:00'; card.failed_verify_count = 5;
  cases.cards = { locked: card.id };

  // ---- duplicate tracking id (MyISAM-era data); a duplicate primary key (cannot be repaired → quarantine)
  const lt = tableRows('loan_applications')[0];
  const ltDup = add('loan_applications', { ...lt, id: nextId('loan_applications'), status: 'In Progress', documents: 'loan/a.pdf, loan/b.pdf', _own: true });
  const faqDup = add('faqs', { ...tableRows('faqs')[0], question: 'Duplicate id row', question_np: 'दोहोरो आईडी', _own: true });
  cases.loan = { dupTracking: ltDup.id, tracking: lt.tracking_id };
  cases.faqs = { dupId: faqDup.id };

  // ---- text in JSON columns, BS date in a VARCHAR that became DATE, invalid values
  // (MariaDB's JSON check refuses these; older MySQL kept them — separate INSERTs, like the duplicates above)
  const auditSer = add('audit_log', { ...tableRows('audit_log')[0], id: nextId('audit_log'), old_values: 'a:2:{s:6:"status";s:7:"pending";}', _own: true });
  add('admin_activity_log', { ...tableRows('admin_activity_log')[0], id: nextId('admin_activity_log'), details: '', _own: true });
  cases.audit = { serialized: auditSer.id };
  const mir = tableRows('member_import_rows');
  mir[0].membership_date = '2079-10-10'; mir[1].membership_date = 'N/A';

  // ---- legacy settings, help topics, icons
  for (const [k, v] of [['ai_chat_enabled', '1'], ['site_slogan', 'पुरानो नारा'], ['google_map_url', 'https://maps.google.com/?q=27.7,85.3'], ['notify_email_loan_application', '1']]) {
    add('site_settings', { id: nextId('site_settings'), setting_key: k, setting_value: v, setting_type: 'text', setting_group: 'general' });
  }
  tableRows('help_topics')[0].content_np = 'सहायता उत्तर'; tableRows('help_topics')[0].title_np = 'सहायता प्रश्न';

  // ---- retired HRM tables and a cooperative's own table: no platform equivalent → legacy archive
  const extraCreates = [
    'CREATE TABLE `hrm_employees` (\n  `id` int(11) NOT NULL AUTO_INCREMENT,\n  `full_name` varchar(150) NOT NULL,\n  `designation` varchar(100) DEFAULT NULL,\n  `join_date` date DEFAULT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    'CREATE TABLE `hrm_internal_messages` (\n  `id` int(11) NOT NULL AUTO_INCREMENT,\n  `subject` varchar(200) DEFAULT NULL,\n  `body` text,\n  `created_at` timestamp NULL DEFAULT current_timestamp(),\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
    'CREATE TABLE `coop_sms_log` (\n  `id` int(11) NOT NULL AUTO_INCREMENT,\n  `mobile` varchar(20) DEFAULT NULL,\n  `message` text,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  ];
  rows.hrm_employees = [{ id: 1, full_name: 'कर्मचारी एक', designation: 'Manager', join_date: '2075-04-01' }, { id: 2, full_name: 'कर्मचारी दुई', designation: 'Clerk', join_date: '0000-00-00' }];
  rows.hrm_internal_messages = [{ id: 1, subject: 'Chat', body: 'नमस्ते', created_at: '2024-01-01 10:00:00' }];
  rows.coop_sms_log = [{ id: 1, mobile: '9800000001', message: 'SMS पठाइयो' }];

  // ---- write the dump
  let sql = '-- phpMyAdmin SQL Dump\n-- version 5.2.1\n-- Server version: 10.6.18-MariaDB\n\n/*!40101 SET NAMES utf8mb4 */;\nSET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";\nSET FOREIGN_KEY_CHECKS = 0;\nSET time_zone = "+00:00";\n\n';
  const counts = {};
  const emit = (name, create, cols) => {
    sql += `-- --------------------------------------------------------\n-- Table structure for table \`${name}\`\n\n${create}\n\n`;
    const list = rows[name] || [];
    counts[name] = list.length;
    if (!list.length) return;
    const names = cols.filter(c => !c.generated).map(c => c.name);
    const head = `INSERT INTO \`${name}\` (${names.map(c => '`' + c + '`').join(', ')}) VALUES\n`;
    const tuple = r => '(' + names.map(c => q(r[c])).join(', ') + ')';
    const bulk = list.filter(r => !r._own), own = list.filter(r => r._own);
    if (bulk.length) sql += `${head}${bulk.map(tuple).join(',\n')};\n\n`;
    for (const r of own) sql += `${head}${tuple(r)};\n\n`;
  };
  for (const t of tables) {
    let create = t.create;
    const cols = t.cols.slice();
    for (const [c, ty] of extraCols[t.name] || []) {
      if (cols.some(x => x.name === c)) continue;
      create = create.replace(/\n\) ENGINE/, `,\n  \`${c}\` ${ty}\n) ENGINE`);
      cols.push({ name: c, type: ty });
    }
    // the dirty rows above are what a non-strict MySQL holds; the dump must still be valid SQL for a MySQL server
    emit(t.name, create, cols);
  }
  for (const c of extraCreates) {
    const name = c.match(/`(\w+)`/)[1];
    emit(name, c, [...c.matchAll(/^\s+`(\w+)`/gm)].map(m => ({ name: m[1] })));
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { sql, rows: counts, total, cases, piiKey: PII_KEY, tables: tables.map(t => t.name) };
}

module.exports = { buildLegacyDump, parseSchema, PII_KEY, BCRYPT_2Y, mojibake };
