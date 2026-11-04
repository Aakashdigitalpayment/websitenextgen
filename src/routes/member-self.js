'use strict';
/**
 * Signed-in member self-service (member/profile.php do_update / do_kyc_docs / do_password, member 2FA,
 * Facebook link, member/scan.php, member/id-card.php unlock request).
 */
const express = require('express');
const fs = require('fs');
const QRCode = require('qrcode');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const totp = require('../lib/totp');
const settings = require('../lib/settings');
const notify = require('../lib/notify');
const portal = require('../lib/member-portal');
const facebook = require('../lib/facebook-oauth');
const uploads = require('../lib/uploads');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** KYC documents a member may add when missing (photo, citizenship front/back, signature, thumb prints). */
const KYC_DOCS = [
  ['photo', ['पासपोर्ट फोटो', 'Passport photo']], ['citizenship_front', ['नागरिकता (अगाडि)', 'Citizenship (front)']],
  ['citizenship_back', ['नागरिकता (पछाडि)', 'Citizenship (back)']], ['signature', ['हस्ताक्षर', 'Signature']],
  ['left_thumb', ['बायाँ औंठाछाप', 'Left thumb print']], ['right_thumb', ['दायाँ औंठाछाप', 'Right thumb print']],
];
/** kycDocNeedsUpload: empty, or a local path whose file is gone. */
function docMissing(req, stored) {
  const v = String(stored || '').trim();
  if (!v) return true;
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('data:image')) return false;
  const file = uploads.resolveStored(req, v);
  return !file || !fs.existsSync(file);
}

async function profileData(req) {
  const m = req.member;
  const kyc = await portal.linkedKyc(m, true);
  const kycCols = await db.columns('kyc_applications');
  const docs = KYC_DOCS.filter(([k]) => kycCols.has(k)).map(([k, label]) => ({ key: k, label, has: kyc ? !!kyc[k] : false, missing: kyc ? docMissing(req, kyc[k]) : true }));
  const [pendingPhone, required] = await Promise.all([
    db.one("SELECT * FROM member_profile_change_requests WHERE member_id = $1 AND field = 'phone' AND status = 'pending' ORDER BY id DESC LIMIT 1", [m.id]),
    settings.get('member_2fa_required', '0'),
  ]);
  const pc = req.session.phoneChange;
  return {
    kyc, kycLocked: kyc?.status === 'approved', kycRejected: kyc?.status === 'rejected', docs,
    pendingPhone, phoneOtp: pc && pc.memberId === m.id && Date.now() - pc.at < 10 * 60_000 ? pc : null,
    twofaRequired: required === '1', facebookEnabled: !!(await facebook.config()),
  };
}

async function renderProfile(req, res, extra = {}, status = 200) {
  const data = await profileData(req);
  res.status(status).render('member/profile', { title: res.locals.t('मेरो विवरण', 'My profile'), errors: {}, detailErrors: {}, values: req.member, details: null, ...data, ...extra });
}

router.get('/profile', ah((req, res) => renderProfile(req, res)));

// email, address and password (unchanged behaviour; available even when the KYM is approved)
router.post('/profile', ah(async (req, res) => {
  const t = res.locals.t;
  const errors = {};
  const email = String(req.body.email || '').trim().toLowerCase() || null;
  const address = String(req.body.address || '').trim().slice(0, 500) || null;
  if (email && !util.isEmail(email)) errors.email = t('इमेल मिलेन', 'Invalid email');
  const data = { email, address };
  const emailChanged = (email || '') !== String(req.member.email || '').trim().toLowerCase();
  if (emailChanged && req.member.password_hash && !(await auth.checkPassword(req.body.current, req.member.password_hash))) {
    errors.current = t('इमेल परिवर्तन गर्न हालको पासवर्ड चाहिन्छ', 'Enter your current password to change the email');
  }
  const pw = String(req.body.password || '');
  if (pw) {
    const oauthOnly = !req.member.password_hash;
    if (!oauthOnly && !(await auth.checkPassword(req.body.current, req.member.password_hash))) errors.current = t('हालको पासवर्ड मिलेन', 'Current password is wrong');
    else if (portal.passwordPolicyError(pw, t)) errors.password = portal.passwordPolicyError(pw, t);
    else if (pw !== req.body.confirm) errors.confirm = t('पासवर्ड मिलेन', 'Passwords do not match');
    else { data.password_hash = await auth.hashPassword(pw); data.must_change_password = 0; }
  }
  if (Object.keys(errors).length) return renderProfile(req, res, { errors, values: { ...req.member, ...req.body } }, 422);
  try {
    await db.update('members', req.member.id, data);
    if (data.password_hash) await auth.bumpSessionVersion('members', req.member.id, req); // sign out other devices
  } catch (e) {
    if (e.code === '23505') return renderProfile(req, res, { errors: { email: t('यो इमेल पहिले नै प्रयोगमा छ', 'Email already in use') }, values: { ...req.member, ...req.body } }, 422);
    throw e;
  }
  flash(req, 'success', t('विवरण सुरक्षित भयो।', 'Profile saved.'));
  res.redirect('/member/profile');
}));

