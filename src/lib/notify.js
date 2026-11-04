'use strict';
/**
 * Outbound notifications for the current tenant: SMS (Sparrow / Aakash / webhook),
 * email (SMTP via nodemailer), in-portal member notifications and web push.
 * Everything is best-effort: failures are written to notification_log, never thrown.
 */
const dns = require('dns').promises;
const net = require('net');
const nodemailer = require('nodemailer');
const db = require('../db');
const settings = require('./settings');
const push = require('./push');

// ---------------------------------------------------------------- helpers
function render(tpl, vars) {
  return String(tpl || '').replace(/\\n/g, '\n').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (vars[k] ?? '')).trim();
}

const ipaddr = require('ipaddr.js');
/** Anything that is not a plain public unicast address (also IPv4-mapped / NAT64 forms) counts as private. */
const isPrivateIp = ip => {
  try {
    let a = ipaddr.parse(ip);
    if (a.kind() === 'ipv6' && a.isIPv4MappedAddress()) a = a.toIPv4Address();
    if (a.kind() === 'ipv6' && a.range() === 'rfc6052') return true; // 64:ff9b::/96 NAT64 can reach IPv4 internals
    return a.range() !== 'unicast';
  } catch { return true; }
};

/** Only https URLs that resolve to public addresses (admin-configured webhooks must not reach internal services). */
async function safeHttpsUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  try {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) return null;
    u.pinnedAddress = addrs[0];
  } catch { return null; }
  return u;
}

/**
 * fetch with timeout and no redirects. For admin-configured URLs the connection is pinned to the
 * address that passed safeHttpsUrl (no DNS-rebinding between check and use).
 */
