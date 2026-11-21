'use strict';
/**
 * Icons: Lucide (https://lucide.dev) only, self-hosted from the `lucide-static` package and rendered
 * server-side as inline SVG. Usage in views: <%- icon('phone') %>, <%- icon('user', 'icon-lg') %>,
 * <%- icon('bell', { size: 20, title: 'Notifications' }) %>.
 *
 * Any name goes through resolve(): a Lucide name is used as is; the old custom names of this app,
 * PHP-era Font Awesome values ("fas fa-piggy-bank", "fa fa-users", "fa-solid fa-star") and a few
 * keyword patterns map through the one alias table below; anything unknown falls back to FALLBACK.
 */
const NODES = require('lucide-static/icon-nodes.json'); // { name: [[tag, attrs], …] } — loaded once, ~800 KB
const TAGS = require('lucide-static/tags.json'); // { name: [keyword, …] } — for the admin picker search
const FALLBACK = 'circle';

// ------------------------------------------------------------------ the one alias table (anything → Lucide)
// Old custom names: a bare value is checked here first, then as a Lucide name.
const LEGACY = {
  // custom names used by this app before Lucide (views, registries, help content, demo data, stored picker values)
  pin: 'map-pin', close: 'x', chevron: 'chevron-down', right: 'arrow-right', left: 'arrow-left', id: 'id-card',
  message: 'message-square', news: 'newspaper', chart: 'chart-column', home: 'house', logout: 'log-out', edit: 'pencil',
  qr: 'qr-code', whatsapp: 'message-circle', tenant: 'layout-grid', alert: 'triangle-alert',
  // status words (import/migration reports)
  ok: 'circle-check', warn: 'triangle-alert', skip: 'circle-minus', fail: 'circle-x', error: 'circle-x',

};
// Font Awesome names: a "fa-…" value is checked here first (FA "bolt" is lightning, Lucide "bolt" is a screw), then as a Lucide name.
const FA = {
  // Font Awesome 4/5/6 names (PHP admin icon pickers, install.sql seeds, theme templates) whose Lucide name differs
  'phone-alt': 'phone-outgoing', 'phone-volume': 'phone-call', mobile: 'smartphone', 'mobile-alt': 'smartphone', 'mobile-screen': 'smartphone',
  'mobile-screen-button': 'smartphone', tablet: 'tablet', desktop: 'monitor', laptop: 'laptop', 'laptop-code': 'laptop',
  envelope: 'mail', 'envelope-open': 'mail-open', 'envelope-open-text': 'mail-open', 'paper-plane': 'send', 'at': 'at-sign',
  'map-marker': 'map-pin', 'map-marker-alt': 'map-pin', 'location-dot': 'map-pin', 'map-pin': 'map-pin', 'map-signs': 'signpost',
  directions: 'navigation', route: 'route', compass: 'compass', 'drafting-compass': 'compass', navigation: 'navigation',
  'user-tie': 'user', 'user-circle': 'circle-user', 'user-plus': 'user-plus', 'user-check': 'user-check', 'user-shield': 'shield-user',
  'user-friends': 'users', 'users-cog': 'users', 'people-group': 'users', 'people-arrows': 'users', 'people-carry': 'users',
  'house-user': 'house', 'user-graduate': 'graduation-cap', 'chalkboard-teacher': 'presentation', 'chalkboard-user': 'presentation',
  child: 'baby', 'baby-carriage': 'baby', female: 'user', male: 'user', body: 'user', 'person-cane': 'accessibility',
  'accessible-icon': 'accessibility', 'low-vision': 'eye-off', 'hands-asl-interpreting': 'hand', 'sign-language': 'hand',
  'money-bill': 'indian-rupee', 'money-bill-wave': 'banknote', 'money-bill-transfer': 'arrow-left-right', 'money-check': 'file-check',
  'money-check-alt': 'receipt', cash: 'indian-rupee', 'cash-register': 'calculator', coins: 'coins', 'sack-dollar': 'hand-coins',
  'hand-holding-usd': 'hand-coins', 'hand-holding-dollar': 'hand-coins', 'funnel-dollar': 'funnel', 'piggy-bank': 'piggy-bank',
  'credit-card': 'credit-card', 'rupee-sign': 'indian-rupee', 'indian-rupee-sign': 'indian-rupee', 'indian-rupee': 'indian-rupee',
  rupee: 'indian-rupee', dollar: 'dollar-sign', 'dollar-sign': 'dollar-sign', 'file-invoice-dollar': 'file-text', 'file-invoice': 'file-text',
  'id-card': 'id-card', 'id-card-clip': 'id-card', 'id-badge': 'badge-check', 'address-card': 'contact', 'contact-card': 'contact',
  'address-book': 'book-user', passport: 'plane', comments: 'messages-square', comment: 'message-circle', 'comment-alt': 'message-square',
  'comment-dots': 'message-circle', 'comment-exclamation': 'message-square-warning', sms: 'message-square', bullhorn: 'megaphone',
  'calendar-alt': 'calendar', 'calendar-days': 'calendar-range', 'calendar-day': 'sunrise', 'calendar-week': 'calendar-range',
  'calendar-check': 'calendar-check', 'calendar-plus': 'calendar-plus', 'calendar-minus': 'calendar-minus', 'clock-rotate-left': 'history',
  history: 'history', stopwatch: 'timer', 'hourglass-half': 'hourglass', 'hourglass-start': 'hourglass',
  heartbeat: 'heart-pulse', 'heart-pulse': 'heart-pulse', 'hand-holding-heart': 'heart', 'heart-broken': 'heart-crack',
  'hand-holding': 'hand', hands: 'hand', 'hands-helping': 'handshake', 'handshake-alt': 'handshake', 'handshake-simple': 'handshake',
  'handshake-simple-slash': 'handshake', 'praying-hands': 'hand', 'hand-fist': 'hand-fist', 'fist-raised': 'hand-fist', 'hands-wash': 'hand',
  'hands-bubbles': 'hand', 'briefcase-medical': 'briefcase-medical', 'notes-medical': 'clipboard-plus', hospital: 'hospital',
  stethoscope: 'stethoscope', 'shield-virus': 'shield-plus', 'pump-soap': 'droplet', soap: 'droplet', 'box-tissue': 'package',
  trophy: 'trophy', medal: 'medal', certificate: 'badge', ribbon: 'ribbon', crown: 'crown', 'star-half-alt': 'star-half',
  'star-half': 'star-half', 'graduation-cap': 'graduation-cap', graduation: 'graduation-cap', school: 'school', university: 'landmark',
  landmark: 'landmark', 'building-columns': 'landmark', bank: 'landmark', 'place-of-worship': 'church', mosque: 'landmark',
  'gavel': 'gavel', 'balance-scale': 'scale', 'scale-balanced': 'scale', 'file-contract': 'file-pen-line', 'file-signature': 'file-pen-line',
  'file-alt': 'file-text', 'file-lines': 'file-text', 'file-pdf': 'file-text', 'file-word': 'file-text', 'file-excel': 'file-spreadsheet',
  'file-csv': 'file-spreadsheet', 'file-powerpoint': 'file-text', 'file-image': 'image', 'file-video': 'video',
  'file-audio': 'music', 'file-archive': 'archive', 'file-zip': 'archive', 'file-code': 'file-code',
  'file-arrow-down': 'download', 'file-arrow-up': 'upload', 'file-export': 'download', 'file-import': 'upload',
  'file-plus': 'file-plus', 'file-minus': 'file-minus', 'folder-open': 'folder-open', 'folder-plus': 'folder-plus',
  'cloud-download': 'cloud-download', 'cloud-upload': 'cloud-upload', 'cloud-upload-alt': 'cloud-upload', save: 'save', print: 'printer',
  newspaper: 'newspaper', images: 'images', camera: 'camera', 'photo-video': 'images', video: 'video', 'record-vinyl': 'disc',
  'chart-line': 'trending-up', 'chart-bar': 'chart-column', 'chart-pie': 'chart-pie', 'pie-chart': 'chart-pie', 'chart-area': 'chart-area',
  'chart-line-down': 'trending-down', poll: 'chart-column', 'magnifying-glass-chart': 'chart-no-axes-combined', 'project-diagram': 'network',
  sitemap: 'network', 'code-branch': 'git-branch', 'shield-alt': 'shield-check', 'shield-halved': 'shield', lock: 'lock', key: 'key',
  cog: 'settings', cogs: 'settings-2', gear: 'settings', gears: 'settings-2', sliders: 'sliders-horizontal', tools: 'wrench',
  'screwdriver-wrench': 'wrench', hammer: 'hammer', 'check-circle': 'circle-check', 'circle-check': 'circle-check',
  'check-square': 'square-check', 'square-check': 'square-check', 'check-to-slot': 'vote', 'thumbs-up': 'thumbs-up',
  'thumbs-down': 'thumbs-down', 'list-check': 'list-checks', tasks: 'list-checks', todo: 'list-todo', 'clipboard-list': 'clipboard-list',
  'clipboard-check': 'clipboard-check', 'external-link': 'external-link', 'external-link-alt': 'external-link', 'globe-asia': 'earth',
  'globe-americas': 'globe', 'earth-asia': 'earth', 'earth-africa': 'earth', 'earth-americas': 'earth', 'earth-europe': 'earth',
  'exclamation-triangle': 'triangle-alert', 'triangle-exclamation': 'triangle-alert', 'exclamation-circle': 'circle-alert',
  exclamation: 'circle-alert', 'info-circle': 'info', 'circle-info': 'info', 'question-circle': 'circle-question-mark',
  'circle-question': 'circle-question-mark', question: 'circle-question-mark', 'circle-xmark': 'circle-x', 'times-circle': 'circle-x',
  times: 'x', xmark: 'x', ban: 'ban', 'minus-circle': 'circle-minus', 'circle-minus': 'circle-minus', 'plus-circle': 'circle-plus',
  'circle-plus': 'circle-plus', 'plus-square': 'square-plus', 'circle-notch': 'loader-circle', spinner: 'loader', sync: 'refresh-cw',
  refresh: 'refresh-cw', redo: 'redo-2', rotate: 'refresh-cw', 'arrows-spin': 'refresh-cw', 'arrows-alt': 'move', exchange: 'arrow-left-right',
  'exchange-alt': 'arrow-left-right', 'circle-arrow-right': 'circle-arrow-right', 'circle-arrow-left': 'circle-arrow-left',
  'circle-arrow-up': 'circle-arrow-up', 'circle-arrow-down': 'circle-arrow-down', 'caret-down': 'chevron-down', 'caret-up': 'chevron-up',
  'caret-left': 'chevron-left', 'caret-right': 'chevron-right', 'sort-down': 'arrow-down', 'sort-up': 'arrow-up',
  sort: 'arrow-up-down', bars: 'menu', 'ellipsis-h': 'ellipsis', th: 'layout-grid', 'th-large': 'layout-grid', 'th-list': 'list',
  'shopping-cart': 'shopping-cart', 'shopping-bag': 'shopping-bag', 'basket-shopping': 'shopping-basket', shop: 'store',
  'bell-concierge': 'concierge-bell', 'concierge-bell': 'concierge-bell', 'bell-slash': 'bell-off', qrcode: 'qr-code', barcode: 'barcode',
  percentage: 'percent', discount: 'badge-percent', tag: 'tag', tags: 'tags', 'tags-alt': 'tags', receipt: 'receipt', ticket: 'ticket',
  'ticket-alt': 'ticket', handshake: 'handshake', seedling: 'sprout', leaf: 'leaf', tree: 'tree-deciduous', tractor: 'tractor', cow: 'beef',
  'apple-whole': 'apple', carrot: 'carrot', 'bowl-rice': 'soup', 'bowl-food': 'soup', 'pepper-hot': 'flame', 'mug-hot': 'coffee',
  'glass-water': 'glass-water', 'birthday-cake': 'cake', 'cake-candles': 'cake', 'shipping-fast': 'truck', truck: 'truck',
  'truck-moving': 'truck', bus: 'bus', car: 'car', taxi: 'car', motorcycle: 'bike', bicycle: 'bike', plane: 'plane',
  ship: 'ship', train: 'train-front', subway: 'train-front', 'gauge-high': 'layout-dashboard', tachometer: 'gauge', 'tachometer-alt': 'gauge',
  bolt: 'zap', 'bolt-lightning': 'zap', 'power-off': 'power-off', plug: 'plug', 'solar-panel': 'sun', 'lightbulb': 'lightbulb',
  'satellite-dish': 'satellite-dish', signal: 'signal', wifi: 'wifi', server: 'server', database: 'database', hdd: 'hard-drive',
  microchip: 'cpu', robot: 'bot', terminal: 'terminal', code: 'code', 'sign-in': 'log-in', 'sign-in-alt': 'log-in', 'sign-out': 'log-out',
  'sign-out-alt': 'log-out', 'right-from-bracket': 'log-out', 'right-to-bracket': 'log-in', 'share-alt': 'share-2', 'reply-all': 'forward',
  'quote-left': 'quote', 'quote-right': 'quote', 'sticky-note': 'sticky-note', 'note-sticky': 'sticky-note', 'paint-brush': 'paintbrush',
  'paint-roller': 'paint-roller', palette: 'palette', 'color-palette': 'palette', 'fill-drip': 'paint-bucket', 'eye-dropper': 'pipette',
  'pen-nib': 'pen-tool', 'pen-fine': 'pen', 'pen-square': 'square-pen', 'pen-ruler': 'pencil-ruler', 'edit-alt': 'pen-line',
  pencil: 'pencil', highlighter: 'highlighter', 'trash-alt': 'trash', 'magnifying-glass': 'search', magnifier: 'search',
  'search-plus': 'zoom-in', 'search-minus': 'zoom-out', expand: 'maximize', compress: 'minimize', 'eye-slash': 'eye-off',
  'book-open': 'book-open', 'journal-whills': 'book', scroll: 'scroll', 'scroll-torah': 'scroll', torah: 'scroll',
  'hand-boy': 'hand', 'hand-girl': 'hand', 'face-smile': 'smile', smile: 'smile', 'face-frown': 'frown', 'face-meh': 'meh',
  'face-angry': 'angry', 'face-laugh': 'laugh', 'face-laugh-beam': 'laugh', 'face-grin': 'smile', 'face-grin-stars': 'star',
  'face-kiss': 'smile', 'face-kiss-beam': 'smile', 'face-surprise': 'smile', 'face-confused': 'meh', 'house-chimney': 'house',
  'house-crack': 'house', 'house-flood': 'house', 'house-flood-water': 'waves', 'person-shelter': 'house', hotel: 'building-2',
  'person-booth': 'users', igloo: 'house', tent: 'tent', tents: 'tent', mountain: 'mountain', 'cloud-sun': 'cloud-sun',
  'cloud-rain': 'cloud-rain', 'cloud-moon': 'cloud-moon', 'cloud-sun-rain': 'cloud-sun-rain', snowflake: 'snowflake', fire: 'flame',
  droplet: 'droplet', tint: 'droplet', 'water': 'waves', spa: 'flower', dove: 'bird', paw: 'paw-print', 'kiwi-bird': 'bird',
  horse: 'rabbit', otter: 'cat', dog: 'dog', cat: 'cat', cats: 'cat', fish: 'fish', shrimp: 'fish', bug: 'bug', spider: 'bug',
  skull: 'skull', 'skull-crossbones': 'skull', radiation: 'radiation', flask: 'flask-conical', 'mortar-pestle': 'pill',
  'thermometer-half': 'thermometer', 'thermometer-empty': 'thermometer', 'thermometer-full': 'thermometer', 'thermometer-quarter': 'thermometer',
  'swimming-pool': 'waves', 'ladder-water': 'waves', bath: 'bath', shower: 'shower-head', restroom: 'toilet', toilets: 'toilet',
  'toilets-portable': 'toilet', 'toilet-paper': 'toilet', sink: 'droplet', broom: 'brush', sponge: 'brush', 'spray-can': 'spray-can',
  bucket: 'paint-bucket', forklift: 'forklift', dolly: 'package', pallet: 'package', boxes: 'boxes', 'boxes-stacked': 'boxes',
  box: 'box', archive: 'archive', 'archive-box': 'archive', 'suitcase-rolling': 'luggage', suitcase: 'briefcase', 'map': 'map',
  'flag-checkered': 'flag', 'thumbtack': 'pin', 'location-arrow': 'navigation', crosshairs: 'crosshair', bullseye: 'target',
  'person-drowning': 'life-buoy', 'life-ring': 'life-buoy', 'car-burst': 'car', 'person-through-window': 'user', jar: 'container',
  'glass-whiskey': 'glass-water', cocktail: 'martini', beer: 'beer', coffee: 'coffee', 'mug-soda': 'cup-soda', cookie: 'cookie',
  'cookie-bite': 'cookie', 'candy-cane': 'candy-cane', mitten: 'hand', 'snowman': 'snowflake', 'music-note': 'music',
  'music-slash': 'music', microphone: 'mic', 'microphone-alt': 'mic', headset: 'headset', headphones: 'headphones',
  'volume-up': 'volume-2', play: 'play', pause: 'pause', stop: 'square', 'stop-circle': 'circle-stop', forward: 'fast-forward',
  backward: 'rewind', language: 'languages', translate: 'languages', hashtag: 'hash', asterisk: 'plus', 'circle-dot': 'circle-dot',
  'align-center': 'text-align-center', 'align-left': 'text-align-start', 'align-right': 'text-align-end', 'align-justify': 'text-align-justify',
  'list-ul': 'list', 'list-ol': 'list-ordered', 'text-height': 'type', 'text-width': 'type', 'ruler-horizontal': 'ruler',
  'ruler-vertical': 'ruler', 'draw-polygon': 'pentagon', 'toggle-on': 'toggle-right', 'toggle-off': 'toggle-left', 'satellite': 'satellite',
  'satellite-uplink': 'satellite-dish', 'paperclip': 'paperclip', 'eraser': 'eraser', 'magnet': 'magnet', 'stamp': 'stamp',
  'hamsa': 'hand', 'ring': 'circle-dot', 'gem': 'gem', 'chess': 'crown', 'church': 'church', 'trailer': 'truck', 'tarp': 'tent',
  'tarp-droplet': 'tent', 'sailboat': 'sailboat', 'timeline': 'chart-gantt', 'gauge': 'layout-dashboard', 'feather-alt': 'feather',
  'square': 'square', 'circle': 'circle', 'thumb-war': 'thumbs-up', 'blender': 'cooking-pot', 'meno': 'menu', filter: 'funnel',
  // brands Lucide does not draw
  'facebook-f': 'facebook', 'facebook-square': 'facebook', 'youtube-play': 'youtube', 'linkedin-in': 'linkedin', twitter: 'twitter',
  'x-twitter': 'twitter', viber: 'phone', telegram: 'send', tiktok: 'music', 'google-play': 'play', google: 'search', apple: 'apple',
  android: 'smartphone', bitcoin: 'bitcoin', bluetooth: 'bluetooth', 'skype': 'video',
  // more from the PHP site's core/helpers.php fa_to_lucide_map (values above follow it too, so stored icons look as they did)
  'users-gear': 'users', 'user-edit': 'user-pen', 'edit': 'pencil', 'trash': 'trash-2', 'user-clock': 'clock', 'unlock': 'lock-open',
  'xmark-circle': 'circle-x', 'undo': 'undo-2', 'volume-mute': 'volume-x', 'warning': 'triangle-alert', 'badge': 'award', 'virus': 'bug',
  'hr': 'minus', 'fill': 'droplet', 'vote-yea': 'circle-check', 'utensil-spoon': 'utensils', 'mars': 'user', 'venus': 'user-round',
  'vial-circle-check': 'flask-conical', 'worm': 'bug', 'torch': 'flame', 'vcard': 'contact', 'user-tag': 'user-check',
};
/** The one alias table (old custom + Font Awesome names → Lucide), exported for tests and tooling. */
const ALIAS = { ...FA, ...LEGACY };

