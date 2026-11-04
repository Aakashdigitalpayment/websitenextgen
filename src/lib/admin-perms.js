'use strict';
/**
 * Custom admin roles — per-section permission matrix (हेर्ने / थप्ने / सम्पादन / हटाउने), layered on
 * the four fixed role levels, plus superadmin "menu control" (hide whole sidebar groups).
 *
 *  - admin_roles.permissions = JSON { "<section>": "vced" }; c / e / d imply v.
 *  - A user with admin_users.custom_role_id only sees / uses the sections their role grants, and still
 *    needs the fixed level each page requires (the matrix restricts, it never widens).
 *  - Superadmins are never restricted. Superadmin-only pages are not grantable.
 *  - Requests to admin pages that are not in the registry are denied for custom-role users
 *    (fail closed) unless they are personal pages (dashboard, password, 2FA, quick search).
 */
const db = require('../db');
const auth = require('./auth');
const settings = require('./settings');

const ACTIONS = { v: ['हेर्ने', 'View'], c: ['थप्ने', 'Add'], e: ['सम्पादन', 'Edit'], d: ['हटाउने', 'Delete'] };
const ALWAYS = ['/', '/password', '/2fa', '/2fa/enable', '/2fa/disable', '/logout', '/quick-search', '/plan'];

// bespoke admin pages: [section key, label, group, url prefixes]
const EXTRA = [
  ['members', ['सदस्यहरू', 'Members'], 'members', ['/members']],
  ['programs', ['कार्यक्रम उपस्थिति', 'Programme attendance'], 'members', ['/programs']],
  ['elections', ['निर्वाचन नतिजा', 'Election results'], 'members', ['/elections']],
  ['marketplace', ['सदस्य बजार', 'Marketplace'], 'members', ['/marketplace']],
  ['password_requests', ['पासवर्ड अनुरोध', 'Password requests'], 'members', ['/password-requests']],
  ['settings', ['सेटिङ', 'Settings'], 'system', ['/settings']],
  ['theme', ['रूप / थिम', 'Theme'], 'system', ['/theme']],
  ['notifications', ['SMS/इमेल/Push', 'SMS / email / push'], 'system', ['/notifications']],
  ['license', ['सेवा नवीकरण', 'Licence'], 'system', ['/license']],
  ['audit', ['अडिट लग', 'Audit log'], 'system', ['/audit']],
  ['analytics', ['विश्लेषण', 'Analytics'], 'system', ['/analytics']],
  ['satisfaction', ['सन्तुष्टि विजेट', 'Satisfaction widget'], 'links', ['/satisfaction']],
  ['client_protection', ['ग्राहक संरक्षण', 'Client protection'], 'system', ['/client-protection']],
  ['partners', ['साझेदार सेवा लग', 'Partner service log'], 'services', ['/partners']],
  ['institutional_welfare', ['संस्थागत कल्याण कोष', 'Institutional welfare'], 'org', ['/institutional-welfare']],
];
// sub-pages that use another section's permission
const ALIASES = [
  ['/information-room', 'r:information_room_items'],
  ['/gallery', 'r:gallery'],
  ['/team-setup', 'r:team_members'],
  ['/files/_private/information-room-items', 'r:information_room_items'],
  ['/files/_private/reports', 'r:reports'],
];
// never grantable (requireAdmin('superadmin') guards them as well)
const SUPER_ONLY = ['/users', '/roles', '/menu-control', '/domains', '/integrations', '/credentials', '/system', '/backup', '/error-log'];

const GROUP_LABELS = {
  applications: ['आवेदन तथा अनुरोध', 'Applications'], members: ['सदस्य', 'Members'],
  content: ['सामग्री', 'Content'], media: ['मिडिया/कागजात', 'Media & files'], services: ['सेवा', 'Services'],
  org: ['संस्था', 'Organisation'], engage: ['कार्यक्रम', 'Programmes'], links: ['लिङ्क/अन्य', 'Links & more'],
  system: ['प्रणाली', 'System'],
};

let cached = null;
/** Grantable sections grouped like the sidebar: [{ key, label, items: [{ key, label, prefixes }] }] */
function registry() {
  if (cached) return cached;
  const modules = require('../modules/applications');
  const { resources } = require('../modules/resources');
  const groups = Object.fromEntries(Object.entries(GROUP_LABELS).map(([key, label]) => [key, { key, label, items: [] }]));
  for (const m of Object.values(modules)) groups.applications.items.push({ key: 'inbox:' + m.key, label: m.title, prefixes: ['/inbox/' + m.key] });
  for (const r of Object.values(resources)) (groups[r.group] || groups.links).items.push({ key: 'r:' + r.key, label: r.title, prefixes: ['/r/' + r.key], minRole: r.minRole });
  for (const [key, label, g, prefixes] of EXTRA) groups[g].items.push({ key, label, prefixes });
  cached = Object.values(groups).filter(g => g.items.length);
  return cached;
}
const allSections = () => registry().flatMap(g => g.items.map(i => ({ ...i, group: g.key })));