async function fetchWithTimeout(url, opts = {}, ms = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    if (url && url.pinnedAddress) {
      const { fetch: ufetch, Agent } = require('undici');
      const pin = url.pinnedAddress;
      const dispatcher = new Agent({ connect: { lookup: (host, o, cb) => (o && o.all ? cb(null, [pin]) : cb(null, pin.address, pin.family)) } });
      return await ufetch(url.toString(), { ...opts, dispatcher, redirect: 'error', signal: ctrl.signal });
    }
    return await fetch(url, { ...opts, redirect: 'error', signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

/** Daily caps: per tenant (settings) and per recipient (3/day per event) — stops SMS/email bombing via public forms. */
async function overLimit(channel, event, recipient) {
  const s = await settings.all();
  const daily = Number(s[channel === 'sms' ? 'notify_sms_daily_limit' : 'notify_email_daily_limit']) || (channel === 'sms' ? 300 : 1000);
  const r = await db.one(`SELECT count(*) FILTER (WHERE channel = $1) AS all_today,
                                 count(*) FILTER (WHERE channel = $1 AND recipient = $2 AND event_type = $3) AS this_one
                          FROM notification_log WHERE created_at >= CURRENT_DATE AND status = 'sent'`, [channel, recipient, event]);
  if (r.all_today >= daily) return 'daily limit reached';
  if (event !== 'test' && r.this_one >= 3) return 'recipient limit reached';
  return null;
}

/** Text from the public goes into messages only in a short, link-free form. */
const safeText = (v, n = 60) => String(v ?? '').replace(/https?:\/\/\S+|www\.\S+|[<>]/gi, '').replace(/\s+/g, ' ').trim().slice(0, n);

async function log(event, channel, recipient, subject, message, ok, error = '') {
  try {
    await db.query(`INSERT INTO notification_log (event_type, channel, recipient, subject, message, status, error_msg, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [String(event).slice(0, 50), channel, String(recipient || '').slice(0, 255), String(subject || '').slice(0, 255), String(message || '').slice(0, 2000), ok ? 'sent' : 'failed', String(error || '').slice(0, 255)]);
  } catch (e) { console.error('notification_log:', e.message); }
}

const normalizePhone = p => {
  const d = String(p || '').replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c)).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
};

// ---------------------------------------------------------------- channels
async function sendSms(event, phone, text) {
  const s = await settings.all();
  const to = normalizePhone(phone);
  if (s.notify_sms_enabled !== '1') return { ok: false, skipped: 'sms disabled' };
  if (!to) return { ok: false, skipped: 'no phone' };
  const limited = await overLimit('sms', event, to);
  if (limited) { await log(event, 'sms', to, '', text, false, limited); return { ok: false, skipped: limited }; }
  const gateway = s.notify_sms_gateway || 'sparrow';
  let ok = false, error = '';
  try {
    if (gateway === 'sparrow') {
      const r = await fetchWithTimeout('https://api.sparrowsms.com/v2/sms/', {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: s.notify_sms_token || '', from: s.notify_sms_sender_id || '', to, text }),
      });
      const j = await r.json().catch(() => ({}));
      ok = r.ok && Number(j.response_code) === 200;
      error = ok ? '' : j.message || 'HTTP ' + r.status;
    } else {
      const url = await safeHttpsUrl(s.notify_sms_api_url);
      if (!url) throw new Error('SMS API URL must be a public https URL');
      if (gateway === 'aakash') {
        for (const [k, v] of Object.entries({ auth: s.notify_sms_token || '', msisdn: to, message: text, senderid: s.notify_sms_sender_id || '' })) url.searchParams.set(k, v);
        const r = await fetchWithTimeout(url);
        ok = r.ok; error = ok ? '' : 'HTTP ' + r.status;
      } else {
        const r = await fetchWithTimeout(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: to, message: text, token: s.notify_sms_token || '' }) });
        ok = r.ok; error = ok ? '' : 'HTTP ' + r.status;
      }
    }
  } catch (e) { error = e.name === 'AbortError' ? 'timeout' : e.message; }
  await log(event, 'sms', to, '', text, ok, error);
  return { ok, error };
}

const transports = new Map(); // schema -> { key, transport }
async function transport() {
  const s = await settings.all();
  if (!s.smtp_host) return null;
  const key = [s.smtp_host, s.smtp_port, s.smtp_user, s.smtp_password, s.smtp_encryption].join('|');
  const hit = transports.get(db.currentSchema());
  if (hit && hit.key === key) return hit.transport;
  const t = nodemailer.createTransport({
    host: s.smtp_host, port: Number(s.smtp_port) || 587, secure: s.smtp_encryption === 'ssl',
    requireTLS: s.smtp_encryption === 'tls', ignoreTLS: s.smtp_encryption === 'none',
    auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_password } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000,
  });
  transports.set(db.currentSchema(), { key, transport: t });
  return t;
}

async function sendEmail(event, to, subject, text) {
  const s = await settings.all();
  if (s.notify_email_enabled !== '1') return { ok: false, skipped: 'email disabled' };
  const list = String(to || '').split(/[,;\s]+/).filter(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
  if (!list.length) return { ok: false, skipped: 'no email' };
  const limited = await overLimit('email', event, list.join(','));
  if (limited) { await log(event, 'email', list.join(','), subject, text, false, limited); return { ok: false, skipped: limited }; }
  let ok = false, error = '';
  try {
    const t = await transport();
    if (!t) throw new Error('SMTP not configured');
    const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const color = /^#[0-9a-f]{3,8}$/i.test(s.primary_color || '') ? s.primary_color : '#0f766e';
    await t.sendMail({
      from: { name: s.smtp_from_name || s.site_name || 'Cooperative', address: s.smtp_from_email || s.smtp_user },
      to: list, subject, text,
      html: `<div style="font-family:Inter,'Noto Sans Devanagari',Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #e6e6e3;border-radius:12px;overflow:hidden">
        <div style="background:${color};color:#fff;padding:14px 20px;font-weight:600">${esc(s.site_name || '')}</div>
        <div style="padding:20px;color:#1c1f23;line-height:1.6;white-space:pre-wrap">${esc(text)}</div></div>`,
    });
    ok = true;
  } catch (e) { error = e.message; }
  await log(event, 'email', list.join(','), subject, text, ok, error);
  return { ok, error };
}

/** In-portal notification + web push for a member. */
async function notifyMember(memberId, title, message = null, link = null, type = 'info') {
  if (!memberId) return;
  await db.query(`INSERT INTO member_notifications (member_id, title, message, type, link, is_read, created_at) VALUES ($1, $2, $3, $4, $5, 0, now())`,
    [memberId, String(title).slice(0, 255), message, type, link]);
  later(() => push.sendToMember(memberId, { title, body: message || '', url: link || '/member/notifications' }));
}

// ---------------------------------------------------------------- templated events
async function template(event, audience, channel) {
  return db.one('SELECT * FROM notification_templates WHERE event_type = $1 AND audience = $2 AND channel = $3 AND enabled = 1', [event, audience, channel]);
}

/**
 * Fire an application event. vars: name, tracking_id, module, status, remarks.
 * contact: { phone, email }. Runs detached from the request (call without await).
 */
async function applicationEvent(event, vars, contact = {}) {
  try {
    const s = await settings.all();
    const v = { site: s.site_name || '', ...vars, name: safeText(vars.name, 40), remarks: safeText(vars.remarks, 160), status: safeText(vars.status, 40) };
    const memberAllowed = ch => event !== 'status_changed' || s['notify_member_' + ch] !== '0';
    const sms = memberAllowed('sms') && contact.phone ? await template(event, 'member', 'sms') : null;
    if (sms) await sendSms(event, contact.phone, render(sms.body, v));
    const mail = memberAllowed('email') && contact.email ? await template(event, 'member', 'email') : null;
    if (mail) await sendEmail(event, contact.email, render(mail.subject, v), render(mail.body, v));
    if (event === 'submitted' && s.notify_admin_emails) {
      const adm = await template(event, 'admin', 'email');
      if (adm) await sendEmail(event + ':admin', s.notify_admin_emails, render(adm.subject, v), render(adm.body, v));
    }
  } catch (e) { console.error('notify:', e.message); }
}

/** Run fn after the response without losing the tenant schema context. */
function later(fn) {
  const schema = db.currentSchema();
  // fresh context: same tenant schema, but never the (soon released) transaction client
  setImmediate(() => db.withSchema(schema, () => Promise.resolve().then(fn).catch(e => console.error('later:', e.message))));
}

module.exports = { sendSms, sendEmail, notifyMember, applicationEvent, render, later, safeHttpsUrl, normalizePhone, isPrivateIp, overLimit };
