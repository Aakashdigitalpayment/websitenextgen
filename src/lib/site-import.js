'use strict';
/**
 * Migrate an old PHP site from files: the public_html .zip (settings, keys, uploads) plus its MySQL
 * export (.sql / .sql.gz — uploaded separately or found inside the zip). No MySQL server is needed.
 * Runs as a background job of this process (one at a time) for the platform console, or directly
 * from scripts/migrate-site.js (--zip / --sql).
 *
 * Files:  <IMPORT_DIR>/            operators may copy big files here (SFTP / Yeti file manager)
 *         <IMPORT_DIR>/.incoming/  browser uploads (deleted after the job)
 *         <IMPORT_DIR>/.work/<job> unpacked zip (deleted after the job)
 *         <IMPORT_DIR>/reports/    HTML + JSON reports, and the safety snapshot taken before a real run
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const db = require('../db');
const config = require('../config');
const mig = require('./site-migration');
const dump = require('./sql-dump');
const archive = require('./site-archive');

const importDir = () => path.resolve(process.env.IMPORT_DIR || path.join(path.dirname(config.uploadDir), 'imports'));
const dirs = () => {
  const root = importDir();
  return { root, incoming: path.join(root, '.incoming'), work: path.join(root, '.work'), reports: path.join(root, 'reports') };
};
function ensureDirs() {
  const d = dirs();
  for (const p of Object.values(d)) fs.mkdirSync(p, { recursive: true, mode: 0o700 });
  return d;
}

const ZIP_RE = /\.zip$/i, SQL_RE = /\.sql(\.gz)?$/i;
const JOB_RE = /^[a-z0-9-]{8,64}$/;

/** Files an operator has put in the import folder (top level only). */
function serverFiles() {
  const { root } = dirs();
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(e => e.isFile() && !e.name.startsWith('.') && (ZIP_RE.test(e.name) || SQL_RE.test(e.name)))
    .map(e => { const st = fs.statSync(path.join(root, e.name)); return { name: e.name, kind: ZIP_RE.test(e.name) ? 'zip' : 'sql', size: st.size, mtime: st.mtime }; })
    .sort((a, b) => b.mtime - a.mtime);
}
/** Resolve a file name chosen from serverFiles() — never a path outside the import folder. */
function serverFile(name) {
  if (!name) return null;
  const base = path.basename(String(name));
  if (base !== name || base.startsWith('.') || !(ZIP_RE.test(base) || SQL_RE.test(base))) throw new Error('Unknown file: ' + String(name).slice(0, 80));
  const p = path.join(dirs().root, base);
  if (!fs.existsSync(p)) throw new Error('File not found in the import folder: ' + base);
  return p;
}

/** A full copy of the tables a real run will replace (gzip JSON, mode 600) — the way back. */
async function snapshot(tenant, tableNames, file) {
  const out = zlib.createGzip();
  const ws = fs.createWriteStream(file, { mode: 0o600 });
  out.pipe(ws);
  const done = new Promise((resolve, reject) => { ws.on('finish', resolve); ws.on('error', reject); out.on('error', reject); });
  out.write(`{"tenant":${JSON.stringify(tenant.slug)},"schema":${JSON.stringify(tenant.schema_name)},"taken_at":${JSON.stringify(new Date().toISOString())},"tables":{`);
  let k = 0;
  // a plain client: rows stay exactly as stored (encrypted citizenship numbers are not decrypted into the file)
  const client = await db.pool.connect();
  try {
    for (const t of tableNames) {
      const rows = await client.query(`SELECT * FROM ${db.ident(tenant.schema_name)}.${db.ident(t)}`).then(r => r.rows).catch(() => null);
      if (!rows) continue;
      out.write(`${k++ ? ',' : ''}${JSON.stringify(t)}:${JSON.stringify(rows)}`);
    }
  } finally { client.release(); }
  out.end('}}');
  await done;
  return k;
}

