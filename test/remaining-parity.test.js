'use strict';
/** Remaining PHP parity items: help guide, map short links, public UX extras, ticker, admin photo capture. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'app.local';
process.env.PLATFORM_HOST = 'platform.app.local';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const tenants = require('../src/lib/tenants');
const config = require('../src/config');
const { createApp } = require('../src/app');

const SUFFIX = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
const A = 'rp' + SUFFIX, HA = `${A}.app.local`, PW = 'Admin@12345!';
const inA = fn => db.withSchema('tenant_' + A, fn);
let app;

const get = (url, agent) => (agent || request(app)).get(url).set('Host', HA);
const setting = (k, v) => inA(() => require('../src/lib/settings').set(k, v));
const clearCaches = () => inA(async () => { require('../src/lib/settings').invalidate(); require('../src/lib/navigation').invalidate(); require('../src/lib/public-cache').clear(); });
const csrfOf = html => (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];

async function adminAgent() {
  const agent = request.agent(app);
  const page = await get('/admin/login', agent);
  const r = await agent.post('/admin/login').set('Host', HA).type('form').send({ _csrf: csrfOf(page.text), username: 'admin', password: PW });
  assert.equal(r.status, 302, 'admin login');
  return agent;
}

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: A, name: 'Remaining A', domains: [HA], adminPassword: PW });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});

after(async () => {
  await new Promise(r => app.close(r));
  await db.query(`DROP SCHEMA IF EXISTS tenant_${A} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [A]);
  fs.rmSync(path.join(config.uploadDir, A), { recursive: true, force: true });
  await db.pool.end();
});

// ---------------------------------------------------------------- notice ticker
test('notice ticker: list rendered twice (seamless loop), copy hidden from screen readers, speed from length', async () => {
  await inA(() => db.query("INSERT INTO notices (title, title_np, content, is_active) VALUES ('Ticker one', 'टिकर एक', 'x', 1), ('Ticker two', 'टिकर दुई', 'x', 1)"));
  await clearCaches();
  const r = await get('/');
  assert.equal(r.status, 200);
  const track = (r.text.match(/<ul class="ticker-list"[\s\S]*?<\/ul>/) || [''])[0];
  assert.match(track, /--ticker-dur:\d+s/);
  assert.equal((track.match(/टिकर एक/g) || []).length, 2, 'two copies');
  const lis = (track.match(/<li/g) || []).length;
  assert.ok(lis >= 4 && lis % 2 === 0);
  assert.equal((track.match(/<li aria-hidden="true"/g) || []).length, lis / 2, 'second copy aria-hidden');
  const css = fs.readFileSync(path.join(__dirname, '../public/css/site.css'), 'utf8');
  assert.match(css, /@keyframes ticker \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(-50%\); \} \}/);
});

// ---------------------------------------------------------------- Google Maps short links
const maps = require('../src/lib/maps');
const PIN = 'https://www.google.com/maps/place/Office/@27.7172,85.324,17z/data=!3m1!4b1!3d27.7171!4d85.3241';
function fakeFetch(table) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.redirect, 'manual');
    assert.ok(opts.signal, 'timeout signal');
    const loc = table[url];
    if (loc instanceof Error) throw loc;
    return { status: loc ? 302 : 200, headers: new Map(loc ? [['location', loc]] : []), body: null };
  };
  fn.calls = calls;
  return fn;
}

test('map short links: resolved through Google hosts only, max 3 hops, never arbitrary hosts', async () => {
  assert.equal(maps.isShortLink('https://maps.app.goo.gl/AbC123'), true);
  assert.equal(maps.isShortLink('https://goo.gl/maps/xyz9'), true);
  assert.equal(maps.isShortLink('https://evil.com/maps.app.goo.gl/x'), false);
  assert.equal(maps.isShortLink('https://maps.app.goo.gl.evil.com/x'), false);
  assert.equal(maps.allowedHost('maps.google.com.np'), true);
  assert.equal(maps.allowedHost('www.google.com'), true);
  assert.equal(maps.allowedHost('google.com.evil.io'), false);
  assert.equal(maps.allowedHost('127.0.0.1'), false);

  let f = fakeFetch({ 'https://maps.app.goo.gl/AbC123': PIN });
  let r = await maps.resolveShortLink('https://maps.app.goo.gl/AbC123', { fetchImpl: f });
  assert.equal(r.lat, '27.7171'); assert.equal(r.lng, '85.3241');
  assert.match(r.embed, /^https:\/\/www\.google\.com\/maps\?q=27\.7171,85\.3241&z=17&output=embed$/);
  assert.deepEqual(f.calls, ['https://maps.app.goo.gl/AbC123'], 'the resolved Google URL itself is not fetched');

  // redirect off Google → refused, the foreign host is never contacted
  f = fakeFetch({ 'https://maps.app.goo.gl/Evil1': 'https://169.254.169.254/latest/meta-data' });
  assert.equal(await maps.resolveShortLink('https://maps.app.goo.gl/Evil1', { fetchImpl: f }), null);
  assert.equal(f.calls.length, 1);
  f = fakeFetch({ 'https://maps.app.goo.gl/Evil2': 'http://www.google.com/maps/@1,2,3z' });
  assert.equal(await maps.resolveShortLink('https://maps.app.goo.gl/Evil2', { fetchImpl: f }), null, 'no https downgrade');
  f = fakeFetch({ 'https://maps.app.goo.gl/Evil3': 'https://www.google.com:8443/maps/@1,2,3z' });
  assert.equal(await maps.resolveShortLink('https://maps.app.goo.gl/Evil3', { fetchImpl: f }), null, 'no odd ports');

  // consent interstitial: destination taken from ?continue= without fetching consent.google.com
  f = fakeFetch({ 'https://maps.app.goo.gl/Cons1': 'https://consent.google.com/m?continue=' + encodeURIComponent(PIN) });
  r = await maps.resolveShortLink('https://maps.app.goo.gl/Cons1', { fetchImpl: f });
  assert.equal(r.lat, '27.7171');
  assert.equal(f.calls.length, 1);

  // redirect loop between short links → gives up after 3 hops
  f = fakeFetch({ 'https://maps.app.goo.gl/Loop1': 'https://goo.gl/maps/Loop2', 'https://goo.gl/maps/Loop2': 'https://maps.app.goo.gl/Loop1' });
  assert.equal(await maps.resolveShortLink('https://maps.app.goo.gl/Loop1', { fetchImpl: f }), null);
  assert.equal(f.calls.length, 3);

  // network error / not a short link
  f = fakeFetch({ 'https://maps.app.goo.gl/Down1': new Error('timeout') });
  assert.equal(await maps.resolveShortLink('https://maps.app.goo.gl/Down1', { fetchImpl: f }), null);
  f = fakeFetch({});
  assert.equal(await maps.resolveShortLink('https://example.com/x', { fetchImpl: f }), null);
  assert.equal(f.calls.length, 0);
});

test('admin settings: short map links are resolved on save; a short directions link fills an empty map embed', async () => {
  const agent = await adminAgent();
  const fetchBefore = maps.fetchImpl;
  maps.fetchImpl = fakeFetch({ 'https://maps.app.goo.gl/Dir1': PIN, 'https://maps.app.goo.gl/Bad1': 'https://evil.example/x' });
  try {
    await setting('map_embed_url', '');
    let page = await get('/admin/settings?tab=contact', agent);
    let r = await agent.post('/admin/settings?_csrf=' + encodeURIComponent(csrfOf(page.text))).set('Host', HA).field('_csrf', csrfOf(page.text)).field('_tab', 'contact')
      .field('s_google_map_url', 'https://maps.app.goo.gl/Dir1').field('s_map_embed_url', '');
    assert.equal(r.status, 302);
    const s = await inA(async () => { require('../src/lib/settings').invalidate(); return require('../src/lib/settings').all(); });
    assert.equal(s.google_map_url, 'https://maps.app.goo.gl/Dir1', 'directions link kept as typed');
    assert.match(s.map_embed_url, /q=27\.7171,85\.3241.*output=embed/);
    assert.equal(s.map_lat, '27.7171');

    page = await get('/admin/settings?tab=contact', agent);
    r = await agent.post('/admin/settings?_csrf=' + encodeURIComponent(csrfOf(page.text))).set('Host', HA).field('_csrf', csrfOf(page.text)).field('_tab', 'contact')
      .field('s_google_map_url', 'https://maps.app.goo.gl/Dir1').field('s_map_embed_url', 'https://maps.app.goo.gl/Bad1');
    assert.equal(r.status, 422, 'short link that leaves Google is rejected');
    assert.match(r.text, /Could not resolve the short link|छोटो लिङ्क खोल्न सकिएन/);
  } finally { maps.fetchImpl = fetchBefore; }
});

// ---------------------------------------------------------------- admin help guide
test('help guide: content data is bilingual, links real admin pages, filtered by role and searchable', async () => {
  const help = require('../src/lib/help-content');
  const sections = new Set(help.SECTIONS.map(x => x[0]));
  assert.ok(help.ARTICLES.length >= 30);
  const ids = new Set();
  for (const a of help.ARTICLES) {
    assert.ok(!ids.has(a.id), 'unique id ' + a.id); ids.add(a.id);
    assert.ok(sections.has(a.section), a.id + ' section');
    assert.match(a.href, /^\/admin(\/|$)/);
    for (const pair of [a.title, a.summary, ...a.steps, ...(a.tips || [])]) {
      assert.equal(pair.length, 2); assert.ok(pair[0] && pair[1], a.id + ' has np + en');
      assert.match(pair[0], /[ऀ-ॿ]/, a.id + ' Nepali text');
    }
    assert.ok(require('../src/lib/icons').names.includes(a.icon), a.id + ' icon ' + a.icon);
  }
  const editor = help.visibleFor({ level: 1 }).map(a => a.id);
  assert.ok(editor.includes('notices') && !editor.includes('settings') && !editor.includes('backup'));
  assert.ok(help.visibleFor({ level: 4, allows: h => !h.startsWith('/admin/programs') }).every(a => a.id !== 'programs'), 'plan filter');
  assert.deepEqual(help.search(help.ARTICLES, 'WhatsApp').map(a => a.id), ['settings']);
  assert.ok(help.search(help.ARTICLES, 'पासवर्ड').length >= 3);

  const agent = await adminAgent();
  let r = await get('/admin/help', agent);
  assert.equal(r.status, 200);
  assert.match(r.text, /href="\/admin\/help"/, 'linked from the admin layout');
  assert.match(r.text, /data-help-search/);
  assert.match(r.text, /id="help-backup"/, 'superadmin sees superadmin articles');
  assert.ok(!/<script>/.test(r.text), 'no inline script');
  r = await get('/admin/help?q=' + encodeURIComponent('maps.app.goo.gl'), agent);
  assert.match(r.text, /id="help-settings"/);
  assert.ok(!/id="help-notices"/.test(r.text));
  r = await get('/admin/help?q=zzqqxx', agent);
  assert.match(r.text, /data-help-empty >|data-help-empty\s*>/);
  assert.ok(require('../src/lib/admin-perms').resolve('/help').always, 'open to every admin role');
});

// ---------------------------------------------------------------- public UX extras
test('public extras: WhatsApp float (validated), bottom nav, header background, nav count badges, how it works', async () => {
  const SD = require('../src/lib/setting-defs');
  assert.equal(SD.waNumber('+977 981-2345678'), '9779812345678');
  assert.equal(SD.waNumber('9812345678'), '9779812345678', 'Nepali mobile gets 977');
  assert.equal(SD.waNumber('00977 9812345678'), '9779812345678');
  assert.equal(SD.waNumber('javascript:alert(1)'), '');
  assert.equal(SD.waNumber('12345'), '');
  assert.ok(SD.clean(SD.byKey.whatsapp_number, 'call me', {}).error);
  assert.equal(SD.clean(SD.byKey.whatsapp_number, '+977 9812345678', {}).value, '+977 9812345678');
  assert.ok(SD.clean(SD.byKey.himal_bg_opacity, '101', {}).error);

  // invalid stored number (e.g. imported): no float, no social link
  await setting('whatsapp_number', 'not a number');
  await clearCaches();
  let r = await get('/about');
  assert.ok(!/wa-float/.test(r.text) && !/wa\.me/.test(r.text));
  assert.match(r.text, /class="bottom-nav"/);
  assert.match(r.text, /<body class="[^"]*" data-bottom-nav>/);
  for (const href of ['/', '/services', '/apply', '/track', '/member/login']) assert.match(r.text, new RegExp(`<nav class="bottom-nav"[\\s\\S]*href="${href.replace(/\//g, '\\/')}"`));

  await setting('whatsapp_number', '+977 981-2345678');
  await setting('whatsapp_message', 'Namaste & hi');
  await setting('himal_bg', 'settings/himal.jpg');
  await setting('himal_bg_opacity', '40');
  await setting('mobile_bottom_nav', '0');
  await inA(async () => {
    await db.query("INSERT INTO notices (title, title_np, content, is_active) VALUES ('Fresh', 'ताजा', 'x', 1)");
    await db.query("INSERT INTO auction_notices (title, status, is_active, auction_date) VALUES ('Open lot', 'upcoming', 1, CURRENT_DATE + 3), ('Closed lot', 'completed', 1, CURRENT_DATE + 3), ('Past lot', 'upcoming', 1, CURRENT_DATE - 3)");
  });
  await clearCaches();
  r = await get('/about');
  assert.match(r.text, /class="wa-float[^"]*" href="https:\/\/wa\.me\/9779812345678\?text=Namaste%20%26%20hi"/);
  assert.ok(!/class="bottom-nav"/.test(r.text), 'bottom nav can be switched off');
  assert.match(r.text, /class="site-header has-bg" style="--himal-bg:url\('\/[^']*settings\/himal\.jpg'\);--himal-opacity:0\.4"/);
  assert.match(r.text, /href="\/auctions">[^<]*<span class="badge badge-ok">१<\/span>/, 'one auction open for bids');
  assert.match(r.text, /href="\/notices">[^<]*<span class="badge badge-ok">/, 'new notices counted');
  assert.match(r.text, /class="nav-count"/);

  await setting('whatsapp_float', '0');
  await clearCaches();
  r = await get('/about');
  assert.ok(!/wa-float/.test(r.text) && /href="https:\/\/wa\.me\/9779812345678"/.test(r.text), 'float off, footer link stays');

  r = await get('/digital-services');
  assert.match(r.text, /class="how-steps/);
  assert.equal((r.text.match(/<li class="card card-flat"><h3>/g) || []).length, 4);
});

// ---------------------------------------------------------------- admin photo capture (member / KYM / committee)
test('admin photo capture: member and KYM photo upload (camera fills the file input), portrait resource fields get the camera', async () => {
  const jpg = await require('sharp')({ create: { width: 40, height: 50, channels: 3, background: '#8899aa' } }).jpeg().toBuffer();
  const agent = await adminAgent();
  const mem = await inA(() => db.one("INSERT INTO members (name, name_np, sadasyata_number, phone, approval_status, is_active) VALUES ('Photo Member', 'फोटो सदस्य', 'PH-001', '9811111111', 'approved', 1) RETURNING id"));

  let page = await get('/admin/members/' + mem.id, agent);
  assert.equal(page.status, 200);
  assert.match(page.text, /data-capture-form/);
  assert.match(page.text, /name="photo"[^>]*data-capture-file/);
  assert.match(page.text, /\/static\/js\/kyc-capture\.js/);
  const tok = csrfOf(page.text);
  let r = await agent.post(`/admin/members/${mem.id}/photo?_csrf=${encodeURIComponent(tok)}`).set('Host', HA).field('_csrf', tok).attach('photo', jpg, 'camera-1.jpg');
  assert.equal(r.status, 302);
  const k = await inA(() => db.one("SELECT k.id, k.photo FROM kyc_applications k JOIN members m ON m.kyc_application_id = k.id WHERE m.id = $1", [mem.id]));
  assert.ok(k && /^_private\/kyc\/[0-9a-f]{32}\.jpg$/.test(k.photo), 'photo stored privately on the KYM (SSOT)');
  assert.ok(fs.existsSync(path.join(config.uploadDir, A, k.photo)));
  assert.ok(await inA(() => db.value("SELECT 1 FROM audit_log WHERE action = 'member_photo_update'")));

  // KYM page: replace again, the old file is removed; a non-image is refused
  page = await get('/admin/inbox/kyc/' + k.id, agent);
  assert.match(page.text, new RegExp(`action="/admin/inbox/kyc/${k.id}/photo\\?_csrf=`));
  r = await agent.post(`/admin/inbox/kyc/${k.id}/photo?_csrf=${encodeURIComponent(tok)}`).set('Host', HA).field('_csrf', tok).attach('photo', jpg, 'b.jpg');
  assert.equal(r.status, 302);
  const k2 = await inA(() => db.one('SELECT photo FROM kyc_applications WHERE id = $1', [k.id]));
  assert.notEqual(k2.photo, k.photo);
  assert.ok(!fs.existsSync(path.join(config.uploadDir, A, k.photo)), 'old photo deleted');
  r = await agent.post(`/admin/inbox/kyc/${k.id}/photo?_csrf=${encodeURIComponent(tok)}`).set('Host', HA).field('_csrf', tok).attach('photo', Buffer.from('<?php echo 1; ?>'), 'x.jpg');
  assert.equal(r.status, 302);
  assert.equal((await inA(() => db.one('SELECT photo FROM kyc_applications WHERE id = $1', [k.id]))).photo, k2.photo, 'bad file ignored');
  // CSRF still required on the multipart route
  r = await agent.post(`/admin/inbox/kyc/${k.id}/photo`).set('Host', HA).attach('photo', jpg, 'c.jpg');
  assert.equal(r.status, 403);

  // committee member form: camera on the photo field
  page = await get('/admin/r/committee_members/new', agent);
  assert.match(page.text, /data-capture-form/);
  assert.match(page.text, /name="photo"[^>]*data-capture-field="photo" data-capture-file data-facing="user" data-aspect="0\.8"/);
  page = await get('/admin/r/news/new', agent);
  assert.ok(!/kyc-capture\.js/.test(page.text), 'no camera script where not needed');
  const js = fs.readFileSync(path.join(__dirname, '../public/js/kyc-capture.js'), 'utf8');
  assert.match(js, /form\[data-capture-form\]/);
  assert.match(js, /new DataTransfer\(\)/);
});
