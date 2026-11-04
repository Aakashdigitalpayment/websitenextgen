'use strict';
/** Generic form engine for the declarative modules in src/modules/applications.js */
const db = require('../db');
const nd = require('./nepali-date');
const { trackingId, isEmail, isPhone } = require('./util');

/** Dynamic option lists (value, label_np, label_en) loaded per tenant. */
const optionSources = {
  async branches() {
    const rows = await db.many('SELECT name, name_np FROM service_centers WHERE is_active = 1 ORDER BY is_main_branch DESC, display_order, id');
    return rows.map(r => [r.name_np || r.name, r.name_np || r.name, r.name || r.name_np]);
  },
  async loanTypes() {
    const rows = await db.many(`SELECT name, name_np FROM interest_rates WHERE category = 'loan' AND is_active = 1 ORDER BY display_order, id`);
    return rows.length ? rows.map(r => [r.name, r.name_np || r.name, r.name]) :
      [['business', 'व्यवसाय ऋण', 'Business loan'], ['home', 'घर ऋण', 'Home loan'], ['education', 'शैक्षिक ऋण', 'Education loan'], ['agriculture', 'कृषि ऋण', 'Agriculture loan'], ['vehicle', 'सवारी ऋण', 'Vehicle loan'], ['personal', 'व्यक्तिगत ऋण', 'Personal loan']];
  },
  async savingTypes() {
    const rows = await db.many(`SELECT name, name_np FROM interest_rates WHERE category = 'saving' AND is_active = 1 ORDER BY display_order, id`);
    return rows.length ? rows.map(r => [r.name, r.name_np || r.name, r.name]) :
      [['regular', 'नियमित बचत', 'Regular saving'], ['fixed', 'मुद्दती बचत', 'Fixed deposit'], ['child', 'बाल बचत', 'Child saving'], ['women', 'महिला बचत', 'Women saving']];
  },
  async welfareTypes() {
    const rows = await db.many('SELECT slug, name_np, name_en FROM welfare_claim_types WHERE is_active = 1 ORDER BY display_order, id');
    return rows.length ? rows.map(r => [r.slug, r.name_np, r.name_en || r.name_np]) :
      [['medical', 'उपचार सहयोग', 'Medical'], ['death', 'मृत्यु सहयोग', 'Death'], ['maternity', 'सुत्केरी सहयोग', 'Maternity'], ['disaster', 'प्राकृतिक प्रकोप', 'Disaster'], ['other', 'अन्य', 'Other']];
  },
  async digitalTypes() {
    const rows = await db.many('SELECT slug, name_np, name_en FROM digital_service_types WHERE is_active = 1 ORDER BY display_order, id');
    return rows.length ? rows.map(r => [r.slug, r.name_np, r.name_en || r.name_np]) :
      [['mobile_banking', 'मोबाइल बैंकिङ', 'Mobile banking'], ['statement', 'बैंक स्टेटमेन्ट', 'Statement'], ['qr', 'QR भुक्तानी', 'QR payment'], ['sms', 'SMS अलर्ट', 'SMS alert'], ['other', 'अन्य', 'Other']];
  },
  async honorPrograms() {
    const rows = await db.many(`SELECT id, title_np, title_en FROM honor_programs WHERE is_active = 1
                                AND (opens_at IS NULL OR opens_at <= now()) AND (closes_at IS NULL OR closes_at >= now()) ORDER BY id DESC`);
    return rows.map(r => [String(r.id), r.title_np, r.title_en || r.title_np]);
  },
  async honorCategories() {
    const rows = await db.many('SELECT id, name_np, name_en FROM honor_categories WHERE is_active = 1 ORDER BY display_order, id');
    return rows.map(r => [String(r.id), r.name_np, r.name_en || r.name_np]);
  },
  async careers() {
    const rows = await db.many(`SELECT id, title, title_np FROM careers WHERE is_active = 1 AND deleted_at IS NULL AND (deadline IS NULL OR deadline >= CURRENT_DATE) ORDER BY id DESC`);
    return rows.map(r => [String(r.id), r.title_np || r.title, r.title || r.title_np]);
  },
  async auctions() {
    const rows = await db.many(`SELECT id, title, title_en FROM auction_notices WHERE is_active = 1 AND status IN ('upcoming','ongoing') ORDER BY auction_date NULLS LAST, id DESC`);
    return rows.map(r => [String(r.id), r.title, r.title_en || r.title]);
  },
};

/** Resolve select/radio options for every field of a module. */
async function resolveOptions(mod) {
  const out = {};
  for (const f of mod.fields) {
    if (f.options) out[f.name] = f.options;
    else if (f.optionsFrom) out[f.name] = await optionSources[f.optionsFrom]();
  }
  return out;
}

/**
 * Validate a submission.
 * @returns {{data:object, errors:object}} errors keyed by field name (bilingual messages)
 */
