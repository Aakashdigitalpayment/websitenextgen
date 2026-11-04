'use strict';
/**
 * Integration API plumbing: client keys, scopes, IP allow-list, per-client rate limit,
 * idempotency and request logging. Keys look like  cbk_<12 hex>.<43 base64url>  and are stored
 * only as SHA-256; the part before the dot is a public lookup prefix.
 */
const crypto = require('crypto');
const ipaddr = require('ipaddr.js');
const db = require('../db');

const SCOPES = {
  'members:read': ['सदस्य विवरण पढ्ने', 'Read members'],
  'members:write': ['सदस्य थप/अद्यावधिक', 'Create / update members'],
  'accounts:write': ['खाता, ऋण, कारोबार पठाउने', 'Push accounts, loans, transactions'],
  'applications:read': ['आवेदन पढ्ने', 'Read applications'],
  'applications:write': ['आवेदनको स्थिति अद्यावधिक', 'Update application status'],
  'documents:read': ['कागजात पढ्ने/डाउनलोड', 'Read / download documents'],
  'documents:write': ['कागजात अपलोड', 'Upload documents'],
};
const EVENTS = {
  'member.created': ['नयाँ सदस्य', 'Member created'],
  'member.updated': ['सदस्य विवरण परिवर्तन', 'Member updated'],
  'application.submitted': ['नयाँ आवेदन', 'Application submitted'],
  'application.status_changed': ['आवेदनको स्थिति परिवर्तन', 'Application status changed'],
};

const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

function newKey() {
  const prefix = 'cbk_' + crypto.randomBytes(6).toString('hex');
  const key = prefix + '.' + crypto.randomBytes(32).toString('base64url');
  return { prefix, key, hash: sha256(key) };
}

class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}

function ipAllowed(ip, list) {
  const rules = String(list || '').split(/[\s,]+/).filter(Boolean);
  if (!rules.length) return true;
  let addr;
  try { addr = ipaddr.process(ip); } catch { return false; }
  return rules.some(r => {
    try {
      if (r.includes('/')) { const [range, bits] = ipaddr.parseCIDR(r); return addr.kind() === range.kind() && addr.match(range, bits); }
      return ipaddr.process(r).toString() === addr.toString();
    } catch { return false; }
  });
}

// per-client token bucket (per process): 600 requests / minute by default
const buckets = new Map();
function rateLimited(clientKey, perMinute = Number(process.env.API_RATE_PER_MIN || 600)) {
  const now = Date.now();
  const b = buckets.get(clientKey) || { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) { buckets.set(clientKey, b); return true; }
  b.tokens -= 1;
  buckets.set(clientKey, b);
  if (buckets.size > 10_000) buckets.clear();
  return false;
}

/** Express middleware: authenticate the API client of the current tenant. */
async function authenticate(req, res, next) {
  const started = Date.now();
  res.on('finish', () => {
    db.query('INSERT INTO api_request_log (client_id, method, path, status, ip_address, duration_ms) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.apiClient?.id || null, req.method, req.originalUrl.slice(0, 300), res.statusCode, req.ip, Date.now() - started]).catch(() => {});
  });
  try {
    const m = String(req.get('authorization') || '').match(/^Bearer\s+(cbk_[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/);
    if (!m) throw new ApiError(401, 'unauthorized', 'Missing or malformed API key (Authorization: Bearer cbk_…)');
    const client = await db.one('SELECT * FROM api_clients WHERE key_prefix = $1 AND is_active = 1', [m[1]]);
    const given = sha256(m[1] + '.' + m[2]);
    if (!client || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(client.key_hash))) throw new ApiError(401, 'unauthorized', 'Invalid API key');
    if (!ipAllowed(req.ip, client.allowed_ips)) throw new ApiError(403, 'ip_not_allowed', `IP ${req.ip} is not allowed for this key`);
    if (rateLimited(db.currentSchema() + ':' + client.id)) { res.set('Retry-After', '10'); throw new ApiError(429, 'rate_limited', 'Too many requests'); }
    req.apiClient = client;
    if (!client.last_used_at || Date.now() - new Date(client.last_used_at).getTime() > 60_000) {
      db.query('UPDATE api_clients SET last_used_at = now() WHERE id = $1', [client.id]).catch(() => {});
    }
    next();
  } catch (e) { next(e); }
}

const requireScope = scope => (req, res, next) =>
  (req.apiClient && req.apiClient.scopes.includes(scope) ? next() : next(new ApiError(403, 'insufficient_scope', `This key lacks the "${scope}" scope`)));

/**
 * Idempotency for POST/PUT/PATCH/DELETE: same Idempotency-Key + same body → stored response;
 * same key with a different body → 422.
 */
function idempotent(handler) {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key) return handler(req, res, next);
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) return next(new ApiError(400, 'bad_idempotency_key', 'Idempotency-Key must be 8–100 chars [A-Za-z0-9._:-]'));
    const hash = sha256(req.method + ' ' + req.originalUrl + ' ' + JSON.stringify(req.body || {}));
    const prev = await db.one('SELECT * FROM api_idempotency WHERE client_id = $1 AND idem_key = $2 AND created_at > now() - interval \'24 hours\'', [req.apiClient.id, key]);
    if (prev) {
      if (prev.request_hash !== hash) return next(new ApiError(422, 'idempotency_mismatch', 'Idempotency-Key was used with a different request'));
      res.set('Idempotent-Replay', 'true');
      return res.status(prev.status).json(prev.response);
    }
    const json = res.json.bind(res);
    res.json = body => {
      if (res.statusCode < 500) {
        db.query('INSERT INTO api_idempotency (client_id, idem_key, request_hash, status, response) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
          [req.apiClient.id, key, hash, res.statusCode, JSON.stringify(body)]).catch(() => {});
      }
      return json(body);
    };
    return handler(req, res, next);
  };
}

/** Opaque keyset cursor over (changed_at, id). */
const encodeCursor = (t, id) => Buffer.from(JSON.stringify([t instanceof Date ? t.toISOString() : t, id])).toString('base64url');
function decodeCursor(c) {
  if (!c) return null;
  try {
    const [t, id] = JSON.parse(Buffer.from(String(c), 'base64url').toString('utf8'));
    if (Number.isNaN(Date.parse(t)) || !Number.isInteger(id)) throw new Error();
    return { t, id };
  } catch { throw new ApiError(400, 'bad_cursor', 'Invalid cursor'); }
}

module.exports = { SCOPES, EVENTS, ApiError, newKey, sha256, ipAllowed, authenticate, requireScope, idempotent, encodeCursor, decodeCursor };
