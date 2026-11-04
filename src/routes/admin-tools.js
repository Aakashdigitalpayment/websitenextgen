'use strict';
/**
 * Admin tools: custom roles, menu control, analytics, quick search, error log, information-room
 * access log / preview, gallery multi-upload + videos, satisfaction widget. Mounted at /admin.
 */
const express = require('express');
const db = require('../db');
const auth = require('../lib/auth');
const util = require('../lib/util');
const settings = require('../lib/settings');
const perms = require('../lib/admin-perms');
const { upload, sendStored, remove } = require('../lib/uploads');
const { flash } = require('../lib/security');
const modules = require('../modules/applications');

const router = express.Router();
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const { requireAdmin } = auth;

// ---------------------------------------------------------------- custom roles (superadmin)
router.get('/roles', requireAdmin('superadmin'), ah(async (req, res) => {
  const roles = await db.many('SELECT r.*, (SELECT count(*) FROM admin_users u WHERE u.custom_role_id = r.id AND u.deleted_at IS NULL) AS user_count FROM admin_roles r ORDER BY r.name');
  const editing = roles.find(r => r.id === util.int(req.query.edit, 0)) || null;
  const showForm = !!editing || req.query.new === '1';
  res.render('admin/roles', {
    title: res.locals.t('भूमिका र अनुमति', 'Roles & permissions'), roles, editing, showForm,
    current: editing ? perms.normalize(editing.permissions) : {}, registry: perms.registry(), actions: perms.ACTIONS,
    presets: perms.presets(), tally: r => { const p = perms.normalize(r.permissions); const t = { v: 0, c: 0, e: 0, d: 0 }; for (const f of Object.values(p)) for (const ch of f) t[ch]++; return t; },
  });
}));

router.post('/roles', requireAdmin('superadmin'), ah(async (req, res) => {
  const t = res.locals.t;
  const rid = util.int(req.body.role_id, 0);
  if (req.body.action === 'delete_role') {
    const used = await db.value('SELECT count(*) FROM admin_users WHERE custom_role_id = $1 AND deleted_at IS NULL', [rid]);
    if (used > 0) flash(req, 'error', t('यो भूमिका प्रशासकलाई दिइएको छ — पहिले हटाउनुहोस्।', 'This role is assigned to admin users — unassign it first.'));
    else if (rid) {
      await db.query('DELETE FROM admin_roles WHERE id = $1', [rid]);
      await db.query('UPDATE admin_users SET custom_role_id = NULL WHERE custom_role_id = $1', [rid]);
      await auth.audit(req, 'admin_role_delete', 'admin_roles', rid, `Role #${rid} deleted`);
      flash(req, 'success', t('भूमिका हटाइयो।', 'Role deleted.'));
    }
    return res.redirect('/admin/roles');
  }
  const name = String(req.body.name || '').trim().slice(0, 100);
  const description = String(req.body.description || '').trim().slice(0, 255);
  if (!name) { flash(req, 'error', t('भूमिकाको नाम अनिवार्य छ।', 'Role name is required.')); return res.redirect('/admin/roles?' + (rid ? 'edit=' + rid : 'new=1')); }
  // checkbox values look like "<section>|<flag>"
  const raw = {};
  for (const v of [].concat(req.body.perm || [])) {
    const i = String(v).lastIndexOf('|');
    if (i < 1) continue;
    const key = String(v).slice(0, i), flag = String(v).slice(i + 1);
    raw[key] = (raw[key] || '') + flag;
  }
  const p = perms.normalize(raw);
  let id = rid;
  if (rid) await db.query('UPDATE admin_roles SET name = $1, description = $2, permissions = $3, updated_at = now() WHERE id = $4', [name, description, JSON.stringify(p), rid]);
  else id = (await db.insert('admin_roles', { name, description, permissions: JSON.stringify(p) })).id;
  await auth.audit(req, 'admin_role_save', 'admin_roles', id, `Role ${name} — ${Object.keys(p).length} sections`, { new: p });
  flash(req, 'success', t(`भूमिका "${name}" सुरक्षित भयो (${Object.keys(p).length} मेनु)।`, `Role "${name}" saved (${Object.keys(p).length} menus).`));
  res.redirect('/admin/roles');
}));

