'use strict';
/**
 * PHP site → new platform migration (one tenant).
 * Steps: source → preflight → plan → import → files → privatise → credentials → verify → report.
 * Used by scripts/migrate-site.js (and the older scripts/import-from-mysql.js).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const tenants = require('./tenants');
const modules = require('../modules/applications');
const { resources } = require('../modules/resources');

// ---------------------------------------------------------------- source discovery
/** Read DB credentials, uploads dir and vault key from an old PHP site folder (public_html). */
function readPhpSite(root) {
  const r = path.resolve(root);
  const out = { root: r, mysqlUrl: null, uploads: null, credKey: null, piiKey: null, siteUrl: null, notes: [] };
  const candidates = ['includes/database.local.php', 'includes/database.php', 'includes/config.local.php'].map(f => path.join(r, f)).filter(f => fs.existsSync(f));
  for (const f of candidates) {
    const src = fs.readFileSync(f, 'utf8');
    const get = k => { const m = src.match(new RegExp(`define\\(\\s*['"]${k}['"]\\s*,\\s*(['"])((?:\\\\.|(?!\\1).)*)\\1`)); return m ? m[2].replace(/\\(['"\\])/g, '$1') : null; };
    const host = get('DB_HOST'), name = get('DB_NAME'), user = get('DB_USER'), pass = get('DB_PASS');
    if (name && user) {
      const [h, port] = String(host || 'localhost').split(':');
      out.mysqlUrl = `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass || '')}@${h || 'localhost'}:${port || 3306}/${encodeURIComponent(name)}`;
      out.siteUrl = get('SITE_URL');
      if (get('PII_ENC_KEY')) out.piiKey = get('PII_ENC_KEY').trim();
      out.notes.push(`database settings read from ${path.relative(r, f)}`);
      break;
    }
  }
  if (!out.mysqlUrl) out.notes.push('no database.local.php with DB_NAME/DB_USER found — pass --mysql=');
  const up = path.join(r, 'assets/uploads');
  if (fs.existsSync(up)) out.uploads = up; else out.notes.push('assets/uploads not found — pass --uploads=');
  const keyFile = path.join(r, 'includes/.cred-master.key');
  if (fs.existsSync(keyFile)) out.credKey = fs.readFileSync(keyFile, 'utf8').trim();
  // PHP includes/pii-crypto.php: PII_ENC_KEY (64 hex) in database.local.php, else includes/.pii-master.key
  const piiFile = path.join(r, 'includes/.pii-master.key');
  if (!out.piiKey && fs.existsSync(piiFile)) out.piiKey = fs.readFileSync(piiFile, 'utf8').trim();
  if (out.piiKey && !/^[0-9a-f]{64}$/i.test(out.piiKey)) { out.notes.push('PII key found but it is not 64 hex characters — ignored'); out.piiKey = null; }
  return out;
}

const redact = url => String(url || '').replace(/\/\/([^:@/]+):([^@]*)@/, '//$1:***@');

// ---------------------------------------------------------------- helpers
function fixValue(v, pgType) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && /^0000-00-00/.test(v)) return null;
  if (Buffer.isBuffer(v)) return pgType === 'bytea' ? v : v.toString('utf8');
  if (pgType === 'jsonb' && typeof v === 'object') return JSON.stringify(v);
  if (pgType === 'jsonb' && typeof v === 'string') { try { JSON.parse(v); return v; } catch { return JSON.stringify(v); } }
  if (typeof v === 'string') return v.replace(/\u0000/g, '');
  return v;
}

const SKIP_FILE = /\.(php\d?|phtml|phar|htaccess|html?|js|cgi|pl|py|sh|exe|bat)$/i;
function walk(dir, fn, rel = '') {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(p, fn, r); else if (e.isFile()) fn(p, r);
  }
}
function dirStats(dir) {
  let files = 0, bytes = 0, skipped = 0;
  walk(dir, (p, r) => { if (SKIP_FILE.test(r)) { skipped++; return; } files++; bytes += fs.statSync(p).size; });
  return { files, bytes, skipped };
}
const mb = n => (n / 1e6).toFixed(1) + ' MB';
const MOJIBAKE = /à¤|à¥|Ã¤|Ã¥|â€/;

/** File-path columns the app knows about: table -> [{ col, private }] */
function fileColumns() {
  const map = {};
  const add = (table, col, priv) => { (map[table] = map[table] || []).push({ col, private: priv }); };
  for (const m of Object.values(modules)) for (const f of m.fileFields) add(m.table, f.name, true);
  for (const r of Object.values(resources)) for (const f of r.fileFields) add(r.table, f.name, !!r.privateFiles);
  add('members', 'avatar_url', false);
  return map;
}

// ---------------------------------------------------------------- sources
/**
 * Where the old data comes from. Two kinds share one small interface:
 *   mysqlSource(url)  — a live MySQL / MariaDB server (CLI, or the old host if it allows remote access)
 *   dumpSource(...)   — a .sql dump file (src/lib/sql-dump.js): no MySQL needed, e.g. on Yeti Cloud
 * Interface: label, info(), tables(), count(t), columns(t), rows(t, cols, offset, limit), sample(t, col, limit), end()
 */
async function mysqlSource(url) {
  let mysql;
  try { mysql = require('mysql2/promise'); } catch { throw new Error('mysql2 is not installed: npm install mysql2 (or upload an SQL dump instead)'); }
  const my = await mysql.createConnection({ uri: url, dateStrings: true, supportBigNumbers: true, bigNumberStrings: false, charset: 'utf8mb4', connectTimeout: 15_000 });
  const q = name => '`' + String(name).replace(/`/g, '``') + '`';
  return {
    label: redact(url),
    async info() { const [[v]] = await my.query('SELECT VERSION() AS v, @@character_set_database AS cs'); return { version: v.v, charset: v.cs }; },
    async tables() { const [tr] = await my.query('SHOW TABLES'); return tr.map(r => Object.values(r)[0]); },
    async count(t) { const [[{ n }]] = await my.query(`SELECT COUNT(*) AS n FROM ${q(t)}`); return Number(n); },
    async columns(t) { const [mc] = await my.query(`SHOW COLUMNS FROM ${q(t)}`); return mc.map(c => c.Field); },
    async rows(t, cols, offset, limit) {
      const [rows] = await my.query(`SELECT ${cols.map(q).join(', ')} FROM ${q(t)} ${cols.includes('id') ? 'ORDER BY id' : ''} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`);
      return rows;
    },
    async sample(t, c, limit) {
      const [rows] = await my.query(`SELECT ${q(c)} AS v FROM ${q(t)} WHERE ${q(c)} IS NOT NULL AND ${q(c)} <> '' LIMIT ${Number(limit)}`).catch(() => [[]]);
      return rows.map(r => r.v);
    },
    end: () => my.end(),
  };
}

// ---------------------------------------------------------------- main
/**
 * @param {object} o  { tenant, source | mysqlUrl, uploads, credKey, piiKey, dryRun, mode: 'fresh'|'incremental', log }
 * @returns report object
 */
async function migrate(o) {
  const log = o.log || (() => {});
  const report = { tenant: o.tenant, started_at: new Date().toISOString(), dry_run: !!o.dryRun, mode: o.mode || 'fresh', source: o.source ? o.source.label : redact(o.mysqlUrl), steps: [], tables: [], warnings: [], errors: [], files: {}, verify: {} };
  const step = (name, status, detail = '') => { report.steps.push({ name, status, detail }); log(`${status === 'ok' ? '✓' : status === 'warn' ? '!' : status === 'skip' ? '·' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
  const warn = w => { report.warnings.push(w); log('  ! ' + w); };

  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [o.tenant]);
  if (!tenant) throw new Error(`Tenant "${o.tenant}" does not exist (use --create)`);
  report.schema = tenant.schema_name;

  // ---- preflight
  const src = o.source || await mysqlSource(o.mysqlUrl);
  try {
    const ver = await src.info();
    step(o.source ? 'read SQL dump' : 'connect to MySQL', 'ok', `${ver.version}, charset ${ver.charset}`);
    if (!/utf8/.test(ver.charset)) warn(`database charset is ${ver.charset}; Nepali text may need conversion`);
    const myTables = await src.tables();
    const pgTables = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [tenant.schema_name])).map(r => r.table_name));

    // mojibake check on a few text columns
    for (const [t, c] of [['members', 'name_np'], ['notices', 'title_np'], ['site_settings', 'setting_value']]) {
      if (!myTables.includes(t)) continue;
      const rows = await src.sample(t, c, 200);
      const bad = rows.filter(v => MOJIBAKE.test(String(v))).length;
      if (bad) warn(`${t}.${c}: ${bad} of ${rows.length} sampled values look double-encoded (e.g. "à¤…") — fix the source charset before migrating`);
    }

    // ---- plan
    for (const t of myTables) {
      const n = await src.count(t);
      const entry = { table: t, source_rows: Number(n), target_rows: null, copied: 0, skipped: 0, dropped_columns: [], status: '' };
      if (!pgTables.has(t) || t === 'schema_migrations') { entry.status = 'not in new schema'; if (Number(n)) warn(`table ${t} (${n} rows) has no equivalent and is not migrated`); report.tables.push(entry); continue; }
      const pgCols = await db.withSchema(tenant.schema_name, () => db.columns(t));
      const mc = await src.columns(t);
      entry.columns = mc.filter(c => pgCols.has(c));
      entry.dropped_columns = mc.filter(c => !pgCols.has(c));
      entry.status = Number(n) ? 'planned' : 'empty';
      report.tables.push(entry);
    }
    const planned = report.tables.filter(t => t.status === 'planned');
    step('plan', 'ok', `${planned.length} tables / ${planned.reduce((a, t) => a + t.source_rows, 0)} rows to copy`);
    for (const t of planned) if (t.dropped_columns.length) warn(`${t.table}: columns not carried over: ${t.dropped_columns.join(', ')}`);

    if (o.uploads) {
      const s = dirStats(o.uploads);
      report.files.source = s;
      step('uploads found', 'ok', `${s.files} files, ${mb(s.bytes)}${s.skipped ? `, ${s.skipped} executable/html files will be skipped` : ''}`);
      try {
        const sf = fs.statfsSync(config.uploadDir);
        if (sf.bavail * sf.bsize < s.bytes * 1.2) warn(`low disk space for uploads: ${mb(sf.bavail * sf.bsize)} free, ${mb(s.bytes)} needed`);
      } catch { /* statfs unsupported */ }
    } else step('uploads', 'skip', 'no uploads folder given');

    if (o.dryRun) {
      step('dry run', 'ok', 'nothing was written');
      return finish(report);
    }

    // ---- import
    const t0 = Date.now();
    await db.withSchema(tenant.schema_name, async () => {
      for (const entry of planned) {
        const pgCols = await db.columns(entry.table);
        const cols = entry.columns;
        if (report.mode === 'fresh') await db.query(`TRUNCATE ${db.ident(entry.table)} RESTART IDENTITY CASCADE`);
        const hasId = cols.includes('id');
        const BATCH = 500;
        let offset = 0;
        for (;;) {
          const rows = await src.rows(entry.table, cols, offset, BATCH);
          if (!rows.length) break;
          offset += rows.length;
          await db.transaction(async () => {
            const sql = `INSERT INTO ${db.ident(entry.table)} (${cols.map(db.ident).join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING`;
            for (const row of rows) {
              await db.query('SAVEPOINT r');
              try {
                // values a dump left out (undefined) take the column default, like MySQL did
                const given = cols.filter(c => row[c] !== undefined);
                const res = given.length === cols.length
                  ? await db.query(sql, cols.map(c => fixValue(row[c], pgCols.get(c))))
                  : await db.query(`INSERT INTO ${db.ident(entry.table)} (${given.map(db.ident).join(', ')}) VALUES (${given.map((_, i) => '$' + (i + 1)).join(', ')}) ON CONFLICT DO NOTHING`, given.map(c => fixValue(row[c], pgCols.get(c))));
                if (res.rowCount) entry.copied++; else entry.skipped++;
                await db.query('RELEASE SAVEPOINT r');
              } catch (e) {
                await db.query('ROLLBACK TO SAVEPOINT r');
                entry.skipped++;
                if (entry.skipped <= 3) report.errors.push(`${entry.table} id=${row.id ?? '?'}: ${e.message}`);
              }
            }
          });
        }
        if (hasId) {
          await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${db.ident(entry.table)}), 1), (SELECT COUNT(*) > 0 FROM ${db.ident(entry.table)}))`, [tenant.schema_name + '.' + entry.table]).catch(() => {});
        }
        entry.status = 'copied';
        log(`    ${entry.table}: ${entry.copied}/${entry.source_rows}${entry.skipped ? ` (${entry.skipped} skipped)` : ''}`);
      }
      // members.updated_at for the API change feed
      await db.query('UPDATE members SET updated_at = COALESCE(updated_at, created_at, now())').catch(() => {});
    });
    step('import data', report.errors.length ? 'warn' : 'ok', `${planned.reduce((a, t) => a + t.copied, 0)} rows in ${Math.round((Date.now() - t0) / 1000)} s`);
  } finally { await src.end(); }

  // ---- files
  const dest = path.join(config.uploadDir, tenant.slug);
  if (o.uploads) {
    let copied = 0, skipped = 0;
    walk(o.uploads, (p, r) => {
      if (SKIP_FILE.test(r)) { skipped++; return; }
      const d = path.join(dest, r);
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(p, d);
      copied++;
    });
    report.files.copied = copied;
    step('copy uploads', 'ok', `${copied} files${skipped ? `, ${skipped} unsafe files skipped` : ''}`);
  }

  // ---- privatise confidential files (application documents, information room)
  await db.withSchema(tenant.schema_name, async () => {
    const cols = fileColumns();
    let moved = 0, missing = 0;
    const missingList = [];
    for (const [table, list] of Object.entries(cols)) {
      const tcols = await db.columns(table);
      for (const { col, private: priv } of list) {
        if (!tcols.has(col)) continue;
        const rows = await db.many(`SELECT id, ${db.ident(col)} AS v FROM ${db.ident(table)} WHERE ${db.ident(col)} IS NOT NULL AND ${db.ident(col)} <> ''`);
        for (const r of rows) {
          if (/^https?:\/\//i.test(r.v)) continue;
          const rel = String(r.v).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
          const abs = path.resolve(dest, rel);
          if (!abs.startsWith(path.resolve(dest) + path.sep)) continue;
          if (!fs.existsSync(abs)) { missing++; if (missingList.length < 50) missingList.push(`${table}.${col} #${r.id}: ${r.v}`); continue; }
          if (priv && !rel.startsWith('_private/')) {
            const target = path.join(dest, '_private', rel);
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.renameSync(abs, target);
            await db.query(`UPDATE ${db.ident(table)} SET ${db.ident(col)} = $1 WHERE id = $2`, ['_private/' + rel, r.id]);
            moved++;
          }
        }
      }
    }
    report.files.privatised = moved;
    report.files.missing = missing;
    report.files.missing_examples = missingList;
    step('protect confidential files', 'ok', `${moved} application / information-room files moved to private storage`);
    if (missing) warn(`${missing} database rows point to files that are not in the uploads folder (see report)`);
  });

  // ---- office credentials: re-encrypt PHP AES-CBC → AES-GCM
  await db.withSchema(tenant.schema_name, async () => {
    const rows = await db.many("SELECT id, password_enc, password_iv FROM office_credentials WHERE password_tag IS NULL AND password_enc <> ''");
    if (!rows.length) return step('office credentials', 'skip', 'none to convert');
    const vault = require('./credentials-crypto');
    if (!o.credKey || !vault.enabled()) {
      return warn(`${rows.length} office credentials keep the old encryption — set CREDENTIALS_KEY and pass the PHP includes/.cred-master.key (or --php-root) to convert them`);
    }
    const key = crypto.createHash('sha256').update(o.credKey).digest();
    let ok = 0, bad = 0;
    for (const r of rows) {
      try {
        const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(r.password_iv, 'hex'));
        const plain = Buffer.concat([d.update(Buffer.from(r.password_enc, 'base64')), d.final()]).toString('utf8');
        await db.update('office_credentials', r.id, vault.encrypt(plain));
        ok++;
      } catch { bad++; }
    }
    step('office credentials', bad ? 'warn' : 'ok', `${ok} re-encrypted${bad ? `, ${bad} could not be decrypted` : ''}`);
  });

  // ---- PII (citizenship numbers): PHP pii1:/pii2: → decrypt with the old key → new pii3: format
  await db.withSchema(tenant.schema_name, () => convertPii(o.piiKey, step, warn));

  // ---- verify
  await db.withSchema(tenant.schema_name, async () => {
    for (const t of report.tables.filter(x => x.status === 'copied')) {
      t.target_rows = await db.value(`SELECT count(*) FROM ${db.ident(t.table)}`);
      if (report.mode === 'fresh' && t.target_rows < t.source_rows) warn(`${t.table}: ${t.target_rows} rows in the new system vs ${t.source_rows} in the old`);
    }
    const v = report.verify;
    v.admins_active = await db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL AND is_active = 1');
    v.members = await db.value('SELECT count(*) FROM members WHERE deleted_at IS NULL');
    v.members_with_password = await db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND password_hash LIKE '$2%'");
    v.notices = await db.value('SELECT count(*) FROM notices WHERE deleted_at IS NULL');
    v.settings = await db.value('SELECT count(*) FROM site_settings');
    v.site_name = await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'site_name'");
    if (!v.admins_active) warn(`no active admin — create one: npm run tenant:admin -- --tenant=${tenant.slug} --username=admin --password=…`);
    const mismatched = report.tables.filter(t => t.status === 'copied' && t.target_rows < t.source_rows).length;
    step('verify', mismatched || report.errors.length ? 'warn' : 'ok', `${v.members} members (${v.members_with_password} can log in with their old password), ${v.admins_active} admins, ${v.notices} notices`);
  });
  await tenants.migrateTenant(tenant); // re-run app migrations (triggers, new columns) on the imported data
  tenants.clearCache();
  return finish(report);
}

