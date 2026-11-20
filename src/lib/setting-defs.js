'use strict';
/**
 * Settings registry: every site setting the admin Settings page edits, with its tab, type and label.
 * The page is driven by this list (not by whichever rows happen to exist), so a key that was never
 * seeded can still be edited, and keys imported from the PHP site get the right input.
 *
 * Types: text, textarea, richtext, image, color, url, email, number, bool, select, secret, map
 *   max     — maximum length (text-like)
 *   options — [[value, np, en]] for select
 */
const TABS = {
  general: ['सामान्य', 'General'], contact: ['सम्पर्क', 'Contact'], about: ['परिचय', 'About'], sections: ['दृष्टिकोण / सन्देश', 'Vision & messages'],
  social: ['सामाजिक सञ्जाल', 'Social'], apps: ['एप/बैंकिङ', 'Apps'], seo: ['SEO', 'SEO'], footer: ['फुटर', 'Footer'],
  notify: ['SMS / इमेल', 'SMS / email'], ai: ['AI च्याट', 'AI chat'], oauth: ['Google / Facebook लगइन', 'Google / Facebook sign-in'],
  security: ['स्प्याम सुरक्षा', 'Anti-spam'],
};

const d = (key, group, type, np, en, extra = {}) => ({ key, group, type, label: [np, en], ...extra });

