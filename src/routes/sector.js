'use strict';
/**
 * Nepal cooperative / microfinance sector features:
 * savings & loan calculators, base-rate disclosure, payment channels, centre meetings, client protection.
 */
const express = require('express');
const db = require('../db');
const settings = require('../lib/settings');
const auth = require('../lib/auth');
const { flash } = require('../lib/security');
const fin = require('../lib/finance-tools');
const { resources, GROUPS } = require('../modules/resources');

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ACTIVE = 'is_active = 1';
const BS_MONTHS = ['बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत'];
const BS_MONTHS_EN = ['Baishakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Ashoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'];
const DAYS = [['आइतबार', 'Sunday'], ['सोमबार', 'Monday'], ['मंगलबार', 'Tuesday'], ['बुधबार', 'Wednesday'], ['बिहीबार', 'Thursday'], ['शुक्रबार', 'Friday'], ['शनिबार', 'Saturday']];

// ---------------------------------------------------------------- admin CRUD (generic resources)
const T = (name, np, en, extra = {}) => ({ name, label: [np, en], type: 'text', ...extra });
const N = (name, np, en, extra = {}) => T(name, np, en, { type: 'number', ...extra });
const SEL = (name, np, en, options, extra = {}) => T(name, np, en, { type: 'select', options, ...extra });
const ON = T('is_active', 'सक्रिय', 'Active', { type: 'bool', default: 1, list: true });
const ORD = N('display_order', 'क्रम', 'Order', { default: 0 });
GROUPS.sector = ['वित्तीय सेवा', 'Finance & disclosure'];
Object.assign(resources, {
  rate_disclosures: { group: 'sector', icon: 'percent', title: ['आधार दर / ब्याजदर अन्तर', 'Base rate & spread'], order: 'fiscal_year DESC, month_bs DESC', fields: [
    T('fiscal_year', 'आर्थिक वर्ष', 'Fiscal year', { required: true, list: true, hint: '2082/83' }),
    SEL('month_bs', 'महिना', 'Month', BS_MONTHS.map((m, i) => [String(i + 1), m, BS_MONTHS_EN[i]]), { required: true, list: true }),
    N('base_rate', 'आधार दर (%)', 'Base rate (%)', { list: true }), N('avg_deposit_rate', 'औसत निक्षेप ब्याजदर (%)', 'Average deposit rate (%)'),
    N('avg_lending_rate', 'औसत कर्जा ब्याजदर (%)', 'Average lending rate (%)'), N('spread', 'ब्याजदर अन्तर (%)', 'Spread (%)', { list: true }),
    N('cost_of_fund', 'कोषको लागत (%)', 'Cost of fund (%)'), T('note', 'टिप्पणी', 'Note', { type: 'textarea' }), ON] },
  payment_channels: { group: 'sector', icon: 'qr', title: ['भुक्तानी / जम्मा माध्यम', 'Payment channels'], order: 'display_order, id', fields: [
    SEL('kind', 'प्रकार', 'Type', [['qr', 'QR (Fonepay/NepalPay)', 'QR (Fonepay/NepalPay)'], ['bank', 'बैंक खाता', 'Bank account'], ['wallet', 'वालेट', 'Wallet']], { required: true, list: true }),
    T('name', 'नाम (English)', 'Name (English)', { required: true, list: true }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)'),
    T('account_name', 'खातावालाको नाम', 'Account name'), T('account_number', 'खाता / ID नं.', 'Account / ID no.', { list: true }), T('branch', 'शाखा', 'Branch'),
    T('qr_image', 'QR फोटो', 'QR image', { type: 'image' }), T('note', 'टिप्पणी', 'Note', { type: 'textarea' }), ORD, ON] },
  group_centres: { group: 'sector', icon: 'users', title: ['केन्द्र / समूह बैठक', 'Centres & meetings'], order: 'display_order, name', fields: [
    T('code', 'कोड', 'Code', { list: true }), T('name_np', 'केन्द्रको नाम (नेपाली)', 'Centre name (Nepali)', { list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }),
    T('address', 'ठेगाना', 'Address'), T('ward', 'वडा', 'Ward'),
    SEL('meeting_frequency', 'बैठक', 'Meets', [['weekly', 'साप्ताहिक', 'Weekly'], ['fortnightly', 'पाक्षिक', 'Fortnightly'], ['monthly', 'मासिक', 'Monthly']], { list: true }),
    SEL('meeting_day', 'बार', 'Day', DAYS.map((d, i) => [String(i), d[0], d[1]])), N('meeting_date', 'गते (मासिक)', 'Day of month (monthly)'),
    T('meeting_time', 'समय', 'Time', { hint: '7:00' }), T('facilitator', 'सहजकर्ता', 'Facilitator'), T('phone', 'फोन', 'Phone'), N('members_count', 'सदस्य संख्या', 'Members'), ORD, ON] },
});
for (const key of ['rate_disclosures', 'payment_channels', 'group_centres']) {
  const r = resources[key];
  r.key = key; r.table = key;
  r.fileFields = r.fields.filter(f => f.type === 'image' || f.type === 'file');
  r.listFields = r.fields.filter(f => f.list);
}

