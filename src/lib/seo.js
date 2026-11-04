'use strict';
/**
 * SEO helpers ported from includes/config.php: document title, meta description, canonical + hreflang,
 * JSON-LD (Organization / WebSite / BreadcrumbList / FAQPage / NewsArticle) and the share (OG) card.
 */
const fs = require('fs');
const path = require('path');
const util = require('./util');
const { mediaUrl, resolveStored } = require('./uploads');

const KEEP_PARAMS = ['id', 'slug', 'menu', 'item', 'type', 'category', 'album', 'tab', 'page', 'cat', 'cmt', 'tenure'];
const len = s => [...String(s)].length;

function baseUrl(req) { return `${req.protocol}://${req.get('host')}`; }
function absolute(req, url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return baseUrl(req) + (url.startsWith('/') ? url : '/' + url);
}

/** Canonical URL: path without trailing slash + SEO-significant query params only (no lang / tracking noise). */
function canonical(req) {
  let p = (req.path || '/').replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  const keep = [];
  for (const k of KEEP_PARAMS) {
    const raw = req.query[k];
    if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) continue;
    const v = raw.trim();
    if (['id', 'page', 'cmt', 'tenure'].includes(k)) { if (!/^\d+$/.test(v) || Number(v) <= 0 || (k === 'page' && Number(v) === 1)) continue; keep.push([k, String(Number(v))]); continue; }
    if (!/^[\p{L}\p{N}\p{M}\-_. ]+$/u.test(v)) continue;
    keep.push([k, v]);
  }
  keep.sort((a, b) => a[0].localeCompare(b[0]));
  const qs = keep.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  return baseUrl(req) + p + (qs ? '?' + qs : '');
}

/** hreflang alternates: ne / en via ?lang=, x-default = canonical. */
function alternates(canon) {
  const withLang = l => canon + (canon.includes('?') ? '&' : '?') + 'lang=' + l;
  return [['ne', withLang('np')], ['en', withLang('en')], ['x-default', canon]];
}

const isHome = title => !title || /^(गृहपृष्ठ|home)$/i.test(String(title).trim());

/** <title>: custom SEO title / brand + tagline on the home page, "Page - Brand" elsewhere (≤70 chars). */
function documentTitle(s, pageTitle, en) {
  const nameNp = (s.site_name || '').trim(), nameEn = (s.site_name_en || '').trim();
  const brand = en && nameEn ? nameEn : nameNp || nameEn;
  if (isHome(pageTitle)) {
    const custom = (en ? s.seo_title_en || s.seo_title : s.seo_title || s.seo_title_en || '').trim();
    if (custom) return custom;
    let tagline = (en ? s.seo_tagline_en || s.seo_tagline : s.seo_tagline || s.seo_tagline_en || '').trim();
    if (!tagline) {
      const city = (en ? s.site_city_en || s.site_city : s.site_city || s.site_city_en || '').trim();
      tagline = en ? 'Savings & Credit Cooperative' + (city ? ', ' + city : '') : 'बचत तथा ऋण सहकारी' + (city ? ' | ' + city : ' संस्था');
    }
    let home = brand;
    if (nameEn && nameNp && nameEn.toLowerCase() !== nameNp.toLowerCase() && len(nameEn) <= 40) home = nameEn + ' | ' + nameNp;
    return len(home + ' | ' + tagline) <= 70 ? home + ' | ' + tagline : home;
  }
  const full = pageTitle + ' - ' + brand;
  return len(full) > 70 ? pageTitle + ' | ' + brand : full;
}

/** Meta description ≤158 chars: page → settings → slogan/about → keyword-rich fallback. */
function description(s, pageDesc, en) {
  const name = (en ? s.site_name_en || s.site_name : s.site_name) || '';
  const addr = (en ? s.address_en || s.address : s.address) || '';
  const fallback = en ? `${name} — savings, loans and member services${addr ? '. ' + addr : ''}.` : `${name} — बचत, ऋण र सदस्य केन्द्रित वित्तीय सेवा${addr ? '। ' + addr : ''}।`;
  for (const c of [pageDesc, en ? s.meta_description_en : s.meta_description, en ? s.meta_description : s.meta_description_en, en ? s.site_slogan_en : s.site_slogan, s.about_short, fallback]) {
    const txt = util.stripTags(c || '');
    if (txt) return [...txt].length > 158 ? [...txt].slice(0, 157).join('') + '…' : txt;
  }
  return name;
}

