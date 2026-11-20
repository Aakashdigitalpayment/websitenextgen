'use strict';
/** Generic form engine for the declarative modules in src/modules/applications.js */
const db = require('../db');
const nd = require('./nepali-date');
const { trackingId, isEmail, isPhone } = require('./util');
const pii = require('./pii-crypto');
const ADDRESS = require('./nepal-address.json');

/** Province → district → [[municipality, wards]] (includes/nepal-address.php, 753 local levels). */
const DISTRICTS = [...new Set(Object.values(ADDRESS).flatMap(p => Object.keys(p)))].sort((a, b) => a.localeCompare(b, 'ne'));
function addressValid(prov, dist, muni, ward) {
  const d = ADDRESS[prov]?.[dist];
  if (!d) return false;
  const m = d.find(x => x[0] === muni);
  return !!m && (!ward || (Number(ward) >= 1 && Number(ward) <= m[1]));
}
/** 'टोल, वडा 5, नगरपालिका, जिल्ला, प्रदेश' — same order as PHP composeAddress(). */
function composeAddress(v, prefix) {
  return ['tole', 'ward', 'municipality', 'district', 'province'].map(k => String(v[prefix + '_' + k] || '').trim())
    .map((x, i) => (x && i === 1 ? 'वडा ' + x : x)).filter(Boolean).join(', ');
}
const list = v => (v === undefined || v === null ? [] : [].concat(v)).map(x => String(x ?? '').trim());
/** Posted date in BS or AD → AD (coop-date-ui.php coop_date_ui_normalize_ad). */
function normalizeAdDate(raw) {
  const v = nd.toLatinDigits(String(raw || '').trim()).slice(0, 10);
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  if (Number(m[1]) >= 2070 && Number(m[1]) <= 2100) return nd.bsToAd(v);
  return Number.isNaN(Date.parse(v)) ? null : v;
}

/** A CSS colour from the type masters, or null (hex / rgb() / hsl() / var(--x) / named only: rendered into a style attribute). */
const safeColor = c => (/^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%]+\)|var\(--[a-z0-9-]+\)|[a-z]{3,20})$/i.test(String(c || '').trim()) ? String(c).trim() : null);

