'use strict';
/**
 * Tenant-isolated uploads: files live in uploads/<tenant-slug>/<folder>/<random>.<ext>
 * and are stored in the DB as "<folder>/<file>". Legacy PHP paths such as
 * "assets/uploads/news/x.jpg" are understood too (the importer copies the old
 * assets/uploads tree into uploads/<tenant-slug>/).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { verifyCsrf } = require('./security');
const images = require('./images');

const IMAGE = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
const DOCS = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'];
const MIME_OK = /^(image\/(jpeg|png|webp|gif)|application\/(pdf|msword|vnd\.openxmlformats-officedocument\..+|vnd\.ms-excel|vnd\.ms-powerpoint|octet-stream)|text\/(plain|csv))$/;
const FOLDER_RE = /^[a-z0-9_-]{1,40}$/;

function tenantDir(req) {
  return path.join(config.uploadDir, req.tenant.slug);
}

/** Magic-byte check so a renamed .php/.html cannot pass as an image or PDF. */
function contentLooksRight(file, ext) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(8);
  fs.readSync(fd, buf, 0, 8, 0);
  fs.closeSync(fd);
  const hex = buf.toString('hex');
  if (ext === '.jpg' || ext === '.jpeg') return hex.startsWith('ffd8ff');
  if (ext === '.png') return hex.startsWith('89504e47');
  if (ext === '.gif') return hex.startsWith('47494638');
  if (ext === '.webp') return hex.startsWith('52494646');
  if (ext === '.pdf') return hex.startsWith('25504446');
  if (['.docx', '.xlsx', '.pptx'].includes(ext)) return hex.startsWith('504b0304');
  if (['.doc', '.xls', '.ppt'].includes(ext)) return hex.startsWith('d0cf11e0');
  return !/<\?php|<script|<html/i.test(buf.toString('utf8'));
}

/**
 * Build an upload middleware chain for named fields.
 *   upload('news', [{ name: 'image', kind: 'image' }])
 * After it runs, req.uploaded[field] = "news/<file>" for each accepted file.
 */
function upload(folder, fields, { maxMb, private: isPrivate = false } = {}) {
  // documents keep the normal limit; image fields may be up to MAX_IMAGE_MB so full 8K UHD photos are accepted
  const docMb = maxMb || config.maxUploadMb;
  const imgMb = maxMb || Math.max(config.maxImageMb, config.maxUploadMb);
  const hasImage = fields.some(f => (f.kind || 'any') !== 'doc');
  maxMb = hasImage ? Math.max(docMb, imgMb) : docMb;
  // private files live under uploads/<tenant>/_private/ and are never served by the public /uploads route
  const base = isPrivate ? '_private/' + folder : folder;
  if (!FOLDER_RE.test(folder)) throw new Error('bad upload folder');
  const kinds = Object.fromEntries(fields.map(f => [f.name, f.kind || 'any']));
  const storage = multer.diskStorage({
    destination(req, file, cb) {
      const dir = path.join(tenantDir(req), base);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(req, file, cb) {
      cb(null, crypto.randomBytes(16).toString('hex') + path.extname(file.originalname).toLowerCase());
    },
  });
  const mw = multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024, files: fields.reduce((a, f) => a + (f.maxCount || 1), 0) },
    fileFilter(req, file, cb) {
      const ext = path.extname(file.originalname).toLowerCase();
      const kind = kinds[file.fieldname];
      const allowed = kind === 'image' ? IMAGE : kind === 'doc' ? DOCS : [...IMAGE, ...DOCS];
      if (!allowed.includes(ext) || !MIME_OK.test(file.mimetype)) return cb(new Error(`अनुमति नभएको फाइल प्रकार (${ext || 'unknown'})`));
      cb(null, true);
    },
  }).fields(fields.map(f => ({ name: f.name, maxCount: f.maxCount || 1 })));

  return [
    (req, res, next) => mw(req, res, err => {
      if (err) {
        req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? `फाइल ${maxMb}MB भन्दा ठूलो भयो` : err.message;
        req.body = req.body || {};
      }
      req.uploaded = {};
      for (const [field, files] of Object.entries(req.files || {})) {
        const ok = [];
        for (const f of files) {
          const ext = path.extname(f.filename);
          if (!contentLooksRight(f.path, ext)) { fs.rmSync(f.path, { force: true }); req.uploadError = 'फाइलको सामग्री मिलेन'; continue; }
          const isImg = IMAGE.includes(ext.toLowerCase());
          if (f.size > (isImg ? imgMb : docMb) * 1024 * 1024) { fs.rmSync(f.path, { force: true }); req.uploadError = `फाइल ${isImg ? imgMb : docMb}MB भन्दा ठूलो भयो`; continue; }
          if (isImg && !isPrivate) images.enqueue(f.path); // responsive AVIF/WebP variants up to 8K, in the background
          ok.push(`${base}/${f.filename}`);
        }
        req.uploaded[field] = (fields.find(x => x.name === field)?.maxCount || 1) > 1 ? ok : ok[0];
      }
      next();
    }),
    verifyCsrf,
  ];
}

