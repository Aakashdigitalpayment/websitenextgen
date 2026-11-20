'use strict';
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const modules = require('../modules/applications');
const { flash } = require('../lib/security');
const push = require('../lib/push');
const att = require('../lib/attendance');
const google = require('../lib/google-oauth');
const QRCode = require('qrcode');
const portal = require('../lib/member-portal');

const router = express.Router();
const PENDING = ['pending', 'under_review', 'processing', 'in_progress', 'reviewed', 'shortlisted', 'interviewed'];
const DONE = ['approved', 'completed', 'resolved', 'accepted', 'selected', 'confirmed', 'disbursed', 'paid', 'closed'];
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(require('../lib/legacy-urls').memberRedirects); // old member/*.php links and QR codes
router.use(ah(async (req, res, next) => {
  res.locals.googleEnabled = !!(await google.config());
  res.locals.facebookEnabled = !!(await require('../lib/facebook-oauth').config());
  next();
}));

// ---------------------------------------------------------------- auth
router.get('/login', (req, res) => {
  if (req.member) return res.redirect('/member');
  res.render('member/login', { layout: 'auth', title: res.locals.t('सदस्य लगइन', 'Member login'), error: null, identifier: '' });
});

router.post('/login', ah(async (req, res) => {
  const identifier = nd.toLatinDigits(String(req.body.identifier || '').trim());
  const { error, needs2fa } = await auth.memberLogin(req, identifier, String(req.body.password || ''), res.locals.t);
  if (error) return res.status(401).render('member/login', { layout: 'auth', title: res.locals.t('सदस्य लगइन', 'Member login'), error, identifier });
  if (needs2fa) return res.redirect('/member/login/2fa' + (req.query.next ? '?next=' + encodeURIComponent(auth.safeNext(req.query.next, '/member')) : ''));
  res.redirect(auth.safeNext(req.query.next, '/member'));
}));

router.post('/logout', ah(async (req, res) => {
  await auth.logout(req);
  res.redirect('/');
}));

// registration, availability check, OTP password reset, 2FA step, Facebook sign-in
router.use(require('./member-account'));

// ---------------------------------------------------------------- Google sign-in (members)
router.get('/oauth/google', ah(async (req, res) => {
  const url = await google.start(req, 'login');
  if (!url) return res.redirect('/member/login');
  res.redirect(url);
}));

