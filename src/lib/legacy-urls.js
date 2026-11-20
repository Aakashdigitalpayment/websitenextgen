'use strict';
/**
 * 301 redirects from the PHP site's URLs to the new routes, so printed QR codes (programme attendance,
 * ID cards, certificates), bookmarks and search results keep working after the move.
 */
const clean = v => String(v ?? '').trim();
const token = v => clean(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
const id = v => (/^\d{1,10}$/.test(clean(v)) ? clean(v) : '');
const qs = (k, v) => (v ? `?${k}=${encodeURIComponent(v)}` : '');
/** Carry the listed query parameters across (plain values only, 120 chars max). */
const keep = (q, keys) => {
  const p = new URLSearchParams();
  for (const k of keys) { const v = clean(typeof q[k] === 'string' ? q[k] : '').slice(0, 120); if (v) p.set(k, v); }
  const s = p.toString();
  return s ? '?' + s : '';
};

/** Public PHP entry points (site root). q = parsed query. */
const PUBLIC = {
  'index.php': () => '/',
  'about.php': () => '/about',
  'why-choose.php': () => '/about#why',
  'vision-mission.php': () => '/vision-mission',
  'chairman-message.php': () => '/message/chairman',
  'ceo-message.php': () => '/message/ceo',
  'services.php': () => '/services',
  'interest-rates.php': () => '/interest-rates',
  'digital-services.php': () => '/digital-services',
  'service-centers.php': () => '/service-centers',
  'partner-facilities.php': () => '/partner-facilities',
  'team.php': q => '/team' + keep(q, ['menu', 'item', 'cmt', 'tenure']),
  'committees.php': q => (id(q.id || q.type) ? '/committees/' + id(q.id || q.type) + keep(q, ['tenure', 'past']) : '/committees'),
  'awards.php': q => (id(q.id) ? '/awards/' + id(q.id) : '/awards'),
  'success-stories.php': () => '/success-stories',
  'news.php': () => '/news',
  'news-detail.php': q => (id(q.id) ? '/news/' + id(q.id) : '/news'),
  'notices.php': q => (id(q.id) ? '/notices/' + id(q.id) : '/notices'),
  'gallery.php': q => '/gallery' + keep(q, ['type', 'album', 'category', 'page']),
  'downloads.php': () => '/downloads',
  'reports.php': q => '/reports' + keep(q, ['type', 'year', 'month', 'id']),
  'report-file.php': q => (id(q.id) ? '/reports/' + id(q.id) + '/file' + (clean(q.dl) === '1' ? '?dl=1' : '') : '/reports'),
  'institutional-profile.php': () => '/institutional-profile',
  'institutional-profile-file.php': q => (id(q.id) ? '/institutional-profile/' + id(q.id) + '/file' : '/institutional-profile'),
  'information-room-file.php': q => (id(q.id) ? '/member/information-room/' + id(q.id) : '/member/information-room'),
  'important-links.php': () => '/important-links',
  'faqs.php': () => '/faqs',
  'page.php': q => (clean(q.slug) ? '/page/' + encodeURIComponent(clean(q.slug).slice(0, 120)) : id(q.id) ? '/page/by-id/' + id(q.id) : '/'),
  'search.php': q => '/search' + qs('q', clean(q.q).slice(0, 80)),
  'career.php': () => '/careers',
  'career-detail.php': q => (id(q.id) ? '/careers/' + id(q.id) : '/careers'),
  'auction.php': () => '/auctions',
  'election-information.php': q => (id(q.cycle) ? '/elections/' + id(q.cycle) : '/elections'),
  'cooperative-programs.php': () => '/programs',
  'emi-calculator.php': () => '/emi-calculator',
  'date-converter.php': () => '/date-converter',
  'sahakari-patro.php': () => '/calendar',
  'exchange-rate.php': () => '/exchange-rate',
  'contact.php': () => '/contact',
  'member-marketplace.php': () => '/marketplace',
  'loan-apply.php': () => '/apply/loan',
  'online-account.php': () => '/apply/account',
  'online-kyc.php': q => (q.path === 'new' ? '/apply/membership' : '/apply/kyc'),
  'grievance.php': q => (q.track ? '/track' + qs('id', clean(q.track).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 96)) : '/apply/grievance'),
  'appointment.php': () => '/apply/appointment',
  'member-welfare.php': q => (q.track ? '/track' + qs('id', clean(q.track).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 96)) : '/apply/welfare'),
  'member-survey.php': () => '/apply/survey',
  'member-skills.php': () => '/marketplace?type=skill',
  'vendor-enlistment.php': () => '/apply/vendor',
  'honor-apply.php': () => '/apply/honor',
  // QR codes and links printed by the PHP app
  'attend.php': q => (token(q.token || q.qr_token || q.t) ? '/member/attend?t=' + token(q.token || q.qr_token || q.t) : '/member/programs'),
  'program-attendance-verify.php': () => '/member/programs',
  'verify.php': () => '/verify',
  'application-tracker.php': q => '/track' + qs('id', clean(q.id || q.tracking_id).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 96)),
  'tracker-id-card.php': () => '/track', // links were signed with the PHP secret — verify again from the tracker
  'login.php': () => '/member/login',
  'oauth.php': () => '/member/login',
  'password-reset-request.php': () => '/member/forgot',
  'offline.php': () => '/offline',
  'sitemap.php': () => '/sitemap.xml',
  'robots.php': () => '/robots.txt',
  'manifest.php': () => '/manifest.webmanifest',
  'manifest.json': () => '/manifest.webmanifest',
};