/** Dynamic option lists (value, label_np, label_en) loaded per tenant. */
const optionSources = {
  async branches() {
    const rows = await db.many('SELECT name, name_np FROM service_centers WHERE is_active = 1 ORDER BY is_main_branch DESC, display_order, id');
    return rows.map(r => [r.name_np || r.name, r.name_np || r.name, r.name || r.name_np]);
  },
  async loanTypes() {
    const rows = await db.many(`SELECT * FROM interest_rates WHERE category = 'loan' AND is_active = 1 ORDER BY display_order, id`);
    // the rate next to each type (loan-apply.php "(x.xx%)")
    const rate = r => { const v = Number(r.rate ?? r.interest_rate); return Number.isFinite(v) && v > 0 ? ` (${v.toFixed(2)}%)` : ''; };
    return rows.length ? rows.map(r => [r.name, (r.name_np || r.name) + nd.toNepaliDigits(rate(r)), r.name + rate(r)]) :
      [['business', 'व्यवसाय ऋण', 'Business loan'], ['home', 'घर ऋण', 'Home loan'], ['education', 'शैक्षिक ऋण', 'Education loan'], ['agriculture', 'कृषि ऋण', 'Agriculture loan'], ['vehicle', 'सवारी ऋण', 'Vehicle loan'], ['personal', 'व्यक्तिगत ऋण', 'Personal loan']];
  },
  async savingTypes() {
    const rows = await db.many(`SELECT name, name_np FROM interest_rates WHERE category = 'saving' AND is_active = 1 ORDER BY display_order, id`);
    return rows.length ? rows.map(r => [r.name, r.name_np || r.name, r.name]) :
      [['regular', 'नियमित बचत', 'Regular saving'], ['fixed', 'मुद्दती बचत', 'Fixed deposit'], ['child', 'बाल बचत', 'Child saving'], ['women', 'महिला बचत', 'Women saving']];
  },
  // { admin: true }: every row (inactive / closed too) so the inbox, print and CSV show labels for old submissions
  async welfareTypes({ admin } = {}) {
    const rows = await db.many(`SELECT slug, name_np, name_en, form_profile, requires_document, color FROM welfare_claim_types ${admin ? '' : 'WHERE is_active = 1'} ORDER BY display_order, id`);
    return rows.length ? rows.map(r => [r.slug, r.name_np, r.name_en || r.name_np, { profile: r.form_profile || r.slug, requires_document: !!Number(r.requires_document), color: safeColor(r.color) }]) :
      [['medical', 'उपचार सहयोग', 'Medical'], ['death', 'मृत्यु सहयोग', 'Death'], ['maternity', 'सुत्केरी सहयोग', 'Maternity'], ['insurance', 'बीमा दाबी', 'Insurance'], ['disaster', 'प्राकृतिक प्रकोप', 'Disaster'], ['other', 'अन्य', 'Other']].map(o => [...o, { profile: o[0] }]);
  },
  async digitalTypes({ admin } = {}) {
    const rows = await db.many(`SELECT slug, name_np, name_en, requires_document FROM digital_service_types ${admin ? '' : 'WHERE is_active = 1'} ORDER BY display_order, id`);
    return rows.length ? rows.map(r => [r.slug, r.name_np, r.name_en || r.name_np, { requires_document: !!Number(r.requires_document) }]) :
      // includes/digital-service-types.php slugs, so rows imported from PHP show the same labels
      [['statement_request', 'स्टेटमेन्ट अनुरोध', 'Statement request'], ['bill_payment', 'बिल भुक्तानी सहयोग', 'Bill payment support'], ['mobile_recharge', 'मोबाइल रिचार्ज अनुरोध', 'Mobile recharge request'],
        ['internet_banking', 'इन्टरनेट/मोबाइल बैंकिङ', 'Internet / mobile banking'], ['missed_call_banking', 'मिस्ड कल बैंकिङ', 'Missed call banking'], ['sms_alert', 'SMS अलर्ट सेवा', 'SMS alert service'],
        ['card_service', 'कार्ड सेवा', 'Card service'], ['qr_payment', 'QR/डिजिटल भुक्तानी', 'QR / digital payment'], ['share_refund', 'शेयर फिर्ता (Refund)', 'Share refund'],
        ['share_increase', 'शेयर वृद्धि (Increase)', 'Share increase'], ['other', 'अन्य डिजिटल सेवा', 'Other digital service']];
  },
  async honorPrograms({ admin } = {}) {
    const rows = await db.many(admin ? 'SELECT id, title_np, title_en FROM honor_programs ORDER BY id DESC' : `SELECT id, title_np, title_en FROM honor_programs WHERE is_active = 1
                                AND (opens_at IS NULL OR opens_at <= now()) AND (closes_at IS NULL OR closes_at >= now()) ORDER BY id DESC`);
    return rows.map(r => [String(r.id), r.title_np, r.title_en || r.title_np]);
  },
  async honorCategories({ admin } = {}) {
    // per-programme categories (honor_program_categories): meta.programs lists the programmes that offer it
    const rows = await db.many(`SELECT c.id, c.name_np, c.name_en, c.requires_nominee, c.requires_document,
                                       COALESCE(array_agg(pc.program_id) FILTER (WHERE pc.program_id IS NOT NULL), '{}') AS programs
                                FROM honor_categories c LEFT JOIN honor_program_categories pc ON pc.category_id = c.id
                                ${admin ? '' : 'WHERE c.is_active = 1'} GROUP BY c.id ORDER BY c.display_order, c.id`);
    return rows.map(r => [String(r.id), r.name_np, r.name_en || r.name_np, { requires_nominee: !!Number(r.requires_nominee), requires_document: !!Number(r.requires_document), programs: r.programs.map(String) }]);
  },
  async careers({ admin } = {}) {
    const rows = await db.many(admin ? 'SELECT id, title, title_np FROM careers ORDER BY id DESC LIMIT 500' : `SELECT id, title, title_np FROM careers WHERE is_active = 1 AND deleted_at IS NULL AND COALESCE(allow_online_apply, 1) = 1
                                AND (deadline IS NULL OR deadline >= CURRENT_DATE) ORDER BY id DESC`);
    return rows.map(r => [String(r.id), r.title_np || r.title, r.title || r.title_np]);
  },
  async districts() { return DISTRICTS.map(d => [d, d, d]); },
  /** getOfficeTimeOptions(): office_time_start … office_time_end every 30 minutes, values like PHP ('10:00 AM'). */
  async officeTimes() {
    const s = await require('./settings').all();
    const parse = (v, d) => { const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/); return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : d; };
    let a = parse(s.office_time_start, 600), b = parse(s.office_time_end, 1020);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let t = a; t <= b && out.length < 96; t += 30) {
      const h = Math.floor(t / 60), m = t % 60, h12 = h % 12 || 12, ampm = h < 12 ? 'AM' : 'PM';
      const v = `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${ampm}`;
      out.push([v, nd.toNepaliDigits(`${h12}:${String(m).padStart(2, '0')}`) + (h < 12 ? ' बिहान' : h < 16 ? ' दिउँसो' : ' बेलुकी'), v]);
    }
    return out;
  },
  // public form: open auctions only; admin: all of them, so bids on completed/cancelled auctions keep their title
  async auctions({ admin } = {}) {
    if (admin) {
      const all = await db.many('SELECT id, title, title_en FROM auction_notices ORDER BY id DESC LIMIT 1000');
      return all.map(r => [String(r.id), r.title, r.title_en || r.title]);
    }
    const rows = await db.many(`SELECT id, title, title_en, status, is_active, auction_date, auction_time, minimum_price FROM auction_notices
                                WHERE is_active = 1 AND status IN ('upcoming','ongoing') ORDER BY auction_date NULLS LAST, id DESC`);
    const { isOpen } = require('./auctions');
    return rows.filter(r => isOpen(r)).map(r => [String(r.id), r.title, r.title_en || r.title, { minimum_price: Number(r.minimum_price) || 0 }]);
  },
};

