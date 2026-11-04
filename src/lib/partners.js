'use strict';
/**
 * Partner facilities: desk PIN, service log at partner desks, vendor → partner promotion
 * (legacy includes/partner-facilities-tables.php, verify.php log_service, admin/vendor-enlistment.php).
 */
const crypto = require('crypto');
const db = require('../db');
const auth = require('./auth');

async function generateCode() {
  for (let i = 0; i < 12; i++) {
    const code = 'PF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    if (!(await db.value('SELECT 1 FROM partner_facilities WHERE partner_code = $1', [code]))) return code;
  }
  return 'PF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/** No PIN set = not required (legacy partnerVerifyPin). */
async function verifyPin(partner, pin) {
  if (!partner.pin_hash) return true;
  const p = String(pin || '').trim();
  return p ? auth.checkPassword(p, partner.pin_hash) : false;
}

/** PIN: 4–12 digits/letters; null clears it. */
async function setPin(partnerId, pin) {
  const hash = pin ? await auth.hashPassword(String(pin).trim()) : null;
  const row = await db.one('SELECT partner_code FROM partner_facilities WHERE id = $1', [partnerId]);
  await db.query('UPDATE partner_facilities SET pin_hash = $1, partner_code = COALESCE(NULLIF(partner_code, \'\'), $2), updated_at = now() WHERE id = $3',
    [hash, row && row.partner_code ? row.partner_code : await generateCode(), partnerId]);
}
const validPin = pin => /^[A-Za-z0-9]{4,12}$/.test(String(pin || '').trim());

/** Returns { ok } or { ok:false, error: 'partner'|'pin'|'duplicate' } (legacy logMemberPartnerService). */
async function logService({ memberId, cardNo = '', partnerId, serviceName = '', taken = true, note = '', pin = '', ip = '' }) {
  if (!(memberId > 0) || !(partnerId > 0)) return { ok: false, error: 'invalid' };
  const partner = await db.one('SELECT * FROM partner_facilities WHERE id = $1', [partnerId]);
  if (!partner || !Number(partner.is_active)) return { ok: false, error: 'partner' };
  if (!(await verifyPin(partner, pin))) return { ok: false, error: 'pin' };
  if (await db.value("SELECT 1 FROM member_partner_services WHERE member_id = $1 AND partner_id = $2 AND created_at >= now() - interval '90 seconds'", [memberId, partnerId])) {
    return { ok: false, error: 'duplicate' };
  }
  await db.insert('member_partner_services', {
    member_id: memberId, member_card_no: String(cardNo || '').slice(0, 50), partner_id: partner.id, partner_name: String(partner.partner_name).slice(0, 255),
    service_name: String(serviceName || '').trim().slice(0, 255), service_taken: taken ? 1 : 0, service_note: String(note || '').trim().slice(0, 500),
    verified_by_ip: String(ip || '').slice(0, 45), created_at: new Date(),
  });
  return { ok: true, partner };
}

const TYPE_MAP = { supplier: 'आपूर्तिकर्ता', contractor: 'ठेकेदार', service_provider: 'सेवा प्रदायक', trader: 'व्यापारी', other: 'अन्य' };

/** Approved vendor → partner facility (idempotent). Returns { ok, partnerId, created } or { ok:false, error }. */
async function promoteVendor(vendorId) {
  return db.transaction(async () => {
    const v = await db.one('SELECT * FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
    if (!v) return { ok: false, error: 'not_found' };
    if (v.status !== 'approved') return { ok: false, error: 'not_approved' };
    const existing = await db.value('SELECT id FROM partner_facilities WHERE vendor_id = $1 LIMIT 1', [vendorId]);
    if (existing) {
      if (!v.linked_partner_id) await db.query('UPDATE vendors SET linked_partner_id = $1 WHERE id = $2', [existing, vendorId]);
      return { ok: true, partnerId: existing, created: false };
    }
    const bt = String(v.business_type || '');
    const p = await db.insert('partner_facilities', {
      partner_name: String(v.company_name).slice(0, 200), location: String(v.address || '').slice(0, 200), facility_type: (TYPE_MAP[bt] || bt || 'अन्य').slice(0, 100),
      description: String(v.description || '').slice(0, 5000), contact_phone: String(v.phone || '').replace(/[^0-9+]/g, '').slice(0, 30),
      contact_email: String(v.email || '').toLowerCase().slice(0, 120), partner_code: await generateCode(), vendor_id: vendorId, is_active: 1, display_order: 0,
    });
    await db.query('UPDATE vendors SET linked_partner_id = $1 WHERE id = $2', [p.id, vendorId]);
    return { ok: true, partnerId: p.id, created: true };
  });
}

module.exports = { generateCode, verifyPin, setPin, validPin, logService, promoteVendor };
