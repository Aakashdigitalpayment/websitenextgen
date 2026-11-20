'use strict';
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const nd = require('../lib/nepali-date');
const util = require('../lib/util');
const forms = require('../lib/forms');
const modules = require('../modules/applications');
const { upload } = require('../lib/uploads');
const { isBot, flash } = require('../lib/security');
const exchange = require('../lib/exchange-rate');
const notify = require('../lib/notify');
const aiChat = require('../lib/ai-chat');
const notifyLater = fn => require('../lib/notify').later(fn);
const seo = require('../lib/seo');
const antispam = require('../lib/antispam');
const memberAccess = require('../lib/member-access');
const teamLib = require('../lib/team');
const submissions = require('../lib/submissions');
const kym = require('../lib/kym');

const router = express.Router();
router.use(seo.middleware);

// floating widgets in the footer: satisfaction links (when enabled) + useful links flagged is_popup
const widgetCache = new Map();
router.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  const schema = db.currentSchema();
  const hit = widgetCache.get(schema);
  if (hit && Date.now() - hit.at < 30_000) { res.locals.floatWidgets = hit.data; return next(); }
  Promise.all([
    res.locals.settings.satisfaction_widget_enabled === '1' ? db.many('SELECT title, title_en, url FROM satisfaction_links WHERE is_active = 1 ORDER BY display_order, id LIMIT 6') : [],
    db.many('SELECT title, title_np, url FROM useful_links WHERE is_active = 1 AND is_popup = 1 ORDER BY display_order, id LIMIT 8'),
  ]).then(([satisfaction, useful]) => {
    const ok = l => /^(https?:\/\/|\/(?!\/))/i.test(l.url || '');
    const data = { satisfaction: satisfaction.filter(ok), useful: useful.filter(ok) };
    widgetCache.set(schema, { at: Date.now(), data });
    res.locals.floatWidgets = data;
    next();
  }).catch(next);
});

router.use(require('../lib/legacy-urls').publicRedirects); // PHP-era URLs (printed QR codes, bookmarks) → new routes

// daily visitor/page-view counter for the admin dashboard (no personal data stored)
router.use((req, res, next) => {
  if (req.method !== 'GET' || /\.(xml|txt|js|css|png|jpe?g|svg|ico|webmanifest)$/i.test(req.path) || req.path.startsWith('/api/')) return next();
  if (/bot|crawl|spider|slurp|preview|monitor|curl|wget|headless/i.test(req.get('user-agent') || '')) return next();
  const today = new Date(Date.now() + 345 * 60_000).toISOString().slice(0, 10);
  const newVisitor = !(req.get('cookie') || '').includes('cv=' + today);
  if (newVisitor) res.cookie('cv', today, { maxAge: 86400_000, httpOnly: true, sameSite: 'lax' });
  notifyLater(() => db.query(`INSERT INTO visitor_stats (visit_date, visitor_count, page_views, created_at) VALUES ($1, $2, 1, now())
                               ON CONFLICT (visit_date) DO UPDATE SET visitor_count = visitor_stats.visitor_count + EXCLUDED.visitor_count, page_views = visitor_stats.page_views + 1, updated_at = now()`, [today, newVisitor ? 1 : 0]));
  next();
});
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const ACTIVE = 'is_active = 1';
const NOT_DELETED = 'deleted_at IS NULL';

const submitLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).render('public/error', { title: 'Too many requests', code: 429, message: res.locals.t('धेरै अनुरोध भयो। केही समयपछि प्रयास गर्नुहोस्।', 'Too many submissions. Please try again later.') }),
});

// ---------------------------------------------------------------- home
router.get('/', ah(async (req, res) => {
  const [sliders, services, notices, news, rates, stats, features, popup, programs, profile, links] = await Promise.all([
    db.many(`SELECT * FROM sliders WHERE ${ACTIVE} ORDER BY display_order, id LIMIT 6`),
    db.many(`SELECT * FROM services WHERE ${ACTIVE} ORDER BY display_order, id LIMIT 6`),
    db.many(`SELECT * FROM notices WHERE ${ACTIVE} AND ${NOT_DELETED} ORDER BY notice_date DESC NULLS LAST, id DESC LIMIT 5`),
    db.many(`SELECT * FROM news WHERE ${ACTIVE} AND ${NOT_DELETED} ORDER BY created_at DESC LIMIT 3`),
    db.many(`SELECT * FROM interest_rates WHERE ${ACTIVE} ORDER BY category DESC, display_order, id LIMIT 8`),
    db.many('SELECT stat_key, stat_value FROM site_stats'),
    db.many(`SELECT * FROM why_choose_features WHERE ${ACTIVE} ORDER BY sort_order, id LIMIT 6`),
    db.one(`SELECT * FROM notices WHERE ${ACTIVE} AND ${NOT_DELETED} AND is_popup = 1 AND (popup_expires_at IS NULL OR popup_expires_at >= CURRENT_DATE) ORDER BY id DESC LIMIT 1`),
    db.many(`SELECT * FROM upcoming_programs WHERE ${ACTIVE} AND event_date >= CURRENT_DATE AND parent_program_id IS NULL ORDER BY event_date LIMIT 3`),
    db.one(`SELECT * FROM institutional_profile WHERE ${ACTIVE} AND access_level = 'none' ORDER BY fiscal_year DESC, report_month DESC NULLS LAST, id DESC LIMIT 1`),
    db.many(`SELECT * FROM satisfaction_links WHERE ${ACTIVE} ORDER BY display_order, id LIMIT 4`),
  ]);
  res.render('public/home', { sliders, services, notices, news, rates, stats: Object.fromEntries(stats.map(s => [s.stat_key, s.stat_value])), features, popup, programs, profile, links });
}));

// ---------------------------------------------------------------- about
router.get('/about', ah(async (req, res) => {
  const [features, awards] = await Promise.all([
    db.many(`SELECT * FROM why_choose_features WHERE ${ACTIVE} ORDER BY sort_order, id`),
    db.many(`SELECT * FROM awards WHERE ${ACTIVE} ORDER BY display_order, award_date DESC NULLS LAST LIMIT 4`),
  ]);
  res.render('public/about', { title: res.locals.t('हाम्रो बारेमा', 'About us'), features, awards });
}));

router.get('/vision-mission', (req, res) => {
  const s = res.locals.settings, t = res.locals.t;
  // NP/EN text and titles per section (legacy pages.php?tab=static); English falls back to Nepali
  const en = req.lang === 'en';
  const pick = (a, b) => (en ? s[b] || s[a] : s[a] || s[b]);
  const blocks = [['vision_content', 'दृष्टिकोण', 'Vision'], ['mission_content', 'लक्ष्य', 'Mission'], ['values_content', 'मूल्य मान्यता', 'Values']]
    .map(([k, np, enT]) => [pick(k + '_title_np', k + '_title_en') || t(np, enT), pick(k + '_np', k + '_en') || s[k]]).filter(b => b[1]);
  res.render('public/vision', { title: t('दृष्टिकोण र लक्ष्य', 'Vision & mission'), blocks });
});

