# Gap report 1: public website (pages that are not forms)

PHP source: `/home/user/websourcecode` (abbreviated **PHP**). Node app: `/home/user/websitenextgen` (abbreviated **N**).
Line references are for the files as they stand today. Node schema: `db/schema.sql` plus `db/migrations/*.sql`. The next free migration number is **060**.

Status key: **DONE** = parity or better · **PARTIAL** = exists but something users notice is missing · **MISSING** = no equivalent.
Priority key: **P1** = users or migrated tenants would notice right away (wrong or missing data, broken links) · **P2** = a noticeable feature gap · **P3** = polish.

---

## 0. Cross-cutting findings (read these first)

These affect several pages at once and matter most for tenants moved over from PHP.

| # | Finding | Status | Pri |
|---|---|---|---|
| X1 | **BS dates are stored in AD `DATE` columns.** PHP treats any `notices.notice_date`, `careers.deadline` (and similar) with year ≥ 2070 as BS (`includes/config.php:636 coop_notice_date_bs`, `includes/careers-tables.php:25 careerDeadlineAd`). Node always treats them as AD: `nd.adToBs('2082-03-15')` returns `null`, so the date chip is blank. Careers with a BS deadline always show as "open". `/notices` orders by `notice_date`, so BS-dated rows sort above every AD row. | PARTIAL (bug) | **P1** |
| X2 | **Legacy setting keys are not read.** Node reads different keys from PHP, and nothing maps them during import (`src/lib/site-migration.js` has no key mapping). Keys that are lost: `site_slogan`/`site_slogan_en` (N uses `site_tagline`), `google_map_url`/`map_lat`/`map_lng` (N only reads `map_embed_url`, an embed URL), `ai_chat_enabled` (N: `ai_enabled`), `ai_welcome_np`/`ai_welcome_en` (N: `ai_welcome`), `ai_api_key` stored as `enc:v1:…` (N sends the ciphertext to the provider), `logo_np`/`logo_en`/`site_favicon`, `vision_content_en`, `mission_content_en`, `history_content_np/en`, `history_photo`, `about_page_image`/`about_intro_image`, `hero_title`/`hero_subtitle`, `twitter_url`, `web_login_url`, `mobile_app_photo`, `supported_name`/`supported_url`, `pwa_app_name`. | PARTIAL | **P1** |
| X3 | **The About page body lives in `pages` (slug `about`) in PHP, not in a setting.** PHP `about.php:35` loads `SELECT * FROM pages WHERE slug='about'`. N `views/public/about.ejs:5` renders `settings.about_content`, which migrated sites do not have, so the About page shows only `about_short`. | PARTIAL (bug) | **P1** |
| X4 | **`institutional_profile` is missing columns PHP uses.** PHP adds them in `admin/includes/ensure-admin-tables.php:500-521`: `reserved_fund`, `reserved_fund_percent`, `share_capital_percent`, `deposit_percent`, `loan_percent`, `total_balance_member`, `report_date_bs`, `report_date_ad`, `total_loan_reserve_fund`, `total_loan_reserve_percent`, `npl_percent`, `liquidity_percent`, `net_profit`, `report_note`. The importer copies only columns that exist on both sides, so **reserve fund and growth-% data is silently dropped** on import. | MISSING (data loss) | **P1** |
| X5 | `reports.view_only` is missing in the schema and the routes (PHP `report-file.php:83`, `reports.php:247`). A report the office marked "read only" becomes downloadable in N. Imported rows lose the flag. | MISSING | **P1** |
| X6 | **Legacy deep links lose their id.** In `src/lib/legacy-urls.js`, `report-file.php?id=` goes to `/reports` (should be `/reports/:id/file`), `institutional-profile-file.php?id=` goes to `/institutional-profile`, `page.php?id=` goes to `/`, `awards.php?id=` goes to `/awards`, `reports.php?type=&year=&id=` drops the filters, and `information-room-file.php` is not mapped. Links shared on Facebook and in printed notices break. | PARTIAL | **P1** |
| X7 | The notice **popup appears only on the home page, for one notice**. PHP shows up to 5 popups as a carousel on **every** public page (`includes/header.php:1905-2140`), with auto-rotate, a progress bar, "View full notice" (PDF/image) and a photo-only mode that links to the attachment. | PARTIAL | **P1** |
| X8 | There is **no notice ticker** and **no bell dropdown in the header** (PHP `header.php:78-123`, `1964-1990`). | MISSING | P2 |
| X9 | There is **no site search** (PHP: a search modal with a voice mic and a client-side page index, `includes/footer.php:496-570`, `assets/js/search-improved.js:42-69`). | MISSING | P2 |
| X10 | Home-page queries are not cached: about 11 queries per hit. PHP caches them for 900 s (`index.php:10`, `getCachedData('homepage_data_v2', 900)`). | PARTIAL | P3 |

---

## (a) Summary table