// keyword fallback for free-text admin values ("loan", "saving scheme" …) — first match wins
const KEYWORDS = [
  [/piggy|saving|deposit/, 'piggy-bank'], [/wallet/, 'wallet'], [/coins?|money|cash/, 'banknote'], [/loan|credit|rupee|dollar/, 'hand-coins'],
  [/mobile|phone|sms/, 'smartphone'], [/envelope|mail/, 'mail'], [/map|location|marker/, 'map-pin'], [/clock|time/, 'clock'],
  [/users|people|group|handshake|team/, 'users'], [/user/, 'user'], [/shield|lock|secure|safe/, 'shield-check'], [/heart|care|health|insurance/, 'heart'],
  [/chart|graph|trend|growth|analytics/, 'chart-column'], [/percent/, 'percent'], [/calculator/, 'calculator'], [/calendar|date/, 'calendar'],
  [/star|award|trophy|medal|crown/, 'award'], [/globe|internet|online|web/, 'globe'], [/wifi/, 'wifi'], [/building|bank|university/, 'landmark'],
  [/home|house/, 'house'], [/file|doc|pdf/, 'file-text'], [/download/, 'download'], [/bell|notif/, 'bell'], [/qr/, 'qr-code'],
  [/store|shop|cart/, 'store'], [/briefcase|job|business/, 'briefcase'], [/bolt|fast|speed|rocket/, 'zap'], [/check|thumbs|ok|tick/, 'circle-check'],
  [/message|chat|comment/, 'message-square'],
];

