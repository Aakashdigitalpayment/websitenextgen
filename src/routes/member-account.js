'use strict';
/**
 * Member portal routes that run before sign-in: self-registration (+ live availability check),
 * self-service OTP password reset, the member 2FA step and "Sign in with Facebook".
 * Ported from member/login.php, member/check-availability.php, member/password-reset-request.php, member/oauth.php.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const QRCode = require('qrcode');
const db = require('../db');
const auth = require('../lib/auth');
const nd = require('../lib/nepali-date');
const totp = require('../lib/totp');
const settings = require('../lib/settings');
const notify = require('../lib/notify');
const portal = require('../lib/member-portal');
const facebook = require('../lib/facebook-oauth');
const { flash, isBot } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tenantKey = req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip);
const limiter = (windowMs, limit, json = false) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: tenantKey,
  handler: (req, res) => (json
    ? res.status(429).json({ available: false, message: res.locals.t('धेरै पटक जाँच भयो। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।', 'Too many checks. Please try again later.') })
    : res.status(429).render('public/error', { layout: 'auth', title: 'Too many requests', code: 429, message: res.locals.t('धेरै पटक प्रयास भयो। कृपया केही समयपछि पुनः प्रयास गर्नुहोस्।', 'Too many attempts. Please try again later.') })),
});
const registerLimiter = limiter(60 * 60_000, 10);
const checkLimiter = limiter(60_000, 20, true);
const otpSendLimiter = limiter(60 * 60_000, 5);
const otpVerifyLimiter = limiter(15 * 60_000, 20);

// ---------------------------------------------------------------- self-registration
async function registerOpen() { return (await settings.get('member_self_register', '1')) !== '0'; }
const renderRegister = (res, values = {}, error = null, status = 200) => res.status(status).render('member/register', {
  layout: 'auth', title: res.locals.t('सदस्य पोर्टल दर्ता', 'Member portal registration'), values, error,
});

router.get('/register', ah(async (req, res) => {
  if (req.member) return res.redirect('/member');
  if (!(await registerOpen())) { flash(req, 'info', res.locals.t('अनलाइन दर्ता हाल बन्द छ। कार्यालयमा सम्पर्क गर्नुहोस्।', 'Online registration is closed. Please contact the office.')); return res.redirect('/member/login'); }
  renderRegister(res);
}));

router.post('/register', registerLimiter, ah(async (req, res) => {
  if (!(await registerOpen())) return res.redirect('/member/login');
  const values = { sadasyata_number: String(req.body.sadasyata_number || '').trim().slice(0, 50), email: String(req.body.email || '').trim().slice(0, 255), phone: String(req.body.phone || '').trim().slice(0, 20) };
  if (isBot(req)) return res.redirect('/member/login');
  const r = await portal.register({ sadasyata: values.sadasyata_number, email: values.email, phone: values.phone, password: String(req.body.password || ''), confirm: String(req.body.confirm || '') }, res.locals.t);
  if (r.error) return renderRegister(res, values, r.error, 422);
  await auth.audit(req, r.attached ? 'register_attach' : 'register', 'members', r.member.id, `Member portal registration (${r.member.sadasyata_number || r.member.phone})`, { actorId: r.member.id, actorName: r.member.name });
  const site = res.locals.siteName || '';
  await portal.alertOffice('member_registered', `नयाँ सदस्य पोर्टल दर्ता — ${r.member.name}`, `${site}\n\nसदस्य पोर्टलमा नयाँ दर्ता: ${r.member.name} (${r.member.sadasyata_number || '—'}, ${r.member.phone || '—'}).\nAdmin → सदस्य पोर्टल मा स्वीकृत वा अस्वीकृत गर्नुहोस्।`);
  notify.later(() => require('../lib/webhooks').emit(r.attached ? 'member.updated' : 'member.created', { id: r.member.id, member_no: r.member.sadasyata_number || null, name: r.member.name, phone: r.member.phone || null, email: r.member.email || null, approval_status: r.member.approval_status, source: 'portal_registration' }));
  flash(req, 'success', r.member.approval_status === 'approved'
    ? res.locals.t('पासवर्ड सेट भयो! अब लगइन गर्न सक्नुहुन्छ।', 'Password set! You can sign in now.')
    : r.attached ? res.locals.t('पासवर्ड सेट भयो! Admin अनुमोदनपछि लगिन गर्न सक्नुहुन्छ।', 'Password set! You can sign in after the office approves it.')
      : res.locals.t('दर्ता सफल! KYC विवरणबाट प्रोफाइल स्वतः ल्याइयो। Admin अनुमोदनपछि लगिन गर्न सक्नुहुन्छ।', 'Registration successful! Your profile was filled from your KYM. You can sign in after the office approves it.'));
  res.redirect('/member/login');
}));

/** Live duplicate check for the registration form (read-only, rate limited, whitelisted fields). */
router.get('/check-availability', checkLimiter, ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const t = res.locals.t;
  const field = String(req.query.field || '');
  const value = nd.toLatinDigits(String(req.query.value || '').trim()).slice(0, 100);
  if (!['email', 'phone', 'sadasyata_number'].includes(field) || !value) return res.json({ available: false, message: t('अमान्य अनुरोध', 'Invalid request') });
  if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return res.json({ available: false, message: t('मान्य इमेल राख्नुहोस्', 'Enter a valid email') });
  if (field === 'phone' && !/^[0-9+\s-]{7,15}$/.test(value)) return res.json({ available: false, message: t('मान्य मोबाइल नम्बर राख्नुहोस्', 'Enter a valid mobile number') });
  let taken;
  if (field === 'sadasyata_number') taken = !!(await portal.findBySadasyata(value))?.password_hash;
  else if (field === 'email') taken = !!(await db.value('SELECT 1 FROM members WHERE lower(email) = lower($1) AND password_hash IS NOT NULL LIMIT 1', [value]));
  else taken = !!(await db.value(`SELECT 1 FROM members WHERE deleted_at IS NULL AND password_hash IS NOT NULL AND ${portal.phoneDigitsSql('phone')} = $1 LIMIT 1`, [portal.normalizeMobile(value).slice(-10)]));
  res.json({ available: !taken, message: taken ? t('पहिले नै दर्ता भएको छ', 'Already registered') : '' });
}));