| Area / PHP file | Node route / file | Status | Pri | What is missing (detail in section b) |
|---|---|---|---|---|
| **index.php: hero slider** | `/` `views/public/home.ejs` | PARTIAL | P1 | Slide `button_text`/`button_url` CTA is not rendered. The fallback hero ignores `hero_title`/`hero_subtitle`. 6 slides max (PHP 12). |
| index.php: institutional profile bar and financial snapshot | home stats row | PARTIAL | P2 | No "Monthly / Annual / All reports" quick links with a "Latest" badge. No FY/month label. No "View charts" link. |
| index.php: services (3 + "view all") | home services | DONE | – | N shows 6 cards and links each to its detail page (better). The `icon` column is ignored (the icon is guessed from the title). |
| index.php: digital-services quick-access grid (3 groups × 4 links) | home quick-links (6) | PARTIAL | P3 | Exchange rate, date converter, downloads, digital services, welfare, auction and grievance are not in the quick links. |
| index.php: rates (saving/loan, 5 each) and notices | home | DONE | – | |
| index.php: why choose (with "view all reasons") | home features | DONE | P3 | `why_choose_features.icon` is ignored. No link to a full list. |
| index.php: **leadership block** (chairman, CEO, information officer, grievance officer cards) | – | **MISSING** | **P1** | |
| index.php: **mobile app section** (Play Store / App Store, `mobile_app_photo`) | – | **MISSING** | P2 | |
| index.php: **app features** section (show more / less) | only on `/digital-services` | PARTIAL | P2 | |
| index.php: latest news (3) | home | DONE | – | |
| index.php: **awards** (3 + "view all", "read more") | – | **MISSING** | P2 | |
| index.php: **member of the year spotlight** (current year) | – | **MISSING** | P2 | Only shown on `/awards`. |
| index.php: join CTA (KYM + contact) | home CTA | DONE | – | |
| header: topbar quick links, login dropdown (e-banking `internet_banking_url`, `web_login_url`, Android/iOS app, member, verify, office login) | `layouts/public.ejs` topbar | PARTIAL | P2 | Only a "Member login" button. No e-banking, web-login or app links. No unread-count badge. |
| header: bell notifications | – | MISSING | P2 | X8 |
| header: notice ticker | – | MISSING | P2 | X8 |
| header: popup carousel on every page | home only | PARTIAL | P1 | X7 |
| header: search modal (voice) | – | MISSING | P2 | X9 |
| header: PWA install button | – | MISSING | P3 | |
| header: dark mode toggle | theme picker | DONE | – | |
| header: nav, About submenu | `src/lib/navigation.js` | PARTIAL | P2 | **No link to `/success-stories`** (the page is orphaned). No "Why choose us". No history or values anchors. |
| header: nav, Services cascade (category → services) | static list | PARTIAL | P2 | |
| header: nav, Elections shown only when a published cycle has `show_in_navbar` | always shown | PARTIAL | P3 | |
| header: nav badges (open careers count, marketplace counts, NEW) | – | MISSING | P3 | `includes/nav-menu-badges.php` |
| header: honour-programme link only while a programme is open | forms slice | – | – | |
| header: `himal_bg` header background image and opacity | – | MISSING | P3 | |
| header: per-language logo (`logo_np`/`logo_en`), `site_favicon` | `settings.logo` only | PARTIAL | P2 | X2 |
| footer: about, quick links, contact (phone, **mobile**, email, address) | layout footer | PARTIAL | P3 | `mobile` is not shown. `site_slogan` is not used. |
| footer: **policy links** (privacy, terms, cookie) and auto-seeded default policy pages | – | **MISSING** | P2 | `page.php:22-58` |
| footer: visitor counter (total / today) | `visitor_stats` written, never shown | MISSING | P3 | |
| footer: "Supported by" (`supported_name`/`url`) | – | MISSING | P3 | |
| footer: WhatsApp float, quick-actions FAB, mobile bottom nav | WhatsApp in socials only | PARTIAL | P3 | |
| footer: FAQ chatbot widget (chatbot_faqs, without AI) | chat appears only when `ai_enabled` or `chat_widget` is 1 | PARTIAL | P2 | |
| footer: live-chat panel (`api-public-chat.php` → contact_messages) | – | MISSING | P3 | The contact form covers it. |
| satisfaction-widget.php | `partials/float-widgets.ejs` | DONE | – | |
| public-ui-look.php / theme-assets.php | `src/lib/layouts.js`, `themes.js` | DONE | – | |
| about.php | `/about` | PARTIAL | **P1** | X3. No history section (`history_content_*`, `history_photo`), no about image, no values cards, no "more about us" link cards, no board org chart, no stats band (`total_members`, `years_experience`, `total_services`, `satisfaction_rate`). No hash redirects. |
| vision-mission.php | `/vision-mission` | PARTIAL | P1 | **English content is ignored** (`vision_content_en`, `mission_content_en`). Custom titles (`vision_content_title_*`, `mission_content_title_*`) are ignored. |
| chairman-message.php / ceo-message.php / leadership-message-helpers.php | `/message/:who` | DONE | – | Matches the fallback chain. |
| why-choose.php | redirects to `/about` (features grid) | DONE | P3 | Icons are not used. |
| team.php / team-chart-helpers / team-menu-categories / team-staff-groups | `/team`, `src/lib/team.js` | DONE / PARTIAL | P3 | Contact officers omit the chairman and CEO. No email on cards. A committee's members are not inline with a tenure picker (links to `/committees/:id` instead). |
| committees.php | `/committees`, `/committees/:id` | PARTIAL | P2 | No fallback to `team_members.category='cmt_<id>'` when a type has no tenures (the page is empty). No past-committees section. No org-chart layout. Legacy `?type=`/`?tenure=` are not mapped. |
| awards.php | `/awards` | PARTIAL | P2 | No description and no `?id=` detail view. |
| member-of-year (in awards) | `/awards` | DONE | – | |
| success-stories.php | `/success-stories` | PARTIAL | P2 | `institution_help_np/en` ("how the cooperative helped") and `member_since` are not shown. Not in the nav. |
| services.php / service-products-tables.php | `/services`, `/services/:id` | DONE | P3 | No category jump-nav. Category description and icon not shown. No `#anchor` focus. Legacy `services.php#saving` anchors are lost. |
| interest-rates.php | `/interest-rates` | DONE (better) | – | |
| digital-services.php (listing) | `/digital-services` | DONE | P3 | No 4-step "how it works". |
| service-centers.php | `/service-centers` | DONE | P3 | No head-office/service-centre role badge on non-main branches. No NP/EN subtitle. |
| partner-facilities.php | `/partner-facilities` | PARTIAL | P2 | No type filter pills with counts, no search, no table view, no featured strip, no "how it works", no CTAs (verify card / member portal / become a partner). Not shown: email, website, terms, desk code. |
| news.php / news-detail.php | `/news`, `/news/:id` | DONE | P3 | No share buttons (Facebook, X, WhatsApp). No quick-links sidebar. |
| notices.php | `/notices`, `/notices/:id` | PARTIAL | P1 | X1 (date and order). Image attachments are not shown inline. No "View full notice" call to action for PDFs. |
| gallery.php / gallery-albums.php | `/gallery` | PARTIAL | P2 | No photo/video tabs with counts, no album cover cards, no pagination (hard cap of 200), no lightbox, no YouTube thumbnail derived from the URL, no in-page video player, no `?category=`, no album slug or name param. |
| downloads.php | `/downloads` | DONE | P3 | Category keys are shown raw (`forms`, `policies`). No download count. No file-type icons. |
| reports.php | `/reports` | PARTIAL | **P1** | **No `?type=` filter** (the home page and PHP links use `?type=monthly` / `?type=annual`). No year or month filter. No grouping by type and fiscal year. Type labels untranslated. No month label. No share. No `?id=` deep link or OG enrichment. X5 view-only. |
| report-file.php | `/reports/:id/file` | PARTIAL | P1 | No `?dl=1` vs inline. No view-only refusal. No signed `?t=` token for Facebook in-app browsers. |
| institutional-profile.php | `/institutional-profile` | PARTIAL | **P1** | X4 columns. No trend charts. No fiscal-year, month or search filter (or "latest 2" chips). Month cards lack growth %, reserve, institutional capital, liquidity, borrowers. No printable poster. Members-only rows ignore the membership-number unlock (only a member login works). |
| institutional-profile-file.php | `/institutional-profile/:id/file` | PARTIAL | P2 | Does not accept the membership unlock (`memberAccess.canOpen`). |
| information-room-file.php | member portal | – | – | Member slice. Legacy URL not mapped (X6). |
| career.php (listing) | `/careers` | PARTIAL | P2 | X1 BS deadline. No search, department filter or open/closed chips. No days-left, deadline progress, "urgent" (≤7 days) or "new" badges. |
| auction.php (listing/detail) | `/auctions`, `/auctions/:id` | PARTIAL | P3 | Status is shown untranslated (`ongoing`). No status filter chips or counts. |
| election-information.php | `/elections`, `/elections/:id` | PARTIAL | P2 | No voting-window banner (open → "log in and vote", upcoming → times, ended → results finalised). No grouping by committee type. `/elections` has no default to the latest cycle. No archive list on the detail page. |
| emi-calculator.php | `/emi-calculator` | PARTIAL | P2 | No loan-type presets, no years/months toggle, no sliders, no yearly-summary toggle, no print, no principal/interest bar, no tips. |
| date-converter.php | `/date-converter` | PARTIAL | P3 | The BS date is free text (PHP: year/month/day dropdowns). No weekday in the result. |
| sahakari-patro.php / sahakari-calendar-events-tables.php | `/calendar` | PARTIAL | **P1** (bug) / P2 | **Bug: `recurrence='monthly'` events never show** (N query `bs_month = $1`, but monthly rows have `bs_month` NULL). Missing: national festival and holiday list (PHP 2082-2084), holiday colouring, tithi/panchanga, selected-day panel, next-month mini calendar, AD month range in the header. Rashifal, lagna and gunmilan tabs (P3, optional). |
| exchange-rate.php / nrb-forex-fetch.php | `/exchange-rate`, `src/lib/exchange-rate.js` | DONE | P3 | Cache is in memory only (lost on restart). PHP keeps a per-day file cache and uses the newest old file as a fallback. |
| faqs.php | `/faqs` | DONE (better: FAQPage JSON-LD) | – | |
| important-links.php | `/important-links` | DONE | – | |
| page.php | `/page/:slug` | PARTIAL | P2 | No auto-seeded privacy, terms and cookie pages. `?id=` not supported (X6). No featured image or tags if those columns exist. Not-found returns a generic 404 (fine). |
| contact.php / google-map-embed.php | `/contact` | PARTIAL | **P1** | **The map never shows for migrated sites** (`google_map_url` is not used, `map_lat`/`map_lng` are not used, share links are not normalised). Not shown: `mobile`, e-banking, appointment/loan/grievance link cards. |
| sitemap.php | `/sitemap.xml` | PARTIAL | P2 | Missing: `lastmod`, `changefreq`, `priority`, careers ids, and most static pages (vision, messages, success stories, service centres, gallery, partners, calendar, exchange, date converter, elections, auctions, institutional profile, programmes, digital services, awards, important links, committees). |
| robots.php | `/robots.txt` | PARTIAL | P2 | No Disallow for `/track`, `/verify`, `/attend`, `/apply/kyc`, `/apply/survey`, `/member`, `/platform`, `/api/`. No `Allow: /`. No `Cache-Control`. |
| manifest.php / pwa-icon.php | `/manifest.webmanifest` | PARTIAL | P2 | One icon with a hard-coded `512x512` size (often wrong; SVG or JPEG logos break install). No 192 or maskable icon. No `pwa_app_name`, `description`, `id`, `shortcuts`, `categories`. No resized-icon endpoint. Legacy `/manifest.json` is not served. |
| sw.js | `public/sw.js` | DONE | – | N is simpler and safe. PHP also cached member pages offline (member slice). |
| offline.php | `/offline` | DONE | – | |
| share-og.php | `/share-og.svg` | PARTIAL | P2 | **SVG og:image is ignored by Facebook and WhatsApp.** PHP renders a PNG. N falls back to the SVG whenever the logo is not raster. |
| 404.php / 500.php | `views/public/error.ejs` | PARTIAL | P3 | No suggested-links grid on the 404 page. The 404 title is always English ("Not found"). |
| cooperative-programs.php | `/programs` | PARTIAL | P2 | No public pre-registration with membership number and KYM-approved check (N requires a member login). No upcoming/past tabs. No stats band. No "how it works" (pre-register → QR at venue → count). |
| api-ai-chat.php / ai-chat-*.php | `POST /api/chat`, `src/lib/ai-chat.js` | PARTIAL | P2 | No **sensitive-question refusal**, no jailbreak detection, no output leak and prompt-leak post-check, no secret redaction. No instant answers (CEO, chairman, rates, member count). No retrieval scored against the question (N sends a fixed context). No suggested links. X2 key names and encrypted key. |
| api-public-chat.php | – | MISSING | P3 | |
| router.php / .htaccess | `legacy-urls.js`, Express | PARTIAL | P1 | X6. Also not mapped: extensionless legacy URLs (`/contact` works; `/news-detail?id=5`, `/career`, `/auction`, `/sahakari-patro`, `/election-information`, `/cooperative-programs`, `/chairman-message`, `/ceo-message`, `/why-choose`, `/team?menu=…` partly) because `.htaccess` served them without `.php`. **Pretty PHP URLs without `.php` 404 in N.** |
| simple-cache.php | ad-hoc Map caches | PARTIAL | P3 | X10 |
| coop-terms.php (KYM wording) | nav says "Online KYC" | PARTIAL | P3 | Cooperatives use **KYM / केवाइएम** (regulator wording). |
| nepali-bs-convert.php / coop-date-ui.php | `src/lib/nepali-date.js` | DONE | – | |
| assets/js/main.js (popup carousel, page loader, back-to-top, counters) | `public/js/app.js` | PARTIAL | – | See X7. |
| assets/js/scroll-accessibility.js (voice, camera and tilt scroll), pull-to-refresh, v9-mobile-fix | – | MISSING | P3 | Optional. The mobile nav works but expands every dropdown. |
| assets/js/modal-focus-trap.js, coop-a11y.js | partial | PARTIAL | P3 | The popup modal has no focus trap. |
| SEO: canonical, hreflang, JSON-LD, titles, descriptions | `src/lib/seo.js` | DONE (better) | – | |