function finish(report) {
  report.finished_at = new Date().toISOString();
  report.ok = !report.steps.some(s => s.status === 'fail') && !report.errors.length;
  return report;
}

/** Self-contained HTML report (no external assets). */
function htmlReport(r) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = s => ({ ok: '✓', warn: '!', skip: '·', fail: '✗' }[s] || s);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Migration report — ${esc(r.tenant)}</title>
<style>body{font:15px/1.55 system-ui,'Noto Sans Devanagari',sans-serif;margin:0;background:#fafaf9;color:#1c1f23}main{max-width:1000px;margin:0 auto;padding:24px 16px}
h1{font-weight:600;margin:0 0 4px}.muted{color:#5f6670}.card{background:#fff;border:1px solid #e6e6e3;border-radius:12px;padding:16px 20px;margin:16px 0}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{padding:7px 10px;border-bottom:1px solid #eee;text-align:left}th{color:#5f6670;font-weight:500}.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:#15803d}.warn{color:#b45309}.fail{color:#b91c1c}.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:#f4f4f3}
@media(prefers-color-scheme:dark){body{background:#111315;color:#e8e9ea}.card{background:#181b1e;border-color:#2a2f33}th,td{border-color:#2a2f33}.badge{background:#1f2326}}</style></head>
<body><main><h1>Migration report: ${esc(r.tenant)}</h1>
<div class="muted">${r.dry_run ? '<b>Dry run</b> — nothing was written · ' : ''}mode ${esc(r.mode)} · source ${esc(r.source)} · ${esc(r.started_at)} → ${esc(r.finished_at)}</div>
<div class="card"><h2>Steps</h2><table>${r.steps.map(s => `<tr><td class="${s.status}">${icon(s.status)}</td><td>${esc(s.name)}</td><td class="muted">${esc(s.detail)}</td></tr>`).join('')}</table></div>
${r.warnings.length ? `<div class="card"><h2 class="warn">Warnings (${r.warnings.length})</h2><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
${r.errors.length ? `<div class="card"><h2 class="fail">Row errors (first per table)</h2><ul>${r.errors.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
<div class="card"><h2>Tables</h2><table><tr><th>Table</th><th class="num">Old</th><th class="num">New</th><th class="num">Copied</th><th>Status</th><th>Columns not carried over</th></tr>
${r.tables.filter(t => t.source_rows || t.status === 'copied').map(t => `<tr><td>${esc(t.table)}</td><td class="num">${t.source_rows}</td><td class="num">${t.target_rows ?? '—'}</td><td class="num">${t.copied || ''}</td><td><span class="badge">${esc(t.status)}</span></td><td class="muted">${esc((t.dropped_columns || []).join(', '))}</td></tr>`).join('')}</table></div>
${r.files.missing_examples && r.files.missing_examples.length ? `<div class="card"><h2>Missing files (examples)</h2><ul>${r.files.missing_examples.map(w => `<li><code>${esc(w)}</code></li>`).join('')}</ul></div>` : ''}
${Object.keys(r.verify).length ? `<div class="card"><h2>Checks</h2><table>${Object.entries(r.verify).map(([k, v]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td>${esc(v)}</td></tr>`).join('')}</table></div>` : ''}
</main></body></html>`;
}

/**
 * Re-encrypt PHP-encrypted PII in the current tenant schema. pii1:/pii2: values are decrypted with the
 * old PII_ENC_KEY and written again with the new key (PII_KEY) — or as plain text with a warning when
 * PII_KEY is not set, so the data stays readable. Values that do not decrypt are left untouched.
 */
async function convertPii(oldKey, step = () => {}, warn = () => {}) {
  const pii = require('./pii-crypto');
  const schema = db.currentSchema();
  let ok = 0, bad = 0, found = 0;
  for (const [table, cols] of Object.entries(pii.PII_COLUMNS)) {
    const tcols = await db.columns(table);
    for (const col of cols) {
      if (!tcols.has(col)) continue;
      // prefixed so the transparent decrypt in db.query leaves the raw value alone
      const rows = await db.many(`SELECT id, 'raw:' || ${db.ident(col)} AS v FROM ${db.ident(table)} WHERE ${db.ident(col)} LIKE 'pii1:%' OR ${db.ident(col)} LIKE 'pii2:%'`);
      found += rows.length;
      if (!rows.length || !oldKey) continue;
      for (const r of rows) {
        const enc = r.v.slice(4);
        const plain = pii.decryptLegacy(enc, oldKey);
        if (plain === enc) { bad++; continue; }
        await db.query(`UPDATE ${db.ident(table)} SET ${db.ident(col)} = $1 WHERE id = $2`, [pii.encrypt(plain, schema), r.id]);
        ok++;
      }
    }
  }
  if (!found) { step('PII (citizenship no.)', 'skip', 'no encrypted values in the old data'); return { ok, bad, found }; }
  if (!oldKey) { warn(`${found} citizenship numbers are encrypted with the old PHP key — pass --pii-key (PII_ENC_KEY) or --php-root to convert them`); return { ok, bad, found }; }
  if (!pii.enabled()) warn('PII_KEY is not set: converted citizenship numbers were stored as plain text. Set PII_KEY to encrypt them.');
  step('PII (citizenship no.)', bad ? 'warn' : 'ok', `${ok} converted${pii.enabled() ? ' to the new encryption' : ' (plain text)'}${bad ? `, ${bad} could not be decrypted with the old key` : ''}`);
  return { ok, bad, found };
}

module.exports = { readPhpSite, migrate, mysqlSource, htmlReport, fixValue, redact, fileColumns, convertPii };
