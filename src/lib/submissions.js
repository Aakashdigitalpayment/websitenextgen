'use strict';
/**
 * Per-module submit rules on top of the generic form engine (src/lib/forms.js) — the parts of the
 * PHP submit helpers that are not plain field validation.
 */
const db = require('../db');
const forms = require('./forms');
const kym = require('./kym');
const util = require('./util');

/** Bilingual error → form error object. */
const fail = (lang, [np, en], field = '_upload') => ({ errors: { [field]: lang === 'en' ? en : np } });

const hooks = {
  /** online-kyc.php: Member ID + mobile gate, update the existing KYM of the same Member ID. */
  async kyc(ctx) {
    const r = await kym.submit(ctx.mod, ctx.data, { member: ctx.member, body: ctx.body });
    if (r.error) return fail(ctx.lang, r.error);
    return { row: r.row, notice: r.updated ? ['तपाईंको केवाइएम अद्यावधिक भयो।', 'Your KYM has been updated.'] : null };
  },

  /** includes/membership-applications.php membershipCreateRequest: 10-digit mobile, soft duplicate. */
  async membership(ctx) {
    const mobile = kym.normalizeMobile(ctx.data.mobile);
    if (!/^\d{10}$/.test(mobile)) return fail(ctx.lang, ['१० अंकको मोबाइल नम्बर राख्नुहोस्।', 'Enter a 10-digit mobile number.'], 'mobile');
    ctx.data.mobile = mobile;
    if (ctx.data.email) ctx.data.email = String(ctx.data.email).toLowerCase();
    const dup = await db.one("SELECT id, tracking_id FROM membership_applications WHERE mobile = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1", [mobile]);
    if (dup) {
      // the existing tracking ID is NOT shown (it is half of the tracker's two factors); the applicant has it by SMS/email
      return { row: { ...dup, tracking_id: null }, duplicate: true, notice: ['यही मोबाइलमा पेन्डिङ अनुरोध पहिले नै छ। पहिले पाएको SMS/इमेलको Tracking ID प्रयोग गर्नुहोस् वा कार्यालयमा सम्पर्क गर्नुहोस्।', 'A pending request with this mobile already exists. Use the tracking ID from your earlier SMS/email, or contact the office.'] };
    }
    return null;
  },

  /** appointment-submit-helper.php: member visit vs cooperative / organisation visit. */
  async appointment(ctx) {
    const d = ctx.data;
    d.visit_kind = d.visit_kind === 'cooperative' ? 'cooperative' : 'member';
    if (d.visit_kind === 'cooperative') {
      if (!d.purpose_detail) return fail(ctx.lang, ['कृपया भ्रमण विवरण भर्नुहोस्।', 'Please enter visit details.'], 'purpose_detail');
      d.purpose = 'other';
      d.member_id = null;
      if (d.organization_name) { d.contact_person = d.contact_person || d.name; d.name = d.organization_name; } // appointment.php organization_name → name
    } else if (!ctx.member && !d.email) {
      return fail(ctx.lang, ['इमेल ठेगाना अनिवार्य छ।', 'Email address is required.'], 'email');
    }
    if (!/^\d{10}$/.test(kym.normalizeMobile(d.phone))) return fail(ctx.lang, ['कृपया १० अंकको मोबाइल नम्बर राख्नुहोस्।', 'Please enter a valid 10-digit mobile number.'], 'phone');
    return null;
  },

  /** grievance.php: an anonymous grievance may leave the name empty (mobile and email stay required). */
  async grievance(ctx) {
    if (!ctx.data.name) ctx.data.name = 'गोप्य';
    return null;
  },

  /** welfare-claims-submit-helper.php: Nepali type label, portal member id. */
  async welfare(ctx) {
    const opt = (ctx.options.claim_type || []).find(o => String(o[0]) === String(ctx.data.claim_type));
    ctx.extra.claim_type_np = opt ? opt[1] : null;
    if (ctx.member) ctx.extra.member_portal_id = ctx.member.id;
    const docs = [ctx.data.attachment_path, ctx.data.supporting_documents].filter(Boolean).join(',');
    if (docs) ctx.extra.supporting_documents = docs;
    return null;
  },

  /** digital-service-submit-helper.php: Nepali service label. */
  async digital(ctx) {
    const opt = (ctx.options.service_type || []).find(o => String(o[0]) === String(ctx.data.service_type));
    ctx.extra.service_type_np = opt ? opt[1] : null;
    return null;
  },

  /** auction.php: open window (status + end date/time), minimum price, 10-digit mobile, one pending bid per phone per day. */
  async bid(ctx) {
    const d = ctx.data;
    const a = await db.one('SELECT * FROM auction_notices WHERE id = $1', [Number(d.auction_id) || 0]);
    if (!a || !require('./auctions').isOpen(a)) return fail(ctx.lang, ['यो लिलामीमा अहिले बोलपत्र खुला छैन।', 'This auction is not open for bids.'], 'auction_id');
    const phone = kym.normalizeMobile(d.bidder_phone);
    if (!/^9\d{9}$/.test(phone)) return fail(ctx.lang, ['नाम र सही १० अङ्कको मोबाइल (९XXXXXXXXX) आवश्यक।', 'Valid name and 10-digit mobile (9XXXXXXXXX) required.'], 'bidder_phone');
    d.bidder_phone = phone;
    const min = Number(a.minimum_price) || 0;
    if (min > 0 && Number(d.bid_amount) < min) {
      return fail(ctx.lang, [`बोल रकम कम्तीमा रु. ${util.money(min)} हुनुपर्छ।`, `Bid must be at least Rs. ${util.money(min, 'en')}.`], 'bid_amount');
    }
    const dup = await db.value("SELECT 1 FROM auction_bids WHERE auction_id = $1 AND bidder_phone = $2 AND status = 'pending' AND created_at >= now() - interval '24 hours' LIMIT 1", [a.id, phone]);
    if (dup) return fail(ctx.lang, ['पछिल्लो २४ घण्टामा यस लिलामीमा तपाईंको पेन्डिङ बोलपत्र पहिल्यै छ।', 'You already have a pending bid for this auction in the last 24 hours.'], 'bid_amount');
    if (d.bidder_email) d.bidder_email = String(d.bidder_email).toLowerCase();
    return null;
  },

  /** honor-submit-helper.php: self-oriented categories default the nominee to the applicant. */
  async honor(ctx) {
    const opt = (ctx.options.category_id || []).find(o => String(o[0]) === String(ctx.data.category_id));
    if (opt && opt[3] && !opt[3].requires_nominee) {
      if (!ctx.data.nominee_name) ctx.data.nominee_name = ctx.data.applicant_name;
      if (!ctx.data.nominee_relation) ctx.data.nominee_relation = 'आफैं';
    } else if (ctx.data.nominee_name && !ctx.data.nominee_relation) ctx.data.nominee_relation = 'अन्य';
    return null;
  },
};