// ---------------------------------------------------------------- menu control (superadmin)
router.get('/menu-control', requireAdmin('superadmin'), ah(async (req, res) => {
  res.render('admin/menu-control', { title: res.locals.t('मेनु नियन्त्रण', 'Menu control'), groups: perms.GROUP_LABELS, hidden: perms.hiddenGroups(await settings.all()) });
}));

router.post('/menu-control', requireAdmin('superadmin'), ah(async (req, res) => {
  const t = res.locals.t;
  // a stolen superadmin session alone cannot flip menus: the account password is required on every save
  const me = await db.one('SELECT password FROM admin_users WHERE id = $1', [req.admin.id]);
  if (!(await auth.checkPassword(String(req.body.confirm_password || ''), me.password))) {
    flash(req, 'error', t('पासवर्ड मिलेन। मेनु परिवर्तन सुरक्षित भएन।', 'Password is wrong. Menu changes were not saved.'));
    return res.redirect('/admin/menu-control');
  }
  const hide = req.body.action === 'reset' ? [] : [...new Set([].concat(req.body.hidden || []).filter(g => Object.hasOwn(perms.GROUP_LABELS, g)))];
  await settings.set('admin_hidden_menu_groups', JSON.stringify(hide), { group: 'internal', label: 'Hidden admin menu groups (JSON)' });
  await auth.audit(req, req.body.action === 'reset' ? 'menu_control_reset' : 'menu_control_update', 'site_settings', null, 'hidden_groups=' + (hide.join(',') || '(none)'));
  flash(req, 'success', hide.length ? t('लुकेका समूह: ', 'Hidden groups: ') + hide.map(g => t(...perms.GROUP_LABELS[g])).join(', ') : t('सबै मेनु देखिने बनाइयो।', 'All menus are visible.'));
  res.redirect('/admin/menu-control');
}));

// ---------------------------------------------------------------- analytics
const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
router.get('/analytics', requireAdmin('admin'), ah(async (req, res) => {
  const months = n => db.many(`SELECT to_char(d, 'YYYY-MM') AS mo FROM generate_series(date_trunc('month', now()) - interval '${n - 1} months', date_trunc('month', now()), interval '1 month') d ORDER BY d`);
  const [m12, m6] = await Promise.all([months(12), months(6)]);
  const growthRows = await db.many(`SELECT to_char(created_at, 'YYYY-MM') AS mo, count(*) AS n FROM members WHERE deleted_at IS NULL AND created_at >= date_trunc('month', now()) - interval '11 months' GROUP BY 1`);
  const base = await db.value(`SELECT count(*) FROM members WHERE deleted_at IS NULL AND created_at < date_trunc('month', now()) - interval '11 months'`);
  let cum = Number(base) || 0;
  const growth = m12.map(({ mo }) => { const n = Number(growthRows.find(r => r.mo === mo)?.n || 0); cum += n; return { label: mo, value: n, cum }; });
  const count = (table, where = '') => safe(async () => Number(await db.value(`SELECT count(*) FROM ${table} ${where}`)) || 0, 0);
  const appTypes = [];
  for (const m of Object.values(modules)) {
    if (m.key === 'contact' || m.key === 'survey') continue;
    const cols = await db.columns(m.table);
    appTypes.push({ label: res.locals.t(...m.title), value: await count(m.table, cols.has('deleted_at') ? 'WHERE deleted_at IS NULL' : '') });
  }
  appTypes.sort((a, b) => b.value - a.value);
  const monthly = m6.map(({ mo }) => ({ label: mo, value: 0 }));
  for (const tbl of ['kyc_applications', 'loan_applications', 'account_applications', 'appointments']) {
    const rows = await safe(() => db.many(`SELECT to_char(created_at, 'YYYY-MM') AS mo, count(*) AS n FROM ${tbl} WHERE created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1`), []);
    for (const r of rows) { const x = monthly.find(m => m.label === r.mo); if (x) x.value += Number(r.n); }
  }
  const grouped = (sql) => safe(async () => (await db.many(sql)).map(r => ({ label: r.label || '—', value: Number(r.n) })), []);
  const [kycStatus, memStatus, welfare, attendance, visitors] = await Promise.all([
    grouped('SELECT status AS label, count(*) AS n FROM kyc_applications GROUP BY 1 ORDER BY 2 DESC'),
    grouped('SELECT approval_status AS label, count(*) AS n FROM members WHERE deleted_at IS NULL GROUP BY 1 ORDER BY 2 DESC'),
    grouped('SELECT claim_type AS label, count(*) AS n FROM member_welfare_claims GROUP BY 1 ORDER BY 2 DESC LIMIT 8'),
    grouped('SELECT program_title AS label, count(*) AS n FROM member_program_attendance GROUP BY 1 ORDER BY 2 DESC LIMIT 8'),
    db.many(`SELECT to_char(d, 'MM-DD') AS label, COALESCE(v.page_views, 0) AS value FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, '1 day') d LEFT JOIN visitor_stats v ON v.visit_date = d::date ORDER BY d`),
  ]);
  const stats = {
    members: await count('members', "WHERE deleted_at IS NULL AND approval_status = 'approved'"),
    kyc: await count('kyc_applications', "WHERE status = 'approved'"),
    attend: await safe(async () => Number(await db.value('SELECT count(DISTINCT member_id) FROM member_program_attendance')) || 0, 0),
    welfare: await count('member_welfare_claims'), loans: await count('loan_applications'), accounts: await count('account_applications'),
  };
  res.render('admin/analytics', { title: res.locals.t('विश्लेषण', 'Analytics'), stats, growth, appTypes, monthly, kycStatus, memStatus, welfare, attendance, visitors: visitors.map(v => ({ ...v, value: Number(v.value) })) });
}));

