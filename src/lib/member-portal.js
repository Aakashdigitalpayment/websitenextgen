'use strict';
/**
 * Member portal business rules ported from the PHP app
 * (includes/member-auth.php, includes/member-ssot.php, includes/member-monthly-saving.php,
 *  includes/card-verify-helpers.php). Everything is tenant-scoped through db.
 */
const crypto = require('crypto');
const db = require('../db');
const nd = require('./nepali-date');
const config = require('../config');
const settings = require('./settings');
const notify = require('./notify');

// ---------------------------------------------------------------- identity normalisation (member-ssot.php)
const DEVA = '०१२३४५६७८९';
/** Member ID: Latin digits, no spaces, upper case (memberSsotNormalizeId). */
const normalizeId = id => nd.toLatinDigits(String(id ?? '').trim()).replace(/\s+/g, '').toUpperCase().slice(0, 50);
/** Canonical Latin ID + the Devanagari-digit form legacy rows may hold. */
function idVariants(id) {
  const n = normalizeId(id);
  if (!n) return [];
  const deva = n.replace(/[0-9]/g, d => DEVA[d]);
  return deva === n ? [n] : [n, deva];
}
/** Mobile: digits only, 977-prefixed numbers trimmed to the last 10 (memberSsotNormalizeMobile). */
function normalizeMobile(p) {
  let d = nd.toLatinDigits(String(p ?? '')).replace(/\D+/g, '');
  if (d.length > 10 && d.startsWith('977')) d = d.slice(-10);
  return d;
}
function phonesMatch(a, b) {
  const x = normalizeMobile(a), y = normalizeMobile(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(y) || y.endsWith(x);
}
/** SQL expression: a phone column reduced to digits (for comparisons with normalizeMobile output). */
const phoneDigitsSql = col => `right(regexp_replace(COALESCE(${col}::text, ''), '[^0-9]', '', 'g'), 10)`;

async function findBySadasyata(id, { includeDeleted = false } = {}) {
  const v = idVariants(id);
  if (!v.length) return null;
  return db.one(`SELECT * FROM members WHERE upper(trim(sadasyata_number)) = ANY($1) ${includeDeleted ? '' : 'AND deleted_at IS NULL'} ORDER BY id LIMIT 1`, [v]);
}

/** Prefer approved, then the newest non-rejected KYM for a member ID. */
async function findKycByMemberId(id, includeRejected = false) {
  const v = idVariants(id);
  if (!v.length) return null;
  const row = await db.one(`SELECT * FROM kyc_applications WHERE upper(trim(member_id)) = ANY($1) AND deleted_at IS NULL AND status <> 'rejected'
                            ORDER BY (status = 'approved') DESC, id DESC LIMIT 1`, [v]);
  if (row || !includeRejected) return row;
  return db.one(`SELECT * FROM kyc_applications WHERE upper(trim(member_id)) = ANY($1) AND deleted_at IS NULL AND status = 'rejected' ORDER BY id DESC LIMIT 1`, [v]);
}

/** KYM linked to a members row: by kyc_application_id, then by membership number. */
async function linkedKyc(member, includeRejected = false) {
  for (const id of [member.kyc_application_id, member.kyc_id]) {
    if (!id) continue;
    const k = await db.one(`SELECT * FROM kyc_applications WHERE id = $1 AND deleted_at IS NULL ${includeRejected ? '' : "AND status <> 'rejected'"}`, [id]);
    if (k) return k;
  }
  return member.sadasyata_number ? findKycByMemberId(member.sadasyata_number, includeRejected) : null;
}

/** Does this mobile already belong to ANOTHER member (ledger phone or linked KYM)? */
async function phoneOwnedByOther(phone, selfId) {
  const d = normalizeMobile(phone);
  if (!d) return false;
  return !!(await db.value(`SELECT 1 FROM members m LEFT JOIN kyc_applications k ON k.id = m.kyc_application_id
                            WHERE m.id <> $1 AND m.deleted_at IS NULL AND (${phoneDigitsSql('m.phone')} = $2 OR ${phoneDigitsSql('k.mobile')} = $2) LIMIT 1`, [selfId || 0, d.slice(-10)]));
}

// ---------------------------------------------------------------- password policy (memberPasswordPolicyError)
function passwordPolicyError(pw, t) {
  const s = String(pw || '');
  if (s.length < 8) return t('पासवर्ड कम्तिमा ८ अक्षरको हुनुपर्छ।', 'Password must be at least 8 characters.');
  if (s.length > 200) return t('पासवर्ड धेरै लामो भयो।', 'Password is too long.');
  if (!/[A-Z]/.test(s)) return t('पासवर्डमा कम्तिमा एउटा Capital letter (A-Z) हुनुपर्छ।', 'Password must include at least one capital letter (A-Z).');
  if (!/[a-z]/.test(s)) return t('पासवर्डमा कम्तिमा एउटा small letter (a-z) हुनुपर्छ।', 'Password must include at least one lowercase letter (a-z).');
  if (!/[0-9]/.test(s)) return t('पासवर्डमा कम्तिमा एउटा digit (0-9) हुनुपर्छ।', 'Password must include at least one digit (0-9).');
  return null;
}

// ---------------------------------------------------------------- self-registration (member/login.php do_register)
/**
 * Validate a registration and either attach a password to the ledger member (stub created by import / KYM approval)
 * or create a new pending account prefilled from the KYM record.
 * @returns {{ error?: string, member?: object, attached?: boolean }}
 */
async function register({ sadasyata, email, phone, password, confirm }, t) {
  const sid = normalizeId(sadasyata);
  email = String(email || '').trim().toLowerCase();
  const mobile = normalizeMobile(phone);
  if (!sid) return { error: t('सदस्यता नम्बर अनिवार्य छ।', 'Member number is required.') };
  if (!email || !phone) return { error: t('दर्ताका लागि इमेल र मोबाइल दुवै अनिवार्य छन्।', 'Both email and mobile are required for registration.') };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: t('मान्य इमेल ठेगाना राख्नुहोस्।', 'Please enter a valid email address.') };
  if (!/^[0-9]{10}$/.test(mobile)) return { error: t('१० अंकको मोबाइल नम्बर राख्नुहोस् (सदस्य सूचीसँग मिल्नुपर्छ)।', 'Enter a valid 10-digit mobile that matches the members list.') };
  const pwErr = passwordPolicyError(password, t);
  if (pwErr) return { error: pwErr };
  if (password !== confirm) return { error: t('दुवै पासवर्ड मेल खाएनन्।', 'Passwords do not match.') };

  const stub = await findBySadasyata(sid);
  let kyc = null;
  if (stub) {
    // Member ID + mobile must match the members ledger (memberSsotRequireMemberIdAndMobile)
    if (!normalizeMobile(stub.phone)) return { error: t('सदस्य सूचीमा यो Member ID को मोबाइल खाली छ। कार्यालयमा सम्पर्क गरी मोबाइल अपडेट गराउनुहोस्।', 'This Member ID has no mobile on the members list. Please ask the office to update it.') };
    if (!phonesMatch(stub.phone, mobile)) return { error: t('Member ID र मोबाइल मिलेन। सहकारीमा दर्ता भएको मोबाइल नै प्रयोग गर्नुहोस्।', 'Member ID and mobile do not match. Use the mobile registered with the cooperative.') };
    kyc = await linkedKyc(stub, true);
    if (kyc && kyc.mobile && !phonesMatch(kyc.mobile, mobile)) return { error: t('यो Member ID को केवाइएममा अर्कै मोबाइल छ। गलत मान्छेको डेटा अपडेट गर्न मिल्दैन।', "Linked KYM has a different mobile. You cannot update another person's record.") };
    if (stub.password_hash) return { error: t('यो सदस्यता नम्बर पहिले नै दर्ता भएको छ। लगिन गर्नुहोस्।', 'This member number is already registered. Please login.') };
  } else {
    // not on the ledger yet: the KYM record (member no. + mobile + email) must match
    kyc = await findKycByMemberId(sid, true);
    const emailOk = kyc && (!kyc.email || String(kyc.email).trim().toLowerCase() === email);
    if (!kyc || !phonesMatch(kyc.mobile, mobile) || !emailOk) {
      return { error: t('यो सदस्यता नम्बर सदस्य सूचीमा छैन, वा सदस्यता नम्बर + इमेल + मोबाइल KYC विवरणसँग मिलेन।', 'This member number is not on the members list, or member number + email + mobile do not match the KYC details.') };
    }
  }
  if (kyc && kyc.status === 'rejected') return { error: t('तपाईंको केवाइएम अस्वीकृत छ। कृपया सहकारीमा सम्पर्क गरी KYC अपडेट गर्नुहोस्।', 'Your KYC is rejected. Please contact cooperative and update KYC.') };

  const selfId = stub ? stub.id : 0;
  if (await db.value('SELECT 1 FROM members WHERE lower(email) = $1 AND id <> $2', [email, selfId])) return { error: t('यो इमेल पहिले नै दर्ता भएको छ।', 'This email is already registered.') };
  if (await db.value(`SELECT 1 FROM members WHERE deleted_at IS NULL AND id <> $2 AND ${phoneDigitsSql('phone')} = $1`, [mobile, selfId])) return { error: t('यो मोबाइल नम्बर पहिले नै दर्ता भएको छ।', 'This mobile number is already registered.') };

  // signup data comes from KYM — no duplicate typing
  const kycNp = String(kyc?.full_name || '').trim(), kycEn = String(kyc?.full_name_en || '').trim();
  const hash = await require('./auth').hashPassword(password);
  try {
    if (stub) {
      const m = await db.one(`UPDATE members SET name = $1, email = COALESCE($2, email), phone = COALESCE($3, phone), password_hash = $4,
                                kyc_application_id = COALESCE($5, kyc_application_id),
                                approval_status = CASE WHEN approval_status = 'rejected' THEN 'pending' ELSE approval_status END
                              WHERE id = $6 RETURNING *`,
      [kycEn || stub.name || kycNp || 'Member', email, mobile, hash, kyc?.id || null, stub.id]);
      return { member: m, attached: true };
    }
    if (!kycNp && !kycEn) return { error: t('KYC record मा नाम खाली छ। कृपया KYC update गर्नुहोस्।', 'Name is empty in KYC record. Please update KYC.') };
    const m = await db.insert('members', {
      name: kycEn || kycNp, name_np: kycNp, email, phone: mobile, sadasyata_number: sid, password_hash: hash,
      approval_status: 'pending', kyc_application_id: kyc.id, is_active: 1, is_verified: 0,
      dob: kyc.dob_ad || null, gender: kyc.gender || null, address: kyc.permanent_address || null,
    });
    await notify.notifyMember(m.id, 'दर्ता सफल — Admin अनुमोदन प्रतीक्षामा', 'तपाईंको दर्ता सफलतापूर्वक प्राप्त भयो। Admin ले अनुमोदन गरेपछि लगिन गर्न सक्नुहुन्छ।', '/member/login', 'info');
    return { member: m, attached: false };
  } catch (e) {
    if (e.code === '23505') return { error: t('दर्ता विवरण पहिले नै रेकर्डमा छ।', 'These details are already registered.') };
    throw e;
  }
}