const PREFIX = /(^|\s)(fa[srbldt]?|fa-(solid|regular|brands|light|duotone|thin|sharp))(?=\s|$)/g;
const MODIFIER = /^fa-(\dx|lg|xs|sm|fw|spin|pulse|border|inverse|flip-\w+|rotate-\d+|stack(-\dx)?|li|ul|beat|bounce|fade|shake|solid|regular|brands|light|duotone|thin|sharp)$/;

const lucide = n => (Object.hasOwn(NODES, n) ? n : null);
/** One candidate → Lucide name or null. FA tokens prefer the FA table; bare names prefer old custom names, then Lucide. */
const known = ({ n, fa }) => fa ? (Object.hasOwn(FA, n) ? FA[n] : lucide(n))
  : Object.hasOwn(LEGACY, n) ? LEGACY[n] : lucide(n) || (Object.hasOwn(FA, n) ? FA[n] : null);
/** Clean a stored value into candidates: "fas fa-hand-holding-usd fa-2x" → hand-holding-usd (FA); "lucide-phone" → phone. */
function candidates(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return [];
  const out = [{ n: s, fa: false }];
  s.split(/\s+/).filter(t => t.startsWith('fa-') && !MODIFIER.test(t)).forEach(t => out.push({ n: t.slice(3), fa: true }));
  out.push({ n: s.replace(/^(lucide|icon)-/, ''), fa: false }, { n: s.replace(PREFIX, ' ').trim().split(/\s+/)[0].replace(/^fa-/, ''), fa: false });
  return out.filter(c => c.n);
}
/** Any icon value → a Lucide name, or null when nothing (not even a keyword) matches. */
function resolve(raw) {
  const c = candidates(raw);
  for (const x of c) { const hit = known(x); if (hit) return hit; }
  for (const x of c) { const hit = KEYWORDS.find(([re]) => re.test(x.n)); if (hit) return hit[1]; }
  return null;
}
/** Is this value a name we know exactly (a Lucide name or an alias key)? */
const has = raw => candidates(raw).some(x => known(x));