// leadership message: settings first (name / photo / designation / title / message, NP + EN), then the team member flagged is_chairman / is_ceo
router.get('/message/:who', ah(async (req, res, next) => {
  const s = res.locals.settings, en = req.lang === 'en';
  const who = req.params.who;
  if (who !== 'chairman' && who !== 'ceo') return next();
  const get = (k, dflt = '') => String(s[k] || '').trim() || dflt;
  const pick = (np, enKey) => (en ? get(enKey) || get(np) : get(np) || get(enKey));
  const person = await db.one(`SELECT * FROM team_members WHERE ${ACTIVE} AND ${who === 'chairman' ? 'is_chairman' : 'is_ceo'} = 1 ORDER BY display_order, id LIMIT 1`);
  const designation = en ? get(`${who}_designation_en`, who === 'chairman' ? 'Chairman' : 'Chief Executive Officer') : get(`${who}_designation_np`, who === 'chairman' ? 'अध्यक्ष' : 'प्रमुख कार्यकारी अधिकृत');
  const name = pick(`${who}_name`, `${who}_name_en`) || (person ? res.locals.f(person, 'name') : '') || designation;
  const message = (en ? get(`${who}_message_en`) || get(`${who}_message_np`) || get(`${who}_message`) : get(`${who}_message_np`) || get(`${who}_message`) || get(`${who}_message_en`));
  const title = pick(`${who}_message_title_np`, `${who}_message_title_en`) || (en ? `${designation}'s message` : `${designation}को सन्देश`);
  res.render('public/message', {
    title, description: en ? `Message from the ${designation} of our cooperative.` : `हाम्रो सहकारीका ${designation}को सन्देश।`,
    message, name: name !== designation ? name : '', role: designation, photo: get(`${who}_photo`) || person?.photo || '', ogImage: get(`${who}_photo`) || person?.photo || null,
    breadcrumbs: [[en ? 'About' : 'हाम्रो बारेमा', '/about']],
  });
}));

// ---------------------------------------------------------------- services
router.get('/services', ah(async (req, res) => {
  const [cats, services] = await Promise.all([
    db.many(`SELECT * FROM service_categories WHERE ${ACTIVE} ORDER BY display_order, id`),
    db.many(`SELECT * FROM services WHERE ${ACTIVE} ORDER BY display_order, id`),
  ]);
  res.render('public/services', { title: res.locals.t('हाम्रा सेवाहरू', 'Our services'), cats, services });
}));

router.get('/services/:id', ah(async (req, res, next) => {
  const service = await db.one(`SELECT * FROM services WHERE id = $1 AND ${ACTIVE}`, [util.int(req.params.id)]);
  if (!service) return next();
  const products = await db.many(`SELECT * FROM service_products WHERE service_id = $1 AND ${ACTIVE} ORDER BY display_order, id`, [service.id]);
  res.render('public/service-detail', { title: res.locals.f(service, 'title'), service, products });
}));

router.get('/interest-rates', ah(async (req, res) => {
  const rates = await db.many(`SELECT * FROM interest_rates WHERE ${ACTIVE} ORDER BY display_order, id`);
  const updated = rates.reduce((a, r) => (r.updated_at && (!a || r.updated_at > a) ? r.updated_at : a), null);
  res.render('public/interest-rates', { title: res.locals.t('ब्याजदर', 'Interest rates'), saving: rates.filter(r => r.category === 'saving'), loan: rates.filter(r => r.category === 'loan'), updated });
}));

router.get('/digital-services', ah(async (req, res) => {
  const types = await db.many(`SELECT * FROM digital_service_types WHERE ${ACTIVE} ORDER BY display_order, id`);
  const features = await db.many(`SELECT * FROM app_features WHERE ${ACTIVE} ORDER BY sort_order, id`);
  res.render('public/digital-services', { title: res.locals.t('डिजिटल सेवा', 'Digital services'), types, features });
}));

router.get('/service-centers', ah(async (req, res) => {
  const centers = await db.many(`SELECT * FROM service_centers WHERE ${ACTIVE} ORDER BY is_main_branch DESC, display_order, id`);
  res.render('public/service-centers', { title: res.locals.t('सेवा केन्द्र तथा शाखा', 'Branches & service centres'), centers });
}));

router.get('/partner-facilities', ah(async (req, res) => {
  const partners = await db.many(`SELECT * FROM partner_facilities WHERE ${ACTIVE} ORDER BY is_featured DESC, display_order, id`);
  res.render('public/partners', { title: res.locals.t('साझेदार सुविधा', 'Partner discounts'), partners });
}));

// ---------------------------------------------------------------- people
router.get('/team', ah(async (req, res) => {
  const t = res.locals.t;
  const data = await teamLib.load();
  const { cat, sections, officers } = teamLib.sections(data, typeof req.query.menu === 'string' ? req.query.menu : '');
  res.render('public/team', { title: cat ? res.locals.f(cat, 'name') : t('हाम्रो टिम', 'Our team'), cat, sections, officers, menus: data.cats.filter(c => Number(c.show_in_nav)), breadcrumbs: [[t('हाम्रो बारेमा', 'About'), '/about']] });
}));

router.get('/committees', ah(async (req, res) => {
  const types = await db.many(`SELECT * FROM committee_types WHERE ${ACTIVE} ORDER BY display_order, id`);
  if (types.length === 1) return res.redirect('/committees/' + types[0].id);
  res.render('public/committees', { title: res.locals.t('समितिहरू', 'Committees'), types });
}));

router.get('/committees/:id', ah(async (req, res, next) => {
  const type = await db.one(`SELECT * FROM committee_types WHERE id = $1 AND ${ACTIVE}`, [util.int(req.params.id)]);
  if (!type) return next();
  const tenures = await db.many(`SELECT * FROM committee_tenures WHERE committee_type_id = $1 AND ${ACTIVE} ORDER BY is_current DESC, start_date DESC NULLS LAST, id DESC`, [type.id]);
  const tenure = tenures.find(x => String(x.id) === req.query.tenure) || tenures[0];
  const members = tenure ? await db.many(`SELECT * FROM committee_members WHERE tenure_id = $1 AND ${ACTIVE} ORDER BY display_order, id`, [tenure.id]) : [];
  res.render('public/committee', { title: res.locals.f(type, 'name'), type, tenures, tenure, members });
}));

router.get('/awards', ah(async (req, res) => {
  const awards = await db.many(`SELECT * FROM awards WHERE ${ACTIVE} ORDER BY display_order, award_date DESC NULLS LAST`);
  const spotlight = await db.many(`SELECT * FROM member_of_year WHERE ${ACTIVE} ORDER BY spotlight_year DESC LIMIT 6`);
  res.render('public/awards', { title: res.locals.t('सम्मान तथा पुरस्कार', 'Awards & honours'), awards, spotlight });
}));

router.get('/success-stories', ah(async (req, res) => {
  const stories = await db.many(`SELECT * FROM member_success_stories WHERE ${ACTIVE} ORDER BY display_order, id DESC`);
  res.render('public/stories', { title: res.locals.t('सफलताका कथा', 'Success stories'), stories });
}));

// ---------------------------------------------------------------- news & notices
async function listing(req, table, where, order, perPage = 12) {
  const total = await db.value(`SELECT count(*) FROM ${table} WHERE ${where}`);
  const pg = util.paginate(total, util.int(req.query.page, 1), perPage);
  const rows = await db.many(`SELECT * FROM ${table} WHERE ${where} ORDER BY ${order} LIMIT ${pg.perPage} OFFSET ${pg.offset}`);
  return { rows, pg };
}

router.get('/news', ah(async (req, res) => {
  const { rows, pg } = await listing(req, 'news', `${ACTIVE} AND ${NOT_DELETED}`, 'created_at DESC, id DESC', 9);
  res.render('public/news', { title: res.locals.t('समाचार', 'News'), items: rows, pg });
}));