/** Login gate shared by password, OAuth and 2FA completion (memberLoginEligibilityError). */
function eligibilityError(m, t) {
  if (!m.is_active) return t('तपाईंको खाता निष्क्रिय छ। कार्यालयमा सम्पर्क गर्नुहोस्।', 'Your account is inactive. Please contact the office.');
  if (m.approval_status === 'pending') return t('तपाईंको खाता स्वीकृत हुन बाँकी छ। Admin अनुमोदनपछि लगिन गर्न सक्नुहुन्छ।', 'Your account is awaiting approval. You can sign in once the office approves it.');
  if (m.approval_status === 'rejected') {
    return t('तपाईंको दर्ता अस्वीकृत भएको छ।', 'Your registration has been rejected.')
      + (m.rejection_reason ? t(' कारण: ', ' Reason: ') + m.rejection_reason : '')
      + t(' थप जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोस्।', ' Please contact the office for more details.');
  }
  if (m.approval_status && m.approval_status !== 'approved') return t('तपाईंको खाता अहिले सक्रिय छैन। कार्यालयमा सम्पर्क गर्नुहोस्।', 'Your account is not active right now. Please contact the office.');
  return null;
}

// ---------------------------------------------------------------- admin approve / reject (member-auth.php:973 / :1028)
const firstName = n => String(n || '').trim().split(/\s+/)[0] || 'सदस्य';
const siteUrl = req => (req ? `${req.protocol}://${req.get('host')}` : '');