const ATTR_OK = /^[a-z][a-z0-9-]*$/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cache = new Map(); // name -> inner SVG markup
function body(name) {
  let b = cache.get(name);
  if (b === undefined) {
    b = (NODES[name] || []).map(([tag, attrs]) => `<${tag}${Object.entries(attrs).filter(([k]) => ATTR_OK.test(k)).map(([k, v]) => ` ${k}="${esc(v)}"`).join('')}/>`).join('');
    cache.set(name, b);
  }
  return b;
}

/**
 * Inline SVG for any icon value. opts: a class string, or { class, size, title }.
 * Decorative by default (aria-hidden); with a title it becomes role="img" with an accessible name.
 */
function icon(name, opts = '') {
  const o = typeof opts === 'string' ? { class: opts } : (opts || {});
  const n = resolve(name) || FALLBACK;
  const cls = ['icon', 'lucide', 'lucide-' + n, o.class].filter(Boolean).join(' ');
  const size = Number(o.size) > 0 ? ` width="${Number(o.size)}" height="${Number(o.size)}"` : '';
  const a11y = o.title ? ` role="img" aria-label="${esc(o.title)}"><title>${esc(o.title)}</title` : ' aria-hidden="true" focusable="false"';
  return `<svg class="${esc(cls)}" viewBox="0 0 24 24"${size} fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${a11y}>${body(n)}</svg>`;
}

