'use strict';
/** Per-tenant capture of server errors (HTTP 5xx) into app_error_log, shown to superadmins at /admin/error-log. */
const db = require('../db');

const SECRET = /(password|passwd|token|secret|api[_-]?key|otp|cvv)=([^&\s]+)/gi;
const clip = (s, n) => (s == null ? null : String(s).replace(SECRET, '$1=***').slice(0, n));
let lastPrune = 0;

/** Best effort, never throws, never blocks the response. */
function capture(err, req) {
  try {
    const status = Number(err && err.status) || 500;
    if (status < 500 || !req || !req.tenant || !req.tenant.schema_name) return;
    const row = [status, clip(req.method, 10), clip(req.originalUrl || req.url, 500), clip(err && err.message, 2000), clip(err && err.stack, 8000),
      clip(err && err.code, 60), req.admin ? req.admin.id : null, req.member ? req.member.id : null, clip(req.ip, 45), clip(req.get && req.get('user-agent'), 255)];
    db.withSchema(req.tenant.schema_name, async () => {
      await db.query(`INSERT INTO app_error_log (status, method, path, message, stack, code, admin_id, member_id, ip_address, user_agent)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, row);
      if (Date.now() - lastPrune > 3600_000) { // keep the table small: 90 days, max 5000 rows
        lastPrune = Date.now();
        await db.query(`DELETE FROM app_error_log WHERE created_at < now() - interval '90 days' OR id < (SELECT COALESCE(max(id), 0) - 5000 FROM app_error_log)`);
      }
    }).catch(() => {});
  } catch { /* never let logging break error handling */ }
}

module.exports = { capture };