router.get('/news/:id', ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM news WHERE id = $1 AND ${ACTIVE} AND ${NOT_DELETED}`, [util.int(req.params.id)]);
  if (!item) return next();
  const more = await db.many(`SELECT id, title, title_np, image, created_at FROM news WHERE ${ACTIVE} AND ${NOT_DELETED} AND id <> $1 ORDER BY created_at DESC LIMIT 4`, [item.id]);
  const content = res.locals.f(item, 'content');
  res.locals.jsonLd.push(seo.newsArticle(req, res.locals.settings, { headline: res.locals.f(item, 'title'), desc: util.excerpt(content, 158), url: res.locals.seo.canonical, date: item.created_at, image: item.image }, req.lang === 'en'));
  res.render('public/article', { title: res.locals.f(item, 'title'), description: util.excerpt(content, 158), ogImage: item.image || null, breadcrumbs: [[res.locals.t('समाचार', 'News'), '/news']], item, content, image: item.image, date: item.created_at, more, base: '/news', crumb: res.locals.t('समाचार', 'News') });
}));

router.get('/notices', ah(async (req, res) => {
  const { rows, pg } = await listing(req, 'notices', `${ACTIVE} AND ${NOT_DELETED}`, 'notice_date DESC NULLS LAST, id DESC', 15);
  res.render('public/notices', { title: res.locals.t('सूचनाहरू', 'Notices'), items: rows, pg });
}));

router.get('/notices/:id', ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM notices WHERE id = $1 AND ${ACTIVE} AND ${NOT_DELETED}`, [util.int(req.params.id)]);
  if (!item) return next();
  const more = await db.many(`SELECT id, title, title_np, notice_date AS created_at FROM notices WHERE ${ACTIVE} AND ${NOT_DELETED} AND id <> $1 ORDER BY notice_date DESC NULLS LAST LIMIT 5`, [item.id]);
  const content = res.locals.f(item, 'content');
  res.locals.jsonLd.push(seo.newsArticle(req, res.locals.settings, { headline: res.locals.f(item, 'title'), desc: util.excerpt(content, 158), url: res.locals.seo.canonical, date: item.notice_date || item.created_at, image: item.popup_image }, req.lang === 'en'));
  res.render('public/article', { title: res.locals.f(item, 'title'), description: util.excerpt(content, 158), ogImage: item.popup_image || null, breadcrumbs: [[res.locals.t('सूचना', 'Notices'), '/notices']], item, content, image: item.popup_image, attachment: item.attachment, date: item.notice_date || item.created_at, more, base: '/notices', crumb: res.locals.t('सूचना', 'Notices') });
}));

// ---------------------------------------------------------------- media & documents
router.get('/gallery', ah(async (req, res) => {
  const albums = await db.many(`SELECT * FROM gallery_albums WHERE ${ACTIVE} ORDER BY display_order, id DESC`);
  const album = util.int(req.query.album, 0);
  const images = await db.many(
    `SELECT * FROM gallery WHERE ${ACTIVE} AND ${NOT_DELETED} ${album ? 'AND album_id = $1' : ''} ORDER BY display_order, id DESC LIMIT 200`, album ? [album] : []);
  res.render('public/gallery', { title: res.locals.t('ग्यालरी', 'Gallery'), albums, album, images });
}));

router.get('/downloads', ah(async (req, res) => {
  const cat = String(req.query.category || '');
  const cats = (await db.many(`SELECT DISTINCT category FROM downloads WHERE ${ACTIVE} AND ${NOT_DELETED} AND category IS NOT NULL AND category <> '' ORDER BY 1`)).map(r => r.category);
  const items = await db.many(`SELECT * FROM downloads WHERE ${ACTIVE} AND ${NOT_DELETED} ${cat ? 'AND category = $1' : ''} ORDER BY id DESC`, cat ? [cat] : []);
  res.render('public/downloads', { title: res.locals.t('डाउनलोड', 'Downloads'), items, cats, cat });
}));

