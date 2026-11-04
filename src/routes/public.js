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

const router = express.Router();

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
  const blocks = [
    [t('दृष्टिकोण', 'Vision'), s.vision_content_np || s.vision_content],
    [t('लक्ष्य', 'Mission'), s.mission_content_np || s.mission_content],
    [t('मूल्य मान्यता', 'Values'), s.values_content_np || s.values_content],
  ].filter(b => b[1]);
  res.render('public/vision', { title: t('दृष्टिकोण र लक्ष्य', 'Vision & mission'), blocks });
});

router.get('/message/:who', ah(async (req, res, next) => {
  const s = res.locals.settings, t = res.locals.t;
  const who = req.params.who;
  if (who !== 'chairman' && who !== 'ceo') return next();
  const person = await db.one(`SELECT * FROM team_members WHERE ${ACTIVE} AND category = $1 ORDER BY display_order, id LIMIT 1`, [who === 'chairman' ? 'board' : 'management']);
  res.render('public/message', {
    title: who === 'chairman' ? t('अध्यक्षको सन्देश', "Chairperson's message") : t('प्रमुख कार्यकारी अधिकृतको सन्देश', "CEO's message"),
    message: s[`${who}_message_np`] || s[`${who}_message`] || '',
    photo: s[`${who}_photo`] || person?.photo, name: s[`${who}_name`] || person?.name, role: s[`${who}_designation_np`] || person?.position,
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
  const people = await db.many(`SELECT * FROM team_members WHERE ${ACTIVE} ORDER BY CASE category WHEN 'board' THEN 1 WHEN 'management' THEN 2 ELSE 3 END, display_order, id`);
  const t = res.locals.t;
  const groups = [
    ['board', t('सञ्चालक समिति', 'Board')], ['management', t('व्यवस्थापन', 'Management')], ['staff', t('कर्मचारी', 'Staff')],
  ].map(([k, label]) => ({ label, people: people.filter(p => p.category === k) })).filter(g => g.people.length);
  const officers = people.filter(p => p.is_information_officer || p.is_grievance_officer);
  res.render('public/team', { title: t('हाम्रो टिम', 'Our team'), groups, officers });
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
  res.render('public/article', { title: res.locals.f(item, 'title'), item, content: res.locals.f(item, 'content'), image: item.image, date: item.created_at, more, base: '/news', crumb: res.locals.t('समाचार', 'News') });
}));

router.get('/notices', ah(async (req, res) => {
  const { rows, pg } = await listing(req, 'notices', `${ACTIVE} AND ${NOT_DELETED}`, 'notice_date DESC NULLS LAST, id DESC', 15);
  res.render('public/notices', { title: res.locals.t('सूचनाहरू', 'Notices'), items: rows, pg });
}));

router.get('/notices/:id', ah(async (req, res, next) => {
  const item = await db.one(`SELECT * FROM notices WHERE id = $1 AND ${ACTIVE} AND ${NOT_DELETED}`, [util.int(req.params.id)]);
  if (!item) return next();
  const more = await db.many(`SELECT id, title, title_np, notice_date AS created_at FROM notices WHERE ${ACTIVE} AND ${NOT_DELETED} AND id <> $1 ORDER BY notice_date DESC NULLS LAST LIMIT 5`, [item.id]);
  res.render('public/article', { title: res.locals.f(item, 'title'), item, content: res.locals.f(item, 'content'), image: item.popup_image, attachment: item.attachment, date: item.notice_date || item.created_at, more, base: '/notices', crumb: res.locals.t('सूचना', 'Notices') });
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

router.get('/reports', ah(async (req, res) => {
  const memberOk = !!req.member;
  const items = await db.many(`SELECT * FROM reports WHERE ${ACTIVE} ${memberOk ? '' : "AND access_level = 'none'"} ORDER BY report_year DESC NULLS LAST, display_order, id DESC`);
  const locked = memberOk ? 0 : await db.value(`SELECT count(*) FROM reports WHERE ${ACTIVE} AND access_level = 'member'`);
  res.render('public/reports', { title: res.locals.t('प्रतिवेदनहरू', 'Reports'), items, locked });
}));

router.get('/institutional-profile', ah(async (req, res) => {
  const rows = await db.many(`SELECT * FROM institutional_profile WHERE ${ACTIVE} ${req.member ? '' : "AND access_level = 'none'"} ORDER BY fiscal_year DESC, report_month DESC NULLS LAST, id DESC LIMIT 24`);
  res.render('public/institutional-profile', { title: res.locals.t('संस्थागत विवरण', 'Institutional profile'), rows, latest: rows[0] });
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
  const open = !job.deadline || job.deadline >= new Date().toISOString().slice(0, 10);
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
  res.render('public/auction-detail', { title: res.locals.f(item, 'title'), item, bids, images: String(item.images || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean) });
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
  res.render('public/contact', { title: res.locals.t('सम्पर्क', 'Contact us'), centers, values: {}, errors: {} });
}));

router.post('/contact', submitLimiter, ah(async (req, res) => {
  const mod = modules.contact;
  if (isBot(req)) { flash(req, 'success', res.locals.t('सन्देश पठाइयो।', 'Message sent.')); return res.redirect('/contact'); }
  const { data, errors } = forms.validate(mod, req.body, {}, {}, req.lang);
  if (Object.keys(errors).length) {
    const centers = await db.many(`SELECT * FROM service_centers WHERE ${ACTIVE} ORDER BY is_main_branch DESC, display_order LIMIT 6`);
    return res.status(422).render('public/contact', { title: res.locals.t('सम्पर्क', 'Contact us'), centers, values: req.body, errors });
  }
  await forms.insertSubmission(mod, data, { is_read: 0 });
  flash(req, 'success', res.locals.t('धन्यवाद! तपाईंको सन्देश प्राप्त भयो।', 'Thank you! Your message has been received.'));
  res.redirect('/contact');
}));

// ---------------------------------------------------------------- applications (generic form engine)
router.get('/apply', (req, res) => {
  const list = Object.values(modules).filter(m => !m.hidden);
  res.render('public/apply-index', { title: res.locals.t('अनलाइन सेवा', 'Online services'), list });
});

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

async function renderForm(req, res, mod, values = {}, errors = {}, status = 200) {
  const options = await forms.resolveOptions(mod);
  if (req.query.program) values.program_id = values.program_id || req.query.program;
  if (req.query.career) values.career_id = values.career_id || req.query.career;
  if (req.query.auction) values.auction_id = values.auction_id || req.query.auction;
  res.status(status).render('public/apply-form', { title: res.locals.t(...mod.title), mod, options, values: { ...prefillFromMember(req.member, mod), ...values }, errors });
}

router.get('/apply/:key', ah(async (req, res, next) => {
  const mod = modules[req.params.key];
  if (!mod || mod.key === 'contact') return next();
  await renderForm(req, res, mod);
}));

router.post('/apply/:key', submitLimiter, (req, res, next) => {
  const mod = modules[req.params.key];
  if (!mod || mod.key === 'contact') return next();
  const chain = mod.fileFields.length ? upload(mod.key, mod.fileFields.map(f => ({ name: f.name, kind: f.type === 'image' ? 'image' : f.kind }))) : [];
  let i = 0;
  const step = err => (err ? next(err) : i < chain.length ? chain[i++](req, res, step) : handle());
  const handle = () => (async () => {
    if (isBot(req)) return res.redirect('/');
    const options = await forms.resolveOptions(mod);
    const { data, errors } = forms.validate(mod, req.body, req.uploaded, options, req.lang);
    if (req.uploadError) errors._upload = req.uploadError;
    if (Object.keys(errors).length) return renderForm(req, res, mod, req.body, errors, 422);
    const extra = {};
    if (mod.key === 'honor' && req.member) extra.member_portal_id = req.member.id;
    if (mod.key === 'honor') extra.is_member = data.member_id ? 1 : 0;
    if (mod.key === 'job' || mod.key === 'survey') extra.is_read = 0;
    const row = await forms.insertSubmission(mod, data, extra);
    if (req.member) {
      await notify.notifyMember(req.member.id, res.locals.t(...mod.title), res.locals.t('तपाईंको आवेदन प्राप्त भयो। ट्र्याकिङ नं: ', 'Application received. Tracking no: ') + (row.tracking_id || row.id), '/track?id=' + encodeURIComponent(row.tracking_id || ''));
    }
    if (row.tracking_id) {
      notify.later(() => notify.applicationEvent('submitted', { name: row[mod.nameCol], tracking_id: row.tracking_id, module: mod.title[0] }, { phone: row[mod.phoneCol], email: row.email || row.bidder_email }));
    }
    req.session.lastSubmission = { module: mod.key, tracking: row.tracking_id || null };
    res.redirect(`/apply/${mod.key}/done`);
  })().catch(next);
  step();
});

router.get('/apply/:key/done', (req, res, next) => {
  const mod = modules[req.params.key];
  const last = req.session.lastSubmission;
  if (!mod || !last || last.module !== mod.key) return res.redirect('/apply/' + req.params.key);
  res.render('public/apply-done', { title: res.locals.t(...mod.title), mod, tracking: last.tracking });
});

// ---------------------------------------------------------------- tracker
router.get('/track', ah(async (req, res) => {
  const id = String(req.query.id || '').trim().toUpperCase();
  const phone = nd.toLatinDigits(String(req.query.phone || '').trim());
  let result = null, history = [], searched = false;
  if (id) {
    searched = true;
    for (const mod of Object.values(modules)) {
      if (mod.noTracking) continue;
      const row = await db.one(`SELECT * FROM ${mod.table} WHERE upper(tracking_id) = $1 LIMIT 1`, [id]);
      if (!row) continue;
      // require the phone used on the application so tracking ids alone do not leak details
      const rowPhone = String(row[mod.phoneCol] || '').replace(/\D/g, '').slice(-8);
      if (rowPhone && rowPhone !== phone.replace(/\D/g, '').slice(-8)) break;
      result = { mod, row };
      history = await db.many('SELECT * FROM request_status_history WHERE module = $1 AND request_id = $2 ORDER BY created_at', [mod.key, row.id]);
      break;
    }
  }
  res.render('public/track', { title: res.locals.t('आवेदनको स्थिति', 'Track your application'), id, phone, result, history, searched });
}));

// ---------------------------------------------------------------- ID card verification
const verifyLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 15, keyGenerator: req => (req.tenant?.slug || '') + ':' + rateLimit.ipKeyGenerator(req.ip), standardHeaders: 'draft-7', legacyHeaders: false });
router.get('/verify', (req, res) => res.render('public/verify', { title: res.locals.t('सदस्य परिचयपत्र प्रमाणीकरण', 'Verify member ID card'), result: null, code: '' }));
router.post('/verify', verifyLimiter, ah(async (req, res) => {
  const code = String(req.body.code || '').trim().toUpperCase().slice(0, 20);
  const cvv = nd.toLatinDigits(String(req.body.cvv || '').trim()).slice(0, 4);
  const card = await db.one('SELECT * FROM member_id_cards WHERE upper(verification_code) = $1 AND cvv = $2', [code, cvv]);
  await db.query('INSERT INTO card_verify_attempts (ip, code_tried, success, created_at) VALUES ($1, $2, $3, now())', [req.ip, code, card ? 1 : 0]);
  let member = null;
  if (card) {
    await db.query('UPDATE member_id_cards SET verify_count = COALESCE(verify_count, 0) + 1, last_verified_at = now() WHERE id = $1', [card.id]);
    member = await db.one('SELECT name, name_np, sadasyata_number, member_card_no, avatar_url, approval_status FROM members WHERE (sadasyata_number = $1 OR member_card_no = $1 OR id::text = $1) AND deleted_at IS NULL LIMIT 1', [card.member_id]);
  }
  res.render('public/verify', { title: res.locals.t('सदस्य परिचयपत्र प्रमाणीकरण', 'Verify member ID card'), result: card ? { card, member } : false, code });
}));

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
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
  res.json(await aiChat.reply(message, history, req.lang));
}));

