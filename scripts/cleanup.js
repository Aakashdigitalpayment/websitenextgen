#!/usr/bin/env node
'use strict';
/**
 * Daily housekeeping for every tenant (replaces the PHP cron-cleanup.php).
 *   node scripts/cleanup.js            # cron: 30 2 * * *  cd /opt/websitenextgen && node scripts/cleanup.js
 * Removes expired / old operational rows only — never applications, members or content.
 */
const db = require('../src/db');

const RULES = [
  ['login_attempts', "attempted_at < now() - interval '2 days'"],
  ['member_otp_tokens', "expires_at < now() - interval '1 day' OR is_used = 1"],
  ['card_verify_attempts', "created_at < now() - interval '90 days'"],
  ['program_attendance_attempts', "attempted_at < now() - interval '180 days'"],
  ['member_push_log', "sent_at < now() - interval '90 days'"],
  ['notification_log', "created_at < now() - interval '365 days'"],
  ['member_notifications', "is_read = 1 AND created_at < now() - interval '365 days'"],
  ['visitor_counter', "created_at < now() - interval '90 days'"],
  ['member_import_rows', "job_id IN (SELECT id FROM member_import_jobs WHERE created_at < now() - interval '90 days')"],
  ['member_password_reset_requests', "status <> 'pending' AND resolved_at < now() - interval '180 days'"],
];

(async () => {
  const removedSessions = (await db.query('DELETE FROM platform.user_sessions WHERE expire < now()')).rowCount;
  console.log(`platform: ${removedSessions} expired sessions`);
  const tenants = await db.many('SELECT slug, schema_name FROM platform.tenants ORDER BY slug');
  for (const t of tenants) {
    await db.withSchema(t.schema_name, async () => {
      const out = [];
      for (const [table, where] of RULES) {
        const exists = await db.value(`SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`, [t.schema_name, table]);
        if (!exists) continue;
        const n = (await db.query(`DELETE FROM ${db.ident(table)} WHERE ${where}`)).rowCount;
        if (n) out.push(`${table}=${n}`);
      }
      // temporary passwords shown to staff once must not linger
      await db.query("UPDATE member_password_reset_requests SET temp_password = NULL WHERE temp_password IS NOT NULL").catch(() => {});
      console.log(`${t.slug}: ${out.join(', ') || 'nothing to remove'}`);
    });
  }
  await db.pool.end();
})().catch(async e => { console.error(e.message); await db.pool.end(); process.exit(1); });
