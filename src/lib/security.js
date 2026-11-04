'use strict';
const crypto = require('crypto');

/** Synchronizer-token CSRF protection, token stored in the session. */
function csrfToken(req) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('base64url');
  return req.session.csrf;
}

function csrfValid(req) {
  const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || (req.is('multipart/form-data') ? req.query._csrf : '') || '';
  const expected = req.session && req.session.csrf;
  if (!expected || typeof sent !== 'string' || sent.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));
}

/**
 * Global middleware: exposes the token to views and rejects every unsafe request
 * without a valid token. Multipart bodies are not parsed yet at this point, so
 * multipart forms also carry the token in the action URL (?_csrf=…); upload
 * routes re-check the body token after multer as well.
 */
function csrf(req, res, next) {
  res.locals.csrfToken = csrfToken(req);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!csrfValid(req)) return res.status(403).render('public/error', { layout: req.tenant ? undefined : false, title: 'Session expired', code: 403, message: 'फारमको समय सकियो। पृष्ठ रिफ्रेस गरेर फेरि प्रयास गर्नुहोस्। (Form expired — please reload and try again.)' });
  next();
}

function verifyCsrf(req, res, next) {
  if (!csrfValid(req)) return res.status(403).render('public/error', { layout: req.tenant ? undefined : false, title: 'Session expired', code: 403, message: 'फारमको समय सकियो। पृष्ठ रिफ्रेस गरेर फेरि प्रयास गर्नुहोस्।' });
  next();
}

/** Flash messages (one-shot) */
function flash(req, type, message) {
  req.session.flash = req.session.flash || [];
  req.session.flash.push({ type, message });
}
function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || [];
  delete req.session.flash;
  next();
}

/** Honeypot field: bots fill hidden "website" input. */
function isBot(req) { return !!(req.body && req.body.website); }

module.exports = { csrf, verifyCsrf, csrfToken, flash, flashMiddleware, isBot };
