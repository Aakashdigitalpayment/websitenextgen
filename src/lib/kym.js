'use strict';
/**
 * KYM (KYC) ⇄ members single source of truth — port of includes/member-ssot.php and the
 * online-kyc.php submit flow. A Member ID (members.sadasyata_number) is never invented here:
 * online KYM needs an existing member whose ledger mobile matches.
 */
const crypto = require('crypto');
const db = require('../db');
const nd = require('./nepali-date');
const settings = require('./settings');
const pii = require('./pii-crypto');

const DOC_KEYS = ['photo', 'citizenship_front', 'citizenship_back', 'national_id_card', 'signature', 'left_thumb', 'right_thumb'];
const REVIEW_YEARS = { high: 1, medium: 2, low: 3 };
const err = (np, en) => ({ ok: false, error: [np, en] });

/** Member IDs are Latin alphanumeric, upper case, no spaces (Devanagari digits converted). */
const normalizeId = id => nd.toLatinDigits(String(id ?? '').trim()).replace(/\s+/g, '').toUpperCase().slice(0, 50);
const toDeva = s => String(s).replace(/[0-9]/g, d => '०१२३४५६७८९'[d]);
const idVariants = id => { const n = normalizeId(id); return n ? [...new Set([n, toDeva(n)])] : []; };
function normalizeMobile(p) {
  let d = nd.toLatinDigits(String(p ?? '')).replace(/\D+/g, '');
  if (d.length > 10 && d.startsWith('977')) d = d.slice(-10);
  return d;
}
/** Exact match on the normalised 10-digit mobile (no partial/suffix matches). */
function phonesMatch(a, b) {
  a = normalizeMobile(a); b = normalizeMobile(b);
  return !!a && !!b && a.length >= 10 && a === b;
}

async function findMemberBySadasyata(id) {
  const v = idVariants(id);
  if (!v.length) return null;
  return db.one('SELECT * FROM members WHERE (upper(trim(sadasyata_number)) = ANY($1) OR trim(sadasyata_number) = ANY($1)) AND deleted_at IS NULL ORDER BY id LIMIT 1', [v]);
}

/** Prefer approved, then newest non-rejected; optionally reopen the newest rejected one. */
async function findKycByMemberId(id, includeRejected = false) {
  const v = idVariants(id);
  if (!v.length) return null;
  const row = await db.one(`SELECT * FROM kyc_applications WHERE (upper(trim(member_id)) = ANY($1) OR trim(member_id) = ANY($1))
                              AND deleted_at IS NULL AND status <> 'rejected'
                            ORDER BY array_position(ARRAY['approved','pending','incomplete','partial']::text[], status::text), id DESC LIMIT 1`, [v]);
  if (row || !includeRejected) return row;
  return db.one(`SELECT * FROM kyc_applications WHERE (upper(trim(member_id)) = ANY($1) OR trim(member_id) = ANY($1)) AND deleted_at IS NULL AND status = 'rejected' ORDER BY id DESC LIMIT 1`, [v]);
}

async function loadLinkedKyc(member) {
  if (member.kyc_application_id) {
    const k = await db.one("SELECT * FROM kyc_applications WHERE id = $1 AND deleted_at IS NULL AND status <> 'rejected'", [member.kyc_application_id]);
    if (k) return k;
  }
  return member.sadasyata_number ? findKycByMemberId(member.sadasyata_number) : null;
}

async function requiresExistingMember() {
  const v = String((await settings.all()).member_ssot_kym_require_existing ?? '1').trim().toLowerCase();
  return !['0', 'false', 'no', 'off'].includes(v);
}

