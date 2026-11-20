'use strict';
/**
 * Admin CRUD resources — one definition per content table.
 * Field: { name, label:[np,en], type, required, options | ref:{table,label}, list:true, folder }
 * Types: text, textarea, richtext, number, date, datetime, select, bool, image, file, color, url,
 *        icon (picker over lib/icons; PHP Font Awesome values still render), images (JSON gallery), readonly (shown, never saved)
 * Resource: filters [{ name, type: select|ref|bool|distinct }] add list filters; beforeDelete may block or deactivate.
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
const ICON = (name = 'icon', np = 'आइकन', en = 'Icon', extra = {}) => T(name, np, en, { type: 'icon', ...extra });
/** information-room.php: the admin who added the item (created_by), stamped once. */
async function stampCreatedBy(row, req) {
  if (row && !row.created_by && req && req.admin) await require('../db').query('UPDATE information_room_items SET created_by = $1 WHERE id = $2 AND created_by IS NULL', [req.admin.id, row.id]);
}
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

// publications (legacy admin/reports.php selects)
const REPORT_TYPES = [['monthly', 'मासिक', 'Monthly'], ['quarterly', 'त्रैमासिक', 'Quarterly'], ['progress', 'प्रगति', 'Progress'], ['annual', 'वार्षिक', 'Annual'],
  ['financial', 'वित्तीय', 'Financial'], ['audit', 'लेखापरीक्षण', 'Audit'], ['agm', 'साधारण सभा', 'AGM'], ['other', 'अन्य', 'Other']];
const BS_MONTHS = ['बैशाख', 'जेठ', 'असार', 'साउन', 'भदौ', 'असोज', 'कात्तिक', 'मंसिर', 'पुस', 'माघ', 'फागुन', 'चैत']
  .map((np, i) => [np, np, ['Baisakh', 'Jestha', 'Asar', 'Shrawan', 'Bhadra', 'Asoj', 'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra'][i]]);
/** Fiscal years "2082/83" … (Nepali FY starts in Shrawan), current first, plus any value already stored. */
const fyOptions = (table, col) => async () => {
  const nd = require('../lib/nepali-date');
  const [y, m] = String(nd.todayBs() || '').split('-').map(Number);
  const cur = (y || 2082) - (m && m < 4 ? 1 : 0);
  const years = Array.from({ length: 12 }, (_, i) => `${cur - i}/${String((cur - i + 1) % 100).padStart(2, '0')}`);
  const stored = (await lazyDb().many(`SELECT DISTINCT ${col} AS v FROM ${table} WHERE COALESCE(${col}, '') <> ''`)).map(r => r.v);
  return [...new Set([...years, ...stored])].map(v => [v, v, v]);
};
const fiscalYearOptions = fyOptions('reports', 'report_year');
// institutional profile (legacy institutional-profile.php): month 0 = annual; BS report date fills the month and the AD date
const IP_MONTHS = [['0', 'वार्षिक', 'Annual'], ...BS_MONTHS.map((o, i) => [String(i + 1), o[1], o[2]])];
async function institutionalBeforeSave(data, { db, existing }) {
  const nd = require('../lib/nepali-date');
  const bs = nd.toLatinDigits(String(data.report_date_bs || '').trim());
  data.report_date_bs = bs;
  if (bs && !nd.isValidBs(...(nd.parse(bs) || []))) return { report_date_bs: 'वि.सं. YYYY-MM-DD' };
  if (bs && !Number(data.report_month)) data.report_month = Number(bs.slice(5, 7));
  if (bs && !data.report_date_ad) data.report_date_ad = nd.bsToAd(bs);
  data.report_month = Math.min(12, Math.max(0, Number(data.report_month) || 0));
  const dup = await db.value('SELECT id FROM institutional_profile WHERE fiscal_year = $1 AND COALESCE(report_month, 0) = $2 AND id <> $3', [data.fiscal_year, data.report_month, existing ? existing.id : 0]);
  return dup ? { fiscal_year: 'यो आ.व./महिनाको प्रोफाइल पहिले नै छ / a profile for this fiscal year and month already exists' } : {};
}
// information room categories (legacy irCategories()); values stored before stay selectable
const IR_CATEGORIES = [['board_decision', 'बोर्ड निर्णय', 'Board decision'], ['policy', 'नीति', 'Policy'], ['karyabidhi', 'कार्यविधि', 'Procedure'], ['biniyam', 'बिनियम', 'Bylaws'],
  ['meeting_minutes', 'बैठक माइन्युट', 'Meeting minutes'], ['circular', 'परिपत्र', 'Circular'], ['other', 'अन्य', 'Other']];
async function irCategoryOptions() {
  const stored = (await lazyDb().many("SELECT DISTINCT category FROM information_room_items WHERE COALESCE(category, '') <> ''")).map(r => r.category);
  return [...IR_CATEGORIES, ...stored.filter(c => !IR_CATEGORIES.some(o => o[0] === c)).map(c => [c, c, c])];
}

// ---- delete guards (legacy programs.php, election-*.php, *-types.php): keep data-bearing rows, deactivate instead
const IN_USE = ['प्रयोगमा भएकाले मेटाइएन — निष्क्रिय गरियो।', 'In use, so it was deactivated instead of deleted.'];
const deactivateIf = n => (Number(n) > 0 ? { deactivate: true, message: IN_USE } : null);
/** Block deleting a parent row while child rows still point at it (legacy gallery.php album guard and friends). */
const blockIfUsed = (sql, np, en) => async (id, { db }) => (Number(await db.value(sql, [id])) > 0 ? [np, en] : null);
/** Fill a blank slug from the English / Nepali name, unique within the table (legacy *-types.php). */
async function autoSlug(table, data, existing, db) {
  if (existing && existing.slug) { if (!data.slug) data.slug = existing.slug; return; }
  if (data.slug) return;
  const util = require('../lib/util');
  const base = (util.slugify(data.name_en || data.title_en || '') || '').replace(/[^a-z0-9-]/g, '').replace(/-/g, '_') || table.replace(/s$/, '') + '_' + Date.now().toString(36);
  let slug = base, i = 1;
  while (await db.value(`SELECT 1 FROM ${table} WHERE slug = $1`, [slug])) slug = `${base}_${++i}`;
  data.slug = slug;
}
// type masters: builtin rows or a slug used by requests are deactivated; a builtin slug cannot be renamed
const typeGuard = (table, usedBy, col) => ({
  beforeDelete: async (id, { db }) => deactivateIf(await db.value(
    `SELECT CASE WHEN t.is_builtin = 1 OR EXISTS (SELECT 1 FROM ${usedBy} u WHERE u.${col} = t.slug) THEN 1 ELSE 0 END FROM ${table} t WHERE t.id = $1`, [id])),
  beforeSave: async (data, { existing, db }) => { if (existing && Number(existing.is_builtin) === 1) data.slug = existing.slug; await autoSlug(table, data, existing, db); return {}; },
});

