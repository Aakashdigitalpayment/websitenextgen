'use strict';
/**
 * Outgoing webhooks to CBS / DMS systems: queued per client, signed with HMAC-SHA256,
 * retried with backoff. Body: { id, event, created_at, tenant, data }.
 * Headers: X-Coop-Event, X-Coop-Delivery, X-Coop-Signature: t=<unix>,v1=<hex hmac of "<t>.<body>">
 */
const crypto = require('crypto');
const db = require('../db');
const vault = require('./credentials-crypto');
const { safeHttpsUrl } = require('./notify');

const BACKOFF_MIN = [1, 5, 15, 60, 180, 360, 720, 1440]; // minutes; then failed

function secretOf(client) {
  if (!client.webhook_secret_enc) return null;
  return vault.decrypt({ password_enc: client.webhook_secret_enc, password_iv: client.webhook_secret_iv, password_tag: client.webhook_secret_tag }).plain;
}

/**
 * Queue an event for every subscribed client (except the one that caused it — avoids sync loops).
 * Call without awaiting from request handlers via notify.later().
 */
async function emit(event, data, { originClientId = null } = {}) {
  const clients = await db.many(`SELECT id FROM api_clients WHERE is_active = 1 AND webhook_url IS NOT NULL AND webhook_url <> '' AND $1 = ANY(webhook_events)`, [event]);
  for (const c of clients) {
    if (c.id === originClientId) continue;
    await db.query('INSERT INTO api_webhook_deliveries (client_id, event, payload) VALUES ($1, $2, $3)', [c.id, event, JSON.stringify(data)]);
  }
}

function sign(secret, ts, body) {
  return crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
}

/** Deliver due webhooks of the current tenant schema. */
async function deliverDue(tenantSlug, limit = 25) {
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const ok = await db.transaction(async () => {
      const d = await db.one(`SELECT w.*, c.webhook_url, c.webhook_secret_enc, c.webhook_secret_iv, c.webhook_secret_tag, c.is_active
                              FROM api_webhook_deliveries w JOIN api_clients c ON c.id = w.client_id
                              WHERE w.status = 'pending' AND w.next_attempt_at <= now()
                              ORDER BY w.next_attempt_at, w.id LIMIT 1 FOR UPDATE OF w SKIP LOCKED`);
      if (!d) return false;
      let httpStatus = null, error = null;
      try {
        if (!d.is_active) throw new Error('client disabled');
        const url = await safeHttpsUrl(d.webhook_url);
        if (!url) throw new Error('webhook host could not be resolved to a public address (https only)');
        const secret = secretOf(d);
        if (!secret) throw new Error('no webhook secret');
        const body = JSON.stringify({ id: String(d.id), event: d.event, created_at: d.created_at, tenant: tenantSlug, data: d.payload });
        const ts = Math.floor(Date.now() / 1000);
        const { fetch: ufetch, Agent } = require('undici');
        const pin = url.pinnedAddress;
        const dispatcher = new Agent({ connect: { lookup: (h, o, cb) => (o && o.all ? cb(null, [pin]) : cb(null, pin.address, pin.family)) } });
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 10_000);
        try {
          const r = await ufetch(url.toString(), {
            method: 'POST', dispatcher, redirect: 'error', signal: ctrl.signal, body,
            headers: { 'content-type': 'application/json', 'user-agent': 'CoopPlatform-Webhooks/1', 'x-coop-event': d.event, 'x-coop-delivery': String(d.id), 'x-coop-signature': `t=${ts},v1=${sign(secret, ts, body)}` },
          });
          httpStatus = r.status;
          if (r.status < 200 || r.status >= 300) error = 'HTTP ' + r.status;
        } finally { clearTimeout(timer); }
      } catch (e) { error = e.name === 'AbortError' ? 'timeout' : String(e.message).slice(0, 250); }
      if (!error) {
        await db.query("UPDATE api_webhook_deliveries SET status = 'delivered', attempts = attempts + 1, last_http_status = $1, last_error = NULL, delivered_at = now() WHERE id = $2", [httpStatus, d.id]);
      } else {
        const attempts = d.attempts + 1;
        const wait = BACKOFF_MIN[attempts - 1];
        await db.query(`UPDATE api_webhook_deliveries SET attempts = $1, last_http_status = $2, last_error = $3,
                        status = $4, next_attempt_at = now() + ($5 || ' minutes')::interval WHERE id = $6`,
          [attempts, httpStatus, error, wait ? 'pending' : 'failed', String(wait || 0), d.id]);
      }
      return true;
    });
    if (!ok) break;
    done++;
  }
  return done;
}

/** Background loop over all tenants (started by server.js). */
function startWorker(intervalMs = 20_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const tenants = await db.many("SELECT slug, schema_name FROM platform.tenants WHERE status = 'active'");
      for (const t of tenants) {
        await db.withSchema(t.schema_name, async () => {
          const has = await db.value("SELECT 1 FROM api_webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= now() LIMIT 1").catch(() => null);
          if (has) await deliverDue(t.slug);
        });
      }
    } catch (e) { console.error('webhook worker:', e.message); } finally { running = false; }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return timer;
}

module.exports = { emit, deliverDue, startWorker, sign, BACKOFF_MIN };
