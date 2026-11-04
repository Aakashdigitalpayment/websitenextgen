'use strict';
/**
 * Admin CRUD resources — one definition per content table.
 * Field: { name, label:[np,en], type, required, options | ref:{table,label}, list:true, folder }
 * Types: text, textarea, richtext, number, date, datetime, select, bool, image, file, color, url
 */
const T = (name, np, en, extra = {}) => ({ name, label: [np, en], type: 'text', ...extra });
const TA = (name, np, en, extra = {}) => T(name, np, en, { type: 'textarea', ...extra });
const RT = (name, np, en, extra = {}) => T(name, np, en, { type: 'richtext', ...extra });
const N = (name, np, en, extra = {}) => T(name, np, en, { type: 'number', ...extra });
const D = (name, np, en, extra = {}) => T(name, np, en, { type: 'date', ...extra });
const B = (name, np, en, extra = {}) => T(name, np, en, { type: 'bool', ...extra });
const IMG = (name, np = 'फोटो', en = 'Image', extra = {}) => T(name, np, en, { type: 'image', ...extra });
const FILE = (name, np = 'फाइल', en = 'File', extra = {}) => T(name, np, en, { type: 'file', ...extra });
const SEL = (name, np, en, options, extra = {}) => T(name, np, en, { type: 'select', options, ...extra });
const REF = (name, np, en, table, label, extra = {}) => T(name, np, en, { type: 'select', ref: { table, label }, ...extra });
const ACTIVE = B('is_active', 'सक्रिय', 'Active', { default: 1, list: true });
const lazyDb = () => require('../db');

// team_members.category: fixed groups + staff groups (slug) + committees ("cmt_<id>"), like the PHP site
async function teamCategoryOptions() {
  const db = lazyDb();
  const [groups, committees] = await Promise.all([
    db.many('SELECT slug, name_np, name_en FROM team_staff_groups ORDER BY display_order, id'),
    db.many('SELECT id, name, name_np FROM committee_types ORDER BY display_order, id'),
  ]);
  return [['board', 'सञ्चालक समिति', 'Board'], ['management', 'व्यवस्थापन', 'Management'], ['staff', 'कर्मचारी', 'Staff'],
    ...groups.filter(g => !['board', 'management', 'staff'].includes(g.slug)).map(g => [g.slug, g.name_np || g.name_en, g.name_en || g.name_np]),
    ...committees.map(c => ['cmt_' + c.id, c.name_np || c.name, c.name || c.name_np])];
}
// only one chairman / CEO / information officer / grievance officer at a time
async function teamExclusiveFlags(row) {
  const db = lazyDb();
  for (const flag of ['is_chairman', 'is_ceo', 'is_information_officer', 'is_grievance_officer']) {
    if (Number(row[flag]) === 1) await db.query(`UPDATE team_members SET ${flag} = 0 WHERE id <> $1 AND ${flag} = 1`, [row.id]);
  }
}
const youtubeId = url => (String(url || '').match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1] || null;
async function galleryAfterSave(row) {
  const id = youtubeId(row.video_url);
  const data = id ? { media_type: 'video', thumbnail: `https://img.youtube.com/vi/${id}/hqdefault.jpg` } : { media_type: 'photo', video_url: null };
  const album = row.album_id ? await lazyDb().one('SELECT name_np, category FROM gallery_albums WHERE id = $1', [row.album_id]) : null;
  if (album) Object.assign(data, { album: album.name_np, category: album.category || 'general' });
  await lazyDb().update('gallery', row.id, data);
}
const ORDER = N('display_order', 'क्रम', 'Order', { default: 0 });