router.get('/downloads/:id/file', ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM downloads WHERE id = $1 AND ${ACTIVE} AND ${NOT_DELETED}`, [util.int(req.params.id)]);
  if (!item || !item.file_path) return next();
  await db.query('UPDATE downloads SET download_count = COALESCE(download_count, 0) + 1 WHERE id = $1', [item.id]);
  res.redirect(require('../lib/uploads').mediaUrl(item.file_path));
}));

// reports: files are served only through /reports/:id/file; members-only ones need a member / staff login or a membership-number unlock
router.get('/reports', ah(async (req, res) => {
  const memberOk = memberAccess.unlocked(req);
  const items = await db.many(`SELECT * FROM reports WHERE ${ACTIVE} ${memberOk ? '' : "AND COALESCE(access_level, 'none') <> 'member'"} ORDER BY report_year DESC NULLS LAST, display_order, id DESC`);
  const locked = memberOk ? 0 : await db.value(`SELECT count(*) FROM reports WHERE ${ACTIVE} AND access_level = 'member'`);
  res.render('public/reports', { title: res.locals.t('प्रतिवेदनहरू', 'Reports'), items, locked, unlockError: req.session.unlockError || null, breadcrumbs: [[res.locals.t('हाम्रो बारेमा', 'About'), '/about']] });
  delete req.session.unlockError;
}));

const unlockLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip),
  handler: (req, res) => { req.session.unlockError = res.locals.t('धेरै पटक प्रयास भयो। केही समयपछि फेरि प्रयास गर्नुहोस्।', 'Too many attempts. Please try again later.'); res.redirect('/reports'); } });
router.post('/reports/unlock', unlockLimiter, ah(async (req, res) => {
  const r = await memberAccess.tryUnlock(req, req.body.membership_no, req.body.mobile);
  if (r.ok) flash(req, 'success', res.locals.t('सदस्य प्रतिवेदन खुला भयो।', 'Members-only reports unlocked.'));
  else req.session.unlockError = res.locals.t(...r.error);
  res.redirect('/reports');
}));

router.get('/reports/:id/file', ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM reports WHERE id = $1', [util.int(req.params.id)]);
  if (!item || !item.file_path || (!Number(item.is_active) && !req.admin)) return next();
  const level = memberAccess.normalizeLevel(item.access_level);
  if (!memberAccess.canOpen(req, level)) {
    return res.status(403).render('public/error', { title: res.locals.t('सदस्यका लागि मात्र', 'Members only'), code: 403, message: res.locals.t('यो प्रतिवेदन सदस्यका लागि मात्र हो। लगइन गर्नुहोस् वा सदस्यता नम्बरले खोल्नुहोस्।', 'This report is for members only. Log in or unlock it with your membership number.') });
  }
  let stored = item.file_path;
  // legacy public path of a members-only report: move it into private storage on first access
  const rel = String(stored).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
  if (level === 'member' && !rel.startsWith('_private/') && !/^https?:/i.test(rel)) {
    const fs = require('fs'), path = require('path'), up = require('../lib/uploads');
    const from = up.resolveStored(req, rel), to = up.resolveStored(req, '_private/' + rel);
    if (from && to && fs.existsSync(from)) {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.renameSync(from, to);
      stored = '_private/' + rel;
      await db.query('UPDATE reports SET file_path = $1 WHERE id = $2', [stored, item.id]);
    }
  }
  if (/^https?:/i.test(stored)) return level === 'member' ? next() : res.redirect(stored);
  require('../lib/uploads').sendStored(req, res, next, stored, { viewOnly: Number(item.view_only) === 1 });
}));

router.get('/institutional-profile', ah(async (req, res) => {
  const rows = await db.many(`SELECT * FROM institutional_profile WHERE ${ACTIVE} ${req.member ? '' : "AND access_level = 'none'"} ORDER BY fiscal_year DESC, report_month DESC NULLS LAST, id DESC LIMIT 24`);
  const welfare = rows[0] ? await require('../lib/welfare').forProfile(rows[0]) : [];
  res.render('public/institutional-profile', { title: res.locals.t('संस्थागत विवरण', 'Institutional profile'), rows, latest: rows[0], welfare });
}));

// report attachment through an access check — members-only reports never sit under public /uploads (legacy institutional-profile-file.php)
router.get('/institutional-profile/:id/file', ah(async (req, res, next) => {
  const row = await db.one('SELECT id, fiscal_year, attachment_path, access_level, is_active FROM institutional_profile WHERE id = $1', [util.int(req.params.id)]);
  if (!row || !row.attachment_path || (!Number(row.is_active) && !req.admin)) return next();
  if (row.access_level === 'member' && !req.member && !req.admin) return res.redirect('/member/login?next=' + encodeURIComponent(req.originalUrl));
  require('../lib/uploads').sendStored(req, res, next, row.attachment_path);
}));

router.get('/important-links', ah(async (req, res) => {
  const [links, useful] = await Promise.all([
    db.many(`SELECT * FROM important_links WHERE ${ACTIVE} ORDER BY display_order, id`),
    db.many(`SELECT * FROM useful_links WHERE ${ACTIVE} ORDER BY display_order, id`),
  ]);
  res.render('public/links', { title: res.locals.t('उपयोगी लिङ्कहरू', 'Useful links'), links: [...links, ...useful] });
}));

router.get('/faqs', ah(async (req, res) => {
  const faqs = await db.many(`SELECT * FROM faqs WHERE ${ACTIVE} ORDER BY category, display_order, id`);
  const ld = seo.faqPage(faqs, req.lang === 'en');
  if (ld) res.locals.jsonLd.push(ld);
  res.render('public/faqs', { title: res.locals.t('बारम्बार सोधिने प्रश्नहरू', 'Frequently asked questions'), faqs });
}));

router.get('/page/:slug', ah(async (req, res, next) => {
  const page = await db.one(`SELECT * FROM pages WHERE slug = $1 AND ${ACTIVE}`, [req.params.slug]);
  if (!page) return next();
  res.render('public/page', { title: res.locals.f(page, 'title'), html: util.richText(res.locals.f(page, 'content')) });
}));

// ---------------------------------------------------------------- careers & auctions & elections
router.get('/careers', ah(async (req, res) => {
  const jobs = await db.many(`SELECT * FROM careers WHERE ${ACTIVE} AND ${NOT_DELETED} ORDER BY (deadline IS NULL OR deadline >= CURRENT_DATE) DESC, deadline NULLS LAST, id DESC`);
  res.render('public/careers', { title: res.locals.t('रोजगारीका अवसर', 'Careers'), jobs });
}));

router.get('/careers/:id', ah(async (req, res, next) => {
  const job = await db.one(`SELECT * FROM careers WHERE id = $1 AND ${ACTIVE} AND ${NOT_DELETED}`, [util.int(req.params.id)]);
  if (!job) return next();
  const open = (!job.deadline || job.deadline >= new Date().toISOString().slice(0, 10)) && Number(job.allow_online_apply ?? 1) === 1;
  res.render('public/career-detail', { title: res.locals.f(job, 'title'), job, open });
}));

router.get('/auctions', ah(async (req, res) => {
  const items = await db.many(`SELECT * FROM auction_notices WHERE ${ACTIVE} ORDER BY CASE status WHEN 'ongoing' THEN 1 WHEN 'upcoming' THEN 2 ELSE 3 END, auction_date DESC NULLS LAST, id DESC`);
  res.render('public/auctions', { title: res.locals.t('लिलाम सूचना', 'Auction notices'), items });
}));

router.get('/auctions/:id', ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM auction_notices WHERE id = $1 AND ${ACTIVE}`, [util.int(req.params.id)]);
  if (!item) return next();
  const bids = await db.value('SELECT count(*) FROM auction_bids WHERE auction_id = $1', [item.id]);
  res.render('public/auction-detail', { title: res.locals.f(item, 'title'), item, bids, open: require('../lib/auctions').isOpen(item), images: String(item.images || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean) });
}));

router.get('/elections', ah(async (req, res) => {
  const cycles = await db.many('SELECT * FROM election_cycles WHERE is_published = 1 ORDER BY sort_order, date_from DESC NULLS LAST, id DESC');
  res.render('public/elections', { title: res.locals.t('निर्वाचन', 'Elections'), cycles });
}));

router.get('/elections/:id', ah(async (req, res, next) => {
  const cycle = await db.one('SELECT * FROM election_cycles WHERE id = $1 AND is_published = 1', [util.int(req.params.id)]);
  if (!cycle) return next();
  const [milestones, positions, candidates] = await Promise.all([
    db.many(`SELECT * FROM election_milestones WHERE cycle_id = $1 AND ${ACTIVE} ORDER BY event_date, display_order`, [cycle.id]),
    db.many(`SELECT * FROM election_positions WHERE cycle_id = $1 AND ${ACTIVE} ORDER BY display_order, id`, [cycle.id]),
    db.many(`SELECT * FROM election_candidates WHERE cycle_id = $1 AND ${ACTIVE} ORDER BY display_order, id`, [cycle.id]),
  ]);
  res.render('public/election-detail', { title: res.locals.f(cycle, 'title'), cycle, milestones, positions, candidates });
}));

// ---------------------------------------------------------------- tools
router.get('/emi-calculator', (req, res) => {
  const amount = Number(req.query.amount) || 500000, rate = Number(req.query.rate) || 12, months = util.int(req.query.months, 60);
  const r = rate / 1200;
  const emi = months > 0 ? (r ? amount * r * (1 + r) ** months / ((1 + r) ** months - 1) : amount / months) : 0;
  const schedule = [];
  let bal = amount;
  for (let i = 1; i <= Math.min(months, 360); i++) {
    const interest = bal * r, principal = emi - interest;
    bal = Math.max(0, bal - principal);
    schedule.push({ i, emi, interest, principal, bal });
  }
  res.render('public/emi', { title: res.locals.t('EMI क्याल्कुलेटर', 'EMI calculator'), amount, rate, months, emi, total: emi * months, schedule });
});

router.get('/date-converter', (req, res) => {
  const out = {};
  if (req.query.bs) out.ad = nd.bsToAd(req.query.bs) || 'invalid';
  if (req.query.ad) out.bs = nd.adToBs(req.query.ad) || 'invalid';
  res.render('public/date-converter', { title: res.locals.t('मिति परिवर्तन', 'Date converter'), out, today: nd.todayBs() });
});

router.get('/calendar', ah(async (req, res) => {
  const [ty, tm] = nd.todayBs().split('-').map(Number);
  let y = util.int(req.query.y, ty), m = util.int(req.query.m, tm);
  if (!nd.isValidBs(y, m, 1)) { y = ty; m = tm; }
  const grid = nd.monthGrid(y, m);
  const events = await db.many(`SELECT * FROM sahakari_calendar_events WHERE ${ACTIVE} AND bs_month = $1 AND (bs_year = $2 OR bs_year IS NULL OR recurrence = 'yearly') ORDER BY bs_day`, [m, y]);
  const prev = m === 1 ? [y - 1, 12] : [y, m - 1];
  const next = m === 12 ? [y + 1, 1] : [y, m + 1];
  res.render('public/calendar', { title: res.locals.t('सहकारी पात्रो', 'Cooperative calendar'), grid, events, prev, next, today: nd.todayBs() });
}));

