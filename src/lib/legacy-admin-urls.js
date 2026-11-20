'use strict';
/**
 * 301 redirects from the PHP admin's URLs (admin/<x>.php?view=N, admin/applications/*.php, admin/members/*.php)
 * to the new admin routes, so links in old SMS / emails and staff bookmarks keep working. GET only; the target
 * route does its own sign-in and role checks.
 */
const id = v => (/^\d{1,10}$/.test(String(v ?? '').trim()) ? String(v).trim() : '');
const inbox = key => q => `/admin/inbox/${key}` + (id(q.view || q.id) ? '/' + id(q.view || q.id) : '');
const PRINT_TYPES = ['kyc', 'loan', 'welfare', 'digital', 'honor', 'account', 'appointment', 'grievance', 'job'];

const ADMIN = {
  'index.php': () => '/admin',
  'dashboard.php': () => '/admin',
  'loan-applications.php': inbox('loan'),
  'account-applications.php': inbox('account'),
  'kyc-applications.php': inbox('kyc'),
  'grievances.php': inbox('grievance'),
  'appointments.php': inbox('appointment'),
  'feedbacks.php': inbox('feedback'),
  'welfare-claims.php': inbox('welfare'),
  'digital-service-requests.php': inbox('digital'),
  'honor-applications.php': inbox('honor'),
  'job-applications.php': inbox('job'),
  'vendor-enlistment.php': inbox('vendor'),
  'membership-applications.php': inbox('membership'),
  'auction-bids.php': q => '/admin/inbox/bid' + (id(q.auction_id) ? '?auction=' + id(q.auction_id) : ''),
  'members.php': q => (id(q.view) ? '/admin/members/' + id(q.view) : '/admin/members'),
  'member-online-portal.php': () => '/admin/member-portal',
  'member-activities.php': q => (id(q.member_id || q.id) ? `/admin/members/${id(q.member_id || q.id)}/activities` : '/admin/members'),
  'member-import.php': () => '/admin/members/import',
  'member-ssot-duplicates.php': () => '/admin/members/duplicates',
  'member-marketplace.php': q => (id(q.view) ? '/admin/marketplace/' + id(q.view) : '/admin/marketplace'),
  'programs.php': () => '/admin/programs',
  'program-detail.php': q => (id(q.id) ? '/admin/programs/' + id(q.id) : '/admin/programs'),
  'program-occurrences.php': q => (id(q.program_id || q.id) ? `/admin/programs/${id(q.program_id || q.id)}#locations` : '/admin/programs'),
  'program-registration-desk.php': q => (id(q.program_id || q.id) ? `/admin/programs/${id(q.program_id || q.id)}#desk` : '/admin/programs'),
  'program-attendance.php': q => '/admin/programs/register' + (id(q.program_id) ? '?program_id=' + id(q.program_id) : ''),
  'program-dashboard.php': () => '/admin/programs/dashboard',
  'program-settings.php': () => '/admin/programs/settings',
  'program-member-history.php': () => '/admin/programs/reports/history',
  'program-reports-absent.php': () => '/admin/programs/reports/absent',
  'program-reports-breakdown.php': () => '/admin/programs/reports/breakdown',
  'program-reports-consolidated.php': () => '/admin/programs/reports/consolidated',
  'program-reports-duplicates.php': () => '/admin/programs/reports/duplicates',
  'program-reports-location.php': () => '/admin/programs/reports/location',
  'program-reports-member.php': () => '/admin/programs/reports/member',
  'election-results.php': q => (id(q.cycle) ? '/admin/elections/' + id(q.cycle) : '/admin/elections'),
  'election-voting-attendance.php': q => (id(q.cycle) ? `/admin/elections/${id(q.cycle)}/desk` : '/admin/elections'),
  'election-information.php': () => '/admin/r/election_cycles',
  'election-candidates.php': () => '/admin/r/election_candidates',
  'election-posts.php': () => '/admin/r/election_posts',
  'kyc-risk-reviews.php': () => '/admin/kyc-risk-reviews',
  'information-room.php': () => '/admin/r/information_room_items',
  'information-room-logs.php': () => '/admin/information-room/logs',
  'partner-facilities.php': () => '/admin/partners',
  'institutional-welfare-opening.php': () => '/admin/institutional-welfare',
  'reports.php': () => '/admin/r/reports',
  'print-form.php': q => (PRINT_TYPES.includes(String(q.type)) && id(q.id) ? `/admin/inbox/${q.type}/${id(q.id)}/print` : '/admin'),
  'login.php': () => '/admin/login',
};
// admin/applications/*.php and admin/members/*.php were already 301 stubs in the PHP app
const STUBS = {
  'applications/account.php': () => '/admin/inbox/account',
  'applications/kyc.php': () => '/admin/inbox/kyc',
  'applications/kyc-generate-member.php': () => '/admin/inbox/kyc',
  'applications/kyc-view.php': inbox('kyc'),
  'members/index.php': () => '/admin/members',
  'members/add.php': () => '/admin/members/new',
  'members/edit.php': q => (id(q.id) ? '/admin/members/' + id(q.id) : '/admin/members'),
  'members/view.php': q => (id(q.id) ? '/admin/members/' + id(q.id) : '/admin/members'),
};

function target(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const m = /^\/((?:applications\/|members\/)?[a-z0-9_-]+\.php)$/i.exec(req.path);
  if (!m) return null;
  const key = m[1].toLowerCase();
  const fn = Object.hasOwn(STUBS, key) ? STUBS[key] : Object.hasOwn(ADMIN, key) ? ADMIN[key] : null;
  return fn ? fn(req.query || {}) : null;
}

/** Mounted at the start of the /admin router. */
const adminRedirects = (req, res, next) => { const to = target(req); return to ? res.redirect(301, to) : next(); };

module.exports = { adminRedirects, ADMIN, STUBS, target };
