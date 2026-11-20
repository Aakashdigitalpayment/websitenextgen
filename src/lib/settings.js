'use strict';
/** Per-tenant site_settings, cached briefly per schema. */
const db = require('../db');

const cache = new Map(); // schema -> { at, map }
const TTL = 15_000;

async function all() {
  const schema = db.currentSchema();
  const hit = cache.get(schema);
  if (hit && Date.now() - hit.at < TTL) return hit.map;
  const rows = await db.many('SELECT setting_key, setting_value FROM site_settings');
  const map = withLegacy(Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value ?? ''])));
  cache.set(schema, { at: Date.now(), map });
  return map;
}

// ---------------------------------------------------------------- PHP-era setting keys
// The PHP app stored some settings under other names. mapLegacy() copies them across once (site import / migration 063);
// withLegacy() applies the same mapping at read time so tenants imported earlier work without re-importing.
const PHP_EVENTS = { loan_application: 'loan', kyc_application: 'kyc', account_application: 'account', job_application: 'job', contact_message: 'contact',
  honor_application: 'honor', digital_service: 'digital', grievance: 'grievance', appointment: 'appointment', member_marketplace: 'marketplace' };
const blank = v => v === undefined || v === null || String(v).trim() === '';
const DEFAULT_TAGLINE = 'सदस्यको हितमा, समुदायको साथमा';

/** PHP "enc:v1:<iv hex>:<cipher b64>" (AES-256-CBC, key sha256(CRED_MASTER_KEY)) → plain text, or '' when it cannot be opened. */
function decryptLegacy(value, key = process.env.CREDENTIALS_LEGACY_KEY) {
  const m = String(value || '').match(/^enc:v1:([0-9a-f]{32}):([A-Za-z0-9+/=]+)$/i);
  if (!m) return value;
  if (!key) return '';
  try {
    const crypto = require('crypto');
    const d = crypto.createDecipheriv('aes-256-cbc', crypto.createHash('sha256').update(key).digest(), Buffer.from(m[1], 'hex'));
    return Buffer.concat([d.update(Buffer.from(m[2], 'base64')), d.final()]).toString('utf8');
  } catch { return ''; }
}

/** Node key → value derived from the PHP keys in `s` (only for Node keys that are blank). */
function legacyValues(s, credKey) {
  const out = {};
  const fill = (key, v) => { if (blank(s[key]) && !blank(v)) out[key] = String(v); };
  fill('ai_enabled', s.ai_chat_enabled);
  fill('ai_welcome_np', s.ai_welcome);
  fill('notify_admin_emails', s.notify_email_recipients);
  fill('smtp_from_email', s.notify_email_from);
  fill('notify_email_enabled', !blank(s.smtp_enabled) ? s.smtp_enabled : s.notify_smtp_enabled);
  if (String(s.notify_member_enabled) === '0') { fill('notify_member_email', '0'); fill('notify_member_sms', '0'); }
  if (!blank(s.site_slogan) && (blank(s.site_tagline) || s.site_tagline === DEFAULT_TAGLINE)) out.site_tagline = s.site_slogan;
  if (blank(s.map_embed_url)) {
    const { normalizeMapEmbed, coordsEmbed } = require('./setting-defs');
    fill('map_embed_url', (s.google_map_url && normalizeMapEmbed(s.google_map_url)) || coordsEmbed(s.map_lat, s.map_lng));
  }
  for (const [php, node] of Object.entries(PHP_EVENTS)) for (const ch of ['email', 'sms']) fill(`notify_${ch}_${node}`, s[`notify_${ch}_${php}`]);
  if (/^enc:v1:/.test(s.ai_api_key || '')) out.ai_api_key = decryptLegacy(s.ai_api_key, credKey || process.env.CREDENTIALS_LEGACY_KEY);
  return out;
}
const withLegacy = map => Object.assign(map, legacyValues(map));

/** Write the mapped keys (site import). credKey = the PHP CRED_MASTER_KEY, to re-store an encrypted AI key in clear. */
async function mapLegacy(credKey) {
  const rows = await db.many('SELECT setting_key, setting_value FROM site_settings');
  const out = legacyValues(Object.fromEntries(rows.map(r => [r.setting_key, r.setting_value ?? ''])), credKey);
  const groups = { ai_enabled: 'ai', ai_welcome_np: 'ai', ai_api_key: 'ai', site_tagline: 'general', map_embed_url: 'contact' };
  for (const [k, v] of Object.entries(out)) await set(k, v, { group: groups[k] || 'notify', label: k, type: k === 'map_embed_url' ? 'url' : 'text' });
  return Object.keys(out);
}

async function get(key, fallback = '') {
  const v = (await all())[key];
  return v === undefined || v === '' ? fallback : v;
}

/** Upsert one setting. meta { type, label, group } is used for a new row; meta.sync also corrects an existing row's type/group/label. */
async function set(key, value, meta = {}) {
  await db.query(
    `INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP${meta.sync
      ? ', setting_type = EXCLUDED.setting_type, setting_label = EXCLUDED.setting_label, setting_group = EXCLUDED.setting_group' : ''}`,
    [key, value, meta.type || 'text', meta.label || key, meta.group || 'general']);
  cache.delete(db.currentSchema());
}

async function grouped() {
  return db.many('SELECT * FROM site_settings ORDER BY setting_group, id');
}

module.exports = { all, get, set, grouped, mapLegacy, legacyValues, decryptLegacy, invalidate: () => cache.delete(db.currentSchema()) };