// ---------------------------------------------------------------- self-service password reset (OTP via SMS / email)
const RESET_TTL = 15 * 60_000;
function resetState(req) {
  const s = req.session.pwReset;
  if (!s || s.tenantId !== req.tenant.id || Date.now() - s.at > RESET_TTL) { delete req.session.pwReset; return null; }
  return s;
}
async function gatewaysReady() {
  const s = await settings.all();
  return { sms: s.notify_sms_enabled === '1' && !!(s.notify_sms_token || s.notify_sms_api_url), email: s.notify_email_enabled === '1' && !!s.smtp_host };
}
async function renderForgot(req, res, extra = {}, status = 200) {
  const st = resetState(req);
  res.status(status).render('member/forgot', {
    layout: 'auth', title: res.locals.t('पासवर्ड रिसेट', 'Password reset'),
    step: extra.step || st?.step || 1, sentTo: st?.sentTo || '', channel: st?.channel || '', gateways: await gatewaysReady(),
    error: null, notice: null, done: false, identifier: '', ...extra,
  });
}

router.get('/forgot', ah(async (req, res) => {
  if (req.member) return res.redirect('/member/profile');
  await renderForgot(req, res);
}));

router.post('/forgot', otpSendLimiter, ah(async (req, res) => {
  const t = res.locals.t;
  const identifier = String(req.body.identifier || '').trim().slice(0, 120);
  if (isBot(req)) return renderForgot(req, res, { step: 1, notice: t('अनुरोध प्राप्त भयो।', 'Request received.') });
  if (!identifier) return renderForgot(req, res, { step: 1, error: t('इमेल, मोबाइल वा सदस्यता नम्बर लेख्नुहोस्।', 'Enter your email, mobile or member number.') }, 422);
  const member = await portal.findForReset(identifier);

  // fallback: ask the office to reset it (SMS / email not configured, or the member prefers it)
  if (req.body.action === 'office') {
    if (member) {
      const open = await db.value("SELECT 1 FROM member_password_reset_requests WHERE member_id = $1 AND status = 'pending'", [member.id]);
      if (!open) {
        await db.query("INSERT INTO member_password_reset_requests (member_id, status, requested_at, channel) VALUES ($1, 'pending', now(), 'office')", [member.id]);
        await auth.audit(req, 'password_reset_request', 'members', member.id, `Member '${member.name}' asked the office for a password reset`, { actorId: member.id, actorName: member.name });
        await portal.alertOffice('password_reset_request', `Password Reset Request — ${member.name}`,
          `एक सदस्यले पासवर्ड Reset अनुरोध गर्नुभएको छ।\n\nName: ${member.name}\nEmail: ${member.email || '—'}\nPhone: ${member.phone || '—'}\n\nAdmin Panel → पासवर्ड अनुरोध मा प्रक्रिया गर्नुहोस्।`);
      }
    }
    delete req.session.pwReset;
    return renderForgot(req, res, { done: true, notice: t('तपाईंको पासवर्ड Reset अनुरोध कार्यालयमा पठाइयो। विवरण मिलेमा कार्यालयले सम्पर्क गर्नेछ।', 'Your password reset request was sent to the office. If the details match, the office will contact you.') });
  }

  const gw = await gatewaysReady();
  if (!gw.sms && !gw.email) return renderForgot(req, res, { step: 1, identifier, error: t('SMS/इमेल सेवा सुरु गरिएको छैन। तलको बटनबाट कार्यालयलाई अनुरोध पठाउनुहोस्।', 'SMS/email is not set up. Use the button below to ask the office instead.') }, 422);
  const forced = ['sms', 'email'].includes(req.body.channel) ? req.body.channel : 'auto';
  let sent = { channel: forced === 'auto' ? '' : forced, sentTo: '' };
  if (member && member.is_active) {
    sent = await portal.dispatchOtp(member, forced);
    if (!sent.sent) console.warn('password reset OTP not delivered for member #' + member.id);
  }
  // same next step whether or not the account exists (no account enumeration)
  req.session.pwReset = { tenantId: req.tenant.id, memberId: member && member.is_active ? member.id : null, channel: sent.channel || forced, sentTo: sent.sentTo || '', step: 2, ok: false, at: Date.now() };
  await renderForgot(req, res, { step: 2, notice: t('यदि यो विवरणसँग खाता छ भने OTP पठाइएको छ (SMS/इमेल जाँच गर्नुहोस्)।', 'If an account matches these details, an OTP has been sent (check SMS/email).') });
}));

