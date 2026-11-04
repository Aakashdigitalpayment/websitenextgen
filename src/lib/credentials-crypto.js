'use strict';
/**
 * Office credential vault crypto.
 * New rows: AES-256-GCM, key = HKDF-SHA256(CREDENTIALS_KEY, salt = tenant schema).
 * Legacy PHP rows (password_tag NULL): AES-256-CBC with sha256(CREDENTIALS_LEGACY_KEY) — the
 * PHP app's CRED_MASTER_KEY. They are re-encrypted with GCM the first time they are opened.
 */
const crypto = require('crypto');
const db = require('../db');

const master = () => process.env.CREDENTIALS_KEY || '';
const enabled = () => master().length >= 32;

function tenantKey() {
  if (!enabled()) throw new Error('CREDENTIALS_KEY is not configured (min 32 chars)');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(master()), Buffer.from(db.currentSchema() || 'platform'), Buffer.from('office-credentials'), 32));
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', tenantKey(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return { password_enc: enc.toString('base64'), password_iv: iv.toString('hex'), password_tag: c.getAuthTag().toString('hex') };
}

function decrypt(row) {
  if (row.password_tag) {
    const d = crypto.createDecipheriv('aes-256-gcm', tenantKey(), Buffer.from(row.password_iv, 'hex'));
    d.setAuthTag(Buffer.from(row.password_tag, 'hex'));
    return { plain: Buffer.concat([d.update(Buffer.from(row.password_enc, 'base64')), d.final()]).toString('utf8'), legacy: false };
  }
  const legacyKey = process.env.CREDENTIALS_LEGACY_KEY;
  if (!legacyKey) throw new Error('Legacy entry: set CREDENTIALS_LEGACY_KEY (the PHP CRED_MASTER_KEY) or re-enter the password');
  const key = crypto.createHash('sha256').update(legacyKey).digest();
  const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(row.password_iv, 'hex'));
  return { plain: Buffer.concat([d.update(Buffer.from(row.password_enc, 'base64')), d.final()]).toString('utf8'), legacy: true };
}

module.exports = { enabled, encrypt, decrypt };