---

## (b) Implementation specs (PARTIAL and MISSING items, by priority)

### P1-1 Treat BS dates stored in DATE columns as BS (X1)

**PHP:** `includes/config.php:636-660` (`coop_notice_date_bs`, `coop_notice_date_ad`) and `includes/careers-tables.php:25-55` (`careerDeadlineAd`, `careerDeadlinePassed`).

**Rule:** for a `YYYY-MM-DD` value whose year is ≥ 2070, the value is BS. Display it as is; convert it to AD for comparisons and ordering.

**Node:**
1. In `src/lib/nepali-date.js` add:
   - `isBsLike(ymd)`: year ≥ 2070.
   - `toAd(ymd)`: `isBsLike ? bsToAd(ymd) : ymd`.
   - `toBs(ymd)`: `isBsLike ? ymd : adToBs(ymd)`.
2. In `src/app.js` (`setLang`), change `bsDate` so it uses `nd.toBs(...)` instead of `nd.adToBs(...)`. Every view picks this up.
3. Views that call `nd.adToBs(n.notice_date …)` directly (`home.ejs` notice chips, `notices.ejs`) should switch to `nd.toBs`.
4. `views/public/careers.ejs` and `src/routes/public.js` (`/careers`, `/careers/:id`): compute `open` from `nd.toAd(j.deadline) >= today`. The SQL ordering `(deadline >= CURRENT_DATE)` is wrong for BS rows; sort in JS after loading, or apply step 6.
5. `/notices`: order by `id DESC` (PHP `notices.php:38`), or by the normalised date.
6. **Preferred one-off fix:** migration `060_bs_dates_normalise.sql` cannot convert BS dates in SQL. Instead, add a step to `src/lib/site-migration.js` (after import) that rewrites `notices.notice_date`, `careers.deadline`, `auction_notices.auction_date`, `election_milestones.event_date` and `upcoming_programs.event_date` where `EXTRACT(year) >= 2070`, using `nd.bsToAd`. Also run it once for already-imported tenants (`npm run` script `scripts/normalise-bs-dates.js`). Keep the display fallback (steps 1-3) anyway, because admins may type BS dates again. Better still, make the admin date fields accept BS and convert them (admin slice).

### P1-2 Legacy setting keys (X2)

**Node:** in `src/lib/settings.js` `all()`, after loading, fill these aliases when the Node key is empty (a read-time fallback that never overwrites):
```
site_tagline        ← site_slogan            (and site_tagline_en ← site_slogan_en)
ai_enabled          ← ai_chat_enabled
ai_welcome          ← ai_welcome_np          (add ai_welcome_en usage in layout for lang=en)
logo                ← site_logo
map_embed_url       ← normalizeMapUrl(google_map_url) || (map_lat&&map_lng ? `https://www.google.com/maps?q=${lat},${lng}&output=embed` : '')
```
Also use per-language keys in `views/layouts/public.ejs`: `logo_en` when lang is `en`, otherwise `logo_np`, otherwise `logo`; `<link rel=icon>` uses `site_favicon || logo`.

**AI key:** in `src/lib/ai-chat.js`, if `ai_api_key` starts with `enc:v1:`, decrypt it with the same routine `src/lib/credentials-crypto.js` uses for PHP credentials (`CREDENTIALS_LEGACY_KEY`, `iv:cipher` AES-256-CBC as in PHP `includes/credentials-crypto.php`). On the next admin save, re-store it as plain text or under Node's secretbox.

**Seed** the missing keys for new tenants (so they appear in Admin → Settings). Add migration `060_public_settings.sql`:
```sql
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
('site_slogan_en','','text','Slogan (English)','general'),
('mobile','','text','Mobile','contact'),
('google_map_url','','url','Google Maps link (any share link)','contact'),
('map_lat','','text','Map latitude','contact'),('map_lng','','text','Map longitude','contact'),
('twitter_url','','url','X / Twitter','social'),('web_login_url','','url','Web login URL','apps'),
('mobile_app_photo','','image','Mobile app screenshot','apps'),
('vision_content_en','','textarea','Vision (English)','about'),('mission_content_en','','textarea','Mission (English)','about'),
('vision_content_title_np','हाम्रो दृष्टिकोण','text','Vision title (NP)','about'),('vision_content_title_en','Our Vision','text','Vision title (EN)','about'),
('mission_content_title_np','हाम्रो लक्ष्य','text','Mission title (NP)','about'),('mission_content_title_en','Our Mission','text','Mission title (EN)','about'),
('values_content_np','','textarea','Core values (NP)','about'),('values_content_en','','textarea','Core values (EN)','about'),
('values_content_title_np','हाम्रो मूल मान्यताहरू','text','Values title (NP)','about'),('values_content_title_en','Our Core Values','text','Values title (EN)','about'),
('history_content_np','','textarea','History (NP)','about'),('history_content_en','','textarea','History (EN)','about'),
('about_page_image','','image','About page image','about'),
('hero_title','','text','Home hero title (no slides)','general'),('hero_subtitle','','text','Home hero subtitle','general'),
('total_members','','text','Members (about stats)','about'),('years_experience','','text','Years of service','about'),
('total_services','','text','Number of services','about'),('satisfaction_rate','','text','Satisfaction %','about'),
('supported_name','','text','Supported by (name)','general'),('supported_url','','url','Supported by (URL)','general'),
('pwa_app_name','','text','App name (PWA)','general'),('pwa_short_name','','text','App short name (PWA)','general'),
('logo_np','','image','Logo (Nepali)','general'),('logo_en','','image','Logo (English)','general'),('site_favicon','','image','Favicon','general'),
('ai_welcome_en','','text','AI welcome (English)','ai')
ON CONFLICT (setting_key) DO NOTHING;
```
Add the image keys to the upload whitelist in `src/routes/admin.js:378` (`file_about_page_image`, `file_mobile_app_photo`, `file_logo_np`, `file_logo_en`, `file_site_favicon`).

### P1-3 About page (X3 and more)

**PHP:** `about.php`. Body from `pages` slug `about` (lines 35, 117-150; `content_np` for NP, `content` for EN). Image: `about_intro_image` → `about_page_image` → `history_photo` (66-95). History section `#history` (170-245: `history_content_np/en`, `history_photo`, `established_year` badge). "More about us" cards (270-325): chairman and CEO (only when a message exists), vision/mission, institutional profile, why choose, success stories. Values (328-375: title from `values_content_title_*`, four fixed cards: Integrity, Transparency, Cooperation, Excellence). Board org chart `#board` (376-400, `team_members.category='board'`). Stats band (401-430: `total_members`, `years_experience`, `total_services`, `satisfaction_rate`). Hash redirects (52-60).