router.get('/oauth/google/callback', ah(async (req, res) => {
  const fail = msg => { flash(req, 'error', msg); return res.redirect(req.member ? '/member/profile' : '/member/login'); };
  let info;
  try { info = await google.finish(req); } catch (e) {
    return fail(e.message === 'unverified' ? res.locals.t('Google इमेल प्रमाणित छैन।', 'Your Google email is not verified.') : res.locals.t('Google बाट लगइन हुन सकेन। फेरि प्रयास गर्नुहोस्।', 'Google sign-in failed. Please try again.'));
  }
  if (info.intent === 'link') {
    if (!req.member) return fail(res.locals.t('पहिले लगइन गर्नुहोस्।', 'Please sign in first.'));
    const taken = await db.value('SELECT 1 FROM members WHERE google_id = $1 AND id <> $2', [info.sub, req.member.id]);
    if (taken) return fail(res.locals.t('यो Google खाता अर्को सदस्यसँग जोडिएको छ।', 'This Google account is linked to another member.'));
    await db.query('UPDATE members SET google_id = $1 WHERE id = $2', [info.sub, req.member.id]);
    if (/^https:\/\/[^\s"<>]{8,500}$/.test(info.picture || '')) await db.query("UPDATE members SET avatar_url = $1 WHERE id = $2 AND COALESCE(avatar_url, '') = ''", [info.picture, req.member.id]); // OAuth picture when there is no avatar yet
    await auth.audit(req, 'google_link', 'members', req.member.id, 'Google account linked');
    flash(req, 'success', res.locals.t('Google खाता जोडियो।', 'Google account linked.'));
    return res.redirect('/member/profile');
  }
  // login: by linked Google id, else by verified email of exactly one member without a Google link
  let m = await db.one('SELECT * FROM members WHERE google_id = $1 AND deleted_at IS NULL', [info.sub]);
  let linkNow = false;
  if (!m && info.email) {
    // an email on the member record is not proof of ownership (it can come from forms): auto-link only accounts with 2FA,
    // which still asks for the authenticator below; everyone else links from the profile after a normal sign-in
    const byEmail = await db.many("SELECT * FROM members WHERE lower(email) = $1 AND deleted_at IS NULL AND (google_id IS NULL OR google_id = '') LIMIT 2", [info.email]);
    if (byEmail.length === 1 && Number(byEmail[0].twofa_enabled)) { m = byEmail[0]; linkNow = true; }
  }
  if (!m) return fail(res.locals.t('यो Google खातासँग कुनै सदस्य जोडिएको छैन। मोबाइल/पासवर्डले लगइन गरेर प्रोफाइलबाट जोड्नुहोस्।', 'No member is linked to this Google account. Sign in with your mobile and password, then link it from your profile.'));
  await require('../lib/member-portal').checkCardExpiry(m);
  const gate = require('../lib/member-portal').eligibilityError(m, res.locals.t);
  if (gate) return fail(gate);
  if (linkNow) await db.query('UPDATE members SET google_id = $1 WHERE id = $2', [info.sub, m.id]);
  const started = await auth.startMemberSession(req, m); // never skips the member's authenticator (2FA)
  await auth.audit(req, 'login_google', 'members', m.id, 'Member login (Google)', { actorId: m.id, actorName: m.name });
  res.redirect(started.needs2fa ? '/member/login/2fa' : '/member');
}));

router.use(auth.requireMember);

router.use(ah(async (req, res, next) => {
  res.locals.unread = await db.value('SELECT count(*) FROM member_notifications WHERE member_id = $1 AND is_read = 0', [req.member.id]);
  res.locals.applyModules = Object.values(modules).filter(m => !m.hidden && m.key !== 'vendor');
  next();
}));
// temporary password from the office → must set a new one first
router.use((req, res, next) => {
  if (!Number(req.member.must_change_password) || req.path === '/profile' || req.path === '/logout') return next();
  if (req.method === 'GET') { flash(req, 'info', res.locals.t('सुरक्षाका लागि नयाँ पासवर्ड राख्नुहोस्।', 'Please choose a new password.')); return res.redirect('/member/profile'); }
  return res.status(403).render('public/error', { title: 'Change password', code: 403, message: res.locals.t('पहिले पासवर्ड परिवर्तन गर्नुहोस्।', 'Change your password first.') });
});
router.use('/marketplace', require('./marketplace').member);
router.use(require('./member-self')); // profile details / KYC documents / 2FA / Facebook link / QR scanner / card unlock

/** All submissions that belong to this member (matched by member number or phone). */
async function myRequests(member) {
  const keys = [member.sadasyata_number, member.member_card_no].filter(Boolean).flatMap(portal.idVariants);
  const out = [];
  for (const m of Object.values(modules)) {
    if (m.key === 'contact') continue;
    const cols = await db.columns(m.table);
    const conds = [], params = [];
    const phone = portal.normalizeMobile(member.phone);
    const phoneOk = phone.length >= 10 && cols.has(m.phoneCol);
    if (phoneOk) { params.push(phone.slice(-10)); conds.push(`${portal.phoneDigitsSql(m.phoneCol)} = $${params.length}`); }
    // member numbers typed into public forms are not verified — only match them together with the member's phone
    if (m.memberCol && cols.has(m.memberCol) && keys.length && phoneOk) {
      params.push(keys); params.push(phone.slice(-10));
      conds.push(`(upper(trim(${m.memberCol})) = ANY($${params.length - 1}) AND ${portal.phoneDigitsSql(m.phoneCol)} = $${params.length})`);
    }
    // filed while signed in: stays linked when the phone changes later
    if (cols.has('member_portal_id')) { params.push(member.id); conds.push(`member_portal_id = $${params.length}`); }
    if (!conds.length) continue;
    const rows = await db.many(`SELECT * FROM ${m.table} WHERE (${conds.join(' OR ')}) ${cols.has('deleted_at') ? 'AND deleted_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 20`, params);
    rows.forEach(row => out.push({ mod: m, row }));
  }
  return out.sort((a, b) => new Date(b.row.created_at) - new Date(a.row.created_at));
}

// ---------------------------------------------------------------- web push
router.get('/push/key', ah(async (req, res) => res.json({ key: (await push.keys()).publicKey })));
router.post('/push/subscribe', ah(async (req, res) => {
  try { await push.subscribe(req.member.id, req.body, req.get('user-agent')); res.json({ ok: true }); }
  catch { res.status(400).json({ ok: false }); }
}));
router.post('/push/unsubscribe', ah(async (req, res) => { await push.unsubscribe(req.member.id, req.body && req.body.endpoint); res.json({ ok: true }); }));

// ---------------------------------------------------------------- dashboard
router.get('/', ah(async (req, res) => {
  const electionsLib = require('../lib/elections');
  const [requests, notes, card, cycles, partnerHistory] = await Promise.all([
    myRequests(req.member),
    db.many('SELECT * FROM member_notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT 5', [req.member.id]),
    db.one("SELECT * FROM member_id_cards WHERE member_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1", [String(req.member.id)]),
    db.many(`SELECT c.*, EXISTS (SELECT 1 FROM election_vote_submissions s WHERE s.cycle_id = c.id AND s.member_id = $1 AND s.is_ballot = 1) AS voted
             FROM election_cycles c WHERE c.is_published = 1 AND c.voting_enabled = 1 ORDER BY c.sort_order, c.id DESC LIMIT 30`, [req.member.id]),
    // partner visits / services logged at partner desks (legacy member/index.php)
    db.many(`SELECT s.*, p.facility_type, p.partner_name_en FROM member_partner_services s LEFT JOIN partner_facilities p ON p.id = s.partner_id
             WHERE s.member_id = $1 ORDER BY s.created_at DESC LIMIT 80`, [req.member.id]),
  ]);
  const elections = cycles.filter(c => electionsLib.windowState(c) === 'open');
  const summary = new Map();
  for (const h of partnerHistory) {
    const key = h.partner_id ? 'p' + h.partner_id : 'n:' + h.partner_name;
    const s = summary.get(key) || { name: req.lang === 'en' && h.partner_name_en ? h.partner_name_en : h.partner_name, total: 0, taken: 0 };
    s.total++; if (Number(h.service_taken)) s.taken++;
    summary.set(key, s);
  }
  const partnerSummary = [...summary.values()].sort((a, b) => b.total - a.total);
  // member/index.php: counters, quick-apply grid (honour only while open), digital services strip
  const counts = { pending: requests.filter(r => PENDING.includes(String(r.row.status || 'pending'))).length, approved: requests.filter(r => DONE.includes(String(r.row.status))).length };
  const honorOpen = (await require('../lib/forms').optionSources.honorPrograms()).length > 0;
  const quick = [...['appointment', 'kyc', 'loan', 'account', 'digital', 'grievance', 'welfare'].map(k => modules[k]).filter(Boolean), ...(honorOpen ? [modules.honor] : [])]
    .map(m => ({ href: '/apply/' + m.key, icon: m.icon, label: m.title }));
  quick.push({ href: '/member/service-request', icon: 'message', label: ['सेवा अनुरोध', 'Service request'] }, { href: '/member/marketplace', icon: 'store', label: ['सदस्य बजार', 'Marketplace'] },
    { href: '/careers', icon: 'briefcase', label: ['रोजगारी', 'Careers'] }, { href: '/emi-calculator', icon: 'calculator', label: ['EMI क्याल्कुलेटर', 'EMI calculator'] });
  const s = res.locals.settings || {};
  const okUrl = u => /^https:\/\/[^\s<>"]+$/i.test(String(u || '').trim());
  const digital = [['internet_banking_url', ['इन्टरनेट बैंकिङ', 'Internet banking'], 'globe'], ['web_login_url', ['वेब लगइन', 'Web login'], 'link'], ['app_store_url', ['iOS एप', 'iOS app'], 'phone'], ['play_store_url', ['एन्ड्रोइड एप', 'Android app'], 'phone']]
    .filter(([k]) => okUrl(s[k])).map(([k, label, icon]) => ({ href: String(s[k]).trim(), label, icon }));
  res.render('member/dashboard', { title: res.locals.t('मेरो खाता', 'My account'), requests: requests.slice(0, 10), notes, card, elections, partnerHistory, partnerSummary, counts, quick, digital });
}));

/** member/tracker.php filters: type, status group, free text over service / tracking number / status. */
function filterRequests(list, q, lang) {
  const type = Object.hasOwn(modules, String(q.type || '')) ? String(q.type) : '';
  const status = ['pending', 'approved', 'rejected'].includes(q.status) ? q.status : '';
  const text = String(q.q || '').trim().toLowerCase().slice(0, 80);
  return list.filter(({ mod, row }) => {
    if (type && mod.key !== type) return false;
    const s = String(row.status || 'pending');
    if (status === 'pending' && !PENDING.includes(s)) return false;
    if (status === 'approved' && !DONE.includes(s)) return false;
    if (status === 'rejected' && !['rejected', 'cancelled'].includes(s)) return false;
    if (text) {
      const hay = [mod.title[0], mod.title[1], row.tracking_id, s, require('../lib/forms').statusLabel(s, lang), row[mod.nameCol]].join(' ').toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

router.get('/requests', ah(async (req, res) => {
  const all = await myRequests(req.member);
  const types = [...new Map(all.map(r => [r.mod.key, r.mod])).values()];
  res.render('member/requests', { title: res.locals.t('मेरा आवेदन', 'My applications'), requests: filterRequests(all, req.query, req.lang), total: all.length, types, filter: { type: String(req.query.type || ''), status: String(req.query.status || ''), q: String(req.query.q || '').slice(0, 80) } });
}));

/** One application in full (member/tracker.php detail): every non-internal field, stages, status history, office reply. */
router.get('/requests/:module/:id', ah(async (req, res, next) => {
  const m = Object.hasOwn(modules, req.params.module) ? modules[req.params.module] : null;
  if (!m) return next();
  const mine = (await myRequests(req.member)).find(r => r.mod.key === m.key && String(r.row.id) === String(req.params.id));
  if (!mine) return next();
  const forms = require('../lib/forms'), submissions = require('../lib/submissions');
  const options = await forms.resolveOptions(m);
  const history = await db.many('SELECT * FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at', [m.key, mine.row.id]);
  res.render('member/request-detail', {
    title: res.locals.t(...m.title), mod: m, row: mine.row, options, history, display: forms.displayData(m, mine.row),
    steps: m.noStatus ? [] : submissions.stages(m, mine.row.status), details: await submissions.publicDetails(m, mine.row, options, req.lang),
    label: (f, v) => submissions.optionLabel(f, options, v, req.lang),
  });
}));

/** Office reply attachment on one of the member's own applications. */
router.get('/requests/:module/:id/attachment', ah(async (req, res, next) => {
  const m = Object.hasOwn(modules, req.params.module) ? modules[req.params.module] : null;
  if (!m || !m.attachCol) return next();
  const mine = (await myRequests(req.member)).find(r => r.mod.key === m.key && String(r.row.id) === String(req.params.id));
  if (!mine || !mine.row[m.attachCol]) return next();
  require('../lib/uploads').sendStored(req, res, next, mine.row[m.attachCol]);
}));

// ---------------------------------------------------------------- service request (member/service-request.php): one form → appointment or grievance
const SERVICE_TYPES = {
  appointment: { label: ['भेटघाट — सेवा कार्यालय भ्रमण / भेट माग्ने', 'Appointment — visit the service office'], purpose: 'other' },
  loan_inquiry: { label: ['ऋण जानकारी — कर्जा सम्बन्धी सोधपुछ', 'Loan inquiry — ask about loans'], purpose: 'loan_inquiry' },
  account_info: { label: ['खाता जानकारी — बचत खाता सम्बन्धी', 'Account info — savings account'], purpose: 'account_inquiry' },
  welfare_inquiry: { label: ['कल्याण सोधपुछ — सुविधा जानकारी', 'Welfare inquiry — benefit information'], purpose: 'other' },
  document_request: { label: ['कागजात माग — NOC, Statement आदि', 'Document request — NOC, statement etc.'], purpose: 'other' },
  grievance: { label: ['गुनासो — समस्या दर्ता गर्ने', 'Grievance — register a problem'], grievance: true },
  general: { label: ['सामान्य सोधपुछ', 'General inquiry'], purpose: 'other' },
};
async function renderServiceRequest(req, res, values = {}, error = null, status = 200) {
  const forms = require('../lib/forms');
  const [times, branches] = await Promise.all([forms.optionSources.officeTimes(), forms.optionSources.branches()]);
  res.status(status).render('member/service-request', { title: res.locals.t('सेवा अनुरोध', 'Service request'), types: SERVICE_TYPES, times, branches, values, error });
}
router.get('/service-request', ah((req, res) => renderServiceRequest(req, res, { service_type: String(req.query.type || '') })));
router.post('/service-request', ah(async (req, res) => {
  const t = res.locals.t, b = req.body, forms = require('../lib/forms'), kym = require('../lib/kym');
  const values = { service_type: String(b.service_type || ''), message: String(b.message || '').slice(0, 2000), preferred_date: String(b.preferred_date || ''), preferred_time: String(b.preferred_time || ''), branch: String(b.branch || '') };
  const svc = Object.hasOwn(SERVICE_TYPES, values.service_type) ? SERVICE_TYPES[values.service_type] : null;
  if (!svc) return renderServiceRequest(req, res, values, t('सेवा प्रकार छान्नुहोस्।', 'Please select the service type.'), 422);
  if (!values.message.trim()) return renderServiceRequest(req, res, values, t('सन्देश / विवरण अनिवार्य छ।', 'The message is required.'), 422);
  const recent = await db.value(`SELECT (SELECT count(*) FROM appointments WHERE member_portal_id = $1 AND created_at > now() - interval '1 hour')
                                      + (SELECT count(*) FROM grievances WHERE member_portal_id = $1 AND created_at > now() - interval '1 hour')`, [req.member.id]);
  if (Number(recent) >= 10) return renderServiceRequest(req, res, values, t('धेरै अनुरोध भए। १ घण्टापछि पुनः प्रयास गर्नुहोस्।', 'Too many requests. Please try again after 1 hour.'), 429);
  const idn = kym.identityFrom(await kym.loadLinkedKyc(req.member), req.member);
  const label = svc.label[0];
  const detail = label + '\n\n' + values.message.trim();
  let mod, data;
  if (svc.grievance) {
    mod = modules.grievance;
    data = { name: idn.name, member_id: idn.member_id || null, phone: idn.phone, email: idn.email || null, category: 'service', subject: label.slice(0, 200), description: detail };
  } else {
    const date = forms.normalizeAdDate(values.preferred_date);
    const times = (await forms.optionSources.officeTimes()).map(o => o[0]);
    if (!date || date < new Date().toISOString().slice(0, 10) || !times.includes(values.preferred_time)) {
      return renderServiceRequest(req, res, values, t('भेट/सेवाको लागि मनपर्ने मिति र समय दुवै छान्नुहोस्।', 'Please choose both the preferred date and time.'), 422);
    }
    const branches = (await forms.optionSources.branches()).map(o => o[0]);
    mod = modules.appointment;
    data = { visit_kind: 'member', name: idn.name, member_id: idn.member_id || null, phone: idn.phone, email: idn.email || null, purpose: svc.purpose, purpose_detail: detail,
      preferred_date: date, preferred_time: values.preferred_time, branch: branches.includes(values.branch) ? values.branch : null };
  }
  if (!data.phone) return renderServiceRequest(req, res, values, t('तपाईंको सदस्य विवरणमा मोबाइल नम्बर छैन। कार्यालयमा सम्पर्क गर्नुहोस्।', 'Your member record has no mobile number. Please contact the office.'), 422);
  const row = await forms.insertSubmission(mod, data, { member_portal_id: req.member.id });
  const notify = require('../lib/notify');
  await notify.notifyMember(req.member.id, t('सेवा अनुरोध', 'Service request'), t('तपाईंको अनुरोध प्राप्त भयो। ट्र्याकिङ नं: ', 'Request received. Tracking no: ') + row.tracking_id, `/member/requests/${mod.key}/${row.id}`);
  notify.later(() => notify.applicationEvent('submitted', { name: row[mod.nameCol], tracking_id: row.tracking_id, module: mod.title[0], amount: '', date: row.preferred_date || '',
    details: require('../lib/submissions').details(mod, row) }, { phone: row[mod.phoneCol], email: row.email }, mod));
  flash(req, 'success', t('अनुरोध दर्ता भयो! Tracking ID: ', 'Request submitted! Tracking ID: ') + row.tracking_id);
  res.redirect(`/member/requests/${mod.key}/${row.id}`);
}));

router.get('/notifications', ah(async (req, res) => {
  const rows = await db.many('SELECT * FROM member_notifications WHERE member_id = $1 ORDER BY created_at DESC LIMIT 100', [req.member.id]);
  res.render('member/notifications', { title: res.locals.t('सूचनाहरू', 'Notifications'), rows });
}));
// one notification read (opening its link marks it), or all with the button
router.post('/notifications/read-all', ah(async (req, res) => {
  await db.query('UPDATE member_notifications SET is_read = 1 WHERE member_id = $1 AND is_read = 0', [req.member.id]);
  res.redirect('/member/notifications');
}));
router.post('/notifications/:id/read', ah(async (req, res) => {
  const n = await db.one('UPDATE member_notifications SET is_read = 1 WHERE id = $1 AND member_id = $2 RETURNING link', [util.int(req.params.id), req.member.id]);
  const link = n ? auth.safeNext(n.link, '/member/notifications') : '/member/notifications'; // same-site paths only (never //host or /\\host)
  res.redirect(req.body.go === '1' ? link : '/member/notifications');
}));

// profile: see ./member-self.js

// ---------------------------------------------------------------- Google link
router.get('/oauth/google/link', ah(async (req, res) => {
  const url = await google.start(req, 'link');
  res.redirect(url || '/member/profile');
}));
router.post('/oauth/google/unlink', ah(async (req, res) => {
  if (!req.member.password_hash) { flash(req, 'error', res.locals.t('पहिले पासवर्ड सेट गर्नुहोस्।', 'Set a password first.')); return res.redirect('/member/profile'); }
  await db.query('UPDATE members SET google_id = NULL WHERE id = $1', [req.member.id]);
  await auth.audit(req, 'google_unlink', 'members', req.member.id, 'Google account unlinked');
  res.redirect('/member/profile');
}));

// ---------------------------------------------------------------- membership certificate + KYC print
router.get('/certificate', ah(async (req, res) => {
  const m = req.member;
  if (m.approval_status !== 'approved') { flash(req, 'error', res.locals.t('खाता स्वीकृत भएपछि मात्र प्रमाणपत्र उपलब्ध हुन्छ।', 'The certificate is available once your membership is approved.')); return res.redirect('/member'); }
  const card = await db.one("SELECT verification_code FROM member_id_cards WHERE member_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1", [String(m.id)]);
  const verifyCode = card?.verification_code || '';
  const target = `${req.protocol}://${req.get('host')}/verify${verifyCode ? '?code=' + encodeURIComponent(verifyCode) : ''}`;
  const sinceAd = (m.approved_at || m.created_at) ? new Date(m.approved_at || m.created_at).toISOString().slice(0, 10) : null;
  // member/certificate.php: identity from the linked KYM (SSOT) — photo, father's name, DOB, address, citizenship, account type
  const kyc = await ownKyc(m);
  const cit = String(kyc?.citizenship_no || '').trim();
  const dobBs = kyc?.dob_bs || (kyc?.dob_ad ? nd.adToBs(new Date(kyc.dob_ad).toISOString().slice(0, 10)) : '');
  const details = kyc ? {
    fatherName: kyc.father_name || '', dobBs: dobBs || '', address: kyc.permanent_address || '', accountType: kyc.account_type || '',
    citizenship: cit ? '•'.repeat(Math.max(0, Math.min(cit.length - 4, 8))) + cit.slice(-4) : '', // PII: masked except the last 4
    phone: kyc.mobile || m.phone || '', email: kyc.email || m.email || '', hasPhoto: !!kyc.photo,
  } : { phone: m.phone || '', email: m.email || '', hasPhoto: false };
  res.render('member/certificate', { layout: false, qr: await QRCode.toDataURL(target, { margin: 1, width: 200 }), verifyCode: verifyCode || '—', since: sinceAd ? nd.adToBs(sinceAd) : null, details });
}));

/** The member's own KYM (SSOT: kym.loadLinkedKyc — kyc_application_id, else the KYM with this Member ID). */
const ownKyc = m => require('../lib/kym').loadLinkedKyc(m);
router.get('/kyc-print/file/:field', ah(async (req, res, next) => {
  const field = modules.kyc.fileFields.find(f => f.name === req.params.field);
  const k = field ? await ownKyc(req.member) : null;
  if (!k || !k[field.name]) return next();
  require('../lib/uploads').sendStored(req, res, next, k[field.name]);
}));

router.get('/kyc-print', ah(async (req, res) => {
  const k = await ownKyc(req.member);
  if (!k) { flash(req, 'info', res.locals.t('तपाईंको KYC फारम भेटिएन। पहिले KYC भर्नुहोस्।', 'No KYC form found. Please fill in the KYC form first.')); return res.redirect('/apply/kyc'); }
  const mod = modules.kyc;
  const forms = require('../lib/forms');
  res.render('member/kyc-print', { layout: false, k, mod, options: await forms.resolveOptions(mod), display: forms.displayData(mod, k) });
}));

router.get('/accounts', ah(async (req, res) => {
  const [accounts, txns, docs] = await Promise.all([
    db.many("SELECT * FROM member_accounts WHERE member_id = $1 ORDER BY kind, account_no", [req.member.id]),
    db.many('SELECT * FROM member_transactions WHERE member_id = $1 ORDER BY txn_date DESC, id DESC LIMIT 50', [req.member.id]),
    db.many('SELECT id, title, doc_type, created_at FROM member_documents WHERE member_id = $1 AND visible_to_member = 1 ORDER BY created_at DESC', [req.member.id]),
  ]);
  const asOf = accounts.reduce((a, x) => (!a || x.as_of > a ? x.as_of : a), null);
  res.render('member/accounts', { title: res.locals.t('मेरो खाता', 'My accounts'), accounts, txns, docs, asOf });
}));
router.get('/documents/:id', ah(async (req, res, next) => {
  const d = await db.one('SELECT * FROM member_documents WHERE id = $1 AND member_id = $2 AND visible_to_member = 1', [util.int(req.params.id), req.member.id]);
  if (!d) return next();
  require('../lib/uploads').sendStored(req, res, next, d.file_path);
}));

router.get('/id-card', ah(async (req, res) => {
  const card = await db.one("SELECT * FROM member_id_cards WHERE member_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1", [String(req.member.id)]);
  const kyc = await portal.linkedKyc(req.member, true);
  // member/id-card.php: expired → renewal notice; 60 days or less → warning
  const expiry = card?.expiry_date || req.member.card_expires_at;
  const daysLeft = expiry ? Math.ceil((new Date(String(expiry).slice(0, 10) + 'T23:59:59+05:45') - Date.now()) / 86400_000) : null;
  const stars = await programStars(req.member);
  res.render('member/id-card', { title: res.locals.t('सदस्य परिचयपत्र', 'Member ID card'), card, kycPhoto: !!kyc?.photo, daysLeft, stars,
    verifyUrl: `${req.protocol}://${req.get('host')}/verify` });
}));

/** Programme attendance rating on the card (member/id-card.php): attended / programmes held since joining, as 0-5 stars. */
async function programStars(member) {
  try {
    const since = member.approved_at || member.created_at || '1970-01-01';
    const [held, attended] = await Promise.all([
      db.value("SELECT count(*) FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL AND event_date <= CURRENT_DATE AND event_date >= $1::date", [since]),
      db.value("SELECT count(DISTINCT program_id) FROM member_program_attendance WHERE member_id = $1 AND attendance_status = 'VALID'", [member.id]),
    ]);
    if (!Number(held)) return null;
    return { held: Number(held), attended: Math.min(Number(attended), Number(held)), stars: Math.round((Math.min(Number(attended), Number(held)) / Number(held)) * 5) };
  } catch { return null; }
}

// ---------------------------------------------------------------- information room (members with access)
router.get('/information-room', ah(async (req, res) => {
  if (!req.member.information_room_enabled) return res.status(403).render('public/error', { layout: 'member', title: res.locals.t('सूचना कक्ष', 'Information room'), code: 403, message: res.locals.t('तपाईंलाई सूचना कक्षको पहुँच छैन।', 'You do not have access to the information room.') });
  const items = await db.many('SELECT * FROM information_room_items WHERE is_active = 1 ORDER BY display_order, meeting_date DESC NULLS LAST, id DESC');
  res.render('member/information-room', { title: res.locals.t('सूचना कक्ष', 'Information room'), items, categories: IR_CATEGORIES });
}));

const IR_CATEGORIES = { board_decision: ['बोर्ड निर्णय', 'Board decision'], policy: ['नीति', 'Policy'], karyabidhi: ['कार्यविधि', 'Procedure'], biniyam: ['बिनियम', 'Bylaws'],
  meeting_minutes: ['बैठक माइन्युट', 'Meeting minutes'], circular: ['परिपत्र', 'Circular'], other: ['अन्य', 'Other'] };
/** In-page viewer with a watermark (member name + time) for view-only documents (information-room-view.php). */
router.get('/information-room/:id/view', ah(async (req, res, next) => {
  if (!req.member.information_room_enabled) return res.redirect('/member/information-room');
  const item = await db.one('SELECT * FROM information_room_items WHERE id = $1 AND is_active = 1', [util.int(req.params.id)]);
  if (!item || !item.file_path) return next();
  const ext = String(item.file_path).toLowerCase().split('.').pop();
  res.set('Cache-Control', 'private, no-store');
  res.render('member/information-room-view', { title: res.locals.f(item, 'title'), item, kind: ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? 'image' : ext === 'pdf' ? 'pdf' : 'other',
    category: IR_CATEGORIES[item.category] || null, stamp: `${req.member.name_np || req.member.name} · ${req.member.sadasyata_number || ''} · ${nd.formatBs(nd.todayBs(), req.lang)} ${new Date(Date.now() + 345 * 60_000).toISOString().slice(11, 16)}` });
}));

router.get('/information-room/:id', ah(async (req, res, next) => {
  if (!req.member.information_room_enabled) return res.redirect('/member/information-room');
  const item = await db.one('SELECT * FROM information_room_items WHERE id = $1 AND is_active = 1', [util.int(req.params.id)]);
  if (!item || !item.file_path) return next();
  await db.query(`INSERT INTO information_room_access_log (item_id, viewer_type, viewer_id, viewer_name, action, ip_address, created_at) VALUES ($1, 'member', $2, $3, $4, $5, now())`,
    [item.id, req.member.id, req.member.name, item.allow_download ? 'download' : 'view', req.ip]);
  const path = require('path');
  const base = path.resolve(require('../lib/uploads').tenantDir(req));
  const file = path.resolve(base, String(item.file_path).replace(/^\/+/, '').replace(/^assets\/uploads\//, ''));
  if (!file.startsWith(base + path.sep)) return next(); // never outside this tenant's folder
  res.set('Cache-Control', 'private, no-store');
  if (item.allow_download && !req.query.inline) return res.download(file, path.basename(file), err => err && next());
  res.set('Content-Disposition', 'inline');
  res.sendFile(file, err => err && next());
}));

// ---------------------------------------------------------------- programmes: QR check-in, pre-registration, history
router.get('/attend', ah(async (req, res) => {
  const found = await att.byToken(req.query.t);
  if (!found) return res.status(404).render('member/attend', { title: res.locals.t('उपस्थिति', 'Check-in'), found: null, reason: res.locals.t('QR कोड मिलेन वा पुरानो भयो।', 'This QR code is invalid or expired.'), already: null, token: '' });
  const reason = att.closedReason(found.program, found.qr);
  const already = await att.existing(req.member.id, found.program.id, found.occurrence?.id);
  const pendingReq = await db.value("SELECT 1 FROM member_program_attendance_requests WHERE member_id = $1 AND program_id = $2 AND COALESCE(occurrence_id, 0) = $3 AND status = 'pending'", [req.member.id, found.program.id, found.occurrence?.id || 0]);
  res.render('member/attend', { title: found.program.title, found, reason: reason ? res.locals.t(...reason) : null, already, pendingReq, token: req.query.t });
}));

router.post('/attend', ah(async (req, res) => {
  const found = await att.byToken(req.body.t);
  if (!found) return res.redirect('/member/programs');
  const back = '/member/attend?t=' + encodeURIComponent(req.body.t);
  // multi-location programmes are checked in per location, never on the parent QR as well
  const hasLocations = !found.occurrence && await db.value('SELECT 1 FROM program_occurrences WHERE parent_program_id = $1 AND is_active = 1 LIMIT 1', [found.program.id]);
  const reason = hasLocations ? ['यो कार्यक्रममा स्थान अनुसारको QR प्रयोग गर्नुहोस्।', 'Please use the QR code of your location.'] : att.closedReason(found.program, found.qr);
  if (reason) {
    await att.logAttempt(req.member.id, found.program, found.occurrence, 'QR_SCAN', 'WINDOW_CLOSED', reason[1], null, req.ip, null);
    flash(req, 'error', res.locals.t(...reason)); return res.redirect(back);
  }
  if (Number(found.program.instant_attendance)) {
    const r = await att.record({ member: req.member, program: found.program, occurrence: found.occurrence, method: 'QR_SCAN', source: 'member_qr', ip: req.ip, checkEligible: true });
    if (r.ineligible) flash(req, 'error', res.locals.t(r.ineligible[0], r.ineligible[1]));
    else flash(req, r.duplicate ? 'info' : 'success', r.duplicate ?res.locals.t('तपाईं पहिले नै उपस्थित हुनुहुन्छ।', 'You are already checked in.') : res.locals.t('उपस्थिति दर्ता भयो। धन्यवाद!', 'You are checked in. Thank you!'));
  } else {
    const exists = await db.value("SELECT 1 FROM member_program_attendance_requests WHERE member_id = $1 AND program_id = $2 AND COALESCE(occurrence_id, 0) = $3 AND status = 'pending'", [req.member.id, found.program.id, found.occurrence?.id || 0]);
    if (!exists && !(await att.existing(req.member.id, found.program.id, found.occurrence?.id))) {
      await db.insert('member_program_attendance_requests', {
        member_id: req.member.id, member_card_no: req.member.member_card_no || req.member.sadasyata_number || null, member_name: req.member.name_np || req.member.name,
        member_phone: req.member.phone, member_address: req.member.address, program_id: found.program.id, occurrence_id: found.occurrence?.id || null,
        program_title: found.program.title, status: 'pending', requested_at: new Date(), verified_by_ip: req.ip, user_agent: String(req.get('user-agent') || '').slice(0, 255), source: 'member_qr',
      });
    }
    flash(req, 'success', res.locals.t('उपस्थिति अनुरोध पठाइयो। कार्यालयले स्वीकृत गरेपछि गणना हुन्छ।', 'Check-in request sent. It counts once the office approves it.'));
  }
  res.redirect(back);
}));

router.get('/programs', ah(async (req, res) => {
  const [upcoming, mine, regs] = await Promise.all([
    db.many('SELECT * FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL AND (event_date IS NULL OR event_date >= CURRENT_DATE) ORDER BY event_date NULLS LAST LIMIT 50'),
    db.many("SELECT * FROM member_program_attendance WHERE member_id = $1 AND attendance_status = 'VALID' ORDER BY attended_at DESC LIMIT 100", [req.member.id]),
    db.many('SELECT program_id FROM member_program_preregistrations WHERE member_id = $1', [req.member.id]),
  ]);
  res.render('member/programs', { title: res.locals.t('कार्यक्रम', 'Programmes'), upcoming, mine, registered: new Set(regs.map(r => r.program_id)) });
}));

router.post('/programs/:id/register', ah(async (req, res) => {
  const p = await db.one('SELECT * FROM upcoming_programs WHERE id = $1 AND is_active = 1 AND pre_registration_open = 1', [util.int(req.params.id)]);
  if (p) {
    await db.query(`INSERT INTO member_program_preregistrations (member_id, member_card_no, member_name, phone, email, program_id, program_title, event_date, source, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'member_portal', now()) ON CONFLICT DO NOTHING`,
      [req.member.id, req.member.member_card_no || req.member.sadasyata_number || null, req.member.name_np || req.member.name, req.member.phone, req.member.email, p.id, p.title, p.event_date]);
    flash(req, 'success', res.locals.t('पूर्व दर्ता भयो।', 'You are registered.'));
  }
  res.redirect('/member/programs');
}));

// ---------------------------------------------------------------- elections (online voting)
// open only while voting_enabled and inside the Nepal-time window (legacy member/election-vote.php)
const elections = require('../lib/elections');
const publishedCycle = id => db.one('SELECT * FROM election_cycles WHERE id = $1 AND is_published = 1', [id]);

router.get('/elections/:id', ah(async (req, res, next) => {
  const cycle = await publishedCycle(util.int(req.params.id));
  if (!cycle) return next();
  const sub = await elections.submissionOf(cycle.id, req.member.id);
  const voted = sub && Number(sub.is_ballot) === 1 ? sub : null;
  const state = elections.windowState(cycle);
  const positions = await db.many('SELECT * FROM election_positions WHERE cycle_id = $1 AND is_active = 1 ORDER BY display_order, id', [cycle.id]);
  const candidates = await db.many('SELECT * FROM election_candidates WHERE cycle_id = $1 AND is_active = 1 ORDER BY display_order, id', [cycle.id]);
  res.render('member/vote', { title: res.locals.f(cycle, 'title'), cycle, voted, attendanceOnly: !!(sub && !voted), state, stateLabel: elections.STATE_LABELS[state], votingOpen: state === 'open', positions, candidates, error: null });
}));

router.post('/elections/:id', ah(async (req, res, next) => {
  const cycle = await publishedCycle(util.int(req.params.id));
  if (!cycle) return next();
  const back = `/member/elections/${cycle.id}`;
  const closedMsg = () => res.locals.t('मतदान समय बाहिर छ।', 'Voting is closed for this time window.');
  if (!elections.isOpen(cycle)) { flash(req, 'error', closedMsg()); return res.redirect(back); }
  const raw = {};
  for (const [k, v] of Object.entries(req.body)) if (/^pos_\d+$/.test(k)) raw[k.slice(4)] = v;
  let picks;
  try { picks = await elections.normalisePicks(cycle.id, raw); } catch (e) {
    if (e.code !== 'too_many') return res.status(400).render('public/error', { title: 'Invalid ballot', code: 400, message: 'Invalid ballot.' });
    flash(req, 'error', res.locals.t(`${e.position.title_np} मा बढीमा ${e.max} जना छान्न मिल्छ।`, `You may choose at most ${e.max} for ${e.position.title_en || e.position.title_np}.`));
    return res.redirect(back);
  }
  if (!picks.length) { flash(req, 'error', res.locals.t('कम्तीमा एक उम्मेदवार छान्नुहोस्।', 'Please select at least one candidate.')); return res.redirect(back); }
  const r = await elections.submit({ cycle, memberId: req.member.id, picks, source: 'member_portal', ip: req.ip, userAgent: req.get('user-agent') });
  if (r.ok) flash(req, 'success', res.locals.t('मतदान सफल भयो। धन्यवाद!', 'Your vote has been recorded. Thank you!'));
  else flash(req, 'error', r.code === 'closed' ? closedMsg() : res.locals.t('तपाईंले पहिले नै मतदान गरिसक्नुभएको छ।', 'You have already voted.'));
  res.redirect(back);
}));

module.exports = router;