router.post('/forgot/verify', otpVerifyLimiter, ah(async (req, res) => {
  const t = res.locals.t;
  const st = resetState(req);
  if (!st) return renderForgot(req, res, { step: 1, error: t('समय सकियो। फेरि सुरु गर्नुहोस्।', 'Session expired. Please start again.') }, 422);
  const otp = nd.toLatinDigits(String(req.body.otp || '').trim());
  if (!/^\d{6}$/.test(otp)) return renderForgot(req, res, { step: 2, error: t('OTP ६ अंकको हुनुपर्छ।', 'OTP must be 6 digits.') }, 422);
  const ok = st.memberId ? (await portal.verifyOtp(st.memberId, otp, 'password_reset')).ok : false;
  if (!ok) return renderForgot(req, res, { step: 2, error: t('OTP गलत वा म्याद सकियो।', 'OTP is invalid or expired.') }, 422);
  st.ok = true; st.step = 3; st.at = Date.now();
  await renderForgot(req, res, { step: 3, notice: t('OTP प्रमाणित भयो! अब नयाँ पासवर्ड राख्नुहोस्।', 'OTP verified! Now set your new password.') });
}));

router.post('/forgot/password', ah(async (req, res) => {
  const t = res.locals.t;
  const st = resetState(req);
  if (!st || !st.ok || !st.memberId) { delete req.session.pwReset; return renderForgot(req, res, { step: 1, error: t('समय सकियो। फेरि सुरु गर्नुहोस्।', 'Session expired. Please start again.') }, 422); }
  const pw = String(req.body.password || '');
  const err = portal.passwordPolicyError(pw, t) || (pw !== req.body.confirm ? t('दुवै पासवर्ड मेल खाएनन्।', 'Passwords do not match.') : null);
  if (err) return renderForgot(req, res, { step: 3, error: err }, 422);
  await db.query('UPDATE members SET password_hash = $1, must_change_password = 0 WHERE id = $2', [await auth.hashPassword(pw), st.memberId]);
  await auth.bumpSessionVersion('members', st.memberId); // every other session signs out
  await db.query("UPDATE member_password_reset_requests SET status = 'resolved', resolved_at = now(), admin_note = COALESCE(admin_note, 'self-service OTP') WHERE member_id = $1 AND status = 'pending'", [st.memberId]);
  await notify.notifyMember(st.memberId, 'पासवर्ड परिवर्तन भयो', 'तपाईंको पासवर्ड OTP प्रमाणीकरणपछि परिवर्तन गरियो। तपाईंले नगर्नुभएको भए तुरुन्त कार्यालयमा सम्पर्क गर्नुहोस्।', '/member/profile', 'warning');
  await auth.audit(req, 'password_reset_otp', 'members', st.memberId, 'Password reset by OTP (' + st.channel + ')', { actorId: st.memberId });
  delete req.session.pwReset;
  flash(req, 'success', t('पासवर्ड परिवर्तन भयो। नयाँ पासवर्डले लगइन गर्नुहोस्।', 'Password changed. Sign in with your new password.'));
  res.redirect('/member/login');
}));

