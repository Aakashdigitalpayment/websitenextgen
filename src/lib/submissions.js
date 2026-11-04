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
    } else if (!ctx.member && !d.email) {
      return fail(ctx.lang, ['इमेल ठेगाना अनिवार्य छ।', 'Email address is required.'], 'email');
    }
    if (!/^\d{10}$/.test(kym.normalizeMobile(d.phone))) return fail(ctx.lang, ['कृपया १० अंकको मोबाइल नम्बर राख्नुहोस्।', 'Please enter a valid 10-digit mobile number.'], 'phone');
    return null;
  },

  /** welfare-claims-submit-helper.php: Nepali type label, portal member id. */
  async welfare(ctx) {
    const opt = (ctx.options.claim_type || []).find(o => String(o[0]) === String(ctx.data.claim_type));
    ctx.extra.claim_type_np = opt ? opt[1] : null;
    if (ctx.member) ctx.extra.member_portal_id = ctx.member.id;
    if (ctx.data.attachment_path) ctx.extra.supporting_documents = ctx.data.attachment_path;
    return null;
  },

  /** digital-service-submit-helper.php: Nepali service label. */
  async digital(ctx) {
    const opt = (ctx.options.service_type || []).find(o => String(o[0]) === String(ctx.data.service_type));
    ctx.extra.service_type_np = opt ? opt[1] : null;
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

/**
 * Validate-and-save for one module. Returns { row, notice, duplicate } or { errors }.
 * The caller has already run forms.validate().
 */
async function submit(mod, data, { body = {}, member = null, options = {}, lang = 'np', extra = {} } = {}) {
  const ctx = { mod, data, body, member, options, lang, extra };
  const hook = hooks[mod.key];
  const out = hook ? await hook(ctx) : null;
  if (out && (out.errors || out.row)) return out;
  const row = await forms.insertSubmission(mod, data, extra);
  return { row };
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

module.exports = { submit, details, hooks };