// ---------------------------------------------------------------- public
const pub = express.Router();

pub.get('/tools', (req, res) => res.render('public/tools', { title: res.locals.t('बचत तथा ऋण उपकरण', 'Savings & loan tools') }));

pub.get('/tools/fixed-deposit', ah(async (req, res) => {
  const q = req.query, taxDefault = fin.num(await settings.get('deposit_tax_rate', '5'), 5, 100);
  const input = { principal: fin.num(q.principal, 100000), rate: fin.num(q.rate, 9, 100), months: Math.min(fin.num(q.months, 12), 600),
    compounding: ['monthly', 'quarterly', 'yearly', 'simple'].includes(q.compounding) ? q.compounding : 'quarterly', tax: fin.num(q.tax, taxDefault, 100) };
  res.render('public/tool-fd', { title: res.locals.t('मुद्दती बचत गणना', 'Fixed deposit calculator'), input, out: fin.fixedDeposit(input) });
}));

pub.get('/tools/saving', ah(async (req, res) => {
  const q = req.query, taxDefault = fin.num(await settings.get('deposit_tax_rate', '5'), 5, 100);
  const input = { deposit: fin.num(q.deposit, 2000), rate: fin.num(q.rate, 7, 100), months: Math.min(fin.num(q.months, 60), 600), tax: fin.num(q.tax, taxDefault, 100) };
  res.render('public/tool-saving', { title: res.locals.t('मासिक बचत गणना', 'Recurring saving calculator'), input, out: fin.recurringSaving(input) });
}));

pub.get('/tools/loan-eligibility', (req, res) => {
  const q = req.query;
  const input = { income: fin.num(q.income, 50000), existing: fin.num(q.existing, 0), rate: fin.num(q.rate, 13, 100), months: Math.min(fin.num(q.months, 60), 600), ratio: Math.min(fin.num(q.ratio, 50, 100), 80) };
  res.render('public/tool-eligibility', { title: res.locals.t('ऋण योग्यता', 'Loan eligibility'), input, out: fin.loanEligibility(input) });
});

pub.get('/rates/disclosure', ah(async (req, res) => {
  const rows = await db.many(`SELECT * FROM rate_disclosures WHERE ${ACTIVE} ORDER BY fiscal_year DESC, month_bs DESC LIMIT 36`);
  res.render('public/rate-disclosure', { title: res.locals.t('आधार दर तथा ब्याजदर अन्तर', 'Base rate & interest spread'), rows, BS_MONTHS, BS_MONTHS_EN });
}));

pub.get('/pay', ah(async (req, res) => {
  const rows = await db.many(`SELECT * FROM payment_channels WHERE ${ACTIVE} ORDER BY display_order, id`);
  res.render('public/pay', { title: res.locals.t('रकम जम्मा / भुक्तानी', 'Deposit & payment'), rows });
}));