router.get('/exchange-rate', ah(async (req, res) => {
  const data = await exchange.latest();
  res.render('public/exchange-rate', { title: res.locals.t('विदेशी मुद्रा विनिमय दर', 'Foreign exchange rates'), data });
}));

// ---------------------------------------------------------------- contact
router.get('/contact', ah(async (req, res) => {
  const centers = await db.many(`SELECT * FROM service_centers WHERE ${ACTIVE} ORDER BY is_main_branch DESC, display_order LIMIT 6`);
  antispam.mathPrompt(req, res, 'contact');
  res.render('public/contact', { title: res.locals.t('सम्पर्क', 'Contact us'), centers, values: {}, errors: {} });
}));

router.post('/contact', submitLimiter, ah(async (req, res) => {
  const mod = modules.contact;
  if (isBot(req)) { flash(req, 'success', res.locals.t('सन्देश पठाइयो।', 'Message sent.')); return res.redirect('/contact'); }
  const block = await antispam.check(req, res.locals.settings, [req.body.subject, req.body.message, req.body.name], 'contact');
  if (block && block.silent) { flash(req, 'success', res.locals.t('सन्देश पठाइयो।', 'Message sent.')); return res.redirect('/contact'); }
  const { data, errors } = forms.validate(mod, req.body, {}, {}, req.lang);
  if (block) errors._form = res.locals.t(...block.message);
  if (Object.keys(errors).length) {
    const centers = await db.many(`SELECT * FROM service_centers WHERE ${ACTIVE} ORDER BY is_main_branch DESC, display_order LIMIT 6`);
    antispam.mathPrompt(req, res, 'contact');
    return res.status(422).render('public/contact', { title: res.locals.t('सम्पर्क', 'Contact us'), centers, values: req.body, errors });
  }
  const row = await forms.insertSubmission(mod, data, { is_read: 0 });
  notify.later(() => notify.adminEvent(mod, { name: row.name, details: { 'नाम': row.name, 'फोन': row.phone || '', 'इमेल': row.email || '', 'विषय': row.subject, 'सन्देश': util.excerpt(row.message, 300) } }));
  flash(req, 'success', res.locals.t('धन्यवाद! तपाईंको सन्देश प्राप्त भयो।', 'Thank you! Your message has been received.'));
  res.redirect('/contact');
}));

// ---------------------------------------------------------------- applications (generic form engine)
router.get('/apply', ah(async (req, res) => {
  const honorOpen = (await forms.optionSources.honorPrograms()).length > 0;
  const list = Object.values(modules).filter(m => !m.hidden || (m.key === 'honor' && honorOpen));
  res.render('public/apply-index', { title: res.locals.t('अनलाइन सेवा', 'Online services'), list });
}));

/** honor-apply.php: no open programme → "applications closed" with the upcoming ones (opens / closes in B.S.). */
async function renderHonorClosed(req, res, status = 200) {
  const upcoming = await db.many('SELECT * FROM honor_programs WHERE is_active = 1 AND opens_at > now() ORDER BY opens_at LIMIT 10');
  res.status(status).render('public/honor-closed', { title: res.locals.t(...modules.honor.title), mod: modules.honor, upcoming });
}

const prefillFromMember = (member, mod) => {
  if (!member) return {};
  const v = {};
  v[mod.nameCol] = member.name_np || member.name;
  v[mod.phoneCol] = member.phone;
  v.email = member.email;
  if (mod.memberCol) v[mod.memberCol] = member.sadasyata_number || member.member_card_no;
  v.address = member.address; v.permanent_address = member.address;
  return v;
};

// ---------------------------------------------------------------- public KYM: verify first (online-kyc.php public_kym_verify)
const KYM_GATE_TTL = 2 * 3600_000;
const KYM_LOCKABLE = new Set([undefined, 'text', 'email', 'tel', 'select', 'radio', 'bsdate', 'date', 'textarea', 'geo', 'number', 'url', 'address']);
/** Member ID + mobile verified in this session (2 h, this tenant only). */
function kymGate(req) {
  const g = req.session.kymGate;
  return g && g.tenantId === req.tenant.id && Date.now() - g.at <= KYM_GATE_TTL ? g : null;
}
/** Stored KYM values of the verified Member ID; non-empty ones are locked on the public form (memberSsotPrefillEmptyOnlyFromKyc). */
async function kymLocked(gate) {
  const own = await kym.findKycByMemberId(gate.memberId, true);
  const stored = own ? forms.rowToValues(modules.kyc, own) : {};
  const locked = new Set(['member_id', 'mobile']);
  for (const f of modules.kyc.fields) if (KYM_LOCKABLE.has(f.type) && String(stored[f.name] ?? '').trim() !== '') locked.add(f.name);
  stored.member_id = gate.memberId;
  stored.mobile = gate.mobile;
  return { own, stored, locked };
}
/** Server-side values for every locked field (address parts included): what is on file is never taken from the POST. */
function lockedBody(body, stored, locked) {
  const out = { ...body };
  for (const f of modules.kyc.fields) {
    if (!locked.has(f.name)) continue;
    out[f.name] = stored[f.name];
    if (f.type === 'address') for (const k of ['province', 'district', 'municipality', 'ward', 'tole']) out[f.prefix + '_' + k] = stored[f.prefix + '_' + k] ?? '';
    if (f.sameAs) delete out[f.sameAs.toggle];
  }
  return out;
}
function renderKymGate(req, res, { error = null, values = {}, status = 200 } = {}) {
  antispam.mathPrompt(req, res, 'kycgate');
  res.status(status).render('public/kyc-gate', { title: res.locals.t(...modules.kyc.title), mod: modules.kyc, error, values });
}
const gateLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip),
  handler: (req, res) => renderKymGate(req, res, { status: 429, error: res.locals.t('धेरै पटक प्रयास भयो। केही समयपछि फेरि प्रयास गर्नुहोस्।', 'Too many attempts. Please try again later.') }) });
router.post('/apply/kyc/verify', gateLimiter, ah(async (req, res) => {
  if (req.member) return res.redirect('/apply/kyc');
  const values = { member_id: String(req.body.member_id || '').slice(0, 50), mobile: String(req.body.mobile || '').slice(0, 20) };
  if (isBot(req)) return renderKymGate(req, res, { values });
  const block = await antispam.check(req, res.locals.settings, [], 'kycgate');
  if (block) return renderKymGate(req, res, { status: 422, values, error: block.message ? res.locals.t(...block.message) : null });
  const auth = require('../lib/auth');
  const key = 'kycgate:' + (kym.normalizeId(values.member_id) || '-');
  if (await auth.tooManyAttempts(key, req.ip)) return renderKymGate(req, res, { status: 429, values, error: res.locals.t('धेरै पटक गलत प्रयास भयो। १५ मिनेटपछि फेरि प्रयास गर्नुहोस्।', 'Too many failed attempts. Try again in 15 minutes.') });
  const g = await kym.requireMemberIdAndMobile(values.member_id, values.mobile);
  if (!g.ok) {
    await auth.recordFailure(key, req.ip);
    return renderKymGate(req, res, { status: 422, values, error: res.locals.t(...g.error) });
  }
  await auth.clearFailures(key, req.ip);
  req.session.kymGate = { memberId: kym.normalizeId(values.member_id), mobile: kym.normalizeMobile(values.mobile), at: Date.now(), tenantId: req.tenant.id };
  res.redirect('/apply/kyc?verified=1');
}));
router.post('/apply/kyc/reset', (req, res) => { delete req.session.kymGate; res.redirect('/apply/kyc'); });