const resources = {
  // ---------------------------------------------------------------- content
  notices: { group: 'content', icon: 'bell', title: ['सूचना', 'Notices'], order: 'notice_date DESC NULLS LAST, id DESC', softDelete: true, bulk: true, filters: [{ name: 'is_popup', type: 'bool' }], fields: [
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
    T('slug', 'URL slug', 'URL slug', { list: true, hint: 'e.g. loan-policy → /page/loan-policy (खाली = शीर्षकबाट / blank = from the title)' }),
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('title', 'शीर्षक (पुरानो)', 'Title (legacy)', { hidden: true }),
    RT('content_np', 'सामग्री (नेपाली)', 'Content (Nepali)'), RT('content', 'सामग्री (English)', 'Content (English)'),
    IMG('featured_image', 'मुख्य फोटो', 'Featured image'), T('meta_keywords', 'ट्याग (अल्पविरामले छुट्याउनुहोस्)', 'Tags (comma separated)'),
    B('show_in_menu', 'मेनुमा देखाउने', 'Show in menu', { list: true }), SEL('menu_position', 'मेनु', 'Menu', [['about', 'हाम्रो बारेमा', 'About'], ['services', 'सेवाहरू', 'Services'], ['more', 'सूचना', 'Updates'], ['footer', 'फुटर', 'Footer']]),
    ICON('menu_icon', 'मेनु आइकन', 'Menu icon'), N('menu_order', 'क्रम', 'Order', { default: 0 }),
    B('is_new', 'मेनुमा "नयाँ" चिन्ह', '"New" chip in the menu'), D('new_until', '"नयाँ" चिन्ह कहिलेसम्म', '"New" chip until', { hint: 'खाली = सधैं / blank = no end date' }), ACTIVE],
  // legacy pages.php: blank slug → from the title; a footer page shown in the menu goes under About
  beforeSave: async data => {
    const util = require('../lib/util');
    if (!data.slug) data.slug = util.slugify(data.title_en || data.title_np) || 'page-' + Date.now();
    if (data.menu_position === 'footer' && Number(data.show_in_menu)) data.menu_position = 'about';
    return {};
  } },
  faqs: { group: 'content', icon: 'info', title: ['FAQ', 'FAQs'], order: 'display_order, id', filters: [{ name: 'category', type: 'distinct' }], fields: [
    T('question_np', 'प्रश्न (नेपाली)', 'Question (Nepali)', { required: true, list: true }), T('question', 'प्रश्न (English)', 'Question (English)'),
    TA('answer_np', 'उत्तर (नेपाली)', 'Answer (Nepali)'), TA('answer', 'उत्तर (English)', 'Answer (English)'), T('category', 'समूह', 'Category', { list: true }), ORDER, ACTIVE] },
  gallery_albums: { group: 'media', icon: 'layers', title: ['एल्बम', 'Albums'], order: 'display_order, id DESC', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('category', 'समूह', 'Category'), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM gallery WHERE album_id = $1 AND deleted_at IS NULL', 'यो एल्बममा फोटो/भिडियो छन् — पहिले तिनलाई सार्नुहोस् वा हटाउनुहोस्।', 'This album still has photos or videos — move or delete them first.') },
  gallery: { group: 'media', icon: 'image', title: ['ग्यालरी', 'Gallery'], order: 'id DESC', softDelete: true, bulk: true, afterSave: galleryAfterSave,
    filters: [{ name: 'album_id', type: 'ref' }, { name: 'media_type', type: 'select' }],
    links: [['/admin/gallery/upload', 'image', 'धेरै फोटो / भिडियो', 'Bulk upload / video']], fields: [
    IMG('image', 'फोटो', 'Image', { list: true }), T('video_url', 'YouTube लिङ्क (भिडियोका लागि)', 'YouTube link (for a video)', { type: 'url', hint: 'https://www.youtube.com/watch?v=…' }),
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    SEL('media_type', 'प्रकार', 'Type', [['photo', 'फोटो', 'Photo'], ['video', 'भिडियो', 'Video']], { list: true, hint: 'auto' }),
    REF('album_id', 'एल्बम', 'Album', 'gallery_albums', 'name_np', { list: true }), ORDER, ACTIVE] },
  downloads: { group: 'media', icon: 'download', title: ['डाउनलोड', 'Downloads'], order: 'id DESC', softDelete: true, bulk: true, filters: [{ name: 'category', type: 'distinct' }],
    beforeSave: async data => { if (data.file_path) data.file_type = String(data.file_path).split('.').pop().toLowerCase().slice(0, 20); return {}; }, fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    FILE('file_path', 'फाइल', 'File', { required: true }), T('category', 'समूह', 'Category', { list: true }),
    T('file_type', 'प्रकार', 'Type', { type: 'readonly', list: true }), N('download_count', 'डाउनलोड', 'Downloads', { type: 'readonly', list: true }), ACTIVE] },
  // report files are private and served through /reports/:id/file (members-only reports stay gated)
  reports: { group: 'media', icon: 'chart', title: ['प्रतिवेदन', 'Reports'], order: 'report_year DESC NULLS LAST, id DESC', privateFiles: true, filters: [{ name: 'report_type', type: 'select' }, { name: 'report_year', type: 'distinct' }], fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    SEL('report_type', 'प्रकार', 'Type', REPORT_TYPES, { default: 'annual', list: true }), SEL('report_year', 'आर्थिक वर्ष', 'Fiscal year', [], { list: true, optionsFn: fiscalYearOptions }),
    SEL('report_quarter', 'त्रैमास', 'Quarter', [['Q1', 'पहिलो त्रैमास', 'Q1'], ['Q2', 'दोस्रो त्रैमास', 'Q2'], ['Q3', 'तेस्रो त्रैमास', 'Q3'], ['Q4', 'चौथो त्रैमास', 'Q4']]),
    SEL('report_month', 'महिना', 'Month', BS_MONTHS),
    FILE('file_path', 'फाइल', 'File'), SEL('access_level', 'पहुँच', 'Access', [['none', 'सबै', 'Public'], ['member', 'सदस्य मात्र', 'Members only']], { default: 'none', list: true }),
    B('view_only', 'हेर्न मात्र (डाउनलोड नहुने)', 'View only (no download)'), ORDER, ACTIVE] },

  information_room_items: { minRole: 'admin', privateFiles: true, bulk: true, group: 'media', icon: 'shield', title: ['सूचना कक्ष (सदस्य)', 'Information room'], order: 'display_order, meeting_date DESC NULLS LAST, id DESC',
    links: [['/admin/information-room/browse', 'eye', 'पूर्वावलोकन', 'Preview'], ['/admin/information-room/logs', 'inbox', 'पहुँच लग', 'Access log']], fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title', 'शीर्षक (English)', 'Title (English)'),
    SEL('category', 'समूह', 'Category', IR_CATEGORIES, { list: true, optionsFn: irCategoryOptions }), D('meeting_date', 'बैठक मिति', 'Meeting date', { list: true }), T('reference_no', 'च.नं./सन्दर्भ', 'Reference no.'),
    FILE('file_path', 'फाइल (PDF)', 'File (PDF)', { required: true }), TA('description_np', 'विवरण', 'Description'),
    B('allow_download', 'डाउनलोड अनुमति', 'Allow download', { default: 0 }), B('restrict_copy', 'कपी / प्रिन्ट रोक्ने', 'Block copy / print', { default: 1, list: true }), ORDER, ACTIVE],
  afterSave: stampCreatedBy },

  // ---------------------------------------------------------------- services & rates
  service_categories: { group: 'services', icon: 'layers', title: ['सेवा समूह', 'Service groups'], order: 'display_order, id', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('name', 'नाम', 'Name (legacy)', { hidden: true }), ICON(), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM services WHERE service_category_id = $1', 'यो समूहमा सेवाहरू छन् — मेटाउन मिलेन।', 'Services use this group, so it cannot be deleted.') },
  services: { group: 'services', icon: 'wallet', title: ['सेवाहरू', 'Services'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('title', 'शीर्षक', 'Title (legacy)', { hidden: true }),
    REF('service_category_id', 'समूह', 'Group', 'service_categories', 'name_np', { list: true }), IMG('image'), ICON(),
    SEL('nav_group', 'मेनु समूह', 'Menu group', [['general', 'सामान्य', 'General'], ['social', 'सामाजिक', 'Social'], ['student', 'विद्यार्थी', 'Student'], ['financial', 'वित्तीय', 'Financial'], ['other', 'अन्य', 'Other']]),
    RT('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), RT('description', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  service_products: { group: 'services', icon: 'layers', title: ['सेवा योजना', 'Service products'], order: 'service_id, display_order, id', filters: [{ name: 'service_id', type: 'ref' }], fields: [
    REF('service_id', 'सेवा', 'Service', 'services', 'title_np', { required: true, list: true }), T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'),
    TA('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('description_en', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  interest_rates: { group: 'services', icon: 'percent', title: ['ब्याजदर', 'Interest rates'], order: 'category DESC, display_order, id', filters: [{ name: 'category', type: 'select' }], fields: [
    SEL('category', 'प्रकार', 'Type', [['saving', 'बचत', 'Saving'], ['loan', 'ऋण', 'Loan']], { required: true, list: true }),
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }),
    N('rate', 'ब्याजदर (%)', 'Rate (%)', { required: true, list: true, step: '0.01' }), TA('description_np', 'विवरण', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  digital_service_types: { group: 'services', icon: 'phone', title: ['डिजिटल सेवा प्रकार', 'Digital service types'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { list: true, readonlyOnEdit: true, hint: 'खाली = नामबाट / blank = from the name' }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    ICON('icon', 'आइकन', 'Icon', { default: 'phone' }), T('color', 'रङ', 'Colour', { default: 'var(--primary-color)', hint: '#0f766e' }), B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE], ...typeGuard('digital_service_types', 'digital_service_requests', 'service_type') },
  app_features: { minRole: 'admin', group: 'services', icon: 'phone', title: ['एप सुविधा', 'App features'], order: 'sort_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), TA('description_np', 'विवरण', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'), ICON(),
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
    filters: [{ name: 'category', type: 'select' }], beforeSave: async data => { data.position_np = data.position || null; return {}; },
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
    REF('menu_category_id', 'मेनु श्रेणी', 'Menu category', 'team_menu_categories', 'name_np', { list: true }), ICON('icon', 'आइकन', 'Icon', { default: 'users' }),
    B('show_in_nav', 'मेनुमा देखाउने', 'Show in menu', { default: 1 }), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM team_members m JOIN team_staff_groups g ON g.slug = m.category WHERE g.id = $1', 'यो समूहमा कर्मचारी छन् — मेटाउन मिलेन।', 'Team members are in this group, so it cannot be deleted.') },
  team_menu_categories: { group: 'org', icon: 'menu', title: ['टिम मेनु श्रेणी', 'Team menu categories'], order: 'display_order, id', fields: [
    T('slug', 'कोड (a-z)', 'Code (a-z)', { required: true, list: true }),
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    SEL('source_type', 'स्रोत', 'Source', [['staff', 'कर्मचारी समूह', 'Staff groups'], ['committees', 'समितिहरू', 'Committees']], { required: true, list: true, default: 'staff' }),
    B('include_contact_officers', 'सम्पर्क अधिकारी समावेश', 'Include contact officers'), B('include_board', 'सञ्चालक समिति समावेश', 'Include board'), ICON(),
    B('show_in_nav', 'मेनुमा देखाउने', 'Show in menu', { default: 1, list: true }), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT (SELECT count(*) FROM team_staff_groups WHERE menu_category_id = $1) + (SELECT count(*) FROM committee_types WHERE menu_category_id = $1)', 'कर्मचारी समूह वा समितिले यो श्रेणी प्रयोग गर्छन् — मेटाउन मिलेन।', 'Staff groups or committees use this category, so it cannot be deleted.') },
  committee_types: { group: 'org', icon: 'users', title: ['समिति', 'Committees'], order: 'display_order, id', fields: [
    T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { list: true }), T('name', 'नाम (English)', 'Name (English)', { required: true }), TA('description', 'विवरण', 'Description'),
    REF('menu_category_id', 'मेनु श्रेणी', 'Menu category', 'team_menu_categories', 'name_np'), ICON(),
    B('show_in_navbar', 'मेनुमा देखाउने', 'Show in menu', { list: true }), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM committee_tenures WHERE committee_type_id = $1', 'यो समितिको कार्यकाल छ — मेटाउन मिलेन।', 'This committee has tenures, so it cannot be deleted.') },
  committee_tenures: { group: 'org', icon: 'calendar', title: ['समितिको कार्यकाल', 'Committee tenures'], order: 'committee_type_id, start_date DESC NULLS LAST', fields: [
    REF('committee_type_id', 'समिति', 'Committee', 'committee_types', 'name_np', { required: true, list: true }), T('tenure_name_np', 'कार्यकाल (नेपाली)', 'Tenure (Nepali)', { list: true }), T('tenure_name', 'कार्यकाल (English)', 'Tenure (English)', { required: true }),
    D('start_date', 'सुरु', 'Start'), D('end_date', 'अन्त्य', 'End'), B('is_current', 'हालको', 'Current', { list: true }), ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM committee_members WHERE tenure_id = $1', 'यो कार्यकालमा सदस्य छन् — मेटाउन मिलेन।', 'This tenure has members, so it cannot be deleted.') },
  committee_members: { group: 'org', icon: 'user', title: ['समिति सदस्य', 'Committee members'], order: 'tenure_id DESC, display_order, id', filters: [{ name: 'tenure_id', type: 'ref' }], fields: [
    REF('tenure_id', 'कार्यकाल', 'Tenure', 'committee_tenures', 'tenure_name', { required: true, list: true }), IMG('photo', 'फोटो', 'Photo', { list: true }),
    T('name', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('position', 'पद', 'Position', { list: true }), T('position_en', 'पद (English)', 'Position (English)'),
    T('phone', 'फोन', 'Phone'), T('email', 'इमेल', 'Email'), TA('address', 'ठेगाना', 'Address'), ORDER, ACTIVE] },
  designations: { group: 'org', icon: 'id', title: ['पद/दर्जा', 'Designations'], order: 'display_order, id', fields: [
    T('title_np', 'पद (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'पद (English)', 'Title (English)'), T('category', 'समूह', 'Category', { list: true }), ORDER, ACTIVE],
  beforeDelete: blockIfUsed('SELECT count(*) FROM election_posts WHERE designation_id = $1', 'निर्वाचन पदले यो पद प्रयोग गर्छ — मेटाउन मिलेन; निष्क्रिय गर्नुहोस्।', 'Election posts use this designation, so it cannot be deleted; deactivate it instead.') },
  institutional_profile: { group: 'org', icon: 'chart', title: ['संस्थागत विवरण', 'Institutional profile'], order: 'fiscal_year DESC, report_month DESC NULLS LAST', fields: [
    SEL('fiscal_year', 'आर्थिक वर्ष', 'Fiscal year', [], { required: true, list: true, optionsFn: fyOptions('institutional_profile', 'fiscal_year') }),
    SEL('report_month', 'महिना (० = वार्षिक)', 'Month (0 = annual)', IP_MONTHS, { list: true, default: '0' }),
    T('report_date_bs', 'प्रतिवेदन मिति (वि.सं.)', 'Report date (BS)', { hint: 'YYYY-MM-DD — महिना र AD मिति आफैं भरिन्छ / fills the month and AD date' }), D('report_date_ad', 'प्रतिवेदन मिति (AD)', 'Report date (AD)'),
    N('total_members', 'कुल सदस्य', 'Members', { list: true }), N('total_balance_member', 'बचत भएका सदस्य', 'Members with savings'), N('total_loan_members', 'ऋणी सदस्य', 'Borrowers'),
    N('share_capital', 'शेयर पुँजी', 'Share capital'), N('share_capital_percent', 'शेयर पुँजी %', 'Share capital %', { step: '0.01' }),
    N('reserved_fund', 'जगेडा कोष', 'Reserve fund'), N('reserved_fund_percent', 'जगेडा कोष %', 'Reserve fund %', { step: '0.01' }),
    N('other_fund', 'अन्य कोष', 'Other funds'), N('bank_cash_balance', 'बैंक/नगद', 'Bank & cash'), N('fixed_assets', 'स्थिर सम्पत्ति', 'Fixed assets'), N('total_assets', 'कुल सम्पत्ति', 'Total assets'),
    N('deposit', 'कुल बचत', 'Deposits', { list: true }), N('deposit_percent', 'बचत %', 'Deposits %', { step: '0.01' }),
    N('loan', 'कुल ऋण', 'Loans', { list: true }), N('loan_percent', 'ऋण %', 'Loans %', { step: '0.01' }),
    N('total_loan_reserve_fund', 'कर्जा नोक्सानी व्यवस्था', 'Loan loss provision'), N('total_loan_reserve_percent', 'कर्जा नोक्सानी व्यवस्था %', 'Loan loss provision %', { step: '0.01' }),
    N('npa_percent', 'NPA %', 'NPA %', { step: '0.01' }), N('npl_percent', 'NPL %', 'NPL %', { step: '0.01' }), N('liquidity_percent', 'तरलता %', 'Liquidity %', { step: '0.01' }),
    N('profit_loss', 'नाफा/नोक्सान', 'Profit / loss'), TA('report_note', 'टिप्पणी', 'Note'),
    SEL('access_level', 'पहुँच', 'Access', [['none', 'सबै', 'Public'], ['member', 'सदस्य मात्र', 'Members only']], { default: 'none' }),
    FILE('attachment_path', 'प्रतिवेदन फाइल', 'Report file', { hint: '/institutional-profile/:id/file बाट मात्र खुल्छ (पहुँच अनुसार) / served only through the gated link' }), ACTIVE],
  // attachments are private: members-only reports must not be reachable under /uploads (legacy institutional-profile-file.php)
  privateFiles: true, beforeSave: institutionalBeforeSave },
  why_choose_features: { group: 'org', icon: 'check', title: ['हाम्रो विशेषता', 'Why choose us'], order: 'sort_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), TA('desc_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('desc_en', 'विवरण (English)', 'Description (English)'), ICON('icon', 'आइकन', 'Icon', { default: 'check' }),
    N('sort_order', 'क्रम', 'Order', { default: 0 }), ACTIVE] },
  awards: { group: 'org', icon: 'award', title: ['पुरस्कार', 'Awards'], order: 'display_order, award_date DESC NULLS LAST', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('awarded_by_np', 'प्रदान गर्ने', 'Awarded by (Nepali)'), T('awarded_by', 'प्रदान गर्ने (English)', 'Awarded by (English)'),
    D('award_date', 'मिति', 'Date', { list: true }), IMG('image'), TA('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'), ORDER, ACTIVE] },
  member_of_year: { group: 'org', icon: 'star', title: ['वर्षको सदस्य', 'Member of the year'], order: 'spotlight_year DESC', fields: [
    T('spotlight_year', 'वर्ष', 'Year', { required: true, list: true }), T('member_name', 'नाम', 'Name', { required: true, list: true }), T('member_name_en', 'नाम (English)', 'Name (English)'), T('member_id', 'सदस्यता नं.', 'Member no.'),
    IMG('photo'), T('member_since', 'सदस्य देखि', 'Member since'), TA('achievement', 'उपलब्धि', 'Achievement'), TA('achievement_en', 'उपलब्धि (English)', 'Achievement (English)'),
    TA('quote', 'भनाइ', 'Quote'), TA('quote_en', 'भनाइ (English)', 'Quote (English)'), ACTIVE],
  // legacy member-of-year.php: one spotlight per year
  beforeSave: async (data, { db, existing }) => ((await db.value('SELECT id FROM member_of_year WHERE spotlight_year = $1 AND id <> $2', [String(data.spotlight_year), existing ? existing.id : 0]))
    ? { spotlight_year: 'यो वर्षको सदस्य पहिले नै छ — त्यसैलाई सम्पादन गर्नुहोस् / this year already has a member of the year; edit that one' } : {}) },
  member_success_stories: { group: 'org', icon: 'heart', title: ['सफलताका कथा', 'Success stories'], order: 'display_order, id DESC', fields: [
    T('member_name', 'नाम', 'Name', { required: true, list: true }), T('member_name_en', 'नाम (English)', 'Name (English)'), IMG('photo'), T('profession', 'पेशा', 'Profession', { list: true }), T('profession_en', 'पेशा (English)', 'Profession (English)'), T('location', 'स्थान', 'Location'), T('location_en', 'स्थान (English)', 'Location (English)'),
    T('member_id_no', 'सदस्यता नं.', 'Member no.'), T('member_since', 'सदस्य देखि', 'Member since'),
    T('headline_np', 'शीर्षक (नेपाली)', 'Headline (Nepali)', { required: true }), T('headline_en', 'शीर्षक (English)', 'Headline (English)'), TA('story_np', 'कथा (नेपाली)', 'Story (Nepali)', { required: true }), TA('story_en', 'कथा (English)', 'Story (English)'),
    TA('institution_help_np', 'संस्थाले गरेको सहयोग (नेपाली)', 'How we helped (Nepali)'), TA('institution_help_en', 'संस्थाले गरेको सहयोग (English)', 'How we helped (English)'), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- engagement
  careers: { group: 'engage', icon: 'briefcase', title: ['रोजगारी', 'Careers'], order: 'id DESC', softDelete: true, fields: [
    T('title_np', 'पद (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'पद (English)', 'Title (English)', { required: true }), T('department', 'विभाग', 'Department'), T('location', 'स्थान', 'Location'),
    T('job_type', 'प्रकार', 'Type'), N('vacancies', 'पद संख्या', 'Vacancies', { list: true }), D('deadline', 'अन्तिम मिति', 'Deadline', { list: true }), T('min_qualification', 'योग्यता', 'Qualification'),
    T('experience_required', 'अनुभव', 'Experience'), T('salary_range', 'तलब', 'Salary'), RT('description_np', 'विवरण', 'Description (Nepali)'), RT('description', 'Description', 'Description (English)'), TA('requirements', 'आवश्यकता', 'Requirements'),
    FILE('attachment', 'विज्ञापन', 'Advertisement'), B('allow_online_apply', 'अनलाइन आवेदन', 'Online apply', { default: 1 }), ACTIVE] },
  auction_notices: { group: 'engage', icon: 'gavel', title: ['लिलाम', 'Auctions'], order: 'id DESC', filters: [{ name: 'status', type: 'select' }], searchExtra: ['tracking_number'],
    rowLinks: [{ href: '/admin/inbox/bid?auction=:id', label: ['बोलपत्र', 'Bids'], icon: 'gavel' }], fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('tracking_number', 'सूचना नं.', 'Notice no.', { list: true, hint: 'खाली = स्वतः / blank = automatic' }),
    SEL('status', 'स्थिति', 'Status', [['upcoming', 'आगामी', 'Upcoming'], ['ongoing', 'जारी', 'Ongoing'], ['completed', 'सम्पन्न', 'Completed'], ['cancelled', 'रद्द', 'Cancelled']], { default: 'upcoming', list: true }),
    T('property_type', 'सम्पत्ति प्रकार', 'Property type'), T('location', 'स्थान', 'Location'),
    N('area_bigha', 'बिगाहा', 'Bigha'), N('area_ropani', 'रोपनी', 'Ropani'), N('area_aana', 'आना', 'Aana'), N('area_paisa', 'पैसा', 'Paisa'),
    T('area', 'क्षेत्रफल', 'Area', { hint: 'खाली = माथिका एकाइबाट / blank = from the units above' }), N('minimum_price', 'न्यूनतम मूल्य', 'Minimum price', { list: true }),
    D('auction_date', 'मिति', 'Date', { list: true }), T('auction_time', 'समय', 'Time'), T('contact_person', 'सम्पर्क व्यक्ति', 'Contact'), T('contact_phone', 'फोन', 'Phone'),
    T('google_map_link', 'नक्सा लिङ्क', 'Map link', { type: 'url' }), T('google_map_embed', 'नक्सा embed', 'Map embed', { hint: 'Google Maps embed iframe वा src URL / iframe or src URL' }),
    IMG('image'), T('images', 'थप फोटोहरू', 'More photos', { type: 'images', max: 10 }), FILE('document', 'सूचना फाइल (PDF/DOC)', 'Notice document (PDF/DOC)', { kind: 'doc' }),
    RT('description', 'विवरण', 'Description'), RT('description_en', 'विवरण (English)', 'Description (English)'), ACTIVE],
  // legacy auctions.php: area text from the units, automatic notice number, embed URL only from Google Maps
  beforeSave: async (data, { existing }) => {
    const units = [['area_bigha', 'बिगाहा'], ['area_ropani', 'रोपनी'], ['area_aana', 'आना'], ['area_paisa', 'पैसा']].filter(([k]) => Number(data[k]) > 0);
    if (!data.area && units.length) data.area = units.map(([k, l]) => `${Number(data[k])} ${l}`).join(' ');
    if (!data.tracking_number && !(existing && existing.tracking_number)) {
      const d = new Date();
      data.tracking_number = `AUC-${require('crypto').randomInt(100000, 1000000)}-${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
    } else if (!data.tracking_number) data.tracking_number = existing.tracking_number;
    if (data.google_map_embed) {
      const e = require('../lib/setting-defs').normalizeMapEmbed(data.google_map_embed);
      if (!e) return { google_map_embed: 'Google Maps को embed वा पूरा लिङ्क / a Google Maps embed or full link' };
      data.google_map_embed = e;
    }
    return {};
  },
  beforeDelete: async (id, { db }) => ((await db.value('SELECT count(*) FROM auction_bids WHERE auction_id = $1', [id])) > 0
    ? ['यो लिलाममा बोलपत्र परेका छन् — मेटाउन मिलेन; स्थिति "रद्द" गर्नुहोस्।', 'This auction has bids and cannot be deleted; set its status to Cancelled instead.'] : null) },
  upcoming_programs: { group: 'engage', icon: 'calendar', title: ['कार्यक्रम', 'Programmes'], order: 'event_date DESC NULLS LAST', fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }),
    SEL('program_type', 'प्रकार', 'Type', [['General', 'सामान्य', 'General'], ['AGM', 'वार्षिक साधारण सभा', 'AGM'], ['SGM', 'विशेष साधारण सभा', 'SGM'], ['Orientation', 'अभिमुखीकरण', 'Orientation'], ['Training', 'तालिम', 'Training'], ['Seminar', 'गोष्ठी', 'Seminar'], ['Workshop', 'कार्यशाला', 'Workshop'], ['Financial_Literacy', 'वित्तीय साक्षरता', 'Financial literacy'], ['Other', 'अन्य', 'Other']], { default: 'General', list: true }),
    D('event_date', 'मिति', 'Date', { list: true }), T('event_time', 'समय', 'Time'),
    T('location', 'स्थान', 'Location', { list: true }), TA('description', 'विवरण', 'Description'), B('pre_registration_open', 'पूर्व दर्ता खुला', 'Pre-registration open'),
    // legacy programs.php fields; a new programme takes them from Programme settings
    B('is_multi_location', 'बहु-स्थान कार्यक्रम', 'Multi-location programme', { hint: 'स्थान थप्दा स्वतः / set automatically when locations are added' }),
    B('instant_attendance', 'तुरुन्त उपस्थिति (स्वीकृति नचाहिने)', 'Instant check-in (no approval)', { hint: 'नयाँमा: कार्यक्रम सेटिङबाट / new: from Programme settings' }),
    B('shared_qr_mode', 'साझा QR (भविष्य)', 'Shared QR (future)', { hint: 'नयाँमा: कार्यक्रम सेटिङबाट / new: from Programme settings' }),
    SEL('eligible_member_scope', 'योग्य सदस्य', 'Eligible members', [['all_active', 'सबै सक्रिय सदस्य', 'All active members'], ['shareholders', 'शेयरधनी (भविष्य)', 'Shareholders (future)'], ['voters', 'मतदाता (भविष्य)', 'Voters (future)']], { default: 'all_active' }), ACTIVE],
  // new programmes take the defaults from Programme settings (legacy admin/programs.php + program-settings.php)
  beforeSave: async (data, { existing }) => {
    if (existing) return {};
    const s = await require('../lib/settings').all();
    data.instant_attendance = s.program_default_instant_attendance === '1' ? 1 : 0;
    data.shared_qr_mode = (s.program_default_shared_qr ?? '1') === '0' ? 0 : 1;
    data.eligible_member_scope = ['all_active', 'shareholders', 'voters'].includes(s.program_default_eligible_scope) ? s.program_default_eligible_scope : 'all_active';
    return {};
  },
  beforeDelete: async (id, { db }) => deactivateIf(await db.value(`SELECT (SELECT count(*) FROM member_program_attendance WHERE program_id = $1 OR parent_program_id = $1)
    + (SELECT count(*) FROM member_program_attendance_requests WHERE program_id = $1) + (SELECT count(*) FROM member_program_preregistrations WHERE program_id = $1)`, [id])),
  afterDelete: async (id, { db }) => {
    await db.query('DELETE FROM program_registration_desks WHERE parent_program_id = $1', [id]);
    await db.query('DELETE FROM program_occurrences WHERE parent_program_id = $1', [id]);
  } },
  sahakari_calendar_events: { group: 'engage', icon: 'calendar', title: ['पात्रो कार्यक्रम', 'Calendar events'], order: 'bs_month, bs_day', filters: [{ name: 'bs_year', type: 'distinct' }], fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'),
    N('bs_year', 'वि.सं. वर्ष (खाली = हरेक वर्ष)', 'BS year (blank = every year)'), N('bs_month', 'महिना (१–१२)', 'Month (1–12)', { required: true, list: true }), N('bs_day', 'गते', 'Day', { required: true, list: true }),
    SEL('recurrence', 'दोहोरिने', 'Repeats', [['yearly', 'हरेक वर्ष', 'Yearly'], ['once', 'एक पटक', 'Once']], { default: 'yearly' }),
    SEL('event_type', 'प्रकार', 'Type', [['agm', 'साधारण सभा', 'AGM'], ['meeting', 'बैठक', 'Meeting'], ['training', 'तालिम', 'Training'], ['holiday', 'बिदा', 'Holiday'], ['deadline', 'अन्तिम मिति', 'Deadline'], ['celebration', 'उत्सव', 'Celebration'], ['other', 'अन्य', 'Other']], { list: true }),
    TA('description_np', 'विवरण', 'Description'), TA('description_en', 'विवरण (English)', 'Description (English)'), ACTIVE] },
  honor_programs: { group: 'engage', icon: 'award', title: ['सम्मान कार्यक्रम', 'Honour programmes'], order: 'id DESC',
    rowLinks: [{ href: '/admin/honor-programs/:id/categories', label: ['विधा', 'Categories'], icon: 'award' }], fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('fiscal_year', 'आ.व.', 'Fiscal year', { list: true }), T('event_label', 'कार्यक्रम लेबल', 'Event label'),
    T('opens_at', 'खुल्ने मिति', 'Opens', { type: 'datetime' }), T('closes_at', 'बन्द मिति', 'Closes', { type: 'datetime', list: true }), TA('instructions_np', 'निर्देशन', 'Instructions'),
    TA('instructions_en', 'निर्देशन (English)', 'Instructions (English)'), B('show_new_badge', '"नयाँ" ब्याज देखाउने', 'Show "New" badge', { default: 1 }), ACTIVE],
  beforeDelete: async (id, { db }) => deactivateIf(await db.value('SELECT count(*) FROM honor_applications WHERE program_id = $1', [id])),
  afterDelete: async (id, { db }) => db.query('DELETE FROM honor_program_categories WHERE program_id = $1', [id]) },
  honor_categories: { group: 'engage', icon: 'award', title: ['सम्मान विधा', 'Honour categories'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { required: true, list: true }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    B('requires_nominee', 'मनोनीत चाहिन्छ', 'Requires nominee'), B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE],
  beforeDelete: async (id, { db }) => deactivateIf(await db.value('SELECT count(*) FROM honor_applications WHERE category_id = $1', [id])),
  afterDelete: async (id, { db }) => db.query('DELETE FROM honor_program_categories WHERE category_id = $1', [id]) },
  welfare_claim_types: { group: 'engage', icon: 'heart', title: ['कल्याण दाबी प्रकार', 'Welfare claim types'], order: 'display_order, id', fields: [
    T('slug', 'कोड', 'Code', { list: true, readonlyOnEdit: true, hint: 'खाली = नामबाट / blank = from the name' }), T('name_np', 'नाम (नेपाली)', 'Name (Nepali)', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'),
    SEL('form_profile', 'फारमका थप विवरण', 'Form fields', [['other', 'सामान्य', 'General'], ['death', 'मृत्यु (मृतक, प्रमाणपत्र, लाभग्राही)', 'Death (deceased, certificate, beneficiary)'], ['maternity', 'सुत्केरी (प्रसूति मिति, अस्पताल)', 'Maternity (delivery date, hospital)'], ['medical', 'उपचार (रोग, उपचार मिति)', 'Medical (illness, treatment date)'], ['accident', 'दुर्घटना', 'Accident'], ['insurance', 'बीमा (पोलिसी नं., बीमा कम्पनी)', 'Insurance (policy no., insurer)']], { default: 'other', list: true }),
    ICON('icon', 'आइकन', 'Icon', { default: 'heart' }), T('color', 'रङ', 'Colour', { default: '#ff9800', hint: '#ff9800' }), B('requires_document', 'कागजात चाहिन्छ', 'Requires document'), ORDER, ACTIVE], ...typeGuard('welfare_claim_types', 'member_welfare_claims', 'claim_type') },
  election_cycles: { minRole: 'admin', group: 'engage', icon: 'vote', title: ['निर्वाचन', 'Elections'], order: 'sort_order, date_from DESC NULLS LAST', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('period_label', 'अवधि', 'Period'),
    D('date_from', 'देखि', 'From'), D('date_to', 'सम्म', 'To'), TA('intro_np', 'परिचय', 'Introduction'), TA('intro_en', 'परिचय (English)', 'Introduction (English)'), B('is_published', 'प्रकाशित', 'Published', { list: true }),
    B('show_in_navbar', 'मेनुमा "निर्वाचन" देखाउने', 'Show "Elections" in the site menu', { list: true }), N('sort_order', 'क्रम', 'Order', { default: 0 }),
    B('voting_enabled', 'अनलाइन मतदान सक्रिय', 'Voting enabled', { list: true }), T('vote_start_at', 'मतदान खुल्ने समय', 'Voting opens', { type: 'datetime', hint: 'नेपाल समय / Nepal time' }),
    T('vote_end_at', 'मतदान बन्द हुने समय', 'Voting closes', { type: 'datetime' })],
  // legacy election-information.php: enabling voting needs both times, and closing must follow opening
  beforeSave: async data => {
    const errors = {};
    if (Number(data.voting_enabled) && (!data.vote_start_at || !data.vote_end_at)) errors.vote_start_at = 'मतदान सक्रिय गर्न खुल्ने/बन्द समय अनिवार्य / both times are required to enable voting';
    if (data.vote_start_at && data.vote_end_at && Date.parse(data.vote_end_at) < Date.parse(data.vote_start_at)) errors.vote_end_at = 'बन्द समय खुल्ने समयभन्दा पछि हुनुपर्छ / must be after the opening time';
    return errors;
  },
  // legacy election-information.php: a cycle with ballots/attendance is never deleted; otherwise its whole tree goes in one transaction
  beforeDelete: async (id, { db }) => ((await db.value('SELECT count(*) FROM election_vote_submissions WHERE cycle_id = $1', [id])) > 0
    ? ['यो निर्वाचनमा मतपत्र/उपस्थिति छ — मेटाउन मिलेन; मतदान बन्द वा अप्रकाशित गर्नुहोस्।', 'This election has ballots or attendance and cannot be deleted; turn voting off or unpublish it instead.'] : null),
  afterDelete: async (id, { db }) => {
    for (const t of ['election_votes', 'election_vote_submissions', 'election_candidates', 'election_positions', 'election_milestones']) await db.query(`DELETE FROM ${t} WHERE cycle_id = $1`, [id]);
  } },
  election_posts: { minRole: 'admin', group: 'engage', icon: 'layers', title: ['निर्वाचन पद मास्टर', 'Election post master'], order: 'display_order, id', fields: [
    REF('designation_id', 'पद/दर्जा (मास्टर)', 'Designation (master)', 'designations', 'title_np', { required: true, list: true }), T('title_np', 'पद (नेपाली)', 'Post (Nepali)', { list: true, hint: 'खाली = मास्टरबाट / blank = from designation' }), T('title_en', 'पद (English)', 'Post (English)'),
    REF('committee_type_id', 'समिति', 'Committee', 'committee_types', 'name_np', { list: true }), N('default_seats', 'पद संख्या', 'Default seats', { default: 1, list: true }), N('default_max_votes', 'अधिकतम मत', 'Default max votes', { default: 1 }), ORDER, ACTIVE],
  // legacy election-posts.php: titles come from the designation master; a post used by an election cannot be deleted
  beforeSave: async (data, { db }) => {
    const d = data.designation_id ? await db.one('SELECT title_np, title_en FROM designations WHERE id = $1 AND is_active = 1', [Number(data.designation_id)]) : null;
    if (!d) return { designation_id: 'पद मास्टरबाट पद छान्नुहोस् / choose a designation' };
    data.title_np = data.title_np || d.title_np; data.title_en = data.title_en || d.title_en || '';
    data.default_seats = Math.max(1, Number(data.default_seats) || 1); data.default_max_votes = Math.max(1, Number(data.default_max_votes) || 1);
    return {};
  },
  beforeDelete: async (id, { db }) => ((await db.value('SELECT count(*) FROM election_positions WHERE post_id = $1', [id])) > 0 ? ['यो पद कुनै चक्रमा प्रयोग भएको छ — मेटाउन मिलेन।', 'This post is used by an election and cannot be deleted.'] : null) },
  election_positions: { minRole: 'admin', group: 'engage', icon: 'vote', title: ['निर्वाचन पद', 'Election positions'], order: 'cycle_id DESC, display_order', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true, list: true }), REF('post_id', 'पद मास्टर', 'Post master', 'election_posts', 'title_np', { hint: 'छानेमा खाली विवरण मास्टरबाट भरिन्छ / fills blank fields' }),
    T('title_np', 'पद (नेपाली)', 'Position (Nepali)', { list: true }), T('title_en', 'पद (English)', 'Position (English)'),
    N('seats', 'पद संख्या', 'Seats', { list: true }), N('max_votes_per_voter', 'अधिकतम मत', 'Max votes'), REF('committee_type_id', 'समिति (विजेता यहाँ जान्छन्)', 'Committee (winners go here)', 'committee_types', 'name_np'), ORDER, ACTIVE],
  // legacy election-candidates.php save_position: auto-fill from the post master
  beforeSave: async (data, { body }) => {
    await require('../lib/elections').applyPostDefaults(data, body);
    data.seats = Math.max(1, Number(data.seats) || 1); data.max_votes_per_voter = Math.max(1, Number(data.max_votes_per_voter) || 1);
    return data.title_np ? {} : { title_np: 'आवश्यक छ / required' };
  },
  beforeDelete: async (id, { db }) => deactivateIf(await db.value('SELECT count(*) FROM election_votes WHERE position_id = $1', [id])),
  afterDelete: async (id, { db }) => db.query('DELETE FROM election_candidates WHERE position_id = $1', [id]) },
  election_candidates: { minRole: 'admin', group: 'engage', icon: 'user', title: ['उम्मेदवार', 'Candidates'], order: 'cycle_id DESC, position_id, display_order', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true }), REF('position_id', 'पद', 'Position', 'election_positions', 'title_np', { required: true, list: true }),
    IMG('photo', 'फोटो', 'Photo', { list: true }), T('name', 'नाम', 'Name', { required: true, list: true }), T('name_en', 'नाम (English)', 'Name (English)'), T('symbol_no', 'चिन्ह नं.', 'Symbol no.'),
    T('phone', 'फोन', 'Phone'), T('email', 'इमेल', 'Email', { type: 'email' }), T('address', 'ठेगाना', 'Address'), TA('bio_np', 'परिचय', 'Bio'), TA('bio_en', 'परिचय (English)', 'Bio (English)'), ORDER, ACTIVE],
  beforeDelete: async (id, { db }) => deactivateIf(await db.value('SELECT count(*) FROM election_votes WHERE candidate_id = $1', [id])) },
  election_milestones: { minRole: 'admin', group: 'engage', icon: 'calendar', title: ['निर्वाचन कार्यतालिका', 'Election schedule'], order: 'cycle_id DESC, event_date', fields: [
    REF('cycle_id', 'निर्वाचन', 'Election', 'election_cycles', 'title_np', { required: true, list: true }), D('event_date', 'मिति', 'Date', { required: true, list: true }),
    T('title_np', 'कार्य (नेपाली)', 'Item (Nepali)', { required: true, list: true }), T('title_en', 'कार्य (English)', 'Item (English)'),
    TA('detail_np', 'विवरण (नेपाली)', 'Details (Nepali)'), TA('detail_en', 'विवरण (English)', 'Details (English)'), FILE('attachment', 'सूचना', 'Notice'), ORDER, ACTIVE] },

  // ---------------------------------------------------------------- links
  important_links: { group: 'links', icon: 'link', title: ['महत्त्वपूर्ण लिङ्क', 'Important links'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }), ORDER, ACTIVE] },
  useful_links: { group: 'links', icon: 'link', title: ['उपयोगी लिङ्क', 'Useful links'], order: 'display_order, id', fields: [
    T('title_np', 'शीर्षक (नेपाली)', 'Title (Nepali)', { list: true }), T('title', 'शीर्षक (English)', 'Title (English)', { required: true }), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }),
    TA('description_np', 'विवरण (नेपाली)', 'Description (Nepali)'), TA('description', 'विवरण (English)', 'Description (English)'), ICON('icon', 'आइकन', 'Icon', { default: 'link' }),
    B('is_popup', 'तैरने "उपयोगी लिङ्क" पपअपमा देखाउने', 'Show in the floating "Useful links" popup', { list: true }), ORDER, ACTIVE] },
  satisfaction_links: { group: 'links', icon: 'star', title: ['सन्तुष्टि लिङ्क', 'Satisfaction links'], order: 'display_order, id', links: [['/admin/satisfaction', 'settings', 'विजेट सेटिङ', 'Widget setting']], fields: [
    T('title', 'शीर्षक', 'Title', { required: true, list: true }), T('title_en', 'शीर्षक (English)', 'Title (English)'), T('url', 'URL', 'URL', { type: 'url', required: true, list: true }), ICON('icon', 'आइकन', 'Icon', { default: 'star' }), ORDER, ACTIVE] },
  notification_templates: { minRole: 'admin', group: 'links', icon: 'mail', title: ['SMS/इमेल ढाँचा', 'Message templates'], order: 'event_type, audience, channel', fields: [
    SEL('event_type', 'घटना', 'Event', [
      ['submitted', 'आवेदन प्राप्त (सबै)', 'Application received (all)'], ['status_changed', 'स्थिति परिवर्तन (सबै)', 'Status changed (all)'],
      ['loan_application', 'नयाँ ऋण आवेदन (कार्यालय)', 'New loan application (office)'], ['kyc_application', 'नयाँ केवाइएम (कार्यालय)', 'New KYM (office)'],
      ['account_application', 'नयाँ खाता आवेदन (कार्यालय)', 'New account application (office)'], ['grievance', 'गुनासो', 'Grievance'],
      ['appointment', 'भेटघाट', 'Appointment'], ['digital_service', 'डिजिटल सेवा', 'Digital service'], ['honor_application', 'सम्मान आवेदन', 'Honour application'],
      ['job_application', 'नयाँ जागिर आवेदन (कार्यालय)', 'New job application (office)'], ['contact_message', 'नयाँ सम्पर्क सन्देश (कार्यालय)', 'New contact message (office)'],
      ['membership_application', 'नयाँ सदस्यता अनुरोध (कार्यालय)', 'New membership request (office)'], ['welfare_claim', 'नयाँ कल्याण दाबी (कार्यालय)', 'New welfare claim (office)'],
      ['loan', 'ऋण — स्थिति (आवेदक)', 'Loan — status (applicant)'], ['kyc', 'केवाइएम — स्थिति (आवेदक)', 'KYM — status (applicant)'], ['account', 'खाता — स्थिति (आवेदक)', 'Account — status (applicant)'],
    ], { required: true, list: true, hint: 'कार्यालय: प्रशासक; आवेदक: स्थिति परिवर्तन / office events go to admin recipients, applicant events on status change' }),
    SEL('audience', 'प्राप्तकर्ता', 'Audience', [['member', 'आवेदक', 'Applicant'], ['admin', 'प्रशासक', 'Admin']], { required: true, list: true }),
    SEL('channel', 'माध्यम', 'Channel', [['sms', 'SMS', 'SMS'], ['email', 'इमेल', 'Email']], { required: true, list: true }),
    T('subject', 'विषय (इमेल)', 'Subject (email)'), TA('body', 'सन्देश', 'Message', { required: true, hint: '{{name}} {{tracking_id}} {{module}} {{status}} {{remarks}} {{amount}} {{date}} {{details}} {{site}}' }),
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
  r.fileFields = r.fields.filter(f => f.type === 'image' || f.type === 'file' || f.type === 'images');
  r.listFields = r.fields.filter(f => f.list);
  // bulk activate / deactivate on every list with an "active" switch (faqs.php / services.php bulk_status); opt out with bulk: false
  if (r.bulk === undefined && r.fields.some(f => f.name === 'is_active')) r.bulk = true;
}

module.exports = { resources, GROUPS };
