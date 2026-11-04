'use strict';
/**
 * Admin: institutional welfare — opening balances and per-profile (monthly) aggregated claims. Mounted at /admin/institutional-welfare.
 * Legacy: admin/institutional-welfare-opening.php and the welfare block of admin/institutional-profile.php.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const welfare = require('../lib/welfare');
const { flash } = require('../lib/security');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(auth.requireAdmin('staff'));
const num = v => Number(nd.toLatinDigits(String(v ?? '')).replace(/,/g, '')) || 0;
const arr = v => [].concat(v ?? []);

router.get('/', ah(async (req, res) => {
  const [types, opening, profiles] = await Promise.all([
    welfare.types(), welfare.openingMap(),
    db.many(`SELECT p.id, p.fiscal_year, p.report_month, p.is_active, (SELECT count(*) FROM institutional_profile_welfare w WHERE w.profile_id = p.id) AS saved
             FROM institutional_profile p ORDER BY p.fiscal_year DESC, p.report_month DESC NULLS LAST, p.id DESC LIMIT 60`),
  ]);
  res.render('admin/welfare-opening', { title: res.locals.t('राहत: सुरुआती (Opening) र मासिक', 'Welfare: opening & monthly'), types, opening, profiles });
}));

router.post('/', auth.requireAdmin('admin'), ah(async (req, res) => {
  const slugs = arr(req.body.claim_type), counts = arr(req.body.opening_count), amounts = arr(req.body.opening_amount), notes = arr(req.body.note);
  const rows = {};
  slugs.forEach((s, i) => { const slug = String(s || '').trim(); if (slug) rows[slug] = { count: num(counts[i]), amount: num(amounts[i]), note: notes[i] }; });
  await welfare.saveOpening(rows);
  await auth.audit(req, 'welfare_opening', 'institutional_welfare_opening', null, `${Object.keys(rows).length} types`);
  flash(req, 'success', res.locals.t('राहत Opening सुरक्षित भयो। मासिक प्रोफाइलको cumulative मा जोडिन्छ।', 'Opening values saved. They are added to the monthly cumulative totals.'));
  res.redirect('/admin/institutional-welfare');
}));

async function loadProfile(req, res, next) {
  const p = await db.one('SELECT * FROM institutional_profile WHERE id = $1', [util.int(req.params.id)]);
  if (!p) return next('route');
  req.profile = p;
  next();
}

router.get('/:id', ah(loadProfile), ah(async (req, res) => {
  const p = req.profile;
  const [suggested, saved] = await Promise.all([welfare.prefill(p), welfare.loadProfileRows(p.id)]);
  const bounds = welfare.reportBounds(p);
  res.render('admin/welfare-profile', { title: res.locals.t('राहत विवरण', 'Welfare totals') + ' — ' + p.fiscal_year, p, suggested, saved, hasSaved: Object.keys(saved).length > 0, bounds });
}));

router.post('/:id', auth.requireAdmin('admin'), ah(loadProfile), ah(async (req, res) => {
  const b = req.body;
  const slugs = arr(b.welfare_slug), mc = arr(b.month_count), ma = arr(b.month_amount), cc = arr(b.cum_count), ca = arr(b.cum_amount);
  const rows = {};
  slugs.forEach((s, i) => { const slug = String(s || '').trim(); if (slug) rows[slug] = { month_count: num(mc[i]), month_amount: num(ma[i]), cum_count: num(cc[i]), cum_amount: num(ca[i]) }; });
  if (b.action === 'reset') await welfare.saveProfileRows(req.profile.id, {});
  else await welfare.saveProfileRows(req.profile.id, rows);
  await auth.audit(req, 'welfare_profile', 'institutional_profile', req.profile.id, b.action === 'reset' ? 'Welfare snapshot cleared' : `Welfare snapshot saved (${Object.keys(rows).length} types)`);
  flash(req, 'success', res.locals.t('राहत विवरण सुरक्षित भयो।', 'Welfare totals saved.'));
  res.redirect('/admin/institutional-welfare/' + req.profile.id);
}));

module.exports = router;