// ---------------------------------------------------------------- quick search (top bar)
router.get('/quick-search', ah(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  const out = { groups: [], total: 0 };
  if (q.length < 2) return res.json(out);
  const like = '%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%';
  const can = res.locals.can, lvl = auth.roleLevel(req.admin.role);
  const t = res.locals.t;
  const push = (label, items) => { if (items.length) { out.groups.push({ label, items }); out.total += items.length; } };
  if (lvl >= 2 && can('members')) {
    const rows = await db.many(`SELECT id, name, name_np, email, phone, sadasyata_number, approval_status FROM members WHERE deleted_at IS NULL
      AND (name ILIKE $1 OR name_np ILIKE $1 OR email ILIKE $1 OR phone ILIKE $1 OR sadasyata_number ILIKE $1) ORDER BY created_at DESC NULLS LAST LIMIT 6`, [like]);
    push(t('सदस्य', 'Members'), rows.map(r => ({ title: r.name_np || r.name, sub: r.sadasyata_number ? t('सदस्य #', 'Member #') + r.sadasyata_number : r.email || r.phone || '', badge: r.approval_status || '', url: '/admin/members/' + r.id })));
  }
  if (lvl >= 2) {
    for (const key of ['kyc', 'loan', 'membership']) {
      const m = modules[key];
      if (!m || !can('inbox:' + key) || (m.adminOnly && lvl < 3)) continue;
      const cols = await db.columns(m.table);
      const search = [m.nameCol, m.phoneCol, 'tracking_id'].filter(c => c && cols.has(c));
      if (!search.length) continue;
      const rows = await db.many(`SELECT * FROM ${m.table} WHERE (${search.map(c => `${c}::text ILIKE $1`).join(' OR ')})${cols.has('deleted_at') ? ' AND deleted_at IS NULL' : ''} ORDER BY id DESC LIMIT 5`, [like]);
      push(t(...m.title), rows.map(r => ({ title: r[m.nameCol] || '#' + r.id, sub: r.tracking_id || r[m.phoneCol] || '', badge: r.status || '', url: `/admin/inbox/${key}/${r.id}` })));
    }
  }
  for (const [table, label, order] of [['notices', t('सूचना', 'Notices'), 'notice_date DESC NULLS LAST, id DESC'], ['news', t('समाचार', 'News'), 'id DESC']]) {
    if (!can('r:' + table)) continue;
    const rows = await db.many(`SELECT id, title, title_np, is_active FROM ${table} WHERE deleted_at IS NULL AND (title ILIKE $1 OR title_np ILIKE $1) ORDER BY ${order} LIMIT 5`, [like]);
    push(label, rows.map(r => ({ title: r.title_np || r.title, sub: '', badge: r.is_active ? 'active' : 'inactive', url: `/admin/r/${table}/${r.id}/edit` })));
  }
  res.json(out);
}));