/** Resolve select/radio options for every field of a module. */
async function resolveOptions(mod, { admin = false } = {}) {
  const out = {};
  for (const f of mod.fields) {
    if (f.options) out[f.name] = f.options;
    else if (f.optionsFrom) out[f.name] = await optionSources[f.optionsFrom]({ admin });
  }
  return out;
}

/** Fields whose values come from the member / KYM instead of the POST ('all' = signed-in member, 'personal' = verified Member ID). */
function identitySkipped(mod, f, skip) {
  if (!skip || !mod.memberGate) return false;
  if (f.identity) return true;
  return skip === 'all' && [mod.phoneCol, mod.memberCol, 'is_coop_member'].includes(f.name);
}

/**
 * Validate a submission.
 * @param {{skipIdentity?: 'all'|'personal'|null}} [opts]
 * @returns {{data:object, errors:object}} errors keyed by field name (bilingual messages)
 */
function validate(mod, body, uploaded, options, lang = 'np', opts = {}) {
  const data = {}, errors = {};
  const msg = (np, en) => (lang === 'en' ? en : np);
  const aml = {};
  const metaOf = (field, key) => {
    const cur = String(body[field] ?? '').trim();
    const o = (options[field] || []).find(x => String(x[0]) === cur);
    return o && o[3] ? o[3][key] : undefined;
  };
  const byName = new Map(mod.fields.map(f => [f.name, f]));
  const shown = (f, depth = 0) => {
    if (!f.showIf) return true;
    const c = f.showIf;
    const ctl = byName.get(c.field);
    // a hidden controlling field counts as empty (appointment: cooperative visit hides "are you a member?")
    let cur = ctl && depth < 5 && !shown(ctl, depth + 1) ? '' : String(body[c.field] ?? '').trim();
    if (c.meta) cur = metaOf(c.field, c.meta) ?? cur;
    if (c.in) return c.in.includes(cur);
    return c.eq !== undefined ? cur === c.eq : c.ne !== undefined ? cur !== c.ne : !!cur;
  };
  const isRequired = f => !!((f.required && !(f.requiredUnless && body[f.requiredUnless])) || (f.requiredWhenShown && f.showIf) || (f.requiredIf && metaOf(f.requiredIf.field, f.requiredIf.meta)));
  for (const f of mod.fields) {
    const label = lang === 'en' ? f.label[1] : f.label[0];
    if (f.type === 'heading') continue;
    if (identitySkipped(mod, f, opts.skipIdentity)) continue; // overwritten from the KYM / member on the server
    if (!shown(f)) continue; // hidden branch (e.g. business-only fields): value is dropped, as in the PHP form
    if (f.type === 'address') {
      const p = f.prefix;
      if (f.sameAs && body[f.sameAs.toggle]) {
        for (const k of ['province', 'district', 'municipality', 'ward', 'tole']) data[p + '_' + k] = data[f.sameAs.from + '_' + k] ?? '';
        data[f.name] = data[f.sameAs.from + '_address'] || composeAddress(data, p);
        continue;
      }
      const v = {};
      for (const k of ['province', 'district', 'municipality', 'ward', 'tole']) v[p + '_' + k] = nd.toLatinDigits(String(body[p + '_' + k] ?? '').trim()).slice(0, k === 'ward' ? 3 : 120);
      const any = v[p + '_province'] || v[p + '_district'] || v[p + '_municipality'];
      if (!any && !v[p + '_tole']) {
        const flat = String(body[f.name] ?? '').trim().slice(0, 500); // legacy free-text address
        if (flat) data[f.name] = flat;
        else if (f.required) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
        continue;
      }
      if (any && !addressValid(v[p + '_province'], v[p + '_district'], v[p + '_municipality'], v[p + '_ward'])) {
        errors[f.name] = msg('प्रदेश, जिल्ला, पालिका र वडा सूचीबाट छान्नुहोस्', 'Choose province, district, municipality and ward from the list');
        continue;
      }
      if (f.required && (!v[p + '_municipality'] || !v[p + '_ward'])) { errors[f.name] = msg(`${label} पूरा भर्नुहोस्`, `Complete the ${label.toLowerCase()}`); continue; }
      Object.assign(data, v);
      data[f.name] = composeAddress(v, p);
      continue;
    }
    if (f.type === 'family') {
      const rel = list(body.family_relation), name = list(body.family_member_name), phone = list(body.family_member_phone);
      const rows = [];
      for (let i = 0; i < Math.min(20, Math.max(rel.length, name.length, phone.length)); i++) {
        if (!name[i]) continue; // rows without a name are dropped (online-kyc.php)
        rows.push({ relation: (rel[i] || '').slice(0, 30), name: name[i].slice(0, 100), phone: nd.toLatinDigits(phone[i] || '').slice(0, 20) });
      }
      if (rows.length) {
        data[f.name] = JSON.stringify(rows);
        for (const [r, col] of [['father', 'father_name'], ['mother', 'mother_name'], ['grandfather', 'grandfather_name'], ['spouse', 'spouse_name']]) {
          const hit = rows.find(x => x.relation === r);
          if (hit && !data[col]) data[col] = hit.name;
        }
      } else if (f.required) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
      data._familyRows = rows;
      continue;
    }
    if (f.type === 'moneyitems') {
      const names = list(body[f.name + '_name']), amts = list(body[f.name + '_amount']);
      const items = [];
      let total = 0;
      for (let i = 0; i < Math.min(30, Math.max(names.length, amts.length)); i++) {
        const nm = (names[i] || '').slice(0, 100);
        const amt = Number(nd.toLatinDigits(amts[i] || '').replace(/[^0-9.]/g, '')) || 0;
        if (!nm && amt <= 0) continue;
        items.push({ name: nm, amount: amt });
        total += amt;
      }
      if (items.length) aml[f.name === 'income_source' ? 'income_items' : 'expense_items'] = items;
      if (total > 0) aml[f.name === 'income_source' ? 'income_total' : 'expense_total'] = Math.round(total * 100) / 100;
      continue;
    }
    if (f.type === 'file' || f.type === 'image') {
      let v = uploaded?.[f.name];
      if (Array.isArray(v)) v = v.filter(Boolean).join(','); // several files: comma-joined, as PHP stored documents[]
      if (v) data[f.name] = v;
      else if (isRequired(f)) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
      continue;
    }
    if (f.type === 'checkbox') {
      data[f.name] = body[f.name] ? 1 : 0;
      if (f.required && !data[f.name]) errors[f.name] = msg('यो स्वीकार गर्नुपर्छ', 'Please confirm this');
      if (f.store === 'none') delete data[f.name];
      continue;
    }
    let v = body[f.name];
    v = typeof v === 'string' ? v.trim() : v == null ? '' : String(v);
    if (f.type === 'tel' || f.type === 'number' || f.type === 'rating' || f.type === 'bsdate' || f.type === 'date' || f.digits) v = nd.toLatinDigits(v);
    if (v === '') {
      if (isRequired(f)) errors[f.name] = msg(`${label} आवश्यक छ`, `${label} is required`);
      continue;
    }
    if (v.length > (f.type === 'textarea' ? 5000 : 255)) { errors[f.name] = msg('धेरै लामो भयो', 'Too long'); continue; }
    switch (f.type) {
      case 'email':
        if (!isEmail(v)) errors[f.name] = msg('इमेल मिलेन', 'Invalid email');
        break;
      case 'tel':
        if (mod.mobile10 && f.name === mod.phoneCol) {
          // loan / account / grievance / welfare / digital / job / bid: a 10-digit mobile, stored normalised
          let d = v.replace(/\D+/g, '');
          if (d.length > 10 && d.startsWith('977')) d = d.slice(-10);
          if (!(mod.mobile10 === 'strict' ? /^9\d{9}$/ : /^\d{10}$/).test(d)) errors[f.name] = msg('कृपया १० अंकको मोबाइल नम्बर राख्नुहोस्।', 'Please enter a valid 10-digit mobile number.');
          else v = d;
        } else if (!isPhone(v)) errors[f.name] = msg('फोन नम्बर मिलेन', 'Invalid phone number');
        break;
      case 'number': case 'rating': {
        const n = Number(v.replace(/,/g, ''));
        if (!Number.isFinite(n) || Math.abs(n) > 1e12) { errors[f.name] = msg('अंकमा लेख्नुहोस्', 'Must be a number'); break; }
        if (f.type === 'rating' && (n < 1 || n > 5)) { errors[f.name] = msg('१ देखि ५ छान्नुहोस्', 'Pick 1–5'); break; }
        if (f.min !== undefined && n < f.min) { errors[f.name] = msg(`कम्तीमा ${f.min}`, `At least ${f.min}`); break; }
        if (f.max !== undefined && n > f.max) { errors[f.name] = msg(`बढीमा ${f.max}`, `At most ${f.max}`); break; }
        v = n;
        break;
      }
      case 'date': {
        const ad = normalizeAdDate(v); // the Nepali UI posts B.S.; stored as A.D.
        if (!ad) { errors[f.name] = msg('मिति मिलेन', 'Invalid date'); break; }
        v = ad;
        if (f.futureOnly && v < new Date().toISOString().slice(0, 10)) errors[f.name] = msg('आजभन्दा पछिको मिति छान्नुहोस्', 'Pick a future date');
        break;
      }
      case 'bsdate': {
        const ad = nd.bsToAd(v);
        if (!ad) { errors[f.name] = msg('वि.सं. मिति मिलेन (YYYY-MM-DD)', 'Invalid BS date (YYYY-MM-DD)'); break; }
        if (f.adCol) data[f.adCol] = ad;
        break;
      }
      case 'select': case 'radio': {
        const opts = options[f.name] || [];
        const hit = opts.find(o => String(o[0]) === v);
        if (opts.length && !hit) { errors[f.name] = msg('सूचीबाट छान्नुहोस्', 'Choose from the list'); break; }
        // options limited by another field (honour categories offered by the chosen programme)
        if (f.filterBy && hit && hit[3]) {
          const allowed = hit[3][f.filterBy.meta] || [];
          const other = String(body[f.filterBy.field] ?? '');
          const anyMapped = opts.some(o => o[3] && (o[3][f.filterBy.meta] || []).includes(other));
          if (anyMapped && !allowed.includes(other)) errors[f.name] = msg('यो कार्यक्रममा यो विधा छैन', 'This category is not offered in the chosen programme');
        }
        break;
      }
      case 'url':
        if (!/^https?:\/\/[^\s<>"]+$/i.test(v)) errors[f.name] = msg('URL https:// बाट सुरु हुनुपर्छ', 'URL must start with https://');
        break;
      case 'geo':
        if (!/^-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?$/.test(v)) errors[f.name] = msg('अक्षांश, देशान्तर (जस्तै 27.7172, 85.3240)', 'Latitude, longitude (e.g. 27.7172, 85.3240)');
        break;
    }
    if (f.pattern && !errors[f.name] && !f.pattern.test(String(v))) errors[f.name] = msg(`${label} मिलेन`, `Invalid ${label.toLowerCase()}`);
    if (!errors[f.name]) {
      if (f.store === 'aml') aml[f.name] = v; else if (f.store !== 'none') data[f.name] = v;
    }
  }
  if (mod.amlCol) {
    if (aml.income_total || aml.expense_total) aml.net_saving_estimate = Math.round(((aml.income_total || 0) - (aml.expense_total || 0)) * 100) / 100;
    data[mod.amlCol] = Object.keys(aml).length ? JSON.stringify(aml) : null;
  }
  return { data, errors };
}

/** Values to re-fill a form from a stored row (AML JSON, family table, income / expense items). */
function rowToValues(mod, row) {
  const v = { ...row };
  if (mod.amlCol && row[mod.amlCol]) {
    try {
      const aml = JSON.parse(row[mod.amlCol]);
      for (const [k, x] of Object.entries(aml)) if (x !== null && typeof x !== 'object') v[k] = String(x);
      for (const [key, items] of [['income_source', aml.income_items], ['expense_source', aml.expense_items]]) {
        if (Array.isArray(items)) { v[key + '_name'] = items.map(i => i.name || ''); v[key + '_amount'] = items.map(i => String(i.amount ?? '')); }
      }
    } catch { /* not JSON */ }
  }
  if (row.family_details_json) {
    try {
      const fam = JSON.parse(row.family_details_json);
      if (Array.isArray(fam)) { v.family_relation = fam.map(x => x.relation || ''); v.family_member_name = fam.map(x => x.name || ''); v.family_member_phone = fam.map(x => x.phone || ''); }
    } catch { /* ignore */ }
  }
  if (row.permanent_address && row.temporary_address && row.permanent_address.trim() === row.temporary_address.trim()) v.same_as_permanent = '1';
  return v;
}

/** Display rows (label, value) of a stored record — AML JSON flattened, family & money tables separate. */
function displayData(mod, row) {
  let aml = {};
  if (mod.amlCol && row[mod.amlCol]) { try { aml = JSON.parse(row[mod.amlCol]) || {}; } catch { aml = {}; } }
  let family = [];
  if (row.family_details_json) { try { family = JSON.parse(row.family_details_json) || []; } catch { family = []; } }
  const value = f => (f.store === 'aml' ? aml[f.name] : row[f.name]);
  return { aml, family, value, income: aml.income_items || [], expense: aml.expense_items || [] };
}

/** Insert a validated submission. Returns the row (with tracking_id when the module uses one). */
async function insertSubmission(mod, data, extra = {}) {
  const row = { ...data, ...extra };
  pii.encryptFields(mod.table, row, db.currentSchema());
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
  pending: ['प्रक्रियामा पर्खँदै', 'Pending'], paid: ['भुक्तानी भयो', 'Paid'], processing: ['प्रक्रियामा', 'Processing'], in_progress: ['काम हुँदै', 'In progress'],
  approved: ['स्वीकृत', 'Approved'], rejected: ['अस्वीकृत', 'Rejected'], completed: ['सम्पन्न', 'Completed'], disbursed: ['ऋण प्रवाह', 'Disbursed'],
  confirmed: ['निश्चित', 'Confirmed'], cancelled: ['रद्द', 'Cancelled'], resolved: ['समाधान', 'Resolved'], closed: ['बन्द', 'Closed'],
  reviewed: ['हेरियो', 'Reviewed'], shortlisted: ['छनोट सूचीमा', 'Shortlisted'], interviewed: ['अन्तर्वार्ता', 'Interviewed'],
  selected: ['छनोट', 'Selected'], under_review: ['समीक्षामा', 'Under review'], accepted: ['स्वीकार', 'Accepted'],
  expired: ['म्याद सकियो', 'Expired'], paid: ['भुक्तानी भयो', 'Paid'], withdrawn: ['फिर्ता', 'Withdrawn'], cleared: ['फछ्र्यौट', 'Cleared'],
};
const statusLabel = (s, lang = 'np') => (STATUS_LABELS[s] ? STATUS_LABELS[s][lang === 'en' ? 1 : 0] : s);

module.exports = { safeColor, identitySkipped, resolveOptions, validate, insertSubmission, statusesFor, statusLabel, optionSources, rowToValues, displayData, composeAddress, addressValid, normalizeAdDate, DISTRICTS };
