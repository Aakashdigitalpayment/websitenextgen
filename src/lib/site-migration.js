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
const legacy = require('./legacy-map');

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
  // Web Push keys of this install (includes/push-vapid.local.php), so member push subscriptions keep working
  const vapidFile = path.join(r, 'includes/push-vapid.local.php');
  if (fs.existsSync(vapidFile)) {
    out.vapid = parseVapid(fs.readFileSync(vapidFile, 'utf8'));
    out.notes.push(out.vapid ? 'Web Push keys read from includes/push-vapid.local.php' : 'includes/push-vapid.local.php found but the keys could not be read');
  }
  return out;
}

/**
 * VAPID pair from the PHP push-vapid.local.php (COOP_VAPID_PUBLIC_KEY + COOP_VAPID_PRIVATE_PEM) → web-push format
 * (base64url public key, base64url 32-byte private key). null unless the private key really belongs to the public key.
 */
function parseVapid(php) {
  try {
    const pub = (String(php).match(/define\(\s*['"]COOP_VAPID_PUBLIC_KEY['"]\s*,\s*['"]([A-Za-z0-9_-]{40,120})['"]/) || [])[1];
    const body = (String(php).match(/define\(\s*['"]COOP_VAPID_PRIVATE_PEM['"]\s*,([\s\S]*?)\);/) || [])[1];
    if (!pub || !body) return null;
    const pem = [...body.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map(m => (m[1] !== undefined ? m[1].replace(/\\n/g, '\n') : m[2])).join('');
    if (!/BEGIN EC PRIVATE KEY|BEGIN PRIVATE KEY/.test(pem)) return null;
    const jwk = crypto.createPrivateKey(pem).export({ format: 'jwk' });
    const derived = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
    return derived === pub ? { publicKey: pub, privateKey: jwk.d } : null;
  } catch { return null; }
}

/**
 * help_topics rows (read by the PHP assistant as context, includes/ai-chat-context.php) become chatbot answers once:
 * question = title (NP / EN), answer = content (NP / EN). Rows already present (same question) are skipped.
 */
async function importHelpTopics() {
  const rows = await db.many("SELECT * FROM help_topics WHERE COALESCE(is_active, 1) = 1 AND COALESCE(content_np, content, '') <> '' ORDER BY display_order, id").catch(() => []);
  let added = 0;
  for (const h of rows) {
    const q = String(h.title_np || h.title || '').slice(0, 255);
    if (!q || await db.value('SELECT 1 FROM chatbot_faqs WHERE question = $1 LIMIT 1', [q])) continue;
    await db.query(`INSERT INTO chatbot_faqs (question, question_en, answer, answer_en, category, display_order, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, 1, now())`,
      [q, h.title ? String(h.title).slice(0, 255) : null, h.content_np || h.content, h.content || null, String(h.category || 'help').slice(0, 50), Number(h.display_order) || 0]);
    added++;
  }
  return added;
}

const redact = url => String(url || '').replace(/\/\/([^:@/]+):([^@]*)@/, '//$1:***@');

// ---------------------------------------------------------------- helpers
const fixValue = legacy.fixValue;

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
  for (const m of Object.values(modules)) {
    for (const f of m.fileFields) add(m.table, f.name, true);
    add(m.table, 'admin_attachment', true); // office replies (admin-applications.js) are confidential too
  }
  for (const r of Object.values(resources)) for (const f of r.fileFields) add(r.table, f.name, !!r.privateFiles);
  add('members', 'avatar_url', false);
  return map;
}

// ---------------------------------------------------------------- PHP-gated folders → private storage (SM-3)
/** Move every file of a gated folder (src) into dst, keeping sub-paths; existing targets are kept. */
function moveTree(src, dst) {
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, e.name), b = path.join(dst, e.name);
    if (e.isSymbolicLink()) { fs.rmSync(a, { force: true }); continue; }
    if (e.isDirectory()) { n += moveTree(a, b); continue; }
    fs.mkdirSync(dst, { recursive: true });
    if (fs.existsSync(b)) fs.rmSync(a, { force: true }); else { fs.renameSync(a, b); n++; }
  }
  fs.rmSync(src, { recursive: true, force: true });
  return n;
}
const sqlRe = s => s.replace(/[-_]/g, m => '\\' + m);
/**
 * The PHP upload gate (includes/upload-gate.php) protected whole folders (KYC, loan, welfare, office replies …).
 * Move each of them wholesale to _private/<folder> — files referenced by any column, comma lists and orphans alike —
 * then point every stored path (single or comma-separated, with or without "assets/uploads/") at the private copy.
 * Also rewrites links to /assets/uploads/ inside rich text to /uploads/ (public folders only).
 * Runs inside the tenant schema; safe to re-run (scripts/privatise-uploads.js for tenants migrated earlier).
 * @returns {Promise<{moved:number, folders:string[], rows:number, html:number}>}
 */
async function protectGatedUploads(dest) {
  const { GATED_FOLDERS } = require('./uploads');
  const out = { moved: 0, folders: [], rows: 0, html: 0 };
  for (const f of GATED_FOLDERS) {
    const dir = path.join(dest, f);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    out.moved += moveTree(dir, path.join(dest, '_private', f));
    out.folders.push(f);
  }
  const alt = GATED_FOLDERS.map(sqlRe).join('|');
  // a value that is only paths: one or more comma-separated tokens without spaces
  const onlyPaths = `^\\s*[^\\s,]+(\\s*,\\s*[^\\s,]+)*\\s*$`;
  const hit = `(^|,)\\s*/?(assets/)?(uploads/)?(${alt})/`;
  const cols = await db.many(`SELECT table_name, column_name FROM information_schema.columns
                              WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying')`);
  const site = String(await require('./settings').get('site_url', '') || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  const host = site ? `(?:https?://(?:www\\.)?${site.replace(/^www\./i, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})?` : '';
  for (const { table_name: t, column_name: c } of cols) {
    if (/^(schema_migrations|audit_log|app_error_log)$/.test(t)) continue;
    const col = db.ident(c), tbl = db.ident(t);
    const r = await db.query(`UPDATE ${tbl} SET ${col} = regexp_replace(${col}, $1, '\\1_private/\\2/', 'gi')
                              WHERE ${col} ~* $2 AND ${col} ~ $3`, [`(^|,)\\s*/?(?:assets/)?(?:uploads/)?(${alt})/`, hit, onlyPaths]).catch(() => ({ rowCount: 0 }));
    out.rows += r.rowCount;
    // rich text: src="/assets/uploads/news/x.jpg" (or the old site's absolute URL) → /uploads/news/x.jpg; gated folders → private route
    const h = await db.query(`UPDATE ${tbl} SET ${col} = regexp_replace(regexp_replace(${col}, $1, '\\1/admin/files/_private/\\2/', 'gi'), $2, '\\1/uploads/', 'gi')
                              WHERE ${col} ~* '(src|href)\\s*=\\s*["'']' AND ${col} ~* 'assets/uploads/'`,
    [`((?:src|href)\\s*=\\s*["'])${host}/?assets/uploads/(${alt})/`, `((?:src|href)\\s*=\\s*["'])${host}/?assets/uploads/`]).catch(() => ({ rowCount: 0 }));
    out.html += h.rowCount;
  }
  return out;
}

/**
 * Move every file referenced by a private file column (application documents, information room, members-only
 * reports and institutional-profile files) into _private/ and update the row; comma lists are handled per path.
 * Runs inside the tenant schema; safe to re-run.
 */
async function privatiseFileColumns(dest) {
  const cols = fileColumns();
  let moved = 0, missing = 0;
  const missingList = [];
  for (const [table, list] of Object.entries(cols)) {
    const tcols = await db.columns(table);
    for (const { col, private: priv } of list) {
      if (!tcols.has(col)) continue;
      const rows = await db.many(`SELECT id, ${db.ident(col)} AS v FROM ${db.ident(table)} WHERE ${db.ident(col)} IS NOT NULL AND ${db.ident(col)} <> ''`);
      for (const r of rows) {
        // single paths and comma-separated lists (loan documents, welfare supporting documents)
        const parts = String(r.v).split(',').map(x => x.trim()).filter(Boolean);
        let changed = false;
        const next = parts.map(v => {
          if (/^https?:\/\//i.test(v)) return v;
          const rel = v.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
          const abs = path.resolve(dest, rel);
          if (!abs.startsWith(path.resolve(dest) + path.sep)) return v;
          if (!fs.existsSync(abs)) { missing++; if (missingList.length < 50) missingList.push(`${table}.${col} #${r.id}: ${v}`); return v; }
          if (!priv || rel.startsWith('_private/')) return v;
          const target = path.join(dest, '_private', rel);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.renameSync(abs, target);
          moved++; changed = true;
          return '_private/' + rel;
        });
        if (changed) await db.query(`UPDATE ${db.ident(table)} SET ${db.ident(col)} = $1 WHERE id = $2`, [next.join(','), r.id]);
      }
    }
  }
  return { moved, missing, missingList };
}

// ---------------------------------------------------------------- sources
/**
 * Where the old data comes from. Two kinds share one small interface:
 *   mysqlSource(url)  — a live MySQL / MariaDB server (CLI, or the old host if it allows remote access)
 *   dumpSource(...)   — a .sql dump file (src/lib/sql-dump.js): no MySQL needed, e.g. on Yeti Cloud
 * Interface: label, info(), tables(), count(t), columns(t), rows(t, cols, offset, limit), sample(t, col, limit), end()
 */
async function mysqlSource(url, driver = null) {
  let mysql;
  if (driver) mysql = driver;
  else try { mysql = require('mysql2/promise'); } catch { throw new Error('mysql2 is not installed: npm install mysql2 (or upload an SQL dump instead)'); }
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
const ROLLBACK = Symbol('dry-run rollback');
const BATCH = 500;
const SQLSTATE_REASON = { 23505: 'duplicate', 23514: 'invalid_value', 23502: 'missing_value', 23503: 'orphan', 22001: 'too_long', '22P02': 'invalid_value', 22007: 'invalid_date', 22008: 'invalid_date', 22003: 'out_of_range' };

/** Platform columns of a table in the current schema: name → { type, max, nullable, hasDefault }. */
async function targetMeta(table) {
  const rows = await db.many(`SELECT column_name, data_type, character_maximum_length, is_nullable, column_default, is_identity, is_generated
                              FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1`, [table]);
  return new Map(rows.filter(r => r.is_generated !== 'ALWAYS').map(r => [r.column_name, {
    type: r.data_type, max: r.character_maximum_length ? Number(r.character_maximum_length) : null,
    nullable: r.is_nullable === 'YES', hasDefault: r.column_default !== null || r.is_identity === 'YES',
  }]));
}
async function primaryKey(table) {
  return (await db.many(`SELECT a.attname FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
                         WHERE i.indisprimary AND t.relname = $1 AND t.relnamespace = current_schema()::regnamespace`, [table])).map(r => r.attname);
}
async function indexColumns(name) {
  return (await db.many(`SELECT a.attname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
                         WHERE c.relname = $1 AND c.relnamespace = current_schema()::regnamespace`, [name])).map(r => r.attname);
}

function newRunId(slug) {
  return `${String(slug || 't').replace(/[^a-z0-9]/g, '').slice(0, 20)}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
}

/** Keep values the platform has no column for (or had to change) — legacy_archive, merged per row. */
async function archiveRow(runId, table, key, kind, data, reason) {
  await db.query(`INSERT INTO legacy_archive (run_id, source_table, source_key, kind, reason, data) VALUES ($1, $2, $3, $4, $5, $6)
                  ON CONFLICT (source_table, source_key, kind) DO UPDATE SET run_id = EXCLUDED.run_id, reason = EXCLUDED.reason,
                    data = CASE WHEN EXCLUDED.kind = 'columns' THEN legacy_archive.data || EXCLUDED.data ELSE EXCLUDED.data END`,
  [runId, table, String(key).slice(0, 191), kind, reason || null, JSON.stringify(data)]);
}

/** A row the platform's rules refuse even after repair: kept whole in import_quarantine. */
async function quarantineRow(runId, entry, key, data, err) {
  const reason = SQLSTATE_REASON[err.code] || 'error';
  await db.query(`INSERT INTO import_quarantine (run_id, source_table, source_key, target_table, reason, error, data) VALUES ($1, $2, $3, $4, $5, $6, $7)
                  ON CONFLICT (source_table, source_key) WHERE resolved_at IS NULL
                  DO UPDATE SET run_id = EXCLUDED.run_id, reason = EXCLUDED.reason, error = EXCLUDED.error, data = EXCLUDED.data, created_at = CURRENT_TIMESTAMP`,
  [runId, entry.table, String(key).slice(0, 191), entry.target, reason, String(err.message || err).slice(0, 2000), JSON.stringify(data)]);
  return reason;
}

/**
 * The repair for a refused insert, or null (→ quarantine). Never changes the meaning silently: every repair is
 * counted in the report and the original value goes to legacy_archive.
 */
async function repairFor(err, values, meta, entry, cache) {
  if (err.code === '23502' && err.column && meta.has(err.column)) {
    const m = meta.get(err.column);
    const v = { ...values };
    if (m.hasDefault && v[err.column] !== undefined) delete v[err.column]; else v[err.column] = legacy.emptyOf(m);
    return { values: v, kind: 'null_filled', col: err.column };
  }
  if (err.code === '23514' && err.constraint) {
    // a list rule (PHP enum → CHECK): same word in another case, the closest status, else the column default
    const key = 'chk:' + err.constraint;
    if (!cache.has(key)) {
      const def = await db.value(`SELECT pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
                                  WHERE c.conname = $1 AND t.relnamespace = current_schema()::regnamespace LIMIT 1`, [err.constraint]) || '';
      const col = (def.match(/\(+(\w+)\)?::text/) || def.match(/\(+(\w+) (?:=|IN|>|<|BETWEEN)/i) || [])[1];
      cache.set(key, { col, allowed: [...def.matchAll(/'([^']*)'::/g)].map(m => m[1]) });
    }
    const { col, allowed } = cache.get(key);
    if (col && meta.has(col) && values[col] !== undefined) {
      const cur = values[col];
      const m = meta.get(col);
      const same = allowed.find(x => typeof cur === 'string' && x.toLowerCase() === cur.trim().toLowerCase());
      if (same && same !== cur) return { values: { ...values, [col]: same }, kind: 'enum_case', col, archive: { [col]: cur } };
      const near = (legacy.STATUS_FALLBACK[cur] || []).find(x => allowed.includes(x));
      if (near) return { values: { ...values, [col]: near }, kind: 'status_mapped', col, archive: { [col]: cur } };
      const v = { ...values };
      if (col === 'status' && allowed.includes('pending')) v[col] = 'pending';
      else if (m.hasDefault) delete v[col];
      else if (m.nullable) v[col] = null;
      else if (allowed.length) v[col] = allowed[0];
      else return null;
      return { values: v, kind: col === 'status' ? 'status_default' : 'enum_default', col, archive: { [col]: cur } };
    }
  }
  if (err.code === '23505' && err.constraint) {
    const key = 'uq:' + err.constraint;
    if (!cache.has(key)) cache.set(key, await indexColumns(err.constraint));
    const cols = cache.get(key);
    if (cols.length === 1 && cols[0] !== 'id' && meta.has(cols[0]) && values[cols[0]] !== null && values[cols[0]] !== undefined) {
      const c = cols[0], m = meta.get(c), orig = values[c];
      if ((m.type === 'character varying' || m.type === 'text')) {
        const n = (entry._dupSeq = (entry._dupSeq || 0) + 1);
        const suffix = `-dup${n}`;
        const base = String(orig);
        const val = m.max && base.length + suffix.length > m.max ? base.slice(0, m.max - suffix.length) + suffix : base + suffix;
        return { values: { ...values, [c]: val }, kind: 'unique_suffixed', col: c, archive: { [c]: orig } };
      }
      if (m.nullable) return { values: { ...values, [c]: null }, kind: 'unique_cleared', col: c, archive: { [c]: orig } };
    }
  }
  return null;
}

/** Insert one transformed row (repair → retry → quarantine). */
async function insertRow(ctx, entry, meta, srcRow, key, tr) {
  let values = tr.values;
  const extra = [];
  let archive = tr.archive ? { ...tr.archive } : null;
  for (let attempt = 0; ; attempt++) {
    const cols = Object.keys(values).filter(c => values[c] !== undefined);
    const sql = cols.length
      ? `INSERT INTO ${db.ident(entry.target)} (${cols.map(db.ident).join(', ')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(', ')})${ctx.onConflict.get(entry.target) || ''}`
      : `INSERT INTO ${db.ident(entry.target)} DEFAULT VALUES`;
    await db.query('SAVEPOINT r');
    try {
      const res = await db.query(sql, cols.map(c => values[c]));
      await db.query('RELEASE SAVEPOINT r');
      if (!res.rowCount) { entry.already_present++; return; }
      entry.imported++;
      const kinds = [...tr.repairs.map(r => r.kind), ...extra];
      if (kinds.length) {
        entry.repaired++;
        for (const k of kinds) { entry.repairs[k] = (entry.repairs[k] || 0) + 1; ctx.report.repairs[k] = (ctx.report.repairs[k] || 0) + 1; }
      }
      if (archive) { entry.archived_values++; await archiveRow(ctx.runId, entry.table, key, 'columns', archive, 'values without a platform column, or changed on import'); }
      return;
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT r');
      const fix = attempt < 6 ? await repairFor(e, values, meta, entry, ctx.cache) : null;
      if (fix) {
        values = fix.values;
        extra.push(fix.kind);
        if (fix.archive) archive = { ...(archive || {}), ...Object.fromEntries(Object.entries(fix.archive).map(([k, v]) => [k, legacy.toJsonValue(v)])) };
        continue;
      }
      // the whole source row (PII columns as converted), so nothing is lost
      const data = legacy.rowToJson(srcRow);
      for (const c of require('./pii-crypto').PII_COLUMNS[entry.target] || []) if (tr.values[c] !== undefined) data[c] = tr.values[c];
      const reason = await quarantineRow(ctx.runId, entry, key, data, e);
      entry.quarantined++;
      entry.quarantine_reasons[reason] = (entry.quarantine_reasons[reason] || 0) + 1;
      if (ctx.report.quarantine.examples.length < 50) ctx.report.quarantine.examples.push(`${entry.table} ${key}: ${String(e.message).slice(0, 200)}`);
      return;
    }
  }
}

/**
 * @param {object} o  { tenant, source | mysqlUrl, uploads, credKey, piiKey, vapid, dryRun, mode: 'fresh'|'incremental', runId, log }
 * Dry run = full rehearsal: the import runs inside a transaction that is rolled back, so the report (repairs,
 * quarantine, duplicates) is exactly what a real run will do; files are not touched.
 * @returns report object
 */
async function migrate(o) {
  const log = o.log || (() => {});
  const report = {
    tenant: o.tenant, started_at: new Date().toISOString(), dry_run: !!o.dryRun, mode: o.mode || 'fresh', source: o.source ? o.source.label : redact(o.mysqlUrl),
    run_id: o.runId || newRunId(o.tenant), steps: [], tables: [], warnings: [], errors: [], files: {}, verify: {},
    repairs: {}, quarantine: { rows: 0, examples: [] }, archive: { rows: 0, values: 0 }, unmapped: [], relations: [], guards: [], kym: {}, totals: {}, accounted: null,
  };
  const step = (name, status, detail = '') => { report.steps.push({ name, status, detail }); log(`${status === 'ok' ? '✓' : status === 'warn' ? '!' : status === 'skip' ? '·' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
  const warn = w => { report.warnings.push(w); log('  ! ' + w); };

  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [o.tenant]);
  if (!tenant) throw new Error(`Tenant "${o.tenant}" does not exist (use --create)`);
  report.schema = tenant.schema_name;
  await tenants.migrateTenant(tenant); // the import needs the newest columns (066: quarantine, archive, legacy columns)
  db.clearColumnCache();
  const ctx = { report, runId: report.run_id, cache: new Map(), onConflict: new Map(), piiKey: o.piiKey || null, schema: tenant.schema_name };

  // ---- preflight
  const src = o.source || await mysqlSource(o.mysqlUrl, o.mysqlDriver);
  try {
    const ver = await src.info();
    step(o.source ? 'read SQL dump' : 'connect to MySQL', 'ok', `${ver.version}, charset ${ver.charset}`);
    if (!/utf8/.test(ver.charset)) warn(`database charset is ${ver.charset}; Nepali text may need conversion`);
    const myTables = await src.tables();
    const pgTables = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [tenant.schema_name])).map(r => r.table_name));

    for (const [t, c] of [['members', 'name_np'], ['notices', 'title_np'], ['site_settings', 'setting_value']]) {
      if (!myTables.includes(t)) continue;
      const rows = await src.sample(t, c, 200);
      const bad = rows.filter(v => MOJIBAKE.test(String(v))).length;
      if (bad) warn(`${t}.${c}: ${bad} of ${rows.length} sampled values look double-encoded (e.g. "à¤…") — they are repaired on import; check a few in the report`);
    }

    // ---- plan: every source table and column gets a destination (legacy-map.js)
    for (const t of myTables) {
      const n = Number(await src.count(t));
      const plan = legacy.tablePlan(t, pgTables);
      const entry = { table: t, target: plan.target, action: plan.action, reason: plan.reason, source_rows: n, target_rows: null, imported: 0, repaired: 0,
        quarantined: 0, already_present: 0, archived_rows: 0, archived_values: 0, repairs: {}, quarantine_reasons: {}, columns: [], mapped: {}, derived: {}, dropped_columns: [], status: '' };
      report.tables.push(entry);
      if (plan.action === 'skip') { entry.status = 'skipped'; continue; }
      entry.source_columns = await src.columns(t);
      if (plan.action === 'archive') {
        entry.status = n ? 'archive' : 'empty';
        if (n) warn(`table ${t} (${n} rows): ${plan.reason}`);
        continue;
      }
      const meta = await db.withSchema(tenant.schema_name, () => targetMeta(plan.target));
      const cp = legacy.columnPlan(t, entry.source_columns, meta);
      entry.columns = cp.direct;
      entry.mapped = Object.fromEntries(Object.entries(cp.mapped).map(([c, r]) => [c, r.to]));
      entry.derived = cp.derived;
      entry.dropped_columns = cp.unmapped;
      entry._plan = cp;
      entry._meta = meta;
      entry.status = n ? 'planned' : 'empty';
      if (n) {
        for (const c of cp.unmapped) {
          const samples = (await src.sample(t, c, 3)).map(v => String(legacy.toJsonValue(v)).slice(0, 80));
          report.unmapped.push({ table: t, column: c, samples, kept_in: 'legacy_archive' });
        }
      }
    }
    const planned = report.tables.filter(t => t.status === 'planned');
    const archiveTables = report.tables.filter(t => t.status === 'archive');
    step('plan', 'ok', `${planned.length} tables / ${planned.reduce((a, t) => a + t.source_rows, 0)} rows to copy${archiveTables.length ? `, ${archiveTables.length} tables to the legacy archive` : ''}`);
    for (const t of planned) {
      if (Object.keys(t.mapped).length) log(`  · ${t.table}: older columns mapped — ${Object.entries(t.mapped).map(([a, b]) => `${a} → ${b}`).join(', ')}`);
      if (t.dropped_columns.length) warn(`${t.table}: columns without a platform equivalent are kept in legacy_archive: ${t.dropped_columns.join(', ')}`);
    }

    if (o.uploads) {
      const s = dirStats(o.uploads);
      report.files.source = s;
      step('uploads found', 'ok', `${s.files} files, ${mb(s.bytes)}${s.skipped ? `, ${s.skipped} executable/html files will be skipped` : ''}`);
      try {
        const sf = fs.statfsSync(config.uploadDir);
        if (sf.bavail * sf.bsize < s.bytes * 1.2) warn(`low disk space for uploads: ${mb(sf.bavail * sf.bsize)} free, ${mb(s.bytes)} needed`);
      } catch { /* statfs unsupported */ }
    } else step('uploads', 'skip', 'no uploads folder given');

    // ---- import (one transaction: all or nothing; a dry run rolls it back)
    const t0 = Date.now();
    try {
      await db.withSchema(tenant.schema_name, () => db.transaction(async () => {
        // unique rules legacy data may break are lifted for the import and put back below when the data allows
        const lifted = [];
        for (const g of legacy.DEFERRED_UNIQUE) {
          if (!planned.some(t => t.target === g.table)) continue;
          await db.query(`DROP INDEX IF EXISTS ${db.ident(g.index)}`);
          lifted.push(g);
        }
        if (report.mode === 'fresh') {
          const names = [...planned, ...archiveTables].map(t => t.table);
          await db.query('DELETE FROM import_quarantine WHERE resolved_at IS NULL AND source_table = ANY($1)', [names]);
          await db.query('DELETE FROM legacy_archive WHERE source_table = ANY($1)', [names]);
        }
        for (const entry of planned) {
          const cp = entry._plan, meta = entry._meta;
          const srcCols = entry.source_columns;
          if (report.mode === 'fresh') await db.query(`TRUNCATE ${db.ident(entry.target)} RESTART IDENTITY CASCADE`);
          const pk = await primaryKey(entry.target);
          ctx.onConflict.set(entry.target, report.mode === 'incremental' ? (pk.length ? ` ON CONFLICT (${pk.map(db.ident).join(', ')}) DO NOTHING` : ' ON CONFLICT DO NOTHING') : '');
          let offset = 0;
          for (;;) {
            const rows = await src.rows(entry.table, srcCols, offset, BATCH);
            if (!rows.length) break;
            for (let k = 0; k < rows.length; k++) {
              const row = rows[k];
              const key = legacy.rowKey(entry.table, row, offset + k);
              const tr = legacy.transformRow(entry.target, row, cp, meta, ctx);
              await insertRow(ctx, entry, meta, row, key, tr);
            }
            offset += rows.length;
          }
          if (meta.has('id') && pk.length === 1 && pk[0] === 'id') {
            await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${db.ident(entry.target)}), 1), (SELECT COUNT(*) > 0 FROM ${db.ident(entry.target)}))`, [tenant.schema_name + '.' + entry.target]).catch(() => {});
          }
          entry.status = 'copied';
          report.quarantine.rows += entry.quarantined;
          report.archive.values += entry.archived_values;
          log(`    ${entry.table}: ${entry.imported}/${entry.source_rows}${entry.repaired ? `, ${entry.repaired} repaired` : ''}${entry.quarantined ? `, ${entry.quarantined} quarantined` : ''}${entry.already_present ? `, ${entry.already_present} already there` : ''}`);
        }
        // tables without an equivalent: every row into the legacy archive
        for (const entry of archiveTables) {
          let offset = 0;
          for (;;) {
            const rows = await src.rows(entry.table, entry.source_columns, offset, BATCH);
            if (!rows.length) break;
            for (let k = 0; k < rows.length; k++) {
              await archiveRow(ctx.runId, entry.table, legacy.rowKey(entry.table, rows[k], offset + k), 'row', legacy.rowToJson(rows[k]), entry.reason);
              entry.archived_rows++;
            }
            offset += rows.length;
          }
          entry.status = 'archived';
          report.archive.rows += entry.archived_rows;
        }
        await db.query('UPDATE members SET updated_at = COALESCE(updated_at, created_at, now())').catch(() => {});
        const rowsIn = planned.reduce((a, t) => a + t.imported, 0);
        step('import data', report.quarantine.rows ? 'warn' : 'ok', `${rowsIn} rows${report.quarantine.rows ? `, ${report.quarantine.rows} quarantined (Admin fixes them; see the report)` : ''}${report.archive.rows ? `, ${report.archive.rows} rows archived` : ''} in ${Math.round((Date.now() - t0) / 1000)} s`);
        const nRep = Object.values(report.repairs).reduce((a, b) => a + b, 0);
        if (nRep) step('repairs', 'ok', Object.entries(report.repairs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', '));

        await postImport(o, ctx, planned, lifted, step, warn);
        await accounting(report, step, warn);
        if (o.dryRun) throw ROLLBACK;
      }));
    } catch (e) { if (e !== ROLLBACK) throw e; }
    await db.withSchema(tenant.schema_name, async () => require('./settings').invalidate());
    if (o.dryRun) {
      for (const t of planned) t.status = 'planned';
      step('dry run', 'ok', 'the whole import was rehearsed and rolled back — nothing was written');
      return finish(report);
    }
    tenants.clearCache();

    // ---- source vs target, row by row (also: npm run migrate:site -- --verify)
    await db.withSchema(tenant.schema_name, () => verifyTables(src, report, ctx, step, warn));
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
    // PHP-gated folders (KYC, loan, welfare, office replies …) → private storage, every file and every stored path
    await db.withSchema(tenant.schema_name, async () => {
      const g = await protectGatedUploads(dest);
      report.files.gated = g;
      step('protect gated folders', 'ok', `${g.moved} files in ${g.folders.length} folders moved to private storage; ${g.rows} stored paths and ${g.html} rich-text links updated`);
    });
  }
  // ---- privatise confidential files (application documents, information room)
  await db.withSchema(tenant.schema_name, async () => {
    const { moved, missing, missingList } = await privatiseFileColumns(dest);
    report.files.privatised = moved;
    report.files.missing = missing;
    report.files.missing_examples = missingList;
    step('protect confidential files', 'ok', `${moved} application / information-room files moved to private storage`);
    if (missing) warn(`${missing} database rows point to files that are not in the uploads folder (see report)`);
  });

  // ---- checks
  await db.withSchema(tenant.schema_name, async () => {
    for (const t of report.tables.filter(x => x.status === 'copied')) {
      t.target_rows = await db.value(`SELECT count(*) FROM ${db.ident(t.target)}`);
      if (report.mode === 'fresh' && t.target_rows + t.quarantined < t.source_rows) warn(`${t.table}: ${t.target_rows} rows in the new system + ${t.quarantined} quarantined vs ${t.source_rows} in the old`);
    }
    const v = report.verify;
    v.admins_active = await db.value('SELECT count(*) FROM admin_users WHERE deleted_at IS NULL AND is_active = 1');
    v.members = await db.value('SELECT count(*) FROM members WHERE deleted_at IS NULL');
    v.members_with_password = await db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND password_hash LIKE '$2%'");
    v.notices = await db.value('SELECT count(*) FROM notices WHERE deleted_at IS NULL');
    v.settings = await db.value('SELECT count(*) FROM site_settings');
    v.site_name = await db.value("SELECT setting_value FROM site_settings WHERE setting_key = 'site_name'");
    v.quarantined_open = await db.value('SELECT count(*) FROM import_quarantine WHERE resolved_at IS NULL');
    if (!v.admins_active) warn(`no active admin — create one: npm run tenant:admin -- --tenant=${tenant.slug} --username=admin --password=…`);
    step('checks', report.quarantine.rows ? 'warn' : 'ok', `${v.members} members (${v.members_with_password} can log in with their old password), ${v.admins_active} admins, ${v.notices} notices${v.quarantined_open ? `, ${v.quarantined_open} rows waiting in quarantine` : ''}`);
  });
  tenants.clearCache();
  return finish(report);
}

/** Everything after the rows are in (inside the import transaction). */
async function postImport(o, ctx, planned, lifted, step, warn) {
  const report = ctx.report;
  const settings = require('./settings');
  const imported = new Set(planned.map(t => t.target));

  // PHP setting names → platform names; the PHP app forced 2FA on every admin and member, so keep that
  const mapped = await settings.mapLegacy(o.credKey);
  await settings.set('admin_2fa_required', '1', { group: 'security', label: 'Require 2FA for every admin (1 = yes)' });
  await settings.set('member_2fa_required', '1', { label: 'Member 2FA (authenticator app) required for every member (1 = yes)', group: 'members' });
  step('settings', 'ok', `${mapped.length} PHP setting names mapped${mapped.length ? ` (${mapped.slice(0, 8).join(', ')}${mapped.length > 8 ? '…' : ''})` : ''}; admin and member 2FA required as on the PHP site`);

  // office credentials: PHP AES-CBC → AES-GCM
  const creds = await db.many("SELECT id, password_enc, password_iv FROM office_credentials WHERE password_tag IS NULL AND password_enc <> ''");
  if (!creds.length) step('office credentials', 'skip', 'none to convert');
  else {
    const vault = require('./credentials-crypto');
    if (!o.credKey || !vault.enabled()) warn(`${creds.length} office credentials keep the old encryption — set CREDENTIALS_KEY and pass the PHP includes/.cred-master.key (or --php-root) to convert them`);
    else {
      const key = crypto.createHash('sha256').update(o.credKey).digest();
      let ok = 0, bad = 0;
      for (const r of creds) {
        try {
          const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(r.password_iv, 'hex'));
          const plain = Buffer.concat([d.update(Buffer.from(r.password_enc, 'base64')), d.final()]).toString('utf8');
          await db.update('office_credentials', r.id, vault.encrypt(plain));
          ok++;
        } catch { bad++; }
      }
      step('office credentials', bad ? 'warn' : 'ok', `${ok} re-encrypted${bad ? `, ${bad} could not be decrypted` : ''}`);
    }
  }

  // help_topics (PHP assistant context) → chatbot answers; the PHP install's Web Push keys
  const n = await importHelpTopics();
  step('help topics', n ? 'ok' : 'skip', n ? `${n} help topics added as assistant answers (Admin → Chatbot answers)` : 'none to add');
  if (o.vapid) {
    await settings.set('push_vapid_public', o.vapid.publicKey, { group: 'push', label: 'VAPID public key' });
    await settings.set('push_vapid_private', o.vapid.privateKey, { group: 'push', label: 'VAPID private key' });
    step('push keys', 'ok', 'Web Push keys of the old site kept, so members stay subscribed');
  } else if (await db.value('SELECT 1 FROM member_push_subscriptions LIMIT 1').catch(() => null)) {
    warn('the old site\'s Web Push keys were not found (includes/push-vapid.local.php) — members must turn push notifications on again');
  }

  // PII: converted row by row on the way in (legacy-map.js); this catches values the transform could not open
  const piiNow = report.repairs.pii_converted || 0;
  if (piiNow) {
    step('PII (citizenship no.)', 'ok', `${piiNow} PHP-encrypted values converted${require('./pii-crypto').enabled() ? ' to the new encryption' : ' (plain text)'}`);
    if (!require('./pii-crypto').enabled()) warn('PII_KEY is not set: converted citizenship numbers were stored as plain text. Set PII_KEY, then run npm run pii to encrypt them.');
  }
  await convertPii(o.piiKey, piiNow ? () => {} : step, warn);

  // BS dates already converted on the way in; this also catches values typed later (idempotent)
  const fixed = await require('./bs-dates').normalise();
  const nb = Object.values(fixed).reduce((a, b) => a + b, 0);
  const inTransform = report.repairs.bs_date || 0;
  step('BS dates', nb || inTransform ? 'ok' : 'skip', nb || inTransform ? `${inTransform + nb} dates converted from B.S. to A.D.` : 'none found');

  // logical links: dangling optional links are cleared (old value archived), missing parents are reported
  for (const [child, col, parent, action] of legacy.RELATIONS) {
    if (!imported.has(child)) continue;
    const ccols = await db.columns(child);
    if (!ccols.has(col) || !(await db.value("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1", [parent]))) continue;
    const orphans = await db.many(`SELECT c.id, c.${db.ident(col)} AS v FROM ${db.ident(child)} c WHERE c.${db.ident(col)} IS NOT NULL AND c.${db.ident(col)} <> 0
                                   AND NOT EXISTS (SELECT 1 FROM ${db.ident(parent)} p WHERE p.id = c.${db.ident(col)}) ORDER BY c.id LIMIT 10000`);
    if (!orphans.length) continue;
    if (action === 'null') {
      for (const r of orphans) await archiveRow(ctx.runId, child, String(r.id), 'columns', { [col]: r.v }, `${col} pointed to a missing ${parent} row — cleared`);
      await db.query(`UPDATE ${db.ident(child)} SET ${db.ident(col)} = NULL WHERE id = ANY($1)`, [orphans.map(r => r.id)]);
      report.repairs.orphan_link_cleared = (report.repairs.orphan_link_cleared || 0) + orphans.length;
    } else warn(`${orphans.length} ${child} rows point to a missing ${parent} (${col} = ${[...new Set(orphans.slice(0, 5).map(r => r.v))].join(', ')}…) — kept as they were`);
    report.relations.push({ child, column: col, parent, orphans: orphans.length, action: action === 'null' ? 'cleared' : 'kept', ids: orphans.slice(0, 20).map(r => r.id) });
  }

  // gallery of older installs: album text → albums (the PHP site did this lazily at runtime)
  if (imported.has('gallery')) {
    const g = await linkLegacyGalleryAlbums();
    if (g.items) { report.repairs.gallery_album_linked = (report.repairs.gallery_album_linked || 0) + g.items; step('gallery albums', 'ok', `${g.items} photos / videos without an album put into ${g.albums ? g.albums + ' new and ' : ''}existing albums, as the PHP site did`); }
  }

  // members ↔ KYM: the same lookup the PHP site did at read time (member number), stored once
  if (imported.has('members') || imported.has('kyc_applications')) {
    const linked = await db.query(`WITH uniq AS (SELECT upper(trim(sadasyata_number)) AS mid FROM members WHERE deleted_at IS NULL AND trim(COALESCE(sadasyata_number, '')) <> ''
                                                GROUP BY 1 HAVING count(*) = 1),
           k AS (SELECT DISTINCT ON (upper(trim(member_id))) id, upper(trim(member_id)) AS mid FROM kyc_applications
                 WHERE deleted_at IS NULL AND status <> 'rejected' AND trim(COALESCE(member_id, '')) <> ''
                 ORDER BY upper(trim(member_id)), array_position(ARRAY['approved','pending','incomplete','partial']::text[], status::text), id DESC)
      UPDATE members m SET kyc_application_id = k.id FROM k JOIN uniq u ON u.mid = k.mid
      WHERE m.kyc_application_id IS NULL AND m.deleted_at IS NULL AND upper(trim(m.sadasyata_number)) = k.mid`);
    report.kym.linked = linked.rowCount;
    report.kym.members_without_kym = Number(await db.value("SELECT count(*) FROM members m WHERE m.deleted_at IS NULL AND m.kyc_application_id IS NULL"));
    step('members ↔ KYM', 'ok', `${linked.rowCount} members linked to their KYM by membership number; ${report.kym.members_without_kym} members have no KYM yet`);
  }

  // unique rules back on — or reported when legacy duplicates are kept
  for (const g of lifted) {
    const d = await db.many(g.dupes);
    if (!d.length) { await db.query(g.create); report.guards.push({ index: g.index, restored: true }); continue; }
    if (g.fallback) await db.query(g.fallback);
    report.guards.push({ index: g.index, restored: false, duplicates: d.length, examples: d.slice(0, 20) });
    warn(`${d.length} ${g.hint} (e.g. ${d.slice(0, 3).map(x => `${x.k}: ids ${x.ids}`).join('; ')})`);
  }
}

/**
 * gallery rows of older installs without album_id (PHP gallery-albums.php galleryMigrateLegacyAlbums / …Videos, which
 * ran lazily on the PHP site): photos are grouped into albums by their album text (else title, else "General"), videos
 * join the album named in their album text or the "भिडियोहरू" album. Existing albums are matched by name. Idempotent.
 * @returns {{ albums: number, items: number }}
 */
async function linkLegacyGalleryAlbums() {
  const cols = await db.columns('gallery');
  if (!cols.has('album_id')) return { albums: 0, items: 0 };
  const hasAlbum = cols.has('album');
  const key = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const byName = new Map();
  for (const a of await db.many('SELECT id, name_np, name_en FROM gallery_albums ORDER BY id')) for (const n of [a.name_np, a.name_en]) if (key(n) && !byName.has(key(n))) byName.set(key(n), a.id);
  let albums = 0, items = 0, order = 1000;
  const albumFor = async (name, category) => {
    const k = key(name);
    if (byName.has(k)) return byName.get(k);
    const id = await db.value("INSERT INTO gallery_albums (name_np, name_en, category, is_active, display_order) VALUES ($1, $2, $3, 1, $4) RETURNING id",
      [String(name).slice(0, 200), String(name).slice(0, 200), String(category || 'general').slice(0, 50) || 'general', order--]);
    byName.set(k, id); albums++;
    return id;
  };
  const albumText = hasAlbum ? "NULLIF(trim(album), '')" : 'NULL';
  const photos = await db.many(`SELECT id, COALESCE(${albumText}, NULLIF(trim(title_np), ''), NULLIF(trim(title), ''), 'General') AS k, category FROM gallery
                                WHERE album_id IS NULL AND COALESCE(media_type, 'photo') IN ('photo', '') ORDER BY id DESC`);
  for (const p of photos) { await db.query('UPDATE gallery SET album_id = $1 WHERE id = $2', [await albumFor(p.k, p.category), p.id]); items++; }
  const videos = await db.many(`SELECT id, ${albumText} AS k FROM gallery WHERE album_id IS NULL AND media_type = 'video' ORDER BY id`);
  for (const v of videos) {
    const id = v.k && byName.has(key(v.k)) ? byName.get(key(v.k)) : await albumFor('भिडियोहरू', 'general');
    await db.query(`UPDATE gallery SET album_id = $1${hasAlbum ? ", album = COALESCE(NULLIF(trim(album), ''), 'भिडियोहरू')" : ''} WHERE id = $2`, [id, v.id]);
    items++;
  }
  return { albums, items };
}

/** Every source row is imported, quarantined, archived or knowingly skipped — the totals must add up. */
async function accounting(report, step, warn) {
  const T = report.totals = { source_rows: 0, imported: 0, repaired: 0, quarantined: 0, already_present: 0, archived_rows: 0, skipped: 0 };
  let bad = 0;
  for (const t of report.tables) {
    T.source_rows += t.source_rows;
    if (t.action === 'skip') { T.skipped += t.source_rows; t.accounted = true; continue; }
    T.imported += t.imported; T.repaired += t.repaired; T.quarantined += t.quarantined; T.already_present += t.already_present; T.archived_rows += t.archived_rows;
    t.accounted = t.imported + t.quarantined + t.already_present + t.archived_rows === t.source_rows;
    if (!t.accounted && t.source_rows) { bad++; warn(`${t.table}: ${t.source_rows} source rows but ${t.imported} imported + ${t.quarantined} quarantined + ${t.already_present} already there + ${t.archived_rows} archived`); }
  }
  report.accounted = !bad;
  step('every row accounted for', bad ? 'fail' : 'ok', `${T.source_rows} source rows = ${T.imported} imported (${T.repaired} repaired) + ${T.quarantined} quarantined + ${T.archived_rows} archived + ${T.already_present} already present + ${T.skipped} skipped (PHP migration ledger)`);
}

/**
 * Compare source and target: row counts, the set of keys and a checksum of identifying text columns
 * (legacy-map.js VERIFY_COLUMNS, after the same cleaning as the import). Runs inside the tenant schema.
 */
async function verifyTables(src, report, ctx, step = () => {}, warn = () => {}) {
  const out = report.verify_tables = [];
  let bad = 0;
  for (const entry of report.tables) {
    if (entry.action !== 'copy' || !entry.source_rows) continue;
    const meta = entry._meta || await targetMeta(entry.target);
    const cp = entry._plan || legacy.columnPlan(entry.table, entry.source_columns || await src.columns(entry.table), meta);
    const srcCols = entry.source_columns || await src.columns(entry.table);
    const piiCols = new Set(require('./pii-crypto').PII_COLUMNS[entry.target] || []);
    const vcols = legacy.VERIFY_COLUMNS.filter(c => cp.direct.includes(c) && !piiCols.has(c) && ['character varying', 'text'].includes(meta.get(c).type)).slice(0, 3);
    const keyCols = meta.has('id') ? ['id'] : (legacy.KEY_COLUMNS[entry.table] || []);
    if (!keyCols.length) continue;
    const show = v => (v === null || v === undefined ? '∅' : String(v));
    const source = new Map();
    let dupKeys = 0;
    for (let offset = 0; ; ) {
      const rows = await src.rows(entry.table, srcCols, offset, BATCH);
      if (!rows.length) break;
      rows.forEach((row, k) => {
        const key = legacy.rowKey(entry.table, row, offset + k);
        if (source.has(key)) { dupKeys++; return; } // a second row with the same key: the first one was imported, this one quarantined
        const tr = legacy.transformRow(entry.target, row, cp, meta, ctx);
        source.set(key, vcols.map(c => show(tr.values[c])));
      });
      offset += rows.length;
    }
    const target = new Map();
    const tRows = await db.many(`SELECT ${keyCols.map(c => `${db.ident(c)}::text AS ${db.ident('k_' + c)}`).join(', ')}${vcols.map(c => `, ${db.ident(c)}::text AS ${db.ident('v_' + c)}`).join('')} FROM ${db.ident(entry.target)}`);
    for (const r of tRows) target.set(keyCols.map(c => r['k_' + c]).join('|'), vcols.map(c => show(r['v_' + c])));
    const quarantined = new Set((await db.many('SELECT source_key FROM import_quarantine WHERE resolved_at IS NULL AND source_table = $1', [entry.table])).map(r => r.source_key));
    // values changed on import on purpose (duplicate suffix, cleared link …) are recorded in legacy_archive with the original
    const archived = new Map((await db.many("SELECT source_key, data FROM legacy_archive WHERE source_table = $1 AND kind = 'columns'", [entry.table])).map(r => [r.source_key, r.data || {}]));
    const missing = [], changed = [];
    let repairedCells = 0;
    for (const [k, vals] of source) {
      if (!target.has(k)) { if (!quarantined.has(k)) missing.push(k); continue; }
      const tv = target.get(k);
      vcols.forEach((c, j) => {
        if (tv[j] === vals[j]) return;
        if (archived.has(k) && Object.hasOwn(archived.get(k), c)) { repairedCells++; vals[j] = tv[j]; return; }
        if (!changed.includes(k)) changed.push(k);
      });
    }
    const sum = m => crypto.createHash('sha256').update([...m.entries()].filter(([k]) => source.has(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, vals]) => k + '␞' + vals.join('␟')).join('\n')).digest('hex').slice(0, 16);
    const v = { table: entry.table, source_rows: source.size + dupKeys, target_rows: target.size, quarantined: quarantined.size, missing: missing.length, changed: changed.length,
      repaired_values: repairedCells, duplicate_keys: dupKeys, extra: [...target.keys()].filter(k => !source.has(k)).length, columns: vcols,
      checksum_source: sum(source), checksum_target: sum(target), missing_examples: missing.slice(0, 10), changed_examples: changed.slice(0, 10) };
    v.ok = !missing.length && !changed.length;
    if (!v.ok) { bad++; warn(`verify ${entry.table}: ${missing.length} rows missing, ${changed.length} rows differ (e.g. ${[...missing, ...changed].slice(0, 5).join(', ')})`); }
    out.push(v);
  }
  step('verify (source ↔ target)', bad ? 'warn' : 'ok', `${out.length} tables compared row by row${bad ? `, ${bad} with differences` : ' — counts, keys and checksums match'}`);
  return out;
}

/**
 * --verify: compare an old database with a tenant that was migrated earlier, without importing anything.
 * @param {object} o { tenant, source | mysqlUrl, piiKey, log }
 */
async function verifyOnly(o) {
  const log = o.log || (() => {});
  const report = { tenant: o.tenant, started_at: new Date().toISOString(), verify_only: true, dry_run: true, mode: 'verify', source: o.source ? o.source.label : redact(o.mysqlUrl),
    steps: [], tables: [], warnings: [], errors: [], files: {}, verify: {}, repairs: {}, quarantine: { rows: 0, examples: [] }, archive: {}, unmapped: [], relations: [], guards: [], kym: {}, totals: {} };
  const step = (name, status, detail = '') => { report.steps.push({ name, status, detail }); log(`${status === 'ok' ? '✓' : status === 'warn' ? '!' : '·'} ${name}${detail ? ' — ' + detail : ''}`); };
  const warn = w => { report.warnings.push(w); log('  ! ' + w); };
  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [o.tenant]);
  if (!tenant) throw new Error(`Tenant "${o.tenant}" does not exist`);
  const src = o.source || await mysqlSource(o.mysqlUrl, o.mysqlDriver);
  try {
    await db.withSchema(tenant.schema_name, async () => {
      const pgTables = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'`)).map(r => r.table_name));
      for (const t of await src.tables()) {
        const plan = legacy.tablePlan(t, pgTables);
        const n = Number(await src.count(t));
        const entry = { table: t, target: plan.target, action: plan.action, source_rows: n };
        if (plan.action === 'archive') entry.archived = Number(await db.value('SELECT count(*) FROM legacy_archive WHERE source_table = $1 AND kind = $2', [t, 'row']));
        report.tables.push(entry);
      }
      for (const e of report.tables.filter(x => x.action === 'archive' && x.source_rows !== x.archived)) warn(`${e.table}: ${e.source_rows} source rows, ${e.archived} in legacy_archive`);
      await verifyTables(src, report, { piiKey: o.piiKey || null, schema: tenant.schema_name }, step, warn);
    });
  } finally { await src.end(); }
  report.finished_at = new Date().toISOString();
  report.ok = !report.warnings.length;
  return report;
}

function finish(report) {
  report.finished_at = new Date().toISOString();
  for (const t of report.tables) { delete t._plan; delete t._meta; }
  report.ok = !report.steps.some(s => s.status === 'fail') && !report.errors.length;
  return report;
}

/** Short human summary of a report (CLI and platform console). */
function summary(r) {
  const T = r.totals || {};
  const lines = [];
  if (r.verify_only) {
    const vt = r.verify_tables || [];
    lines.push(`Verify: ${vt.length} tables compared, ${vt.filter(v => !v.ok).length} with differences.`);
    for (const v of vt.filter(x => !x.ok)) lines.push(`  ${v.table}: ${v.missing} missing, ${v.changed} differ`);
    return lines.join('\n');
  }
  lines.push(`${r.dry_run ? 'Dry run (rehearsal, rolled back)' : 'Migration'} ${r.tenant} — mode ${r.mode}`);
  lines.push(`Rows: ${T.source_rows ?? '?'} in the old database → ${T.imported ?? 0} imported (${T.repaired ?? 0} repaired), ${T.quarantined ?? 0} quarantined, ${T.archived_rows ?? 0} archived, ${T.already_present ?? 0} already present, ${T.skipped ?? 0} skipped.`);
  lines.push(`Every row accounted for: ${r.accounted ? 'yes' : 'NO'}`);
  const reps = Object.entries(r.repairs || {}).sort((a, b) => b[1] - a[1]);
  if (reps.length) lines.push('Repairs: ' + reps.map(([k, n]) => `${k} ${n}`).join(', '));
  if ((r.unmapped || []).length) lines.push(`Columns without a platform equivalent (kept in legacy_archive): ${r.unmapped.map(u => u.table + '.' + u.column).join(', ')}`);
  const arch = (r.tables || []).filter(t => t.archived_rows);
  if (arch.length) lines.push(`Tables archived: ${arch.map(t => `${t.table} (${t.archived_rows})`).join(', ')}`);
  for (const g of (r.guards || []).filter(x => !x.restored)) lines.push(`Unique guard ${g.index} not restored: ${g.duplicates} duplicates kept`);
  if (r.quarantine && r.quarantine.rows) lines.push(`Quarantine: ${r.quarantine.rows} rows — list: npm run migrate:site -- --tenant=${r.tenant} --quarantine`);
  if (r.verify_tables) lines.push(`Verify: ${r.verify_tables.filter(v => v.ok).length}/${r.verify_tables.length} tables match row by row.`);
  lines.push(`Warnings: ${r.warnings.length}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- quarantine (rows the platform refused on import)
const SECRET_KEYS = /^(password|password_hash|pin_hash|twofa_secret|twofa_backup_codes|cvv|otp_code|token|password_enc|password_iv)$/i;
/** Data of a quarantined row for display: secrets hidden, PII masked (CLAUDE.md §6). */
function maskQuarantineData(table, data) {
  const piiCols = new Set(require('./pii-crypto').PII_COLUMNS[table] || []);
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === null || v === '') { out[k] = v; continue; }
    if (SECRET_KEYS.test(k)) out[k] = '•••';
    else if (piiCols.has(k)) { const s = String(v); out[k] = /^pii\d:/.test(s) ? '[encrypted]' : '•••' + s.slice(-3); }
    else out[k] = typeof v === 'string' && v.length > 120 ? v.slice(0, 117) + '…' : v;
  }
  return out;
}

/** Open (or all) quarantined rows of the current tenant schema. */
async function listQuarantine({ all = false, table = null, limit = 500 } = {}) {
  const rows = await db.many(`SELECT id, run_id, source_table, source_key, target_table, reason, error, data, created_at, resolved_at, resolved_by, resolution
                              FROM import_quarantine WHERE ($1 OR resolved_at IS NULL) AND ($2::text IS NULL OR source_table = $2) ORDER BY source_table, id LIMIT $3`, [!!all, table, limit]);
  return rows.map(r => ({ ...r, data_masked: maskQuarantineData(r.target_table || r.source_table, r.data) }));
}

/**
 * Try quarantined rows again (after the conflicting row or the stored data was fixed). Rows that now go in are
 * marked resolved ('imported'); the others keep the new error. Runs inside the tenant schema.
 * @param {number[]|null} ids  null = every open row
 */
async function retryQuarantine(ids = null, { by = 'cli', piiKey = null } = {}) {
  const rows = await db.many('SELECT * FROM import_quarantine WHERE resolved_at IS NULL AND ($1::int[] IS NULL OR id = ANY($1)) ORDER BY id', [ids && ids.length ? ids.map(Number) : null]);
  const res = { tried: rows.length, imported: 0, still: 0, errors: [] };
  const report = { repairs: {}, quarantine: { rows: 0, examples: [] } };
  for (const q of rows) {
    const target = q.target_table || q.source_table;
    await db.transaction(async () => {
      const meta = await targetMeta(target);
      const data = q.data || {};
      const cp = legacy.columnPlan(q.source_table, Object.keys(data), meta);
      const ctx = { report, runId: q.run_id, cache: new Map(), onConflict: new Map([[target, '']]), piiKey, schema: db.currentSchema() };
      const entry = { table: q.source_table, target, imported: 0, repaired: 0, quarantined: 0, already_present: 0, archived_values: 0, repairs: {}, quarantine_reasons: {} };
      await insertRow(ctx, entry, meta, data, q.source_key, legacy.transformRow(target, data, cp, meta, ctx));
      if (entry.imported) {
        await db.query("UPDATE import_quarantine SET resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolution = 'imported' WHERE id = $1", [q.id, String(by).slice(0, 100)]);
        if (meta.has('id')) await db.query(`SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${db.ident(target)}), 1))`, [db.currentSchema() + '.' + target]);
        res.imported++;
      } else { res.still++; res.errors.push(`#${q.id} ${q.source_table} ${q.source_key}: ${report.quarantine.examples.slice(-1)[0] || 'refused'}`); }
    });
  }
  return res;
}