/** How forms.validate must treat identity fields for this request (see forms.identitySkipped). */
function identityMode(mod, member, body = {}) {
  if (!mod.memberGate) return null;
  if (member) return 'all';
  if (mod.key === 'appointment' && body.visit_kind === 'cooperative') return null;
  if (mod.key === 'grievance' && body.is_anonymous) return null;
  return mod.memberGate.always || body.is_coop_member === 'yes' ? 'personal' : null;
}

/**
 * includes/kyc-public-form.php + member-prefill-block.php: a signed-in member, or a visitor who says they are a member,
 * gets name / Member ID / mobile / email / address / citizenship from the KYM (and the members row) — never from the POST.
 * Services marked `approved` need an approved KYM. Failed Member ID + mobile checks share the login throttle.
 */
async function applyMemberIdentity(ctx) {
  const { mod, data, body, member } = ctx;
  const gate = mod.memberGate;
  if (!gate) return null;
  if (mod.key === 'appointment' && data.visit_kind === 'cooperative') return null;
  const anonymous = mod.key === 'grievance' && Number(data.is_anonymous) === 1;
  let kyc, owner;
  if (member) {
    kyc = await kym.loadLinkedKyc(member);
    owner = member;
    if (gate.approved && !anonymous && kyc?.status !== 'approved') {
      return fail(ctx.lang, ['यो सेवा प्रयोग गर्न तपाईंको केवाइएम स्वीकृत (approved) हुनुपर्छ। पहिले केवाइएम भर्नुहोस् वा कार्यालयमा सम्पर्क गर्नुहोस्।', 'Your KYM must be approved before you can use this service. Please fill in the KYM first or contact the office.']);
    }
  } else if (!anonymous && (gate.always || body.is_coop_member === 'yes')) {
    const auth = require('./auth');
    const id = kym.normalizeId(data[mod.memberCol] || body.member_id);
    const key = 'kycgate:' + (id || '-');
    const field = mod.memberCol || '_upload';
    if (await auth.tooManyAttempts(key, ctx.ip)) return fail(ctx.lang, ['धेरै पटक गलत प्रयास भयो। १५ मिनेटपछि फेरि प्रयास गर्नुहोस्।', 'Too many failed attempts. Try again in 15 minutes.'], field);
    const v = await kym.verifyForForm(id, data[mod.phoneCol], gate);
    if (!v.ok) {
      if (v.mismatch || /No KYC/.test(v.error[1])) await auth.recordFailure(key, ctx.ip);
      return fail(ctx.lang, v.error, v.mismatch ? mod.phoneCol : field);
    }
    await auth.clearFailures(key, ctx.ip);
    kyc = v.kyc;
    owner = v.member;
  } else {
    if (mod.memberCol) data[mod.memberCol] = null; // unverified Member IDs are never stored
    if (mod.guestEmail && !data.email && mod.key !== 'appointment') return fail(ctx.lang, ['इमेल ठेगाना अनिवार्य छ।', 'Email address is required.'], 'email');
    return null;
  }
  const idn = kym.identityFrom(kyc, owner);
  if (idn.name) data[mod.nameCol] = idn.name;
  if (mod.memberCol && idn.member_id) data[mod.memberCol] = idn.member_id;
  if (idn.phone) data[mod.phoneCol] = idn.phone;
  if (!data[mod.phoneCol]) return fail(ctx.lang, ['तपाईंको सदस्य विवरणमा मोबाइल नम्बर छैन। कार्यालयमा सम्पर्क गरी अद्यावधिक गराउनुहोस्।', 'Your member record has no mobile number. Please ask the office to update it.']);
  for (const f of mod.fields) {
    if (!f.identity || f.name === mod.nameCol) continue;
    const v = idn[f.name === 'full_name_en' ? 'name_en' : f.name];
    if (v) {
      data[f.name] = v;
      if (f.adCol && idn[f.adCol]) data[f.adCol] = idn[f.adCol];
    }
  }
  ctx.verified = { kyc, member: owner };
  return null;
}

