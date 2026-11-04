'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const PgStore = require('connect-pg-simple')(session);
const helmet = require('helmet');
const compression = require('compression');

const config = require('./config');
const db = require('./db');
const tenants = require('./lib/tenants');
const settings = require('./lib/settings');
const security = require('./lib/security');
const auth = require('./lib/auth');
const util = require('./lib/util');
const nd = require('./lib/nepali-date');
const { icon } = require('./lib/icons');
const themes = require('./lib/themes');
const { mediaUrl, tenantDir } = require('./lib/uploads');
const { statusLabel } = require('./lib/forms');
const navigation = require('./lib/navigation');

function createApp() {
  const app = express();
  app.set('views', path.join(config.rootDir, 'views'));
  app.set('view engine', 'ejs');
  // Only trust X-Forwarded-* when a proxy is configured (TRUST_PROXY=1 / loopback / CIDR list); otherwise
  // a client could spoof its IP and bypass every rate limit.
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', !tp || tp === 'false' || tp === '0' ? false : /^\d+$/.test(tp) ? Number(tp) : tp);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
        'img-src': ["'self'", 'data:', 'https:'],
        'frame-src': ['https://www.google.com', 'https://maps.google.com', 'https://www.youtube.com', 'https://www.facebook.com'],
        'form-action': ["'self'"],
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }));
  app.use(compression());
  app.use('/static', express.static(path.join(config.rootDir, 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  // Caddy on_demand_tls "ask" hook: issue certificates only for hosts we actually serve.
  // Loopback only, so the public cannot enumerate tenant domains.
  app.get('/__tls/allowed', async (req, res) => {
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    const extra = String(process.env.TLS_ASK_ALLOW || '').split(',').map(x => x.trim()).filter(Boolean); // e.g. docker network prefix "172.18."
    if (!/^(127\.|::1$)/.test(ip) && !extra.some(p => ip.startsWith(p))) return res.status(403).end();
    const domain = tenants.normalizeHost(req.query.domain);
    if (!domain) return res.status(404).end();
    if (domain === config.platformHost) return res.status(200).end();
    let ok = !!(await db.value("SELECT 1 FROM platform.tenant_domains WHERE domain = $1 AND status = 'active'", [domain]))
      || !!(await db.value('SELECT 1 FROM platform.tenants WHERE cname_target = $1', [domain]));
    if (!ok && domain.endsWith('.' + config.baseDomain)) {
      const slug = domain.slice(0, -(config.baseDomain.length + 1));
      ok = tenants.SLUG_RE.test(slug) && !!(await db.value('SELECT 1 FROM platform.tenants WHERE slug = $1', [slug]));
    }
    res.status(ok ? 200 : 404).end();
  });
  app.get('/sw.js', (req, res) => res.set('Service-Worker-Allowed', '/').set('Cache-Control', 'no-cache').sendFile(path.join(config.rootDir, 'public', 'sw.js')));
  // ---------- layouts: res.render(view, { layout }) wraps the view in views/layouts/<layout>.ejs ----------
  app.use((req, res, next) => {
    const render = res.render.bind(res);
    res.render = (view, opts = {}, cb) => {
      const layout = opts.layout === undefined ? view.split('/')[0] : opts.layout;
      if (!layout || !fs.existsSync(path.join(config.rootDir, 'views', 'layouts', layout + '.ejs'))) return render(view, opts, cb);
      app.render(view, { ...res.locals, ...opts }, (err, body) => {
        if (err) return next(err);
        render('layouts/' + layout, { ...opts, body }, cb);
      });
    };
    next();
  });

  // ---------- shared view helpers ----------
  app.use((req, res, next) => {
    const lang = req.query.lang === 'en' || req.query.lang === 'np' ? req.query.lang : (req.get('cookie') || '').match(/(?:^|;\s*)lang=(en|np)/)?.[1] || 'np';
    req.lang = lang;
    Object.assign(res.locals, {
      lang, icon, mediaUrl, nd, util, statusLabel: s => statusLabel(s, lang),
      path: req.path, query: req.query,
      t: (np, en) => (lang === 'en' ? (en || np) : (np || en)),
      // pick a bilingual column: f(row, 'title') → title_np / title_en / title
      f: (row, field) => {
        if (!row) return '';
        return lang === 'en'
          ? row[field + '_en'] || row[field] || row[field + '_np'] || ''
          : row[field + '_np'] || row[field] || row[field + '_en'] || '';
      },
      num: v => (lang === 'np' ? nd.toNepaliDigits(v) : String(v ?? '')),
      money: v => util.money(v, lang),
      bsDate: ad => (ad ? nd.formatBs(nd.adToBs(ad instanceof Date ? ad : String(ad).slice(0, 10)), lang) : ''),
      isActive: p => (p === '/' ? req.path === '/' : req.path.startsWith(p)),
    });
    next();
  });

  app.use(express.urlencoded({ extended: false, limit: '256kb', parameterLimit: 500 }));
  const jsonBody = express.json({ limit: '64kb' });
  app.use((req, res, next) => (req.path.startsWith('/api/v1') ? next() : jsonBody(req, res, next))); // the API parses its own (larger) bodies

  // ---------- platform console (operators manage tenants) ----------
  // separate cookie, store table and signing secret from tenant sessions
  const platformSession = session({
    name: 'platform.sid', secret: require('crypto').createHmac('sha256', config.sessionSecret).update('platform-operator-sessions').digest('hex'),
    resave: false, saveUninitialized: false,
    store: new PgStore({ pool: db.pool, schemaName: 'platform', tableName: 'operator_sessions' }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 8 * 3600_000 },
  });
  app.use('/platform', (req, res, next) => {
    if (tenants.normalizeHost(req.hostname) !== config.platformHost) return next('router');
    next();
  }, platformSession, security.csrf, security.flashMiddleware, require('./routes/platform'));

  // ---------- tenant resolution: every request below runs inside the tenant's schema ----------
  app.use(async (req, res, next) => {
    try {
      const tenant = await tenants.resolveHost(req.hostname);
      if (!tenant) {
        if (tenants.normalizeHost(req.hostname) === config.platformHost) return res.redirect('/platform');
        return res.status(404).render('public/no-tenant', { layout: false, host: req.hostname });
      }
      if (tenant.status !== 'active') return res.status(503).render('public/no-tenant', { layout: false, host: req.hostname, suspended: true });
      req.tenant = tenant;
      res.locals.tenant = tenant;
      // visitors on the generated hostname / platform subdomain / a secondary domain go to the client's primary domain
      const host = tenants.normalizeHost(req.hostname);
      if (tenant.redirect_to_primary && tenant.primary_domain && host !== tenant.primary_domain && !require('./lib/domains').inOwnZone(tenant.primary_domain)
          && (req.method === 'GET' || req.method === 'HEAD')
          && !req.path.startsWith('/api/') && !req.path.startsWith('/__tls') && req.path !== '/healthz' && tenant.host_kind !== 'default') {
        return res.redirect(301, `${req.protocol}://${tenant.primary_domain}${req.originalUrl}`);
      }
      db.withSchema(tenant.schema_name, () => next());
    } catch (e) { next(e); }
  });

  // integration API (API keys, no cookies/CSRF) — before sessions
  app.use('/api/v1', require('./routes/api-v1'));

  // tenant-isolated uploaded files
  app.use('/uploads', (req, res, next) => {
    if (/^\/_private(\/|$)/i.test(decodeURIComponent(req.path))) return res.status(404).end();
    express.static(tenantDir(req), { maxAge: config.isProd ? '30d' : 0, dotfiles: 'deny', index: false,
      setHeaders: r => r.set('X-Content-Type-Options', 'nosniff').set('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'") })(req, res, next);
  });

  app.use(session({
    name: 'coop.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false, rolling: true,
    store: new PgStore({ pool: db.pool, schemaName: 'platform', tableName: 'user_sessions', pruneSessionInterval: 900 }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: 4 * 3600_000 },
  }));
  // keep AsyncLocalStorage context after the session store callback
  app.use((req, res, next) => db.withSchema(req.tenant.schema_name, () => next()));
  app.use(async (req, res, next) => {
    try {
      const s = await settings.all();
      res.locals.settings = s;
      res.locals.siteName = (req.lang === 'en' ? s.site_name_en : s.site_name) || s.site_name || req.tenant.name;
      res.locals.brandColor = /^#[0-9a-f]{3,8}$/i.test(s.primary_color || '') ? s.primary_color : '#0f766e';
      next();
    } catch (e) { next(e); }
  });
  app.use(security.flashMiddleware);
  app.use(auth.loadUsers);
  app.use((req, res, next) => {
    res.locals.theme = themes.resolve(req, res.locals.settings);
    res.locals.themeSwatches = themes.swatches(res.locals.brandColor, res.locals.theme.palette);
    next();
  });
  app.use(require('./lib/license').guard);
  app.use(security.csrf);

  // personal theme (when the cooperative allows it): cookie for everyone, saved on the account when signed in
  app.post('/theme', async (req, res, next) => {
    try {
      const pol = themes.policy(res.locals.settings);
      const json = (req.get('accept') || '').includes('application/json');
      if (!pol.allowUser) return json ? res.status(403).json({ error: 'Theme is fixed by the cooperative' }) : res.redirect(auth.safeNext(req.body.next, '/'));
      const reset = req.body.reset === '1';
      const palette = themes.isPalette(req.body.palette) ? req.body.palette : res.locals.theme.palette;
      const mode = themes.isMode(req.body.mode) ? req.body.mode : res.locals.theme.mode;
      const value = reset ? null : themes.serialize(palette, mode, pol.epoch);
      if (reset) res.clearCookie('theme', { sameSite: 'lax' });
      else res.cookie('theme', value, { maxAge: 365 * 86400_000, sameSite: 'lax', httpOnly: false, secure: config.isProd });
      if (req.member) await db.query('UPDATE members SET theme_pref = $1 WHERE id = $2', [value, req.member.id]);
      if (req.admin) await db.query('UPDATE admin_users SET theme_pref = $1 WHERE id = $2', [value, req.admin.id]);
      if (json) {
        const pal = themes.PALETTES.find(p => p.key === (reset ? pol.palette : palette));
        return res.json({ ok: true, palette: pal.key, mode: reset ? pol.mode : mode, brand: pal.brand || pol.orgColor });
      }
      res.redirect(auth.safeNext(req.body.next, '/'));
    } catch (e) { next(e); }
  });

  app.get('/lang/:code', (req, res) => {
    const code = req.params.code === 'en' ? 'en' : 'np';
    res.cookie('lang', code, { maxAge: 365 * 86400_000, sameSite: 'lax', httpOnly: false });
    res.redirect(auth.safeNext(req.query.next, '/'));
  });

  app.use('/admin', require('./routes/admin'));
  app.use('/member', require('./routes/member'));
  app.use('/', navigation.middleware, require('./routes/public'));

  // 404
  app.use((req, res) => {
    res.status(404).render(req.path.startsWith('/admin') && req.admin ? 'admin/error' : 'public/error',
      { title: 'Not found', code: 404, message: res.locals.t('तपाईंले खोजेको पृष्ठ भेटिएन।', 'The page you are looking for was not found.') });
  });

  // errors
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(err.status || 500);
    try {
      res.render('public/error', { layout: req.tenant ? 'public' : false, title: 'Error', code: err.status || 500,
        message: config.isProd ? 'केही गडबड भयो। केही समयपछि प्रयास गर्नुहोस्। (Something went wrong.)' : err.message,
        settings: res.locals.settings || {}, siteName: res.locals.siteName || '', nav: res.locals.nav || [] });
    } catch { res.type('text').send('Internal error'); }
  });

  return app;
}

module.exports = { createApp };