router.post('/forgot/resend', otpSendLimiter, ah(async (req, res) => {
  const t = res.locals.t;
  const st = resetState(req);
  if (!st) return renderForgot(req, res, { step: 1 });
  if (st.memberId) {
    const m = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL AND is_active = 1', [st.memberId]);
    if (m) { const r = await portal.dispatchOtp(m, st.channel || 'auto'); st.sentTo = r.sentTo || st.sentTo; }
  }
  st.at = Date.now(); st.step = 2;
  await renderForgot(req, res, { step: 2, notice: t('OTP फेरि पठाइयो।', 'OTP resent.') });
}));

router.post('/forgot/cancel', (req, res) => { delete req.session.pwReset; res.redirect('/member/forgot'); });

// ---------------------------------------------------------------- second factor (authenticator app)
const usedSteps = new Map(); // "<schema>:<memberId>" -> last accepted step (replay protection)
function pending2fa(req) {
  const p = req.session.memberPending2fa;
  return p && p.tenantId === req.tenant.id && Date.now() - p.at < 10 * 60_000 ? p : null;
}
async function render2fa(req, res, p, error = null, status = 200, codes = null) {
  let qr = null;
  if (p.mode === 'setup' && p.secret) {
    const m = await db.one('SELECT sadasyata_number, phone FROM members WHERE id = $1', [p.id]);
    qr = await QRCode.toDataURL(totp.provisioningUri(res.locals.siteName || req.tenant.name, 'member-' + (m?.sadasyata_number || p.id), p.secret), { margin: 1, width: 220 });
  }
  res.status(status).render('member/login-2fa', { layout: 'auth', title: res.locals.t('दुई-चरण प्रमाणीकरण', 'Two-step sign-in'), mode: p.mode, qr, secret: p.mode === 'setup' ? p.secret : null, error, codes });
}

router.get('/login/2fa', ah(async (req, res) => {
  const p = pending2fa(req);
  if (!p) return res.redirect('/member/login');
  await render2fa(req, res, p);
}));

router.post('/login/2fa', ah(async (req, res) => {
  const t = res.locals.t;
  const p = pending2fa(req);
  if (!p) return res.redirect('/member/login');
  const m = await db.one('SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL', [p.id]);
  const gate = m && portal.eligibilityError(m, t);
  if (!m || gate) { delete req.session.memberPending2fa; flash(req, 'error', gate || t('खाता भेटिएन।', 'Account not found.')); return res.redirect('/member/login'); }
  const next = auth.safeNext(req.query.next, '/member');
  if (p.mode === 'backup_ack') { await auth.completeMemberLogin(req, m); return res.redirect(next); }
  const throttle = '2fa:member:' + m.id;
  if (await auth.tooManyAttempts(throttle, req.ip)) return render2fa(req, res, p, t('धेरै पटक 2FA प्रयास। कृपया १५ मिनेटपछि प्रयास गर्नुहोस्।', 'Too many 2FA attempts. Please try again after 15 minutes.'), 429);
  const code = String(req.body.code || '').trim();
  if (p.mode === 'setup') {
    if (totp.verify(p.secret, code) === null) { await auth.recordFailure(throttle, req.ip); return render2fa(req, res, p, t('2FA कोड मिलेन। फेरि प्रयास गर्नुहोस्।', 'The code did not match. Please try again.'), 401); }
    const { codes, hashes } = await totp.backupCodes();
    await db.query('UPDATE members SET twofa_enabled = 1, twofa_secret = $1, twofa_backup_codes = $2, twofa_enabled_at = now() WHERE id = $3', [p.secret, JSON.stringify(hashes), m.id]);
    await auth.audit(req, '2fa_enable', 'members', m.id, 'Member 2FA set up at sign-in', { actorId: m.id, actorName: m.name });
    // stay on the page so the backup codes are seen before the session starts
    req.session.memberPending2fa = { ...p, mode: 'backup_ack', secret: null, at: Date.now() };
    return render2fa(req, res, req.session.memberPending2fa, null, 200, codes);
  }
  let ok = false;
  const key = db.currentSchema() + ':' + m.id;
  const step = totp.verify(m.twofa_secret, code);
  if (step !== null && step > (usedSteps.get(key) || 0)) { usedSteps.set(key, step); ok = true; }
  if (!ok && code.replace(/[^A-Za-z0-9]/g, '').length >= 8) {
    const remaining = await totp.consumeBackupCode(code, m.twofa_backup_codes);
    if (remaining) { await db.query('UPDATE members SET twofa_backup_codes = $1 WHERE id = $2', [JSON.stringify(remaining), m.id]); ok = true; }
  }
  if (!ok) { await auth.recordFailure(throttle, req.ip); return render2fa(req, res, p, t('2FA कोड वा backup code मिलेन।', '2FA code or backup code did not match.'), 401); }
  await auth.clearFailures(throttle, req.ip);
  await auth.completeMemberLogin(req, m);
  res.redirect(next);
}));