/** memberSsotRequireMemberIdAndMobile: Member ID exists AND the mobile matches the ledger (and the linked KYM). */
async function requireMemberIdAndMobile(memberId, mobile) {
  const id = normalizeId(memberId);
  if (!id) return err('सदस्यता नम्बर अनिवार्य छ।', 'Member ID is required.');
  if (!(await requiresExistingMember())) return { ok: true, member: await findMemberBySadasyata(id), kyc: null };
  const m = await findMemberBySadasyata(id);
  if (!m) return err('यो सदस्यता नम्बर सदस्य सूचीमा छैन। पहिले सहकारीले सदस्य दर्ता/import गर्नुपर्छ, अनि मात्र केवाइएम भर्नुहोस्।', 'This Member ID is not in the members list. The cooperative must register/import the member first, then submit KYM.');
  const mob = normalizeMobile(mobile);
  if (!/^\d{10}$/.test(mob)) return err('१० अंकको मोबाइल नम्बर राख्नुहोस् (सदस्य सूचीसँग मिल्नुपर्छ)।', 'Enter a valid 10-digit mobile that matches the members list.');
  if (!normalizeMobile(m.phone)) return err('सदस्य सूचीमा यो Member ID को मोबाइल खाली छ। कार्यालयमा सम्पर्क गरी मोबाइल अपडेट गराउनुहोस्।', 'This Member ID has no mobile on the members list. Please ask the office to update it.');
  if (!phonesMatch(m.phone, mob)) return err('Member ID र मोबाइल मिलेन। सहकारीमा दर्ता भएको मोबाइल नै प्रयोग गर्नुहोस्।', 'Member ID and mobile do not match. Use the mobile registered with the cooperative.');
  const kyc = await loadLinkedKyc(m);
  if (kyc && normalizeMobile(kyc.mobile) && !phonesMatch(kyc.mobile, mob)) {
    return err('यो Member ID को केवाइएममा अर्कै मोबाइल छ। गलत मान्छेको डेटा अपडेट गर्न मिल्दैन।', "Linked KYM has a different mobile. You cannot update another person's record.");
  }
  return { ok: true, member: m, kyc };
}

/** Public path: never overwrite non-empty stored values (memberSsotMergePublicKycFillEmpty). */
function mergeFillEmpty(existing, incoming) {
  const merged = { ...existing };
  let filled = 0, blocked = 0;
  for (const [key, val] of Object.entries(incoming)) {
    if (['id', 'tracking_id', 'member_id', 'status'].includes(key)) continue;
    const cur = existing[key] == null ? '' : String(existing[key]).trim();
    const nv = val == null || typeof val === 'object' ? '' : String(val).trim();
    if (cur !== '') { if (nv !== '' && nv !== cur) blocked++; continue; }
    if (nv !== '') { merged[key] = val; filled++; }
  }
  return { merged, filled, blocked };
}

/** Link members.kyc_application_id. */
const linkMember = (memberPk, kycId) => db.query('UPDATE members SET kyc_application_id = $1 WHERE id = $2', [kycId, memberPk]);

/**
 * memberSsotUpsertMemberFromKyc: ensure a members row exists for kyc.member_id. Existing member →
 * link + sync shared contact (non-empty KYM values win). Missing → stub without password (pending).
 */
/**
 * @param {object} kyc
 * @param {{syncContact?: boolean}} [opts] syncContact=false for untrusted (public) writes: the member is linked and
 *   empty profile fields are filled, but name/email/phone/address already on the member are never changed.
 */