/**
 * Share image: page image → admin seo_og_image (1200×630) → logo (raster; Facebook/WhatsApp ignore SVG)
 * → generated SVG card (/share-og.svg) when there is no logo at all.
 */
function shareImage(req, s, pageImage) {
  if (pageImage) return absolute(req, mediaUrl(pageImage) || pageImage);
  if (s.seo_og_image) return absolute(req, mediaUrl(s.seo_og_image));
  if (s.logo && /\.(png|jpe?g|webp|gif)$/i.test(s.logo)) return absolute(req, mediaUrl(s.logo));
  return absolute(req, '/share-og.svg');
}

const clock = raw => {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return '';
  let h = Number(m[1]); const min = Number(m[2]); const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  return h > 23 || min > 59 ? '' : `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
};

function organization(req, s, en) {
  const base = baseUrl(req) + '/';
  const nameNp = (s.site_name || '').trim(), nameEn = (s.site_name_en || '').trim();
  const brand = en && nameEn ? nameEn : nameNp || nameEn;
  const logo = s.logo ? absolute(req, mediaUrl(s.logo)) : undefined;
  const org = { '@context': 'https://schema.org', '@type': ['CreditUnion', 'FinancialService', 'Organization'], '@id': base + '#organization', name: brand, url: base, logo, image: logo, description: description(s, null, en) };
  const alts = [...new Set([nameNp, nameEn, s.pwa_short_name].map(x => (x || '').trim()).filter(x => x && x !== brand))];
  if (alts.length) org.alternateName = alts.length === 1 ? alts[0] : alts;
  if (s.phone || s.mobile) org.telephone = s.phone || s.mobile;
  if (s.email) org.email = s.email;
  const addr = (en ? s.address_en || s.address : s.address) || '', city = (en ? s.site_city_en || s.site_city : s.site_city) || '';
  if (addr || city) {
    org.address = { '@type': 'PostalAddress', addressCountry: 'NP', ...(addr ? { streetAddress: addr } : {}), ...(city ? { addressLocality: city } : {}) };
    org.areaServed = city ? { '@type': 'City', name: city } : { '@type': 'Country', name: 'Nepal' };
  }
  if (/^https?:\/\//i.test(s.google_map_url || '')) org.hasMap = s.google_map_url;
  const opens = clock(s.office_time_start), closes = clock(s.office_time_end);
  if (opens && closes) org.openingHoursSpecification = [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map(d => 'https://schema.org/' + d), opens, closes }];
  if (s.established_year) org.foundingDate = String(s.established_year);
  const sameAs = ['facebook_url', 'youtube_url', 'twitter_url', 'instagram_url'].map(k => s[k]).filter(u => /^https?:\/\//i.test(u || ''));
  if (sameAs.length) org.sameAs = [...new Set(sameAs)];
  return org;
}

function website(req, s, en) {
  const base = baseUrl(req) + '/';
  const brand = (en && s.site_name_en) || s.site_name || s.site_name_en || '';
  return { '@context': 'https://schema.org', '@type': 'WebSite', name: brand, url: base, inLanguage: en ? ['en', 'ne'] : ['ne', 'en'], publisher: { '@type': 'Organization', name: brand, url: base } };
}

/** items: [[name, url?], …] — the last one may omit the url. */
function breadcrumb(req, items) {
  const list = items.filter(([name]) => name).map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, ...(url ? { item: absolute(req, url) } : {}) }));
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list };
}

function faqPage(faqs, en) {
  const entities = [];
  for (const f of faqs) {
    const q = String((en ? f.question || f.question_en || f.question_np : f.question_np || f.question) || '').trim();
    const a = util.stripTags((en ? f.answer || f.answer_en || f.answer_np : f.answer_np || f.answer) || '');
    if (!q || !a) continue;
    entities.push({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: [...a].length > 500 ? [...a].slice(0, 499).join('') + '…' : a } });
    if (entities.length >= 40) break;
  }
  return entities.length ? { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: entities } : null;
}

function newsArticle(req, s, { headline, desc, url, date, image }, en) {
  const base = baseUrl(req) + '/';
  const brand = (en && s.site_name_en) || s.site_name || '';
  const data = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: String(headline || '').slice(0, 110), description: desc || '',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url }, url,
    author: { '@type': 'Organization', name: brand, url: base },
    publisher: { '@type': 'Organization', name: brand, url: base, ...(s.logo ? { logo: { '@type': 'ImageObject', url: absolute(req, mediaUrl(s.logo)) } } : {}) },
    inLanguage: en ? 'en' : 'ne',
  };
  const d = date ? new Date(date instanceof Date ? date : String(date)) : null;
  if (d && !Number.isNaN(d.getTime())) data.datePublished = data.dateModified = d.toISOString();
  if (image) data.image = [absolute(req, mediaUrl(image) || image)];
  return data;
}

/** JSON for a <script type="application/ld+json"> block (cannot break out of the element). */
const ldJson = obj => JSON.stringify(obj).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Darken light brand colours so the card frame stays visible (share-og.php). */
function cardColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return '#1a5f2a';
  let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  if ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55) [r, g, b] = [r, g, b].map(v => Math.round(v * 0.35));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** 1200×630 SVG share card: brand frame, white panel, embedded logo (data URI) or the site name. */
function shareCardSvg(req, s, siteName, brandColor) {
  const color = cardColor(brandColor);
  let logo = '';
  const file = s.logo ? resolveStored(req, s.logo) : null;
  if (file && fs.existsSync(file) && fs.statSync(file).size < 2_000_000) {
    const ext = path.extname(file).toLowerCase();
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
    if (mime) logo = `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
  }
  const esc = util.escapeHtml;
  const tagline = s.site_tagline || s.seo_tagline || '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${color}"/>
