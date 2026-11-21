'use strict';
/**
 * Google Maps link → embeddable URL (port of includes/google-map-embed.php normalizeGoogleMapEmbedUrl).
 * Rendering never fetches anything. Short links (maps.app.goo.gl) are resolved once, when the admin saves
 * the setting (resolveShortLink below: Google hosts only).
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

// ---------------------------------------------------------------- short links (maps.app.goo.gl / goo.gl/maps)
// Resolved server-side when an admin saves a setting: only Google hosts are ever contacted (SSRF safe),
// redirects are followed by hand (redirect: 'manual') at most MAX_HOPS times, each with a short timeout,
// and no response body is read.
const SHORT_RE = /^https?:\/\/(maps\.app\.goo\.gl\/[A-Za-z0-9_-]+|goo\.gl\/maps\/[A-Za-z0-9_-]+)\/?(\?[^\s"'<>]*)?$/i;
const MAX_HOPS = 3;
const isShortLink = raw => SHORT_RE.test(String(raw || '').trim());

/** Hosts a hop may go to: the two short-link hosts, *.google.com, google.<cc> and maps.google.<cc>. */
function allowedHost(host) {
  const h = String(host || '').toLowerCase();
  if (h === 'maps.app.goo.gl' || h === 'goo.gl') return true;
  if (h === 'google.com' || h.endsWith('.google.com')) return true;
  return /^(www\.|maps\.)?google\.(com?\.)?[a-z]{2,3}$/.test(h);
}
function safeUrl(raw, base) {
  let u;
  try { u = new URL(raw, base); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !allowedHost(u.hostname)) return null;
  return u;
}

/** Coordinates in a resolved Maps URL (!3d…!4d… pin, @lat,lng, or q=lat,lng). */
function latLng(href) {
  const s = String(href || '');
  let m = /!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(s) || /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(s);
  if (!m) { try { const q = new URL(s).searchParams.get('q') || new URL(s).searchParams.get('ll') || ''; m = /^(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(q.trim()); } catch { m = null; } }
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: String(lat), lng: String(lng) } : null;
}

/**
 * Follow a Google Maps short link to the full maps URL.
 * Returns { url, embed, lat, lng } or null (not a short link, non-Google hop, too many hops, timeout, network error).
 */
async function resolveShortLink(raw, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const start = String(raw || '').trim();
  if (!isShortLink(start)) return null;
  let u = safeUrl(start);
  if (!u) return null;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    // consent / sorry interstitials carry the real destination in ?continue= — use it without fetching
    if (/^(consent|accounts)\.google\.com$/i.test(u.hostname) && u.searchParams.get('continue')) {
      const next = safeUrl(u.searchParams.get('continue'));
      if (!next) return null;
      u = next;
    }
    if (!/goo\.gl$/i.test(u.hostname)) {
      const href = u.toString();
      const ll = latLng(href);
      const embed = toEmbed(href) || (ll ? coords(ll.lat, ll.lng) : '');
      if (embed || ll) return { url: href, embed, lat: ll ? ll.lat : '', lng: ll ? ll.lng : '' };
    }
    if (hop === MAX_HOPS) return null;
    let res;
    try {
      res = await fetchImpl(u.toString(), { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; coop-site map link check)', Accept: 'text/html' } });
    } catch { return null; }
    try { res.body?.cancel?.(); } catch { /* body never read */ }
    const loc = res.status >= 300 && res.status < 400 && res.headers && res.headers.get('location');
    if (!loc) return null;
    const next = safeUrl(loc, u);
    if (!next) return null;
    u = next;
  }
  return null;
}

module.exports = { toEmbed, fromSettings, openLink, coords, EMBED_OK, isShortLink, allowedHost, resolveShortLink, latLng };
