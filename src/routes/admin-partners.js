'use strict';
/**
 * Admin: partner desk PINs + service log, vendor → partner promotion. Mounted at /admin/partners.
 * Legacy: admin/partner-facilities.php (partner_pin / clear_pin), admin/vendor-enlistment.php promote_partner.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const partners = require('../lib/partners');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('staff'));

router.get('/', ah(async (req, res) => {
  const partnerId = util.int(req.query.partner, 0);
  const rows = await db.many(`SELECT p.id, p.partner_name, p.partner_name_en, p.facility_type, p.partner_code, p.is_active, p.vendor_id, (p.pin_hash IS NOT NULL AND p.pin_hash <> '') AS has_pin,
      (SELECT count(*) FROM member_partner_services s WHERE s.partner_id = p.id) AS uses,
      (SELECT count(*) FROM member_partner_services s WHERE s.partner_id = p.id AND s.service_taken = 1) AS taken,
      (SELECT max(created_at) FROM member_partner_services s WHERE s.partner_id = p.id) AS last_used
    FROM partner_facilities p ORDER BY p.is_active DESC, p.display_order, p.id`);
  const logSql = `SELECT s.*, m.name, m.name_np, m.sadasyata_number FROM member_partner_services s LEFT JOIN members m ON m.id = s.member_id
                  ${partnerId ? 'WHERE s.partner_id = $1' : ''} ORDER BY s.created_at DESC`;
  if (req.query.export === 'csv') {
    const all = await db.many(logSql, partnerId ? [partnerId] : []);
    const cols = ['created_at', 'partner_name', 'sadasyata_number', 'member_card_no', 'name', 'service_name', 'service_taken', 'service_note'];
    return res.type('text/csv; charset=utf-8').attachment('partner-services.csv').send(util.toCsv(cols, all));
  }
  const logs = await db.many(logSql + ' LIMIT 200', partnerId ? [partnerId] : []);
  res.render('admin/partners', { title: res.locals.t('साझेदार डेस्क र सेवा लग', 'Partner desks & service log'), rows, logs, partnerId });
}));

router.post('/:id/pin', auth.requireAdmin('admin'), ah(async (req, res) => {
  const p = await db.one('SELECT id, partner_name FROM partner_facilities WHERE id = $1', [util.int(req.params.id)]);
  if (!p) return res.redirect('/admin/partners');
  if (req.body.clear === '1') {
    await partners.setPin(p.id, null);
    flash(req, 'success', res.locals.t('PIN हटाइयो — सेवा लग गर्न PIN चाहिँदैन।', 'PIN cleared — no PIN is needed to log services.'));
  } else if (!partners.validPin(req.body.pin)) {
    flash(req, 'error', res.locals.t('PIN ४–१२ अंक/अक्षरको हुनुपर्छ।', 'The PIN must be 4–12 letters or digits.'));
    return res.redirect('/admin/partners');
  } else {
    await partners.setPin(p.id, req.body.pin);
    flash(req, 'success', res.locals.t('डेस्क PIN सुरक्षित भयो।', 'Desk PIN saved.'));
  }
  await auth.audit(req, 'partner_pin', 'partner_facilities', p.id, `${p.partner_name}: PIN ${req.body.clear === '1' ? 'cleared' : 'set'}`);
  res.redirect('/admin/partners');
}));

router.post('/promote-vendor/:vid', auth.requireAdmin('admin'), ah(async (req, res) => {
  const vid = util.int(req.params.vid);
  // promoting approves the vendor first (legacy promote_partner)
  await db.query("UPDATE vendors SET status = 'approved' WHERE id = $1 AND status <> 'approved'", [vid]);
  const r = await partners.promoteVendor(vid);
  if (r.ok) {
    await auth.audit(req, 'vendor_promote', 'partner_facilities', r.partnerId, `Vendor #${vid} → partner #${r.partnerId}`);
    flash(req, 'success', r.created ? res.locals.t(`साझेदार सुविधामा थपियो (#${r.partnerId}) — छुट/विवरण मिलाउनुहोस्।`, `Added to partner facilities (#${r.partnerId}) — set the discount and details.`) : res.locals.t('पहिले नै साझेदारमा लिङ्क छ।', 'Already linked to a partner facility.'));
    return res.redirect(`/admin/r/partner_facilities/${r.partnerId}/edit`);
  }
  flash(req, 'error', r.error === 'not_found' ? res.locals.t('भेन्डर भेटिएन।', 'Vendor not found.') : res.locals.t('पहिले भेन्डर स्वीकृत गर्नुहोस्।', 'Approve the vendor first.'));
  res.redirect('/admin/inbox/vendor/' + vid);
}));

module.exports = router;