pub.get('/centres', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  const rows = await db.many(`SELECT * FROM group_centres WHERE ${ACTIVE} ${q ? "AND (name ILIKE $1 OR name_np ILIKE $1 OR address ILIKE $1 OR code ILIKE $1 OR ward = $2)" : ''} ORDER BY display_order, name`,
    q ? ['%' + q.replace(/[%_\\]/g, '\\$&') + '%', q] : []);
  res.render('public/centres', { title: res.locals.t('केन्द्र तथा बैठक तालिका', 'Centres & meeting schedule'), rows, q, DAYS });
}));

pub.get('/client-protection', ah(async (req, res) => {
  res.render('public/client-protection', { title: res.locals.t('ग्राहक संरक्षण तथा गुनासो सुनुवाइ', 'Client protection & grievances') });
}));

// ---------------------------------------------------------------- admin: client-protection settings
const admin = express.Router();
const PROTECTION_KEYS = ['protection_officer_name', 'protection_officer_phone', 'protection_officer_email', 'protection_regulator', 'protection_extra_np', 'deposit_tax_rate'];
admin.get('/client-protection', auth.requireAdmin('admin'), (req, res) => res.render('admin/client-protection', { title: res.locals.t('ग्राहक संरक्षण', 'Client protection') }));
admin.post('/client-protection', auth.requireAdmin('admin'), ah(async (req, res) => {
  for (const k of PROTECTION_KEYS) {
    let v = String(req.body[k] ?? '').slice(0, 4000).trim();
    if (k === 'protection_regulator' && !['coop', 'nrb'].includes(v)) v = 'coop';
    if (k === 'deposit_tax_rate') v = String(Math.min(fin.num(v, 5, 100), 100));
    await settings.set(k, v, { group: 'protection', label: k, type: k.endsWith('_np') ? 'textarea' : 'text' });
  }
  await auth.audit(req, 'update', 'site_settings', null, 'Client protection settings');
  flash(req, 'success', res.locals.t('सुरक्षित भयो।', 'Saved.'));
  res.redirect('/admin/client-protection');
}));

/** Public menu additions (only links that have content, so empty sections never show). */
const navCache = new Map();
async function navExtras() {
  const schema = db.currentSchema();
  const hit = navCache.get(schema);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const [disc, pay, centres] = await Promise.all(['rate_disclosures', 'payment_channels', 'group_centres']
    .map(t => db.value(`SELECT count(*) FROM ${t} WHERE ${ACTIVE}`).then(Number).catch(() => 0)));
  const v = { disc, pay, centres };
  navCache.set(schema, { at: Date.now(), v });
  return v;
}
function navMiddleware(req, res, next) {
  navExtras().then(x => {
    const nav = res.locals.nav = (res.locals.nav || []).map(i => (i.children ? { ...i, children: [...i.children] } : i)); // never mutate the cached menu
    const find = href => nav.find(i => i.href === href);
    const services = find('/services'), updates = find('/notices'), about = find('/about');
    const tools = nav.find(i => (i.children || []).some(c => c.href === '/emi-calculator'));
    if (services && services.children) {
      if (x.pay) services.children.push({ href: '/pay', label: ['रकम जम्मा / QR भुक्तानी', 'Deposit & QR payment'] });
      if (x.centres) services.children.push({ href: '/centres', label: ['केन्द्र / बैठक तालिका', 'Centres & meetings'] });
    }
    if (tools && tools.children) tools.children.push(
      { href: '/tools/fixed-deposit', label: ['मुद्दती बचत गणना', 'Fixed deposit calculator'] },
      { href: '/tools/saving', label: ['मासिक बचत गणना', 'Saving calculator'] },
      { href: '/tools/loan-eligibility', label: ['ऋण योग्यता', 'Loan eligibility'] });
    if (updates && updates.children && x.disc) updates.children.push({ href: '/rates/disclosure', label: ['आधार दर / ब्याजदर अन्तर', 'Base rate & spread'] });
    if (about && about.children) about.children.push({ href: '/client-protection', label: ['ग्राहक संरक्षण', 'Client protection'] });
    next();
  }).catch(next);
}

module.exports = { pub, admin, navMiddleware, DAYS, BS_MONTHS };