async function upsertMemberFromKyc(kyc, { syncContact = true } = {}) {
  const sid = normalizeId(kyc.member_id);
  if (!sid) return { ok: false, message: ['KYM मा सदस्यता नम्बर छैन — Member ID बिना सदस्य खाता बनाइँदैन।', 'This KYM has no Member ID — a member account is not created without one.'] };
  const nameNp = String(kyc.full_name || '').trim(), nameEn = String(kyc.full_name_en || '').trim();
  const name = nameEn || nameNp;
  const phone = normalizeMobile(kyc.mobile) || null;
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(kyc.email || '').trim()) ? String(kyc.email).trim().toLowerCase() : null;
  const existing = await findMemberBySadasyata(sid);
  if (existing) {
    await linkMember(existing.id, kyc.id);
    const dob = /^\d{4}-\d{2}-\d{2}$/.test(String(kyc.dob_ad || '')) ? kyc.dob_ad : '';
    if (!syncContact) {
      // public form: only fill blanks; email/phone stay as the cooperative has them (they drive OTP reset + OAuth)
      await db.query(`UPDATE members SET
          name_np = CASE WHEN COALESCE(name_np, '') = '' AND $1 <> '' THEN $1 ELSE name_np END,
          gender = CASE WHEN COALESCE(gender, '') = '' AND $2 <> '' THEN $2 ELSE gender END,
          dob = CASE WHEN dob IS NULL AND $3 <> '' THEN $3::date ELSE dob END,
          address = CASE WHEN COALESCE(address, '') = '' AND $4 <> '' THEN $4 ELSE address END,
          updated_at = now()
        WHERE id = $5`, [nameNp, String(kyc.gender || '').trim(), dob, String(kyc.permanent_address || '').trim(), existing.id]);
      return { ok: true, memberId: existing.id, created: false };
    }
    try {
      await db.query(`UPDATE members SET
          name = CASE WHEN $1 <> '' THEN $1 ELSE name END,
          name_np = CASE WHEN $2 <> '' THEN $2 ELSE name_np END,
          phone = COALESCE(NULLIF($3, ''), phone),
          email = COALESCE(NULLIF($4, ''), email),
          address = CASE WHEN $5 <> '' THEN $5 ELSE address END,
          gender = CASE WHEN $6 <> '' THEN $6 ELSE gender END,
          dob = CASE WHEN $7 <> '' THEN $7::date ELSE dob END,
          updated_at = now()
        WHERE id = $8`, [name, nameNp, phone || '', email || '', String(kyc.permanent_address || '').trim(), String(kyc.gender || '').trim(), dob, existing.id]);
    } catch (e) {
      // email is unique on members: keep the old one rather than failing the whole sync
      if (e.code !== '23505') throw e;
      await db.query("UPDATE members SET name = CASE WHEN $1 <> '' THEN $1 ELSE name END, phone = COALESCE(NULLIF($2, ''), phone), updated_at = now() WHERE id = $3", [name, phone || '', existing.id]);
    }
    return { ok: true, memberId: existing.id, created: false };
  }
  const cardNo = `M-${new Date().getFullYear()}-${String(crypto.randomInt(1, 100000)).padStart(5, '0')}`;
  try {
    const row = await db.one(`INSERT INTO members (name, name_np, email, phone, sadasyata_number, password_hash, member_card_no, address, gender, approval_status, is_active, kyc_application_id, created_at, updated_at)
                              VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, $8, 'pending', 1, $9, now(), now()) RETURNING id`,
      [name || 'Member ' + sid, nameNp, email, phone, sid, cardNo, kyc.permanent_address || null, kyc.gender || null, kyc.id]);
    return { ok: true, memberId: row.id, created: true };
  } catch (e) {
    if (e.code !== '23505') throw e;
    const again = await findMemberBySadasyata(sid);
    if (again) { await linkMember(again.id, kyc.id); return { ok: true, memberId: again.id, created: false }; }
    // the email belongs to another member: create the stub without it
    const row = await db.one(`INSERT INTO members (name, name_np, phone, sadasyata_number, member_card_no, address, approval_status, is_active, kyc_application_id, created_at, updated_at)
                              VALUES ($1, $2, $3, $4, $5, $6, 'pending', 1, $7, now(), now()) RETURNING id`, [name || 'Member ' + sid, nameNp, phone, sid, cardNo, kyc.permanent_address || null, kyc.id]);
    return { ok: true, memberId: row.id, created: true };
  }
}

/** memberSsotAfterKycWrite: every KYM write keeps the linked member in sync. */
async function afterKycWrite(kycId, opts = {}) {
  try {
    const row = await db.one('SELECT * FROM kyc_applications WHERE id = $1', [kycId]);
    if (row && normalizeId(row.member_id)) return await upsertMemberFromKyc(row, opts);
  } catch (e) { console.error('kym afterKycWrite:', e.message); }
  return null;
}

/** Issue (or re-issue) a digital ID card for a member — shared by the members page and KYM approval. */
/** One ID-card issuer for the whole app (card_prefix setting, revokes the old card, notifies the member). */
async function issueIdCard(member, adminId, tenantSlug) {
  const r = await require('./member-portal').issueCard(member, adminId, { slug: tenantSlug });
  return { ...r };
}

/** kycAutoGenerateIdCard: on approval, when the applicant asked for a card (want_id_card). */
async function autoIssueIdCard(kycId, adminId, tenantSlug) {
  try {
    const k = await db.one('SELECT id, want_id_card, member_id, email, mobile FROM kyc_applications WHERE id = $1', [kycId]);
    if (!k || !Number(k.want_id_card)) return null;
    let m = k.member_id ? await findMemberBySadasyata(k.member_id) : null;
    if (!m && !normalizeId(k.member_id)) {
      if (k.email) m = await db.one('SELECT * FROM members WHERE lower(email) = lower($1) AND is_active = 1 AND deleted_at IS NULL LIMIT 1', [k.email]);
      if (!m && k.mobile) m = await db.one('SELECT * FROM members WHERE phone = $1 AND is_active = 1 AND deleted_at IS NULL LIMIT 1', [normalizeMobile(k.mobile)]);
    }
    if (!m) return null;
    const active = await db.value("SELECT 1 FROM member_id_cards WHERE member_id = $1 AND status = 'active' AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)", [String(m.id)]);
    if (active) return null; // already holds a valid card
    return { member: m, card: await issueIdCard(m, adminId, tenantSlug) };
  } catch (e) { console.error('kym autoIssueIdCard:', e.message); return null; }
}