/**
 * Validate-and-save for one module. Returns { row, notice, duplicate } or { errors }.
 * The caller has already run forms.validate().
 */
async function submit(mod, data, { body = {}, member = null, options = {}, lang = 'np', extra = {}, ip = '' } = {}) {
  const ctx = { mod, data, body, member, options, lang, extra, ip };
  const gated = await applyMemberIdentity(ctx);
  if (gated) return gated;
  const hook = hooks[mod.key];
  const out = hook ? await hook(ctx) : null;
  if (out && (out.errors || out.row)) return out;
  const row = await forms.insertSubmission(mod, data, extra);
  return { row };
}

/** Option label for a stored value: current options, then legacy keys (rows imported from PHP / older versions). */
function optionLabel(f, options, v, lang) {
  const o = [...(options[f.name] || f.options || []), ...(f.legacyOptions || [])].find(x => String(x[0]) === String(v));
  return o ? (lang === 'en' ? o[2] || o[1] : o[1]) : null;
}
/** Titles for option lists that only offer open items (auctions, careers, programmes) — old rows still need a name. */
const LOOKUP = {
  auctions: ['auction_notices', 'title', 'title_en'], careers: ['careers', 'title_np', 'title'], honorPrograms: ['honor_programs', 'title_np', 'title_en'], honorCategories: ['honor_categories', 'name_np', 'name_en'],
};

