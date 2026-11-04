'use strict';
/**
 * Member marketplace: members list products or skills; staff approve; public browse + inquire.
 * Exports three routers: member (/member/marketplace), admin (/admin/marketplace), public (/marketplace).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const nd = require('../lib/nepali-date');
const notify = require('../lib/notify');
const { upload, remove } = require('../lib/uploads');
const { flash, isBot } = require('../lib/security');

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const CATEGORIES = [
  ['agriculture', 'कृषि उपज', 'Farm produce'], ['livestock', 'पशुपालन', 'Livestock'], ['food', 'खाद्य/घरेलु', 'Food & home-made'],
  ['handicraft', 'हस्तकला', 'Handicraft'], ['clothing', 'कपडा', 'Clothing'], ['electronics', 'इलेक्ट्रोनिक्स', 'Electronics'],
  ['construction', 'निर्माण', 'Construction'], ['repair', 'मर्मत', 'Repair'], ['tutoring', 'ट्युसन/तालिम', 'Tutoring & training'],
  ['transport', 'ढुवानी', 'Transport'], ['health', 'स्वास्थ्य/सौन्दर्य', 'Health & beauty'], ['other', 'अन्य', 'Other'],
];
const catLabel = (c, lang) => { const x = CATEGORIES.find(o => o[0] === c); return x ? x[lang === 'en' ? 2 : 1] : c || ''; };

function readListing(body) {
  const errors = {};
  const s = (k, n = 255) => String(body[k] || '').trim().slice(0, n);
  const data = {
    listing_type: body.listing_type === 'skill' ? 'skill' : 'product', category: CATEGORIES.some(c => c[0] === body.category) ? body.category : 'other',
    title: s('title', 200), description: s('description', 3000), unit: s('unit', 50) || '', price_note: s('price_note', 120) || '', quantity: s('quantity', 60) || '',
    location: s('location', 150) || '', contact_name: s('contact_name', 120) || '', contact_phone: nd.toLatinDigits(s('contact_phone', 20)),
  };
  const price = nd.toLatinDigits(s('price')).replace(/,/g, '');
  data.price = price ? Number(price) : null;
  if (price && !Number.isFinite(data.price)) errors.price = 'number';
  const exp = nd.toLatinDigits(s('experience_years'));
  data.experience_years = exp ? Math.min(80, Math.max(0, parseInt(exp, 10) || 0)) : null;
  if (!data.title) errors.title = 'required';
  if (!data.description) errors.description = 'required';
  if (data.contact_phone && !util.isPhone(data.contact_phone)) errors.contact_phone = 'phone';
  return { data, errors };
}

// ================================================================ member
const member = express.Router();
member.use(auth.requireMember);

member.get('/', ah(async (req, res) => {
  const [rows, inquiries] = await Promise.all([
    db.many('SELECT * FROM member_marketplace_listings WHERE member_id = $1 ORDER BY id DESC', [req.member.id]),
    db.many(`SELECT i.*, l.title FROM member_marketplace_inquiries i JOIN member_marketplace_listings l ON l.id = i.listing_id
             WHERE l.member_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [req.member.id]),
  ]);
  await db.query('UPDATE member_marketplace_inquiries SET is_read = 1 WHERE listing_id IN (SELECT id FROM member_marketplace_listings WHERE member_id = $1) AND is_read = 0', [req.member.id]);
  res.render('member/marketplace', { title: res.locals.t('मेरो बजार', 'My marketplace'), rows, inquiries, catLabel: c => catLabel(c, req.lang) });
}));

member.get('/new', (req, res) => res.render('member/marketplace-form', { title: res.locals.t('नयाँ सूची', 'New listing'), item: null, values: { listing_type: req.query.type === 'skill' ? 'skill' : 'product', contact_name: req.member.name_np || req.member.name, contact_phone: req.member.phone }, errors: {}, CATEGORIES }));
member.get('/:id/edit', ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM member_marketplace_listings WHERE id = $1 AND member_id = $2', [util.int(req.params.id), req.member.id]);
  if (!item) return next();
  res.render('member/marketplace-form', { title: res.locals.t('सूची सम्पादन', 'Edit listing'), item, values: item, errors: {}, CATEGORIES });
}));

const imageUpload = (req, res, next) => {
  if (!req.is('multipart/form-data')) return next();
  const [mw, csrf] = upload('marketplace', [{ name: 'image', kind: 'image' }], { maxMb: 5 });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
};

async function saveListing(req, res, item) {
  const { data, errors } = readListing(req.body);
  if (req.uploadError) errors.image = req.uploadError;
  if (Object.keys(errors).length) return res.status(422).render('member/marketplace-form', { title: res.locals.t('सूची', 'Listing'), item, values: { ...item, ...req.body }, errors, CATEGORIES });
  if (req.uploaded?.image) data.image = req.uploaded.image;
  // every edit goes back to review
  Object.assign(data, { status: 'pending', approved_at: null, approved_by: null, is_active: 1 });
  if (item) {
    await db.update('member_marketplace_listings', item.id, data);
    if (data.image && item.image) remove(req, item.image);
  } else await db.insert('member_marketplace_listings', { ...data, member_id: req.member.id });
  flash(req, 'success', res.locals.t('सूची पेश भयो। कार्यालयले स्वीकृत गरेपछि सार्वजनिक हुनेछ।', 'Listing submitted. It goes live after the office approves it.'));
  res.redirect('/member/marketplace');
}
member.post('/', imageUpload, ah((req, res) => saveListing(req, res, null)));
member.post('/:id', imageUpload, ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM member_marketplace_listings WHERE id = $1 AND member_id = $2', [util.int(req.params.id), req.member.id]);
  if (!item) return next();
  await saveListing(req, res, item);
}));
member.post('/:id/withdraw', ah(async (req, res) => {
  await db.query("UPDATE member_marketplace_listings SET status = 'withdrawn', is_active = 0 WHERE id = $1 AND member_id = $2", [util.int(req.params.id), req.member.id]);
  res.redirect('/member/marketplace');
}));

// ================================================================ admin
const admin = express.Router();
admin.use(auth.requireAdmin('staff'));

admin.get('/', ah(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'withdrawn', 'expired'].includes(req.query.status) ? req.query.status : 'pending';
  const rows = await db.many(`SELECT l.*, m.name AS member_name, m.name_np AS member_name_np, m.sadasyata_number,
      (SELECT count(*) FROM member_marketplace_inquiries i WHERE i.listing_id = l.id) AS inquiries
    FROM member_marketplace_listings l LEFT JOIN members m ON m.id = l.member_id WHERE l.status = $1 ORDER BY l.id DESC LIMIT 200`, [status]);
  const counts = Object.fromEntries((await db.many('SELECT status, count(*) AS n FROM member_marketplace_listings GROUP BY status')).map(r => [r.status, r.n]));
  res.render('admin/marketplace', { title: res.locals.t('सदस्य बजार', 'Member marketplace'), rows, status, counts, catLabel: c => catLabel(c, req.lang) });
}));

admin.post('/:id', ah(async (req, res) => {
  const l = await db.one('SELECT * FROM member_marketplace_listings WHERE id = $1', [util.int(req.params.id)]);
  if (!l) return res.redirect('/admin/marketplace');
  const action = req.body.action;
  const note = String(req.body.note || '').trim().slice(0, 255);
  if (action === 'approve') await db.query("UPDATE member_marketplace_listings SET status = 'approved', is_active = 1, approved_at = now(), approved_by = $1, admin_note = $2 WHERE id = $3", [req.admin.id, note, l.id]);
  else if (action === 'reject') await db.query("UPDATE member_marketplace_listings SET status = 'rejected', is_active = 0, admin_note = $1 WHERE id = $2", [note, l.id]);
  else if (action === 'delete') { await db.query('DELETE FROM member_marketplace_inquiries WHERE listing_id = $1', [l.id]); await db.query('DELETE FROM member_marketplace_listings WHERE id = $1', [l.id]); remove(req, l.image); }
  if (action === 'approve' || action === 'reject') {
    await notify.notifyMember(l.member_id, `${l.title}: ${action === 'approve' ? res.locals.t('बजारमा स्वीकृत', 'approved') : res.locals.t('अस्वीकृत', 'rejected')}`, note || null, '/member/marketplace');
  }
  await auth.audit(req, 'marketplace_' + action, 'member_marketplace_listings', l.id, l.title);
  res.redirect('/admin/marketplace?status=' + encodeURIComponent(req.query.back || l.status));
}));

// ================================================================ public
const pub = express.Router();
const LIVE = "l.status = 'approved' AND l.is_active = 1 AND (l.available_until IS NULL OR l.available_until >= now())";

pub.get('/', ah(async (req, res) => {
  const type = req.query.type === 'skill' ? 'skill' : req.query.type === 'product' ? 'product' : '';
  const cat = CATEGORIES.some(c => c[0] === req.query.category) ? req.query.category : '';
  const q = String(req.query.q || '').trim().slice(0, 80);
  const where = [LIVE], params = [];
  if (type) { params.push(type); where.push(`l.listing_type = $${params.length}`); }
  if (cat) { params.push(cat); where.push(`l.category = $${params.length}`); }
  if (q) { params.push('%' + q + '%'); where.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length} OR l.location ILIKE $${params.length})`); }
  const total = await db.value(`SELECT count(*) FROM member_marketplace_listings l WHERE ${where.join(' AND ')}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 18);
  const rows = await db.many(`SELECT l.* FROM member_marketplace_listings l WHERE ${where.join(' AND ')} ORDER BY l.approved_at DESC NULLS LAST, l.id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  res.render('public/marketplace', { title: res.locals.t('सदस्य बजार', 'Member marketplace'), rows, pg, type, cat, q, CATEGORIES, catLabel: c => catLabel(c, req.lang) });
}));

pub.get('/:id', ah(async (req, res, next) => {
  const l = await db.one(`SELECT l.* FROM member_marketplace_listings l WHERE l.id = $1 AND ${LIVE}`, [util.int(req.params.id)]);
  if (!l) return next();
  res.render('public/marketplace-item', { title: l.title, l, sent: req.query.sent === '1', errors: {}, values: {}, catLabel: c => catLabel(c, req.lang) });
}));

const inquiryLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip) });
pub.post('/:id/inquiry', inquiryLimiter, ah(async (req, res, next) => {
  const l = await db.one(`SELECT l.* FROM member_marketplace_listings l WHERE l.id = $1 AND ${LIVE}`, [util.int(req.params.id)]);
  if (!l) return next();
  if (isBot(req)) return res.redirect(`/marketplace/${l.id}?sent=1`);
  const name = String(req.body.name || '').trim().slice(0, 120);
  const phone = nd.toLatinDigits(String(req.body.phone || '').trim()).slice(0, 20);
  const message = String(req.body.message || '').trim().slice(0, 500);
  const errors = {};
  if (!name) errors.name = res.locals.t('नाम आवश्यक छ', 'Name required');
  if (!util.isPhone(phone)) errors.phone = res.locals.t('फोन नम्बर मिलेन', 'Invalid phone');
  if (Object.keys(errors).length) return res.status(422).render('public/marketplace-item', { title: l.title, l, sent: false, errors, values: req.body, catLabel: c => catLabel(c, req.lang) });
  await db.query('INSERT INTO member_marketplace_inquiries (listing_id, member_id, inquirer_name, inquirer_phone, message, is_read, created_at) VALUES ($1, $2, $3, $4, $5, 0, now())',
    [l.id, req.member?.id || null, name, phone, message]);
  await notify.notifyMember(l.member_id, res.locals.t('नयाँ सोधपुछ: ', 'New inquiry: ') + l.title, `${name} (${phone})${message ? ': ' + message : ''}`, '/member/marketplace');
  res.redirect(`/marketplace/${l.id}?sent=1`);
}));

module.exports = { member, admin, pub, CATEGORIES };
