'use strict';
/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — compatible with Google Authenticator / Authy
 * and with the PHP app's includes/totp-2fa.php (same secrets and bcrypt backup-code hashes).
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHA[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHA[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const s = String(str || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const c of s) {
    value = (value << 5) | ALPHA.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function codeAt(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const currentStep = (now = Date.now()) => Math.floor(now / 30_000);

/** @returns {number|null} the matching time step (so callers can reject replays) */
function verify(secret, code, window = 1, now = Date.now()) {
  const c = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(c) || !secret) return null;
  const step = currentStep(now);
  for (let i = -window; i <= window; i++) {
    const want = codeAt(secret, step + i);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(c))) return step + i;
  }
  return null;
}

function provisioningUri(issuer, label, secret) {
  const i = encodeURIComponent(issuer);
  return `otpauth://totp/${i}:${encodeURIComponent(label)}?secret=${secret}&issuer=${i}&algorithm=SHA1&digits=6&period=30`;
}

/** 8 one-time backup codes; returns { codes (show once), hashes (store JSON) } */
async function backupCodes(count = 8) {
  const codes = Array.from({ length: count }, () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-'));
  const hashes = await Promise.all(codes.map(c => bcrypt.hash(c.replace('-', ''), 10)));
  return { codes, hashes };
}

/** @returns {Promise<string[]|null>} remaining hashes if the code matched, else null */
async function consumeBackupCode(input, hashesJson) {
  let hashes = [];
  try { hashes = JSON.parse(hashesJson || '[]'); } catch { return null; }
  const code = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 8) return null;
  for (let i = 0; i < hashes.length; i++) {
    const h = String(hashes[i]).replace(/^\$2y\$/, '$2b$');
    if (await bcrypt.compare(code, h).catch(() => false)) return hashes.filter((_, j) => j !== i);
  }
  return null;
}

module.exports = { generateSecret, verify, codeAt, currentStep, provisioningUri, backupCodes, consumeBackupCode, base32Encode, base32Decode };
