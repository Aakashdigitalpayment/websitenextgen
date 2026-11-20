'use strict';
/**
 * Google Maps link → embeddable URL (port of includes/google-map-embed.php normalizeGoogleMapEmbedUrl).
 * Never fetches anything: short links (maps.app.goo.gl) cannot be embedded and fall back to an "open in Maps" button.
 */
// the CSP frame-src allows www.google.com and maps.google.com only
const EMBED_OK = /^https:\/\/(www|maps)\.google\.com\/maps(\/embed|\?|\/?$)/i;

function coords(lat, lng) {
  const a = Number(String(lat ?? '').trim()), b = Number(String(lng ?? '').trim());
  if (!String(lat ?? '').trim() || !String(lng ?? '').trim() || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) return '';
  return `https://www.google.com/maps?q=${a},${b}&z=17&output=embed`;
}

function toEmbed(raw) {
  let v = String(raw || '').trim();
  if (!v) return '';
  const iframe = /<iframe[^>]+src=["']([^"']+)["']/i.exec(v);
  if (iframe) v = iframe[1];
  v = v.replace(/&amp;/g, '&');
  let u;
  try { u = new URL(v); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  u.protocol = 'https:';
  if (!/(^|\.)google\.[a-z.]{2,12}$/i.test(u.hostname)) return '';
  if (!/^\/maps/.test(u.pathname) && !(u.hostname.startsWith('maps.') && u.pathname === '/')) return '';
  if (u.hostname.startsWith('maps.') && u.pathname === '/') u.pathname = '/maps';
  u.hostname = 'www.google.com'; // google.com.np etc. serve the same map
  const href = u.toString();
  if (/\/maps\/embed/.test(u.pathname) || u.searchParams.get('output') === 'embed') return EMBED_OK.test(href) ? href : '';
  const pin = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
  if (pin) return coords(pin[1], pin[2]);
  const at = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/.exec(u.pathname);
  if (at) return `https://www.google.com/maps?q=${at[1]},${at[2]}&z=${Math.round(Number(at[3]) || 17)}&output=embed`;
  const q = u.searchParams.get('q') || u.searchParams.get('query');
  if (q) return 'https://www.google.com/maps?q=' + encodeURIComponent(q) + '&output=embed';
  const place = /\/maps\/place\/([^/]+)/.exec(u.pathname);
  if (place) return 'https://www.google.com/maps?q=' + encodeURIComponent(decodeURIComponent(place[1]).replace(/\+/g, ' ')) + '&output=embed';
  u.searchParams.set('output', 'embed');
  const out = u.toString();
  return EMBED_OK.test(out) ? out : '';
}

/** The contact-page embed: map_embed_url, else google_map_url (any share link), else map_lat / map_lng. */
function fromSettings(s) {
  for (const cand of [s.map_embed_url, s.google_map_url]) {
    const e = toEmbed(cand);
    if (e) return e;
  }
  return coords(s.map_lat, s.map_lng);
}

/** A link for the "Open in Google Maps" button (https only). */
function openLink(s) {
  for (const cand of [s.google_map_url, s.map_embed_url]) {
    const v = String(cand || '').trim();
    if (/^https:\/\/[^\s"'<>]+$/i.test(v)) return v.replace(/[?&]output=embed/, '');
  }
  const c = coords(s.map_lat, s.map_lng);
  return c ? c.replace('&output=embed', '') : '';
}

module.exports = { toEmbed, fromSettings, openLink, coords, EMBED_OK };
