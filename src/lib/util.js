'use strict';
const crypto = require('crypto');
const nd = require('./nepali-date');

/** Short, unambiguous tracking id: LN-830718-7KQ2M (prefix-BSyymmdd-random) */
function trackingId(prefix) {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const rnd = Array.from(crypto.randomBytes(5), b => alphabet[b % alphabet.length]).join('');
  const bs = (nd.todayBs() || '').replace(/-/g, '').slice(2);
  return `${prefix}-${bs}-${rnd}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Strip tags for excerpts. */
function stripTags(s) { return String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim(); }

function excerpt(s, n = 160) {
  const t = stripTags(s);
  return t.length > n ? t.slice(0, n).replace(/\s+\S*$/, '') + '…' : t;
}

/**
 * Very small HTML sanitizer for admin-authored rich text: keeps common
 * formatting tags, drops scripts/handlers/javascript: URLs.
 */
const ALLOWED = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div', 'hr']);
function sanitizeHtml(html) {
  let s = String(html ?? '');
  s = s.replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select)[\s\S]*?(<\/\1>|$)/gi, '');
  s = s.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (m, tag, attrs) => {
    tag = tag.toLowerCase();
    if (!ALLOWED.has(tag)) return '';
    if (m.startsWith('</')) return `</${tag}>`;
    const keep = [];
    for (const a of attrs.matchAll(/([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
      const name = a[1].toLowerCase();
      const val = a[3] ?? a[4] ?? '';
      if (!['href', 'src', 'alt', 'title', 'colspan', 'rowspan'].includes(name)) continue;
      if ((name === 'href' || name === 'src') && !/^(https?:|\/|#|mailto:|tel:)/i.test(val.trim())) continue;
      keep.push(`${name}="${escapeHtml(val)}"`);
    }
    if (tag === 'a') keep.push('rel="noopener"');
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''}>`;
  });
  return s;
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
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s || ''));
const isPhone = s => /^(\+?977[-\s]?)?(9[678]\d{8}|0?\d{1,2}[-\s]?\d{6,7})$/.test(nd.toLatinDigits(String(s || '')).replace(/\s+/g, ''));

function paginate(total, page, perPage = 20) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { total, page: p, pages, perPage, offset: (p - 1) * perPage };
}

module.exports = { trackingId, escapeHtml, stripTags, excerpt, sanitizeHtml, richText, money, int, slugify, isEmail, isPhone, paginate };