// ---------------------------------------------------------------- Facebook sign-in
router.get('/oauth/facebook', ah(async (req, res) => {
  const url = await facebook.start(req, 'login');
  res.redirect(url || '/member/login');
}));

router.get('/oauth/facebook/callback', ah(async (req, res) => {
  const t = res.locals.t;
  const fail = msg => { flash(req, 'error', msg); return res.redirect(req.member ? '/member/profile' : '/member/login'); };
  let info;
  try { info = await facebook.finish(req); } catch { return fail(t('Facebook बाट लगइन हुन सकेन। फेरि प्रयास गर्नुहोस्।', 'Facebook sign-in failed. Please try again.')); }
  if (info.intent === 'link') {
    if (!req.member) return fail(t('पहिले लगइन गर्नुहोस्।', 'Please sign in first.'));
    if (await db.value('SELECT 1 FROM members WHERE facebook_id = $1 AND id <> $2', [info.sub, req.member.id])) return fail(t('यो Facebook खाता अर्को सदस्यसँग जोडिएको छ।', 'This Facebook account is linked to another member.'));
    await db.query('UPDATE members SET facebook_id = $1 WHERE id = $2', [info.sub, req.member.id]);
    await auth.audit(req, 'facebook_link', 'members', req.member.id, 'Facebook account linked');
    flash(req, 'success', t('Facebook खाता जोडियो।', 'Facebook account linked.'));
    return res.redirect('/member/profile');
  }
  let m = await db.one('SELECT * FROM members WHERE facebook_id = $1 AND deleted_at IS NULL', [info.sub]);
  if (!m && info.email) {
    // first-time link by email only for accounts that already use 2FA (memberOAuthLogin): email alone is not proof
    const byEmail = await db.many("SELECT * FROM members WHERE lower(email) = $1 AND deleted_at IS NULL AND (facebook_id IS NULL OR facebook_id = '') LIMIT 2", [info.email]);
    if (byEmail.length === 1 && Number(byEmail[0].twofa_enabled) && byEmail[0].twofa_secret) {
      m = byEmail[0];
      await db.query('UPDATE members SET facebook_id = $1 WHERE id = $2', [info.sub, m.id]);
    } else if (byEmail.length === 1) {
      return fail(t('सुरक्षाका लागि: यो खाता Facebook सँग जोड्न पहिले मोबाइल/पासवर्डले लगइन गरी प्रोफाइलबाट Facebook जोड्नुहोस्।', 'For your security: sign in with your mobile and password first, then link Facebook from your profile.'));
    }
  }
  if (!m) return fail(t('यो Facebook खातासँग कुनै सदस्य जोडिएको छैन। पहिले सदस्य दर्ता गर्नुहोस् वा पासवर्डले लगइन गरेर प्रोफाइलबाट जोड्नुहोस्।', 'No member is linked to this Facebook account. Register first, or sign in with your password and link it from your profile.'));
  const gate = portal.eligibilityError(m, t);
  if (gate) return fail(gate);
  const r = await auth.startMemberSession(req, m);
  await auth.audit(req, 'login_facebook', 'members', m.id, 'Member login (Facebook)', { actorId: m.id, actorName: m.name });
  res.redirect(r.needs2fa ? '/member/login/2fa' : '/member');
}));

module.exports = router;