**Node:**
- `src/routes/public.js` `/about`: also load `db.one("SELECT * FROM pages WHERE slug='about' AND is_active=1 ORDER BY id DESC LIMIT 1")` and `board = db.many("SELECT * FROM team_members WHERE category='board' AND is_active=1 ORDER BY display_order")`.
- `views/public/about.ejs`:
  - Intro: `aboutPage ? richText(f(aboutPage,'content')) : settings.about_content || about_short`. Note PHP stores the English body in `content` and the Nepali body in `content_np`; `f()` already handles that.
  - Side image: `about_intro_image || about_page_image || history_photo`.
  - Section `#history` when `history_content_*` is set.
  - Section `#values`: render `values_content_*` when set, otherwise the four default cards.
  - Section `#board`: reuse the team org-chart partial (`teamLib.chartRows(board)` and the same markup as `team.ejs`).
  - Stats band when any of the four settings is set.
  - Link-cards grid (show chairman and CEO only when the message settings are non-empty).
- `public/js/app.js`: on `/about`, a hash of `#success-stories`/`#success` → `/success-stories`, `#chairman*` → `/message/chairman`, `#ceo*` → `/message/ceo`, `#vision|#mission` → `/vision-mission`, `#why-choose|#why-us` → `/about#why`.

### P1-4 Vision and mission: English text and titles

**PHP:** `vision-mission.php:6-9, 50-75`.

**Node:** `src/routes/public.js:94-102`: use `en ? (s.vision_content_en || s.vision_content_np || s.vision_content) : (s.vision_content_np || s.vision_content || s.vision_content_en)`, and the same for mission and values. Card titles come from `vision_content_title_np/en`, `mission_content_title_np/en`, `values_content_title_np/en`, with the current defaults as fallback. Use the same titles in the nav labels (`navigation.js`), as PHP does (`header.php:55-58`).

### P1-5 Missing `institutional_profile` columns and page parity (X4)

**Migration `061_institutional_profile_parity.sql`:**
```sql
ALTER TABLE institutional_profile
  ADD COLUMN IF NOT EXISTS report_date_bs VARCHAR(60) DEFAULT '',
  ADD COLUMN IF NOT EXISTS report_date_ad DATE NULL,
  ADD COLUMN IF NOT EXISTS total_balance_member INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_capital_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_fund DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_fund_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_loan_reserve_fund DECIMAL(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_loan_reserve_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS npl_percent DECIMAL(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liquidity_percent DECIMAL(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_profit DECIMAL(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS report_note TEXT NULL;
```
Also add these fields to the admin resource for `institutional_profile` in `src/modules/resources.js`. Tenants imported earlier must re-run the import for this table.

**Page (`institutional-profile.php`):**
- Month cards (440-545) show: members (+active `total_balance_member`), share capital (+`share_capital_percent` growth), reserve fund (+%), institutional capital = reserve + other fund, other funds, deposits (+%), loan investment (+%, `total_loan_members` borrowers), liquidity (`bank_cash_balance`), fixed assets, total assets, plus the welfare table.
- Filters (348-420): FY select, month select (0 = annual), search box, "Latest 2 / All / This month / Previous" chips. The default view shows the latest 2.
- Charts (318-345, 1321-1430): deposit, loan and assets lines plus a members line, from up to 12 points, needing at least 2 points.
- Printable poster (660-720, 1200-1300).

In `views/public/institutional-profile.ejs`:
1. Replace the history table with month cards that show the fields above. Show the `%` as a green "growth" chip.
2. Add GET filters `?fy=&month=` (server-side is fine, no JS needed). Default to the latest 2 rows; `?all=1` shows all.
3. Charts: use the existing dependency-free `views/partials/chart.ejs` with `kind:'line'`. One chart for deposit/loan/assets (if the partial supports only one series, render three small charts) and one for members. Build the series from `rows` (oldest → newest, at most 12, label `FY·month`).
4. Print: add a `data-print` button plus `@media print` CSS that hides the nav, filters and footer.
5. Access: in the route, replace `req.member ? '' : "AND access_level='none'"` with `memberAccess.unlocked(req)`. Show the same unlock form as `/reports` (reuse the `POST /reports/unlock` handler, generalised to accept `next` via `auth.safeNext`). In `/institutional-profile/:id/file`, use `memberAccess.canOpen(req, row.access_level)` instead of member/admin only.

### P1-6 Reports: type, year and month filters, grouping, view-only (X5)

**PHP:** `reports.php:104-232` (types `monthly, quarterly, progress, annual, financial, audit, agm, other`; filters `type`, `year`, `month`; grouping by type and then `report_year`; labels at 196-230), actions 234-405 (view, download, share; member lock), and `report-file.php`.

**Migration (`061`):** `ALTER TABLE reports ADD COLUMN IF NOT EXISTS view_only SMALLINT NOT NULL DEFAULT 0;`. Add a `view_only` bool field to the `reports` admin resource.

**Route `/reports`** (`src/routes/public.js:255`):
- `type`: allow-list as above. `year`: `^[0-9/]{4,9}$`. `month`: `1-12`, applied only when `type=monthly`.
- `years = SELECT DISTINCT report_year … ORDER BY 1 DESC`.
- `?id=N`: load that row for the OG title, description and `ogImage`. If it is members-only, use the description "Members-only report — open and enter membership number + mobile". Scroll to `#r<ID>`.

**View:** tab bar for the types (only those with rows, plus "All"), a year `<select data-autosubmit>`, and a month select when `type=monthly`. Groups get `<h2>` with the translated type label and `<h3>` "आर्थिक वर्ष {year}". Card meta shows the translated type, "आ.व./FY {year}", and the BS month name (`nd.MONTHS_NP[report_month-1]`). Actions:
- View: `/reports/:id/file`, inline.
- Download: `/reports/:id/file?dl=1`, hidden when `view_only`.
- Share: a `data-share` button using the Web Share API, falling back to copying the link `/reports?id=:id`. Hidden when `view_only`, and hidden while the report is locked.

**`/reports/:id/file`:**
- `dl=1` → `Content-Disposition: attachment`, otherwise `inline`. When `view_only` and `dl=1` and the user is not an admin → 403 "Download is disabled for this report."
- `sendStored` needs an option for the disposition.
- Optional, P2: a signed short-lived `?t=` token (HMAC of id + expiry with the tenant secret, 10 minutes) appended to the unlocked links, so the Facebook in-app browser (which drops cookies) can open a members-only report (PHP `coopMemberAccessCheckFileToken`).

### P1-7 Legacy URL coverage (X6 and router.php/.htaccess)

In `src/lib/legacy-urls.js`:
- `report-file.php`: `q => id(q.id) ? '/reports/' + id(q.id) + '/file' + (q.dl === '1' ? '?dl=1' : '') : '/reports'`
- `institutional-profile-file.php`: `q => id(q.id) ? '/institutional-profile/' + id(q.id) + '/file' : '/institutional-profile'`
- `information-room-file.php`: `q => id(q.id) ? '/member/information-room/' + id(q.id) : '/member/information-room'`
- `page.php`: also handle `id` by redirecting to `/page/by-id/:id`. Add the route `GET /page/by-id/:id`, which looks up the slug and 301-redirects to `/page/:slug`.
- `reports.php`: keep `type`, `year`, `month` and `id`.
- `awards.php`: `/awards` + `?id=`.
- `committees.php`: `id|type`, `tenure` → `/committees/:id?tenure=`.
- `gallery.php`: pass `type`, `category`, `page`, and a non-numeric `album`.
- `team.php`: pass `menu`, `item`, `cmt`, `tenure`.
- `services.php`: keep the fragment (browsers keep it across a 301).
- `career-detail.php`: already handled.
- `why-choose.php` → `/about#why`.
- `search.php` → `/search?q=` (once P2-search exists), else `/`.
- **Extensionless legacy paths:** PHP served `/news-detail`, `/career`, `/auction`, `/sahakari-patro`, `/election-information`, `/cooperative-programs`, `/chairman-message`, `/ceo-message`, `/why-choose`, `/online-kyc`, `/loan-apply` and so on (via `.htaccess:70-80` and `router.php:72-76`). Change `target()` so that `/([a-z0-9_-]+)(\.php)?$` matches: if `name + '.php'` is a key in the map and the path is not already a Node route, redirect. Safe approach: apply the extensionless form only for names that are not Node routes (`about`, `services`, `contact`, `faqs`, `team` and so on are already Node routes and must be skipped). Build the set as `Object.keys(PUBLIC).map(k => k.replace('.php',''))` minus a list of names that are already valid Node paths.
- Also redirect `/manifest.json` → `/manifest.webmanifest`.

