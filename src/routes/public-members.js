'use strict';
/**
 * Public member-facing pages: application tracker (tracking no. + phone, or phone + email listing every request),
 * the signed public ID-card preview it links to (tracker-id-card.php) and ID-card verification with the
 * wrong-CVV lock (card-verify-helpers.php).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const nd = require('../lib/nepali-date');
const modules = require('../modules/applications');
const portal = require('../lib/member-portal');
const { isBot } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const tenantKey = req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip);

// ---------------------------------------------------------------- tracker
const trackLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: tenantKey });
const TRACK_MAX_FAILS = 7, TRACK_BLOCK_MS = 15 * 60_000;
/** Per-session guard on top of the IP limit (application-tracker.php tracker_guard). */
function trackBlocked(req) { const g = req.session.trackGuard; return g && g.until > Date.now() ? Math.ceil((g.until - Date.now()) / 60_000) : 0; }
function trackResult(req, ok) {
  if (ok) { delete req.session.trackGuard; return; }
  const g = req.session.trackGuard || { fails: 0, until: 0 };
  g.fails++;
  if (g.fails >= TRACK_MAX_FAILS) { g.until = Date.now() + TRACK_BLOCK_MS; g.fails = 0; }
  req.session.trackGuard = g;
}
const last8 = v => String(v || '').replace(/\D/g, '').slice(-8);

const renderTrack = (res, extra) => res.render('public/track', {
  title: res.locals.t('आवेदनको स्थिति', 'Track your application'), id: '', phone: '', email: '', proof: '', result: null, history: [], searched: false,
  list: null, listError: null, cardLink: null, cardName: null, mode: 'id', ...extra,
});

router.get('/track', (req, res, next) => (req.query.id ? trackLimiter(req, res, next) : next()), ah(async (req, res) => {
  const id = String(req.query.id || '').trim().toUpperCase().slice(0, 96);
  const phone = nd.toLatinDigits(String(req.query.phone || '').trim()).slice(0, 24);
  let result = null, history = [], searched = false;
  const blocked = id && phone ? trackBlocked(req) : 0;
  if (id && phone && !blocked) {
    searched = true;
    for (const mod of Object.values(modules)) {
      if (mod.noTracking) continue;
      const row = await db.one(`SELECT * FROM ${mod.table} WHERE upper(tracking_id) = $1 LIMIT 1`, [id]);
      if (!row) continue;
      // the phone used on the application is always required; rows without one are never shown
      const rowPhone = last8(row[mod.phoneCol]);
      if (rowPhone.length < 6 || rowPhone !== last8(phone)) break;
      result = { mod, row };
      history = await db.many('SELECT * FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at', [mod.key, row.id]);
      break;
    }
    trackResult(req, !!result);
  } else if (id && phone) searched = true;
  renderTrack(res, { id, phone, result, history, searched, blocked });
}));

/**
 * Phone + email: every request of that person. One of their tracking numbers is the second factor
 * (it is not derivable from the phone/email), and that application must carry both contacts.
 */