<rect x="64" y="64" width="1072" height="502" rx="24" fill="#ffffff"/>
${logo ? `<image href="${logo}" x="140" y="110" width="920" height="300" preserveAspectRatio="xMidYMid meet"/>` : ''}
<text x="600" y="${logo ? 470 : 330}" text-anchor="middle" font-family="'Noto Sans Devanagari','Mukta',Inter,Arial,sans-serif" font-size="${logo ? 44 : 64}" font-weight="600" fill="#1f2937">${esc(siteName).slice(0, 80)}</text>
${tagline ? `<text x="600" y="${logo ? 522 : 400}" text-anchor="middle" font-family="'Noto Sans Devanagari','Mukta',Inter,Arial,sans-serif" font-size="28" fill="#6b7280">${esc(tagline).slice(0, 120)}</text>` : ''}
</svg>`;
}

/** Public-router middleware: canonical / hreflang / JSON-LD collector for the layout head. */
function middleware(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const canon = canonical(req);
  res.locals.seo = { canonical: canon, alternates: alternates(canon), base: baseUrl(req) };
  res.locals.jsonLd = [];
  res.locals.seoHead = locals => head(req, { ...res.locals, ...(locals || {}) }); // view locals carry title / description / ogImage
  next();
}

/** Build everything the <head> needs (called from the layout partial). */
function head(req, locals) {
  const s = locals.settings || {}, en = locals.lang === 'en';
  const title = documentTitle(s, locals.title, en);
  const desc = description(s, locals.description, en);
  const blocks = [...(locals.jsonLd || [])];
  if (req.path === '/') blocks.unshift(organization(req, s, en), website(req, s, en));
  else if (locals.title && !blocks.some(b => b['@type'] === 'BreadcrumbList')) {
    blocks.push(breadcrumb(req, [[en ? 'Home' : 'गृहपृष्ठ', '/'], ...(locals.breadcrumbs || []), [locals.title, locals.seo ? locals.seo.canonical : undefined]]));
  }
  return { title, description: desc, image: shareImage(req, s, locals.ogImage), keywords: s.meta_keywords || '', verification: s.google_site_verification || '', blocks: blocks.map(ldJson), type: locals.ogType || (req.path === '/' ? 'website' : 'article') };
}

module.exports = { canonical, alternates, documentTitle, description, shareImage, organization, website, breadcrumb, faqPage, newsArticle, ldJson, cardColor, shareCardSvg, middleware, head, absolute };
