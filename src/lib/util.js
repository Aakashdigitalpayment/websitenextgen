'use strict';
const crypto = require('crypto');
const nd = require('./nepali-date');

/** Short, unambiguous tracking id: LN-830718-7KQ2M (prefix-BSyymmdd-random) */
function trackingId(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rnd = Array.from(crypto.randomBytes(8), b => alphabet[b % alphabet.length]).join(''); // 32^8 ≈ 1.1e12 per day
  const bs = (nd.todayBs() || '').replace(/-/g, '').slice(2);
  return `${prefix}-${bs}-${rnd}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Strip tags for excerpts. */
function stripTags(s) {
  // linear-time: let the sanitizer drop every tag instead of a backtracking regex
  return sanitizeLib(String(s ?? '').slice(0, 200_000), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;|&amp;nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function excerpt(s, n = 160) {
  const t = stripTags(s);
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

/**
 * HTML sanitizer for admin-authored rich text — parser based (sanitize-html), allow-list only.
 * No scripts, event handlers, styles, iframes or non-http(s) URLs survive.
 */
const sanitizeLib = require('sanitize-html');
const SANITIZE_OPTS = {
  allowedTags: ['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'hr'],
  allowedAttributes: { a: ['href', 'title'], img: ['src', 'alt', 'title'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: { a: sanitizeLib.simpleTransform('a', { rel: 'noopener noreferrer' }) },
};
SANITIZE_OPTS.allowedAttributes.a.push('rel');
function sanitizeHtml(html) {
  return sanitizeLib(String(html ?? '').slice(0, 200_000), SANITIZE_OPTS);
}

/** Plain text with line breaks → safe HTML paragraphs. If it already looks like HTML, sanitize it. */
function richText(s) {
  const str = String(s ?? '');
  if (/<\/?(p|br|ul|ol|h[2-4]|div|strong|table)\b/i.test(str)) return sanitizeHtml(str);
  return str.split(/\n{2,}/).map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('');
}

function money(n, lang = 'np') {
  if (n === null || n === undefined || n === '') return '';
  const num = Number(n);
  if (Number.isNaN(num)) return String(n);
  // Nepali (Indian) grouping: 12,34,567.00
  const [int, dec] = Math.abs(num).toFixed(2).split('.');
  const last3 = int.slice(-3), rest = int.slice(0, -3);
  const grouped = (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' : '') + last3;
  const out = (num < 0 ? '-' : '') + grouped + (dec !== '00' ? '.' + dec : '');
  return lang === 'np' ? nd.toNepaliDigits(out) : out;
}

function int(v, def = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : def; }

function slugify(s) {
  return String(s || '').toLowerCase().trim().replace(/[^a-z0-9ऀ-ॿ]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

/** Basic validators */
// length-capped and without overlapping quantifiers (no ReDoS)
const isEmail = s => { const v = String(s || ''); return v.length <= 254 && /^[^\s@]{1,64}@[^\s@.]{1,63}(\.[^\s@.]{1,63})+$/.test(v); };
/**
 * CSV cell: neutralise spreadsheet formulas FIRST (=, +, -, @, tab, CR, |, also after leading spaces),
 * then quote. Used by every CSV export.
 */
function csvCell(v) {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
  if (/^[\s]*[=+\-@\t\r|]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (cols, rows) => '\ufeff' + [cols.map(csvCell).join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n');

const isPhone = s => String(s || '').length <= 30 && /^(\+?977[-\s]?)?(9[678]\d{8}|0?\d{1,2}[-\s]?\d{6,7})$/.test(nd.toLatinDigits(String(s || '')).replace(/\s+/g, ''));

function paginate(total, page, perPage = 20) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { total, page: p, pages, perPage, offset: (p - 1) * perPage };
}

module.exports = { csvCell, toCsv, trackingId, escapeHtml, stripTags, excerpt, sanitizeHtml, richText, money, int, slugify, isEmail, isPhone, paginate };
