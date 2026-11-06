'use strict';
/**
 * Demo data for a cooperative's site: sample notices, news, team, branches, figures, programmes, jobs,
 * success stories … so a new site can be shown or tested before the cooperative's own content exists.
 * Inserted only by a platform operator (console) or `npm run demo:seed -- <slug>`.
 *
 * Every row added is remembered (site setting `demo_data`), so "Remove demo data" deletes exactly those
 * rows and clears only the settings the demo filled — never the cooperative's own content. Settings
 * that already have a value are left alone. Tables the starter design already filled (services,
 * interest rates, FAQ) are only filled when empty.
 */
const db = require('../db');
const settings = require('./settings');

const KEY = 'demo_data';
const day = n => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
const ahead = n => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);

const SETTINGS = {
  phone: '01-4123456', email: 'info@example.coop.np', address: 'काठमाडौं-१०, बानेश्वर', established_year: '२०६५',
  about_short: 'हामी सदस्यहरूको आर्थिक तथा सामाजिक उन्नतिका लागि बचत, ऋण र डिजिटल सेवा उपलब्ध गराउने सहकारी संस्था हौं।',
  about_content: 'हाम्रो सहकारी २०६५ सालमा स्थापना भएको हो।\n\nसदस्य केन्द्रित सेवा, पारदर्शिता र सामुदायिक विकास हाम्रा मूल मान्यता हुन्।',
  vision_content_np: 'सदस्यको आर्थिक समृद्धिमा भरपर्दो साझेदार बन्ने।',
  mission_content_np: 'सरल, सुरक्षित र डिजिटल वित्तीय सेवा उपलब्ध गराउने।',
  chairman_message_np: 'सदस्यहरूको विश्वास नै हाम्रो पुँजी हो। पारदर्शी र सदस्यमैत्री सेवाका लागि हामी सधैं प्रतिबद्ध छौं।',
  ceo_message_np: 'डिजिटल सेवा विस्तार र सदस्य शिक्षामार्फत संस्थालाई अझ बलियो बनाउँदै लैजाने हाम्रो लक्ष्य छ।',
  facebook_url: 'https://facebook.com', youtube_url: 'https://youtube.com',
};