async function approve(memberId, adminId, req) {
  const m = await db.one(`UPDATE members SET approval_status = 'approved', approved_at = now(), approved_by = $1, rejection_reason = NULL,
                            card_expires_at = now() + interval '5 years' WHERE id = $2 AND deleted_at IS NULL RETURNING *`, [adminId || null, memberId]);
  if (!m) return null;
  await notify.notifyMember(m.id, 'तपाईंको खाता स्वीकृत भयो!', 'सहकारीको Member Portal मा तपाईंको खाता Admin द्वारा स्वीकृत भएको छ। अब लगिन गर्न सक्नुहुन्छ।', '/member/login', 'success');
  const s = await settings.all();
  const site = s.site_name || 'सहकारी';
  const url = siteUrl(req) + '/member/login';
  notify.later(async () => {
    if (m.phone) await notify.sendSms('member_approved', m.phone, `नमस्ते ${firstName(m.name_np || m.name)} जी, तपाईंको ${site} Member Portal खाता स्वीकृत भयो। अब login गर्न सक्नुहुन्छ: ${url}`.slice(0, 160));
    if (m.email) await notify.sendEmail('member_approved', m.email, `खाता स्वीकृत — ${site}`, `नमस्ते ${firstName(m.name_np || m.name)} जी,\n\nतपाईंको Member Portal खाता स्वीकृत भएको छ। अहिले लगइन गर्नुहोस्: ${url}\n\nधन्यवाद,\n${site}`);
  });
  return m;
}