/** Public URL for a stored path (handles legacy PHP paths and absolute URLs). */
function mediaUrl(stored) {
  if (!stored) return '';
  const s = String(stored).trim().replace(/\\/g, '/');
  if (/^https?:\/\//i.test(s)) return s;
  if (/^starter:[a-z]+$/.test(s)) return '/starter-art/' + s.slice(8) + '.svg';
  const rel = s.replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
  if (rel.includes('..')) return '';
  if (rel.startsWith('_private/')) return '/admin/files/' + rel.split('/').map(encodeURIComponent).join('/'); // staff-only route
  return '/uploads/' + rel.split('/').map(encodeURIComponent).join('/');
}

/** Delete a stored file for the current tenant (best effort). */
function remove(req, stored) {
  if (!stored || /^https?:/i.test(stored)) return;
  const rel = String(stored).replace(/^\/+/, '').replace(/^assets\/uploads\//, '');
  if (rel.includes('..')) return;
  images.removeVariants(path.join(tenantDir(req), rel));
  fs.rm(path.join(tenantDir(req), rel), { force: true }, () => {});
}

/** Resolve a stored path to an absolute file inside this tenant's folder (null if it escapes). */
function resolveStored(req, stored) {
  const base = path.resolve(tenantDir(req));
  const rel = String(stored || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
  const file = path.resolve(base, rel);
  return file.startsWith(base + path.sep) ? file : null;
}

/** Send a stored file with safe headers (images inline, everything else as a download). */
function sendStored(req, res, next, stored) {
  const file = resolveStored(req, stored);
  if (!file || !fs.existsSync(file)) return next();
  const inline = /\.(jpe?g|png|webp|gif|pdf)$/i.test(file);
  res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; plugin-types application/pdf" });
  // serve relative to the tenant folder so the dotfile check applies to the stored path only, not to an install
  // directory that happens to contain a dot segment (e.g. /home/x/.apps/site)
  const opts = { root: path.resolve(tenantDir(req)) };
  const rel = path.relative(opts.root, file);
  if (!inline) return res.download(rel, path.basename(file), opts);
  res.sendFile(rel, opts);
}

/**
 * srcset/sizes attributes for a public stored image (empty until its variants exist).
 * Usage in views:  <img src="<%= mediaUrl(x) %>"<%- srcset(x, '100vw') %>>
 */
function srcsetAttr(req, stored, sizes = '100vw') {
  if (!stored || /^https?:/i.test(stored)) return '';
  const rel = String(stored).replace(/\\/g, '/').replace(/^\/+/, '').replace(/^assets\/uploads\//, '').replace(/^uploads\//, '');
  if (rel.includes('..') || rel.startsWith('_private/') || !images.RASTER.test(rel)) return '';
  const set = images.srcsetFor(path.join(tenantDir(req), rel), mediaUrl(stored));
  const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return set ? ` srcset="${esc(set)}" sizes="${esc(sizes)}"` : '';
}

module.exports = { upload, mediaUrl, remove, tenantDir, resolveStored, sendStored, srcsetAttr };