/** Mark a quarantined row as handled without importing it (kept for the record). */
async function discardQuarantine(id, { by = 'cli', note = 'discarded' } = {}) {
  const r = await db.query("UPDATE import_quarantine SET resolved_at = CURRENT_TIMESTAMP, resolved_by = $2, resolution = $3 WHERE id = $1 AND resolved_at IS NULL", [Number(id), String(by).slice(0, 100), String(note).slice(0, 20)]);
  return r.rowCount === 1;
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
<div class="muted">${r.verify_only ? '<b>Verify only</b> · ' : r.dry_run ? '<b>Dry run</b> — rehearsed and rolled back, nothing was written · ' : ''}mode ${esc(r.mode)} · source ${esc(r.source)} · ${esc(r.started_at)} → ${esc(r.finished_at)}</div>
<div class="card"><h2>Steps</h2><table>${r.steps.map(s => `<tr><td class="${s.status}">${icon(s.status)}</td><td>${esc(s.name)}</td><td class="muted">${esc(s.detail)}</td></tr>`).join('')}</table></div>
${r.warnings.length ? `<div class="card"><h2 class="warn">Warnings (${r.warnings.length})</h2><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
${r.errors.length ? `<div class="card"><h2 class="fail">Errors</h2><ul>${r.errors.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
${r.totals && r.totals.source_rows !== undefined ? `<div class="card"><h2>Summary · सारांश</h2><table>
<tr><td>Rows in the old database · पुरानो डाटाबेसका पङ्क्ति</td><td class="num">${r.totals.source_rows}</td></tr>
<tr><td>Imported · आयात भयो</td><td class="num">${r.totals.imported}</td></tr>
<tr><td>— of them repaired · मिलाएर आयात</td><td class="num">${r.totals.repaired}</td></tr>
<tr><td>Quarantined (need a fix) · क्वारेन्टाइन</td><td class="num ${r.totals.quarantined ? 'warn' : ''}">${r.totals.quarantined}</td></tr>
<tr><td>Archived (no platform table) · अभिलेखमा राखियो</td><td class="num">${r.totals.archived_rows}</td></tr>
<tr><td>Already present · पहिले नै थियो</td><td class="num">${r.totals.already_present}</td></tr>
<tr><td>Skipped (PHP migration ledger)</td><td class="num">${r.totals.skipped}</td></tr>
<tr><td><b>Every row accounted for · सबै पङ्क्ति हिसाबमा</b></td><td class="num ${r.accounted ? 'ok' : 'fail'}"><b>${r.accounted ? 'yes' : 'NO'}</b></td></tr></table></div>` : ''}
${Object.keys(r.repairs || {}).length ? `<div class="card"><h2>Repairs · मिलाइएका मान</h2><table>${Object.entries(r.repairs).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<tr><td>${esc(k.replace(/_/g, ' '))}</td><td class="num">${n}</td></tr>`).join('')}</table><p class="muted">Original values that had to change are kept in <code>legacy_archive</code>.</p></div>` : ''}
<div class="card"><h2>Tables</h2><table><tr><th>Table</th><th class="num">Old</th><th class="num">New</th><th class="num">Imported</th><th class="num">Repaired</th><th class="num">Quarantined</th><th class="num">Archived</th><th>Status</th><th>Columns kept in archive</th></tr>
${r.tables.filter(t => t.source_rows || t.status === 'copied').map(t => `<tr><td>${esc(t.table)}${t.target && t.target !== t.table ? ` → ${esc(t.target)}` : ''}</td><td class="num">${t.source_rows}</td><td class="num">${t.target_rows ?? '—'}</td><td class="num">${t.imported || ''}</td><td class="num">${t.repaired || ''}</td><td class="num ${t.quarantined ? 'warn' : ''}">${t.quarantined || ''}</td><td class="num">${t.archived_rows || ''}</td><td><span class="badge">${esc(t.status)}</span>${t.reason ? `<div class="muted">${esc(t.reason)}</div>` : ''}</td><td class="muted">${esc((t.dropped_columns || []).join(', '))}${Object.keys(t.mapped || {}).length ? `<div>mapped: ${esc(Object.entries(t.mapped).map(([a, b]) => a + ' → ' + b).join(', '))}</div>` : ''}</td></tr>`).join('')}</table></div>
${(r.unmapped || []).length ? `<div class="card"><h2>Columns without a platform equivalent</h2><p class="muted">Kept per row in <code>legacy_archive</code> (kind "columns").</p><table><tr><th>Column</th><th>Sample values</th></tr>${r.unmapped.map(u => `<tr><td>${esc(u.table + '.' + u.column)}</td><td class="muted">${esc(u.samples.join(' · '))}</td></tr>`).join('')}</table></div>` : ''}
${(r.guards || []).length || (r.relations || []).length ? `<div class="card"><h2>Duplicates and links</h2><ul>${(r.guards || []).map(g => `<li>${esc(g.index)}: ${g.restored ? 'unique rule in place' : `${g.duplicates} duplicates kept — ${esc(g.examples.slice(0, 5).map(x => `${x.k} (ids ${x.ids})`).join('; '))}`}</li>`).join('')}${(r.relations || []).map(x => `<li>${esc(x.child)}.${esc(x.column)} → ${esc(x.parent)}: ${x.orphans} missing (${esc(x.action)}; ids ${esc(x.ids.join(', '))})</li>`).join('')}</ul></div>` : ''}
${r.quarantine && r.quarantine.examples.length ? `<div class="card"><h2 class="warn">Quarantined rows (examples)</h2><ul>${r.quarantine.examples.map(w => `<li><code>${esc(w)}</code></li>`).join('')}</ul><p class="muted">Fix: <code>npm run migrate:site -- --tenant=${esc(r.tenant)} --quarantine</code> (docs/MIGRATION.md).</p></div>` : ''}
${(r.verify_tables || []).length ? `<div class="card"><h2>Verify: source ↔ target</h2><table><tr><th>Table</th><th class="num">Old</th><th class="num">New</th><th class="num">Missing</th><th class="num">Differ</th><th>Checksum</th></tr>${r.verify_tables.map(v => `<tr><td>${esc(v.table)}</td><td class="num">${v.source_rows}</td><td class="num">${v.target_rows}</td><td class="num ${v.missing ? 'fail' : ''}">${v.missing}</td><td class="num ${v.changed ? 'fail' : ''}">${v.changed}</td><td class="${v.ok ? 'ok' : 'fail'}"><code>${esc(v.checksum_source)}</code>${v.checksum_source === v.checksum_target ? ' =' : ' ≠ <code>' + esc(v.checksum_target) + '</code>'}</td></tr>`).join('')}</table></div>` : ''}
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

module.exports = { readPhpSite, migrate, verifyOnly, verifyTables, summary, mysqlSource, htmlReport, fixValue, redact, fileColumns, convertPii, protectGatedUploads, privatiseFileColumns, parseVapid, importHelpTopics, newRunId,
  listQuarantine, retryQuarantine, discardQuarantine, maskQuarantineData, linkLegacyGalleryAlbums };