### P1-8 Notice popup on every page, as a carousel (X7)

**PHP:** `includes/header.php:1905-2140`, `assets/js/main.js` (popup V3). Query: `SELECT * FROM notices WHERE is_popup=1 AND is_active=1 AND (popup_expires_at IS NULL OR popup_expires_at >= today) ORDER BY id DESC LIMIT 5`, cached 90 s. "Seen" is stored per browser session.

**Node:**
- Move the popup query out of `GET /` into a cached middleware in `src/routes/public.js`, next to `widgetCache` (same 30 s TTL, per schema), and set `res.locals.popups` (up to 5 rows; add `AND deleted_at IS NULL`).
- Move the modal markup from `home.ejs` into a new partial `views/partials/notice-popup.ejs`, included from `layouts/public.ejs`.
- Each slide shows: badge "महत्त्वपूर्ण सूचना / Important notice", title, a "View full notice" button when there is an `attachment` (icon by `.pdf` or image), an inline image (`popup_image`, or an image `attachment`), and `richText(content)` unless `popup_photo_only`. With `popup_photo_only`, the image alone links to the attachment.
- Controls: prev/next, dots, auto-rotate every 6 s (paused on hover and under `prefers-reduced-motion`), a progress bar.
- `public/js/app.js`: extend the existing `[data-popup]` code to handle `[data-popup-slide]`. The sessionStorage key is `popup-seen-` plus the joined ids (PHP `data-notice-ids`).
- Add a focus trap (Tab cycles inside the dialog, focus returns on close), as in PHP `assets/js/modal-focus-trap.js`.
- Do not show it on `/apply/*` form pages (avoids interrupting the forms) or on `/offline`.

### P1-9 Home page: missing sections

**PHP:** `index.php:10-130` (data), sections at 196-1290.

**Route `GET /`** (`src/routes/public.js:68`): add these queries to the `Promise.all`:
```js
db.many(`SELECT * FROM team_members WHERE is_active=1 AND (is_information_officer=1 OR is_grievance_officer=1 OR is_chairman=1 OR is_ceo=1) ORDER BY display_order, id LIMIT 8`),
db.many(`SELECT * FROM app_features WHERE is_active=1 ORDER BY sort_order, id LIMIT 24`),
db.many(`SELECT * FROM awards WHERE is_active=1 ORDER BY display_order, award_date DESC NULLS LAST LIMIT 3`),
db.value(`SELECT count(*) FROM awards WHERE is_active=1`),
db.one(`SELECT * FROM member_of_year WHERE is_active=1 AND spotlight_year = $1 LIMIT 1`, [String(new Date().getFullYear())]),
db.one(`SELECT id FROM reports WHERE is_active=1 AND report_type='monthly' ORDER BY report_year DESC NULLS LAST, created_at DESC LIMIT 1`),
db.one(`SELECT id FROM reports WHERE is_active=1 AND report_type='annual' ORDER BY report_year DESC NULLS LAST, created_at DESC LIMIT 1`),
db.value(`SELECT count(*) FROM services WHERE is_active=1`),
```
Also fall back to the spotlight with the BS year if there is no AD match: `spotlight_year IN ($ad, $bs)`, where `$bs` is the first four characters of `nd.todayBs()`. PHP used only the AD year; many co-ops type BS years.

Drop the unused `links` query (`satisfaction_links`), which is fetched but never rendered. Wrap the whole home payload in a per-schema 60 s cache (X10). Invalidate it on admin saves of the involved tables if there is a hook; otherwise rely on the short TTL.

**`views/public/home.ejs`, new sections (order as in PHP):**
1. **Hero slides:** render `button_text` (strip surrounding quote characters, PHP 210-217) linking to `button_url`, sanitised (allow `https?://` or `/path`, else `#`). Raise `LIMIT 6` to 12. When there are no slides, use `settings.hero_title || siteName` and `hero_subtitle`.
2. **Institutional profile bar** under the hero stats: links "संस्थागत प्रोफाइल" `/institutional-profile`, "मासिक प्रतिवेदन" `/reports?type=monthly`, "वार्षिक प्रतिवेदन" `/reports?type=annual`, "सबै प्रतिवेदन" `/reports`, each with a "नयाँ/Latest" badge when the matching row exists. Label the stats "आ.व. {fiscal_year} · {BS month}", plus "View charts & full profile →".
3. **Leadership** (`index.php:860-990`): show when the chairman message, CEO message, information officer or grievance officer exists.
   - Chairman card: photo, name, "अध्यक्ष", "थप विवरण" → `/message/chairman`. Data from the settings first, then `is_chairman` (reuse the `/message/:who` logic: extract a helper `leadership(who, settings, people, lang)` into `src/lib/team.js` and call it from both routes).
   - CEO card: same pattern; the designation from `ceo_designation_*` or the member's `position_*`.
   - Information officer: photo, name, phone (`tel:`), email (`mailto:`) → `/team#contact-officers`.
   - Grievance officer: same fields, and the button "गुनासो दर्ता" → `/apply/grievance`.
4. **Mobile app** (`index.php:990-1040`): show when `play_store_url` or `app_store_url` is set. Heading "आफ्नो डिजिटल भुक्तानी व्यवस्थापन गर्नुहोस् / Manage your Digital Payments", Google Play and App Store badges, and `mobile_app_photo` on the right.
5. **App features** (1040-1080): a grid of the first 8 `app_features` (title, `is_new` badge, a `<details>` with the description). The rest go behind a `<details>` "थप हेर्नुहोस्" (no JS needed). Button "सबै सेवाहरू" → `/digital-services`.
6. **Awards** (1080-1125): show when present. Three cards (image, title, awarded_by, `bsDate(award_date)`, description teaser of 110 characters plus "थप पढ्नुहोस्" → `/awards/:id`), and "View all awards" when the total is more than 3.
7. **Member of the year** (1127-1255): show when present. Photo or placeholder, year badge, "वर्षको सदस्य", name (`member_name_en` in EN), `member_since`, `member_id`, `achievement`, and `quote` as a blockquote.
8. **Quick links:** add `/exchange-rate`, `/date-converter`, `/downloads`, `/digital-services`, `/apply/welfare`, `/apply/grievance` and `/auctions`, grouped "अनलाइन फारम / टुल्स / सदस्य सेवा" as in `index.php:420-500`, or simply add them to the existing grid. Respect `plan.allows`.
9. Services: use `services.icon` when it maps to a known icon. Add a small helper in `src/lib/icons.js` mapping Font Awesome or Lucide names to the closest built-in icon.

### P1-10 Contact map (X2)

**PHP:** `contact.php:363-400`, `includes/google-map-embed.php:79-146` (`normalizeGoogleMapEmbedUrl`; `resolveHttpRedirectUrl` follows up to 6 redirects for `maps.app.goo.gl`).

**Node:**
- New `src/lib/maps.js` exporting `toEmbed(raw)`, ported rule for rule:
  1. A pasted `<iframe src>` → take the `src`.
  2. Already `/maps/embed` or `output=embed` → return as is.
  3. `!3dLAT!4dLNG` → `https://www.google.com/maps?q=LAT,LNG&z=17&output=embed`.
  4. `@lat,lng,zoomz` → the same with the zoom.
  5. `?q=` → `…?q=…&output=embed`.
  6. `/maps/place/NAME` → `?q=NAME`.
  7. Any other generic Google Maps URL → append `output=embed`.
  8. Short links: resolve them when the admin saves. In the admin settings POST, if the key is `google_map_url` and the host is `maps.app.goo.gl`, do a `fetch(url, {redirect:'manual'})` loop (6 hops, HTTPS only, 5 s timeout) and store the resolved URL. Never fetch at render time.