async function reject(memberId, reason, adminId) {
  reason = String(reason || '').trim().slice(0, 500);
  const m = await db.one("UPDATE members SET approval_status = 'rejected', approved_by = $1, rejection_reason = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *", [adminId || null, reason || null, memberId]);
  if (!m) return null;
  await notify.notifyMember(m.id, 'दर्ता अस्वीकृत भयो', 'माफ गर्नुहोस्, तपाईंको Member Portal दर्ता स्वीकृत हुन सकेन।' + (reason ? ' कारण: ' + reason : '') + ' थप जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोस्।', '/member/login', 'error');
  const site = (await settings.get('site_name')) || 'सहकारी';
  if (m.phone) notify.later(() => notify.sendSms('member_rejected', m.phone, `नमस्ते ${firstName(m.name_np || m.name)} जी, तपाईंको ${site} Member Portal दर्ता अस्वीकृत भयो।${reason ? ' कारण: ' + notifySafe(reason, 50) : ''} कार्यालयमा सम्पर्क गर्नुहोस्।`));
  return m;
}
const notifySafe = (v, n) => String(v || '').replace(/https?:\/\/\S+|www\.\S+|[<>]/gi, '').replace(/\s+/g, ' ').trim().slice(0, n);

/** In-app + email alert to the office (notifyAdminOfPasswordResetRequest). */
async function alertOffice(event, subject, text) {
  const s = await settings.all();
  const to = s.admin_notify_email || s.notify_admin_emails;
  if (to) notify.later(() => notify.sendEmail(event, to, subject, text));
}

// ---------------------------------------------------------------- OTP (member-auth.php:1580-1760)
const OTP_TTL_MIN = 10, OTP_MAX_ATTEMPTS = 5;
const otpHash = code => crypto.createHmac('sha256', crypto.createHmac('sha256', config.sessionSecret).update('member-otp:' + (db.currentSchema() || '')).digest()).update(String(code)).digest('hex');

async function createOtp(memberId, purpose, channel, sentTo) {
  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await db.query('UPDATE member_otp_tokens SET is_used = 1 WHERE member_id = $1 AND purpose = $2 AND is_used = 0', [memberId, purpose]);
  await db.query(`INSERT INTO member_otp_tokens (member_id, otp_code, purpose, channel, sent_to, is_used, attempts, expires_at, created_at)
                  VALUES ($1, $2, $3, $4, $5, 0, 0, now() + interval '${OTP_TTL_MIN} minutes', now())`, [memberId, otpHash(otp), purpose, channel, String(sentTo || '').slice(0, 200)]);
  return otp;
}

/** @returns {Promise<{ok: boolean, sentTo?: string}>} — invalidated after 5 wrong tries. */
async function verifyOtp(memberId, code, purpose) {
  const row = await db.one(`SELECT * FROM member_otp_tokens WHERE member_id = $1 AND purpose = $2 AND is_used = 0 AND expires_at > now() ORDER BY id DESC LIMIT 1`, [memberId, purpose]);
  if (!row) return { ok: false };
  if (row.attempts >= OTP_MAX_ATTEMPTS || String(row.otp_code).length !== 64) {
    await db.query('UPDATE member_otp_tokens SET is_used = 1 WHERE id = $1', [row.id]);
    return { ok: false };
  }
  const given = otpHash(String(code || '').trim());
  if (!crypto.timingSafeEqual(Buffer.from(given), Buffer.from(String(row.otp_code)))) {
    await db.query('UPDATE member_otp_tokens SET attempts = attempts + 1, is_used = CASE WHEN attempts + 1 >= $2 THEN 1 ELSE 0 END WHERE id = $1', [row.id, OTP_MAX_ATTEMPTS]);
    return { ok: false };
  }
  await db.query('UPDATE member_otp_tokens SET is_used = 1 WHERE id = $1', [row.id]);
  return { ok: true, sentTo: row.sent_to };
}

const maskPhone = p => { const d = String(p || ''); return d.length > 4 ? '*'.repeat(d.length - 4) + d.slice(-4) : '****'; };
const maskEmail = e => {
  const [u, d = ''] = String(e || '').split('@');
  return (u.length > 2 ? u.slice(0, 2) + '*'.repeat(Math.max(1, u.length - 2)) : '**') + '@' + d;
};

