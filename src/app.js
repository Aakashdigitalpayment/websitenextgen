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
const { mediaUrl, tenantDir } = require('./lib/uploads');
const { statusLabel } = require('./lib/forms');
const navigation = require('./lib/navigation');

function createApp() {
  const app = express();
  app.set('views', path.join(config.rootDir, 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : 1);
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
  app.get('/sw.js', (req, res) => res.set('Service-Worker-Allowed', '/').set('Cache-Control', 'no-cache').sendFile(path.join(config.rootDir, 'public', 'sw.js')));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(express.json({ limit: '256kb' }));

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

  // ---------- platform console (operators manage tenants) ----------
  const platformSession = session({
    name: 'platform.sid', secret: config.sessionSecret, resave: false, saveUninitialized: false,
    store: new PgStore({ pool: db.pool, schemaName: 'platform', tableName: 'user_sessions' }),
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
      db.withSchema(tenant.schema_name, () => next());
    } catch (e) { next(e); }
  });

  // tenant-isolated uploaded files
  app.use('/uploads', (req, res, next) => {
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
  app.use(require('./lib/license').guard);
  app.use(security.csrf);

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
