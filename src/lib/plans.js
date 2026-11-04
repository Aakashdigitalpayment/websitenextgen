'use strict';
/**
 * Subscription plans: Lite → Basic → Advance → Extra Advance (each includes everything below it).
 * The platform operator assigns a plan per tenant (platform.tenants.plan). A feature outside the plan is
 * blocked at the route level (public: 404, admin: upgrade page, API: 403) and its links are hidden.
 */
const PLANS = [
  { key: 'lite', np: 'लाइट', en: 'Lite', staff: 2, blurb: ['पूर्ण वेबसाइट', 'Complete website'] },
  { key: 'basic', np: 'बेसिक', en: 'Basic', staff: 5, blurb: ['वेबसाइट + अनलाइन आवेदन र आफ्नै डोमेन', 'Website + online applications & own domain'] },
  { key: 'advance', np: 'एडभान्स', en: 'Advance', staff: 15, blurb: ['+ सदस्य पोर्टल, कार्यक्रम, निर्वाचन, बजार', '+ member portal, programmes, elections, marketplace'] },
  { key: 'extra', np: 'एक्स्ट्रा एडभान्स', en: 'Extra Advance', staff: Infinity, blurb: ['+ CBS/DMS API, AI च्याट, कस्टम भूमिका', '+ CBS/DMS API, AI chat, custom roles'] },
];
const RANK = Object.fromEntries(PLANS.map((p, i) => [p.key, i]));
const isPlan = k => Object.prototype.hasOwnProperty.call(RANK, k);

/**
 * Features. `paths` are URL prefixes (matched on segment boundaries); `resources` match /admin/r/:resource keys.
 * Anything not listed here is part of every plan (the website itself, theme, settings, users, licence…).
 */
const FEATURES = [
  { key: 'applications', plan: 'basic', np: 'अनलाइन आवेदन (खाता, ऋण, KYC, गुनासो, भेटघाट…) र ट्र्याकिङ', en: 'Online applications (account, loan, KYC, grievance, appointment…) & tracking',
    paths: ['/apply', '/track', '/admin/inbox', '/admin/kyc-risk'] },
  { key: 'notifications', plan: 'basic', np: 'SMS / इमेल सूचना', en: 'SMS / email notifications', paths: ['/admin/notifications'] },
  { key: 'custom_domain', plan: 'basic', np: 'आफ्नै डोमेन (www.coop.com.np) + HTTPS', en: 'Own domain (www.coop.com.np) + HTTPS', paths: ['/admin/domains'] },
  { key: 'member_portal', plan: 'advance', np: 'सदस्य पोर्टल (खाता, परिचयपत्र, प्रमाणपत्र, KYC)', en: 'Member portal (accounts, ID card, certificate, KYC)',
    paths: ['/member', '/verify', '/admin/members', '/admin/password-requests', '/admin/registrations', '/admin/member-'] },
  { key: 'programmes', plan: 'advance', np: 'कार्यक्रम र QR उपस्थिति', en: 'Programmes & QR attendance',
    paths: ['/programs', '/attend', '/admin/programs', '/member/programs', '/member/attend', '/member/scan'], resources: [/^program/] },
  { key: 'elections', plan: 'advance', np: 'निर्वाचन र अनलाइन मतदान', en: 'Elections & online voting',
    paths: ['/elections', '/admin/elections', '/member/elections'], resources: [/^election/] },
  { key: 'marketplace', plan: 'advance', np: 'सदस्य बजार', en: 'Member marketplace', paths: ['/marketplace', '/admin/marketplace', '/member/marketplace'] },
  { key: 'information_room', plan: 'advance', np: 'सूचना कक्ष', en: 'Information room', paths: ['/member/information-room', '/admin/information-room'], resources: [/^information_room/] },
  { key: 'backups', plan: 'advance', np: 'ब्याकअप / रिस्टोर', en: 'Backup / restore', paths: ['/admin/backup'] },
  { key: 'analytics', plan: 'advance', np: 'विश्लेषण चार्ट', en: 'Analytics', paths: ['/admin/analytics'] },
  { key: 'api', plan: 'extra', np: 'CBS / DMS API र वेबहुक', en: 'CBS / DMS API & webhooks', paths: ['/api/v1', '/admin/integrations'] },
  { key: 'ai_chat', plan: 'extra', np: 'AI च्याट सहायक', en: 'AI chat assistant', paths: ['/api/chat'] },
  { key: 'credentials', plan: 'extra', np: 'कार्यालय पासवर्ड व्यवस्थापक', en: 'Office credential manager', paths: ['/admin/credentials'] },
  { key: 'custom_roles', plan: 'extra', np: 'कस्टम एडमिन भूमिका', en: 'Custom admin roles', paths: ['/admin/roles'] },
];
// longest prefix first so '/member/programs' resolves to programmes, not member_portal
const PATH_INDEX = FEATURES.flatMap(f => (f.paths || []).map(p => [p, f])).sort((a, b) => b[0].length - a[0].length);

const matches = (path, prefix) => prefix.endsWith('-') ? path.startsWith(prefix) : path === prefix || path.startsWith(prefix + '/') || path.startsWith(prefix + '.');

/** Feature that governs a URL path (or null = always available). */
function featureFor(path) {
  const p = String(path || '').split('?')[0].replace(/\/+$/, '').toLowerCase() || '/';
  const m = p.match(/^\/admin\/r\/([a-z0-9_]+)/);
  if (m) { const f = FEATURES.find(x => (x.resources || []).some(re => re.test(m[1]))); if (f) return f; }
  for (const [prefix, f] of PATH_INDEX) if (matches(p, prefix)) return f;
  return null;
}

const normalize = plan => (isPlan(plan) ? plan : 'extra');
const has = (plan, featureKey) => {
  const f = FEATURES.find(x => x.key === featureKey);
  return !f || RANK[normalize(plan)] >= RANK[f.plan];
};
const allows = (plan, path) => { const f = featureFor(path); return !f || RANK[normalize(plan)] >= RANK[f.plan]; };
const info = plan => PLANS[RANK[normalize(plan)]];

/** Remove sidebar links (admin) whose target is outside the plan. */
function stripLinks(html, plan) {
  if (normalize(plan) === 'extra') return html;
  return html
    .replace(/<a class="side-link[^"]*"\s+href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (a, href) => (allows(plan, href) ? a : ''))
    .replace(/<div class="side-group"><div class="side-title">[^<]*<\/div>\s*<\/div>/g, '');
}

module.exports = { PLANS, FEATURES, RANK, isPlan, featureFor, has, allows, info, normalize, stripLinks };
