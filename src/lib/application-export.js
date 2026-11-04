'use strict';
/**
 * CSV export of application rows. KYC follows admin/kyc-applications.php kycExportRowValues():
 * fixed columns, the linked member's monthly saving, family / income / expense summaries and every
 * AML JSON key as its own column. Other modules export their form fields.
 */
const db = require('../db');
const forms = require('./forms');

const AML_LABELS = {
  passport_no: 'Passport No', pan_no: 'PAN No', driving_license_no: 'Driving License', education_qualification: 'Education', religion: 'Religion', caste: 'Caste',
  occupation_location: 'Occupation Location', occupation_business_name: 'Business Name', business_pan_no: 'Business PAN', business_registration_type: 'Business Reg Type',
  business_registration_no: 'Business Reg No', business_registration_office: 'Business Reg Office', business_registration_date_bs: 'Business Reg Date BS',
  business_nature: 'Business Nature', estimated_annual_income: 'Est Annual Income', politically_exposed: 'PEP', past_crime_declared: 'Past Crime Declared',
  landlord_name: 'Landlord Name', landlord_contact: 'Landlord Contact', is_rented: 'Is Rented', voter_id_card_no: 'Voter ID', polling_station: 'Polling Station',
  member_purpose: 'Member Purpose', self_other_coop_member: 'Other Coop Member', self_other_coop_details: 'Other Coop Details', family_same_coop_member: 'Family Same Coop',
  family_same_coop_details: 'Family Same Coop Details', family_same_member_name: 'Family Member Name', family_same_member_id: 'Family Member ID',
  annual_family_income: 'Annual Family Income', net_worth_details: 'Net Worth', annual_debit_credit_estimate: 'Annual Debit/Credit', annual_turnover_numbers: 'Annual Turnover Count',
  annual_deposit_estimate: 'Annual Deposit Est', institution_debt_estimate: 'Institution Debt Est', nearest_person_name: 'Nearest Person', nearest_person_relation: 'Nearest Relation',
  nominee_name: 'Nominee Name', nominee_dob: 'Nominee DOB', nominee_citizenship_no: 'Nominee Citizenship', nominee_relation: 'Nominee Relation',
  nominee_issue_district: 'Nominee Issue District', nominee_issue_date: 'Nominee Issue Date', nominee_permanent_address: 'Nominee Permanent Addr',
  nominee_temporary_address: 'Nominee Temporary Addr', longitude_latitude: 'Lat/Lng', map_resolved_address: 'Map Address', other_attached_docs: 'Other Attached Docs',
  income_total: 'Income Total', expense_total: 'Expense Total', net_saving_estimate: 'Net Saving Est',
};

const KYC_BASE = [
  ['ID', 'id'], ['Tracking ID', 'tracking_id'], ['Member ID', 'member_id'], ['मासिक बचत', '_monthly_saving'], ['Full Name', 'full_name'], ['Full Name EN', 'full_name_en'],
  ['DOB BS', 'dob_bs'], ['DOB AD', 'dob_ad'], ['Gender', 'gender'], ['Marital Status', 'marital_status'], ['Nationality', 'nationality'],
  ['Mobile', 'mobile'], ['Email', 'email'], ['Permanent Address', 'permanent_address'], ['Temporary Address', 'temporary_address'],
  ['Perm Province', 'permanent_province'], ['Perm District', 'permanent_district'], ['Perm Municipality', 'permanent_municipality'], ['Perm Ward', 'permanent_ward'], ['Perm Tole', 'permanent_tole'],
  ['Temp Province', 'temporary_province'], ['Temp District', 'temporary_district'], ['Temp Municipality', 'temporary_municipality'], ['Temp Ward', 'temporary_ward'], ['Temp Tole', 'temporary_tole'],
  ['Citizenship No', 'citizenship_no'], ['Citizenship Issued Date', 'citizenship_issued_date'], ['Citizenship Issued Place', 'citizenship_issued_place'],
  ['National ID', 'national_id_number'], ['Father Name', 'father_name'], ['Mother Name', 'mother_name'], ['Grandfather Name', 'grandfather_name'], ['Spouse Name', 'spouse_name'],
  ['Occupation', 'occupation'], ['Organization', 'organization_name'], ['Monthly Income', 'monthly_income'], ['Account Type', 'account_type'], ['Branch', 'branch'],
  ['Status', 'status'], ['Risk Category', 'risk_category'], ['Risk Review Status', 'risk_review_status'], ['Want ID Card', '_want_card'],
  ['KYC Verified At', 'kyc_verified_at'], ['Risk Review Due', 'risk_review_due_at'], ['Photo Quality', 'photo_quality_score'],
  ['Family Details', '_family'], ['Income Items', '_income'], ['Expense Items', '_expense'], ['Remarks', 'remarks'], ['Created At', 'created_at'], ['Updated At', 'updated_at'],
];

