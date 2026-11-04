'use strict';
/**
 * PII field encryption at rest (citizenship numbers on KYC / loan / account / membership).
 *
 * New values:  "pii3:" + base64(nonce12 | tag16 | ciphertext), AES-256-GCM, AAD "pii3".
 *   Keys are per tenant: HKDF-SHA256(PII_KEY, salt = tenant schema). The nonce is an HMAC of
 *   the plaintext (SIV-style, as in the PHP app) so equal values encrypt equally and exact-match
 *   search (WHERE citizenship_no = enc(q)) keeps working.
 * Legacy PHP values (includes/pii-crypto.php, key PII_ENC_KEY / includes/.pii-master.key):
 *   "pii1:" libsodium secretbox, "pii2:" AES-256-GCM. Read with PII_LEGACY_KEY or an explicit key.
 *
 * OFF until PII_KEY is set: values are stored as typed. Plaintext / undecryptable values are
 * always returned unchanged, so a mixed table (old plaintext + encrypted) reads fine.
 */
const crypto = require('crypto');
const secretbox = require('./secretbox');

const MAX_PLAIN = 330; // keeps the encoded value inside VARCHAR(512)
const PII_COLUMNS = {
  kyc_applications: ['citizenship_no'],
  account_applications: ['citizenship_no'],
  loan_applications: ['citizenship_no'],
  membership_applications: ['citizenship_no'],
  member_import_rows: ['citizenship_no'],
};

/** 64 hex chars → those 32 bytes; any other string of 32+ chars → sha256 of it; else null. */
function parseKey(raw) {
  const s = String(raw || '').trim();
  if (/^[0-9a-f]{64}$/i.test(s)) return Buffer.from(s, 'hex');
  if (s.length >= 32) return crypto.createHash('sha256').update(s).digest();
  return null;
}
const master = () => parseKey(process.env.PII_KEY);
const enabled = () => !!master();

const keyCache = new Map();
function tenantKeys(schema) {
  const m = master();
  if (!m) return null;
  const id = m.toString('hex') + '|' + (schema || 'platform');
  if (!keyCache.has(id)) {
    const salt = Buffer.from(schema || 'platform');
    keyCache.set(id, {
      enc: Buffer.from(crypto.hkdfSync('sha256', m, salt, Buffer.from('pii-enc-v3'), 32)),
      nonce: Buffer.from(crypto.hkdfSync('sha256', m, salt, Buffer.from('pii-nonce-v3'), 32)),
    });
  }
  return keyCache.get(id);
}

const isEncrypted = v => typeof v === 'string' && v.length > 5 && v[4] === ':' && /^pii[123]:/.test(v);

/** Encrypt for the given tenant schema. null / '' / already encrypted / no key → unchanged. */
function encrypt(v, schema) {
  if (v === null || v === undefined) return v;
  const s = String(v);
  if (s === '' || isEncrypted(s) || Buffer.byteLength(s) > MAX_PLAIN) return s;
  const k = tenantKeys(schema);
  if (!k) return s;
  const iv = crypto.createHmac('sha256', k.nonce).update(s, 'utf8').digest().subarray(0, 12);
  const c = crypto.createCipheriv('aes-256-gcm', k.enc, iv);
  c.setAAD(Buffer.from('pii3'));
  const ct = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return 'pii3:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}

/** PHP key derivation: hash_hmac('sha256', 'pii-enc-v1', $k, true). */
const legacyEncKey = raw => crypto.createHmac('sha256', raw).update('pii-enc-v1').digest();

function decryptLegacy(v, rawKey) {
  const key = rawKey ? (Buffer.isBuffer(rawKey) ? rawKey : parseKey(rawKey)) : parseKey(process.env.PII_LEGACY_KEY);
  if (!key) return v;
  const raw = Buffer.from(v.slice(5), 'base64');
  const kEnc = legacyEncKey(key);
  try {
    if (v[3] === '1') {
      if (raw.length <= 24) return v;
      const out = secretbox.open(raw.subarray(24), raw.subarray(0, 24), kEnc);
      return out ? out.toString('utf8') : v;
    }
    if (raw.length <= 28) return v;
    const d = crypto.createDecipheriv('aes-256-gcm', kEnc, raw.subarray(0, 12));
    d.setAAD(Buffer.from('pii2'));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return v; }
}

/** Decrypt one value (any format). Plaintext or undecryptable → unchanged. */
function decrypt(v, schema, legacyKey) {
  if (!isEncrypted(v)) return v;
  if (v[3] !== '3') return decryptLegacy(v, legacyKey);
  const k = tenantKeys(schema);
  if (!k) return v;
  try {
    const raw = Buffer.from(v.slice(5), 'base64');
    if (raw.length <= 28) return v;
    const d = crypto.createDecipheriv('aes-256-gcm', k.enc, raw.subarray(0, 12));
    d.setAAD(Buffer.from('pii3'));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return v; }
}

/** Decrypt every encrypted string of fetched rows in place (cheap prefix check per cell). */
function decryptRows(rows, schema) {
  for (const row of rows) {
    for (const k in row) {
      const v = row[k];
      if (typeof v === 'string' && v.charCodeAt(0) === 112 && isEncrypted(v)) row[k] = decrypt(v, schema);
    }
  }
  return rows;
}

/** Encrypt the PII columns of `table` inside a data object about to be written. */
function encryptFields(table, data, schema) {
  for (const col of PII_COLUMNS[table] || []) if (data[col] !== undefined) data[col] = encrypt(data[col], schema);
  return data;
}

module.exports = { enabled, encrypt, decrypt, decryptLegacy, decryptRows, encryptFields, isEncrypted, parseKey, PII_COLUMNS };
