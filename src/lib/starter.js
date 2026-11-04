'use strict';
/**
 * Starter designs: a new tenant is born with a complete, good-looking site instead of an empty shell.
 * Each design = theme (palette/mode/colour) + Nepal-specific starter content for that kind of institution.
 * Everything is ordinary content — the cooperative edits or deletes it from the admin panel.
 * No fake people or fake figures are created (committee members, financial statistics stay empty).
 */
const db = require('../db');
const settings = require('./settings');

const COMMON_FAQ = [
  ['सदस्य बन्न के-के कागजात चाहिन्छ?', 'What documents are needed to become a member?',
    'नागरिकता प्रमाणपत्रको प्रतिलिपि, हालसालै खिचेको फोटो, र कार्यक्षेत्रभित्र बसोबास भएको प्रमाण। अनलाइन सदस्यता आवेदन पनि दिन सकिन्छ।',
    'A copy of your citizenship certificate, a recent photo and proof of residence within the working area. You can also apply online.'],
  ['बचतमा ब्याज कसरी गणना हुन्छ?', 'How is interest on savings calculated?',
    'दैनिक मौज्दातको आधारमा ब्याज गणना गरी त्रैमासिक रूपमा खातामा जम्मा गरिन्छ। हालको ब्याजदर "ब्याजदर" पृष्ठमा हेर्नुहोस्।',
    'Interest is calculated on the daily balance and credited quarterly. See the Interest rates page for current rates.'],
  ['ऋण आवेदनको स्थिति कसरी थाहा पाउने?', 'How can I check my loan application?',
    'आवेदन दिँदा पाउनुभएको ट्र्याकिङ नम्बर "आवेदनको स्थिति" पृष्ठमा राखेर कुनै पनि बेला हेर्न सकिन्छ। स्थिति परिवर्तन हुँदा SMS पनि आउँछ।',
    'Enter the tracking number you received on the Application status page. You also get an SMS when the status changes.'],
  ['KYC अद्यावधिक किन गर्नुपर्छ?', 'Why must I update my KYC?',
    'सम्पत्ति शुद्धीकरण निवारण ऐन तथा नियमनकारी निकायको निर्देशन अनुसार सदस्यको विवरण नियमित अद्यावधिक गर्नुपर्छ। अनलाइन KYC फारमबाट घरमै बसेर गर्न सकिन्छ।',
    'Anti-money-laundering law and the regulator require member details to be kept up to date. You can do it from home with the online KYC form.'],
  ['गुनासो कहाँ दिने?', 'Where can I file a grievance?',
    'वेबसाइटको "गुनासो" फारम, कार्यालयको गुनासो पेटिका वा सूचना अधिकारीलाई सिधै सम्पर्क गर्न सक्नुहुन्छ। गुनासोको जवाफ तोकिएको समयभित्र दिइन्छ।',
    'Use the Grievance form on this website, the complaint box at the office, or contact the information officer directly.'],
];

const COOP_COMMITTEES = [
  ['सञ्चालक समिति', 'Board of directors', 1],
  ['लेखा सुपरिवेक्षण समिति', 'Account supervision committee', 1],
  ['ऋण उपसमिति', 'Loan sub-committee', 0],
  ['शिक्षा उपसमिति', 'Education sub-committee', 0],
];
const COOP_LINKS = [
  ['सहकारी विभाग', 'Department of Cooperatives', 'https://deoc.gov.np'],
  ['राष्ट्रिय सहकारी विकास बोर्ड', 'National Cooperative Development Board', 'https://ncdb.gov.np'],
  ['नेपाल राष्ट्र बैंक', 'Nepal Rastra Bank', 'https://www.nrb.org.np'],
  ['विनिमय दर (नेपाल राष्ट्र बैंक)', 'Exchange rates (NRB)', 'https://www.nrb.org.np/forex/'],
];

const SLIDES = {
  saving: ['starter:saving', 'सानो बचत, ठूलो सपना', 'नियमित बचतमा आकर्षक ब्याज'],
  loan: ['starter:loan', 'व्यवसायका लागि सहज ऋण', 'छिटो स्वीकृति, सरल किस्ता'],
  digital: ['starter:digital', 'घरमै बसेर डिजिटल सेवा', 'मोबाइल बैंकिङ, QR भुक्तानी र अनलाइन आवेदन'],
  farm: ['starter:farm', 'किसानको साथमा', 'कृषि ऋण, बीउ-मल र बजार पहुँच'],
  community: ['starter:community', 'समुदायको साथमा', 'सदस्य शिक्षा र सामाजिक कार्यक्रम'],
  women: ['starter:women', 'महिलाको आर्थिक सशक्तीकरण', 'समूह बचत र उद्यम ऋण'],
};

