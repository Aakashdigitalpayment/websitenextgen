'use strict';
/** 8K UHD responsive images: variants, srcset, limits, cleanup. */
process.env.DEFAULT_TENANT = '';
process.env.BASE_DOMAIN = 'img.local';
process.env.WEBHOOK_WORKER = 'off';
process.env.DOMAIN_WORKER = 'off';
delete process.env.TRUST_PROXY;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const db = require('../src/db');
const config = require('../src/config');
const tenants = require('../src/lib/tenants');
const images = require('../src/lib/images');
const uploads = require('../src/lib/uploads');
const { createApp } = require('../src/app');

const SLUG = 'im' + Date.now().toString(36).slice(-5);
const HOST = `${SLUG}.img.local`;
const DIR = path.join(config.uploadDir, SLUG, 'sliders');
let app;

const make = (file, width, height) => sharp({ create: { width, height, channels: 3, background: { r: 15, g: 118, b: 110 } } })
  .composite([{ input: Buffer.from(`<svg width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${height / 3}" fill="#f5b942"/></svg>`) }])
  .jpeg({ quality: 85 }).toFile(file);

before(async () => {
  await tenants.applyPlatformSchema();
  await tenants.createTenant({ slug: SLUG, name: 'Image Coop', domains: [HOST], adminPassword: 'Admin@12345!', starterContent: false });
  fs.mkdirSync(DIR, { recursive: true });
  app = require('http').createServer(createApp());
  await new Promise(r => app.listen(0, '127.0.0.1', r));
});
after(async () => {
  await new Promise(r => app.close(r));
  fs.rmSync(path.join(config.uploadDir, SLUG), { recursive: true, force: true });
  await db.query(`DROP SCHEMA IF EXISTS tenant_${SLUG} CASCADE`);
  await db.query('DELETE FROM platform.tenants WHERE slug = $1', [SLUG]);
  await db.pool.end();
});

test('an 8K image gets AVIF + WebP variants from 640 up to 7680 px, never upscaled', async () => {
  const f = path.join(DIR, 'eight-k.jpg');
  await make(f, 7680, 4320);
  const r = await images.makeVariants(f);
  assert.equal(r.width, 7680);
  assert.deepEqual(images.info(f).widths, [640, 1280, 1920, 3840, 7680]);
  for (const w of [640, 7680]) for (const fmt of ['avif', 'webp']) assert.ok(fs.existsSync(f.replace('.jpg', `.w${w}.${fmt}`)), `${w}.${fmt}`);
  const m = await sharp(f.replace('.jpg', '.w3840.webp')).metadata();
  assert.equal(m.width, 3840);
  assert.equal(m.height, 2160);

  const small = path.join(DIR, 'small.jpg');
  await make(small, 1000, 600);
  await images.makeVariants(small);
  assert.deepEqual(images.info(small).widths, [640, 1000], 'no upscaling past the original');
});

test('public pages emit srcset/sizes and an AVIF <source> for hero slides', async () => {
  await db.withSchema(`tenant_${SLUG}`, () => db.insert('sliders', { title: 'Hero', image: 'sliders/eight-k.jpg', is_active: 1, display_order: 0 }));
  const home = await request(app).get('/').set('Host', HOST);
  assert.equal(home.status, 200);
  assert.match(home.text, /<source type="image\/avif" srcset="[^"]*eight-k\.w7680\.avif 7680w/);
  assert.match(home.text, /srcset="[^"]*eight-k\.w640\.webp 640w, [^"]*eight-k\.w7680\.webp 7680w" sizes="100vw"/);
  const v = await request(app).get(`/uploads/sliders/eight-k.w1920.webp`).set('Host', HOST);
  assert.equal(v.status, 200);
  assert.match(v.headers['content-type'], /image\/webp/);
});

test('private files never get variants or srcset; unknown files get no srcset', () => {
  const fakeReq = { tenant: { slug: SLUG } };
  assert.equal(uploads.srcsetAttr(fakeReq, '_private/kyc/x.jpg'), '');
  assert.equal(uploads.srcsetAttr(fakeReq, 'sliders/missing.jpg'), '');
  assert.equal(uploads.srcsetAttr(fakeReq, 'sliders/../../etc/passwd.jpg'), '');
  assert.equal(uploads.srcsetAttr(fakeReq, 'https://cdn.example/x.jpg'), '');
});

test('removing an image removes its variants and sidecar', async () => {
  const f = path.join(DIR, 'small.jpg');
  uploads.remove({ tenant: { slug: SLUG } }, 'sliders/small.jpg');
  await new Promise(r => setTimeout(r, 100));
  assert.equal(fs.existsSync(f.replace('.jpg', '.w640.webp')), false);
  assert.equal(fs.existsSync(f.replace('.jpg', '.meta.json')), false);
});

test('decompression bombs are refused', async () => {
  const f = path.join(DIR, 'bomb.png');
  await sharp({ create: { width: 20000, height: 20000, channels: 3, background: '#fff' }, limitInputPixels: false }).png({ compressionLevel: 9 }).toFile(f);
  await assert.rejects(() => images.makeVariants(f));
});
