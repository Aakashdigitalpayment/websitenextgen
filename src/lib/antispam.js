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
  const text = parts.map(p => String(p || '')).join('\n').toLowerCase();
  if (!text.trim()) return false;
  const scan = text.replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' ');
  if (/https?:\/\//.test(scan) || /\bwww\./.test(scan)) return true;
  if (/\b(telegra\.ph|t\.me\/|bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|rebrand\.ly)/.test(scan)) return true;
  if (/\$\s?\d[\d,]{2,}/.test(scan)) return true;
  if (/\b(jackpot|lottery|crypto\s?airdrop|forex\s?signal|prize\s?winner|you\s+won|claim\s+now|promo\s?code|double\s+your\s+money)\b/.test(scan)) return true;
  if (/(?<![@\w])(?:[a-z0-9-]+\.)+(?:com|net|org|xyz|ru|cn|top|click|shop)\b/.test(scan) && /\b(click|visit|register|invest|earn|whatsapp|telegram)\b/.test(scan)) return true;
  return false;
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
async function check(req, settings, textParts = []) {
  const body = req.body || {};
  if (honeypotTripped(body)) return { reason: 'honeypot', silent: true };
  if (settings.spam_block_links !== '0' && textParts.length && looksLikeSpam(...textParts)) {
    return { reason: 'spam', message: ['लिङ्क, प्रोमो वा स्प्याम जस्तो सन्देश पठाउन मिल्दैन। URL बिना सामान्य सन्देश लेख्नुहोस्।', 'Links, promo or spam-like text cannot be sent. Write a normal message without URLs.'] };
  }
  if (!(await verifyTurnstile(settings, body['cf-turnstile-response'] || body.turnstile_token, req.ip))) {
    return { reason: 'turnstile', message: ['मानव प्रमाणीकरण असफल। कृपया पुनः प्रयास गर्नुहोस्।', 'Human verification failed. Please try again.'] };
  }
  return null;
}

module.exports = { HONEYPOTS, honeypotTripped, looksLikeSpam, turnstileConfigured, verifyTurnstile, check };