/**
 * Run one import.
 * @param {object} o { tenant (row), zipPath?, sqlPath?, dryRun, mode, jobId, log }
 * @returns {Promise<{report, reportFile, jsonFile}>}
 */
async function runImport(o) {
  const log = o.log || (() => {});
  const d = ensureDirs();
  const jobId = o.jobId || newJobId(o.tenant.slug);
  const work = path.join(d.work, jobId);
  try {
    let site = { notes: [] }, sqlFiles = [];
    if (o.zipPath) {
      log(`Unpacking ${path.basename(o.zipPath)} …`);
      const x = await archive.extractSite(o.zipPath, work, { log });
      for (const n of x.notes) log('  · ' + n);
      log(`  ✓ ${x.stats.extracted} files unpacked${x.stats.skipped ? `, ${x.stats.skipped} unsafe or unneeded files left out` : ''}`);
      site = fs.existsSync(x.siteRoot) ? mig.readPhpSite(x.siteRoot) : { notes: [], uploads: null };
      sqlFiles = x.sqlFiles;
      for (const n of site.notes) if (!/no database\.local\.php|pass --/.test(n)) log('  · ' + n);
    }
    let sqlPath = o.sqlPath || null;
    if (!sqlPath && sqlFiles.length) {
      sqlPath = sqlFiles.map(f => ({ f, s: fs.statSync(f).size })).sort((a, b) => b.s - a.s)[0].f;
      log(`  · database export found in the zip: ${path.basename(sqlPath).replace(/^\d+-/, '')}${sqlFiles.length > 1 ? ` (the largest of ${sqlFiles.length})` : ''}`);
    }

    let source;
    if (sqlPath) {
      log(`Reading the database export ${path.basename(sqlPath).replace(/^\d+-/, '')} …`);
      const parsed = dump.parseDump(dump.readDumpFile(sqlPath));
      const rows = [...parsed.tables.values()].reduce((a, t) => a + t.rows.length, 0);
      log(`  ✓ ${parsed.tables.size} tables, ${rows} rows`);
      if (!parsed.tables.size) throw new Error('The SQL file has no tables. Export the database again from phpMyAdmin (Export → Quick → SQL).');
      source = dump.dumpSource(parsed, 'SQL dump ' + path.basename(sqlPath).replace(/^\d+-/, ''));
      source.parseWarnings = parsed.warnings;
    } else if (site.mysqlUrl && o.allowMysql) {
      log(`No SQL export given — connecting to the old MySQL server ${mig.redact(site.mysqlUrl)} …`);
      source = await mig.mysqlSource(site.mysqlUrl);
    } else {
      throw new Error('No database export: upload the .sql file from phpMyAdmin (Export → SQL), or put it inside the zip.');
    }

    // safety snapshot of the tables a real "fresh" run replaces
    let snapshotFile = null;
    if (!o.dryRun) {
      const existing = new Set((await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`, [o.tenant.schema_name])).map(r => r.table_name));
      const touched = [];
      for (const t of await source.tables()) if (existing.has(t) && (await source.count(t)) > 0) touched.push(t);
      snapshotFile = path.join(d.reports, `${jobId}-before.json.gz`);
      const n = await snapshot(o.tenant, touched, snapshotFile);
      log(`  ✓ safety copy of ${n} tables saved before importing (${path.basename(snapshotFile)})`);
    }

    log(o.dryRun ? 'Checking (dry run — nothing is written) …' : `Importing into "${o.tenant.slug}" (mode ${o.mode}) …`);
    const report = await mig.migrate({
      tenant: o.tenant.slug, source, uploads: site.uploads || null, credKey: site.credKey || null, piiKey: site.piiKey || null,
      dryRun: !!o.dryRun, mode: o.mode === 'incremental' ? 'incremental' : 'fresh', log,
    });
    for (const w of source.parseWarnings || []) report.warnings.unshift('SQL file: ' + w);
    report.job = jobId;
    if (snapshotFile) report.snapshot = path.basename(snapshotFile);
    const reportFile = path.join(d.reports, `${jobId}.html`), jsonFile = path.join(d.reports, `${jobId}.json`);
    fs.writeFileSync(reportFile, mig.htmlReport(report), { mode: 0o600 });
    fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    return { report, reportFile, jsonFile };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

function newJobId(slug) {
  return `${String(slug).replace(/[^a-z0-9]/g, '').slice(0, 20) || 't'}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
}

// ---------------------------------------------------------------- background jobs (platform console)
const jobs = new Map(); // id → job (kept in memory; reports stay on disk)
let running = null;

/**
 * Start a job. Upload files (in .incoming) are deleted when it ends; files chosen from the import folder stay.
 * @returns job
 */
function startJob({ tenant, zipPath, sqlPath, dryRun, mode, operator, cleanup = [] }) {
  if (running) throw new Error(`Another migration (${running.tenant}) is still running — wait for it to finish.`);
  const job = { id: newJobId(tenant.slug), tenant: tenant.slug, tenantId: tenant.id, dryRun: !!dryRun, mode: mode === 'incremental' ? 'incremental' : 'fresh',
    operator, status: 'running', started_at: new Date(), finished_at: null, lines: [], error: null, summary: null, files: { zip: zipPath && path.basename(zipPath), sql: sqlPath && path.basename(sqlPath) } };
  const log = line => { job.lines.push(String(line)); if (job.lines.length > 2000) job.lines.splice(0, job.lines.length - 2000); };
  jobs.set(job.id, job);
  running = job;
  setImmediate(async () => {
    try {
      const { report } = await runImport({ tenant, zipPath, sqlPath, dryRun, mode: job.mode, jobId: job.id, log });
      job.summary = { ok: report.ok, warnings: report.warnings.length, errors: report.errors.length, verify: report.verify, snapshot: report.snapshot || null,
        rows: report.tables.reduce((a, t) => a + (t.copied || 0), 0), planned: report.tables.filter(t => t.status === 'planned' || t.status === 'copied').length };
      job.status = report.ok ? 'done' : 'warnings';
      log(report.dry_run ? '✓ Dry run finished — open the report, then run it for real.' : '✓ Migration finished — open the report and check the site.');
    } catch (e) {
      job.status = 'failed';
      job.error = e.message;
      log('✗ ' + e.message);
    } finally {
      job.finished_at = new Date();
      running = null;
      for (const f of cleanup) fs.rm(f, { force: true }, () => {});
    }
  });
  return job;
}

const getJob = id => (JOB_RE.test(String(id)) ? jobs.get(id) || null : null);
const runningJob = () => running;

/** Reports on disk for one tenant (newest first). */
function reportsFor(slug) {
  const { reports } = dirs();
  if (!fs.existsSync(reports)) return [];
  const prefix = String(slug).replace(/[^a-z0-9]/g, '').slice(0, 20) + '-';
  return fs.readdirSync(reports).filter(f => f.startsWith(prefix) && f.endsWith('.json') && !f.endsWith('-before.json.gz'))
    .map(f => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(reports, f), 'utf8'));
        if (r.tenant !== slug) return null;
        return { id: f.replace(/\.json$/, ''), dry_run: r.dry_run, ok: r.ok, mode: r.mode, started_at: r.started_at, warnings: r.warnings.length, errors: r.errors.length, source: r.source, snapshot: r.snapshot || null };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, 20);
}
/** Path of a report (html) for a job id, or null. */
function reportFile(id, slug) {
  if (!JOB_RE.test(String(id))) return null;
  const p = path.join(dirs().reports, id + '.html');
  if (!fs.existsSync(p)) return null;
  try { if (JSON.parse(fs.readFileSync(p.replace(/\.html$/, '.json'), 'utf8')).tenant !== slug) return null; } catch { return null; }
  return p;
}

module.exports = { runImport, startJob, getJob, runningJob, reportsFor, reportFile, serverFiles, serverFile, ensureDirs, dirs, importDir, ZIP_RE, SQL_RE };