/** table → rows (plain objects; columns a schema lacks are dropped). `onlyIfEmpty` tables are skipped when they hold rows. */
function rows() {
  return [
    { table: 'services', onlyIfEmpty: true, rows: [
      ['नियमित बचत', 'Regular saving', 'दैनिक, मासिक वा आफ्नो सुविधा अनुसार बचत गर्नुहोस् र आकर्षक ब्याज पाउनुहोस्।', 'wallet'],
      ['व्यवसाय ऋण', 'Business loan', 'साना तथा मझौला व्यवसाय सञ्चालन र विस्तारका लागि सहुलियत ऋण।', 'briefcase'],
      ['मोबाइल बैंकिङ', 'Mobile banking', 'घरमै बसेर रकम ट्रान्सफर, बिल भुक्तानी र खाता विवरण।', 'phone'],
      ['मुद्दती बचत', 'Fixed deposit', 'निश्चित अवधिका लागि उच्च ब्याजदरमा बचत।', 'banknote'],
    ].map(([np, en, d, icon], i) => ({ title: np, title_np: np, title_en: en, description: d, description_np: d, icon, is_active: 1, display_order: i })) },
    { table: 'interest_rates', onlyIfEmpty: true, rows: [
      ['saving', 'Regular saving', 'नियमित बचत', 6.5], ['saving', 'Fixed deposit (1 yr)', 'मुद्दती बचत (१ वर्ष)', 9], ['saving', 'Child saving', 'बाल बचत', 7],
      ['loan', 'Business loan', 'व्यवसाय ऋण', 13.5], ['loan', 'Home loan', 'घर ऋण', 12.75], ['loan', 'Education loan', 'शैक्षिक ऋण', 11.5],
    ].map(([category, name, name_np, rate], i) => ({ category, name, name_np, rate, is_active: 1, display_order: i })) },
    { table: 'faqs', onlyIfEmpty: true, rows: [
      { question: 'How do I open an account?', question_np: 'खाता कसरी खोल्ने?', answer: 'Visit any branch with your citizenship certificate and a photo, or apply online.', answer_np: 'नागरिकता प्रमाणपत्र र फोटो लिएर नजिकको शाखामा आउनुहोस्, वा अनलाइन आवेदन दिनुहोस्।', category: 'general', is_active: 1, display_order: 0 },
    ] },
    { table: 'notices', rows: [
      'वार्षिक साधारण सभा सम्बन्धी सूचना', 'दशैं तिहार बिदा सम्बन्धी सूचना', 'ब्याजदर परिवर्तन सम्बन्धी सूचना', 'कर्मचारी पदपूर्ति सम्बन्धी सूचना', 'KYC अद्यावधिक गर्ने सम्बन्धी सूचना',
    ].map((t, i) => ({ title: t, title_np: t, content: t, content_np: t + '। विस्तृत जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोला।', notice_date: day(i * 6), is_active: 1 })) },
    { table: 'news', rows: [
      ['सदस्य शिक्षा कार्यक्रम सम्पन्न', 'कार्यक्रममा ठूलो संख्यामा सदस्यहरूको सहभागिता रह्यो।'],
      ['नयाँ शाखा कार्यालय उद्घाटन', 'सदस्यहरूको सुविधाका लागि नयाँ शाखा सञ्चालनमा आएको छ।'],
      ['मोबाइल एपमा नयाँ सुविधा', 'अब मोबाइल एपबाटै QR भुक्तानी र बिल भुक्तानी गर्न सकिन्छ।'],
    ].map(([t, c]) => ({ title: t, title_np: t, content: c, content_np: t + '। ' + c, is_active: 1 })) },
    { table: 'why_choose_features', rows: [
      ['shield', 'सुरक्षित बचत', 'Safe savings', 'नियामक निकायको मापदण्ड अनुसार सञ्चालन।'],
      ['zap', 'छिटो ऋण', 'Quick loans', 'सरल प्रक्रिया, छिटो स्वीकृति।'],
      ['phone', 'डिजिटल सेवा', 'Digital services', 'मोबाइल एप र QR भुक्तानी।'],
    ].map(([icon, title_np, title_en, desc_np], i) => ({ icon, title_np, title_en, desc_np, is_active: 1, sort_order: i })) },
    { table: 'institutional_profile', rows: [{ fiscal_year: '2082/83', report_month: 6, total_members: 12450, share_capital: 85000000, deposit: 1250000000, loan: 980000000, total_assets: 1500000000, total_loan_members: 3120, npa_percent: 2.4, is_active: 1, access_level: 'none' }] },
    { table: 'service_centers', rows: [
      { name: 'Head Office', name_np: 'केन्द्रीय कार्यालय', address: 'बानेश्वर, काठमाडौं', phone: '01-4123456', opening_hours: 'आइत–शुक्र १०:००–५:००', is_main_branch: 1, is_active: 1, display_order: 0 },
      { name: 'Lalitpur Branch', name_np: 'ललितपुर शाखा', address: 'पुल्चोक, ललितपुर', phone: '01-5523456', opening_hours: 'आइत–शुक्र १०:००–५:००', is_main_branch: 0, is_active: 1, display_order: 1 },
    ] },
    { table: 'team_members', rows: [
      { name: 'रामप्रसाद अधिकारी', name_en: 'Ram Prasad Adhikari', position: 'अध्यक्ष', position_np: 'अध्यक्ष', position_en: 'Chairperson', category: 'board', is_active: 1, display_order: 0 },
      { name: 'गीता थापा', name_en: 'Gita Thapa', position: 'उपाध्यक्ष', position_np: 'उपाध्यक्ष', position_en: 'Vice-chairperson', category: 'board', is_active: 1, display_order: 1 },
      { name: 'सीता शर्मा', name_en: 'Sita Sharma', position: 'प्रमुख कार्यकारी अधिकृत', position_np: 'प्रमुख कार्यकारी अधिकृत', position_en: 'CEO', category: 'management', is_active: 1, is_information_officer: 1, display_order: 2 },
      { name: 'हरि बस्नेत', name_en: 'Hari Basnet', position: 'गुनासो सुन्ने अधिकारी', position_np: 'गुनासो सुन्ने अधिकारी', position_en: 'Grievance officer', category: 'management', is_active: 1, is_grievance_officer: 1, display_order: 3 },
    ] },
    { table: 'careers', rows: [{ title: 'Credit officer', title_np: 'ऋण अधिकृत', department: 'ऋण विभाग', location: 'काठमाडौं', job_type: 'full_time', description: 'Appraise and follow up member loans.', description_np: 'सदस्य ऋणको मूल्याङ्कन र अनुगमन।', requirements: 'स्नातक (व्यवस्थापन), २ वर्ष अनुभव', deadline: ahead(21), vacancies: 2, allow_online_apply: 1, is_active: 1 }] },
    { table: 'upcoming_programs', rows: [
      { title: 'सदस्य शिक्षा कार्यक्रम', program_type: 'Training', description: 'बचत, ऋण र डिजिटल सेवाबारे सदस्य शिक्षा।', event_date: ahead(10), event_time: '११:००', location: 'केन्द्रीय कार्यालय, बानेश्वर', is_active: 1 },
      { title: 'वार्षिक साधारण सभा', program_type: 'AGM', description: 'आर्थिक वर्षको वार्षिक साधारण सभा।', event_date: ahead(30), event_time: '१०:००', location: 'सभा हल, काठमाडौं', is_active: 1 },
    ] },
    { table: 'member_success_stories', rows: [{ member_name: 'कमला गुरुङ', member_name_en: 'Kamala Gurung', member_since: '२०७०', location: 'पोखरा', location_en: 'Pokhara', profession: 'तरकारी व्यवसायी', profession_en: 'Vegetable trader', headline_np: 'सानो ऋणबाट ठूलो व्यवसाय', headline_en: 'From a small loan to a thriving business', story_np: 'सहकारीको व्यवसाय ऋणबाट सुरु गरेको तरकारी पसल आज तीन जनालाई रोजगारी दिने व्यवसाय बनेको छ।', story_en: 'A vegetable stall started with a small business loan now employs three people.', is_active: 1, display_order: 0 }] },
  ];
}