async function renderForm(req, res, mod, values = {}, errors = {}, status = 200) {
  const options = await forms.resolveOptions(mod);
  let activeProgram = null;
  if (mod.key === 'honor') {
    if (!options.program_id.length) return renderHonorClosed(req, res, status);
    const pick = String(values.program_id || req.query.program || options.program_id[0][0]);
    activeProgram = await db.one('SELECT * FROM honor_programs WHERE id = $1', [Number(options.program_id.find(o => o[0] === pick)?.[0] || options.program_id[0][0])]);
  }
  let existingDocs = {};
  let locked = null, lockedValues = null;
  if (mod.capture) res.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
  if (mod.key === 'kyc' && !req.member) {
    const gate = kymGate(req);
    if (!gate) return renderKymGate(req, res, { status: status === 200 ? 200 : 403, error: status === 200 ? null : res.locals.t('पहिले सदस्यता नम्बर र मोबाइल प्रमाणित गर्नुहोस्।', 'Please verify your Member ID and mobile first.') });
    const k = await kymLocked(gate);
    if (k.own) existingDocs = Object.fromEntries(kym.DOC_KEYS.map(d => [d, !!k.own[d]]));
    values = status === 200 ? { ...k.stored, ...values } : lockedBody(values, k.stored, k.locked);
    locked = k.locked;
    lockedValues = k.stored;
  }
  if (mod.key === 'kyc' && req.member) {
    const own = await kym.loadLinkedKyc(req.member);
    if (own) {
      existingDocs = Object.fromEntries(kym.DOC_KEYS.map(k => [k, !!own[k]]));
      if (status === 200) values = { ...forms.rowToValues(mod, own), ...values };
    }
    if (req.member.sadasyata_number) values.member_id = req.member.sadasyata_number;
  }
  // member identity (member-prefill-block.php): shown read-only, never posted
  let identity = null, kycStatus = null;
  const skipFields = new Set();
  if (mod.memberGate) {
    if (req.member) {
      const own = await kym.loadLinkedKyc(req.member);
      identity = kym.identityFrom(own, req.member);
      kycStatus = own ? own.status : 'none';
    }
    const mode = req.member ? 'all' : mod.memberGate.always ? 'personal' : null;
    for (const f of mod.fields) if (forms.identitySkipped(mod, f, mode)) skipFields.add(f.name);
  }
  antispam.mathPrompt(req, res, 'apply:' + mod.key);
  if (req.query.program) values.program_id = values.program_id || req.query.program;
  if (req.query.career) values.career_id = values.career_id || req.query.career;
  if (req.query.auction) values.auction_id = values.auction_id || req.query.auction;
  res.status(status).render('public/apply-form', { title: res.locals.t(...mod.title), mod, options, values: { ...(mod.memberGate ? {} : prefillFromMember(req.member, mod)), ...values }, errors, existingDocs, lockMemberId: mod.key === 'kyc' && !!req.member?.sadasyata_number,
    identity, kycStatus, skipFields, locked, lockedValues, kymGateOk: !!locked, guestEmailRequired: !!(mod.guestEmail && !req.member), activeProgram,
    draftKey: `draft:${req.tenant.slug}:${mod.key}`, hasValues: status !== 200 || (mod.key === 'kyc' && (!!req.member || !!locked)) });
}

router.get('/apply/:key', ah(async (req, res, next) => {
  const mod = Object.hasOwn(modules, req.params.key) ? modules[req.params.key] : null;
  if (!mod || mod.key === 'contact') return next();
  await renderForm(req, res, mod);
}));

/** Free-text fields scanned for links / promo spam on every form (contact-spam-guard.php); KYM AML fields are skipped (addresses look like domains). */
const SPAM_NAMES = ['subject', 'message', 'loan_purpose', 'collateral_description', 'other_income', 'description', 'request_details', 'cover_letter', 'purpose_detail', 'suggestions', 'remarks', 'business_note'];
const spamParts = (mod, body) => mod.fields.filter(f => f.store !== 'aml' && (f.type === 'textarea' || SPAM_NAMES.includes(f.name))).map(f => body[f.name]);
router.post('/apply/:key', submitLimiter, (req, res, next) => {
  const mod = Object.hasOwn(modules, req.params.key) ? modules[req.params.key] : null;
  if (!mod || mod.key === 'contact') return next();
  if (mod.key === 'kyc' && !req.member && !kymGate(req)) {
    return renderKymGate(req, res, { status: 403, error: res.locals.t('पहिले सदस्यता नम्बर र मोबाइल प्रमाणित गर्नुहोस्।', 'Please verify your Member ID and mobile first.') });
  }
  const chain = mod.fileFields.length ? upload(mod.key, mod.fileFields.map(f => ({ name: f.name, kind: f.type === 'image' ? 'image' : f.kind, maxCount: f.multiple || 1 })), { private: true, fieldSizeMb: mod.capture ? 8 : 0 }) : [];
  let i = 0;
  const step = err => (err ? next(err) : i < chain.length ? chain[i++](req, res, step) : handle());
  const handle = () => (async () => {
    if (isBot(req)) return res.redirect('/');
    if (mod.key === 'kyc' && !req.member) {
      const gate = kymGate(req);
      if (!gate) return renderForm(req, res, mod, {}, { _upload: 'gate' }, 403);
      const k = await kymLocked(gate);
      req.body = lockedBody(req.body, k.stored, k.locked);
    }
    // camera / signature pad (public/js/kyc-capture.js): a data: URL in <field>_data when no file was chosen
    if (mod.capture) {
      for (const f of mod.fileFields) {
        const durl = req.body[f.name + '_data'];
        if (f.type !== 'image' || (req.uploaded && req.uploaded[f.name]) || typeof durl !== 'string' || !durl.startsWith('data:image/')) continue;
        const saved = require('../lib/uploads').saveDataUrl(req, mod.key, durl, { private: true, maxMb: 5 });
        if (typeof saved === 'string') { req.uploaded = req.uploaded || {}; req.uploaded[f.name] = saved; } else req.uploadError = saved.error;
      }
    }
    const scan = spamParts(mod, req.body);
    const block = await antispam.check(req, res.locals.settings, scan, 'apply:' + mod.key);
    if (block && block.silent) return res.redirect('/');
    const options = await forms.resolveOptions(mod);
    const { data, errors } = forms.validate(mod, req.body, req.uploaded, options, req.lang, { skipIdentity: submissions.identityMode(mod, req.member, req.body) });
    if (block) errors._upload = res.locals.t(...block.message);
    if (req.uploadError) errors._upload = req.uploadError;
    if (Object.keys(errors).length) return renderForm(req, res, mod, req.body, errors, 422);
    const extra = {};
    if (req.member) extra.member_portal_id = req.member.id; // dropped by db.pick for tables without the column
    if (mod.key === 'honor') extra.is_member = data.member_id ? 1 : 0;
    if (mod.key === 'job' || mod.key === 'survey') extra.is_read = 0;
    const out = await submissions.submit(mod, data, { body: req.body, member: req.member, options, lang: req.lang, extra, ip: req.ip });
    if (out.errors) return renderForm(req, res, mod, req.body, out.errors, 422);
    const row = out.row;
    if (out.duplicate) {
      req.session.lastSubmission = { module: mod.key, tracking: row.tracking_id || null, notice: out.notice };
      return res.redirect(`/apply/${mod.key}/done`);
    }
    if (req.member) {
      await notify.notifyMember(req.member.id, res.locals.t(...mod.title), res.locals.t('तपाईंको आवेदन प्राप्त भयो। ट्र्याकिङ नं: ', 'Application received. Tracking no: ') + (row.tracking_id || row.id), '/track?id=' + encodeURIComponent(row.tracking_id || ''));
    }
    notify.later(() => require('../lib/webhooks').emit('application.submitted', { type: mod.key, id: row.id, tracking_id: row.tracking_id || null, status: row.status || null,
      applicant: { name: row[mod.nameCol] || null, phone: row[mod.phoneCol] || null, email: row.email || null }, created_at: row.created_at }));
    if (row.tracking_id) {
      const details = submissions.details(mod, row, options);
      notify.later(() => notify.applicationEvent('submitted', { name: row[mod.nameCol], tracking_id: row.tracking_id, module: mod.title[0],
        amount: mod.amountCol && row[mod.amountCol] ? 'Rs. ' + util.money(row[mod.amountCol]) : '', date: mod.dateCol ? row[mod.dateCol] || '' : '', details }, { phone: row[mod.phoneCol], email: row.email || row.bidder_email }, mod));
    } else if (mod.adminEvent) {
      notify.later(() => notify.adminEvent(mod, { name: row[mod.nameCol], details: submissions.details(mod, row, options) }));
    }
    req.session.lastSubmission = { module: mod.key, tracking: row.tracking_id || null, notice: out.notice || null };
    if (mod.key === 'kyc') delete req.session.kymGate;
    res.redirect(`/apply/${mod.key}/done`);
  })().catch(next);
  step();
});