const DEFS = [
  // ---- general
  d('site_name', 'general', 'text', 'संस्थाको नाम (नेपाली)', 'Organisation name (Nepali)', { max: 200 }),
  d('site_name_en', 'general', 'text', 'संस्थाको नाम (English)', 'Organisation name (English)', { max: 200 }),
  d('site_tagline', 'general', 'text', 'मूल नारा', 'Tagline', { max: 200 }),
  d('site_slogan', 'general', 'text', 'स्लोगन (नेपाली)', 'Slogan (Nepali)', { max: 255 }),
  d('site_slogan_en', 'general', 'text', 'स्लोगन (English)', 'Slogan (English)', { max: 255 }),
  d('logo', 'general', 'image', 'लोगो', 'Logo'),
  d('logo_np', 'general', 'image', 'लोगो (नेपाली पृष्ठ)', 'Logo (Nepali pages)', { hint: 'खाली = मुख्य लोगो / blank = main logo' }),
  d('logo_en', 'general', 'image', 'लोगो (English पृष्ठ)', 'Logo (English pages)', { hint: 'खाली = मुख्य लोगो / blank = main logo' }),
  d('site_favicon', 'general', 'image', 'फेभिकन (ब्राउजर ट्याब)', 'Favicon (browser tab)', { hint: 'वर्गाकार PNG, कम्तीमा 192px / square PNG, at least 192 px' }),
  d('site_url', 'general', 'url', 'वेबसाइट URL', 'Website URL'),
  d('pwa_short_name', 'general', 'text', 'एपको छोटो नाम (PWA)', 'App short name (PWA)', { max: 30 }),
  d('site_launch_date', 'general', 'text', 'वेबसाइट सुरु मिति', 'Website launch date', { max: 40 }),
  d('admin_date_input', 'general', 'select', 'प्रशासनमा मिति राख्ने तरिका', 'Date entry in the admin forms', { options: [['bs', 'वि.सं. पात्रो (ई.सं. मा स्वतः)', 'B.S. calendar (converted to A.D.)'], ['ad', 'ई.सं. मात्र', 'A.D. only']] }),
  // ---- contact
  d('phone', 'contact', 'text', 'फोन', 'Phone', { max: 100 }),
  d('mobile', 'contact', 'text', 'मोबाइल', 'Mobile', { max: 100 }),
  d('email', 'contact', 'email', 'इमेल', 'Email'),
  d('address', 'contact', 'textarea', 'ठेगाना (नेपाली)', 'Address (Nepali)', { max: 500 }),
  d('address_en', 'contact', 'textarea', 'ठेगाना (English)', 'Address (English)', { max: 500 }),
  d('office_address', 'contact', 'textarea', 'कार्यालय ठेगाना (पूरा)', 'Office address (full)', { max: 500 }),
  d('working_hours', 'contact', 'text', 'कार्यालय समय', 'Working hours', { max: 200 }),
  d('saturday_hours', 'contact', 'text', 'शनिबार/बिदा समय', 'Saturday / holiday hours', { max: 200 }),
  d('office_time_start', 'contact', 'text', 'कार्यालय खुल्ने (HH:MM)', 'Office opens (HH:MM)', { pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }),
  d('office_time_end', 'contact', 'text', 'कार्यालय बन्द (HH:MM)', 'Office closes (HH:MM)', { pattern: /^([01]\d|2[0-3]):[0-5]\d$/ }),
  d('map_embed_url', 'contact', 'map', 'Google नक्सा', 'Google map', { hint: 'Google Maps → Share → Embed को iframe, पूरा लिङ्क वा छोटो maps.app.goo.gl लिङ्क टाँस्नुहोस् / paste the embed iframe, a maps link or a maps.app.goo.gl short link' }),
  d('google_map_url', 'contact', 'url', 'Google Maps लिङ्क (दिशा)', 'Google Maps link (directions)'),
  // ---- about
  d('established_year', 'about', 'text', 'स्थापना वर्ष', 'Established year', { max: 20 }),
  d('registration_no', 'about', 'text', 'दर्ता नम्बर', 'Registration number', { max: 100 }),
  d('about_short', 'about', 'textarea', 'छोटो परिचय', 'Short introduction', { max: 2000 }),
  d('about_content', 'about', 'richtext', 'हाम्रो बारेमा (पूरा)', 'About us (full)'),
  d('about_page_image', 'about', 'image', 'परिचय पृष्ठ फोटो', 'About page image'),
  d('about_intro_image', 'about', 'image', 'गृहपृष्ठ परिचय फोटो', 'Home intro image'),
  d('history_content_np', 'about', 'richtext', 'इतिहास (नेपाली)', 'History (Nepali)'),
  d('history_content_en', 'about', 'richtext', 'इतिहास (English)', 'History (English)'),
  d('history_photo', 'about', 'image', 'इतिहास फोटो', 'History photo'),
  d('years_experience', 'about', 'number', 'अनुभव (वर्ष)', 'Years of experience'),
  d('total_services', 'about', 'number', 'सेवा संख्या', 'Number of services'),
  d('satisfaction_rate', 'about', 'number', 'सन्तुष्टि दर (%)', 'Satisfaction rate (%)'),
  d('total_members', 'about', 'number', 'कुल सदस्य (देखाउने)', 'Total members (shown)'),
  d('mobile_app_photo', 'about', 'image', 'मोबाइल एप फोटो', 'Mobile app photo'),
  d('certificate_signatory', 'about', 'text', 'प्रमाणपत्र: हस्ताक्षरकर्ता', 'Certificate: signatory', { max: 150 }),
  d('certificate_signatory_title', 'about', 'text', 'प्रमाणपत्र: पद', 'Certificate: signatory title', { max: 150 }),
  // ---- vision / mission / values / chairman / CEO (legacy pages.php?tab=static)
  ...['vision_content', 'mission_content', 'values_content'].flatMap(k => {
    const [np, en] = { vision_content: ['दृष्टिकोण', 'Vision'], mission_content: ['लक्ष्य', 'Mission'], values_content: ['मूल्य मान्यता', 'Values'] }[k];
    return [
      d(k + '_title_np', 'sections', 'text', `${np} — शीर्षक (नेपाली)`, `${en} — title (Nepali)`, { max: 200 }),
      d(k + '_title_en', 'sections', 'text', `${np} — शीर्षक (English)`, `${en} — title (English)`, { max: 200 }),
      d(k + '_np', 'sections', 'richtext', `${np} (नेपाली)`, `${en} (Nepali)`),
      d(k + '_en', 'sections', 'richtext', `${np} (English)`, `${en} (English)`),
    ];
  }),
  ...['chairman', 'ceo'].flatMap(w => {
    const [np, en] = w === 'chairman' ? ['अध्यक्ष', 'Chairperson'] : ['प्रमुख कार्यकारी अधिकृत', 'CEO'];
    return [
      d(w + '_name', 'sections', 'text', `${np} — नाम (नेपाली)`, `${en} — name (Nepali)`, { max: 150 }),
      d(w + '_name_en', 'sections', 'text', `${np} — नाम (English)`, `${en} — name (English)`, { max: 150 }),
      d(w + '_designation_np', 'sections', 'text', `${np} — पद (नेपाली)`, `${en} — designation (Nepali)`, { max: 150 }),
      d(w + '_designation_en', 'sections', 'text', `${np} — पद (English)`, `${en} — designation (English)`, { max: 150 }),
      d(w + '_photo', 'sections', 'image', `${np} — फोटो`, `${en} — photo`),
      d(w + '_message_title_np', 'sections', 'text', `${np} सन्देश — शीर्षक (नेपाली)`, `${en} message — title (Nepali)`, { max: 200 }),
      d(w + '_message_title_en', 'sections', 'text', `${np} सन्देश — शीर्षक (English)`, `${en} message — title (English)`, { max: 200 }),
      d(w + '_message_np', 'sections', 'richtext', `${np} सन्देश (नेपाली)`, `${en} message (Nepali)`),
      d(w + '_message_en', 'sections', 'richtext', `${np} सन्देश (English)`, `${en} message (English)`),
    ];
  }),
  // ---- social
  d('facebook_url', 'social', 'url', 'Facebook', 'Facebook'),
  d('youtube_url', 'social', 'url', 'YouTube', 'YouTube'),
  d('instagram_url', 'social', 'url', 'Instagram', 'Instagram'),
  d('twitter_url', 'social', 'url', 'X / Twitter', 'X / Twitter'),
  d('linkedin_url', 'social', 'url', 'LinkedIn', 'LinkedIn'),
  d('tiktok_url', 'social', 'url', 'TikTok', 'TikTok'),
  d('whatsapp_number', 'social', 'text', 'WhatsApp नम्बर', 'WhatsApp number', { max: 30 }),
  d('viber_number', 'social', 'text', 'Viber नम्बर', 'Viber number', { max: 30 }),
  // ---- apps
  d('play_store_url', 'apps', 'url', 'Play Store एप', 'Play Store app'),
  d('app_store_url', 'apps', 'url', 'App Store एप', 'App Store app'),
  d('internet_banking_url', 'apps', 'url', 'इन्टरनेट बैंकिङ', 'Internet banking'),
  d('web_login_url', 'apps', 'url', 'वेब लगइन (सदस्य ड्यासबोर्ड)', 'Web login (member dashboard)'),
  // ---- seo
  d('seo_title', 'seo', 'text', 'SEO शीर्षक (नेपाली, ≤७०)', 'SEO title (Nepali, ≤70)', { max: 70 }),
  d('seo_title_en', 'seo', 'text', 'SEO शीर्षक (English, ≤70)', 'SEO title (English, ≤70)', { max: 70 }),
  d('seo_tagline', 'seo', 'text', 'SEO ट्यागलाइन (नेपाली)', 'SEO tagline (Nepali)', { max: 120 }),
  d('seo_tagline_en', 'seo', 'text', 'SEO ट्यागलाइन (English)', 'SEO tagline (English)', { max: 120 }),
  d('meta_description', 'seo', 'textarea', 'SEO विवरण (नेपाली)', 'SEO description (Nepali)', { max: 400 }),
  d('meta_description_en', 'seo', 'textarea', 'SEO विवरण (English)', 'SEO description (English)', { max: 400 }),
  d('meta_keywords', 'seo', 'text', 'मुख्य शब्द (comma)', 'Meta keywords (comma separated)', { max: 500 }),
  d('site_city', 'seo', 'text', 'शहर / स्थान (नेपाली)', 'City / location (Nepali)', { max: 120 }),
  d('site_city_en', 'seo', 'text', 'शहर / स्थान (English)', 'City / location (English)', { max: 120 }),
  d('seo_og_image', 'seo', 'image', 'सेयर फोटो (1200×630)', 'Share image (1200×630)'),
  d('google_site_verification', 'seo', 'text', 'Google site verification', 'Google site verification', { max: 100, hint: '<meta …> पूरै टाँस्न मिल्छ / the whole meta tag is fine' }),
  // ---- footer (legacy footer-settings.php)
  d('supported_name', 'footer', 'text', '"सहयोग" नाम', '"Supported by" name', { max: 150 }),
  d('supported_url', 'footer', 'url', '"सहयोग" लिङ्क (https)', '"Supported by" link (https)', { httpsOnly: true }),
  // ---- notify
  d('notify_email_enabled', 'notify', 'bool', 'इमेल सूचना सक्रिय', 'Email notifications on'),
  d('smtp_host', 'notify', 'text', 'SMTP host', 'SMTP host', { max: 200 }),
  d('smtp_port', 'notify', 'number', 'SMTP port', 'SMTP port'),
  d('smtp_encryption', 'notify', 'select', 'SMTP encryption', 'SMTP encryption', { options: [['tls', 'TLS (587)', 'TLS (587)'], ['ssl', 'SSL (465)', 'SSL (465)'], ['none', 'कुनै होइन', 'None']] }),
  d('smtp_user', 'notify', 'text', 'SMTP username', 'SMTP username', { max: 200 }),
  d('smtp_password', 'notify', 'secret', 'SMTP password', 'SMTP password'),
  d('smtp_from_email', 'notify', 'email', 'पठाउने इमेल', 'From email'),
  d('smtp_from_name', 'notify', 'text', 'पठाउने नाम', 'From name', { max: 150 }),
  d('notify_admin_emails', 'notify', 'text', 'नयाँ आवेदनको इमेल पाउने (comma)', 'Admin emails for new applications (comma separated)', { max: 1000 }),
  d('notify_email_daily_limit', 'notify', 'number', 'दैनिक अधिकतम इमेल', 'Max emails per day'),
  d('notify_sms_enabled', 'notify', 'bool', 'SMS सूचना सक्रिय', 'SMS notifications on'),
  d('notify_sms_gateway', 'notify', 'select', 'SMS gateway', 'SMS gateway', { options: [['sparrow', 'Sparrow SMS', 'Sparrow SMS'], ['aakash', 'Aakash SMS', 'Aakash SMS'], ['webhook', 'Webhook', 'Webhook']] }),
  d('notify_sms_api_url', 'notify', 'url', 'SMS API URL', 'SMS API URL', { httpsOnly: true }),
  d('notify_sms_token', 'notify', 'secret', 'SMS API token', 'SMS API token'),
  d('notify_sms_sender_id', 'notify', 'text', 'SMS sender id', 'SMS sender id', { max: 50 }),
  d('notify_sms_recipients', 'notify', 'text', 'नयाँ आवेदनको SMS पाउने (comma)', 'Admin SMS numbers for new applications (comma separated)', { max: 500 }),
  d('notify_sms_daily_limit', 'notify', 'number', 'दैनिक अधिकतम SMS', 'Max SMS per day'),
  d('notify_member_email', 'notify', 'bool', 'स्थिति परिवर्तनमा आवेदकलाई इमेल', 'Email applicants on status change'),
  d('notify_member_sms', 'notify', 'bool', 'स्थिति परिवर्तनमा आवेदकलाई SMS', 'SMS applicants on status change'),
  d('inbox_quick_status_notify', 'notify', 'bool', 'सूचीबाटको छिटो/बल्क स्थिति परिवर्तनमा पनि सूचना पठाउने', 'Quick / bulk status changes also notify the applicant'),
  // ---- ai
  d('ai_enabled', 'ai', 'bool', 'AI च्याट सक्रिय', 'AI chat on'),
  d('ai_provider', 'ai', 'select', 'AI सेवा', 'AI provider', { options: [['gemini', 'Google Gemini', 'Google Gemini'], ['openai', 'OpenAI', 'OpenAI'], ['deepseek', 'DeepSeek', 'DeepSeek']] }),
  d('ai_model', 'ai', 'text', 'मोडेल (खाली = पूर्वनिर्धारित)', 'Model (blank = provider default)', { max: 80, datalist: 'ai_models' }),
  d('ai_api_key', 'ai', 'secret', 'API key', 'API key'),
  d('ai_welcome_np', 'ai', 'textarea', 'स्वागत सन्देश (नेपाली)', 'Welcome message (Nepali)', { max: 500 }),
  d('ai_welcome_en', 'ai', 'textarea', 'स्वागत सन्देश (English)', 'Welcome message (English)', { max: 500 }),
  d('ai_daily_limit', 'ai', 'number', 'दैनिक अधिकतम AI उत्तर', 'Max AI answers per day'),
  d('ai_extra_context', 'ai', 'textarea', 'सहायकका लागि थप तथ्य', 'Extra facts for the assistant', { max: 5000 }),
  // ---- oauth
  d('google_client_id', 'oauth', 'text', 'Google OAuth client ID', 'Google OAuth client ID', { max: 255 }),
  d('google_client_secret', 'oauth', 'secret', 'Google OAuth client secret', 'Google OAuth client secret'),
  d('facebook_app_id', 'oauth', 'text', 'Facebook app ID', 'Facebook app ID', { max: 100 }),
  d('facebook_app_secret', 'oauth', 'secret', 'Facebook app secret', 'Facebook app secret'),
  // ---- anti-spam (2FA policy and idle timeout live on Admin → Security policy)
  d('turnstile_site_key', 'security', 'text', 'Cloudflare Turnstile site key', 'Cloudflare Turnstile site key', { max: 100 }),
  d('turnstile_secret_key', 'security', 'secret', 'Cloudflare Turnstile secret key', 'Cloudflare Turnstile secret key'),
  d('spam_block_links', 'security', 'bool', 'सन्देशमा लिङ्क/प्रचार रोक्ने', 'Block links / promo text in messages'),
  d('spam_math_captcha', 'security', 'bool', 'Turnstile नभए सार्वजनिक फारममा सजिलो हिसाब जाँच', 'Simple math check on public forms when Turnstile is not set'),
];