const DESIGNS = {
  saving_credit: {
    layout: { header: 'classic', home: 'split', corners: 'rounded', lang: 'np' },
    np: 'बचत तथा ऋण सहकारी', en: 'Savings & credit cooperative', palette: 'teal', mode: 'system', color: '#0f766e',
    tagline: 'सदस्यको हितमा, समुदायको साथमा',
    about: 'हामी सदस्यहरूको बचत परिचालन गरी सहज ऋण, डिजिटल सेवा र वित्तीय साक्षरतामार्फत आर्थिक उन्नतिमा सहयोग गर्ने सहकारी संस्था हौं।',
    slides: ['saving', 'loan', 'digital'],
    services: [
      ['नियमित बचत', 'Regular saving', 'दैनिक, मासिक वा आफ्नो सुविधा अनुसार बचत गर्नुहोस् र आकर्षक ब्याज पाउनुहोस्।', 'wallet'],
      ['मुद्दती बचत', 'Fixed deposit', 'निश्चित अवधिका लागि उच्च ब्याजदरमा सुरक्षित बचत।', 'banknote'],
      ['बाल बचत', 'Child saving', 'बालबालिकाको भविष्यका लागि सानै उमेरदेखि बचतको बानी।', 'heart'],
      ['व्यवसाय ऋण', 'Business loan', 'साना तथा मझौला व्यवसाय सञ्चालन र विस्तारका लागि सहुलियत ऋण।', 'briefcase'],
      ['शैक्षिक ऋण', 'Education loan', 'उच्च शिक्षाका लागि सहज किस्तामा ऋण।', 'award'],
      ['मोबाइल बैंकिङ', 'Mobile banking', 'रकम ट्रान्सफर, बिल भुक्तानी र खाता विवरण घरमै।', 'phone'],
    ],
    rates: [['saving', 'Regular saving', 'नियमित बचत', 6.5], ['saving', 'Fixed deposit (1 year)', 'मुद्दती बचत (१ वर्ष)', 8.5], ['saving', 'Child saving', 'बाल बचत', 7],
      ['loan', 'Business loan', 'व्यवसाय ऋण', 13.5], ['loan', 'Education loan', 'शैक्षिक ऋण', 12], ['loan', 'Gold / silver loan', 'सुन-चाँदी धितो ऋण', 12.5]],
    features: [['shield', 'सुरक्षित बचत', 'Safe savings', 'सहकारी ऐन, नियमावली र नियामक निकायको मापदण्ड अनुसार सञ्चालन।', 'Run under the Cooperative Act and regulator standards.'],
      ['check', 'छिटो ऋण', 'Fast loans', 'सरल प्रक्रिया र छिटो स्वीकृति।', 'Simple process and quick approval.'],
      ['phone', 'डिजिटल सेवा', 'Digital services', 'मोबाइल एप, QR भुक्तानी र अनलाइन आवेदन।', 'Mobile app, QR payments and online applications.']],
    faqs: [['न्यूनतम कति रकमबाट बचत खाता खोल्न सकिन्छ?', 'What is the minimum to open a savings account?', 'नियमित बचत खाता रु. १०० बाट खोल्न सकिन्छ। विस्तृत जानकारीका लागि कार्यालयमा सम्पर्क गर्नुहोस्।', 'A regular saving account can be opened from Rs. 100.']],
    committees: COOP_COMMITTEES, links: COOP_LINKS,
  },
  multipurpose: {
    layout: { header: 'bar', home: 'banner', corners: 'soft', lang: 'np' },
    np: 'बहुउद्देश्यीय सहकारी', en: 'Multipurpose cooperative', palette: 'ocean', mode: 'system', color: '#0369a1',
    tagline: 'बचत, ऋण र सेवा — एकै ठाउँमा',
    about: 'बचत तथा ऋणका साथै उपभोक्ता पसल, कृषि सामग्री र सामुदायिक सेवा सञ्चालन गर्ने बहुउद्देश्यीय सहकारी संस्था।',
    slides: ['saving', 'community', 'digital'],
    services: [
      ['नियमित बचत', 'Regular saving', 'सदस्यका लागि लचिलो बचत योजना।', 'wallet'],
      ['मुद्दती बचत', 'Fixed deposit', 'उच्च ब्याजदरमा मुद्दती बचत।', 'banknote'],
      ['व्यवसाय ऋण', 'Business loan', 'सदस्यका उद्यम र व्यवसायका लागि ऋण।', 'briefcase'],
      ['उपभोक्ता पसल', 'Consumer store', 'सदस्यलाई सुपथ मूल्यमा दैनिक उपभोग्य सामग्री।', 'store'],
      ['रेमिट्यान्स', 'Remittance', 'विदेशबाट पठाइएको रकम छिटो र सुरक्षित रूपमा।', 'globe'],
      ['बिमा सेवा', 'Insurance', 'पशु, बाली र जीवन बिमा सहजीकरण।', 'shield'],
    ],
    rates: [['saving', 'Regular saving', 'नियमित बचत', 6], ['saving', 'Fixed deposit (1 year)', 'मुद्दती बचत (१ वर्ष)', 8.5],
      ['loan', 'Business loan', 'व्यवसाय ऋण', 13.5], ['loan', 'Personal loan', 'व्यक्तिगत ऋण', 14]],
    features: [['users', 'सदस्य स्वामित्व', 'Member owned', 'सदस्यद्वारा, सदस्यका लागि सञ्चालित।', 'Owned and run by members.'],
      ['store', 'बहुसेवा', 'Many services', 'बचत-ऋणदेखि उपभोक्ता पसलसम्म।', 'From savings to the consumer store.'],
      ['heart', 'सामुदायिक विकास', 'Community', 'नाफाको अंश सामुदायिक कार्यमा।', 'Part of the surplus goes to the community.']],
    faqs: [], committees: COOP_COMMITTEES, links: COOP_LINKS,
  },
  agriculture: {
    layout: { header: 'bar', home: 'banner', corners: 'soft', lang: 'np' },
    np: 'कृषि सहकारी', en: 'Agriculture cooperative', palette: 'forest', mode: 'light', color: '#15803d',
    tagline: 'किसानको हितमा, कृषिको विकासमा',
    about: 'किसान सदस्यलाई कृषि ऋण, बीउ-मल, प्राविधिक सेवा र उत्पादनको बजार पहुँच उपलब्ध गराउने कृषि सहकारी।',
    slides: ['farm', 'saving', 'community'],
    services: [
      ['कृषि ऋण', 'Agriculture loan', 'खेती, पशुपालन र कृषि व्यवसायका लागि सहुलियत ऋण।', 'banknote'],
      ['बीउ-मल आपूर्ति', 'Seeds & fertiliser', 'गुणस्तरीय बीउ, मल र कृषि सामग्री सुपथ मूल्यमा।', 'store'],
      ['सामूहिक बजारीकरण', 'Collective marketing', 'सदस्यका उत्पादन संकलन र उचित मूल्यमा बिक्री।', 'chart'],
      ['पशु तथा बाली बिमा', 'Livestock & crop insurance', 'सरकारी अनुदानसहित बिमा सहजीकरण।', 'shield'],
      ['कृषक बचत', 'Farmer saving', 'बाली भित्र्याउने समय अनुसार लचिलो बचत।', 'wallet'],
      ['प्राविधिक सेवा', 'Technical support', 'कृषि प्राविधिकबाट तालिम र परामर्श।', 'users'],
    ],
    rates: [['saving', 'Farmer saving', 'कृषक बचत', 6.5], ['saving', 'Fixed deposit (1 year)', 'मुद्दती बचत (१ वर्ष)', 8],
      ['loan', 'Agriculture loan', 'कृषि ऋण', 11], ['loan', 'Livestock loan', 'पशुपालन ऋण', 11.5]],
    features: [['heart', 'किसान केन्द्रित', 'Farmer first', 'किसानको आवश्यकता अनुसार सेवा।', 'Services built around farmers.'],
      ['store', 'बजार पहुँच', 'Market access', 'उत्पादनको उचित मूल्य।', 'Fair prices for produce.'],
      ['shield', 'बिमा सुरक्षा', 'Insurance', 'बाली र पशुको जोखिम न्यूनीकरण।', 'Lower risk for crops and livestock.']],
    faqs: [['कृषि ऋणमा अनुदान पाइन्छ?', 'Is there a subsidy on agriculture loans?', 'सरकारको सहुलियतपूर्ण कर्जा कार्यक्रम अनुसार योग्य परियोजनामा ब्याज अनुदान सहजीकरण गरिन्छ।', 'Eligible projects can get interest subsidy under the government concessional loan programme.']],
    committees: COOP_COMMITTEES, links: COOP_LINKS.concat([['कृषि तथा पशुपन्छी विकास मन्त्रालय', 'Ministry of Agriculture', 'https://moald.gov.np']]),
  },
  women: {
    layout: { header: 'centered', home: 'centered', corners: 'rounded', lang: 'np' },
    np: 'महिला सहकारी', en: "Women's cooperative", palette: 'rose', mode: 'light', color: '#be123c',
    tagline: 'महिलाको बचत, महिलाको शक्ति',
    about: 'महिला सदस्यहरूको बचत परिचालन, उद्यमशीलता र आर्थिक सशक्तीकरणका लागि स्थापित सहकारी संस्था।',
    slides: ['women', 'saving', 'community'],
    services: [
      ['समूह बचत', 'Group saving', 'आमा समूह तथा महिला समूहमार्फत नियमित बचत।', 'users'],
      ['उद्यम ऋण', 'Enterprise loan', 'साना घरेलु उद्यम सुरु गर्न सहज ऋण।', 'briefcase'],
      ['सीप विकास तालिम', 'Skill training', 'सिलाइ, बुनाइ, खाद्य प्रशोधनलगायत तालिम।', 'award'],
      ['बाल शिक्षा बचत', 'Child education saving', 'छोराछोरीको पढाइका लागि बचत योजना।', 'heart'],
      ['मुद्दती बचत', 'Fixed deposit', 'उच्च ब्याजदरमा सुरक्षित बचत।', 'banknote'],
      ['मोबाइल बैंकिङ', 'Mobile banking', 'घरमै बसेर कारोबार।', 'phone'],
    ],
    rates: [['saving', 'Group saving', 'समूह बचत', 7], ['saving', 'Fixed deposit (1 year)', 'मुद्दती बचत (१ वर्ष)', 8.5],
      ['loan', 'Enterprise loan', 'उद्यम ऋण', 12], ['loan', 'Education loan', 'शैक्षिक ऋण', 12]],
    features: [['users', 'महिला नेतृत्व', 'Women-led', 'सञ्चालनदेखि सेवासम्म महिला नेतृत्व।', 'Women lead from the board to the counter.'],
      ['briefcase', 'उद्यमशीलता', 'Enterprise', 'सीप, ऋण र बजार एकै ठाउँमा।', 'Skills, credit and markets together.'],
      ['heart', 'परिवारको भविष्य', 'Family future', 'बाल शिक्षा र स्वास्थ्य बचत।', 'Saving for education and health.']],
    faqs: [], committees: COOP_COMMITTEES, links: COOP_LINKS,
  },
  microfinance: {
    layout: { header: 'classic', home: 'banner', corners: 'square', lang: 'np' },
    np: 'लघुवित्त वित्तीय संस्था', en: 'Microfinance institution', palette: 'indigo', mode: 'system', color: '#4f46e5',
    tagline: 'विपन्न वर्गको आर्थिक उन्नतिमा साझेदार',
    about: 'नेपाल राष्ट्र बैंकबाट इजाजतप्राप्त "घ" वर्गको लघुवित्त वित्तीय संस्था — समूह जमानीमा लघु कर्जा, बचत र वित्तीय साक्षरता।',
    slides: ['women', 'loan', 'digital'],
    services: [
      ['समूह जमानी लघु कर्जा', 'Group-guaranteed micro loan', 'धितो बिना समूह जमानीमा साना व्यवसायका लागि कर्जा।', 'users'],
      ['लघु उद्यम कर्जा', 'Micro-enterprise loan', 'स्थापित उद्यम विस्तारका लागि ठूलो लघु कर्जा।', 'briefcase'],
      ['अनिवार्य तथा ऐच्छिक बचत', 'Compulsory & voluntary saving', 'केन्द्र बैठकमा नियमित बचत।', 'wallet'],
      ['लघु बिमा', 'Micro insurance', 'कर्जा, पशु र स्वास्थ्य लघु बिमा।', 'shield'],
      ['वित्तीय साक्षरता', 'Financial literacy', 'बचत, ऋण व्यवस्थापन र उद्यम तालिम।', 'award'],
      ['डिजिटल कारोबार', 'Digital transactions', 'मोबाइल वालेट र QR मार्फत किस्ता भुक्तानी।', 'phone'],
    ],
    rates: [['saving', 'Compulsory saving', 'अनिवार्य बचत', 6], ['saving', 'Voluntary saving', 'ऐच्छिक बचत', 6.5],
      ['loan', 'Group micro loan', 'समूह जमानी लघु कर्जा', 14.75], ['loan', 'Micro-enterprise loan', 'लघु उद्यम कर्जा', 14.5]],
    features: [['shield', 'नियमित र इजाजतप्राप्त', 'Licensed & regulated', 'नेपाल राष्ट्र बैंकको निर्देशन अनुसार सञ्चालित।', 'Operates under Nepal Rastra Bank directives.'],
      ['users', 'केन्द्र बैठक', 'Centre meetings', 'गाउँ-टोलमै सेवा।', 'Service in your village.'],
      ['heart', 'ग्राहक संरक्षण', 'Client protection', 'पारदर्शी ब्याज र गुनासो सुनुवाइ।', 'Transparent pricing and grievance handling.']],
    faqs: [['लघुवित्तको ब्याजदरको सीमा कति छ?', 'Is there a cap on microfinance interest rates?', 'नेपाल राष्ट्र बैंकले तोकेको सीमाभित्र रहेर ब्याजदर निर्धारण गरिन्छ। हालको दर "ब्याजदर" पृष्ठमा प्रकाशित छ।', 'Rates are set within the cap fixed by Nepal Rastra Bank and published on the Interest rates page.'],
      ['कर्जाका लागि धितो चाहिन्छ?', 'Do I need collateral?', 'समूह जमानी कर्जामा धितो चाहिँदैन। लघु उद्यम कर्जामा रकम अनुसार धितो लिइन सक्छ।', 'Group-guaranteed loans need no collateral; micro-enterprise loans may, depending on the amount.']],
    committees: [['सञ्चालक समिति', 'Board of directors', 1], ['लेखापरीक्षण समिति', 'Audit committee', 1], ['जोखिम व्यवस्थापन समिति', 'Risk management committee', 0], ['सम्पत्ति शुद्धीकरण निवारण समिति', 'AML/CFT committee', 0]],
    links: [['नेपाल राष्ट्र बैंक', 'Nepal Rastra Bank', 'https://www.nrb.org.np'], ['कर्जा सूचना केन्द्र', 'Credit Information Bureau', 'https://www.cibnepal.org.np'],
      ['वित्तीय जानकारी इकाई', 'Financial Information Unit', 'https://www.nrb.org.np/fiu/'], ['विनिमय दर (नेपाल राष्ट्र बैंक)', 'Exchange rates (NRB)', 'https://www.nrb.org.np/forex/']],
  },
};