/** Which channels can deliver an OTP right now. */
async function otpChannels(member) {
  const s = await settings.all();
  return {
    sms: s.notify_sms_enabled === '1' && !!(s.notify_sms_token || s.notify_sms_api_url) && normalizeMobile(member?.phone).length >= 10,
    email: s.notify_email_enabled === '1' && !!s.smtp_host && !!member?.email,
  };
}

/**
 * Pick a channel (SMS preferred, email fallback — dispatchOTP) and send the reset OTP.
 * @returns {Promise<{channel: 'sms'|'email'|'none', sentTo: string, sent: boolean}>}
 */
async function dispatchOtp(member, forced = 'auto', purpose = 'password_reset') {
  const ch = await otpChannels(member);
  const s = await settings.all();
  const site = s.site_name || 'सहकारी';
  let channel = 'none';
  if (forced === 'email' ? ch.email : forced === 'sms' ? ch.sms : ch.sms || ch.email) channel = forced === 'email' ? 'email' : forced === 'sms' ? 'sms' : ch.sms ? 'sms' : 'email';
  if (channel === 'none') return { channel, sentTo: '', sent: false };
  if (channel === 'sms') {
    const phone = normalizeMobile(member.phone);
    const otp = await createOtp(member.id, purpose, 'sms', phone);
    const r = await notify.sendSms('otp_' + purpose, phone, `तपाईंको ${site} पोर्टल OTP: ${otp}. यो 10 मिनेटमा expire हुन्छ। अरूसँग share नगर्नुहोस्।`.slice(0, 160));
    return { channel, sentTo: maskPhone(phone), sent: !!r.ok };
  }
  const otp = await createOtp(member.id, purpose, 'email', member.email);
  const r = await notify.sendEmail('otp_' + purpose, member.email, `${site} — पासवर्ड रिसेट OTP`,
    `नमस्ते ${member.name_np || member.name} जी,\n\nतपाईंको पासवर्ड रिसेट गर्न OTP: ${otp}\n\nयो OTP १० मिनेटमा expire हुन्छ। अरूसँग share नगर्नुहोस्।\n\n${site}`);
  return { channel, sentTo: maskEmail(member.email), sent: !!r.ok };
}

/** Member for a reset: email, membership number or mobile. */
async function findForReset(identifier) {
  const id = nd.toLatinDigits(String(identifier || '').trim());
  if (!id) return null;
  const byId = await findBySadasyata(id);
  if (byId) return byId;
  const mobile = normalizeMobile(id);
  return db.one(`SELECT * FROM members WHERE deleted_at IS NULL AND (lower(email) = lower($1) ${mobile.length >= 10 ? `OR ${phoneDigitsSql('phone')} = $2` : ''}) ORDER BY id LIMIT 1`,
    mobile.length >= 10 ? [id, mobile.slice(-10)] : [id]);
}