router.get('/apply/:key/done', (req, res, next) => {
  const mod = Object.hasOwn(modules, req.params.key) ? modules[req.params.key] : null;
  const last = req.session.lastSubmission;
  if (!mod || !last || last.module !== mod.key) return res.redirect('/apply/' + req.params.key);
  res.render('public/apply-done', { title: res.locals.t(...mod.title), mod, tracking: last.tracking, notice: last.notice || null, draftKey: `draft:${req.tenant.slug}:${mod.key}` });
});

// ---------------------------------------------------------------- tracker, signed ID-card preview, ID card verification
router.use(require('./public-members'));

const verifyPartners = (card, member) => (card && member && card.status === 'active'
  ? db.many(`SELECT id, partner_name, partner_name_en, (pin_hash IS NOT NULL AND pin_hash <> '') AS has_pin FROM partner_facilities WHERE ${ACTIVE} ORDER BY display_order, partner_name`) : []);

// partner desk: log a service used by the member verified above (legacy verify.php log_service + logMemberPartnerService)
const serviceLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip), standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/verify/service', serviceLimiter, ah(async (req, res) => {
  const pv = req.session.partnerVerify;
  const title = res.locals.t('सदस्य परिचयपत्र प्रमाणीकरण', 'Verify member ID card');
  const fresh = pv && Number(pv.mid) === util.int(req.body.member_id) && Date.now() - pv.at <= 30 * 60_000;
  if (!fresh) return res.status(403).render('public/verify', { title, result: null, code: '', mode: 'name', form: {}, partnerPref: '', partners: [], log: { ok: false, text: res.locals.t('पहिले सदस्य प्रमाणित गर्नुहोस्, अनि मात्र सेवा लग गर्नुहोस्।', 'Please verify the member first, then log the service.') } });
  const partnerId = util.int(req.body.partner_id, 0);
  const r = partnerId ? await require('../lib/partners').logService({
    memberId: pv.mid, cardNo: pv.card, partnerId, serviceName: req.body.service_name, taken: req.body.service_taken !== 'no', note: req.body.service_note, pin: req.body.partner_pin, ip: req.ip,
  }) : { ok: false, error: 'partner' };
  const errors = {
    pin: res.locals.t('साझेदार डेस्क PIN गलत भयो।', 'Partner desk PIN is incorrect.'), locked: res.locals.t('धेरै गलत PIN — यो साझेदार डेस्क १५ मिनेट रोकिएको छ।', 'Too many wrong PINs — this partner desk is locked for 15 minutes.'), partner: res.locals.t('साझेदार संस्था छान्नुहोस्।', 'Please select a partner organisation.'),
    duplicate: res.locals.t('यो साझेदारमा भर्खरै लग भइसकेको छ (९० सेकेन्ड)।', 'Already logged for this partner just now (90 s).'), invalid: res.locals.t('सेवा लग असफल।', 'Service log failed.'),
  };
  if (r.ok) pv.at = Date.now();
  const card = pv.code ? await db.one('SELECT * FROM member_id_cards WHERE upper(verification_code) = $1', [String(pv.code || '').toUpperCase()]) : null;
  const member = await db.one('SELECT * FROM members WHERE id = $1', [pv.mid]);
  const kyc = member ? await require('../lib/member-portal').linkedKyc(member) : null;
  res.status(r.ok ? 200 : 422).render('public/verify', {
    title, code: pv.code, mode: pv.code ? 'code' : 'name', form: {}, partnerPref: String(partnerId || ''),
    result: member ? { card, member, kyc, valid: true, hasPhoto: !!(kyc?.photo || member.avatar_url) } : null, partners: await verifyPartners(card || { status: 'active' }, member),
    log: r.ok ? { ok: true, text: res.locals.t(`सेवा लग भयो — ${r.partner.partner_name}।`, `Service logged — ${r.partner.partner_name_en || r.partner.partner_name}.`) } : { ok: false, text: errors[r.error] || errors.invalid },
  });
}));

/** Office reply attachment for the applicant (tracking number + the phone used on the application). */
const attachLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip) });
router.get('/track/attachment', attachLimiter, ah(async (req, res, next) => {
  const id = String(req.query.id || '').trim().toUpperCase();
  const given = nd.toLatinDigits(String(req.query.phone || '')).replace(/\D/g, '').slice(-8);
  if (!id || given.length < 6) return next();
  for (const mod of Object.values(modules)) {
    if (mod.noTracking || !mod.attachCol) continue;
    const row = await db.one(`SELECT * FROM ${mod.table} WHERE upper(tracking_id) = $1 LIMIT 1`, [id]);
    if (!row) continue;
    const rowPhone = String(row[mod.phoneCol] || '').replace(/\D/g, '').slice(-8);
    if (rowPhone.length < 6 || rowPhone !== given || !row[mod.attachCol]) return next();
    return require('../lib/uploads').sendStored(req, res, next, row[mod.attachCol]);
  }
  next();
}));

// ---------------------------------------------------------------- form helpers: BS calendar data + Nepal address (static, cached)
let formData = null;
router.get('/js/form-data.js', (req, res) => {
  formData = formData || 'window.BS_MONTH_DAYS=' + JSON.stringify(require('../lib/bs-month-days.json')) + ';\nwindow.NEPAL_ADDRESS=' + JSON.stringify(require('../lib/nepal-address.json')) + ';\n';
  res.type('application/javascript').set('Cache-Control', 'public, max-age=86400').send(formData);
});


router.use('/marketplace', require('./marketplace').pub);