const list = () => Object.entries(DESIGNS).map(([key, d]) => ({ key, np: d.np, en: d.en, palette: d.palette, color: d.color, tagline: d.tagline }));

/**
 * Apply a design to the CURRENT tenant schema (call inside db.withSchema).
 * @param {string} key design key
 * @param {{content?: boolean, name?: string}} opts content=false applies only the look
 */
async function apply(key, { content = true } = {}) {
  const d = DESIGNS[key] || DESIGNS.saving_credit;
  const set = (k, v, meta) => settings.set(k, v, meta);
  await set('primary_color', d.color, { type: 'color', label: 'Brand colour', group: 'theme' });
  await set('theme_default_palette', 'brand', { group: 'appearance', label: 'Default theme palette' });
  await set('theme_default_mode', d.mode, { group: 'appearance', label: 'Default theme mode' });
  await set('starter_design', key, { group: 'appearance', label: 'Starter design' });
  await set('layout_header', d.layout.header, { group: 'appearance', label: 'Menu placement' });
  await set('layout_home', d.layout.home, { group: 'appearance', label: 'Home page style' });
  await set('layout_corners', d.layout.corners, { group: 'appearance', label: 'Corner style' });
  await set('lang_default', d.layout.lang, { group: 'appearance', label: 'Default language' });
  // microfinance institutions are regulated by Nepal Rastra Bank; cooperatives by the cooperative regulator
  await set('protection_regulator', key === 'microfinance' ? 'nrb' : 'coop', { group: 'protection', label: 'Regulator (coop | nrb)' });
  if (!content) return;

  const s = await settings.all();
  if (!s.site_tagline || s.site_tagline === 'सदस्यको हितमा, समुदायको साथमा') await set('site_tagline', d.tagline, { group: 'general', label: 'Tagline' });
  if (!s.about_short) await set('about_short', d.about, { type: 'textarea', group: 'about', label: 'Short introduction' });
  if (!s.working_hours) await set('working_hours', 'आइतबार–शुक्रबार, १०:०० – ५:००', { group: 'contact', label: 'Working hours' });

  const empty = async t => !Number(await db.value(`SELECT count(*) FROM ${t}`));
  if (await empty('sliders')) {
    for (const [i, k] of d.slides.entries()) {
      const [image, title, subtitle] = SLIDES[k];
      await db.insert('sliders', { title, subtitle, image, is_active: 1, display_order: i });
    }
  }
  if (await empty('services')) {
    for (const [i, [np, en, desc, icon]] of d.services.entries()) {
      await db.insert('services', { title: np, title_np: np, title_en: en, description: desc, description_np: desc, icon, is_active: 1, display_order: i });
    }
  }
  if (await empty('interest_rates')) {
    for (const [i, [category, name, np, rate]] of d.rates.entries()) {
      await db.insert('interest_rates', { category, name, name_np: np, rate, is_active: 1, display_order: i,
        description_np: 'वार्षिक ब्याजदर (%) — परिवर्तन हुन सक्छ।' });
    }
  }
  if (await empty('why_choose_features')) {
    for (const [i, [icon, tnp, ten, dnp, den]] of d.features.entries()) {
      await db.insert('why_choose_features', { icon, title_np: tnp, title_en: ten, desc_np: dnp, desc_en: den, is_active: 1, sort_order: i });
    }
  }
  if (await empty('faqs')) {
    for (const [i, [qnp, qen, anp, aen]] of [...d.faqs, ...COMMON_FAQ].entries()) {
      await db.insert('faqs', { question: qen, question_np: qnp, answer: aen, answer_np: anp, category: 'general', is_active: 1, display_order: i });
    }
  }
  if (await empty('committee_types')) {
    const year = new Date().getFullYear() + 57; // approx. current BS year for the tenure label
    for (const [i, [np, en, nav]] of d.committees.entries()) {
      const id = await db.value('INSERT INTO committee_types (name, name_np, is_active, show_in_navbar, display_order) VALUES ($1, $2, 1, $3, $4) RETURNING id', [en, np, nav, i]);
      await db.query(`INSERT INTO committee_tenures (committee_type_id, tenure_name, tenure_name_np, start_date, end_date, is_current, is_active) VALUES ($1, $2, $3, CURRENT_DATE, (CURRENT_DATE + INTERVAL '4 years')::date, 1, 1)`,
        [id, `Current tenure (${year})`, `हालको कार्यकाल (${year})`]);
    }
  }
  if (await empty('important_links')) {
    for (const [i, [np, en, url]] of d.links.entries()) await db.insert('important_links', { title: en, title_np: np, url, icon: 'link', is_active: 1, display_order: i });
  }
  if (await empty('notices')) {
    const today = new Date().toISOString().slice(0, 10);
    await db.insert('notices', { title: 'Our new website', title_np: 'हाम्रो नयाँ वेबसाइट सञ्चालनमा', notice_date: today, is_active: 1,
      content_np: 'सदस्य महानुभावहरूमा, अब खाता खोल्ने, ऋण आवेदन, KYC अद्यावधिक र गुनासो दर्ता अनलाइनबाटै गर्न सकिने व्यहोरा जानकारी गराइन्छ।' });
  }
}

module.exports = { DESIGNS, list, apply, SLIDES };