const resources = {
  // ---------------------------------------------------------------- content
  notices: { group: 'content', icon: 'bell', title: ['सूचना', 'Notices'], order: 'notice_date DESC NULLS LAST, id DESC', softDelete: true, bulk: true, fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    D('notice_date', 'मिति', 'Date', { list: true }), RT('content_np', 'विवरण (नेपाली)', 'Content (Nepali)'), RT('content', 'विवरण (English)', 'Content (English)'),
    FILE('attachment', 'संलग्न फाइल', 'Attachment'), B('is_popup', 'पपअपमा देखाउने', 'Show as popup', { list: true }),
    IMG('popup_image', 'पपअप फोटो', 'Popup image'), B('popup_photo_only', 'फोटो मात्र', 'Photo only'), D('popup_expires_at', 'पपअप म्याद', 'Popup until'), ACTIVE] },
  news: { group: 'content', icon: 'news', title: ['समाचार', 'News'], order: 'created_at DESC', softDelete: true, bulk: true, fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    IMG('image'), RT('content_np', 'विवरण (नेपाली)', 'Content (Nepali)'), RT('content', 'विवरण (English)', 'Content (English)'), ACTIVE] },
  sliders: { group: 'content', icon: 'image', title: ['स्लाइडर', 'Home sliders'], order: 'display_order, id', fields: [
    IMG('image', 'फोटो', 'Image', { required: true, list: true }), T('title', 'शीर्षक', 'Title', { list: true }), T('subtitle', 'उपशीर्षक', 'Subtitle'),
    T('button_text', 'बटन', 'Button text'), T('button_url', 'बटन लिङ्क', 'Button link', { type: 'url' }), ORDER, ACTIVE] },
  pages: { group: 'content', icon: 'file', title: ['पृष्ठहरू', 'Pages'], order: 'menu_order, id', fields: [
    T('slug', 'URL slug', 'URL slug', { required: true, list: true, hint: 'e.g. loan-policy → /page/loan-policy' }),
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('title', 'शीर्षक (पुरानो)', 'Title (legacy)', { hidden: true }),
    RT('content_np', 'सामग्री (नेपाली)', 'Content (Nepali)'), RT('content', 'सामग्री (English)', 'Content (English)'),
    B('show_in_menu', 'मेनुमा देखाउने', 'Show in menu', { list: true }), SEL('menu_position', 'मेनु', 'Menu', [['about', 'हाम्रो बारेमा', 'About'], ['services', 'सेवाहरू', 'Services'], ['more', 'सूचना', 'Updates']]),
    N('menu_order', 'क्रम', 'Order', { default: 0 }), ACTIVE] },
  faqs: { group: 'content', icon: 'info', title: ['FAQ', 'FAQs'], order: 'display_order, id', fields: [
    T('question_np', 'प्रश्न (नेपाली)', 'Question (Nepali)', { required: true, list: true }), T('question', 'प्रश्न (English)', 'Question (English)'),
    TA('answer_np', 'उत्तर (नेपाली)', 'Answer (Nepali)'), TA('answer', 'उत्तर (English)', 'Answer (English)'), T('category', 'समूह', 'Category', { list: true }), ORDER, ACTIVE] },
  gallery_albums: { group: 'media', icon: 'layers', title: ['एल्बम', 'Albums'], order: 'display_order, id DESC', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('category', 'समूह', 'Category'), ORDER, ACTIVE] },
  gallery: { group: 'media', icon: 'image', title: ['ग्यालरी', 'Gallery'], order: 'id DESC', softDelete: true, bulk: true, afterSave: galleryAfterSave,
    links: [['/admin/gallery/upload', 'image', 'धेरै फोटो / भिडियो', 'Bulk upload / video']], fields: [
    IMG('image', 'फोटो', 'Image', { list: true }), T('video_url', 'YouTube लिङ्क (भिडियोका लागि)', 'YouTube link (for a video)', { type: 'url', hint: 'https://www.youtube.com/watch?v=…' }),
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    SEL('media_type', 'प्रकार', 'Type', [['photo', 'फोटो', 'Photo'], ['video', 'भिडियो', 'Video']], { list: true, hint: 'auto' }),
    REF('album_id', 'एल्बम', 'Album', 'gallery_albums', 'name_np', { list: true }), ORDER, ACTIVE] },
  downloads: { group: 'media', icon: 'download', title: ['डाउनलोड', 'Downloads'], order: 'id DESC', softDelete: true, bulk: true, fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    FILE('file_path', 'फाइल', 'File', { required: true }), T('category', 'समूह', 'Category', { list: true }), ACTIVE] },
  // report files are private and served through /reports/:id/file (members-only reports stay gated)
  reports: { group: 'media', icon: 'chart', title: ['प्रतिवेदन', 'Reports'], order: 'report_year DESC NULLS LAST, id DESC', privateFiles: true, fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    T('report_type', 'प्रकार', 'Type', { list: true }), T('report_year', 'वर्ष', 'Year', { list: true }), T('report_quarter', 'त्रैमास', 'Quarter'), T('report_month', 'महिना', 'Month'),
    FILE('file_path', 'फाइल', 'File'), SEL('access_level', 'पहुँच', 'Access', [['none', 'सबै', 'Public'], ['member', 'सदस्य मात्र', 'Members only']], { default: 'none', list: true }), ORDER, ACTIVE] },

  information_room_items: { minRole: 'admin', privateFiles: true, group: 'media', icon: 'shield', title: ['सूचना कक्ष (सदस्य)', 'Information room'], order: 'display_order, meeting_date DESC NULLS LAST, id DESC',
    links: [['/admin/information-room/browse', 'eye', 'पूर्वावलोकन', 'Preview'], ['/admin/information-room/logs', 'inbox', 'पहुँच लग', 'Access log']], fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    T('category', 'समूह', 'Category', { list: true }), D('meeting_date', 'बैठक मिति', 'Meeting date', { list: true }), T('reference_no', 'च.नं./सन्दर्भ', 'Reference no.'),
    FILE('file_path', 'फाइल (PDF)', 'File (PDF)', { required: true }), TA('description_np', 'विवरण', 'Description'),
    B('allow_download', 'डाउनलोड अनुमति', 'Allow download', { default: 0 }), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- services & rates
  service_categories: { group: 'services', icon: 'layers', title: ['सेवा समूह', 'Service groups'], order: 'display_order, id', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('name', 'नाम', 'Name (legacy)', { hidden: true }), T('icon', 'आइकन', 'Icon'), ORDER, ACTIVE] },
  services: { group: 'services', icon: 'wallet', title: ['सेवाहरू', 'Services'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('title', 'शीर्षक', 'Title (legacy)', { hidden: true }),
    REF('service_category_id', 'समूह', 'Group', 'service_categories', 'name_np', { list: true }), IMG('image'),
    RT('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), RT('description', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  service_products: { group: 'services', icon: 'layers', title: ['सेवा योजना', 'Service products'], order: 'service_id, display_order, id', fields: [
    REF('service_id', 'सेवा', 'Service', 'services', 'title_np', { required: true, list: true }), T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'),
    TA('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('description_en', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  interest_rates: { group: 'services', icon: 'percent', title: ['ब्याजदर', 'Interest rates'], order: 'category DESC, display_order, id', fields: [
    SEL('category', 'प्रकार', 'Type', [['saving', 'बचत', 'Saving'], ['loan', 'ऋण', 'Loan']], { required: true, list: true }),
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }),
    N('rate', 'ब्याजदर (%)', 'Rate (%)', { required: true, list: true, step: '0.01' }), TA('description_np', 'विवरण', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  digital_service_types: { group: 'services', icon: 'phone', title: ['डिजिटल सेवा प्रकार', 'Digital service types'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { required: true, list: true }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE] },
  app_features: { group: 'services', icon: 'phone', title: ['एप सुविधा', 'App features'], order: 'sort_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), TA('description_np', 'विवरण', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'),
    B('is_new', 'नयाँ', 'New', { list: true }), N('sort_order', 'क्रम', 'Order', { default: 0 }), ACTIVE] },
  service_centers: { group: 'services', icon: 'building', title: ['शाखा/सेवा केन्द्र', 'Branches'], order: 'is_main_branch DESC, display_order, id', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }), T('address', 'ठेगाना', 'Address', { list: true }), T('phone', 'फोन', 'Phone', { list: true }),
    T('email', 'इमेल', 'Email'), T('province', 'प्रदेश', 'Province'), T('opening_hours', 'खुल्ने समय', 'Opening hours'), T('map_url', 'नक्सा लिङ्क', 'Map link', { type: 'url' }),
    B('is_main_branch', 'मुख्य कार्यालय', 'Head office'), ORDER, ACTIVE] },
  partner_facilities: { group: 'services', icon: 'store', title: ['साझेदार सुविधा', 'Partner facilities'], order: 'display_order, id', fields: [
    T('partner_name', 'नाम', 'Name', { required: true, list: true }), T('partner_name_en', 'नाम (English)', 'Name (English)'), T('facility_type', 'प्रकार', 'Type', { list: true }), T('location', 'स्थान', 'Location'),
    N('discount_percent', 'छुट (%)', 'Discount (%)', { list: true }), T('discount_label', 'छुट विवरण', 'Discount label'), TA('description', 'विवरण', 'Description'), IMG('logo_path', 'लोगो', 'Logo'),
    T('contact_phone', 'फोन', 'Phone'), T('contact_email', 'इमेल', 'Email'), T('website_url', 'वेबसाइट', 'Website', { type: 'url' }), B('is_featured', 'विशेष', 'Featured'), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- organisation
  team_members: { group: 'org', icon: 'users', title: ['टिम/कर्मचारी', 'Team'], order: "CASE category WHEN 'board' THEN 1 WHEN 'management' THEN 2 ELSE 3 END, display_order, id", afterSave: teamExclusiveFlags,
    links: [['/admin/r/team_staff_groups', 'layers', 'कर्मचारी समूह', 'Staff groups'], ['/admin/r/team_menu_categories', 'menu', 'मेनु श्रेणी', 'Menu categories']], fields: [
    IMG('photo', 'फोटो', 'Photo', { list: true }), T('name', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    T('position', 'पद (नेपाली)', 'Position (Nepali)', { list: true }), T('position_en', 'पद (English)', 'Position (English)'),
    SEL('category', 'समूह', 'Group', null, { required: true, list: true, optionsFn: teamCategoryOptions }),
    SEL('chart_row', 'संगठन चार्ट पङ्क्ति', 'Org-chart row', [['0', 'स्वतः (पदबाट)', 'Auto (from title)'], ['1', '१', '1'], ['2', '२', '2'], ['3', '३', '3'], ['4', '४', '4'], ['5', '५', '5']], { default: '0' }),
    T('phone', 'फोन', 'Phone'), T('email', 'इमेल', 'Email'),
    B('is_chairman', 'अध्यक्ष (सन्देश पृष्ठ)', 'Chairperson (message page)', { list: true }), B('is_ceo', 'प्रमुख कार्यकारी (सन्देश पृष्ठ)', 'CEO (message page)', { list: true }),
    B('is_information_officer', 'सूचना अधिकारी', 'Information officer'), B('is_grievance_officer', 'गुनासो अधिकारी', 'Grievance officer'), ORDER, ACTIVE] },
  team_staff_groups: { group: 'org', icon: 'layers', title: ['कर्मचारी समूह', 'Staff groups'], order: 'display_order, id', fields: [
    T('slug', 'कोड (a-z)', 'Code (a-z)', { required: true, list: true, hint: 'e.g. branch_staff — used as the team member group' }),
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    REF('menu_category_id', 'मेनु श्रेणी', 'Menu category', 'team_menu_categories', 'name_np', { list: true }),
    B('show_in_nav', 'मेनुमा देखाउने', 'Show in menu', { default: 1 }), ORDER, ACTIVE] },
  team_menu_categories: { group: 'org', icon: 'menu', title: ['टिम मेनु श्रेणी', 'Team menu categories'], order: 'display_order, id', fields: [
    T('slug', 'कोड (a-z)', 'Code (a-z)', { required: true, list: true }),
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    SEL('source_type', 'स्रोत', 'Source', [['staff', 'कर्मचारी समूह', 'Staff groups'], ['committees', 'समितिहरू', 'Committees']], { required: true, list: true, default: 'staff' }),
    B('include_contact_officers', 'सम्पर्क अधिकारी समावेश', 'Include contact officers'), B('include_board', 'सञ्चालक समिति समावेश', 'Include board'),
    B('show_in_nav', 'मेनुमा देखाउने', 'Show in menu', { default: 1, list: true }), ORDER, ACTIVE] },
  committee_types: { group: 'org', icon: 'users', title: ['समिति', 'Committees'], order: 'display_order, id', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }), TA('description', 'विवरण', 'Description'),
    REF('menu_category_id', 'मेनु श्रेणी', 'Menu category', 'team_menu_categories', 'name_np'),
    B('show_in_navbar', 'मेनुमा देखाउने', 'Show in menu', { list: true }), ORDER, ACTIVE] },
  committee_tenures: { group: 'org', icon: 'calendar', title: ['समितिको कार्यकाल', 'Committee tenures'], order: 'committee_type_id, start_date DESC NULLS LAST', fields: [
    REF('committee_type_id', 'समिति', 'Committee', 'committee_types', 'name_np', { required: true, list: true }), T('tenure_name_np', 'कार्यकाल (नेपाली)', 'Tenure (Nepali)', { list: true }), T('tenure_name', 'कार्यकाल (English)', 'Tenure (English)', { required: true }),
    D('start_date', 'सुरु', 'Start'), D('end_date', 'अन्त्य', 'End'), B('is_current', 'हालको', 'Current', { list: true }), ACTIVE] },
  committee_members: { group: 'org', icon: 'user', title: ['समिति सदस्य', 'Committee members'], order: 'tenure_id DESC, display_order, id', fields: [
    REF('tenure_id', 'कार्यकाल', 'Tenure', 'committee_tenures', 'tenure_name', { required: true, list: true }), IMG('photo', 'फोटो', 'Photo', { list: true }),
    T('name', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('position', 'पद', 'Position', { list: true }), T('position_en', 'पद (English)', 'Position (English)'),
    T('phone', 'फोन', 'Phone'), T('email', 'इमेल', 'Email'), ORDER, ACTIVE] },
  designations: { group: 'org', icon: 'id', title: ['पद/दर्जा', 'Designations'], order: 'display_order, id', fields: [
    T('title_np', 'पद (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'पद (English)', 'Title (English)'), T('category', 'समूह', 'Category', { list: true }), ORDER, ACTIVE] },
  institutional_profile: { group: 'org', icon: 'chart', title: ['संस्थागत विवरण', 'Institutional profile'], order: 'fiscal_year DESC, report_month DESC NULLS LAST', fields: [
    T('fiscal_year', 'आर्थिक वर्ष', 'Fiscal year', { required: true, list: true, hint: '2082/83' }), N('report_month', 'महिना (१–१२)', 'Month (1–12)', { list: true }),
    N('total_members', 'कुल सदस्य', 'Members', { list: true }), N('share_capital', 'शेयर पुँजी', 'Share capital'), N('deposit', 'कुल बचत', 'Deposits', { list: true }), N('loan', 'कुल ऋण', 'Loans', { list: true }),
    N('total_loan_members', 'ऋणी सदस्य', 'Borrowers'), N('total_assets', 'कुल सम्पत्ति', 'Total assets'), N('other_fund', 'अन्य कोष', 'Other funds'), N('bank_cash_balance', 'बैंक/नगद', 'Bank & cash'),
    N('fixed_assets', 'स्थिर सम्पत्ति', 'Fixed assets'), N('npa_percent', 'NPA %', 'NPA %', { step: '0.01' }), N('profit_loss', 'नाफा/नोक्सान', 'Profit / loss'),
    SEL('access_level', 'पहुँच', 'Access', [['none', 'सबै', 'Public'], ['member', 'सदस्य मात्र', 'Members only']], { default: 'none' }), ACTIVE] },
  why_choose_features: { group: 'org', icon: 'check', title: ['हाम्रो विशेषता', 'Why choose us'], order: 'sort_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), TA('desc_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('desc_en', 'विवरण (English)', 'Description (English)'),
    N('sort_order', 'क्रम', 'Order', { default: 0 }), ACTIVE] },
  awards: { group: 'org', icon: 'award', title: ['पुरस्कार', 'Awards'], order: 'display_order, award_date DESC NULLS LAST', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('awarded_by_np', 'प्रदान गर्ने', 'Awarded by (Nepali)'), T('awarded_by', 'Awarded by', 'Awarded by (English)'),
    D('award_date', 'मिति', 'Date', { list: true }), IMG('image'), TA('description_np', 'विवरण', 'Description'), ORDER, ACTIVE] },
  member_of_year: { group: 'org', icon: 'star', title: ['वर्षको सदस्य', 'Member of the year'], order: 'spotlight_year DESC', fields: [
    T('spotlight_year', 'वर्ष', 'Year', { required: true, list: true }), T('member_name', 'नाम', 'Name', { required: true, list: true }), T('member_name_en', 'नाम (English)', 'Name (English)'), T('member_id', 'सदस्यता नं.', 'Member no.'),
    IMG('photo'), T('member_since', 'सदस्य देखि', 'Member since'), TA('achievement', 'उपलब्धि', 'Achievement'), TA('quote', 'भनाइ', 'Quote'), ACTIVE] },
  member_success_stories: { group: 'org', icon: 'heart', title: ['सफलताका कथा', 'Success stories'], order: 'display_order, id DESC', fields: [
    T('member_name', 'नाम', 'Name', { required: true, list: true }), T('member_name_en', 'नाम (English)', 'Name (English)'), IMG('photo'), T('profession', 'पेशा', 'Profession', { list: true }), T('location', 'स्थान', 'Location'),
    T('headline_np', 'शीर्षक (नेपाली)', 'Headline (Nepali)', { required: true }), T('headline_en', 'शीर्षक (English)', 'Headline (English)'), TA('story_np', 'कथा (नेपाली)', 'Story (Nepali)', { required: true }), TA('story_en', 'कथा (English)', 'Story (English)'), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- engagement
  careers: { group: 'engage', icon: 'briefcase', title: ['रोजगारी', 'Careers'], order: 'id DESC', softDelete: true, fields: [
    T('title_np', 'पद (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'पद (English)', 'Title (English)', { required: true }), T('department', 'विभाग', 'Department'), T('location', 'स्थान', 'Location'),
    T('job_type', 'प्रकार', 'Type'), N('vacancies', 'पद संख्या', 'Vacancies', { list: true }), D('deadline', 'अन्तिम मिति', 'Deadline', { list: true }), T('min_qualification', 'योग्यता', 'Qualification'),
    T('experience_required', 'अनुभव', 'Experience'), T('salary_range', 'तलब', 'Salary'), RT('description_np', 'विवरण', 'Description (Nepali)'), RT('description', 'Description', 'Description (English)'), TA('requirements', 'आवश्यकता', 'Requirements'),
    FILE('attachment', 'विज्ञापन', 'Advertisement'), B('allow_online_apply', 'अनलाइन आवेदन', 'Online apply', { default: 1 }), ACTIVE] },
  auction_notices: { group: 'engage', icon: 'gavel', title: ['लिलाम', 'Auctions'], order: 'id DESC', fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('tracking_number', 'सूचना नं.', 'Notice no.'),
    SEL('status', 'स्थिति', 'Status', [['upcoming', 'आगामी', 'Upcoming'], ['ongoing', 'जारी', 'Ongoing'], ['completed', 'सम्पन्न', 'Completed'], ['cancelled', 'रद्द', 'Cancelled']], { default: 'upcoming', list: true }),
    T('property_type', 'सम्पत्ति प्रकार', 'Property type'), T('location', 'स्थान', 'Location'), T('area', 'क्षेत्रफल', 'Area'), N('minimum_price', 'न्यूनतम मूल्य', 'Minimum price', { list: true }),
    D('auction_date', 'मिति', 'Date', { list: true }), T('auction_time', 'समय', 'Time'), T('contact_person', 'सम्पर्क व्यक्ति', 'Contact'), T('contact_phone', 'फोन', 'Phone'),
    T('google_map_link', 'नक्सा लिङ्क', 'Map link', { type: 'url' }), IMG('image'), FILE('document', 'सूचना फाइल', 'Notice document'), RT('description', 'विवरण', 'Description'), ACTIVE] },
  upcoming_programs: { group: 'engage', icon: 'calendar', title: ['कार्यक्रम', 'Programmes'], order: 'event_date DESC NULLS LAST', fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }),
    SEL('program_type', 'प्रकार', 'Type', [['General', 'सामान्य', 'General'], ['AGM', 'वार्षिक साधारण सभा', 'AGM'], ['SGM', 'विशेष साधारण सभा', 'SGM'], ['Orientation', 'अभिमुखीकरण', 'Orientation'], ['Training', 'तालिम', 'Training'], ['Seminar', 'गोष्ठी', 'Seminar'], ['Workshop', 'कार्यशाला', 'Workshop'], ['Financial_Literacy', 'वित्तीय साक्षरता', 'Financial literacy'], ['Other', 'अन्य', 'Other']], { default: 'General', list: true }),
    D('event_date', 'मिति', 'Date', { list: true }), T('event_time', 'समय', 'Time'),
    T('location', 'स्थान', 'Location', { list: true }), TA('description', 'विवरण', 'Description'), B('pre_registration_open', 'पूर्व दर्ता खुला', 'Pre-registration open'), ACTIVE] },
  sahakari_calendar_events: { group: 'engage', icon: 'calendar', title: ['पात्रो कार्यक्रम', 'Calendar events'], order: 'bs_month, bs_day', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'),
    N('bs_year', 'वि.सं. वर्ष (खाली = हरेक वर्ष)', 'BS year (blank = every year)'), N('bs_month', 'महिना (१–१२)', 'Month (1–12)', { required: true, list: true }), N('bs_day', 'गते', 'Day', { required: true, list: true }),
    SEL('recurrence', 'दोहोरिने', 'Repeats', [['yearly', 'हरेक वर्ष', 'Yearly'], ['once', 'एक पटक', 'Once']], { default: 'yearly' }), T('event_type', 'प्रकार', 'Type'), TA('description_np', 'विवरण', 'Description'), ACTIVE] },
  honor_programs: { group: 'engage', icon: 'award', title: ['सम्मान कार्यक्रम', 'Honour programmes'], order: 'id DESC', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('fiscal_year', 'आ.व.', 'Fiscal year', { list: true }),
    T('opens_at', 'खुल्ने मिति', 'Opens', { type: 'datetime' }), T('closes_at', 'बन्द मिति', 'Closes', { type: 'datetime', list: true }), TA('instructions_np', 'निर्देशन', 'Instructions'), ACTIVE] },
  honor_categories: { group: 'engage', icon: 'award', title: ['सम्मान विधा', 'Honour categories'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { required: true, list: true }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    B('requires_nominee', 'मनोनीत चाहिन्छ', 'Requires nominee'), B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE] },
  welfare_claim_types: { group: 'engage', icon: 'heart', title: ['कल्याण दाबी प्रकार', 'Welfare claim types'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { required: true, list: true }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE] },
  election_cycles: { minRole: 'admin', group: 'engage', icon: 'vote', title: ['निर्वाचन', 'Elections'], order: 'sort_order, date_from DESC NULLS LAST', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('period_label', 'अवधि', 'Period'),
    D('date_from', 'देखि', 'From'), D('date_to', 'सम्म', 'To'), TA('intro_np', 'परिचय', 'Introduction'), B('is_published', 'प्रकाशित', 'Published', { list: true }), N('sort_order', 'क्रम', 'Order', { default: 0 })] },
  election_positions: { minRole: 'admin', group: 'engage', icon: 'vote', title: ['निर्वाचन पद', 'Election positions'], order: 'cycle_id DESC, display_order', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true, list: true }), T('title_np', 'पद (नेपाली)', 'Position (Nepali)', { required: true, list: true }), T('title_en', 'पद (English)', 'Position (English)'),
    N('seats', 'पद संख्या', 'Seats', { default: 1, list: true }), N('max_votes_per_voter', 'अधिकतम मत', 'Max votes', { default: 1 }), ORDER, ACTIVE] },
  election_candidates: { minRole: 'admin', group: 'engage', icon: 'user', title: ['उम्मेदवार', 'Candidates'], order: 'cycle_id DESC, position_id, display_order', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true }), REF('position_id', 'पद', 'Position', 'election_positions', 'title_np', { required: true, list: true }),
    IMG('photo', 'फोटो', 'Photo', { list: true }), T('name', 'नाम', 'Name', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('symbol_no', 'चिन्ह नं.', 'Symbol no.'),
    T('phone', 'फोन', 'Phone'), TA('bio_np', 'परिचय', 'Bio'), ORDER, ACTIVE] },
  election_milestones: { minRole: 'admin', group: 'engage', icon: 'calendar', title: ['निर्वाचन कार्यतालिका', 'Election schedule'], order: 'cycle_id DESC, event_date', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true, list: true }), D('event_date', 'मिति', 'Date', { required: true, list: true }),
    T('title_np', 'कार्य (नेपाली)', 'Item (Nepali)', { required: true, list: true }), T('title_en', 'कार्य (English)', 'Item (English)'), FILE('attachment', 'सूचना', 'Notice'), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- links
  important_links: { group: 'links', icon: 'link', title: ['महत्त्वपूर्ण लिङ्क', 'Important links'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }), ORDER, ACTIVE] },
  useful_links: { group: 'links', icon: 'link', title: ['उपयोगी लिङ्क', 'Useful links'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }),
    TA('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'),
    B('is_popup', 'तैरने "उपयोगी लिङ्क" पपअपमा देखाउने', 'Show in the floating "Useful links" popup', { list: true }), ORDER, ACTIVE] },
  satisfaction_links: { group: 'links', icon: 'star', title: ['सन्तुष्टि लिङ्क', 'Satisfaction links'], order: 'display_order, id', links: [['/admin/satisfaction', 'settings', 'विजेट सेटिङ', 'Widget setting']], fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }), ORDER, ACTIVE] },
  notification_templates: { minRole: 'admin', group: 'links', icon: 'mail', title: ['SMS/इमेल ढाँचा', 'Message templates'], order: 'event_type, audience, channel', fields: [
    SEL('event_type', 'घटना', 'Event', [['submitted', 'आवेदन प्राप्त', 'Application received'], ['status_changed', 'स्थिति परिवर्तन', 'Status changed']], { required: true, list: true }),
    SEL('audience', 'प्राप्तकर्ता', 'Audience', [['member', 'आवेदक', 'Applicant'], ['admin', 'प्रशासक', 'Admin']], { required: true, list: true }),
    SEL('channel', 'माध्यम', 'Channel', [['sms', 'SMS', 'SMS'], ['email', 'इमेल', 'Email']], { required: true, list: true }),
    T('subject', 'विषय (इमेल)', 'Subject (email)'), TA('body', 'सन्देश', 'Message', { required: true, hint: '{{name}} {{tracking_id}} {{module}} {{status}} {{remarks}} {{site}}' }),
    B('enabled', 'सक्रिय', 'Enabled', { default: 1, list: true })] },
  chatbot_faqs: { group: 'links', icon: 'message', title: ['च्याटबट प्रश्नोत्तर', 'Chatbot answers'], order: 'display_order, id', fields: [
    T('question', 'प्रश्न (नेपाली)', 'Question (Nepali)', { required: true, list: true }), T('question_en', 'प्रश्न (English)', 'Question (English)'),
    TA('answer', 'उत्तर (नेपाली)', 'Answer (Nepali)', { required: true }), TA('answer_en', 'उत्तर (English)', 'Answer (English)'),
    T('keywords', 'मुख्य शब्द (comma)', 'Keywords (comma separated)', { list: true }), T('category', 'समूह', 'Category'), ORDER, ACTIVE] },
  site_stats: { group: 'links', icon: 'chart', title: ['तथ्याङ्क', 'Home stats'], order: 'id', fields: [
    SEL('stat_key', 'प्रकार', 'Key', [['total_members', 'कुल सदस्य', 'Members'], ['total_deposit', 'कुल बचत', 'Deposits'], ['total_loan', 'कुल ऋण', 'Loans']], { required: true, list: true }),
    N('stat_value', 'मान', 'Value', { required: true, list: true })] },
};

const GROUPS = {
  content: ['सामग्री', 'Content'], media: ['मिडिया/कागजात', 'Media & files'], services: ['सेवा', 'Services'],
  org: ['संस्था', 'Organisation'], engage: ['कार्यक्रम', 'Programmes'], links: ['लिङ्क/अन्य', 'Links & more'],
};

for (const [key, r] of Object.entries(resources)) {
  r.key = key;
  r.table = r.table || key;
  r.fileFields = r.fields.filter(f => f.type === 'image' || f.type === 'file');
  r.listFields = r.fields.filter(f => f.list);
}

module.exports = { resources, GROUPS };
