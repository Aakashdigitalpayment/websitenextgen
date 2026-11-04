'use strict';
/**
 * "Sign in with Google" for members (OpenID Connect, authorization-code flow with PKCE + state).
 * Per tenant: site_settings google_client_id / google_client_secret. The redirect URI to register in
 * Google Cloud Console is https://<tenant host>/member/oauth/google/callback (one per domain).
 */
const crypto = require('crypto');
const settings = require('./settings');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

async function config() {
  const s = await settings.all();
  return s.google_client_id && s.google_client_secret ? { id: s.google_client_id, secret: s.google_client_secret } : null;
}

const b64url = buf => buf.toString('base64url');
const redirectUri = req => `${req.protocol}://${req.get('host')}/member/oauth/google/callback`;

/** Build the Google authorization URL and remember state + PKCE verifier in the session. */
async function start(req, intent) {
  const cfg = await config();
  if (!cfg) return null;
  const state = b64url(crypto.randomBytes(24));
  const verifier = b64url(crypto.randomBytes(48));
  const nonce = b64url(crypto.randomBytes(16));
  req.session.googleOAuth = { state, verifier, nonce, intent: intent === 'link' ? 'link' : 'login', at: Date.now() };
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({
    client_id: cfg.id, redirect_uri: redirectUri(req), response_type: 'code', scope: 'openid email profile',
    state, nonce, code_challenge: b64url(crypto.createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Validate the callback and return { sub, email, name, picture, intent } or throw. */
async function finish(req) {
  const saved = req.session.googleOAuth;
  delete req.session.googleOAuth;
  const state = String(req.query.state || '');
  if (!saved || Date.now() - saved.at > 10 * 60_000 || state.length !== saved.state.length
      || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) throw new Error('state');
  if (req.query.error || !req.query.code) throw new Error('denied');
  const cfg = await config();
  if (!cfg) throw new Error('not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const tr = await fetch(TOKEN_URL, {
      method: 'POST', signal: ctrl.signal, headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code: String(req.query.code), client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirectUri(req), grant_type: 'authorization_code', code_verifier: saved.verifier }),
    });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) throw new Error('token');
    const ur = await fetch(USERINFO_URL, { signal: ctrl.signal, headers: { authorization: 'Bearer ' + tok.access_token } });
    const info = await ur.json().catch(() => ({}));
    if (!ur.ok || !info.sub) throw new Error('userinfo');
    if (info.email && info.email_verified !== true) throw new Error('unverified');
    return { sub: String(info.sub), email: String(info.email || '').toLowerCase(), name: info.name || '', picture: info.picture || '', intent: saved.intent };
  } finally { clearTimeout(timer); }
}

module.exports = { config, start, finish, redirectUri };
