'use strict';
/** Web push (VAPID keys generated per tenant on first use and kept in site_settings). */
const webpush = require('web-push');
const db = require('../db');
const settings = require('./settings');

async function keys() {
  const s = await settings.all();
  if (s.push_vapid_public && s.push_vapid_private) return { publicKey: s.push_vapid_public, privateKey: s.push_vapid_private, subject: s.email };
  const k = webpush.generateVAPIDKeys();
  await settings.set('push_vapid_public', k.publicKey, { group: 'push', label: 'VAPID public key' });
  await settings.set('push_vapid_private', k.privateKey, { group: 'push', label: 'VAPID private key' });
  return { ...k, subject: s.email };
}

async function sendTo(subs, payload, notifId = null) {
  if (!subs.length) return { sent: 0, failed: 0 };
  const k = await keys();
  const vapid = { subject: /@/.test(k.subject || '') ? 'mailto:' + k.subject : 'mailto:admin@example.com', publicKey: k.publicKey, privateKey: k.privateKey };
  let sent = 0, failed = 0;
  for (const s of subs) {
    let code = 0;
    try {
      const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { vapidDetails: vapid, TTL: 86400, timeout: 10_000 });
      code = r.statusCode; sent++;
    } catch (e) {
      code = e.statusCode || 0; failed++;
      if (code === 404 || code === 410) await db.query('DELETE FROM member_push_subscriptions WHERE id = $1', [s.id]);
    }
    await db.query('INSERT INTO member_push_log (notif_id, member_id, endpoint, http_code, sent_at) VALUES ($1, $2, $3, $4, now())', [notifId, s.member_id, String(s.endpoint).slice(0, 255), code]).catch(() => {});
  }
  return { sent, failed };
}

async function sendToMember(memberId, payload) {
  const subs = await db.many('SELECT * FROM member_push_subscriptions WHERE member_id = $1', [memberId]);
  return sendTo(subs, payload);
}

async function sendToAll(payload) {
  const subs = await db.many('SELECT s.* FROM member_push_subscriptions s JOIN members m ON m.id = s.member_id WHERE m.is_active = 1 AND m.deleted_at IS NULL');
  return sendTo(subs, payload);
}

async function subscribe(memberId, sub, ua) {
  if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('bad subscription');
  await db.query(`INSERT INTO member_push_subscriptions (member_id, endpoint, p256dh, auth, user_agent, created_at) VALUES ($1, $2, $3, $4, $5, now())
                  ON CONFLICT (md5(endpoint)) DO UPDATE SET member_id = EXCLUDED.member_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [memberId, sub.endpoint.slice(0, 2000), String(sub.keys.p256dh).slice(0, 255), String(sub.keys.auth).slice(0, 255), String(ua || '').slice(0, 255)]);
}

async function unsubscribe(memberId, endpoint) {
  await db.query('DELETE FROM member_push_subscriptions WHERE member_id = $1 AND endpoint = $2', [memberId, String(endpoint || '')]);
}

module.exports = { keys, sendToMember, sendToAll, subscribe, unsubscribe };