// ---------------------------------------------------------------- name / mobile / date of birth / gender (do_update)
router.post('/profile/details', ah(async (req, res) => {
  const t = res.locals.t, m = req.member;
  const kyc = await portal.linkedKyc(m, true);
  if (kyc?.status === 'approved') { flash(req, 'error', t('तपाईंको केवाइएम स्वीकृत भइसकेको छ। Profile जानकारी edit गर्न Admin लाई सम्पर्क गर्नुहोस्।', 'Your KYM is approved. Contact the office to change these details.')); return res.redirect('/member/profile'); }
  if (kyc?.status === 'rejected') { flash(req, 'error', t('केवाइएम अस्वीकृत छ। Online केवाइएम बाट फेरि भरेर पठाउनुहोस्।', 'Your KYM was rejected. Please submit the online KYM again.')); return res.redirect('/member/profile'); }
  const b = req.body, errors = {};
  const name = String(b.name || '').trim().slice(0, 255);
  const nameNp = String(b.name_np || '').trim().slice(0, 255);
  const gender = ['male', 'female', 'other'].includes(b.gender) ? b.gender : null;
  let dob = nd.toLatinDigits(String(b.dob || '').trim());
  if (dob && b.dob_kind === 'bs') dob = nd.bsToAd(dob) || 'x';
  if (dob && (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(Date.parse(dob)) || Date.parse(dob) > Date.now())) errors.dob = t('जन्म मिति मिलेन', 'Invalid date of birth');
  const phone = portal.normalizeMobile(b.phone);
  if (!name && !nameNp) errors.name = t('नाम राख्नुहोस्।', 'Enter your name.');
  if (b.phone && !/^\d{10}$/.test(phone)) errors.phone = t('१० अंकको मोबाइल नम्बर राख्नुहोस्', 'Enter a 10-digit mobile number');
  const phoneChanged = phone && phone !== portal.normalizeMobile(m.phone);
  // only a CHANGE to someone else's number is blocked
  if (!errors.phone && phoneChanged && await portal.phoneOwnedByOther(phone, m.id)) errors.phone = t('यो मोबाइल नम्बर अर्को सदस्यको खातामा दर्ता छ। आफ्नै नम्बर राख्नुहोस् वा कार्यालयमा सम्पर्क गर्नुहोस्।', 'This mobile number belongs to another member. Use your own number or contact the office.');
  if (Object.keys(errors).length) return renderProfile(req, res, { detailErrors: errors, details: b }, 422);

  const memberData = { name: name || nameNp, name_np: nameNp || m.name_np || '', gender, dob: dob || null };
  await db.transaction(async () => {
    await db.update('members', m.id, memberData);
    if (kyc && kyc.status === 'pending') {
      await db.query('UPDATE kyc_applications SET full_name = $1, full_name_en = $2, gender = $3, dob_ad = $4, updated_at = now() WHERE id = $5',
        [nameNp || name || kyc.full_name, name || kyc.full_name_en || null, gender, dob || null, kyc.id]);
    }
  });
  await auth.audit(req, 'profile_update', 'members', m.id, 'Member updated own profile', { old: { name: m.name, name_np: m.name_np, gender: m.gender, dob: m.dob }, new: memberData });

  if (phoneChanged) {
    // a new mobile is proved with an SMS OTP to that number; without SMS the office approves it
    const ch = await portal.otpChannels({ phone });
    if (ch.sms) {
      const otp = await portal.createOtp(m.id, 'phone_change', 'sms', phone);
      await notify.sendSms('otp_phone_change', phone, `तपाईंको ${res.locals.siteName || ''} मोबाइल परिवर्तन OTP: ${otp}. 10 मिनेटमा expire हुन्छ।`.slice(0, 160));
      req.session.phoneChange = { memberId: m.id, phone, at: Date.now() };
      flash(req, 'info', t(`नयाँ मोबाइल ${portal.maskPhone(phone)} मा OTP पठाइयो। तल राखेर पुष्टि गर्नुहोस्।`, `An OTP was sent to the new mobile ${portal.maskPhone(phone)}. Enter it below to confirm.`));
    } else {
      const open = await db.one("SELECT id FROM member_profile_change_requests WHERE member_id = $1 AND field = 'phone' AND status = 'pending'", [m.id]);
      if (open) await db.query('UPDATE member_profile_change_requests SET new_value = $1, old_value = $2, created_at = now() WHERE id = $3', [phone, m.phone || null, open.id]);
      else await db.query("INSERT INTO member_profile_change_requests (member_id, field, old_value, new_value, status, created_at) VALUES ($1, 'phone', $2, $3, 'pending', now())", [m.id, m.phone || null, phone]);
      await portal.alertOffice('member_phone_change', `मोबाइल परिवर्तन अनुरोध — ${m.name}`, `${m.name} (${m.sadasyata_number || '—'}) ले मोबाइल ${m.phone || '—'} → ${phone} परिवर्तन गर्न अनुरोध गर्नुभयो। Admin → सदस्य पोर्टल मा स्वीकृत गर्नुहोस्।`);
      flash(req, 'info', t('मोबाइल परिवर्तन अनुरोध कार्यालयमा पठाइयो। स्वीकृत भएपछि नयाँ नम्बर लागू हुन्छ।', 'Your mobile change was sent to the office. The new number applies once approved.'));
    }
  } else flash(req, 'success', t('प्रोफाइल सफलतापूर्वक अपडेट भयो।', 'Profile updated.'));
  res.redirect('/member/profile');
}));