const DEMO_TABLES = new Set(rows().map(g => g.table));

const existing = async () => {
  const cols = await db.columns('site_settings');
  if (!cols.size) return null;
  const raw = await db.value('SELECT setting_value FROM site_settings WHERE setting_key = $1', [KEY]);
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
};

/** Status inside the tenant's schema: { present, rows, at } */
async function status() {
  const s = await existing();
  if (!s) return { present: false, rows: 0, at: null };
  return { present: true, rows: Object.values(s.rows || {}).reduce((a, l) => a + l.length, 0), at: s.at || null };
}

/** Insert the demo data (call inside db.withSchema). Refuses when demo data is already present. */
async function insert() {
  if (await existing()) throw new Error('Demo data is already in this site — remove it first.');
  const track = { at: new Date().toISOString(), rows: {}, settings: {} };
  await db.transaction(async () => {
    for (const [k, v] of Object.entries(SETTINGS)) {
      const cur = await db.value('SELECT setting_value FROM site_settings WHERE setting_key = $1', [k]);
      if (cur) continue;
      await settings.set(k, v);
      track.settings[k] = v;
    }
    for (const group of rows()) {
      const cols = await db.columns(group.table);
      if (!cols.size) continue;
      if (group.onlyIfEmpty && Number(await db.value(`SELECT count(*) FROM ${db.ident(group.table)}`))) continue;
      for (const r of group.rows) {
        const data = await db.pick(group.table, r);
        if (!Object.keys(data).length) continue;
        const row = await db.insert(group.table, data);
        (track.rows[group.table] = track.rows[group.table] || []).push(row.id);
      }
    }
    await settings.set(KEY, JSON.stringify(track), { type: 'textarea', label: 'Demo data (rows added by the platform)', group: 'system' });
  });
  settings.invalidate();
  return { rows: Object.values(track.rows).reduce((a, l) => a + l.length, 0), settings: Object.keys(track.settings).length };
}

/** Remove exactly what insert() added (call inside db.withSchema). */
async function remove() {
  const s = await existing();
  if (!s) throw new Error('This site has no demo data.');
  let removed = 0;
  await db.transaction(async () => {
    for (const [table, ids] of Object.entries(s.rows || {})) {
      if (!DEMO_TABLES.has(table) || !Array.isArray(ids) || !ids.length) continue; // only tables the demo writes
      const cols = await db.columns(table);
      if (!cols.size) continue;
      removed += (await db.query(`DELETE FROM ${db.ident(table)} WHERE id = ANY($1::int[])`, [ids.map(Number).filter(Number.isInteger)])).rowCount;
    }
    // settings: clear only the ones still holding the demo value (the cooperative may have edited them)
    for (const [k, v] of Object.entries(s.settings || {})) {
      await db.query("UPDATE site_settings SET setting_value = '' WHERE setting_key = $1 AND setting_value = $2", [k, v]);
    }
    await db.query('DELETE FROM site_settings WHERE setting_key = $1', [KEY]);
  });
  settings.invalidate();
  return { rows: removed };
}

module.exports = { insert, remove, status, KEY };