- In `views/public/contact.ejs`, the embed URL is `settings.map_embed_url || maps.toEmbed(settings.google_map_url) || (lat&&lng ? …)`. Validate the result against `^https://(www\.)?google\.[a-z.]+/maps` (the CSP `frame-src` already allows `www.google.com` and `maps.google.com`). Otherwise show an "Open in Google Maps" button linking to `google_map_url`.
- Also show `settings.mobile` and quick cards: internet banking (`internet_banking_url`), appointment, loan and grievance links, as in `contact.php:190-250`.

### P1-11 Calendar: monthly recurring events bug, and festivals

**Bug:** `src/routes/public.js:399` uses `bs_month = $1 AND (bs_year = $2 OR …)`. PHP `includes/sahakari-calendar-events-tables.php:98-140` applies an event to the requested month when `recurrence='monthly'` (any month of that `bs_year`, if `bs_day ≤ days in month`) or when `bs_month = month`; everything is scoped to `bs_year`.

Fix:
```sql
SELECT * FROM sahakari_calendar_events WHERE is_active=1
  AND (bs_year = $2 OR recurrence = 'yearly')
  AND (recurrence = 'monthly' OR bs_month = $1)
  AND bs_day <= $3            -- days in month from nd.monthLengths(y)[m-1]
ORDER BY bs_day
```

**Festivals and holidays (P2):** PHP `sahakari-patro.php:170-212` has a built-in map for 2082-2084: `'Y-M-D' => [{name, type:'holiday'|'festival'}]`. Port it to `src/lib/nepal-holidays.json` as `{ "2082-1-1": [["नेपाली नयाँ वर्ष","Nepali New Year","holiday"]], … }` and merge it into the grid.
- In `views/public/calendar.ejs`, give the cell class `is-holiday` (red date) for `holiday` and Saturdays, `is-festival` (orange), and `is-coop` (brand) for co-op events.
- Add the AD month range in the header (`Apr 2026 – May 2026`).
- Add a "selected day" panel: `?d=`, listing the day's events and its AD date.
- Add a next-month mini list of events.
- Keep `MIN_YEAR`/`MAX_YEAR` bounds on prev/next.
- Tithi/panchanga (PHP `sp_panchanga`, lines 112-160, astronomical approximation) is P3/optional. Rashifal, lagna, gunmilan and muhurta tabs are P3; recommend not porting them.

### P1-12 Notices detail

**PHP:** `notices.php:140-195`. When the attachment is an image, show it inline above the button. The button "पूरा सूचना हेर्नुहोस् / View full notice" uses an icon by type. When the attachment file is missing on disk, show "Attached file is not available".

**Node:** in `views/public/article.ejs`, when `attachment` matches `/\.(jpe?g|png|webp|gif)$/i`, render `<img>` inline. The button label is "पूरा सूचना हेर्नुहोस्" for notices. Also render `popup_image` (already done as `image`).

---

### P2-1 Header: login dropdown, bell, ticker, nav fixes

**PHP:** `includes/header.php:815-1160` (topbar), `1190-1415` (nav), `78-123` (bell), `1905-1990` (ticker).

**Node (`views/layouts/public.ejs` and a new `views/partials/header-extras.ejs`):**
- **Login dropdown** (`<details>` menu): "इ‑बैंकिङ लगिन" (`internet_banking_url`), "वेब लगिन" (`web_login_url`), "मोबाइल एप (Android)" (`play_store_url`), "(iOS)" (`app_store_url`), divider, "सदस्य लगिन" (or "My account" plus an unread badge; `notifications` count for `req.member`, cached per request), divider, "सदस्य कार्ड प्रमाणीकरण" `/verify`, "कार्यालय लगिन" `/admin`. Show only the external links whose URL is set. Use the same `safeUrl` check as the slider CTA.
- **Bell:** a cached middleware (90 s) loads `SELECT id,title,title_np,notice_date,attachment,created_at FROM notices WHERE is_active=1 AND deleted_at IS NULL ORDER BY id DESC LIMIT 6`. The badge counts items with `created_at` in the last 30 days (PHP falls back to `min(count,2)`). Dropdown items show the title (70 characters), BS date, a paperclip when there is an attachment, a "नयाँ" dot on the first 3, and a footer link "सबै सूचना हेर्नुहोस्".
- **Ticker:** a bar under the header with the latest 10 notice titles linking to `/notices/:id`. CSS marquee animation, paused on hover; hidden under `prefers-reduced-motion` (show a static list instead). Add a setting `notice_ticker_enabled` (default 1) so tenants can turn it off.
- **Nav (`src/lib/navigation.js`):**
  - About menu: add `/success-stories` ("सदस्यको सफलताको कथा"), `/about#history`, `/about#values` and `/about#why` ("किन हामीलाई छान्ने?"). Use the `vision_content_title_*` labels.
  - Services menu: build it from `service_categories` (active, with active services). Each category is a sub-heading with up to 8 services linking to `/services/:id`. Render as nested groups in the dropdown, or flat with headings.
  - Elections: show only when `SELECT 1 FROM election_cycles WHERE is_published=1 AND show_in_navbar=1` exists (cache in `build()`).
  - "Careers" with a count badge of open jobs: `count(*) WHERE is_active=1 AND deleted_at IS NULL AND (deadline IS NULL OR deadline >= CURRENT_DATE)`, after X1 normalisation.
  - Rename "अनलाइन KYC / Online KYC" to "अनलाइन केवाइएम / Online KYM" (`coop-terms.php`). Apply the same in `home.ejs` and the forms slice.
- **Tagline:** `settings.site_tagline || (lang==='en' ? settings.site_slogan_en : settings.site_slogan)` (also covered by P1-2).

### P2-2 Site search

**PHP:** `includes/footer.php:496-570` (modal, voice mic via `webkitSpeechRecognition`, popular links), `assets/js/search-improved.js:42-69` (a static page index with NP/EN keywords). `search.php` does not exist, so the PHP search was purely client-side.

**Node (do better, server-side):**
- Route `GET /search?q=` in `src/routes/public.js`. `q` is 2-80 characters; escape `%`/`_` in `ILIKE`.
- Query (each `LIMIT 8`): `news` (title, title_np, content, content_np), `notices`, `pages` (title*, content*), `services` (title*, description*), `faqs` (question*, answer*), `downloads` (title*), `careers` (title*), `reports` (title*, public only), `team_members` (name, name_en, position*). Respect `is_active` and `deleted_at`.
- Add a static page index (port the 28 entries of `search-improved.js:42-69` to `src/lib/search-index.js`, mapped to the Node paths) matched on keywords (romanised Nepali included: `byaj`, `rin`, `bachat`, `suchana`, …).
- View `views/public/search.ejs`: results grouped by type.
- Header: a search icon opening a `<form action=/search>` in a `<dialog>`. Progressive enhancement: a mic button when `webkitSpeechRecognition` exists (`lang='ne-NP'`), filling the input and submitting.
- `robots.txt`: `Disallow: /search`.

### P2-3 Footer

**PHP:** `includes/footer.php:153-268`.

**Node (`layouts/public.ejs`):**
- Policy links row: `/page/privacy-policy`, `/page/terms-of-service`, `/page/cookie-policy`.
- **Auto-seed** these pages: port `page.php:22-58` (NP and EN bodies) into `src/lib/starter.js` or a migration `062_policy_pages.sql`:
  `INSERT INTO pages (slug,title,title_np,title_en,content,content_np,show_in_menu,menu_position,menu_order,is_active) SELECT … WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug=…)`. Replace the hard-coded "आकाश सहकारी" in the PHP text with neutral wording ("हाम्रो सहकारी / our cooperative").
- Contact: add `settings.mobile`. The about text uses `richText(about_short)`, as in PHP `coop_render_cms_prose`.
- "Supported by {supported_name}" (link when `supported_url` is set).
- Visitor stats (optional, P3): a small toggle showing totals from `visitor_stats` (sum of `visitor_count`, and today). Cache 120 s.

### P2-4 Chat widget without AI, plus AI safety

**PHP:** `includes/footer.php:308-372` (FAQ widget using `chatbot_faqs` with no AI; quick actions: appointment, account, grievance, tracker), `includes/ai-chat-helpers.php:165-295`, `includes/ai-chat-instant.php:197-358`, `includes/ai-chat-context.php:208-654`.