router.post('/profile/phone/verify', ah(async (req, res) => {
  const t = res.locals.t, m = req.member;
  const pc = req.session.phoneChange;
  if (!pc || pc.memberId !== m.id || Date.now() - pc.at > 10 * 60_000) { delete req.session.phoneChange; flash(req, 'error', t('समय सकियो। फेरि प्रयास गर्नुहोस्।', 'Expired. Please try again.')); return res.redirect('/member/profile'); }
  if (await auth.tooManyAttempts('phone:' + m.id, req.ip)) { flash(req, 'error', t('धेरै गलत प्रयास। १५ मिनेटपछि प्रयास गर्नुहोस्।', 'Too many attempts. Try again in 15 minutes.')); return res.redirect('/member/profile'); }
  const r = await portal.verifyOtp(m.id, nd.toLatinDigits(String(req.body.otp || '').trim()), 'phone_change');
  if (!r.ok || r.sentTo !== pc.phone) { await auth.recordFailure('phone:' + m.id, req.ip); flash(req, 'error', t('OTP गलत वा म्याद सकियो।', 'OTP is invalid or expired.')); return res.redirect('/member/profile'); }
  if (await portal.phoneOwnedByOther(pc.phone, m.id)) { delete req.session.phoneChange; flash(req, 'error', t('यो मोबाइल नम्बर अर्को सदस्यको खातामा दर्ता छ।', 'This mobile belongs to another member.')); return res.redirect('/member/profile'); }
  await applyPhone(m, pc.phone);
  await auth.audit(req, 'phone_change', 'members', m.id, `Mobile changed by OTP: ${m.phone || '—'} → ${pc.phone}`);
  delete req.session.phoneChange;
  flash(req, 'success', t('मोबाइल नम्बर परिवर्तन भयो।', 'Mobile number changed.'));
  res.redirect('/member/profile');
}));
router.post('/profile/phone/cancel', (req, res) => { delete req.session.phoneChange; res.redirect('/member/profile'); });

