#!/usr/bin/env node
'use strict';
/**
 * Migrate an existing PHP cooperative website to the new platform, in one command.
 *
 *   # easiest: point at the old site's folder (reads includes/database.local.php, assets/uploads, vault key)
 *   npm run migrate:site -- --tenant=aakash --php-root=/home/olduser/public_html --dry-run
 *   npm run migrate:site -- --tenant=aakash --php-root=/home/olduser/public_html
 *
 *   # or give the pieces yourself
 *   npm run migrate:site -- --tenant=aakash --mysql=mysql://user:pass@host:3306/db --uploads=/path/assets/uploads
 *
 *   # no MySQL server (e.g. on Yeti): the public_html zip and the phpMyAdmin export (.sql / .sql.gz)
 *   npm run migrate:site -- --tenant=aakash --zip=/path/public_html.zip --sql=/path/coop_db.sql --dry-run
 *
 *   # create the tenant on the way
 *   npm run migrate:site -- --tenant=aakash --create --name="आकाश सहकारी" --domain=www.aakashsaccos.com.np \
 *        --admin-password='Temp@12345678' --php-root=/home/olduser/public_html
 *
 * Options:
 *   --dry-run          check everything and print the plan, write nothing
 *   --mode=fresh       (default) empty the tenant tables that the old site has data for, then copy
 *   --mode=incremental only add rows whose id does not exist yet (re-run after a first migration)
 *   --report=path      where to write the HTML report (default reports/migration-<tenant>-<time>.html)
 *   --cred-key=...     PHP CRED_MASTER_KEY if includes/.cred-master.key is not available
 *   --pii-key=...      PHP PII_ENC_KEY (64 hex) if database.local.php / includes/.pii-master.key are not available
 *   --yes              do not ask for confirmation
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const mig = require('../src/lib/site-migration');

function args() {
  const out = { domain: [] };
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!m) continue;
    if (m[1] === 'domain') out.domain.push(m[2]); else out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

async function confirm(q) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise(r => rl.question(q, r));
  rl.close();
  return /^y(es)?$/i.test(a.trim());
}

(async () => {
  const a = args();
  if (!a.tenant) {
    console.error('Usage: npm run migrate:site -- --tenant=<slug> (--php-root=<old public_html> | --mysql=<url> [--uploads=<dir>]) [--dry-run] [--create --name=...]');
    process.exit(2);
  }
  await tenants.applyPlatformSchema();

  if (a.zip || a.sql) return fileImport(a);

  const src = a['php-root'] ? mig.readPhpSite(a['php-root']) : { notes: [] };
  const mysqlUrl = a.mysql || src.mysqlUrl || process.env.MYSQL_URL;
  const uploads = a.uploads || src.uploads || null;
  const credKey = a['cred-key'] || src.credKey || process.env.CREDENTIALS_LEGACY_KEY || null;
  const piiKey = a['pii-key'] || src.piiKey || process.env.PII_LEGACY_KEY || null;
  for (const n of src.notes) console.log('  · ' + n);
  if (!mysqlUrl) throw new Error('No MySQL source: pass --php-root or --mysql');

  let tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [a.tenant]);
  if (!tenant) {
    if (!a.create) throw new Error(`Tenant "${a.tenant}" does not exist. Add --create --name="…" --admin-password=… to create it.`);
    if (a['dry-run']) console.log(`· tenant "${a.tenant}" would be created (dry run)`);
    else {
      tenant = await tenants.createTenant({ slug: a.tenant, name: a.name || a.tenant, nameEn: a['name-en'], domains: a.domain, adminUsername: a.admin || 'admin', adminPassword: a['admin-password'] || require('crypto').randomBytes(12).toString('base64url'), design: null });
      console.log(`✓ tenant "${tenant.slug}" created (schema ${tenant.schema_name})`);
    }
  }

  console.log(`\nMigrating ${mig.redact(mysqlUrl)}${uploads ? ' + ' + uploads : ''} → tenant "${a.tenant}"${a['dry-run'] ? '  [DRY RUN]' : ''}\n`);
  if (!a['dry-run'] && !a.yes && (a.mode || 'fresh') === 'fresh' && tenant) {
    const ok = await confirm(`Mode "fresh" replaces this tenant's data for every table the old site has rows in. Continue? (yes/no) `);
    if (!ok) { console.log('Aborted. (Use --yes to skip this question, or --dry-run first.)'); await db.pool.end(); process.exit(1); }
  }

  const report = tenant
    ? await mig.migrate({ tenant: a.tenant, mysqlUrl, uploads, credKey, piiKey, dryRun: !!a['dry-run'], mode: a.mode === 'incremental' ? 'incremental' : 'fresh', log: s => console.log(s) })
    : { tenant: a.tenant, dry_run: true, steps: [], warnings: ['tenant does not exist yet — run without --dry-run and with --create'], errors: [], tables: [], files: {}, verify: {}, started_at: new Date().toISOString(), finished_at: new Date().toISOString(), mode: 'fresh', source: mig.redact(mysqlUrl) };

  const out = a.report || path.join('reports', `migration-${a.tenant}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, mig.htmlReport(report));
  fs.writeFileSync(out.replace(/\.html$/, '') + '.json', JSON.stringify(report, null, 2));
  console.log(`\n${report.ok === false ? '!' : '✓'} ${report.dry_run ? 'Dry run finished' : 'Migration finished'} — ${report.warnings.length} warnings, ${report.errors.length} row errors`);
  console.log(`  report: ${out}`);
  if (!report.dry_run) console.log(`  next: open https://<tenant domain>/admin, check the site, then switch DNS to the new server.`);
  await db.pool.end();
  process.exit(report.errors.length ? 1 : 0);
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end().catch(() => {}); process.exit(1); });

/** --zip / --sql: the same import as Platform console → Demo data & old site import. */
async function fileImport(a) {
  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [a.tenant]);
  if (!tenant) throw new Error(`Tenant "${a.tenant}" does not exist — create it first (npm run tenant:create).`);
  const mode = a.mode === 'incremental' ? 'incremental' : 'fresh';
  if (!a['dry-run'] && !a.yes && mode === 'fresh') {
    const ok = await confirm(`Mode "fresh" replaces this tenant's data for every table the old site has rows in. Continue? (yes/no) `);
    if (!ok) { console.log('Aborted. (Use --yes to skip this question, or --dry-run first.)'); await db.pool.end(); process.exit(1); }
  }
  const { report, reportFile } = await require('../src/lib/site-import').runImport({
    tenant, zipPath: a.zip ? path.resolve(a.zip) : null, sqlPath: a.sql ? path.resolve(a.sql) : null, dryRun: !!a['dry-run'], mode, log: s => console.log(s),
  });
  console.log(`\n${report.ok === false ? '!' : '✓'} ${report.dry_run ? 'Dry run finished' : 'Migration finished'} — ${report.warnings.length} warnings, ${report.errors.length} row errors`);
  console.log(`  report: ${reportFile}`);
  await db.pool.end();
  process.exit(report.errors.length ? 1 : 0);
}
