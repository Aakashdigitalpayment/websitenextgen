#!/usr/bin/env node
'use strict';
/** Fill a tenant with sample content for local preview:  node scripts/demo-seed.js aakash */
const db = require('../src/db');
const settings = require('../src/lib/settings');

const slug = process.argv[2] || 'aakash';

(async () => {
  const tenant = await db.one('SELECT * FROM platform.tenants WHERE slug = $1', [slug]);
  if (!tenant) throw new Error('tenant not found: ' + slug);
  await db.withSchema(tenant.schema_name, async () => {
    const s = {
      phone: '01-4123456', email: 'info@example.coop.np', address: 'काठमाडौं-१०, बानेश्वर', established_year: '२०६५',
      about_short: 'हामी सदस्यहरूको आर्थिक तथा सामाजिक उन्नतिका लागि बचत, ऋण र डिजिटल सेवा उपलब्ध गराउने सहकारी संस्था हौं।',
      about_content: 'हाम्रो सहकारी २०६५ सालमा स्थापना भएको हो।\n\nसदस्य केन्द्रित सेवा, पारदर्शिता र सामुदायिक विकास हाम्रा मूल मान्यता हुन्।',
      vision_content_np: 'सदस्यको आर्थिक समृद्धिमा भरपर्दो साझेदार बन्ने।', mission_content_np: 'सरल, सुरक्षित र डिजिटल वित्तीय सेवा उपलब्ध गराउने।',
      facebook_url: 'https://facebook.com', youtube_url: 'https://youtube.com',
    };
    for (const [k, v] of Object.entries(s)) await settings.set(k, v);
    const count = await db.value('SELECT count(*) FROM services');
    if (count) return;
    const services = [
      ['नियमित बचत', 'Regular saving', 'दैनिक, मासिक वा आफ्नो सुविधा अनुसार बचत गर्नुहोस् र आकर्षक ब्याज पाउनुहोस्।'],
      ['व्यवसाय ऋण', 'Business loan', 'साना तथा मझौला व्यवसाय सञ्चालन र विस्तारका लागि सहुलियत ऋण।'],
      ['मोबाइल बैंकिङ', 'Mobile banking', 'घरमै बसेर रकम ट्रान्सफर, बिल भुक्तानी र खाता विवरण।'],
      ['मुद्दती बचत', 'Fixed deposit', 'निश्चित अवधिका लागि उच्च ब्याजदरमा बचत।'],
      ['शैक्षिक ऋण', 'Education loan', 'उच्च शिक्षाका लागि सहज किस्तामा ऋण।'],
      ['रेमिट्यान्स', 'Remittance', 'विदेशबाट पठाइएको रकम छिटो र सुरक्षित रूपमा।'],
    ];
    for (const [i, [np, en, d]] of services.entries()) {
      await db.insert('services', { title: np, title_np: np, title_en: en, description: d, description_np: d, is_active: 1, display_order: i });
    }
    const rates = [['saving', 'Regular saving', 'नियमित बचत', 6.5], ['saving', 'Fixed deposit (1 yr)', 'मुद्दती बचत (१ वर्ष)', 9], ['saving', 'Child saving', 'बाल बचत', 7], ['loan', 'Business loan', 'व्यवसाय ऋण', 13.5], ['loan', 'Home loan', 'घर ऋण', 12.75], ['loan', 'Education loan', 'शैक्षिक ऋण', 11.5]];
    for (const [i, [c, n, np, r]] of rates.entries()) await db.insert('interest_rates', { category: c, name: n, name_np: np, rate: r, is_active: 1, display_order: i });
    const notices = ['३२औं वार्षिक साधारण सभा सम्बन्धी सूचना', 'दशैं तिहार बिदा सम्बन्धी सूचना', 'ब्याजदर परिवर्तन सम्बन्धी सूचना', 'कर्मचारी पदपूर्ति सम्बन्धी सूचना'];
    for (const [i, n] of notices.entries()) {
      await db.insert('notices', { title: n, title_np: n, content_np: n + '। विस्तृत जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोला।', notice_date: new Date(Date.now() - i * 6 * 86400_000).toISOString().slice(0, 10), is_active: 1 });
    }
    const news = ['सदस्य शिक्षा कार्यक्रम सम्पन्न', 'नयाँ शाखा कार्यालय उद्घाटन', 'मोबाइल एपमा नयाँ सुविधा'];
    for (const n of news) await db.insert('news', { title: n, title_np: n, content_np: n + '। कार्यक्रममा ठूलो संख्यामा सदस्यहरूको सहभागिता रह्यो।', is_active: 1 });
    const feats = [['सुरक्षित बचत', 'नियामक निकायको मापदण्ड अनुसार सञ्चालन।'], ['छिटो ऋण', 'सरल प्रक्रिया, छिटो स्वीकृति।'], ['डिजिटल सेवा', 'मोबाइल एप र QR भुक्तानी।']];
    for (const [i, [tt, d]] of feats.entries()) await db.insert('why_choose_features', { title_np: tt, desc_np: d, is_active: 1, sort_order: i });
    await db.insert('institutional_profile', { fiscal_year: '2082/83', report_month: 6, total_members: 12450, share_capital: 85000000, deposit: 1250000000, loan: 980000000, total_assets: 1500000000, is_active: 1, access_level: 'none' });
    await db.insert('service_centers', { name: 'Head Office', name_np: 'केन्द्रीय कार्यालय', address: 'बानेश्वर, काठमाडौं', phone: '01-4123456', is_main_branch: 1, is_active: 1 });
    await db.insert('team_members', { name: 'रामप्रसाद अधिकारी', name_en: 'Ram Prasad Adhikari', position: 'अध्यक्ष', position_en: 'Chairperson', category: 'board', is_active: 1 });
    await db.insert('team_members', { name: 'सीता शर्मा', name_en: 'Sita Sharma', position: 'प्रमुख कार्यकारी अधिकृत', position_en: 'CEO', category: 'management', is_active: 1, is_information_officer: 1 });
  });
  console.log('✓ demo content added to', slug);
  await db.pool.end();
})().catch(async e => { console.error(e.message); await db.pool.end(); process.exit(1); });