/** Mobile change on the member and on a KYM that is still being processed. */
async function applyPhone(m, phone) {
  await db.transaction(async () => {
    await db.query('UPDATE members SET phone = $1 WHERE id = $2', [phone, m.id]);
    const kyc = await portal.linkedKyc(m);
    if (kyc && kyc.status === 'pending') await db.query('UPDATE kyc_applications SET mobile = $1, updated_at = now() WHERE id = $2', [phone, kyc.id]);
    await db.query("UPDATE member_profile_change_requests SET status = 'approved', resolved_at = now(), admin_note = COALESCE(admin_note, 'OTP') WHERE member_id = $1 AND field = 'phone' AND status = 'pending'", [m.id]);
  });
}

// ---------------------------------------------------------------- KYC documents (do_kyc_docs)
router.post('/profile/kyc-docs', (req, res, next) => {
  const [mw, csrf] = uploads.upload('kyc', KYC_DOCS.map(([name]) => ({ name, kind: 'image' })), { maxMb: 8, private: true });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}, ah(async (req, res) => {
  const t = res.locals.t;
  const got = req.uploaded || {};
  const discard = () => Object.values(got).forEach(p => uploads.remove(req, p));
  const kyc = await portal.linkedKyc(req.member, true);
  if (!kyc) { discard(); flash(req, 'error', t('केवाइएम रेकर्ड भेटिएन। पहिले KYC भर्नुहोस्।', 'No KYM record found. Please fill in the KYC form first.')); return res.redirect('/member/profile'); }
  if (req.uploadError) { discard(); flash(req, 'error', req.uploadError); return res.redirect('/member/profile'); }
  const cols = await db.columns('kyc_applications');
  // only documents that are missing (or whose file is gone) — uploaded KYM documents are never replaced here
  const set = {};
  for (const [k] of KYC_DOCS) {
    if (!got[k]) continue;
    if (cols.has(k) && docMissing(req, kyc[k])) set[k] = got[k];
    else uploads.remove(req, got[k]);
  }
  if (!Object.keys(set).length) { flash(req, 'error', t('कुनै नयाँ कागजात प्राप्त भएन। (भइसकेका कागजात यहाँबाट बदल्न मिल्दैन।)', 'No new document received. (Documents already on file cannot be replaced here.)')); return res.redirect('/member/profile'); }
  await db.update('kyc_applications', kyc.id, { ...set, updated_at: new Date() });
  if (!req.member.kyc_application_id) await db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2 AND kyc_application_id IS NULL', [kyc.id, req.member.id]);
  await auth.audit(req, 'kyc_docs', 'kyc_applications', kyc.id, 'Member added KYC documents: ' + Object.keys(set).join(', '));
  flash(req, 'success', t('KYC कागजात सफलतापूर्वक अपडेट भयो।', 'KYC documents updated.'));
  res.redirect('/member/profile');
}));

router.get('/profile/kyc-file/:field', ah(async (req, res, next) => {
  if (!KYC_DOCS.some(([k]) => k === req.params.field)) return next();
  const kyc = await portal.linkedKyc(req.member, true);
  if (!kyc || !kyc[req.params.field]) return next();
  uploads.sendStored(req, res, next, kyc[req.params.field]);
}));

// ---------------------------------------------------------------- member 2FA (authenticator app)
router.get('/profile/2fa', ah(async (req, res) => {
  const m = req.member;
  let qr = null, secret = null, remaining = 0;
  if (!Number(m.twofa_enabled)) {
    req.session.memberTwofaSetup = req.session.memberTwofaSetup || totp.generateSecret();
    secret = req.session.memberTwofaSetup;
    qr = await QRCode.toDataURL(totp.provisioningUri(res.locals.siteName || req.tenant.name, 'member-' + (m.sadasyata_number || m.id), secret), { margin: 1, width: 220 });
  }
  try { remaining = JSON.parse(m.twofa_backup_codes || '[]').length; } catch { /* ignore */ }
  res.render('member/twofa', { title: res.locals.t('दुई-चरण प्रमाणीकरण', 'Two-step sign-in'), qr, secret, remaining, codes: null, required: (await settings.get('member_2fa_required', '0')) === '1' });
}));