// ---------------------------------------------------------------- website assistant (AI chat)
const chatLimiter = rateLimit({
  windowMs: 10 * 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false,
  keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip),
  handler: (req, res) => res.status(429).json({ answer: res.locals.t('धेरै प्रश्न भए। केही समयपछि प्रयास गर्नुहोस्।', 'Too many questions. Please try again later.'), source: 'limit' }),
});
router.post('/api/chat', chatLimiter, ah(async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 500);
  if (!message) return res.status(400).json({ answer: '', source: 'empty' });
  // conversation history lives in the session — clients cannot inject fake "assistant" turns
  const history = Array.isArray(req.session.chat) ? req.session.chat : [];
  const answer = await aiChat.reply(message, history, req.lang);
  req.session.chat = [...history, { role: 'user', content: message }, { role: 'assistant', content: String(answer.answer || '').slice(0, 1000) }].slice(-6);
  res.json(answer);
}));

router.get('/programs', ah(async (req, res) => {
  const [upcoming, past] = await Promise.all([
    db.many('SELECT * FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL AND (event_date IS NULL OR event_date >= CURRENT_DATE) ORDER BY event_date NULLS LAST LIMIT 30'),
    db.many('SELECT title, location, event_date FROM upcoming_programs WHERE is_active = 1 AND parent_program_id IS NULL AND event_date < CURRENT_DATE ORDER BY event_date DESC LIMIT 20'),
  ]);
  res.render('public/programs', { title: res.locals.t('कार्यक्रमहरू', 'Programmes'), upcoming, past });
}));

/**
 * Public pre-registration (verify.php program_preregister) — Member ID AND the registered mobile, not the member number alone.
 * Failures share the login throttle.
 */
const preregLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip) });
router.post('/programs/:id/register', preregLimiter, ah(async (req, res) => {
  const t = res.locals.t, back = () => res.redirect('/programs');
  if (isBot(req)) return back();
  const p = await db.one('SELECT * FROM upcoming_programs WHERE id = $1 AND is_active = 1 AND pre_registration_open = 1', [util.int(req.params.id)]);
  if (!p) { flash(req, 'error', t('यो कार्यक्रममा पूर्व दर्ता खुला छैन।', 'Pre-registration is not open for this programme.')); return back(); }
  const portal = require('../lib/member-portal'), auth = require('../lib/auth');
  const key = 'prereg:' + (portal.normalizeId(req.body.member_no) || '-');
  if (await auth.tooManyAttempts(key, req.ip)) { flash(req, 'error', t('धेरै पटक गलत प्रयास भयो। १५ मिनेटपछि फेरि प्रयास गर्नुहोस्।', 'Too many failed attempts. Try again in 15 minutes.')); return back(); }
  const m = await portal.findBySadasyata(req.body.member_no);
  const kyc = m ? await portal.linkedKyc(m) : null;
  if (!m || m.approval_status !== 'approved' || !Number(m.is_active) || !(portal.phonesMatch(req.body.mobile, m.phone) || portal.phonesMatch(req.body.mobile, kyc?.mobile))) {
    await auth.recordFailure(key, req.ip);
    flash(req, 'error', t('सदस्यता नं. र दर्ता भएको मोबाइल मिलेन।', 'Member ID and registered mobile do not match.'));
    return back();
  }
  const dup = await db.value('SELECT 1 FROM member_program_preregistrations WHERE member_id = $1 AND program_id = $2', [m.id, p.id]);
  if (!dup) {
    await db.query(`INSERT INTO member_program_preregistrations (member_id, member_card_no, member_name, phone, email, program_id, program_title, event_date, source, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'public_verify', now()) ON CONFLICT DO NOTHING`,
      [m.id, m.member_card_no || m.sadasyata_number || null, m.name_np || m.name, m.phone, m.email, p.id, p.title, p.event_date]);
  }
  flash(req, dup ? 'info' : 'success', dup ? t('तपाईं पहिले नै दर्ता हुनुहुन्छ।', 'You are already registered.') : t(`पूर्व दर्ता भयो — ${p.title}`, `You are registered — ${p.title}`));
  back();
}));

// QR codes printed at programmes point here; members sign in and confirm
router.get('/attend', (req, res) => res.redirect('/member/attend?t=' + encodeURIComponent(String(req.query.t || '').replace(/[^A-Za-z0-9_-]/g, ''))));

// ---------------------------------------------------------------- PWA
router.get('/manifest.webmanifest', (req, res) => {
  const s = res.locals.settings;
  const has = s.site_favicon || s.logo;
  res.type('application/manifest+json').send(JSON.stringify({
    name: res.locals.siteName, short_name: (s.pwa_short_name || res.locals.siteName).slice(0, 24), start_url: '/', scope: '/', display: 'standalone',
    background_color: '#fafaf9', theme_color: res.locals.brandColor, lang: 'ne',
    icons: has ? [192, 512].map(n => ({ src: `/pwa-icon-${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any' })) : [],
  }));
});
// square PNG app icons from the favicon or logo (legacy includes/pwa-icons.php), cached per source file
router.get('/pwa-icon-:size.png', ah(async (req, res, next) => {
  const size = Number(req.params.size);
  const src = res.locals.settings.site_favicon || res.locals.settings.logo;
  if (![192, 512].includes(size) || !src) return next();
  const up = require('../lib/uploads');
  const file = up.resolveStored(req, src);
  if (!file || !require('fs').existsSync(file) || !/\.(png|jpe?g|webp|gif)$/i.test(file)) return next();
  const path = require('path'), fs = require('fs');
  const dir = path.join(up.tenantDir(req), '_pwa');
  const out = path.join(dir, `${require('crypto').createHash('sha1').update(src + fs.statSync(file).mtimeMs).digest('hex').slice(0, 12)}-${size}.png`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(dir, { recursive: true });
    await require('sharp')(file).resize(size, size, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).png().toFile(out);
  }
  res.set({ 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }).type('image/png').sendFile(path.basename(out), { root: path.resolve(dir) }); // root: the install path may contain dot folders
}));
router.get('/offline', (req, res) => res.render('public/error', { title: res.locals.t('इन्टरनेट छैन', 'You are offline'), code: '', message: res.locals.t('इन्टरनेट जडान जाँच गरेर फेरि प्रयास गर्नुहोस्।', 'Check your connection and try again.') }));

// ---------------------------------------------------------------- SEO
// landscape share card (1200×630) used as og:image when no seo_og_image is uploaded
router.get('/share-og.svg', (req, res) => {
  res.set('Cache-Control', 'public, max-age=3600').set('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
    .type('image/svg+xml').send(seo.shareCardSvg(req, res.locals.settings, res.locals.siteName, res.locals.brandColor));
});
router.get('/robots.txt', (req, res) => {
  res.type('text').send(`User-agent: *\nDisallow: /admin\nDisallow: /member\nSitemap: ${req.protocol}://${req.get('host')}/sitemap.xml\n`);
});

router.get('/sitemap.xml', ah(async (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  const staticPaths = ['/', '/about', '/services', '/interest-rates', '/team', '/news', '/notices', '/downloads', '/gallery', '/careers', '/contact', '/apply', '/emi-calculator', '/faqs', '/reports'];
  const [news, notices, pages] = await Promise.all([
    db.many(`SELECT id FROM news WHERE ${ACTIVE} AND ${NOT_DELETED} ORDER BY id DESC LIMIT 500`),
    db.many(`SELECT id FROM notices WHERE ${ACTIVE} AND ${NOT_DELETED} ORDER BY id DESC LIMIT 500`),
    db.many(`SELECT slug FROM pages WHERE ${ACTIVE}`),
  ]);
  const urls = [...staticPaths, ...news.map(n => '/news/' + n.id), ...notices.map(n => '/notices/' + n.id), ...pages.map(p => '/page/' + encodeURIComponent(p.slug))];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${util.escapeHtml(base + u)}</loc></url>`).join('')}</urlset>`);
}));

module.exports = router;
