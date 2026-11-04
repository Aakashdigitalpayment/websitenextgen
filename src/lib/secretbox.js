'use strict';
/**
 * NaCl / libsodium crypto_secretbox (XSalsa20-Poly1305) in plain JS — used only to read the
 * PHP app's "pii1:" values (sodium_crypto_secretbox). Combined format: MAC(16) || ciphertext.
 */
const crypto = require('crypto');

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];
const rotl = (x, n) => (x << n) | (x >>> (32 - n));
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function core(inp, hsalsa) {
  const x = Uint32Array.from(inp);
  for (let i = 0; i < 10; i++) {
    x[4] ^= rotl((x[0] + x[12]) | 0, 7); x[8] ^= rotl((x[4] + x[0]) | 0, 9); x[12] ^= rotl((x[8] + x[4]) | 0, 13); x[0] ^= rotl((x[12] + x[8]) | 0, 18);
    x[9] ^= rotl((x[5] + x[1]) | 0, 7); x[13] ^= rotl((x[9] + x[5]) | 0, 9); x[1] ^= rotl((x[13] + x[9]) | 0, 13); x[5] ^= rotl((x[1] + x[13]) | 0, 18);
    x[14] ^= rotl((x[10] + x[6]) | 0, 7); x[2] ^= rotl((x[14] + x[10]) | 0, 9); x[6] ^= rotl((x[2] + x[14]) | 0, 13); x[10] ^= rotl((x[6] + x[2]) | 0, 18);
    x[3] ^= rotl((x[15] + x[11]) | 0, 7); x[7] ^= rotl((x[3] + x[15]) | 0, 9); x[11] ^= rotl((x[7] + x[3]) | 0, 13); x[15] ^= rotl((x[11] + x[7]) | 0, 18);
    x[1] ^= rotl((x[0] + x[3]) | 0, 7); x[2] ^= rotl((x[1] + x[0]) | 0, 9); x[3] ^= rotl((x[2] + x[1]) | 0, 13); x[0] ^= rotl((x[3] + x[2]) | 0, 18);
    x[6] ^= rotl((x[5] + x[4]) | 0, 7); x[7] ^= rotl((x[6] + x[5]) | 0, 9); x[4] ^= rotl((x[7] + x[6]) | 0, 13); x[5] ^= rotl((x[4] + x[7]) | 0, 18);
    x[11] ^= rotl((x[10] + x[9]) | 0, 7); x[8] ^= rotl((x[11] + x[10]) | 0, 9); x[9] ^= rotl((x[8] + x[11]) | 0, 13); x[10] ^= rotl((x[9] + x[8]) | 0, 18);
    x[12] ^= rotl((x[15] + x[14]) | 0, 7); x[13] ^= rotl((x[12] + x[15]) | 0, 9); x[14] ^= rotl((x[13] + x[12]) | 0, 13); x[15] ^= rotl((x[14] + x[13]) | 0, 18);
  }
  if (hsalsa) return [x[0], x[5], x[10], x[15], x[6], x[7], x[8], x[9]];
  return Array.from(x, (v, i) => (v + inp[i]) >>> 0);
}

function state(k, n4) { // k: 8 words, n4: 4 words (nonce/counter or hsalsa input)
  return [SIGMA[0], k[0], k[1], k[2], k[3], SIGMA[1], n4[0], n4[1], n4[2], n4[3], SIGMA[2], k[4], k[5], k[6], k[7], SIGMA[3]];
}

/** XSalsa20 keystream of `len` bytes. */
function xsalsa20Stream(key, nonce24, len) {
  const kw = Array.from({ length: 8 }, (_, i) => u32(key, i * 4));
  const sub = core(state(kw, [u32(nonce24, 0), u32(nonce24, 4), u32(nonce24, 8), u32(nonce24, 12)]), true);
  const n0 = u32(nonce24, 16), n1 = u32(nonce24, 20);
  const out = Buffer.alloc(len);
  for (let block = 0, off = 0; off < len; block++, off += 64) {
    const words = core(state(sub, [n0, n1, block >>> 0, Math.floor(block / 2 ** 32) >>> 0]), false);
    const b = Buffer.alloc(64);
    words.forEach((w, i) => b.writeUInt32LE(w, i * 4));
    b.copy(out, off, 0, Math.min(64, len - off));
  }
  return out;
}

const leBig = buf => { let n = 0n; for (let i = buf.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(buf[i]); return n; };
function poly1305(key, msg) {
  const r = leBig(key.subarray(0, 16)) & 0x0ffffffc0ffffffc0ffffffc0fffffffn;
  const s = leBig(key.subarray(16, 32));
  const p = (1n << 130n) - 5n;
  let acc = 0n;
  for (let i = 0; i < msg.length; i += 16) {
    const chunk = msg.subarray(i, i + 16);
    acc = ((acc + leBig(chunk) + (1n << BigInt(8 * chunk.length))) * r) % p;
  }
  acc = (acc + s) & ((1n << 128n) - 1n);
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) { out[i] = Number(acc & 0xffn); acc >>= 8n; }
  return out;
}

function seal(plain, nonce, key) {
  const m = Buffer.from(plain);
  const ks = xsalsa20Stream(key, nonce, 32 + m.length);
  const c = Buffer.alloc(m.length);
  for (let i = 0; i < m.length; i++) c[i] = m[i] ^ ks[32 + i];
  return Buffer.concat([poly1305(ks.subarray(0, 32), c), c]);
}

/** Returns the plaintext Buffer, or null when the MAC does not verify. */
function open(boxed, nonce, key) {
  if (boxed.length < 16) return null;
  const tag = boxed.subarray(0, 16), c = boxed.subarray(16);
  const ks = xsalsa20Stream(key, nonce, 32 + c.length);
  if (!crypto.timingSafeEqual(poly1305(ks.subarray(0, 32), c), tag)) return null;
  const m = Buffer.alloc(c.length);
  for (let i = 0; i < c.length; i++) m[i] = c[i] ^ ks[32 + i];
  return m;
}

module.exports = { seal, open, poly1305, xsalsa20Stream };