/** member/*.php entry points. */
const MEMBER = {
  'index.php': () => '/member',
  'login.php': q => (q.tab === 'register' ? '/member/register' : '/member/login'),
  'logout.php': () => '/member/login',
  'check-availability.php': () => '/member/register',
  'password-reset-request.php': () => '/member/forgot',
  'oauth.php': q => (q.provider === 'facebook' ? '/member/oauth/facebook' : q.provider === 'google' && !q.code ? '/member/oauth/google' : '/member/login'),
  'profile.php': () => '/member/profile',
  'notifications.php': () => '/member/notifications',
  'id-card.php': () => '/member/id-card',
  'certificate.php': () => '/member/certificate',
  'kyc-print.php': () => '/member/kyc-print',
  'kyc.php': () => '/apply/kyc',
  'attend.php': q => (token(q.qr_token || q.token || q.t) ? '/member/attend?t=' + token(q.qr_token || q.token || q.t) : '/member/programs'),
  'scan.php': () => '/member/scan',
  'tracker.php': () => '/member/requests',
  'transactions.php': () => '/member/accounts',
  'information-room.php': () => '/member/information-room',
  'information-room-view.php': q => (id(q.id) ? '/member/information-room/' + id(q.id) : '/member/information-room'),
  'marketplace.php': () => '/member/marketplace',
  'election-vote.php': q => (id(q.cycle) ? '/member/elections/' + id(q.cycle) : '/member'),
  'loan-apply.php': () => '/apply/loan',
  'account-apply.php': () => '/apply/account',
  'appointment.php': () => '/apply/appointment',
  'grievance.php': () => '/apply/grievance',
  'welfare.php': () => '/apply/welfare',
  'digital-service.php': () => '/apply/digital',
  'honor-apply.php': () => '/apply/honor',
  'service-request.php': () => '/apply',
  'apply-frame.php': () => '/apply',
  'offline.php': () => '/offline',
};

function target(map, req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const m = /^\/([a-z0-9_-]+\.php|manifest\.json)$/i.exec(req.path);
  const fn = m && Object.hasOwn(map, m[1].toLowerCase()) ? map[m[1].toLowerCase()] : null;
  return fn ? fn(req.query || {}) : null;
}

/** Middleware for the site root (mounted on '/') and for the member portal (mounted on '/member'). */
const publicRedirects = (req, res, next) => { const to = target(PUBLIC, req); return to ? res.redirect(301, to) : next(); };
/**
 * PHP's .htaccess also served every page without ".php" (/news-detail?id=5, /career, /sahakari-patro …).
 * Mounted at the END of the public router, so it only sees paths no Node route answered.
 */
const extensionlessRedirects = (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const m = /^\/([a-z0-9_-]+)\/?$/i.exec(req.path);
  const key = m && m[1].toLowerCase() + '.php';
  if (!key || !Object.hasOwn(PUBLIC, key)) return next();
  const to = PUBLIC[key](req.query || {});
  return to && to.split(/[?#]/)[0] !== req.path ? res.redirect(301, to) : next();
};
const memberRedirects = (req, res, next) => { const to = target(MEMBER, req); return to ? res.redirect(301, to) : next(); };

module.exports = { publicRedirects, memberRedirects, extensionlessRedirects, PUBLIC, MEMBER };