/** Lucide name for an admin-entered value (PHP Font Awesome classes or Lucide names); `fallback` when nothing maps. */
function iconFor(raw, fallback = 'check') { return resolve(raw) || resolve(fallback) || FALLBACK; }
/** Back-compat name: any value → a Lucide name that renders (unknown → FALLBACK). */
const faToNode = raw => resolve(raw) || FALLBACK;

// ------------------------------------------------------------------ admin icon picker
/** Curated Lucide names shown first in the picker (cooperative / finance / content). */
const CURATED = [
  // money & finance
  'piggy-bank', 'wallet', 'banknote', 'coins', 'hand-coins', 'credit-card', 'landmark', 'indian-rupee', 'dollar-sign', 'receipt',
  'calculator', 'percent', 'badge-percent', 'chart-column', 'chart-line', 'chart-pie', 'trending-up', 'trending-down', 'scale', 'vault',
  'safe', 'arrow-left-right', 'circle-dollar-sign', 'hand-heart', 'gem', 'gift', 'shopping-cart', 'store', 'shopping-bag', 'tag',
  // people & organisation
  'user', 'users', 'user-plus', 'user-check', 'circle-user', 'contact', 'id-card', 'book-user', 'handshake', 'baby', 'accessibility',
  'graduation-cap', 'school', 'briefcase', 'building', 'building-2', 'factory', 'house', 'network', 'presentation', 'gavel', 'vote',
  'award', 'trophy', 'medal', 'badge-check', 'crown', 'star', 'heart', 'heart-pulse', 'stethoscope', 'hospital', 'shield', 'shield-check',
  'lock', 'key', 'fingerprint',
  // communication
  'phone', 'phone-call', 'smartphone', 'mail', 'mail-open', 'send', 'message-square', 'message-circle', 'messages-square', 'megaphone',
  'bell', 'bell-ring', 'rss', 'newspaper', 'radio', 'tv', 'video', 'camera', 'image', 'images', 'mic', 'headset', 'at-sign', 'share-2',
  'facebook', 'youtube', 'instagram', 'twitter', 'linkedin',
  // places & time
  'map-pin', 'map', 'navigation', 'compass', 'globe', 'earth', 'signpost', 'calendar', 'calendar-days', 'calendar-check', 'clock',
  'history', 'timer', 'hourglass', 'alarm-clock',
  // documents & content
  'file', 'file-text', 'file-check', 'file-pen-line', 'file-spreadsheet', 'file-image', 'files', 'folder', 'folder-open', 'clipboard',
  'clipboard-list', 'clipboard-check', 'notebook-pen', 'book', 'book-open', 'library', 'scroll', 'sticky-note', 'printer', 'download',
  'upload', 'paperclip', 'link', 'external-link', 'qr-code', 'scan-line', 'barcode', 'stamp', 'pen', 'pencil', 'signature', 'list',
  'list-checks', 'list-todo', 'table', 'layers', 'layout-grid', 'layout-dashboard', 'inbox', 'archive', 'package', 'box',
  // status & actions
  'check', 'circle-check', 'square-check', 'x', 'circle-x', 'info', 'circle-alert', 'triangle-alert', 'circle-question-mark', 'ban',
  'plus', 'circle-plus', 'minus', 'search', 'funnel', 'settings', 'sliders-horizontal', 'wrench', 'hammer', 'refresh-cw', 'eye',
  'thumbs-up', 'smile', 'zap', 'rocket', 'target', 'flag', 'lightbulb', 'sparkles', 'circle',
  // life, farming, travel
  'sprout', 'leaf', 'tree-pine', 'tractor', 'wheat', 'apple', 'beef', 'milk', 'egg', 'fish', 'soup', 'coffee', 'cake', 'flame',
  'droplet', 'sun', 'moon', 'cloud', 'cloud-rain', 'mountain', 'tent', 'truck', 'bus', 'car', 'bike', 'plane', 'ship', 'fuel',
  'plug', 'lightbulb', 'wifi', 'monitor', 'laptop', 'server', 'database', 'cpu', 'bot', 'music', 'palette', 'paintbrush', 'brush',
  'church', 'hotel', 'utensils', 'baggage-claim', 'life-buoy', 'umbrella',
].filter((n, i, a) => a.indexOf(n) === i && Object.hasOwn(NODES, n));

/** Every Lucide name the picker offers (searchable); leaves out the few that an old custom name shadows, e.g. "pin". */
const ALL = Object.keys(NODES).filter(n => resolve(n) === n);

/** Lucide names matching a search across names and Lucide's keyword tags (curated first). */
function search(q, limit = 120) {
  const s = String(q || '').trim().toLowerCase().replace(PREFIX, ' ').trim().replace(/^fa-/, '');
  if (!s) return CURATED.slice(0, limit);
  const out = new Set();
  const direct = resolve(s); if (direct && has(s)) out.add(direct);
  const score = n => (n === s ? 0 : n.startsWith(s) ? 1 : n.includes(s) ? 2 : (TAGS[n] || []).some(t => t.includes(s)) ? 3 : 9);
  [...CURATED, ...ALL].map(n => [n, score(n)]).filter(([, sc]) => sc < 9).sort((a, b) => a[1] - b[1]).forEach(([n]) => out.add(n));
  return [...out].slice(0, limit);
}
const tagsOf = n => (TAGS[n] || []).join(' ');

module.exports = { icon, iconFor, faToNode, resolve, has, search, tagsOf, names: CURATED, all: ALL, ALIAS, LEGACY, FA, KEYWORDS, FALLBACK };