// QR codes printed at programmes point here; members sign in and confirm
router.get('/attend', (req, res) => res.redirect('/member/attend?t=' + encodeURIComponent(String(req.query.t || '').replace(/[^A-Za-z0-9_-]/g, ''))));

// ---------------------------------------------------------------- PWA
router.get('/manifest.webmanifest', (req, res) => {
  const s = res.locals.settings;
  const icon = s.logo ? require('../lib/uploads').mediaUrl(s.logo) : null;
  res.type('application/manifest+json').send(JSON.stringify({
    name: res.locals.siteName, short_name: (s.pwa_short_name || res.locals.siteName).slice(0, 24), start_url: '/', scope: '/', display: 'standalone',
    background_color: '#fafaf9', theme_color: res.locals.brandColor, lang: 'ne',
    icons: icon ? [{ src: icon, sizes: '512x512', type: /\.png$/i.test(icon) ? 'image/png' : 'image/jpeg', purpose: 'any' }] : [],
  }));
});
router.get('/offline', (req, res) => res.render('public/error', { title: res.locals.t('इन्टरनेट छैन', 'You are offline'), code: '', message: res.locals.t('इन्टरनेट जडान जाँच गरेर फेरि प्रयास गर्नुहोस्।', 'Check your connection and try again.') }));

// ---------------------------------------------------------------- SEO
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