/**
 * Status change bookkeeping (admin/kyc-applications.php update_status): verified time and the
 * risk-based review due date (high 1y / medium 2y / low 3y).
 */
async function applyStatus(kycId, status, riskCategory) {
  const risk = REVIEW_YEARS[riskCategory] ? riskCategory : null;
  await db.query(`UPDATE kyc_applications SET
      risk_category = COALESCE($3, risk_category, 'medium'),
      kyc_verified_at = CASE WHEN $2 = 'approved' AND kyc_verified_at IS NULL THEN now() WHEN $2 <> 'approved' THEN NULL ELSE kyc_verified_at END,
      updated_at = now()
    WHERE id = $1`, [kycId, status, risk]);
  await refreshReviewCycle(kycId);
}

/** Recompute due dates / due_review flags (kyc-risk-reviews.php "ensure auto flags are in sync"). */
async function refreshReviewCycle(kycId = null) {
  const where = kycId ? 'AND id = $1' : '';
  const params = kycId ? [kycId] : [];
  await db.query(`UPDATE kyc_applications SET risk_review_due_at = CASE
        WHEN status <> 'approved' OR kyc_verified_at IS NULL THEN NULL
        ELSE (kyc_verified_at::date + make_interval(years => CASE risk_category WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END))::date END
      WHERE deleted_at IS NULL ${where}`, params);
  await db.query(`UPDATE kyc_applications SET risk_review_status = CASE
        WHEN status <> 'approved' OR risk_review_due_at IS NULL THEN 'normal'
        WHEN risk_review_due_at <= CURRENT_DATE THEN 'due_review' ELSE 'normal' END
      WHERE deleted_at IS NULL ${where}`, params);
}

/** "Mark reviewed": restart the cycle today. */
async function markReviewed(kycId) {
  await db.query(`UPDATE kyc_applications SET kyc_verified_at = now(),
      risk_review_due_at = (CURRENT_DATE + make_interval(years => CASE risk_category WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END))::date,
      risk_review_status = 'normal', updated_at = now() WHERE id = $1 AND status = 'approved'`, [kycId]);
}

/**
 * Online KYM submit (online-kyc.php full form). `data` is the validated form data, `member` the
 * signed-in portal member (or null). Returns { row, updated } or { error: [np, en] }.
 */
