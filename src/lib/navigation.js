'use strict';
/** Public site navigation (static structure + tenant-managed committees and pages). */
const db = require('../db');

const cache = new Map();
const TTL = 30_000;

async function build() {
  const schema = db.currentSchema();
  const hit = cache.get(schema);
  if (hit && Date.now() - hit.at < TTL) return hit.data;

  const [committees, pages, teamMenus] = await Promise.all([
    db.many('SELECT id, name, name_np FROM committee_types WHERE is_active = 1 AND show_in_navbar = 1 ORDER BY display_order, id'),
    db.many(`SELECT slug, title, title_np, title_en, menu_position FROM pages WHERE is_active = 1 AND show_in_menu = 1 ORDER BY menu_order, id`),
    require('./team').navCategories().catch(() => []),
  ]);
  const pageLinks = pos => pages.filter(p => (p.menu_position || 'more') === pos)
    .map(p => ({ href: '/page/' + encodeURIComponent(p.slug), label: [p.title_np || p.title, p.title_en || p.title] }));

  const data = [
    { label: ['गृहपृष्ठ', 'Home'], href: '/' },
    { label: ['हाम्रो बारेमा', 'About'], href: '/about', children: [
      { href: '/about', label: ['परिचय', 'Introduction'] },
      { href: '/vision-mission', label: ['दृष्टिकोण र लक्ष्य', 'Vision & mission'] },
      { href: '/message/chairman', label: ['अध्यक्षको सन्देश', "Chairperson's message"] },
      { href: '/message/ceo', label: ['प्रमुख कार्यकारीको सन्देश', "CEO's message"] },
      { href: '/team', label: ['कर्मचारी', 'Our team'] },
      ...teamMenus.map(m => ({ href: '/team?menu=' + encodeURIComponent(m.slug), label: [m.name_np || m.name_en, m.name_en || m.name_np] })),
      ...committees.map(c => ({ href: '/committees/' + c.id, label: [c.name_np || c.name, c.name || c.name_np] })),
      { href: '/institutional-profile', label: ['संस्थागत विवरण', 'Institutional profile'] },
      { href: '/reports', label: ['प्रतिवेदन', 'Reports'] },
      { href: '/awards', label: ['सम्मान तथा पुरस्कार', 'Awards'] },
      ...pageLinks('about'),
    ] },
    { label: ['सेवाहरू', 'Services'], href: '/services', children: [
      { href: '/services', label: ['हाम्रा सेवाहरू', 'All services'] },
      { href: '/interest-rates', label: ['ब्याजदर', 'Interest rates'] },
      { href: '/digital-services', label: ['डिजिटल सेवा', 'Digital services'] },
      { href: '/service-centers', label: ['सेवा केन्द्र/शाखा', 'Branches'] },
      { href: '/partner-facilities', label: ['साझेदार सुविधा', 'Partner discounts'] },
      { href: '/marketplace', label: ['सदस्य बजार', 'Member marketplace'] },
      ...pageLinks('services'),
    ] },
    { label: ['सदस्य सेवा', 'Apply'], href: '/apply', children: [
      { href: '/apply/account', label: ['खाता खोल्नुहोस्', 'Open account'] },
      { href: '/apply/loan', label: ['ऋण आवेदन', 'Loan application'] },
      { href: '/apply/membership', label: ['सदस्यता', 'Membership'] },
      { href: '/apply/kyc', label: ['अनलाइन KYC', 'Online KYC'] },
      { href: '/apply/appointment', label: ['भेटघाट', 'Appointment'] },
      { href: '/apply/welfare', label: ['कल्याण दाबी', 'Welfare claim'] },
      { href: '/apply/grievance', label: ['गुनासो', 'Grievance'] },
      { href: '/track', label: ['आवेदनको स्थिति', 'Track application'] },
    ] },
    { label: ['सूचना', 'Updates'], href: '/notices', children: [
      { href: '/notices', label: ['सूचना', 'Notices'] },
      { href: '/news', label: ['समाचार', 'News'] },
      { href: '/downloads', label: ['डाउनलोड', 'Downloads'] },
      { href: '/gallery', label: ['ग्यालरी', 'Gallery'] },
      { href: '/careers', label: ['रोजगारी', 'Careers'] },
      { href: '/auctions', label: ['लिलाम', 'Auctions'] },
      { href: '/elections', label: ['निर्वाचन', 'Elections'] },
      { href: '/programs', label: ['कार्यक्रम', 'Programmes'] },
      { href: '/calendar', label: ['सहकारी पात्रो', 'Calendar'] },
      ...pageLinks('more'),
    ] },
    { label: ['उपकरण', 'Tools'], href: '/emi-calculator', children: [
      { href: '/emi-calculator', label: ['EMI क्याल्कुलेटर', 'EMI calculator'] },
      { href: '/date-converter', label: ['मिति परिवर्तन', 'Date converter'] },
      { href: '/exchange-rate', label: ['विनिमय दर', 'Exchange rates'] },
      { href: '/verify', label: ['परिचयपत्र प्रमाणीकरण', 'Verify ID card'] },
      { href: '/faqs', label: ['बारम्बार सोधिने प्रश्न', 'FAQs'] },
    ] },
    { label: ['सम्पर्क', 'Contact'], href: '/contact' },
  ];
  cache.set(schema, { at: Date.now(), data });
  return data;
}

async function middleware(req, res, next) {
  try { res.locals.nav = await build(); next(); } catch (e) { next(e); }
}

module.exports = { build, middleware, invalidate: () => cache.delete(db.currentSchema()) };