const AI_MODELS = {
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
};

/** Keys owned by other admin pages (member portal, client protection, theme, security policy…): not "imported". */
const MANAGED_GROUPS = new Set(['members', 'protection', 'appearance', 'internal', 'theme', 'program', 'programs']);
const MANAGED_KEY = /^(admin_2fa_required|admin_idle_minutes|admin_hidden_menu_groups|push_vapid_\w+|theme_\w+|layout_\w+|lang_\w+|starter_design|program_\w+|notify_(email|sms)_[a-z_]+|card_prefix|member_\w+|ai_welcome|deposit_tax_rate|protection_\w+|satisfaction_widget_enabled)$/;

/** site_settings.setting_type has a CHECK (text, textarea, image, number, color, url): the stored type for a def. */
const storeType = t => ({ richtext: 'textarea', map: 'url', email: 'text', bool: 'text', select: 'text', secret: 'text' }[t] || t);

const byKey = Object.fromEntries(DEFS.map(x => [x.key, x]));
const SECRET_KEY = /password|api_key|token|secret|private/;

/**
 * Google Maps link / iframe → embeddable URL (legacy includes/google-map-embed.php). Short links
 * (maps.app.goo.gl) return '' here; the settings save resolves them first (lib/maps resolveShortLink).
 */
function normalizeMapEmbed(raw) {
  let s = String(raw || '').trim().replace(/&amp;/g, '&');
  if (!s) return '';
  const m = s.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  if (m) s = m[1].trim();
  if (!/^https:\/\//i.test(s)) return '';
  if (/^https:\/\/(www\.)?google\.com\/maps\/embed/i.test(s)) return s;
  if (/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(s)) return '';
  if (!/^https:\/\/(www\.)?(google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i.test(s)) return '';
  let r = s.match(/!3d(-?\d+\.?\d*)!4d(-?\d+\.?\d*)/);
  if (r) return `https://www.google.com/maps?q=${encodeURIComponent(r[1] + ',' + r[2])}&z=17&output=embed`;
  r = s.match(/@(-?\d+\.?\d*),(-?\d+\.?\d*)(?:,(\d+(?:\.\d*)?)z)?/);
  if (r) return `https://www.google.com/maps?q=${encodeURIComponent(r[1] + ',' + r[2])}&z=${Math.max(1, Math.min(21, Math.round(Number(r[3]) || 17)))}&output=embed`;
  r = s.match(/[?&]q=([^&]+)/i);
  if (r) return `https://www.google.com/maps?q=${encodeURIComponent(decodeURIComponent(r[1].replace(/\+/g, ' ')))}&output=embed`;
  r = s.match(/\/maps\/place\/([^/@]+)/i);
  if (r) return `https://www.google.com/maps?q=${encodeURIComponent(decodeURIComponent(r[1].replace(/\+/g, ' ')))}&output=embed`;
  return /output=embed/i.test(s) ? s : s + (s.includes('?') ? '&' : '?') + 'output=embed';
}

/** Coordinates → embed URL (legacy map_lat / map_lng settings). */
const coordsEmbed = (lat, lng) => (/^-?\d{1,3}(\.\d+)?$/.test(String(lat).trim()) && /^-?\d{1,3}(\.\d+)?$/.test(String(lng).trim())
  ? `https://www.google.com/maps?q=${encodeURIComponent(String(lat).trim() + ',' + String(lng).trim())}&z=17&output=embed` : '');

/**
 * Validate / normalise one posted value. Returns { value } or { error } or { skip: true } (keep the stored value).
 */
function clean(def, raw, util) {
  let v = typeof raw === 'string' ? raw.trim() : '';
  switch (def.type) {
    case 'bool': return { value: raw === '1' || raw === 'on' ? '1' : '0' };
    case 'secret': return v === '' ? { skip: true } : { value: v.slice(0, 2000) };
    case 'color': return v === '' || /^#[0-9a-f]{3,8}$/i.test(v) ? { value: v } : { error: '#rrggbb' };
    case 'number': {
      if (v === '') return { value: '' };
      const n = Number(require('./nepali-date').toLatinDigits(v).replace(/,/g, ''));
      return Number.isFinite(n) ? { value: String(n) } : { error: 'अंक / number' };
    }
    case 'email': return v === '' || util.isEmail(v) ? { value: v.toLowerCase().slice(0, 200) } : { error: 'इमेल मिलेन / invalid email' };
    case 'url':
      if (v === '') return { value: '' };
      if (!(def.httpsOnly ? /^https:\/\/[^\s<>"]+$/i : /^https?:\/\/[^\s<>"]+$/i).test(v)) return { error: def.httpsOnly ? 'https:// चाहिन्छ / must start with https://' : 'http(s):// चाहिन्छ / must start with http(s)://' };
      return { value: v.slice(0, 1000) };
    case 'map': {
      if (v === '') return { value: '' };
      const e = normalizeMapEmbed(v);
      return e ? { value: e.slice(0, 2000) } : { error: 'Google Maps को पूरा लिङ्क वा embed iframe टाँस्नुहोस् (छोटो maps.app.goo.gl लिङ्क चल्दैन) / paste the full Google Maps link or the embed iframe (short maps.app.goo.gl links do not work)' };
    }
    case 'select': return v === '' || def.options.some(o => o[0] === v) ? { value: v } : { error: 'option' };
    case 'richtext': return { value: util.sanitizeHtml(v) };
    default:
      if (def.key === 'google_site_verification') v = v.replace(/^[\s\S]*content=["']?([^"'\s>]+)[\s\S]*$/i, '$1').replace(/[^A-Za-z0-9_-]/g, '');
      if (def.pattern && v !== '' && !def.pattern.test(v)) return { error: 'HH:MM' };
      return { value: v.slice(0, def.max || (def.type === 'textarea' ? 20000 : 1000)) };
  }
}

module.exports = { TABS, DEFS, byKey, storeType, AI_MODELS, MANAGED_GROUPS, MANAGED_KEY, SECRET_KEY, normalizeMapEmbed, coordsEmbed, clean };