async function submit(mod, data, { member = null, body = {} } = {}) {
  const schema = db.currentSchema();
  let memberId = normalizeId(data.member_id);
  if (member) {
    const own = normalizeId(member.sadasyata_number);
    if (own) memberId = own; // the session member's own number — never the posted one
    else if (memberId) {
      const other = await findMemberBySadasyata(memberId);
      if (other && other.id !== member.id) return err('यो सदस्यता नम्बर अर्को सदस्य खाताको हो।', 'This Member ID belongs to another member account.');
    }
  }
  if (!memberId) return err('सदस्यता नम्बर (Member ID) अनिवार्य छ।', 'Member ID is required.');
  data.member_id = memberId;
  data.mobile = normalizeMobile(data.mobile);
  if (!member) {
    const gate = await requireMemberIdAndMobile(memberId, data.mobile);
    if (!gate.ok) return gate;
  } else if (await requiresExistingMember() && !(await findMemberBySadasyata(memberId))) {
    return err('सदस्यता नम्बर सदस्य सूचीमा छैन।', 'Member ID not found in the members list.');
  }
  if (!/^\d{10}$/.test(data.mobile)) return err('कृपया १० अंकको मोबाइल नम्बर राख्नुहोस्।', 'Please enter a valid 10-digit mobile number.');
  const nid = String(data.national_id_number || '').replace(/\D/g, ''), cit = String(data.citizenship_no || '').replace(/\D/g, '');
  if (String(data.nationality || '').trim() === 'नेपाली' && data.national_id_number) {
    if (nid.length !== 14) return err('नेपालको लागि National ID नम्बर १४ अङ्कको हुनुपर्छ।', 'For Nepal, the National ID number should be 14 digits.');
    if (cit && nid === cit) return err('नागरिकता नम्बर र National ID नम्बर ठ्याक्कै एउटै हुन मिल्दैन।', 'Citizenship number and National ID number cannot be exactly the same.');
  }
  if (data.photo && !body.passport_face_confirm) return err('पासपोर्ट फोटो guideline पुष्टि गर्नुहोस् (दुवै आँखा र दुवै कान स्पष्ट देखिनुपर्छ)।', 'Please confirm the passport photo guidelines (eyes and both ears visible).');
  data.risk_category = REVIEW_YEARS[data.risk_category] ? data.risk_category : 'medium';
  data.want_id_card = body.want_id_card ? 1 : 0;

  let existing = null;
  if (member && member.kyc_application_id) existing = await db.one('SELECT * FROM kyc_applications WHERE id = $1 AND deleted_at IS NULL', [member.kyc_application_id]);
  if (!existing) existing = await findKycByMemberId(memberId, true);
  if (existing && member) {
    const other = await db.value('SELECT id FROM members WHERE kyc_application_id = $1 AND id <> $2 LIMIT 1', [existing.id, member.id]);
    if (other) return err('यो केवाइएम रेकर्ड अर्को सदस्य खातासँग जोडिएको छ। कार्यालयमा सम्पर्क गर्नुहोस्।', 'This KYC record is linked to another member account. Please contact the office.');
  }
  if (!existing && DOC_KEYS.slice(0, 2).concat(['citizenship_back', 'signature']).some(k => !data[k])) {
    return err('कृपया फोटो, नागरिकता (अगाडि/पछाडि) र हस्ताक्षर अपलोड गर्नुहोस्।', 'Please upload the photo, citizenship (front/back) and signature.');
  }
  const cols = await db.columns('kyc_applications');
  const row = Object.fromEntries(Object.entries(data).filter(([k, v]) => cols.has(k) && v !== undefined && !['id', 'status', 'tracking_id', 'created_at'].includes(k)));

  if (!existing) {
    const ins = await db.pick('kyc_applications', { ...pii.encryptFields('kyc_applications', { ...row }, schema), tracking_id: require('./util').trackingId(mod.prefix), status: 'pending', created_at: new Date() });
    const saved = await db.insert('kyc_applications', ins);
    await afterKycWrite(saved.id, { syncContact: !!member }); // only the signed-in member may change their own contact details
    return { row: saved, updated: false };
  }

  let status = existing.status || 'pending';
  let update;
  if (member) {
    // portal: full update; approved/rejected go back to the office for review; uploads keep old files when blank
    update = { ...row };
    for (const k of DOC_KEYS) if (!update[k]) delete update[k];
    if (status === 'approved' || status === 'rejected') status = 'pending';
  } else {
    const { want_id_card: wantCard, ...mergeable } = row; // the card request is always taken as posted
    const { merged, filled, blocked } = mergeFillEmpty(existing, mergeable);
    if (filled < 1 && blocked > 0) {
      return err('नयाँ खाली field भेटिएन — पहिले भरिएको डेटा public बाट फेर्न मिल्दैन। परिवर्तनका लागि पोर्टल लगइन गर्नुहोस्।', 'Nothing new to add — existing fields stay locked on the public form. Log in to the member portal to request changes.');
    }
    update = Object.fromEntries(Object.keys(mergeable).filter(k => merged[k] !== existing[k]).map(k => [k, merged[k]]));
    update.want_id_card = wantCard;
    if (filled > 0) {
      if (status === 'rejected' || status === 'approved') status = 'pending';
      else if (['incomplete', 'partial', ''].includes(status) || !status) status = 'partial';
    } else if (status === 'rejected') status = 'pending';
  }
  update.status = status;
  update.updated_at = new Date();
  if (!existing.tracking_id) update.tracking_id = require('./util').trackingId(mod.prefix);
  const saved = await db.update('kyc_applications', existing.id, await db.pick('kyc_applications', pii.encryptFields('kyc_applications', update, schema)));
  await afterKycWrite(saved.id, { syncContact: !!member });
  return { row: saved, updated: true };
}

module.exports = {
  normalizeId, normalizeMobile, phonesMatch, findMemberBySadasyata, findKycByMemberId, loadLinkedKyc, requireMemberIdAndMobile,
  mergeFillEmpty, upsertMemberFromKyc, afterKycWrite, issueIdCard, autoIssueIdCard, applyStatus, refreshReviewCycle, markReviewed,
  submit, DOC_KEYS, REVIEW_YEARS,
};