**Node:**
- Layout: show the chat when `ai_enabled==='1'` **or** there are active `chatbot_faqs`. Cache the count with the float widgets. When AI is off, `aiChat.reply` already answers from FAQs; add quick-action chips under the welcome message (`/apply/appointment`, `/apply/account`, `/apply/grievance`, `/track`).
- In `src/lib/ai-chat.js`, before anything else:
  - `isSensitive(message)`: port the regex from `ai-chat-helpers.php:167-186` (password, PIN, OTP, account balance, account number, citizenship number, and the Devanagari forms) and the jailbreak regex (`192-201`). On a match, return `sensitiveRefusal(lang)` (`205-235`, with links to `/member/login` and `/contact`) and `source: 'guard'`.
  - After the provider call: `answerLeaks(text)` (`237-253`: `sk-…`, `AIza…`, `enc:v1:`, "password is …", balance phrases) and `looksLikePromptLeak` (`255-270`). On a match, return the fallback.
  - `redactSecrets` on the context lines.
- Instant answers before the FAQ match (`ai-chat-instant.php:197-316`):
  - CEO/chairman question → name, phone, email and the `/message/ceo` link (reuse the P1-9 leadership helper).
  - "ब्याज/interest rate" → formatted saving and loan lists from `interest_rates`.
  - "कति सदस्य / how many members" → latest public `institutional_profile.total_members`.
- Context retrieval: score candidates (news, notices, pages, services, products, downloads, careers, faqs) by token overlap with the question, as in `ai_chat_collect_candidates`. Keep the top results within about 5,200 characters, instead of the current fixed dump.
- Return `links: []` (suggested page URLs) and render them as chips in `public/js/app.js`.
- Settings keys (X2): `ai_enabled ← ai_chat_enabled`; welcome per language (`ai_welcome_np`/`ai_welcome_en`).

### P2-5 Partner facilities page

**PHP:** `partner-facilities.php:20-420`; helpers `includes/partner-facilities-tables.php:145-180`.

**Node:** in `src/routes/public.js` `/partner-facilities`, read `type` (allow-list of the distinct `facility_type` values), `view=cards|table` and `q`. Sort by `is_featured DESC, display_order, partner_name`.

In `views/public/partners.ejs`:
- Intro "साझेदार संस्थामा सदस्यले पाउने सुविधाहरू" with CTAs: `/verify` "सदस्य कार्ड प्रमाणित", `/member/login`, `/apply/vendor` "साझेदार बन्नुहोस्".
- A 3-step "how it works".
- Featured strip: chips with name and discount for up to 8 featured partners, shown when no type is selected.
- Type pills with counts.
- A search input (server-side `q` across name, location, type, description and discount; JS can filter live).
- A cards/table toggle.
- Cards also show `contact_email`, `website_url` (validated `https?://`), `terms_np`, and the desk code `partner_code`.
- Discount display: `discount_label || (pct + '% छुट/off')` with trailing zeros trimmed.
- Empty state: "छिट्टै आउँदैछ" plus a vendor CTA.

### P2-6 Gallery

**PHP:** `gallery.php:11-140, 156-420`; `includes/gallery-albums.php:365-531`.

**Node:**
- In the route, read `type=photo|video`, `album` (an id, or a name/slug resolved against `gallery_albums.name_np/name_en`), `category` and `page`.
- Albums with cover and counts:
```sql
SELECT a.*, (SELECT count(*) FROM gallery g WHERE g.album_id=a.id AND g.is_active=1 AND g.deleted_at IS NULL AND g.media_type=$1) AS n,
 (SELECT COALESCE(g.thumbnail, g.image) FROM gallery g WHERE g.album_id=a.id AND g.is_active=1 AND g.media_type=$1 ORDER BY g.id DESC LIMIT 1) AS cover
FROM gallery_albums a WHERE a.is_active=1 ORDER BY display_order, id DESC
```
  Hide albums where `n = 0`.
- Photo pagination of 24, video pagination of 12 (reuse `listing()`).
- **YouTube:** derive the id with the regex at `gallery.php:334`; use the thumbnail `https://i.ytimg.com/vi/<id>/hqdefault.jpg` when `thumbnail` is empty. Play in a `<dialog>` with an iframe `https://www.youtube-nocookie.com/embed/<id>?autoplay=1` (already allowed in the CSP `frame-src`; add `https://i.ytimg.com` to `img-src` — `https:` is already allowed).
- **Lightbox:** a `<dialog>` with prev/next keys in `public/js/app.js` (`data-lightbox`), falling back to a plain link.
- Tabs "फोटो (n) / भिडियो (n)", album cover cards when no album is selected, and the grid when one is.
- Update the legacy mapping (P1-7).

### P2-7 Careers listing

**PHP:** `career.php:23-340`, `includes/careers-tables.php`.

**Node `views/public/careers.ejs`:**
- Search input and department pills: server-side GET `q` and `dept`. Status chips `open` (default) / `closed` / `all`.
- Per card:
  - "नयाँ" badge when `created_at` is within 7 days and the job is open.
  - "Urgent" when `daysLeft ≤ 7`.
  - Days-left text: "{n} दिन" or "म्याद सकियो".
  - Deadline progress bar: `width = daysLeft / totalDays`, where `totalDays` runs from `created_at` to the deadline.
  - Meta: department, location, `job_type` translated (`full_time` → "पूर्णकालीन"), vacancies, salary.
  - Apply button when open and `allow_online_apply`.
- Use `nd.toAd(deadline)` (X1). Order: open first by nearest deadline, then closed.

### P2-8 Elections page

**PHP:** `election-information.php:26-100, 170-360`.

**Node:**
- `/elections` with exactly one or more cycles: when a `?all` query is absent, redirect to the latest published cycle (`ORDER BY sort_order, date_from DESC`), as PHP did.
- `/elections/:id`: add a voting-window banner using `require('../lib/elections').windowState(cycle)`:
  - `open`: green; "मतदान अहिले खुला छ", button `/member/elections/:id`.
  - `upcoming`: amber; show `vote_start_at → vote_end_at` in BS with the time (NPT).
  - `ended`: grey; when `results_finalized`, add "नतिजा सदस्य पोर्टलमा उपलब्ध छ" (or link to public results if `resultsVisible`).
  - Otherwise, a scheduled window.
- Group positions by `committee_type_id` (join `committee_types`) under a sub-heading.
- Add the archive list of other published cycles at the bottom.

### P2-9 EMI calculator

**PHP:** `emi-calculator.php:22-31` (loan presets), `75-330` (UI), `368-560` (JS: years/months toggle, sliders, yearly table, print).

**Node:**
- Presets: instead of PHP's hard-coded list, use `interest_rates WHERE category='loan' AND is_active=1`. Buttons set `rate` (the server renders `<a href="?rate=..&amount=..&months=..">`; JS fills the input in place). If there are no rows, fall back to the PHP list.
- Add `unit=years|months` (years 1-30, months 1-360). Add `<input type=range>` next to each number input (sync in `public/js/app.js` `[data-emi]`).
- Principal/interest stacked bar (two `div`s with widths in %).
- Schedule: add a BS month label per row (start = next BS month from `nd.todayBs()`) and `?view=yearly`, which aggregates by 12 instalments.
- A print button (`data-print`) with print CSS.
- A tips box (longer tenure means a lower EMI and more interest).

### P2-10 Programmes: public pre-registration

**PHP:** `cooperative-programs.php:20-140` (POST `action=program_preregister`: membership no. plus phone → member must exist, be active and approved, with an approved KYC → insert `member_program_preregistrations` with `source='public_web'`; duplicate → `?dup=1`), `159-260` (tabs, stats, how-it-works).

**Node:**
- `POST /programs/:id/preregister` (CSRF, `submitLimiter`, `isBot`).
- Look up the member with `members WHERE (sadasyata_number=$1 OR member_card_no=$1) AND deleted_at IS NULL AND is_active=1 AND approval_status='approved'`, and match the last 8 digits of the phone (same as `/track/attachment`).
- Check the program: `is_active=1 AND pre_registration_open=1 AND (event_date IS NULL OR event_date >= CURRENT_DATE)`.
- `INSERT … ON CONFLICT (member_id, program_id) DO NOTHING` (unique index exists, `003_modules.sql:9`); flash "पहिले नै दर्ता" on a conflict.
- Program cards get an inline form with two inputs.
- Tabs `?tab=upcoming|past`; stats (upcoming count, open pre-registration count, past count); how-it-works steps (pre-register → scan QR at venue in the Member Portal → attendance counted).

### P2-11 Awards detail and success stories

- `/awards/:id` (PHP `awards.php:21-88`): a full view with image, title, awarded_by, BS date and `richText(f(a,'description'))`, plus OG image. The list gets a description teaser of 110 characters and a "read more" link.
- `views/public/stories.ejs`: add `member_since` ("सदस्य बनेको: …") and an "संस्थाले कसरी सहयोग गर्‍यो / How the cooperative helped" box from `institution_help_np/en` (PHP `success-stories.php:60-120`).