// ---------------------------------------------------------------- ID card (adminGenerateMemberIdCard, getCardPrefix)
async function cardPrefix(tenant) {
  const override = String(await settings.get('card_prefix') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (override.length === 3) return override;
  const fromSlug = String(tenant?.slug || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  return fromSlug.length === 3 ? fromSlug : 'MEM';
}

async function issueCard(member, adminId, tenant) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rnd = n => Array.from(crypto.randomBytes(n), x => alphabet[x % alphabet.length]).join('');
  const prefix = await cardPrefix(tenant);
  const code = `${prefix}-${rnd(4)}-${rnd(4)}`;
  const cvv = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  const cardNo = member.member_card_no || member.sadasyata_number || `${prefix}${String(member.id).padStart(6, '0')}`;
  const expiry = new Date(Date.now() + 5 * 365 * 86400_000).toISOString().slice(0, 10);
  const first = !Number(member.id_card_generated);
  await db.transaction(async () => {
    await db.query("UPDATE member_id_cards SET status = 'revoked' WHERE member_id = $1 AND status = 'active'", [String(member.id)]);
    await db.query(`INSERT INTO member_id_cards (member_id, card_no, verification_code, cvv, issued_date, expiry_date, status, created_by, created_at)
                    VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, 'active', $6, now())`, [String(member.id), cardNo + '-' + rnd(3), code, cvv, expiry, adminId || null]);
    await db.query('UPDATE members SET member_card_no = $1, id_card_generated = 1, id_card_generated_at = COALESCE(id_card_generated_at, now()), card_expires_at = $2 WHERE id = $3', [cardNo, expiry, member.id]);
  });
  await notify.notifyMember(member.id, first ? 'डिजिटल परिचयपत्र तयार भयो!' : 'नयाँ डिजिटल परिचयपत्र जारी भयो',
    first ? 'तपाईंको डिजिटल Member ID Card Admin द्वारा तयार गरिएको छ। Member Portal मा हेर्नुहोस्।' : 'तपाईंको नयाँ डिजिटल परिचयपत्र जारी भयो। पुरानो कार्ड रद्द भएको छ।', '/member/id-card', 'success');
  return { code, cvv };
}

const CARD_LOCK_AFTER = 5;

// ---------------------------------------------------------------- signed public ID-card preview (tracker-id-card.php)
const cardLinkKey = () => crypto.createHmac('sha256', config.sessionSecret).update('tracker-id-card:' + (db.currentSchema() || '')).digest();
function signCardLink(memberId, ttlSec = 900, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', cardLinkKey()).update(`${memberId}.${exp}`).digest('hex');
  return `/track/id-card?mid=${memberId}&exp=${exp}&sig=${sig}`;
}
/** @returns {'ok'|'invalid'|'expired'|'bad-signature'} */
function checkCardLink(mid, exp, sig, now = Date.now()) {
  if (!/^\d{1,10}$/.test(String(mid || '')) || !/^\d{9,11}$/.test(String(exp || '')) || !/^[0-9a-f]{64}$/.test(String(sig || ''))) return 'invalid';
  if (Number(exp) * 1000 < now) return 'expired';
  if (Number(exp) * 1000 > now + 3600_000) return 'invalid';
  const want = crypto.createHmac('sha256', cardLinkKey()).update(`${Number(mid)}.${Number(exp)}`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(String(sig))) ? 'ok' : 'bad-signature';
}

// ---------------------------------------------------------------- मासिक बचत (member-monthly-saving.php)
const MS_YES = ['1', 'yes', 'y', 'true', 'regular', 'niyamit', 'नियमित', 'हो', 'छ', 'ho', 'cha', 'chha', '✓'];
const MS_NO = ['0', 'no', 'n', 'false', 'irregular', 'not regular', 'aniyamit', 'अनियमित', 'होइन', 'छैन', 'hoina', 'chaina', '✗',
  'नियमित नभएको', 'नियमित नभएका', 'नियमित छैन', 'niyamit nabhayeko', 'niyamit nabhaeko', 'niyamit chaina'];
/** CSV / form value → { ok, value: 1 | 0 | null }. Blank = null (keep); unknown text = not ok. */
function parseMonthlySaving(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'boolean' || typeof raw === 'number') return { ok: true, value: raw ? 1 : 0 };
  const v = nd.toLatinDigits(String(raw)).trim().toLowerCase().replace(/[\s_\-.]+/gu, ' ').trim();
  if (!v) return { ok: true, value: null };
  if (MS_YES.includes(v)) return { ok: true, value: 1 };
  if (MS_NO.includes(v)) return { ok: true, value: 0 };
  return { ok: false, value: null };
}
const msFromDb = v => (v === null || v === undefined || v === '' ? null : Number(v) === 1 ? 1 : 0);
const msLabel = (v, en) => (v === 1 ? (en ? 'Regular' : 'नियमित') : v === 0 ? (en ? 'Not regular' : 'नियमित नभएको') : (en ? 'Not set' : 'नतोकिएको'));

