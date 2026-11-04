#!/usr/bin/env node
// One-time database + env file set-up on Yeti Cloud (docs/YETI.md). Run on the Node.js node, from the checkout:
//
//   node deploy/yeti/setup-db.mjs --host nodeNNNNN-coopweb.ktm.yetiappcloud.com [--base-domain coopcloud.com.np]
//
// Asks for the PostgreSQL node's webadmin password (from Yeti's email; hidden, or on stdin without a terminal),
// then — only what is still missing, so it is safe to run again:
//   - creates role `coop` (long random password) and database `coop` owned by it, closed to everyone else;
//   - writes /home/jelastic/coop.env (mode 600): DATABASE_URL, SESSION_SECRET, CREDENTIALS_KEY, PII_KEY,
//     NODE_ENV, PORT=8080, HOST=0.0.0.0, TRUST_PROXY=1, UPLOAD_DIR, BASE_DOMAIN, PLATFORM_HOST, CNAME_ZONE …
//   - never replaces a value that is already in the env file (keys are generated once and must never change:
//     PII_KEY and CREDENTIALS_KEY are the only way to read encrypted citizenship numbers / office passwords).
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(ROOT, 'package.json'));
const pg = require('pg');

const { values: args } = parseArgs({
  options: {
    host: { type: 'string' },
    port: { type: 'string', default: '5432' },
    db: { type: 'string', default: 'coop' },
    role: { type: 'string', default: 'coop' },
    'admin-user': { type: 'string', default: 'webadmin' },
    'env-path': { type: 'string', default: process.env.COOP_ENV_FILE ?? '/home/jelastic/coop.env' },
    'data-dir': { type: 'string', default: '/home/jelastic/coop-data' },
    'base-domain': { type: 'string' },
    'platform-host': { type: 'string' },
    'new-password': { type: 'boolean', default: false },
  },
});
const fail = m => { console.error(`✗ ${m}`); process.exit(1); };
if (!args.host) fail('--host <PostgreSQL node> is required (dashboard → SQL node name)');
if (!/^[a-z_][a-z0-9_]{0,40}$/.test(args.db) || !/^[a-z_][a-z0-9_]{0,40}$/.test(args.role)) fail('bad --db / --role name');

// ---------------------------------------------------------------- env file helpers (never print values)
const envPath = args['env-path'];
let envText = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const envGet = k => (envText.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim() ?? '';
const envSet = (k, v, { force = false } = {}) => {
  const cur = envGet(k);
  if (cur && !force) return false;
  envText = new RegExp(`^${k}=`, 'm').test(envText) ? envText.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${envText.replace(/\n?$/, '\n')}${k}=${v}\n`;
  return true;
};

async function askHidden(q) {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise(resolve => { let d = ''; stdin.setEncoding('utf8'); stdin.on('data', c => (d += c)); stdin.on('end', () => resolve(d.split('\n')[0].trim())); });
  }
  process.stdout.write(q);
  return new Promise(resolve => {
    let s = ''; stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = c => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); return resolve(s); }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u007f') s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const password = await askHidden(`Password for ${args['admin-user']}@${args.host} (not shown): `);
if (!password) fail('empty password');
const admin = new pg.Client({ host: args.host, port: Number(args.port), user: args['admin-user'], password, database: 'postgres', connectionTimeoutMillis: 10_000 });
try { await admin.connect(); } catch (e) { fail(`Could not connect to PostgreSQL (${e.code ?? e.message}). Check the host and the webadmin password.`); }

const ident = s => '"' + s.replace(/"/g, '""') + '"';
const role = args.role, db = args.db;
const had = (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount > 0;
const curUrl = envGet('DATABASE_URL');
let rolePw = null;
if (!had || args['new-password'] || !curUrl || curUrl.includes('CHANGE_ME')) {
  if (had && !args['new-password'] && (!curUrl || curUrl.includes('CHANGE_ME'))) fail(`role ${role} exists but DATABASE_URL is not in ${envPath}: run again with --new-password`);
  rolePw = randomBytes(24).toString('base64url');
  await admin.query(`${had ? 'ALTER' : 'CREATE'} ROLE ${ident(role)} LOGIN PASSWORD '${rolePw.replace(/'/g, "''")}'${had ? '' : ' NOSUPERUSER NOCREATEROLE NOCREATEDB'}`);
  console.log(`• role ${role} ${had ? 'password changed' : 'created'}`);
} else console.log(`• role ${role} already exists (password unchanged)`);

if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db])).rowCount === 0) {
  // the owner must be grantable by webadmin
  await admin.query(`GRANT ${ident(role)} TO CURRENT_USER`).catch(() => {});
  await admin.query(`CREATE DATABASE ${ident(db)} OWNER ${ident(role)} ENCODING 'UTF8' TEMPLATE template0`);
  console.log(`• database ${db} created`);
} else console.log(`• database ${db} already exists`);
await admin.query(`REVOKE ALL ON DATABASE ${ident(db)} FROM PUBLIC`);
await admin.query(`GRANT ALL ON DATABASE ${ident(db)} TO ${ident(role)}`);
await admin.query(`ALTER DATABASE ${ident(db)} SET timezone TO 'Asia/Kathmandu'`);
await admin.end();

// ---------------------------------------------------------------- env file
const host = args.host;
if (rolePw) envSet('DATABASE_URL', `postgres://${role}:${encodeURIComponent(rolePw)}@${host}:${args.port}/${db}`, { force: true });
const rnd = n => randomBytes(n).toString('hex');
const made = [];
if (envSet('SESSION_SECRET', rnd(32))) made.push('SESSION_SECRET');
if (envSet('CREDENTIALS_KEY', rnd(32))) made.push('CREDENTIALS_KEY');
if (envSet('PII_KEY', rnd(32))) made.push('PII_KEY');
envSet('NODE_ENV', 'production');
envSet('PORT', '8080');
envSet('HOST', '0.0.0.0');
envSet('TRUST_PROXY', '1');
envSet('APP_TIMEZONE', 'Asia/Kathmandu');
envSet('UPLOAD_DIR', join(args['data-dir'], 'uploads'));
envSet('MAX_IMAGE_MB', '40');
envSet('DEFAULT_TENANT', '');
// <env>.<region>.yetiappcloud.com — derived from the PostgreSQL node name when not given
const envDomain = host.replace(/^node\d+-/, '');
const base = args['base-domain'] || envGet('BASE_DOMAIN') || envDomain;
envSet('BASE_DOMAIN', base);
envSet('PLATFORM_HOST', args['platform-host'] || envGet('PLATFORM_HOST') || (base === envDomain ? envDomain : `admin.${base}`));
envSet('CNAME_ZONE', base);
writeFileSync(envPath, envText, { mode: 0o600 });
chmodSync(envPath, 0o600);

// ---------------------------------------------------------------- check as the app role
const check = new pg.Client({ connectionString: envGet('DATABASE_URL'), connectionTimeoutMillis: 10_000 });
try {
  await check.connect();
  const r = await check.query('SELECT current_user, current_database()');
  await check.end();
  console.log(`✓ ready: ${r.rows[0].current_user}@${r.rows[0].current_database} — env file ${envPath} (mode 600)`);
} catch (e) { fail(`the app role cannot connect (${e.code ?? e.message})`); }
if (made.length) console.log(`• new secrets: ${made.join(', ')} — copy ${envPath} to your password manager; PII_KEY/CREDENTIALS_KEY must never change`);