router.post('/track', trackLimiter, ah(async (req, res) => {
  const t = res.locals.t;
  const phone = portal.normalizeMobile(req.body.phone).slice(-10);
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  const proof = String(req.body.proof || '').trim().toUpperCase().slice(0, 96);
  const view = { mode: 'contact', phone: String(req.body.phone || '').slice(0, 24), email, proof };
  if (isBot(req)) return renderTrack(res, { ...view, list: [] });
  const blocked = trackBlocked(req);
  if (blocked) return renderTrack(res, { ...view, listError: t(`सुरक्षाका लागि यो खोज केही समय रोकिएको छ। ${blocked} मिनेटपछि प्रयास गर्नुहोस्।`, `For your security this search is paused. Try again in ${blocked} minute(s).`) });
  if (phone.length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return renderTrack(res, { ...view, listError: t('कृपया आफ्नो फोन नम्बर र इमेल दुवै प्रविष्ट गर्नुहोस्।', 'Please enter both your phone number and email address.') });
  if (!/^[A-Z]{2,8}-[A-Z0-9][A-Z0-9_.-]{3,90}$/.test(proof)) return renderTrack(res, { ...view, listError: t('आवेदन रसिदको पूरा Tracking ID लेख्नुहोस् (जस्तै LN-830718-7KQ2M)।', 'Enter the full tracking number from one of your receipts (e.g. LN-830718-7KQ2M).') });

  // second factor: the given tracking number must be one of this person's applications (both contacts match)
  let verified = false;
  for (const mod of Object.values(modules)) {
    if (mod.noTracking) continue;
    const cols = await db.columns(mod.table);
    if (!cols.has('tracking_id') || !cols.has('email') || !cols.has(mod.phoneCol)) continue;
    const row = await db.one(`SELECT ${mod.phoneCol} AS phone, email FROM ${mod.table} WHERE upper(tracking_id) = $1 LIMIT 1`, [proof]);
    if (!row) continue;
    verified = portal.normalizeMobile(row.phone).slice(-10) === phone && String(row.email || '').trim().toLowerCase() === email;
    break;
  }
  if (!verified) {
    trackResult(req, false);
    return renderTrack(res, { ...view, listError: t('विवरण मिलेन। आवेदनमा दिएको फोन, इमेल र Tracking ID जाँच गर्नुहोस्।', 'No match. Check the phone, email and tracking number used on the application.') });
  }
  const list = [];
  for (const mod of Object.values(modules)) {
    if (mod.noTracking || mod.key === 'contact') continue;
    const cols = await db.columns(mod.table);
    if (!cols.has('tracking_id') || !cols.has(mod.phoneCol) || !cols.has('email')) continue; // both contacts must be on the row
    const params = [phone, email];
    const where = `${portal.phoneDigitsSql(mod.phoneCol)} = $1 AND lower(trim(COALESCE(email, ''))) = $2`;
    const rows = await db.many(`SELECT * FROM ${mod.table} WHERE ${where} AND tracking_id IS NOT NULL ${cols.has('deleted_at') ? 'AND deleted_at IS NULL' : ''} ORDER BY created_at DESC LIMIT 50`, params);
    rows.forEach(row => list.push({ mod, row }));
  }
  list.sort((a, b) => new Date(b.row.created_at) - new Date(a.row.created_at));
  trackResult(req, true);

  // verified contacts that belong to an approved member with an ID card → short-lived signed preview link
  let cardLink = null, cardName = null;
  const m = await db.one(`SELECT m.id, m.name, m.name_np FROM members m
                          WHERE m.deleted_at IS NULL AND m.is_active = 1 AND m.approval_status = 'approved' AND ${portal.phoneDigitsSql('m.phone')} = $1 AND lower(m.email) = $2
                            AND EXISTS (SELECT 1 FROM member_id_cards c WHERE c.member_id = m.id::text AND c.status = 'active')
                          ORDER BY m.id LIMIT 1`, [phone, email]);
  if (m) { cardLink = portal.signCardLink(m.id); cardName = m.name_np || m.name; }
  renderTrack(res, { ...view, list, cardLink, cardName });
}));

// ---------------------------------------------------------------- signed public ID-card preview (15 minutes)
router.get('/track/id-card', ah(async (req, res) => {
  const t = res.locals.t;
  res.set({ 'Cache-Control': 'no-store, max-age=0', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Referrer-Policy': 'no-referrer' });
  const state = portal.checkCardLink(req.query.mid, req.query.exp, req.query.sig);
  let member = null, card = null, error = null;
  if (state === 'expired') error = t('यो लिङ्कको म्याद सकिएको छ (१५ मिनेट)। कृपया फेरि Tracker बाट प्रमाणित गर्नुहोस्।', 'This link has expired (15 minutes). Please verify again from the tracker.');
  else if (state === 'bad-signature') error = t('सुरक्षा हस्ताक्षर मेल खाएन। यो लिङ्क सम्भवतः छेडछाड भएको छ।', 'Security signature mismatch. This link may have been tampered with.');
  else if (state !== 'ok') error = t('अमान्य लिङ्क — Tracker प्रमाणीकरणबाट मात्र आउनु पर्छ।', 'Invalid link — it must come from tracker verification.');
  else {
    member = await db.one("SELECT * FROM members WHERE id = $1 AND deleted_at IS NULL AND is_active = 1 AND approval_status = 'approved'", [Number(req.query.mid)]);
    card = member && await db.one("SELECT * FROM member_id_cards WHERE member_id = $1 AND status = 'active' ORDER BY id DESC LIMIT 1", [String(member.id)]);
    if (!member || !card) error = t('सदस्य अहिले उपलब्ध छैन वा ID Card अझै जारी भएको छैन।', 'The member is unavailable or no ID card has been issued yet.');
  }
  res.status(error ? (state === 'ok' ? 404 : 403) : 200).render('public/track-id-card', {
    title: t('डिजिटल परिचयपत्र पूर्वावलोकन', 'Digital ID card preview'), error, member, card,
    maskedEmail: member?.email ? portal.maskEmail(member.email) : '—', expiresAt: Number(req.query.exp) * 1000,
  });
}));

// ---------------------------------------------------------------- ID card verification (wrong CVV ×5 locks the card)
const verifyLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 15, keyGenerator: tenantKey, standardHeaders: 'draft-7', legacyHeaders: false });
const verifyView = (res, extra) => res.render('public/verify', { title: res.locals.t('सदस्य परिचयपत्र प्रमाणीकरण', 'Verify member ID card'), result: null, code: '', message: null, partners: [], log: null, ...extra });
const partnersFor = (card, member) => (card && member && card.status === 'active'
  ? db.many("SELECT id, partner_name, partner_name_en, (pin_hash IS NOT NULL AND pin_hash <> '') AS has_pin FROM partner_facilities WHERE is_active = 1 ORDER BY display_order, partner_name") : []);

router.get('/verify', (req, res) => verifyView(res, { code: String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20) }));
router.post('/verify', verifyLimiter, ah(async (req, res) => {
  const t = res.locals.t;
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 20);
  const cvv = nd.toLatinDigits(String(req.body.cvv || '').trim()).slice(0, 4);
  const card = code.length >= 8 ? await db.one(`SELECT *, (expiry_date IS NOT NULL AND expiry_date < CURRENT_DATE) AS is_expired
                                                FROM member_id_cards WHERE upper(verification_code) = $1 ORDER BY (status = 'active') DESC, id DESC LIMIT 1`, [code]) : null;
  const log = ok => db.query('INSERT INTO card_verify_attempts (ip, code_tried, success, created_at) VALUES ($1, $2, $3, now())', [req.ip, code, ok ? 1 : 0]);
  if (!card) { await log(false); return verifyView(res, { result: false, code }); }
  if (card.locked_at) {
    await log(false);
    return verifyView(res, { result: false, code, message: t('यो कार्ड हाल LOCK छ। कृपया कार्यालय/Admin सँग unlock गर्नुहोस्।', 'This card is locked. Please ask the office to unlock it.') });
  }
  if (!card.cvv || card.cvv !== cvv) {
    await log(false);
    const r = await db.one(`UPDATE member_id_cards SET failed_verify_count = COALESCE(failed_verify_count, 0) + 1,
                              locked_at = CASE WHEN COALESCE(failed_verify_count, 0) + 1 >= $2 THEN now() ELSE locked_at END
                            WHERE id = $1 RETURNING failed_verify_count`, [card.id, portal.CARD_LOCK_AFTER]);
    const left = Math.max(0, portal.CARD_LOCK_AFTER - r.failed_verify_count);
    return verifyView(res, {
      result: false, code,
      message: left ? t(`Card Code वा CVV मेल खाएन। बाँकी प्रयास: ${left}`, `Card code or CVV did not match. Tries left: ${left}`)
        : t('यो कार्ड ५ पटक गलत प्रयासका कारण LOCK भएको छ। कृपया कार्यालय/Admin सँग unlock अनुरोध गर्नुहोस्।', 'This card is now locked after 5 wrong tries. Please ask the office to unlock it.'),
    });
  }
  if (card.is_expired && card.status === 'active') card.status = 'expired';
  await log(true);
  await db.query('UPDATE member_id_cards SET verify_count = COALESCE(verify_count, 0) + 1, failed_verify_count = 0, last_verified_at = now() WHERE id = $1', [card.id]);
  // cards store the member's id; legacy cards may store a membership/card number — prefer the id match
  const member = await db.one(`SELECT id, name, name_np, sadasyata_number, member_card_no, avatar_url, approval_status FROM members
                               WHERE (id::text = $1 OR sadasyata_number = $1 OR member_card_no = $1) AND deleted_at IS NULL
                               ORDER BY (id::text = $1) DESC, id LIMIT 1`, [card.member_id]);
  // a valid card opens a 30-minute window in which a partner desk may log a service for this member (POST /verify/service)
  if (member && card.status === 'active') req.session.partnerVerify = { mid: member.id, card: card.card_no || member.sadasyata_number || '', code, at: Date.now() };
  verifyView(res, { result: { card, member }, code, partners: await partnersFor(card, member) });
}));

module.exports = router;
