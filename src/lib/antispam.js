'use strict';
/**
 * Public-form spam guard (port of includes/contact-spam-guard.php), on top of the honeypot + rate limit:
 *  - extra honeypot names used by the PHP forms
 *  - link / promo heuristics on free-text fields (setting spam_block_links, default on)
 *  - Cloudflare Turnstile when both keys are set in settings (group "security")
 */
const { request } = require('undici');

const HONEYPOTS = ['website', 'ct_hp', 'acp_hp', 'company_url', 'fax_number'];
const honeypotTripped = body => HONEYPOTS.some(k => String((body && body[k]) || '').trim() !== '');

/** True when text looks like link / promo spam. Email addresses alone never count. */
function looksLikeSpam(...parts) {
  const text = parts.map(p => String(p || '').slice(0, 5000)).join('\n').slice(0, 20000).toLowerCase();
  if (!text.trim()) return false;
  const scan = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' ');
  if (/https?:\/\//.test(scan) || /\bwww\./.test(scan)) return true;
  if (/\b(telegra\.ph|t\.me\/|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|rebrand\.ly)/.test(scan)) return true;
  if (/\$\s?\d[\d,]{2,}/.test(scan)) return true;
  if (/\b(jackpot|lottery|crypto\s?airdrop|forex\s?signal|prize\s?winner|you\s+won|claim\s+now|promo\s?code|double\s+your\s+money)\b/.test(scan)) return true;
  // bare domains (example.com) next to a call to action — token by token, so the check stays linear
  const DOMAIN = /^(?:[a-z0-9-]{1,63}\.){1,10}(?:com|net|org|xyz|ru|cn|top|click|shop)$/;
  const hasDomain = scan.split(/[\s,;:!?()<>"'\[\]{}]+/).some(tok => tok.length <= 253 && DOMAIN.test(tok.replace(/[./]+$/, '')));
  if (hasDomain && /\b(click|visit|register|invest|earn|whatsapp|telegram)\b/.test(scan)) return true;
  return false;
}

// ---------------------------------------------------------------- math check (coop_math_challenge_*): fallback when Turnstile is not set
const MATH_TTL = 3600_000;
const mathEnabled = s => !turnstileConfigured(s) && String((s && s.spam_math_captcha) ?? '1') !== '0';
/** Issue a fresh "a + b" for this form (one per bucket, one-shot, 1 h). Returns { a, b }. */
function mathIssue(req, bucket) {
  const crypto = require('crypto');
  const a = crypto.randomInt(1, 10), b = crypto.randomInt(1, 10);
  req.session.math = Object.fromEntries(Object.entries(req.session.math || {}).filter(([, v]) => Date.now() - v.ts < MATH_TTL).slice(-8));
  req.session.math[bucket] = { sum: a + b, ts: Date.now() };
  return { a, b };
}
function mathVerify(req, bucket, answer) {
  const m = req.session.math && req.session.math[bucket];
  if (m) delete req.session.math[bucket]; // one-shot
  if (!m || Date.now() - m.ts > MATH_TTL) return false;
  const n = String(answer ?? '').replace(/[०-९]/g, c => '०१२३४५६७८९'.indexOf(c)).trim();
  return /^\d{1,3}$/.test(n) && Number(n) === m.sum;
}
/** Sets res.locals.mathPrompt for views/partials/turnstile.ejs when the math check is on. */
function mathPrompt(req, res, bucket) {
  if (mathEnabled(res.locals.settings)) res.locals.mathPrompt = mathIssue(req, bucket);
}

const turnstileConfigured = s => !!(s && String(s.turnstile_site_key || '').trim() && String(s.turnstile_secret_key || '').trim());

async function verifyTurnstile(s, token, ip) {
  if (!turnstileConfigured(s)) return true;
  token = String(token || '').trim();
  if (!token || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: String(s.turnstile_secret_key).trim(), response: token, ...(ip ? { remoteip: ip } : {}) }).toString();
    const r = await request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, headersTimeout: 5000, bodyTimeout: 5000,
    });
    const j = await r.body.json();
    return !!(j && j.success);
  } catch { return false; } // fail closed, like the PHP guard
}

/**
 * Check a submitted public form. textParts = free-text values to scan (messages, subjects).
 * Returns null when fine, otherwise { reason, silent?, message:[np, en] }.
 */
async function check(req, settings, textParts = [], bucket = null) {
  const body = req.body || {};
  if (honeypotTripped(body)) return { reason: 'honeypot', silent: true };
  if (bucket && mathEnabled(settings) && !mathVerify(req, bucket, body.math_answer)) {
    return { reason: 'math', message: ['कृपया साधारण गणित जाँच सही मिलाउनुहोस्।', 'Please solve the simple math check correctly.'] };
  }
  if (settings.spam_block_links !== '0' && textParts.length && looksLikeSpam(...textParts)) {
    return { reason: 'spam', message: ['लिङ्क, प्रोमो वा स्प्याम जस्तो सन्देश पठाउन मिल्दैन। URL बिना सामान्य सन्देश लेख्नुहोस्।', 'Links, promo or spam-like text cannot be sent. Write a normal message without URLs.'] };
  }
  if (!(await verifyTurnstile(settings, body['cf-turnstile-response'] || body.turnstile_token, req.ip))) {
    return { reason: 'turnstile', message: ['मानव प्रमाणीकरण असफल। कृपया पुनः प्रयास गर्नुहोस्।', 'Human verification failed. Please try again.'] };
  }
  return null;
}

module.exports = { HONEYPOTS, honeypotTripped, looksLikeSpam, turnstileConfigured, verifyTurnstile, check, mathEnabled, mathIssue, mathVerify, mathPrompt };
