'use strict';
/** Superadmin: API clients for CBS / DMS integration. Mounted at /admin/integrations. */
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const api = require('../lib/api');
const vault = require('../lib/credentials-crypto');
const webhooks = require('../lib/webhooks');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('superadmin'));

function readForm(b) {
  const scopes = [].concat(b.scopes || []).filter(s => Object.hasOwn(api.SCOPES, s));
  const events = [].concat(b.events || []).filter(e => Object.hasOwn(api.EVENTS, e));
  const ips = String(b.allowed_ips || '').split(/[\s,]+/).filter(Boolean);
  const badIp = ips.find(ip => !api.ipAllowed(ip.split('/')[0], ip));
  return {
    data: {
      name: String(b.name || '').trim().slice(0, 120), system_type: ['cbs', 'dms', 'other'].includes(b.system_type) ? b.system_type : 'other',
      scopes, allowed_ips: ips.join(', ') || null, webhook_url: String(b.webhook_url || '').trim().slice(0, 500) || null, webhook_events: events,
    },
    error: !String(b.name || '').trim() ? 'Name is required'
      : badIp ? `Invalid IP / CIDR: ${badIp}`
      : b.webhook_url && !/^https:\/\//i.test(String(b.webhook_url).trim()) ? 'Webhook URL must start with https://'
      : b.webhook_url && !vault.enabled() ? 'Webhooks need CREDENTIALS_KEY on the server (the signing secret is stored encrypted)'
      : null,
  };
}

async function list() {
  return db.many(`SELECT c.*, (SELECT count(*) FROM api_request_log l WHERE l.client_id = c.id AND l.created_at > now() - interval '24 hours') AS calls_24h,
                         (SELECT count(*) FROM api_webhook_deliveries w WHERE w.client_id = c.id AND w.status = 'failed') AS failed_hooks
                  FROM api_clients c ORDER BY c.is_active DESC, c.id`);
}

router.get('/', ah(async (req, res) => {
  const [clients, requests, deliveries] = await Promise.all([
    list(),
    db.many(`SELECT l.*, c.name FROM api_request_log l LEFT JOIN api_clients c ON c.id = l.client_id ORDER BY l.id DESC LIMIT 50`),
    db.many(`SELECT w.id, w.event, w.status, w.attempts, w.last_http_status, w.last_error, w.created_at, w.delivered_at, w.next_attempt_at, c.name
             FROM api_webhook_deliveries w JOIN api_clients c ON c.id = w.client_id ORDER BY w.id DESC LIMIT 50`),
  ]);
  const newKey = req.session.newApiKey || null;
  delete req.session.newApiKey;
  res.render('admin/integrations', { title: res.locals.t('CBS / DMS एकीकरण (API)', 'CBS / DMS integration (API)'), clients, requests, deliveries, newKey,
    SCOPES: api.SCOPES, EVENTS: api.EVENTS, edit: null, apiBase: `${req.protocol}://${req.get('host')}/api/v1`, vaultEnabled: vault.enabled() });
}));

router.get('/:id/edit', ah(async (req, res, next) => {
  const edit = await db.one('SELECT * FROM api_clients WHERE id = $1', [util.int(req.params.id)]);
  if (!edit) return next();
  res.render('admin/integrations', { title: res.locals.t('API क्लाइन्ट सम्पादन', 'Edit API client'), clients: await list(), requests: [], deliveries: [], newKey: null,
    SCOPES: api.SCOPES, EVENTS: api.EVENTS, edit, apiBase: `${req.protocol}://${req.get('host')}/api/v1`, vaultEnabled: vault.enabled() });
}));

function newWebhookSecret() {
  const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
  const e = vault.encrypt(secret);
  return { secret, cols: { webhook_secret_enc: e.password_enc, webhook_secret_iv: e.password_iv, webhook_secret_tag: e.password_tag } };
}

router.post('/', ah(async (req, res) => {
  const { data, error } = readForm(req.body);
  if (error) { flash(req, 'error', error); return res.redirect('/admin/integrations'); }
  const k = api.newKey();
  const hook = data.webhook_url ? newWebhookSecret() : null;
  const row = await db.insert('api_clients', { ...data, key_prefix: k.prefix, key_hash: k.hash, created_by: req.admin.id, ...(hook ? hook.cols : {}) });
  await auth.audit(req, 'api_client_create', 'api_clients', row.id, `API client "${row.name}" (${row.scopes.join(' ')})`);
  req.session.newApiKey = { name: row.name, key: k.key, webhookSecret: hook?.secret || null };
  res.redirect('/admin/integrations');
}));

router.post('/:id', ah(async (req, res) => {
  const id = util.int(req.params.id);
  const c = await db.one('SELECT * FROM api_clients WHERE id = $1', [id]);
  if (!c) return res.redirect('/admin/integrations');
  const action = req.body.action;
  if (action === 'save') {
    const { data, error } = readForm(req.body);
    if (error) { flash(req, 'error', error); return res.redirect(`/admin/integrations/${id}/edit`); }
    const extra = data.webhook_url && !c.webhook_secret_enc ? newWebhookSecret() : null;
    await db.update('api_clients', id, { ...data, ...(extra ? extra.cols : {}) });
    if (extra) req.session.newApiKey = { name: c.name, key: null, webhookSecret: extra.secret };
    flash(req, 'success', res.locals.t('सुरक्षित गरियो।', 'Saved.'));
  } else if (action === 'rotate') {
    const k = api.newKey();
    await db.update('api_clients', id, { key_prefix: k.prefix, key_hash: k.hash });
    req.session.newApiKey = { name: c.name, key: k.key, webhookSecret: null };
  } else if (action === 'rotate_webhook' && vault.enabled()) {
    const h = newWebhookSecret();
    await db.update('api_clients', id, h.cols);
    req.session.newApiKey = { name: c.name, key: null, webhookSecret: h.secret };
  } else if (action === 'disable' || action === 'enable') {
    await db.update('api_clients', id, { is_active: action === 'enable' ? 1 : 0 });
  } else if (action === 'delete') {
    await db.query('DELETE FROM api_clients WHERE id = $1', [id]);
  } else if (action === 'retry_failed') {
    await db.query("UPDATE api_webhook_deliveries SET status = 'pending', attempts = 0, next_attempt_at = now() WHERE client_id = $1 AND status = 'failed'", [id]);
  } else if (action === 'test_webhook') {
    await webhooks.emit('member.updated', { test: true, message: 'Test delivery from the cooperative portal' }).catch(() => {});
    await db.query("UPDATE api_webhook_deliveries SET next_attempt_at = now() WHERE client_id = $1 AND status = 'pending'", [id]);
    await webhooks.deliverDue(req.tenant.slug, 5);
    flash(req, 'info', res.locals.t('परीक्षण पठाइयो — तलको सूचीमा नतिजा हेर्नुहोस्।', 'Test sent — see the delivery list below.'));
  }
  await auth.audit(req, 'api_client_' + action, 'api_clients', id, `API client "${c.name}": ${action}`);
  res.redirect('/admin/integrations');
}));

module.exports = router;
