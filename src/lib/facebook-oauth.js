'use strict';
/**
 * "Sign in with Facebook" for members (OAuth 2.0 authorization-code flow + state; Graph API v18.0 like the PHP app).
 * Per tenant: site_settings facebook_app_id / facebook_app_secret. The redirect URI to register in the
 * Facebook app (Facebook Login → Valid OAuth Redirect URIs) is https://<tenant host>/member/oauth/facebook/callback.
 */
const crypto = require('crypto');
const settings = require('./settings');

const GRAPH = 'https://graph.facebook.com/v18.0';
const AUTH_URL = 'https://www.facebook.com/v18.0/dialog/oauth';

async function config() {
  const s = await settings.all();
  return s.facebook_app_id && s.facebook_app_secret ? { id: s.facebook_app_id, secret: s.facebook_app_secret } : null;
}

const redirectUri = req => `${req.protocol}://${req.get('host')}/member/oauth/facebook/callback`;

/** Build the Facebook dialog URL and remember the state in the session. */
async function start(req, intent) {
  const cfg = await config();
  if (!cfg) return null;
  const state = crypto.randomBytes(24).toString('base64url');
  req.session.facebookOAuth = { state, intent: intent === 'link' ? 'link' : 'login', at: Date.now() };
  const u = new URL(AUTH_URL);
  u.search = new URLSearchParams({ client_id: cfg.id, redirect_uri: redirectUri(req), state, scope: 'email,public_profile', response_type: 'code' }).toString();
  return u.toString();
}

/** Validate the callback and return { sub, email, name, picture, intent } or throw. */
async function finish(req, fetchImpl = fetch) {
  const saved = req.session.facebookOAuth;
  delete req.session.facebookOAuth;
  const state = String(req.query.state || '');
  if (!saved || Date.now() - saved.at > 10 * 60_000 || state.length !== saved.state.length
      || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))) throw new Error('state');
  if (req.query.error || !req.query.code) throw new Error('denied');
  const cfg = await config();
  if (!cfg) throw new Error('not configured');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const tu = new URL(GRAPH + '/oauth/access_token');
    tu.search = new URLSearchParams({ client_id: cfg.id, client_secret: cfg.secret, redirect_uri: redirectUri(req), code: String(req.query.code) }).toString();
    const tr = await fetchImpl(tu, { signal: ctrl.signal });
    const tok = await tr.json().catch(() => ({}));
    if (!tr.ok || !tok.access_token) throw new Error('token');
    // appsecret_proof binds the token to this app (recommended by Facebook for server-side calls)
    const proof = crypto.createHmac('sha256', cfg.secret).update(tok.access_token).digest('hex');
    const mu = new URL(GRAPH + '/me');
    mu.search = new URLSearchParams({ fields: 'id,name,email,picture', access_token: tok.access_token, appsecret_proof: proof }).toString();
    const ur = await fetchImpl(mu, { signal: ctrl.signal });
    const info = await ur.json().catch(() => ({}));
    if (!ur.ok || !info.id) throw new Error('userinfo');
    return { sub: String(info.id), email: String(info.email || '').toLowerCase(), name: info.name || '', picture: info.picture?.data?.url || '', intent: saved.intent };
  } finally { clearTimeout(timer); }
}

module.exports = { config, start, finish, redirectUri };
