'use strict';
/**
 * 301 redirects from the PHP site's URLs to the new routes, so printed QR codes (programme attendance,
 * ID cards, certificates), bookmarks and search results keep working after the move.
 */
const clean = v => String(v ?? '').trim();
const token = v => clean(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 200);
const id = v => (/^\d{1,10}$/.test(clean(v)) ? clean(v) : '');
const qs = (k, v) => (v ? `?${k}=${encodeURIComponent(v)}` : '');

/** Public PHP entry points (site root). q = parsed query. */
const PUBLIC = {
  'index.php': () => '/',
  'about.php': () => '/about',
  'why-choose.php': () => '/about',
  'vision-mission.php': () => '/vision-mission',
  'chairman-message.php': () => '/message/chairman',
  'ceo-message.php': () => '/message/ceo',
  'services.php': () => '/services',
  'interest-rates.php': () => '/interest-rates',
  'digital-services.php': () => '/digital-services',
  'service-centers.php': () => '/service-centers',
  'partner-facilities.php': () => '/partner-facilities',
  'team.php': () => '/team',
  'committees.php': q => (id(q.id) ? '/committees/' + id(q.id) : '/committees'),
  'awards.php': () => '/awards',
  'success-stories.php': () => '/success-stories',
  'news.php': () => '/news',
  'news-detail.php': q => (id(q.id) ? '/news/' + id(q.id) : '/news'),
  'notices.php': q => (id(q.id) ? '/notices/' + id(q.id) : '/notices'),
  'gallery.php': q => '/gallery' + (id(q.album) ? '?album=' + id(q.album) : ''),
  'downloads.php': () => '/downloads',
  'reports.php': () => '/reports',
  'report-file.php': () => '/reports',
  'institutional-profile.php': () => '/institutional-profile',
  'institutional-profile-file.php': () => '/institutional-profile',
  'important-links.php': () => '/important-links',
  'faqs.php': () => '/faqs',
  'page.php': q => (clean(q.slug) ? '/page/' + encodeURIComponent(clean(q.slug).slice(0, 120)) : '/'),
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
  'online-kyc.php': () => '/apply/kyc',
  'grievance.php': () => '/apply/grievance',
  'appointment.php': () => '/apply/appointment',
  'member-welfare.php': () => '/apply/welfare',
  'member-survey.php': () => '/apply/survey',
  'member-skills.php': () => '/apply',
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
  const m = /^\/([a-z0-9_-]+\.php)$/i.exec(req.path);
  const fn = m && Object.hasOwn(map, m[1].toLowerCase()) ? map[m[1].toLowerCase()] : null;
  return fn ? fn(req.query || {}) : null;
}

/** Middleware for the site root (mounted on '/') and for the member portal (mounted on '/member'). */
const publicRedirects = (req, res, next) => { const to = target(PUBLIC, req); return to ? res.redirect(301, to) : next(); };
const memberRedirects = (req, res, next) => { const to = target(MEMBER, req); return to ? res.redirect(301, to) : next(); };

module.exports = { publicRedirects, memberRedirects, PUBLIC, MEMBER };