/** Field-only update CSV: member_id + monthly_saving; never creates members (memberImportFieldUpdate). */
async function monthlySavingFieldUpdate(rows) {
  const res = { ok: true, total: 0, changed: 0, unchanged: 0, blank: 0, not_found: 0, invalid: 0, problems: [] };
  const problem = (row, sid, raw, why) => { if (res.problems.length < 2000) res.problems.push([row, sid, raw, why]); };
  const header = (rows[0] || []).map(h => String(h).trim().toLowerCase().replace(/^﻿/, ''));
  const ID = ['member_id', 'sadasyata_number', 'member_no', 'membership_no', 'sadasyata', 'सदस्यता नं', 'सदस्यता नम्बर'];
  const MS = ['monthly_saving', 'monthly saving', 'monthly_saving_regular', 'monthly_saving_status', 'saving_regular', 'masik_bachat', 'masik bachat', 'मासिक_बचत', 'मासिक बचत'];
  const iId = header.findIndex(h => ID.includes(h)), iMs = header.findIndex(h => MS.includes(h));
  if (iId < 0 || iMs < 0) return { ok: false, error: "CSV header मा 'member_id' र 'monthly_saving' दुवै चाहिन्छ। / The CSV header needs both 'member_id' and 'monthly_saving'." };
  const want = new Map(); // last row wins
  for (let r = 1; r < rows.length; r++) {
    if (!rows[r].some(v => String(v).trim() !== '')) continue;
    res.total++;
    const sid = normalizeId(rows[r][iId]);
    const raw = String(rows[r][iMs] ?? '').trim();
    if (!sid) { res.invalid++; problem(r + 1, '', raw, 'member_id खाली / empty'); continue; }
    const p = parseMonthlySaving(raw);
    if (!p.ok) { res.invalid++; problem(r + 1, sid, raw, 'monthly_saving गलत — नियमित / नियमित नभएको (1 / 0)'); continue; }
    if (p.value === null) { res.blank++; continue; }
    want.set(sid, [p.value, r + 1, raw]);
  }
  const found = new Map();
  const keys = [...want.keys()];
  for (let i = 0; i < keys.length; i += 500) {
    const batch = keys.slice(i, i + 500);
    const all = batch.flatMap(idVariants);
    const ms = await db.many('SELECT id, sadasyata_number, monthly_saving_regular FROM members WHERE deleted_at IS NULL AND upper(trim(sadasyata_number)) = ANY($1)', [all]);
    for (const m of ms) {
      const k = normalizeId(m.sadasyata_number);
      if (!found.has(k)) found.set(k, []);
      found.get(k).push([m.id, msFromDb(m.monthly_saving_regular)]);
    }
  }
  const toSet = { 1: [], 0: [] };
  for (const [sid, [value, rn, raw]] of want) {
    const list = found.get(sid);
    if (!list) { res.not_found++; problem(rn, sid, raw, 'Member ID सिस्टममा छैन — केही परिवर्तन भएन / not found'); continue; }
    let changed = false;
    for (const [id, cur] of list) if (cur !== value) { toSet[value].push(id); changed = true; }
    res[changed ? 'changed' : 'unchanged']++;
  }
  await db.transaction(async () => {
    for (const v of [1, 0]) if (toSet[v].length) await db.query('UPDATE members SET monthly_saving_regular = $1 WHERE id = ANY($2)', [v, toSet[v]]);
  });
  return res;
}

// ---------------------------------------------------------------- duplicate membership numbers (member-ssot-duplicates.php)
async function duplicateReport() {
  return db.many(`SELECT upper(trim(sadasyata_number)) AS sadasyata_number, count(*)::int AS cnt,
                         json_agg(json_build_object('id', id, 'name', COALESCE(NULLIF(name_np, ''), name), 'phone', phone, 'status', approval_status,
                                                    'has_password', password_hash IS NOT NULL, 'created_at', created_at) ORDER BY id) AS members
                  FROM members WHERE deleted_at IS NULL AND trim(sadasyata_number) <> ''
                  GROUP BY upper(trim(sadasyata_number)) HAVING count(*) > 1 ORDER BY count(*) DESC, 1 LIMIT 500`);
}
const uniqueGuardExists = async () => !!(await db.value("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'members_sadasyata_uq'"));
async function tryUniqueGuard() {
  if (await uniqueGuardExists()) return { ok: true, message: ['UNIQUE पहिले नै छ।', 'The unique guard already exists.'] };
  const dups = await duplicateReport();
  if (dups.length) return { ok: false, message: [`UNIQUE थप्न सकिएन: ${dups.length} वटा दोहोरो सदस्यता नम्बर छन्। पहिले मिलाउनुहोस्।`, `Cannot add the guard: ${dups.length} duplicate member numbers. Fix them first.`] };
  await db.query("CREATE UNIQUE INDEX IF NOT EXISTS members_sadasyata_uq ON members (upper(trim(sadasyata_number))) WHERE deleted_at IS NULL AND trim(sadasyata_number) <> ''");
  return { ok: true, message: ['UNIQUE guard थपियो।', 'Unique guard added.'] };
}
/** Is this membership number used by another live member? */
async function sadasyataTaken(sid, selfId) {
  const v = idVariants(sid);
  if (!v.length) return false;
  return !!(await db.value('SELECT 1 FROM members WHERE deleted_at IS NULL AND id <> $1 AND upper(trim(sadasyata_number)) = ANY($2) LIMIT 1', [selfId || 0, v]));
}

// ---------------------------------------------------------------- activity timeline (admin/member-activities.php)
/**
 * Everything one member did: applications in every module (matched by member no. + phone, phone or email),
 * programme attendance / pre-registration, password resets, profile change requests and portal notices.
 */