const under = (path, prefix) => path === prefix || path.startsWith(prefix + '/');

/** Admin-router path ("/r/notices/5/edit") → { section, group } | { always } | { superOnly } | null */
function resolve(path) {
  const p = (String(path || '/').replace(/\/+$/, '') || '/').toLowerCase();
  if (ALWAYS.includes(p)) return { always: true };
  if (SUPER_ONLY.some(s => under(p, s))) return { superOnly: true };
  const sections = allSections();
  for (const [prefix, key] of ALIASES) if (under(p, prefix)) { const s = sections.find(x => x.key === key); return s ? { section: s.key, group: s.group } : null; }
  let best = null, len = -1;
  for (const s of sections) for (const pre of s.prefixes) if (under(p, pre.toLowerCase()) && pre.length > len) { best = s; len = pre.length; }
  if (best) return { section: best.key, group: best.group };
  if (under(p, '/files')) return { section: 'inbox:*', group: 'applications' }; // other private files: application documents
  return null;
}

/** Classify a request as v / c / e / d (unsure → e), like the PHP coop_perm_post_action(). */
function actionFlag(req, resolved) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return 'v';
  const p = String(req.path || '').replace(/\/+$/, '');
  const a = String((req.body && (req.body.action || req.body.bulk_action)) || '').toLowerCase();
  if (/\/delete$/.test(p) || /(^|_)(delete|remove|trash|purge|destroy)($|_)/.test(a)) return 'd';
  if (/(^|_)(add|create|insert|new)($|_)/.test(a) || /^\/gallery\/(upload|video)$/.test(p)) return 'c';
  if (resolved && resolved.section) {
    const s = allSections().find(x => x.key === resolved.section);
    const pre = s && s.prefixes.find(x => under(p.toLowerCase(), x.toLowerCase()));
    if (pre && (p.toLowerCase() === pre.toLowerCase() || /\/new$/.test(p))) return 'c'; // POST to the collection = create
  }
  return 'e';
}

/** JSON / object → { section: "vced" subset } limited to known sections; c/e/d imply v. */
function normalize(raw) {
  let obj = raw;
  if (typeof raw === 'string') { try { obj = JSON.parse(raw); } catch { obj = null; } }
  if (!obj || typeof obj !== 'object') return {};
  const valid = new Set(allSections().map(s => s.key));
  const out = {};
  for (const [key, flags] of Object.entries(obj)) {
    if (!valid.has(key)) continue;
    const f = Array.isArray(flags) ? flags.join('') : flags && typeof flags === 'object' ? Object.keys(flags).filter(k => flags[k]).join('') : String(flags || '');
    let set = ['v', 'c', 'e', 'd'].filter(ch => f.includes(ch)).join('');
    if (set && !set.includes('v')) set = 'v' + set;
    if (set) out[key] = set;
  }
  return out;
}

/** Starting points for a new role (editable afterwards). */
function presets() {
  const all = (flags, groups) => Object.fromEntries(registry().filter(g => !groups || groups.includes(g.key)).flatMap(g => g.items.map(i => [i.key, flags])));
  return {
    editor: { label: ['सम्पादक — सामग्री, मिडिया', 'Editor — content & media'], perms: { ...all('vce', ['content', 'media']), 'r:notices': 'vced', 'r:news': 'vced', 'r:gallery': 'vced' } },
    viewer: { label: ['हेर्ने मात्र (सबै)', 'View only (everything)'], perms: all('v') },
    member_desk: { label: ['सदस्य सेवा (हटाउन बाहेक)', 'Member desk (no delete)'], perms: all('vce', ['members', 'applications']) },
    program_desk: { label: ['कार्यक्रम / दर्ता डेस्क', 'Programme desk'], perms: { programs: 'vce', 'r:upcoming_programs': 'v', 'r:sahakari_calendar_events': 'v' } },
    full: { label: ['सबै menu मा सबै काम', 'Everything (except superadmin pages)'], perms: all('vced') },
  };
}

const isSuper = admin => auth.roleLevel(admin && admin.role) >= 4;

function hiddenGroups(s) {
  try { const v = JSON.parse((s && s.admin_hidden_menu_groups) || '[]'); return Array.isArray(v) ? v.filter(g => GROUP_LABELS[g]) : []; } catch { return []; }
}