### P2-12 Committees

**PHP:** `committees.php:16-260`.

**Node `/committees/:id`:**
- When `tenures.length === 0`, load `team_members WHERE is_active=1 AND category = 'cmt_' || $id ORDER BY display_order` and render them as "हालको" (current).
- Render with `teamLib.chartRows()` (org chart) instead of a flat grid.
- Add a "विगतका समितिहरू" accordion of past tenures (`is_current=0`) with their members (one query, `tenure_id = ANY($1)`).
- Legacy `?type=`, `?tenure=` and `?past=1` mapping (P1-7).

### P2-13 PWA manifest and icons

**PHP:** `manifest.php`, `pwa-icon.php`, `includes/pwa-icons.php`.

**Node:**
- `GET /pwa-icon/:size.png` (sizes 72, 96, 128, 144, 152, 192, 384, 512; `?maskable=1`): `sharp` resizes `site_favicon || logo` to a square PNG on a white background. Maskable adds about 10 % padding on the brand colour. Cache the result to `uploads/<slug>/_cache/pwa-<size>[-m].png`, keyed by the logo's mtime; `Cache-Control: public, max-age=86400`. Without sharp, or when there is no logo, generate an SVG letter-mark rasterised by sharp, or 404.
- Manifest: `id:'/'`, `name: pwa_app_name || siteName`, `short_name: pwa_short_name || first 12 characters`, `description: meta_description`, `start_url:'/?source=pwa'`, `orientation:'any'`, `categories:['finance','business']`, icons 192/512 any plus a 512 maskable, and `shortcuts` (Services `/services`, Rates `/interest-rates`, Track `/track`, Contact `/contact`).
- `<link rel="apple-touch-icon" href="/pwa-icon/180.png">` in the layout.
- Route `/manifest.json` → the same handler.
- PWA install button: capture `beforeinstallprompt` in `app.js` and show the `[data-pwa-install]` button in the topbar.

### P2-14 Share image as PNG

**PHP:** `share-og.php` (GD PNG 1200×630).

**Node:** add `GET /share-og.png`. Render `seo.shareCardSvg(...)` to PNG via `sharp(Buffer.from(svg)).png()`; cache it per tenant to `uploads/<slug>/_cache/share-og.png`, keyed by a hash of the logo, name, colour and tagline. In `src/lib/seo.js` `shareImage()`, return `/share-og.png` when sharp is available (keep `/share-og.svg` as the fallback). Note: Devanagari text rendering needs a font available to librsvg; embed `public/fonts/noto-deva-500.woff2` via `@font-face` with a data URI in the SVG, or install `fonts-noto` in the Docker image.

### P2-15 Sitemap and robots

**Sitemap (PHP `sitemap.php`):** in `src/routes/public.js` `/sitemap.xml`:
- Static list with priority and changefreq: `/` 1.0 daily; about, services, interest-rates 0.9; contact, notices, news, careers 0.85; programs, service-centers, team 0.8; digital-services, elections, institutional-profile, message/chairman, message/ceo, success-stories, vision-mission, gallery 0.75; partner-facilities, committees, downloads, calendar 0.7; exchange-rate 0.65 daily; reports, auctions, awards 0.65; emi-calculator 0.6; date-converter, important-links 0.55; faqs 0.8; marketplace 0.7.
- Filter with `res.locals.plan.allows(path)`.
- Dynamic entries: news (`lastmod` = `updated_at || created_at`), notices (`lastmod` from `notice_date` via `nd.toAd`, else `created_at`), pages (`updated_at`), careers (`/careers/:id`, open and closed, last 80), `/auctions/:id`, `/elections/:id` (published), `/services/:id`.
- Emit `<lastmod>` as `YYYY-MM-DD`, plus `<changefreq>` and `<priority>`. `Cache-Control: public, max-age=3600`.

**Robots:** port `robots.php`. `User-agent: *`, `Allow: /`, `Disallow:` `/admin`, `/member`, `/platform`, `/api/`, `/track`, `/verify`, `/attend`, `/apply/kyc`, `/apply/survey`, `/search`, `/uploads/_private`, `/lang/`, `/theme`. Add the `Sitemap:` line and `Cache-Control: public, max-age=3600`.

### P2-16 Page view (`/page/:slug`)

- Description: `util.excerpt(content, 158)`, passed as `description`.
- If `pages.featured_image` or `meta_keywords` exist in the imported schema, add them (a migration `ADD COLUMN IF NOT EXISTS featured_image VARCHAR(255), meta_keywords VARCHAR(255)` is cheap). Render the image on top, tags at the bottom, and use the image as `ogImage`.
- `/page/by-id/:id` redirect (P1-7).
- Policy-page seeding (P2-3).

### P2-17 Institutional profile file and unlock

Covered in P1-5 step 5: `canOpen` plus the unlock form on `/institutional-profile`.

---

### P3 items (short specs)

- **Downloads:** map categories `general/forms/reports/policies/notices` to NP/EN labels (`downloads.php:42-48`); show `download_count`; file-type icons (pdf, doc, xls, image); group by category when no filter is applied.
- **News detail:** share buttons (Facebook `https://www.facebook.com/sharer/sharer.php?u=`, X intent, WhatsApp `https://wa.me/?text=`) plus a Web Share API button.
- **Auctions:** translate the status (`ongoing` चालु, `upcoming` आगामी, `completed` सम्पन्न, `cancelled` रद्द); add filter chips with counts (`auction.php:39-45, 185-225`) and hero stat counters.
- **Services:** a category jump-nav (`services.php:146-156`), category icon and description, the NEW badge if `services.is_new/new_until` exist (only when the column exists), and an `#anchor` id per card using `service_anchor_id` (saving/loan/remittance) so the old nav anchors work.
- **Service centres:** a role badge "प्रधान कार्यालय / सेवा केन्द्र" on every card; a subtitle in the other language.
- **Team:** contact officers include the chairman and CEO (PHP `team.php:616-755`); show the email on cards.
- **Date converter:** BS year, month and day `<select>`s (`nd.MIN_YEAR..MAX_YEAR`, days from `nd.monthLengths`); show the weekday and both formats; accept Nepali digits (`nd.toLatinDigits`).
- **Exchange rate:** persist the last good payload to `uploads/_shared/nrb-forex.json` (or a `platform.kv` table) so that a restart during an NRB outage still shows data; dedupe concurrent fetches with a shared promise.
- **404 page:** suggested-links grid (services, notices, interest rates, loan, contact, downloads) and a localised title ("पृष्ठ भेटिएन").
- **Header extras:** `himal_bg` decorative header image with opacity (`header.php:52-54`); nav count badges (`nav-menu-badges.php`).
- **Footer extras:** visitor counter; floating WhatsApp button; mobile bottom nav (Services, Notices, Contact) and a quick-actions FAB (`footer.php:986-1290`).
- **Live chat** (`api-public-chat.php`): optional. A small `<dialog>` form posting to `/contact` (subject `[Live Chat] name`) with the same spam guard and a rate limit of 5 per hour per IP.
- **Popup focus trap and a11y shim** (`modal-focus-trap.js`, `coop-a11y.js`): apply to the chat, popup and lightbox dialogs.
- **Home page cache** (X10): wrap the home `Promise.all` in a per-schema 60 s Map cache.
- **KYM wording** everywhere public (nav, home CTA "केवाइएम फारम भर्नुहोस्").
- **Scroll-accessibility** (voice, camera and tilt scrolling), pull-to-refresh, page loader: not recommended to port.
- **Sahakari patro** tithi/panchanga, rashifal, lagna, gunmilan and muhurta: optional, low value for a co-op site.

---

## Things the Node app already does better (keep them)

- SEO: canonical with a whitelist of parameters, hreflang, Organization, WebSite, Breadcrumb, FAQPage and NewsArticle JSON-LD, 70- and 158-character limits (`src/lib/seo.js`).
- Service detail pages (`/services/:id` with products); PHP only had anchors.
- Responsive AVIF/WebP `srcset` up to 8K; strict CSP; no inline scripts.
- Members-only reports moved into private storage on first access (`public.js:279-291`); a rate-limited unlock.
- Base-rate disclosure, payment channels, centre meetings, savings, FD and loan-eligibility tools, client protection (`src/routes/sector.js`): not in PHP.
- Interest-rate page with "last updated" and descriptions; FAQ page with structured data.
- The service worker never caches HTML, which avoids PHP's earlier stale-admin bugs.