router.post('/profile/2fa/enable', ah(async (req, res) => {
  const t = res.locals.t, m = req.member;
  const secret = req.session.memberTwofaSetup;
  if (m.password_hash && !(await auth.checkPassword(req.body.password, m.password_hash))) { flash(req, 'error', t('पासवर्ड मिलेन।', 'Password is wrong.')); return res.redirect('/member/profile/2fa'); }
  if (!secret || totp.verify(secret, req.body.code) === null) { flash(req, 'error', t('कोड मिलेन। एपमा देखिएको ६ अंकको कोड राख्नुहोस्।', 'Code did not match. Enter the 6-digit code from the app.')); return res.redirect('/member/profile/2fa'); }
  const { codes, hashes } = await totp.backupCodes();
  await db.query('UPDATE members SET twofa_enabled = 1, twofa_secret = $1, twofa_backup_codes = $2, twofa_enabled_at = now() WHERE id = $3', [secret, JSON.stringify(hashes), m.id]);
  delete req.session.memberTwofaSetup;
  await auth.bumpSessionVersion('members', m.id, req);
  await auth.audit(req, '2fa_enable', 'members', m.id, 'Member 2FA enabled');
  res.render('member/twofa', { title: t('दुई-चरण प्रमाणीकरण', 'Two-step sign-in'), qr: null, secret: null, remaining: codes.length, codes, required: false, member: { ...m, twofa_enabled: 1 } });
}));

router.post('/profile/2fa/disable', ah(async (req, res) => {
  const t = res.locals.t, m = req.member;
  if ((await settings.get('member_2fa_required', '0')) === '1') { flash(req, 'error', t('सहकारीले सबै सदस्यलाई 2FA अनिवार्य गरेको छ।', 'The cooperative requires 2FA for every member.')); return res.redirect('/member/profile/2fa'); }
  const pwOk = !m.password_hash || await auth.checkPassword(req.body.password, m.password_hash);
  if (!pwOk || totp.verify(m.twofa_secret, req.body.code) === null) { flash(req, 'error', t('पासवर्ड वा कोड मिलेन।', 'Password or code is wrong.')); return res.redirect('/member/profile/2fa'); }
  await db.query('UPDATE members SET twofa_enabled = 0, twofa_secret = NULL, twofa_backup_codes = NULL, twofa_enabled_at = NULL WHERE id = $1', [m.id]);
  await auth.audit(req, '2fa_disable', 'members', m.id, 'Member 2FA disabled');
  flash(req, 'success', t('2FA बन्द गरियो।', '2FA turned off.'));
  res.redirect('/member/profile/2fa');
}));

// ---------------------------------------------------------------- Facebook link
router.get('/oauth/facebook/link', ah(async (req, res) => res.redirect((await facebook.start(req, 'link')) || '/member/profile')));
router.post('/oauth/facebook/unlink', ah(async (req, res) => {
  if (!req.member.password_hash) { flash(req, 'error', res.locals.t('पहिले पासवर्ड सेट गर्नुहोस्।', 'Set a password first.')); return res.redirect('/member/profile'); }
  await db.query('UPDATE members SET facebook_id = NULL WHERE id = $1', [req.member.id]);
  await auth.audit(req, 'facebook_unlink', 'members', req.member.id, 'Facebook account unlinked');
  res.redirect('/member/profile');
}));

// ---------------------------------------------------------------- programme QR scanner (member/scan.php)
router.get('/scan', (req, res) => res.render('member/scan', { title: res.locals.t('कार्यक्रम QR स्क्यान', 'Programme QR scan') }));

// ---------------------------------------------------------------- locked ID card → ask the office to unlock
router.post('/id-card/unlock-request', ah(async (req, res) => {
  const r = await db.query(`UPDATE member_id_cards SET unlock_requested = 1, unlock_requested_at = now()
                            WHERE member_id = $1 AND status = 'active' AND locked_at IS NOT NULL AND COALESCE(unlock_requested, 0) = 0`, [String(req.member.id)]);
  if (r.rowCount) {
    await auth.audit(req, 'card_unlock_request', 'members', req.member.id, 'Member asked to unlock the ID card');
    await portal.alertOffice('card_unlock_request', `ID card unlock — ${req.member.name}`, `${req.member.name} (${req.member.sadasyata_number || '—'}) ले LOCK भएको परिचयपत्र unlock गर्न अनुरोध गर्नुभयो।`);
  }
  flash(req, 'success', res.locals.t('Unlock अनुरोध कार्यालयमा पठाइयो।', 'Unlock request sent to the office.'));
  res.redirect('/member/id-card');
}));

module.exports = router;
module.exports.applyPhone = applyPhone;