/**
 * Decide for one request. ctx = { admin, perms (null = no custom role), hidden: [group keys] }.
 * Returns { ok, flag, resolved }.
 */
function decide(ctx, req) {
  const resolved = resolve(req.path);
  const flag = actionFlag(req, resolved);
  if (isSuper(ctx.admin)) return { ok: true, flag, resolved };
  if (!resolved) return { ok: !ctx.perms, flag, resolved }; // unknown page: open to fixed roles, closed to custom roles
  if (resolved.always || resolved.superOnly) return { ok: true, flag, resolved }; // superOnly pages are guarded by requireAdmin('superadmin')
  if (resolved.group && ctx.hidden.includes(resolved.group)) return { ok: false, flag, resolved, hidden: true };
  if (!ctx.perms) return { ok: true, flag, resolved };
  if (resolved.section === 'inbox:*') return { ok: Object.entries(ctx.perms).some(([k, f]) => k.startsWith('inbox:') && f.includes('v')), flag, resolved };
  return { ok: (ctx.perms[resolved.section] || '').includes(flag), flag, resolved };
}

/** May this admin see a sidebar link to `href` ("/admin/…")? */
function linkVisible(ctx, href) {
  if (!href.startsWith('/admin')) return true;
  const sub = href.slice('/admin'.length).split('?')[0] || '/';
  return decide(ctx, { method: 'GET', path: sub, body: {} }).ok;
}

/** Strip sidebar links the admin may not open, then drop groups left empty. */
function filterSidebar(html, ctx) {
  const start = html.indexOf('<aside class="sidebar"');
  const end = start >= 0 ? html.indexOf('</aside>', start) : -1;
  if (start < 0 || end < 0) return html;
  let side = html.slice(start, end);
  side = side.replace(/<a class="side-link[^"]*" href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g, (m, href) => (linkVisible(ctx, href) ? m : ''));
  side = side.replace(/<div class="side-group">\s*<div class="side-title">[^<]*<\/div>\s*<\/div>/g, '');
  return html.slice(0, start) + side + html.slice(end);
}

async function loadRole(adminId) {
  const row = await db.one('SELECT r.id, r.name, r.permissions FROM admin_users u JOIN admin_roles r ON r.id = u.custom_role_id WHERE u.id = $1', [adminId]);
  return row ? { id: row.id, name: row.name, perms: normalize(row.permissions) } : null;
}

/** Admin-router middleware (after requireAdmin): enforce + expose `can()` + filter the sidebar. */
async function middleware(req, res, next) {
  try {
    const role = isSuper(req.admin) ? null : await loadRole(req.admin.id);
    const ctx = { admin: req.admin, perms: role ? role.perms : null, role, hidden: isSuper(req.admin) ? [] : hiddenGroups(await settings.all()) };
    req.permCtx = ctx;
    res.locals.customRole = role;
    res.locals.can = (section, flag = 'v') => isSuper(req.admin) || ((!ctx.perms || (ctx.perms[section] || '').includes(flag)) && !ctx.hidden.includes((allSections().find(s => s.key === section) || {}).group));
    const d = decide(ctx, req);
    if (!d.ok) {
      const what = res.locals.t(...(ACTIONS[d.flag] || ACTIONS.v));
      if ((req.get('accept') || '').includes('application/json')) return res.status(403).json({ ok: false, error: `Not allowed (${what})` });
      if (d.flag !== 'v' && req.method === 'POST' && d.resolved && d.resolved.section && (ctx.perms?.[d.resolved.section] || '').includes('v')) {
        require('./security').flash(req, 'error', res.locals.t(`तपाईंको भूमिकामा यो काम (${what}) गर्ने अनुमति छैन।`, `Your role does not allow this action (${what}).`));
        return res.redirect(req.get('referer') && /^\/admin/.test(new URL(req.get('referer'), 'http://x').pathname) ? new URL(req.get('referer'), 'http://x').pathname : '/admin');
      }
      return res.status(403).render('admin/denied', { title: 'Access denied' });
    }
    if (ctx.perms || ctx.hidden.length) {
      const render = res.render.bind(res);
      res.render = (view, opts, cb) => {
        if (typeof opts === 'function') { cb = opts; opts = {}; }
        if (cb) return render(view, opts, cb);
        return render(view, opts, (err, html) => (err ? next(err) : res.send(filterSidebar(html, ctx))));
      };
    }
    next();
  } catch (e) { next(e); }
}

module.exports = { ACTIONS, GROUP_LABELS, registry, allSections, resolve, actionFlag, normalize, presets, decide, linkVisible, filterSidebar, hiddenGroups, middleware, loadRole };