async function activities(member, { from = null, to = null } = {}) {
  const modules = require('../modules/applications');
  const keys = [member.sadasyata_number, member.member_card_no, String(member.id)].filter(Boolean);
  const phone = normalizeMobile(member.phone).slice(-10);
  const email = String(member.email || '').trim().toLowerCase();
  const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v));
  const range = (col, params) => {
    let sql = '';
    if (isDate(from)) { params.push(from); sql += ` AND ${col} >= $${params.length}::date`; }
    if (isDate(to)) { params.push(to); sql += ` AND ${col} < $${params.length}::date + 1`; }
    return sql;
  };
  const out = [];
  for (const m of Object.values(modules)) {
    if (m.key === 'contact') continue;
    const cols = await db.columns(m.table);
    const conds = [], params = [];
    if (m.memberCol && cols.has(m.memberCol) && keys.length) { params.push(keys); conds.push(`${m.memberCol}::text = ANY($${params.length})`); }
    if (phone.length >= 10 && cols.has(m.phoneCol)) { params.push(phone); conds.push(`${phoneDigitsSql(m.phoneCol)} = $${params.length}`); }
    if (email && cols.has('email')) { params.push(email); conds.push(`lower(email) = $${params.length}`); }
    if (m.key === 'honor' && cols.has('member_portal_id')) { params.push(member.id); conds.push(`member_portal_id = $${params.length}`); }
    if (!conds.length) continue;
    const where = `(${conds.join(' OR ')})${cols.has('deleted_at') ? ' AND deleted_at IS NULL' : ''}${range('created_at', params)}`;
    const rows = await db.many(`SELECT * FROM ${m.table} WHERE ${where} ORDER BY created_at DESC NULLS LAST LIMIT 100`, params);
    for (const r of rows) out.push({ date: r.created_at, type: m.title, status: m.noStatus ? '' : r.status || '', detail: r.tracking_id || '#' + r.id, link: `/admin/inbox/${m.key}/${r.id}` });
  }
  const add = async (sql, base, map) => {
    try { (await db.many(sql, base)).forEach(r => out.push(map(r))); } catch (e) { if (e.code !== '42P01' && e.code !== '42703') throw e; }
  };
  let p = [member.id];
  await add(`SELECT * FROM member_program_attendance WHERE member_id = $1${range('attended_at', p)} ORDER BY attended_at DESC LIMIT 100`, p,
    r => ({ date: r.attended_at, type: ['कार्यक्रम उपस्थिति', 'Programme attendance'], status: r.attendance_status || '', detail: r.program_title || '' }));
  p = [member.id];
  await add(`SELECT * FROM member_program_preregistrations WHERE member_id = $1${range('created_at', p)} ORDER BY created_at DESC LIMIT 100`, p,
    r => ({ date: r.created_at, type: ['कार्यक्रम पूर्व दर्ता', 'Programme pre-registration'], status: r.source || '', detail: r.program_title || '' }));
  p = [member.id];
  await add(`SELECT * FROM member_password_reset_requests WHERE member_id = $1${range('requested_at', p)} ORDER BY requested_at DESC LIMIT 100`, p,
    r => ({ date: r.requested_at, type: ['पासवर्ड रिसेट अनुरोध', 'Password reset request'], status: r.status || '', detail: '#' + r.id + (r.admin_note ? ' — ' + r.admin_note : '') }));
  p = [member.id];
  await add(`SELECT * FROM member_profile_change_requests WHERE member_id = $1${range('created_at', p)} ORDER BY created_at DESC LIMIT 100`, p,
    r => ({ date: r.created_at, type: ['प्रोफाइल परिवर्तन अनुरोध', 'Profile change request'], status: r.status, detail: `${r.field}: ${r.old_value || '—'} → ${r.new_value}` }));
  p = [member.id];
  await add(`SELECT * FROM member_notifications WHERE member_id = $1${range('created_at', p)} ORDER BY created_at DESC LIMIT 100`, p,
    r => ({ date: r.created_at, type: ['पोर्टल सूचना', 'Portal notice'], status: r.is_read ? 'read' : 'unread', detail: r.title }));
  p = [String(member.id)];
  await add(`SELECT * FROM audit_log WHERE entity_type = 'members' AND entity_id::text = $1${range('created_at', p)} ORDER BY created_at DESC LIMIT 100`, p,
    r => ({ date: r.created_at, type: ['अडिट', 'Audit'], status: r.action, detail: `${r.summary || ''}${r.actor_name ? ' (' + r.actor_name + ')' : ''}` }));
  return out.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

module.exports = {
  normalizeId, idVariants, normalizeMobile, phonesMatch, phoneDigitsSql, findBySadasyata, findKycByMemberId, linkedKyc, phoneOwnedByOther,
  passwordPolicyError, register, eligibilityError, approve, reject, alertOffice,
  createOtp, verifyOtp, dispatchOtp, otpChannels, findForReset, maskPhone, maskEmail,
  cardPrefix, issueCard, CARD_LOCK_AFTER, signCardLink, checkCardLink,
  parseMonthlySaving, msFromDb, msLabel, monthlySavingFieldUpdate,
  duplicateReport, uniqueGuardExists, tryUniqueGuard, sadasyataTaken, activities,
};
