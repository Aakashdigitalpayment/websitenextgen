'use strict';
/** Election results, system health and tenant data backup. Mounted at /admin. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const settings = require('../lib/settings');
const license = require('../lib/license');
const vault = require('../lib/credentials-crypto');
const { tenantDir } = require('../lib/uploads');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ---------------------------------------------------------------- election results
router.get('/elections', auth.requireAdmin('staff'), ah(async (req, res) => {
  const cycles = await db.many(`SELECT c.*, (SELECT count(*) FROM election_vote_submissions s WHERE s.cycle_id = c.id) AS ballots
                                FROM election_cycles c ORDER BY c.date_from DESC NULLS LAST, c.id DESC`);
  res.render('admin/elections', { title: res.locals.t('निर्वाचन नतिजा', 'Election results'), cycles });
}));

router.get('/elections/:id', auth.requireAdmin('staff'), ah(async (req, res, next) => {
  const cycle = await db.one('SELECT * FROM election_cycles WHERE id = $1', [util.int(req.params.id)]);
  if (!cycle) return next();
  const [positions, tallies, ballots, eligible, recent] = await Promise.all([
    db.many('SELECT * FROM election_positions WHERE cycle_id = $1 ORDER BY display_order, id', [cycle.id]),
    db.many(`SELECT c.id, c.position_id, c.name, c.name_en, c.symbol_no, c.photo, count(v.id) AS votes
             FROM election_candidates c LEFT JOIN election_votes v ON v.candidate_id = c.id AND v.cycle_id = c.cycle_id
             WHERE c.cycle_id = $1 AND c.is_active = 1 GROUP BY c.id ORDER BY c.position_id, votes DESC, c.display_order`, [cycle.id]),
    db.value('SELECT count(*) FROM election_vote_submissions WHERE cycle_id = $1', [cycle.id]),
    db.value("SELECT count(*) FROM members WHERE deleted_at IS NULL AND is_active = 1 AND approval_status = 'approved'"),
    db.many(`SELECT s.submitted_at, s.source, m.name, m.sadasyata_number FROM election_vote_submissions s LEFT JOIN members m ON m.id = s.member_id
             WHERE s.cycle_id = $1 ORDER BY s.submitted_at DESC LIMIT 20`, [cycle.id]),
  ]);
  res.render('admin/election-results', { title: res.locals.f(cycle, 'title'), cycle, positions, tallies, ballots, eligible, recent });
}));

// ---------------------------------------------------------------- system health
const dirSize = dir => {
  let total = 0, files = 0;
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { total += fs.statSync(p).size; files++; } } };
  try { walk(dir); } catch { /* missing dir */ }
  return { total, files };
};
const fmtBytes = n => (n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');

router.get('/system', auth.requireAdmin('superadmin'), ah(async (req, res) => {
  const schema = db.currentSchema();
  const s = await settings.all();
  const [dbSize, tables, migrations, pgVersion, failedNotif, admins2fa] = await Promise.all([
    db.value(`SELECT COALESCE(sum(pg_total_relation_size(quote_ident(schemaname) || '.' || quote_ident(tablename))), 0) FROM pg_tables WHERE schemaname = $1`, [schema]),
    db.many(`SELECT relname AS name, n_live_tup AS rows FROM pg_stat_user_tables WHERE schemaname = $1 ORDER BY n_live_tup DESC LIMIT 12`, [schema]),
    db.many('SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC NULLS LAST LIMIT 10'),
    db.value('SHOW server_version'),
    db.value("SELECT count(*) FROM notification_log WHERE status = 'failed' AND created_at > now() - interval '7 days'"),
    db.one('SELECT count(*) FILTER (WHERE twofa_enabled = 1) AS on, count(*) AS total FROM admin_users WHERE deleted_at IS NULL AND is_active = 1'),
  ]);
  const up = dirSize(tenantDir(req));
  const checks = [
    [res.locals.t('इमेल (SMTP)', 'Email (SMTP)'), s.notify_email_enabled === '1' && !!s.smtp_host, s.smtp_host ? s.smtp_host : res.locals.t('सेट गरिएको छैन', 'not configured')],
    ['SMS', s.notify_sms_enabled === '1' && !!s.notify_sms_token, s.notify_sms_gateway || ''],
    [res.locals.t('AI च्याट', 'AI chat'), s.ai_enabled === '1' && !!s.ai_api_key, s.ai_provider || ''],
    [res.locals.t('पासवर्ड भण्डार', 'Credential vault'), vault.enabled(), vault.enabled() ? 'CREDENTIALS_KEY ✓' : 'CREDENTIALS_KEY missing'],
    [res.locals.t('प्रशासक 2FA', 'Admin 2FA'), admins2fa.on === admins2fa.total && admins2fa.total > 0, `${admins2fa.on}/${admins2fa.total}`],
    [res.locals.t('असफल सूचना (७ दिन)', 'Failed notifications (7 days)'), failedNotif === 0, String(failedNotif)],
    [res.locals.t('लाइसेन्स', 'Licence'), !license.status(req.tenant).expired, license.status(req.tenant).until || res.locals.t('म्याद छैन', 'no expiry')],
  ];
  res.render('admin/system', {
    title: res.locals.t('प्रणाली स्थिति', 'System health'), checks, tables, migrations,
    info: { node: process.version, pg: pgVersion, uptime: Math.round(process.uptime() / 60), memory: fmtBytes(process.memoryUsage().rss), schema, dbSize: fmtBytes(dbSize), uploads: `${fmtBytes(up.total)} · ${up.files} files` },
  });
}));

// ---------------------------------------------------------------- backup (JSON export of this tenant)
router.get('/backup', auth.requireAdmin('superadmin'), (req, res) => res.render('admin/backup', { title: res.locals.t('ब्याकअप', 'Backup') }));

router.post('/backup', auth.requireAdmin('superadmin'), ah(async (req, res) => {
  const schema = db.currentSchema();
  const tables = (await db.many(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`, [schema])).map(r => r.table_name);
  // secrets stay out of the file: hashes, vault ciphertext, TOTP secrets, sessions
  const REDACT = { admin_users: ['password', 'twofa_secret', 'twofa_backup_codes'], members: ['password_hash'], office_credentials: ['password_enc', 'password_iv', 'password_tag'], member_otp_tokens: ['otp_code'], site_settings: [] };
  const SECRET_SETTING = /password|api_key|token|secret|private/;
  await auth.audit(req, 'backup', 'tenant', null, `JSON backup downloaded (${tables.length} tables)`);
  res.set('Cache-Control', 'no-store').type('application/json').attachment(`${req.tenant.slug}-backup-${new Date().toISOString().slice(0, 10)}.json`);
  res.write(`{"tenant":${JSON.stringify(req.tenant.slug)},"schema":${JSON.stringify(schema)},"exported_at":${JSON.stringify(new Date().toISOString())},"tables":{`);
  for (const [i, t] of tables.entries()) {
    let rows = await db.many(`SELECT * FROM ${db.ident(t)} ORDER BY 1 LIMIT 200000`);
    if (REDACT[t]) rows = rows.map(r => { const o = { ...r }; for (const k of REDACT[t]) if (k in o) o[k] = null; return o; });
    if (t === 'site_settings') rows = rows.map(r => (SECRET_SETTING.test(r.setting_key) ? { ...r, setting_value: null } : r));
    res.write(`${i ? ',' : ''}${JSON.stringify(t)}:${JSON.stringify(rows)}`);
  }
  res.end('}}');
}));

module.exports = router;
