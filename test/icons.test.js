'use strict';
/** Lucide icons (src/lib/icons.js): alias table, every icon name the code uses, legacy Font Awesome values, fallback, safe output. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const icons = require('../src/lib/icons');
const NODES = require('lucide-static/icon-nodes.json');

const ROOT = path.join(__dirname, '..');
function files(dir, ext) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(rel, ext));
    else if (ext.some(x => e.name.endsWith(x))) out.push(rel);
  }
  return out;
}
const CODE = [...files('views', ['.ejs']), ...files('src', ['.js']), ...files('public/js', ['.js'])].filter(f => !f.endsWith(path.join('lib', 'icons.js')));
const src = Object.fromEntries(CODE.map(f => [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]));
const lucideName = n => Object.hasOwn(NODES, n);
const bodyOf = svg => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');

test('every alias points at an existing Lucide icon', () => {
  const entries = Object.entries(icons.ALIAS);
  assert.ok(entries.length > 400, 'alias table covers old names + Font Awesome');
  for (const [k, v] of entries) assert.ok(lucideName(v), `alias ${k} → ${v} is not a Lucide icon`);
  for (const [, v] of icons.KEYWORDS) assert.ok(lucideName(v), `keyword → ${v}`);
  assert.ok(lucideName(icons.FALLBACK));
});

test('old custom icon names (pre-Lucide icons.js) all resolve', () => {
  const old = 'phone mail pin clock menu close chevron right left user users banknote wallet id message calendar heart briefcase star award gavel file download bell news image calculator percent chart shield search home settings logout plus edit trash eye check inbox layers link globe building vote qr sun moon facebook youtube instagram whatsapp store tenant info alert'.split(' ');
  for (const n of old) {
    assert.ok(icons.has(n), n);
    assert.ok(lucideName(icons.resolve(n)), n + ' → ' + icons.resolve(n));
  }
  assert.equal(icons.resolve('pin'), 'map-pin'); // old "pin" was a map marker, not Lucide's push-pin
  assert.equal(icons.resolve('close'), 'x');
});

test('every icon name literal used in views / src / public js resolves', () => {
  const seen = new Set();
  for (const [f, s] of Object.entries(src)) {
    // icon('name'), icon(cond ? 'a' : 'b'), icon('name', 'icon-lg'), iconFor(x, 'fallback')
    for (const m of s.matchAll(/\bicon(?:For)?\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const lit of m[1].matchAll(/(?<![=!]==?\s*)'([a-z][a-z0-9-]*)'/g)) if (!lit[1].startsWith('icon-')) seen.add(f + ': ' + lit[1]);
    }
    // registries / data: icon: 'name', ICON(..., { default: 'name' })
    for (const m of s.matchAll(/\bicon:\s*'([a-z][a-z0-9 -]*)'/g)) seen.add(f + ': ' + m[1]);
    for (const m of s.matchAll(/ICON\([^)]*default:\s*'([^']+)'/g)) seen.add(f + ': ' + m[1]);
  }
  assert.ok(seen.size > 100, 'scanned icon names: ' + seen.size);
  const bad = [...seen].filter(x => !icons.has(x.split(': ')[1]));
  assert.deepEqual(bad, []);
});

test('help guide, theme modes and application modules use known icons', () => {
  for (const a of require('../src/lib/help-content').ARTICLES) assert.ok(icons.has(a.icon), 'help ' + a.id + ' ' + a.icon);
  for (const m of Object.values(require('../src/modules/applications'))) if (m && m.icon) assert.ok(icons.has(m.icon), 'module ' + m.icon);
  for (const r of Object.values(require('../src/modules/resources').resources)) {
    if (!r || typeof r !== 'object') continue;
    if (r.icon) assert.ok(icons.has(r.icon), 'resource icon ' + r.icon);
    for (const l of r.links || []) assert.ok(icons.has(l[1]), 'resource link icon ' + l[1]);
  }
});

test('legacy Font Awesome values from the PHP site render as Lucide', () => {
  const cases = {
    'fas fa-piggy-bank': 'piggy-bank', 'fa fa-users': 'users', 'fa-solid fa-star': 'star', 'far fa-file-pdf': 'file-text',
    'fas fa-hand-holding-usd': 'hand-coins', 'fas fa-sitemap': 'network', 'fas fa-briefcase': 'briefcase', 'fab fa-facebook-f': 'facebook',
    'fas fa-map-marker-alt': 'map-pin', 'fas fa-mobile-alt fa-2x': 'smartphone', 'fa-envelope': 'mail', 'fas fa-bolt': 'zap',
    'fas fa-university': 'landmark', 'fas fa-home': 'house', 'fas fa-exclamation-triangle': 'triangle-alert', 'fas fa-cogs': 'settings',
    'FAS FA-USERS': 'users', 'lucide-phone': 'phone',
  };
  for (const [v, want] of Object.entries(cases)) {
    assert.equal(icons.resolve(v), want, v);
    assert.match(icons.icon(v), new RegExp(`lucide-${want}[ "]`), v);
  }
  // every Font Awesome name the PHP admin pickers / seeds used maps to something real
  for (const k of Object.keys(icons.FA)) assert.ok(lucideName(icons.resolve('fas fa-' + k)), k);
  // free text from admins falls back on keywords
  assert.equal(icons.iconFor('loan scheme'), 'hand-coins');
  assert.equal(icons.iconFor('', 'layers'), 'layers');
});

test('unknown names fall back without throwing', () => {
  for (const v of ['zzz-nope', '', null, undefined, 42, {}, 'fas fa-zzz-nope']) {
    const out = icons.icon(v);
    assert.match(out, /^<svg class="icon lucide lucide-circle"/);
  }
  assert.equal(icons.iconFor('zzz-nope', 'banknote'), 'banknote');
  assert.equal(icons.iconFor('zzz-nope', 'zzz-also'), icons.FALLBACK);
  assert.equal(icons.faToNode('zzz-nope'), icons.FALLBACK);
});

test('output is plain inline SVG: no script, no style, no handlers; options work', () => {
  const evil = ['"><script>alert(1)</script>', "x' onload='alert(1)", 'javascript:alert(1)'];
  for (const n of [...icons.names, ...evil, ...icons.all.slice(0, 300)]) {
    const out = icons.icon(n, 'icon-lg');
    assert.match(out, /^<svg [^<]*viewBox="0 0 24 24"[^<]*>.*<\/svg>$/s);
    assert.doesNotMatch(out, /<script|style=|\son[a-z]+=|javascript:/i, n);
    assert.ok(bodyOf(out).length > 10, 'has shapes: ' + n);
  }
  const plain = icons.icon('bell');
  assert.match(plain, /class="icon lucide lucide-bell"/);
  assert.match(plain, /aria-hidden="true"/);
  assert.match(icons.icon('user', 'icon-lg'), /class="icon lucide lucide-user icon-lg"/);
  const titled = icons.icon('bell', { size: 20, title: 'Alerts <b>', class: 'x' });
  assert.match(titled, /width="20" height="20"/);
  assert.match(titled, /role="img" aria-label="Alerts &lt;b&gt;"><title>Alerts &lt;b&gt;<\/title>/);
  assert.doesNotMatch(titled, /aria-hidden/);
});

test('admin picker: curated Lucide subset + search across all, names store as themselves', () => {
  assert.ok(icons.names.length >= 150 && icons.names.length <= 250, 'curated ' + icons.names.length);
  for (const n of icons.names) assert.equal(icons.resolve(n), n, 'curated ' + n + ' must not be shadowed by an alias');
  for (const n of icons.all) assert.equal(icons.resolve(n), n);
  assert.ok(icons.all.length > 1500);
  assert.ok(icons.search('bank').includes('landmark'), 'tag search');
  assert.ok(icons.search('rupee').includes('indian-rupee'));
  assert.equal(icons.search('fa-users')[0], 'users');
  assert.ok(icons.search('').length > 0);
});

test('no hand-drawn SVG icons left in views or client JS', () => {
  const allowed = [path.join('views', 'partials', 'chart.ejs')]; // data chart
  for (const [f, s] of Object.entries(src)) {
    if (!f.startsWith('views') && !f.startsWith(path.join('public', 'js'))) continue;
    if (allowed.includes(f)) continue;
    assert.doesNotMatch(s, /<svg[\s>]/, f + ' has an inline <svg>; use icon()');
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src/lib/icons.js'), 'utf8'), /<path d=/, 'icons.js holds no path data');
});
