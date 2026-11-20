'use strict';
/** Static page index for site search (port of assets/js/search-improved.js SITE_PAGES, with romanised Nepali keywords). */
const PAGES = [
  ['/about', 'हाम्रो बारेमा', 'About us', 'about बारेमा history itihas इतिहास parichay परिचय'],
  ['/services', 'सेवाहरू', 'Services', 'services seva सेवा loan bachat बचत'],
  ['/interest-rates', 'ब्याजदर', 'Interest rates', 'interest byaj ब्याज rate dar दर'],
  ['/notices', 'सूचनाहरू', 'Notices', 'notice suchana सूचना'],
  ['/gallery', 'ग्यालरी', 'Gallery', 'gallery photo taswir तस्बिर video भिडियो'],
  ['/news', 'समाचार', 'News', 'news samachar समाचार'],
  ['/team', 'हाम्रो टिम', 'Our team', 'team staff karmachari कर्मचारी sadasya'],
  ['/careers', 'रोजगारी', 'Careers', 'career job rojgari रोजगारी vacancy jagir जागिर'],
  ['/reports', 'प्रतिवेदन', 'Reports', 'report pratibedan प्रतिवेदन annual monthly'],
  ['/downloads', 'डाउनलोड', 'Downloads', 'download form फारम'],
  ['/faqs', 'प्रश्नोत्तर', 'FAQs', 'faq question prasna प्रश्न'],
  ['/apply/grievance', 'गुनासो', 'Grievance', 'grievance gunaso गुनासो complaint ujuri उजुरी'],
  ['/contact', 'सम्पर्क', 'Contact', 'contact sampark सम्पर्क phone phon फोन address thegana ठेगाना map'],
  ['/apply/kyc', 'अनलाइन केवाइएम', 'Online KYM', 'kyc kym केवाइएम online'],
  ['/apply/loan', 'ऋण आवेदन', 'Loan application', 'loan rin ऋण karja कर्जा apply'],
  ['/emi-calculator', 'EMI क्याल्कुलेटर', 'EMI calculator', 'emi calculator kisti किस्ता'],
  ['/exchange-rate', 'विनिमय दर', 'Exchange rates', 'exchange rate dollar डलर forex'],
  ['/date-converter', 'मिति परिवर्तन', 'Date converter', 'date miti मिति convert'],
  ['/calendar', 'सहकारी पात्रो', 'Calendar', 'calendar patro पात्रो festival chad चाड'],
  ['/apply/account', 'खाता खोल्नुहोस्', 'Open account', 'account khata खाता open'],
  ['/apply/membership', 'सदस्यता', 'Membership', 'membership sadasyata सदस्यता member join'],
  ['/apply/appointment', 'भेटघाट', 'Appointment', 'appointment bhetghat भेटघाट'],
  ['/auctions', 'लिलाम', 'Auctions', 'auction lilami लिलाम'],
  ['/marketplace', 'सदस्य बजार', 'Member marketplace', 'marketplace bazar बजार tarkari falful product utpadan skill sip'],
  ['/digital-services', 'डिजिटल सेवा', 'Digital services', 'digital mobile app banking'],
  ['/track', 'आवेदन ट्र्याक', 'Track application', 'track tracker application awedan आवेदन'],
  ['/service-centers', 'सेवा केन्द्र', 'Branches', 'branch shakha शाखा sewa karyalaya location'],
  ['/apply/welfare', 'सदस्य कल्याण', 'Member welfare', 'welfare kalyan कल्याण'],
  ['/committees', 'समिति', 'Committees', 'committee samiti समिति board sanchalak सञ्चालक'],
  ['/institutional-profile', 'संस्थागत विवरण', 'Institutional profile', 'profile financial bittiya वित्तीय deposit loan'],
  ['/vision-mission', 'दृष्टिकोण र लक्ष्य', 'Vision & mission', 'vision mission drishtikon lakshya'],
  ['/verify', 'परिचयपत्र प्रमाणीकरण', 'Verify ID card', 'verify card parichaypatra'],
  ['/programs', 'कार्यक्रम', 'Programmes', 'program karyakram कार्यक्रम training talim'],
  ['/partner-facilities', 'साझेदार सुविधा', 'Partner discounts', 'partner discount chhut छुट'],
  ['/elections', 'निर्वाचन', 'Elections', 'election nirvachan निर्वाचन vote'],
  ['/success-stories', 'सफलताका कथा', 'Success stories', 'success story katha कथा'],
];

/** Pages whose title or keywords contain every word of the query. */
function match(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(w => w.length >= 2);
  if (!words.length) return [];
  return PAGES.filter(([, np, en, kw]) => {
    const hay = (np + ' ' + en + ' ' + kw).toLowerCase();
    return words.every(w => hay.includes(w));
  }).map(([href, np, en]) => ({ href, label: [np, en] }));
}

module.exports = { PAGES, match };