const monthlySavingLabel = v => (v === 1 || v === '1' ? 'नियमित' : v === 0 || v === '0' ? 'नियमित नभएको' : '');
const moneyItems = items => (Array.isArray(items) ? items.filter(i => i && (i.name || Number(i.amount) > 0))
  .map(i => `${i.name || ''} (Rs. ${Number(i.amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`).join('; ') : '');
const familySummary = json => {
  let fd; try { fd = JSON.parse(json || '[]'); } catch { return ''; }
  return Array.isArray(fd) ? fd.filter(f => f && (f.name || f.relation)).map(f => `${f.relation || ''}: ${f.name || ''}${f.phone ? ` (${f.phone})` : ''}`.trim()).join(' | ') : '';
};

/** One KYC row → { header label: value } (kycExportRowValues). */
function kycRow(row, savings = new Map()) {
  let aml = {};
  try { aml = JSON.parse(row.aml_details_json || '{}') || {}; } catch { aml = {}; }
  const special = {
    tracking_id: row.tracking_id || 'KYC-' + String(row.id).padStart(6, '0'),
    _monthly_saving: monthlySavingLabel(savings.get(String(row.member_id || '').toUpperCase())),
    _want_card: Number(row.want_id_card) ? 'Yes' : 'No',
    _family: familySummary(row.family_details_json), _income: moneyItems(aml.income_items), _expense: moneyItems(aml.expense_items),
  };
  const out = {};
  for (const [label, key] of KYC_BASE) out[label] = key in special ? special[key] : row[key] ?? '';
  for (const [key, label] of Object.entries(AML_LABELS)) { const v = aml[key]; out[label] = v && typeof v === 'object' ? JSON.stringify(v) : v ?? ''; }
  return out;
}

/** { header, values } ready for util.toCsv(header, values). */
async function table(mod, rows) {
  if (mod.key === 'kyc') {
    const savings = new Map();
    const ids = [...new Set(rows.map(r => String(r.member_id || '').toUpperCase()).filter(Boolean))];
    if (ids.length && (await db.columns('members')).has('monthly_saving_regular')) {
      // the monthly saving lives on the linked member (SSOT)
      for (const m of await db.many('SELECT upper(sadasyata_number) AS sid, monthly_saving_regular AS v FROM members WHERE upper(sadasyata_number) = ANY($1) AND deleted_at IS NULL ORDER BY id DESC', [ids])) savings.set(m.sid, m.v);
    }
    return { header: [...KYC_BASE.map(x => x[0]), ...Object.values(AML_LABELS)], values: rows.map(r => kycRow(r, savings)) };
  }
  const options = await forms.resolveOptions(mod);
  const fields = mod.fields.filter(f => !['file', 'image', 'heading', 'family', 'moneyitems', 'address'].includes(f.type) && f.store !== 'none');
  const cols = ['tracking_id', ...fields.map(f => f.name), 'status', mod.remarksCol, mod.noteCol, 'created_at'].filter((c, i, a) => c && a.indexOf(c) === i && (!rows[0] || c in rows[0]));
  const label = c => { const f = fields.find(x => x.name === c); return f ? f.label[1] : c; };
  const seen = new Set();
  const header = cols.map(c => { let l = label(c); if (seen.has(l)) l = `${l} (${c})`; seen.add(l); return l; });
  const values = rows.map(r => Object.fromEntries(cols.map((c, i) => {
    let v = r[c];
    const o = (options[c] || []).find(x => String(x[0]) === String(v));
    if (o) v = o[1];
    return [header[i], v];
  })));
  return { header, values };
}

module.exports = { table, kycRow, AML_LABELS, KYC_BASE };