// ---------------------------------------------------------------- error log (superadmin)
router.get('/error-log', requireAdmin('superadmin'), ah(async (req, res) => {
  const total = await db.value('SELECT count(*) FROM app_error_log');
  const pg = util.paginate(total, util.int(req.query.page, 1), 50);
  const rows = await db.many(`SELECT * FROM app_error_log ORDER BY id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`);
  const top = await db.many(`SELECT left(message, 160) AS message, count(*) AS n, max(created_at) AS last FROM app_error_log WHERE created_at > now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 5`);
  res.render('admin/error-log', { title: res.locals.t('त्रुटि लग', 'Error log'), rows, pg, top });
}));
router.post('/error-log/clear', requireAdmin('superadmin'), ah(async (req, res) => {
  const r = await db.query('DELETE FROM app_error_log');
  await auth.audit(req, 'error_log_clear', 'app_error_log', null, `Error log cleared (${r.rowCount} rows)`);
  flash(req, 'success', res.locals.t('त्रुटि लग खाली गरियो।', 'Error log cleared.'));
  res.redirect('/admin/error-log');
}));

// ---------------------------------------------------------------- information room: access log + admin preview
router.get('/information-room/logs', requireAdmin('admin'), ah(async (req, res) => {
  const item = util.int(req.query.item, 0);
  const viewer = ['member', 'admin'].includes(req.query.viewer) ? req.query.viewer : '';
  const where = [], params = [];
  if (item) { params.push(item); where.push(`l.item_id = $${params.length}`); }
  if (viewer) { params.push(viewer); where.push(`l.viewer_type = $${params.length}`); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = await db.value(`SELECT count(*) FROM information_room_access_log l ${w}`, params);
  const pg = util.paginate(total, util.int(req.query.page, 1), 50);
  const rows = await db.many(`SELECT l.*, i.title, i.title_np FROM information_room_access_log l LEFT JOIN information_room_items i ON i.id = l.item_id ${w} ORDER BY l.id DESC LIMIT ${pg.perPage} OFFSET ${pg.offset}`, params);
  res.render('admin/ir-logs', { title: res.locals.t('सूचना कक्ष — पहुँच लग', 'Information room — access log'), rows, pg, item, viewer });
}));
router.get('/information-room/browse', requireAdmin('admin'), ah(async (req, res) => {
  const cats = (await db.many('SELECT DISTINCT category FROM information_room_items WHERE is_active = 1 ORDER BY 1')).map(r => r.category);
  const cat = cats.includes(req.query.cat) ? req.query.cat : '';
  const items = await db.many(`SELECT * FROM information_room_items WHERE is_active = 1 ${cat ? 'AND category = $1' : ''} ORDER BY display_order, meeting_date DESC NULLS LAST, id DESC`, cat ? [cat] : []);
  res.render('admin/ir-browse', { title: res.locals.t('सूचना कक्ष — पूर्वावलोकन', 'Information room — preview'), items, cats, cat });
}));
router.get('/information-room/view/:id', requireAdmin('admin'), ah(async (req, res, next) => {
  const item = await db.one('SELECT * FROM information_room_items WHERE id = $1', [util.int(req.params.id)]);
  if (!item || !item.file_path) return next();
  await db.query(`INSERT INTO information_room_access_log (item_id, viewer_type, viewer_id, viewer_name, action, ip_address, created_at) VALUES ($1, 'admin', $2, $3, 'view', $4, now())`,
    [item.id, req.admin.id, req.admin.full_name || req.admin.username, req.ip]);
  sendStored(req, res, next, item.file_path);
}));

// ---------------------------------------------------------------- gallery: multi-photo upload + YouTube videos
const youtubeId = url => (String(url || '').match(/(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([A-Za-z0-9_-]{11})/) || [])[1] || null;
const youtubeThumb = url => { const id = youtubeId(url); return id ? `https://img.youtube.com/vi/${id}/hqdefault.jpg` : null; };

async function galleryPage(req, res, extra = {}) {
  const albums = await db.many('SELECT id, name_np, name_en, category FROM gallery_albums ORDER BY display_order, id DESC');
  const videos = await db.many("SELECT * FROM gallery WHERE media_type = 'video' AND deleted_at IS NULL ORDER BY id DESC LIMIT 30");
  res.status(extra.status || 200).render('admin/gallery-upload', { title: res.locals.t('ग्यालरी — अपलोड / भिडियो', 'Gallery — upload / videos'), albums, videos, error: null, ...extra });
}
router.get('/gallery/upload', requireAdmin('editor'), ah((req, res) => galleryPage(req, res)));

router.post('/gallery/upload', requireAdmin('editor'), (req, res, next) => {
  const [mw, csrf] = upload('gallery', [{ name: 'images', kind: 'image', maxCount: 30 }], { maxMb: 10 });
  mw(req, res, err => (err ? next(err) : csrf(req, res, next)));
}, ah(async (req, res) => {
  const t = res.locals.t;
  const files = [].concat((req.uploaded && req.uploaded.images) || []);
  const album = await db.one('SELECT * FROM gallery_albums WHERE id = $1', [util.int(req.body.album_id, 0)]);
  if (!album) { files.forEach(f => remove(req, f)); return galleryPage(req, res, { status: 422, error: t('पहिले एल्बम छान्नुहोस्।', 'Choose an album first.') }); }
  if (!files.length) return galleryPage(req, res, { status: 422, error: req.uploadError || t('फोटो छान्नुहोस् (PNG, JPG, WebP)।', 'Choose photos (PNG, JPG, WebP).') });
  const title = String(req.body.title || '').trim().slice(0, 200) || null;
  const titleNp = String(req.body.title_np || '').trim().slice(0, 200) || title;
  const active = req.body.is_active ? 1 : 0;
  for (const f of files) {
    await db.insert('gallery', await db.pick('gallery', { title: title || titleNp, title_np: titleNp, image: f, media_type: 'photo', category: album.category || 'general', album: album.name_np, album_id: album.id, is_active: active }));
  }
  await auth.audit(req, 'create', 'gallery', null, `${files.length} photos → album #${album.id}`);
  flash(req, req.uploadError ? 'warn' : 'success', t(`${files.length} फोटो "${album.name_np}" एल्बममा थपियो।`, `${files.length} photos added to "${album.name_en || album.name_np}".`) + (req.uploadError ? ' ' + req.uploadError : ''));
  res.redirect('/admin/gallery/upload');
}));

router.post('/gallery/video', requireAdmin('editor'), ah(async (req, res) => {
  const t = res.locals.t;
  const url = String(req.body.video_url || '').trim().slice(0, 500);
  const album = await db.one('SELECT * FROM gallery_albums WHERE id = $1', [util.int(req.body.album_id, 0)]);
  if (!album) return galleryPage(req, res, { status: 422, error: t('भिडियो थप्न पहिले एल्बम छान्नुहोस्।', 'Choose an album for the video.') });
  if (!/^https:\/\//i.test(url) || !youtubeId(url)) return galleryPage(req, res, { status: 422, error: t('मान्य YouTube लिङ्क राख्नुहोस्।', 'Enter a valid YouTube link.') });
  const title = String(req.body.title || '').trim().slice(0, 200) || null;
  const titleNp = String(req.body.title_np || '').trim().slice(0, 200) || title;
  const row = await db.insert('gallery', await db.pick('gallery', { title: title || titleNp, title_np: titleNp, image: '', media_type: 'video', video_url: url, thumbnail: youtubeThumb(url), category: album.category || 'general', album: album.name_np, album_id: album.id, is_active: req.body.is_active ? 1 : 0 }));
  await auth.audit(req, 'create', 'gallery', row.id, 'Video ' + url);
  flash(req, 'success', t('भिडियो थपियो।', 'Video added.'));
  res.redirect('/admin/gallery/upload');
}));

// ---------------------------------------------------------------- satisfaction widget
router.get('/satisfaction', requireAdmin('admin'), ah(async (req, res) => {
  const links = await db.many('SELECT * FROM satisfaction_links ORDER BY display_order, id');
  res.render('admin/satisfaction', { title: res.locals.t('सन्तुष्टि विजेट', 'Satisfaction widget'), links, enabled: (await settings.get('satisfaction_widget_enabled', '0')) === '1' });
}));
router.post('/satisfaction', requireAdmin('admin'), ah(async (req, res) => {
  const on = req.body.widget_enabled === '1' ? '1' : '0';
  await settings.set('satisfaction_widget_enabled', on, { group: 'internal', label: 'Satisfaction widget' });
  await auth.audit(req, 'update', 'site_settings', null, 'Satisfaction widget ' + (on === '1' ? 'on' : 'off'));
  flash(req, 'success', on === '1' ? res.locals.t('विजेट सक्रिय भयो।', 'Widget turned on.') : res.locals.t('विजेट बन्द भयो।', 'Widget turned off.'));
  res.redirect('/admin/satisfaction');
}));

module.exports = router;
module.exports.youtubeId = youtubeId;
module.exports.youtubeThumb = youtubeThumb;