function validate(mod, body, uploaded, options, lang = 'np') {
  const data = {}, errors = {};
  const msg = (np, en) => (lang === 'en' ? en : np);
  for (const f of mod.fields) {
    const label = lang === 'en' ? f.label[1] : f.label[0];
    if (f.type === 'file' || f.type === 'image') {
      const v = uploaded?.[f.name];
      if (v) data[f.name] = v;
      else if (f.required) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
      continue;
    }
    if (f.type === 'checkbox') { data[f.name] = body[f.name] ? 1 : 0; continue; }
    let v = body[f.name];
    v = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    if (f.type === 'tel' || f.type === 'number' || f.type === 'rating' || f.type === 'bsdate') v = nd.toLatinDigits(v);
    if (v === '') {
      if (f.required) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
      continue;
    }
    if (v.length > (f.type === 'textarea' ? 5000 : 255)) { errors[f.name] = msg('धेरै लामो भयो', 'Too long'); continue; }
    switch (f.type) {
      case 'email':
        if (!isEmail(v)) errors[f.name] = msg('इमेल मिलेन', 'Invalid email');
        break;
      case 'tel':
        if (!isPhone(v)) errors[f.name] = msg('फोन नम्बर मिलेन', 'Invalid phone number');
        break;
      case 'number': case 'rating': {
        const n = Number(v.replace(/,/g, ''));
        if (!Number.isFinite(n)) { errors[f.name] = msg('अंकमा लेख्नुहोस्', 'Must be a number'); break; }
        if (f.type === 'rating' && (n < 1 || n > 5)) { errors[f.name] = msg('१ देखि ५ छान्नुहोस्', 'Pick 1–5'); break; }
        if (f.min !== undefined && n < f.min) { errors[f.name] = msg(`कम्तीमा ${f.min}`, `At least ${f.min}`); break; }
        if (f.max !== undefined && n > f.max) { errors[f.name] = msg(`बढीमा ${f.max}`, `At most ${f.max}`); break; }
        v = n;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) { errors[f.name] = msg('मिति मिलेन', 'Invalid date'); break; }
        if (f.futureOnly && v < new Date().toISOString().slice(0, 10)) errors[f.name] = msg('आजभन्दा पछिको मिति छान्नुहोस्', 'Pick a future date');
        break;
      case 'bsdate': {
        const ad = nd.bsToAd(v);
        if (!ad) { errors[f.name] = msg('वि.सं. मिति मिलेन (YYYY-MM-DD)', 'Invalid BS date (YYYY-MM-DD)'); break; }
        if (f.adCol) data[f.adCol] = ad;
        break;
      }
      case 'select': case 'radio': {
        const opts = options[f.name] || [];
        if (opts.length && !opts.some(o => String(o[0]) === v)) errors[f.name] = msg('सूचीबाट छान्नुहोस्', 'Choose from the list');
        break;
      }
    }
    if (!errors[f.name]) data[f.name] = v;
  }
  return { data, errors };
}

/** Insert a validated submission. Returns the row (with tracking_id when the module uses one). */
async function insertSubmission(mod, data, extra = {}) {
  const row = { ...data, ...extra };
  if (!mod.noTracking) row.tracking_id = trackingId(mod.prefix);
  const cols = await db.columns(mod.table);
  if (!mod.noStatus && cols.has('status')) row.status = row.status || 'pending';
  const clean = await db.pick(mod.table, row);
  return db.insert(mod.table, clean);
}

/** Allowed status values for a table, read from its CHECK constraint (falls back to a default set). */
const statusCache = new Map();
async function statusesFor(table) {
  const key = db.currentSchema() + '.' + table;
  if (statusCache.has(key)) return statusCache.get(key);
  const row = await db.one(
    `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema() AND t.relname = $1 AND c.contype = 'c' AND pg_get_constraintdef(c.oid) ~ '\\(status\\)'`, [table]);
  let list = row ? [...row.def.matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : [];
  if (!list.length) list = ['pending', 'processing', 'approved', 'rejected', 'completed'];
  statusCache.set(key, list);
  return list;
}

const STATUS_LABELS = {
  pending: ['प्रक्रियामा पर्खँदै', 'Pending'], processing: ['प्रक्रियामा', 'Processing'], in_progress: ['काम हुँदै', 'In progress'],
  approved: ['स्वीकृत', 'Approved'], rejected: ['अस्वीकृत', 'Rejected'], completed: ['सम्पन्न', 'Completed'], disbursed: ['ऋण प्रवाह', 'Disbursed'],
  confirmed: ['निश्चित', 'Confirmed'], cancelled: ['रद्द', 'Cancelled'], resolved: ['समाधान', 'Resolved'], closed: ['बन्द', 'Closed'],
  reviewed: ['हेरियो', 'Reviewed'], shortlisted: ['छनोट सूचीमा', 'Shortlisted'], interviewed: ['अन्तर्वार्ता', 'Interviewed'],
  selected: ['छनोट', 'Selected'], under_review: ['समीक्षामा', 'Under review'], accepted: ['स्वीकार', 'Accepted'],
  expired: ['म्याद सकियो', 'Expired'], withdrawn: ['फिर्ता', 'Withdrawn'], cleared: ['फछ्र्यौट', 'Cleared'],
};
const statusLabel = (s, lang = 'np') => (STATUS_LABELS[s] ? STATUS_LABELS[s][lang === 'en' ? 1 : 0] : s);

module.exports = { resolveOptions, validate, insertSubmission, statusesFor, statusLabel, optionSources };