/**
 * The applicant-facing details grid (application-tracker.php:1065-1130): [[label, value], …] in the visitor's language.
 * Only the module's `track` fields and `trackCols` — never identity documents or files.
 */
async function publicDetails(mod, row, options = {}, lang = 'np') {
  const nd = require('./nepali-date');
  const out = [];
  const L = l => (lang === 'en' ? l[1] : l[0]);
  const fmtDate = v => { const ad = v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10); return nd.formatBs(nd.adToBs(ad), lang) || ad; };
  for (const name of mod.track || []) {
    const f = mod.fields.find(x => x.name === name);
    if (!f || ['file', 'image'].includes(f.type)) continue;
    let v = row[name];
    if (v === null || v === undefined || v === '') continue;
    let label = optionLabel(f, options, v, lang);
    if (!label && LOOKUP[f.optionsFrom]) {
      const [table, np, en] = LOOKUP[f.optionsFrom];
      const r = await db.one(`SELECT ${np} AS np, ${en} AS en FROM ${table} WHERE id = $1`, [Number(v) || 0]);
      if (r) label = lang === 'en' ? r.en || r.np : r.np || r.en;
    }
    if (label) v = label;
    else if (f.format === 'money' || ['loan_amount', 'initial_deposit'].includes(name)) v = (lang === 'en' ? 'Rs. ' : 'रु. ') + util.money(v, lang === 'en' ? 'en' : 'np');
    else if (f.type === 'date') v = fmtDate(v);
    out.push([L(f.label), String(v).slice(0, 300)]);
  }
  for (const [col, label, fmt] of mod.trackCols || []) {
    const v = row[col];
    if (v === null || v === undefined || v === '' || (fmt === 'money' && !Number(v))) continue;
    out.push([L(label), fmt === 'money' ? (lang === 'en' ? 'Rs. ' : 'रु. ') + util.money(v, lang === 'en' ? 'en' : 'np') : fmt === 'date' ? fmtDate(v) : String(v)]);
  }
  return out;
}

/** Progress stepper (T6): each expected stage as done / current / todo; a rejected or cancelled request ends in a red step. */
function stages(mod, status) {
  const list = mod.stages || ['pending', 'processing', 'approved'];
  const s = String(status || 'pending');
  const failed = ['rejected', 'cancelled', 'withdrawn', 'expired'].includes(s);
  let idx = list.indexOf(s);
  if (idx < 0 && !failed) idx = ['completed', 'closed', 'resolved', 'paid', 'disbursed', 'selected', 'accepted'].includes(s) ? list.length - 1 : 0;
  const steps = list.map((k, i) => ({ key: k, state: failed ? (i === 0 ? 'done' : 'todo') : i < idx ? 'done' : i === idx ? (i === list.length - 1 ? 'done' : 'current') : 'todo' }));
  if (failed) steps.push({ key: s, state: 'failed' });
  return steps;
}

/** "key: value" lines for the admin notification (sendAdminNotification $details). */
function details(mod, row, options = {}) {
  const lines = {};
  for (const f of mod.fields) {
    if (!f.show && ![mod.nameCol, mod.phoneCol, 'email', mod.memberCol].includes(f.name)) continue;
    let v = row[f.name];
    if (v === null || v === undefined || v === '') continue;
    const o = (options[f.name] || []).find(x => String(x[0]) === String(v));
    if (o) v = o[1];
    if (f.format === 'money') v = 'Rs. ' + util.money(v);
    lines[f.label[0]] = String(v).slice(0, 120);
  }
  if (row.tracking_id) lines['Tracking ID'] = row.tracking_id;
  return lines;
}

module.exports = { submit, details, hooks, identityMode, applyMemberIdentity, publicDetails, stages, optionLabel };
