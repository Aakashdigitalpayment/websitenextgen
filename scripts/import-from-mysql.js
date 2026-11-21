#!/usr/bin/env node
'use strict';
/**
 * Copy a legacy MySQL database (the PHP site) into one tenant's PostgreSQL schema.
 * Kept for older run books; it is the same import as `npm run migrate:site -- --mysql=…` (src/lib/site-migration.js,
 * mapping in src/lib/legacy-map.js): every row is imported, repaired, quarantined or archived — nothing is dropped.
 *
 *   node scripts/import-from-mysql.js --tenant=aakash --mysql=mysql://user:pass@host:3306/dbname \
 *        [--uploads=/path/to/old-site/assets/uploads] [--truncate] [--dry-run] [--cred-key=…] [--pii-key=…]
 *
 * --truncate  replace the tenant's rows for every table the old site has data in (mode "fresh");
 *             without it only rows whose key does not exist yet are added (mode "incremental").
 */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const mig = require('../src/lib/site-migration');

function args() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([\w-]+)(?:=(.*))?$/);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

(async () => {
  const a = args();
  const mysqlUrl = a.mysql || process.env.MYSQL_URL;
  if (!a.tenant || !mysqlUrl) {
    console.error('Usage: node scripts/import-from-mysql.js --tenant=<slug> --mysql=mysql://user:pass@host/db [--uploads=dir] [--truncate] [--dry-run]');
    process.exit(2);
  }
  const report = await mig.migrate({
    tenant: a.tenant, mysqlUrl, uploads: a.uploads ? path.resolve(String(a.uploads)) : null,
    credKey: a['cred-key'] || process.env.CREDENTIALS_LEGACY_KEY || null, piiKey: a['pii-key'] || process.env.PII_LEGACY_KEY || null,
    dryRun: !!a['dry-run'], mode: a.truncate ? 'fresh' : 'incremental', log: s => console.log(s),
  });
  const out = path.join('reports', `migration-${a.tenant}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, mig.htmlReport(report), { mode: 0o600 });
  fs.writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  console.log('\n' + mig.summary(report) + `\n  report: ${out}`);
  await db.pool.end();
  process.exit(report.errors.length || report.accounted === false ? 1 : 0);
})().catch(async e => { console.error('✗ ' + e.message); await db.pool.end().catch(() => {}); process.exit(1); });
