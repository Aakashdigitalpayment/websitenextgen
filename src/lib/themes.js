'use strict';
/**
 * Themes = colour palette + mode (light / dark / system).
 *
 * The cooperative (admin / superadmin) chooses the DEFAULT theme and whether users may change it.
 * When allowed, every visitor, member and admin can pick their own; the choice is kept in a cookie
 * (everyone) and on the account (members/admins, so it follows them to other devices).
 * "Reset everyone" bumps theme_epoch, which invalidates every saved choice at once.
 */
const PALETTES = [
  { key: 'brand', np: 'संस्थाको रङ', en: 'Organisation colour', brand: null },
  { key: 'teal', np: 'हरियो-नीलो', en: 'Teal', brand: '#0f766e' },
  { key: 'ocean', np: 'समुद्री नीलो', en: 'Ocean', brand: '#0369a1' },
  { key: 'indigo', np: 'इन्डिगो', en: 'Indigo', brand: '#4f46e5' },
  { key: 'violet', np: 'बैजनी', en: 'Violet', brand: '#7c3aed' },
  { key: 'rose', np: 'गुलाफी', en: 'Rose', brand: '#be123c' },
  { key: 'crimson', np: 'रातो', en: 'Crimson', brand: '#b91c1c' },
  { key: 'amber', np: 'सुनौलो', en: 'Amber', brand: '#b45309' },
  { key: 'forest', np: 'वन हरियो', en: 'Forest', brand: '#15803d' },
  { key: 'slate', np: 'खरानी', en: 'Graphite', brand: '#334155' },
];
const MODES = [
  { key: 'system', np: 'उपकरण अनुसार', en: 'System', icon: 'settings' },
  { key: 'light', np: 'उज्यालो', en: 'Light', icon: 'sun' },
  { key: 'dark', np: 'अँध्यारो', en: 'Dark', icon: 'moon' },
];
const PALETTE_KEYS = new Set(PALETTES.map(p => p.key));
const MODE_KEYS = new Set(MODES.map(m => m.key));
const HEX = /^#[0-9a-f]{6}$|^#[0-9a-f]{3}$/i;

const isPalette = k => PALETTE_KEYS.has(k);
const isMode = k => MODE_KEYS.has(k);

/** Tenant theme policy from site_settings. */
function policy(s) {
  return {
    palette: isPalette(s.theme_default_palette) ? s.theme_default_palette : 'brand',
    mode: isMode(s.theme_default_mode) ? s.theme_default_mode : 'system',
    allowUser: s.theme_user_choice !== '0',
    epoch: String(Number(s.theme_epoch) || 0),
    orgColor: HEX.test(s.primary_color || '') ? s.primary_color : '#0f766e',
  };
}

/** "palette.mode.epoch" → { palette, mode } if valid for the current epoch. */
function parse(value, epoch) {
  const [palette, mode, ep] = String(value || '').split('.');
  if (!isPalette(palette) || !isMode(mode) || (ep || '0') !== epoch) return null;
  return { palette, mode };
}
const serialize = (palette, mode, epoch) => `${palette}.${mode}.${epoch}`;

function cookieValue(req) {
  return (req.get('cookie') || '').match(/(?:^|;\s*)theme=([a-z]+\.[a-z]+\.\d+)/)?.[1] || '';
}

/**
 * Effective theme for this request.
 * Order: account preference (on its own panel) → cookie → tenant default.
 */
function resolve(req, s) {
  const p = policy(s);
  let pick = null, source = 'default';
  if (p.allowUser) {
    const account = req.path.startsWith('/admin') ? req.admin : req.path.startsWith('/member') ? req.member : (req.member || req.admin);
    pick = parse(account && account.theme_pref, p.epoch);
    if (pick) source = 'account';
    else if ((pick = parse(cookieValue(req), p.epoch))) source = 'cookie';
  }
  const palette = pick ? pick.palette : p.palette;
  const mode = pick ? pick.mode : p.mode;
  const pal = PALETTES.find(x => x.key === palette);
  return {
    palette, mode, source, allowUser: p.allowUser, epoch: p.epoch,
    brand: pal.brand || p.orgColor,
    attr: mode === 'system' ? '' : mode,          // value for <html data-theme>
    defaults: { palette: p.palette, mode: p.mode },
  };
}

/** Swatch colours for the pickers (brand palette uses the organisation colour). */
const swatches = (orgColor, keep) => PALETTES
  .filter(p => !p.brand || p.key === keep || p.brand.toLowerCase() !== String(orgColor).toLowerCase())
  .map(p => ({ ...p, color: p.brand || orgColor }));

module.exports = { PALETTES, MODES, policy, parse, serialize, resolve, swatches, isPalette, isMode, cookieValue };
