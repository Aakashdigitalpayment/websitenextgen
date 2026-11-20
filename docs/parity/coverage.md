# PHP → Node coverage matrix

File-by-file (and, for `includes/`, function-by-function) map of every file in the old PHP site to its Node equivalent.
Status: COVERED / PARTIAL / MISSING / NOT-NEEDED (with reason). Keep this up to date when a gap is closed (CLAUDE.md §1).

- Part A: root pages, `member/`, `includes/`, `core/`, `assets/js`, `.htaccess`, `sw.js`
- Part B: `admin/`, `scripts/`, `database/install.sql` (tables and columns), installer and cron

---

# Part A


PHP source: `/home/user/websourcecode` (v7.0). Node: `/home/user/websitenextgen` @ `claude/tender-ramanujan-e5xzgu` (d5b8018).
Method: every file below was checked against the Node code that implements it (route + lib + view), not by name. Items already
recorded as deliberately skipped in `docs/parity/*.md` (HRM, temp passwords, installer, PHP-only plumbing) are NOT-NEEDED.
Status: **COVERED** = parity or better · **PARTIAL** = exists, named logic missing · **MISSING** = nothing in Node · **NOT-NEEDED** = replaced by the platform / PHP plumbing / dead code.
`SM-n` refers to the consolidated "Still missing" list at the end.


**Totals (rows):** COVERED 210 · PARTIAL 29 · MISSING 1 · NOT-NEEDED 24 (+1 mixed core row). Root 76 rows (59/14/0/3), member/ 35 (29/5/0/1), core 10, config.php groups 28 (25/1/0/2), includes 101 files / 946 functions (80/9/0/12 files), assets/js 15 (11/0/1/3).
Top gaps: SM-1 derived-CVV card verification, SM-2 `/assets/uploads` legacy URLs, SM-3 gated upload folders left public after migration (all P1).

## 1. Repository root `*.php` (+ sw.js, .htaccess, router.php, version.txt)

| PHP file | Node equivalent (route · src · view) | Status | Notes / gap |
|---|---|---|---|
| 404.php | app.js 404 handler · views/public/error.ejs (localised, search, suggested links) | COVERED | commit 3bd662c |
| 500.php | app.js error handler · lib/error-log.js · public/error.ejs | COVERED | |
| _bootstrap.php | app.js middleware (helmet headers, session, tenant settings, license guard, lang) | COVERED | security headers, licence public guard, error handler all in app.js |
| about.php | GET /about · public.js:132 · public/about.ejs | COVERED | pages slug=about, history, values, org chart, stats, anchors (1-public P1-3) |
| api-ai-chat.php | POST /api/chat · public.js:1025 · lib/ai-chat.js + ai-guard.js | COVERED | session-held history, limiter 30/10 min |
| api-public-chat.php | — (contact form `POST /contact`) | NOT-NEEDED | Live-chat panel folded into the contact form (1-public: "contact form covers it", P3) — record it in docs/parity as deliberate |
| application-tracker.php | GET/POST /track · public-members.js · public/track.ejs; GET /track/attachment (public.js:994) | PARTIAL | ID + phone (stricter than PHP), phone+email+tracking listing, 7-fail/15-min guard, details grid, stepper, signed card link: all done. Missing: per-channel notify chips (email/SMS sent/failed/skipped) in the public history (`application-tracker.php:1585-1620`) → SM-15. GET /track?id=&phone= performs the lookup from query string (PHP only prefilled on GET; phone ends up in access logs) → SM-15 |
| appointment.php | /apply/appointment · applications.js `appointment` · hooks.appointment | COVERED | office-time slots, cooperative visit, legacy purpose keys |
| attend.php | public.js:1074 → /member/attend?t= ; legacy-urls `attend.php` | COVERED | |
| auction.php | /auctions, /auctions/:id · /apply/bid · hooks.bid · lib/auctions.js | COVERED | window, min price, 24 h dup, BID tracking, filter chips |
| awards.php | /awards, /awards/:id | COVERED | |
| backup-restore.php | /admin/backup, /admin/backup/restore (admin-system.js) | PARTIAL | Root `backup-restore.php` (redirect to admin) is not in legacy-urls PUBLIC map → 404 (SM-16, P3) |
| career-detail.php | /careers/:id · /apply/job · hooks.job (allow_online_apply, deadline, dup email/phone) | COVERED | |
| career.php | /careers (days-left, urgent, new, search, filters) | COVERED | |
| ceo-message.php | /message/ceo | COVERED | |
| chairman-message.php | /message/chairman | COVERED | |
| committees.php | /committees, /committees/:id (org chart, past, cmt_ fallback) | COVERED | |
| contact.php | GET/POST /contact · antispam · lib/maps.js | COVERED | |
| cooperative-programs.php | /programs, POST /programs/:id/register (Member ID + mobile) | COVERED | |
| cron-cleanup.php | scripts/cleanup.js (pm2 `coop-cleanup`, daily) | COVERED | broader retention set than PHP |
| date-converter.php | /date-converter | COVERED | |
| digital-services.php | /digital-services (+ /apply/digital) | COVERED | `?embed=1` iframe mode NOT-NEEDED (portal links directly) |
| downloads.php | /downloads, /downloads/:id/file | COVERED | |
| election-information.php | /elections, /elections/:id | COVERED | |
| emi-calculator.php | /emi-calculator (+ /tools/*) | COVERED | |
| exchange-rate.php | /exchange-rate · lib/exchange-rate.js | COVERED | |
| faqs.php | /faqs (FAQPage JSON-LD in seo.js) | COVERED | |
| gallery.php | /gallery | COVERED | |
| grievance.php | /apply/grievance · hooks.grievance; `?track=` → /track | COVERED | |
| honor-apply.php | /apply/honor · renderHonorClosed · hooks.honor | PARTIAL | Legacy `honor-apply.php?program_id=` redirect drops the id (Node reads `?program=`) → SM-17 |
| important-links.php | /important-links | COVERED | |
| index.php | GET / · public.js:92 · home.ejs (public-cache 60 s) | COVERED | |
| information-room-file.php | /member/information-room/:id (legacy map) | COVERED | |
| install.php | platform console / scripts/tenant-create.js | NOT-NEEDED | multi-tenant platform |
| institutional-profile-file.php | /institutional-profile/:id/file (canOpen + file token) | COVERED | |
| institutional-profile.php | /institutional-profile | PARTIAL | Page covered; legacy `?id=` deep link dropped by legacy-urls (SM-17) |
| interest-rates.php | /interest-rates | COVERED | |
| loan-apply.php | /apply/loan | COVERED | |
| login.php | → /member/login (legacy-urls) | COVERED | |
| manifest.php | /manifest.webmanifest (+ /manifest.json redirect) | COVERED | |
| member-marketplace.php | /marketplace | COVERED | |
| member-skills.php | /marketplace?type=skill | COVERED | |
| member-survey.php | /apply/survey (+ feedback) | COVERED | |
| member-welfare.php | /apply/welfare; `?track=` → /track | COVERED | |
| news-detail.php | /news/:id | COVERED | |
| news.php | /news | COVERED | `?page=` dropped on redirect (P3, SM-17) |
| notices.php | /notices, /notices/:id | COVERED | |
| oauth.php | → /member/login | COVERED | |
| offline.php | GET /offline | COVERED | |
| online-account.php | /apply/account | COVERED | |
| online-kyc.php | /apply/kyc (+ verify-first gate, locked fields, capture), /apply/membership (`?path=new`) | COVERED | `?kyc_id=` profile-edit link → member KYM is loaded from the session anyway |
| page.php | /page/:slug, /page/by-id/:id | COVERED | |
| partner-facilities.php | /partner-facilities | PARTIAL | Page covered; legacy `?type=&view=` dropped (SM-17) |
| password-reset-request.php | → /member/forgot | COVERED | |
| program-attendance-verify.php | legacy-urls → /member/programs | PARTIAL | PHP sends staff to the admin registration desk (`program-attendance-verify.php:12-27`); Node sends them to the member portal (SM-16) |
| pwa-icon.php | /pwa-icon-:size.png | PARTIAL | `pwa-icon.php?s=192&maskable=1` not redirected (SM-16) |
| report-file.php | /reports/:id/file (?dl=1, view_only, members-only token) | PARTIAL | social in-app/crawler bounce (`public-member-access.php:598-660`) missing; members-only files stay at their public /uploads path until first opened (SM-5, SM-13) |
| reports.php | /reports (type/year/month filters, unlock) | COVERED | |
| robots.php | /robots.txt | COVERED | |
| router.php | Express routing + lib/legacy-urls.js (publicRedirects, extensionlessRedirects, memberRedirects); app.js `/assets/uploads/*` | COVERED | `/assets/uploads/**` redirect + gated-folder rule (SM-2, SM-3) |
| sahakari-patro.php | /calendar | PARTIAL | Page covered (P1-11). Legacy `?cal_year=&cal_month=&sel_day=` dropped (SM-17). Rashifal/lagna/gunmilan tabs P3 "recommend not porting" (1-public) |
| service-centers.php | /service-centers | COVERED | |
| services.php | /services, /services/:id | COVERED | |
| share-og.php | /share-og.png, /share-og.svg | COVERED | |
| sitemap.php | /sitemap.xml | COVERED | |
| success-stories.php | /success-stories | COVERED | |
| team.php | /team | COVERED | legacy `?cat=` not kept (P3, SM-17) |
| tracker-id-card.php | /track/id-card (HMAC 15 min) | COVERED | old PHP-signed links → /track (by design) |
| upload-file.php | uploads.js `_private` + /admin/files/* + member routes | PARTIAL | see upload-gate.php; `upload-file.php?d=&f=` not mapped (SM-3, SM-16) |
| vendor-enlistment.php | /apply/vendor · promoteVendor on approval | COVERED | |
| verify.php | GET/POST /verify, /verify/service, /verify/photo/:mid · public-members.js | COVERED | derived CVV (SM-1), card-number / un-hyphenated lookup (SM-6), `verify.php?partner=` QR params (SM-7) |
| vision-mission.php | /vision-mission | COVERED | |
| why-choose.php | /about#why | COVERED | |
| sw.js | public/sw.js (served by app.js:71) | PARTIAL | Offline fallback + push + notificationclick ported. PHP cached member pages (PAGES_CACHE) and showed `/member/offline.php` with cached name/unread; Node deliberately never caches member/admin HTML (privacy). Not recorded in docs/parity → record as deliberate (SM-18). |
| .htaccess | Express (static only from /static, deny rules implicit), legacy-urls (extensionless, index.php→/), helmet | COVERED | `/assets/uploads/...` (SM-2) and gated folders (SM-3) done in app.js. Cache headers/compression handled by Express/nginx (deploy/) |
| version.txt | package.json version | NOT-NEEDED | |

## 2. `member/`

| PHP file | Node equivalent | Status | Notes / gap |
|---|---|---|---|
| _bootstrap.php | member.js router (`auth.requireMember`, headers) | COVERED | |
| account-apply.php | /apply/account (signed-in: identity from KYM) | COVERED | |
| ajax.php (`unread_count`, `mark_read`) | POST /member/notifications/:id/read, /read-all; unread badge in layout | COVERED | |
| apply-frame.php | /apply (direct, no iframe) | NOT-NEEDED | iframe wrapper |
| appointment.php | /apply/appointment | COVERED | |
| attend.php | GET/POST /member/attend (QR token, window, eligibility, pending request) | COVERED | |
| certificate.php | GET /member/certificate · views/member/certificate.ejs | COVERED | KYM details added (SM-8). Was: Node prints name / Member ID / since / QR only. PHP reads the linked KYM (`certificate.php:18-46`) and prints photo, father's name, DOB, permanent address, citizenship no., account type, KYM phone/email (SM-8) |
| check-availability.php | GET /member/check-availability | COVERED | |
| digital-service.php | /apply/digital | COVERED | |
| election-vote.php | /member/elections/:id | COVERED | |
| grievance.php | /apply/grievance | COVERED | |
| honor-apply.php | /apply/honor | COVERED | |
| id-card.php | /member/id-card (KYM photo, expiry warning, stars, unlock request) | COVERED | |
| index.php | GET /member (KPIs, quick apply, partner services, elections) | COVERED | |
| information-room-view.php | /member/information-room/:id/view | PARTIAL | watermark yes; copy/print/PrintScreen/blur deterrence missing (SM-19) |
| information-room.php | /member/information-room | COVERED | |
| kyc-print.php | /member/kyc-print, /member/kyc-print/file/:field | PARTIAL | Works, but finds the KYM with an ad-hoc query (`member.js:318-335`: id OR member_id+exact phone) instead of `kym.loadLinkedKyc` (SSOT rule; exact phone compare misses +977 / dashes) (SM-10) |
| kyc.php | → /apply/kyc | COVERED | |
| loan-apply.php | /apply/loan | COVERED | |
| login.php | /member/login, /member/register, /login/2fa (member.js, member-account.js) | COVERED | |
| logout.php | POST /member/logout | COVERED | |
| marketplace.php | /member/marketplace | COVERED | |
| notifications.php | /member/notifications | COVERED | |
| oauth.php | /member/oauth/google*, /oauth/facebook* | COVERED | |
| offline.php | /offline | PARTIAL | cached-dashboard offline view deliberately dropped (SM-18) |
| password-reset-request.php | /member/forgot (+ verify/resend/cancel, office fallback) | COVERED | |
| profile.php | /member/profile (+ details, phone OTP, kyc-docs, 2FA, OAuth) | COVERED | |
| push-subscribe.php | /member/push/key, /push/subscribe, /push/unsubscribe | COVERED | |
| scan.php | /member/scan · public/js/member-scan.js | COVERED | |
| service-request.php | /member/service-request | COVERED | |
| tracker.php | /member/requests, /member/requests/:module/:id | PARTIAL | Applicant cannot open their own uploaded documents (PHP `coop_upload_gate_member_owns`, `upload-gate.php:155-189`); only the office reply attachment is served (SM-20, P3) |
| transactions.php | /member/accounts (CBS push data) | COVERED | PHP was a stub |
| welfare.php | /apply/welfare + /member/requests | COVERED | |
| includes/chrome.php, chrome-foot.php | views/layouts/member.ejs | COVERED | |
| assets/photo-placeholder.svg | inline Lucide `user` icon | COVERED | |

## 3. `core/`

| File · function(s) | Node equivalent | Status | Notes |
|---|---|---|---|
| init.php (`core_allow_local_debug_url`, `core_is_debug_request`, `core_apply_runtime_error_policy`, ob_start, PORTAL) | app.js / config.isProd / error handler | NOT-NEEDED | runtime plumbing |
| helpers.php `sanitize`, `clean_text`, `e`, `clean_int`, `clean_float`, `sanitize_post` | EJS escaping, util.int, forms.validate | COVERED | |
| helpers.php `isValidEmail`, `isValidPhone`, `isValidCitizenshipNo`, `isValidPAN` | util.isEmail/isPhone, forms field rules | COVERED | PAN/citizenship validators are unused in PHP pages (dead code) |
| helpers.php `formatDate`, `formatNepaliDate`, `todayBS`, `bsToAd`, `adToBs`, `daysBetween`, `monthsBetween`, `timeAgo`, `toNepaliNumeral`, `formatNepaliCurrency`, `_nepalNumberFormat`, `formatNepaliNumber`, `formatShortAmount` | lib/nepali-date.js, util.money, res.locals.num/money/bsDate | COVERED | |
| helpers.php `calcSimpleInterest`, `calcCompoundInterest`, `calcEMI`, `calcEMISchedule`, `calcSavingsInterest`, `calcPenaltyInterest`, `calcLoanEligibility`, `calcFDMaturity` | lib/finance-tools.js (fixedDeposit, recurringSaving, loanEligibility) + /emi-calculator | COVERED / NOT-NEEDED | only EMI/FD/saving/eligibility are used by PHP pages; penalty/simple helpers are dead code |
| helpers.php `truncateText`, `generateSlug`, `titleCase`, `generateMemberNo`, `maskPhone`, `maskEmail`, `stripHtmlSafe`, `formatFileSize`, `isAllowedFileType`, `sanitizeFilename`, `memberPhotoUrl` | util.excerpt/slugify, member-portal maskEmail/maskPhone, uploads.js | COVERED | `generateMemberNo` unused in PHP |
| helpers.php `checkRateLimit`, `getClientIP`, `generateOTP`, `generateToken` | express-rate-limit, member-portal createOtp, crypto | COVERED | |
| helpers.php `arr`, `pluck`, `arrayForSelect`, `paginateArray`, `currentUrl`, `redirect`, `buildQuery`, `pageUrl`, `asset`, `dd`, `coopLog` | util.paginate, Express | NOT-NEEDED | generic helpers |
| helpers.php `fa_to_lucide_map`, `fa_to_lucide`, `icon`, `icon_echo`, `lucide_*` | lib/icons.js alias table + icon() | COVERED | |
| helpers.php `core_safe_count` | db.value | NOT-NEEDED | |

## 3b. `includes/config.php` — function groups (128 functions)

| Functions | Node equivalent | Status | Notes |
|---|---|---|---|
| `coop_request_is_https`, `coopUiLangIsSecureRequest` | app `trust proxy`, cookie `secure: isProd` | COVERED | |
| `getDB`, `dbTableExists`, `dbColumnExists`, `safeAddColumn`, `safeAddIndex`, `safeWidenEnumColumn`, `safeColumnExists`, `safeTableExists` | db.js, db.columns(), migrations | NOT-NEEDED | |
| `sanitize`, `clean_text`, `e`, `selected`, `checked` | EJS `<%=`, partials/field.ejs | COVERED | |
| `coop_sanitize_icon_class`, `coop_canonical_icon_for_storage`, `coop_canonicalize_icon_db_rows`, `coop_nav_icon_html` | lib/icons.js (faToNode + aliases) | COVERED | |
| `coop_sanitize_cms_html`, `coop_render_cms_prose` | util.sanitizeHtml / richText | COVERED | |
| `coop_notice_date_bs`, `coop_notice_date_ad`, `coop_notice_date_normalize_input`, `coop_notice_bs_day_month` | nepali-date isBsLike/toAd/toBs, scripts/normalise-bs-dates.js | COVERED | |
| `coop_notice_media_src`, `safe_public_upload_path`, `safe_public_media_path`, `safe_media_src`, `coop_resolve_stored_upload_rel`, `coop_stored_upload_exists`, `coop_public_download_url`, `safe_versioned_media_src(_absolute)`, `getAssetUrl`, `coop_versioned_asset_url` | uploads.mediaUrl / resolveStored, /static | PARTIAL | DB-stored `assets/uploads/...` paths map correctly; literal `/assets/uploads/...` URLs inside HTML bodies and external links 404; `assets/images/*` default paths map to `/uploads/assets/images/*` (SM-2) |
| `safe_http_url`, `coop_safe_cta_url`, `coop_safe_webhook_url` | util.sanitizeHtml, notify.safeHttpsUrl (DNS-pinned) | COVERED | |
| `coopAuthSecret`, `coopVerifyHmac` | config.sessionSecret HMACs (member-portal signCardLink, member-access fileToken) | COVERED | |
| `coop_new_tracking_id`, `coop_is_public_tracking_id` | util.trackingId, tracker regex | COVERED | |
| `seo_is_search_crawler`, `seo_canonical_url`, `seo_absolute_asset_url`, `seo_default_share_image`, `seo_meta_description_from_html`, `seo_document_title`, `seo_resolve_meta_description`, `seo_normalize_clock`, `seo_*_json_ld` | lib/seo.js | COVERED | |
| `coop_pretty_path`, `coop_url`, `redirect`, `adminSelfUrl`, `getCurrentPage` | Express routes | NOT-NEEDED | |
| `getLoggedInMemberProfile` | req.member (auth.loadUsers) | COVERED | |
| `getSetting`, `getSettingInvalidate`, `updateSetting` | lib/settings.js (+ mapLegacy) | COVERED | |
| `coop_footer_copyright_text`, `getLocalizedLogoPath`, `getSiteFaviconPath`, `getSiteFaviconMime` | public layout + settings (logo per language, favicon) | COVERED | |
| `formatDate`, `toNepaliNumeral`, `getNepaliMonthName`, `formatNepaliDate`, `formatNepaliCurrency`, `formatNepaliNumber`, `truncateText`, `generateSlug` | nepali-date, util | COVERED | |
| `uploadFile`, `deleteFile`, `uploadImage`, `validateUploadedFile`, `sanitizeFilename`, `adminUploadFile`, `adminAttachmentHtml`, `coop_ini_bytes`, `coop_post_exceeded_php_limit`, `coop_upload_error_text` | lib/uploads.js (multer, contentLooksRight magic bytes, images.js variants), admin attachments | COVERED | |
| `setFlash`, `getFlash`, `displayFlash`, `generateCSRFToken`, `csrfField`, `verifyCSRFToken`, `checkCSRF` | lib/security.js | COVERED | |
| `isValidEmail`, `isValidPhone` | util.isEmail/isPhone | COVERED | |
| `coop_client_ip`, `coop_ip_is_cloudflare_edge`, `coop_ip_network_key`, `coop_rate_limit_hit`, `coop_rate_limit_ip_factor`, `checkRateLimit` | `trust proxy` env + express-rate-limit ipKeyGenerator (IPv6 /56) + auth.tooManyAttempts | COVERED | Cloudflare edge trust is a deploy setting (document TRUST_PROXY for CF) |
| `logSecurityEvent` | auth.audit / error-log | COVERED | |
| `isAdminLoggedIn`, `coop_admin_password_fingerprint`, `coop_admin_session_db_recheck`, `requireAdminLogin` | auth.loadUsers (session_version, UA binding, idle timeout), requireAdmin | COVERED | |
| `coop_csv_safe_cell` | util.csvCell | COVERED | |
| `coop_csp_nonce`, `coop_csp_ob_filter` | helmet strict CSP (no inline) | COVERED | stricter |
| `coopSetUiLang`, `coopResolveUiLang`, `getCurrentLang`, `isEnglish`, `portalLangToggleUrl`, `coopLangSwitchUrl`, `portalLangToggleBadge`, `appGetText`, `getLangField`, `getLangStrings`, `lang` | app.js setLang, /lang/:code, res.locals.t / f | COVERED | |
| `getUnifiedTimeOptions`, `getOfficeTimeOptions` | forms.optionSources.officeTimes | COVERED | |
| `ensureLoginAttemptsTable`, `checkLoginAttempts`, `recordLoginAttempt`, `resetLoginAttempts` | auth.tooManyAttempts / recordFailure / clearFailures | COVERED | |
| `purgeOldRecords` | scripts/cleanup.js | COVERED | |

## 4. includes/ — every file and function

| File | Functions (PHP) | Node equivalent | Status | Notes |
|---|---|---|---|---|
| account-submit-helper.php | `accountUploadDocuments`, `submitAccountApplicationUnified` | modules/applications.js `account` + lib/forms.js validate + lib/submissions.js submit; POST /apply/account | **COVERED** | Field rules, 10-digit mobile (RULES.mobile10), guest email, citizenship issued date bsdate, multi-doc upload, admin notify (notify.adminEvent/applicationEvent). |
| admin-menu-control.php | `admin_menu_control_catalog`, `admin_menu_control_load_hidden`, `admin_menu_control_save_hidden`, `admin_menu_control_verify_confirm_code`, `admin_menu_group_visible`, `admin_menu_page_allowed` | routes/admin-tools.js /admin/menu-control, lib/admin-perms.js hiddenGroups | **COVERED** | Better: account password required instead of a shared confirm code. |
| admin-permissions.php | `coop_perm_actions`, `coop_perm_registry`, `coop_perm_page_aliases`, `coop_perm_always_allowed`, `coop_perm_ensure_schema`, `coop_perm_normalize`, `coop_perm_presets`, `coop_perm_current`, `coop_perm_resolve_page`, `coop_perm_post_action`, `coop_perm_can`, `coop_perm_current_request_allowed`, `coop_perm_enforce_request`, `coop_perm_allowed_menu_pages` | lib/admin-perms.js (sections, presets, actionFlag v/c/e/d, aliases), routes/admin-tools.js /admin/roles | **COVERED** | coop_perm_post_action → actionFlag. Note: "void" POSTs classify as e (see SM-9). |
| ai-chat-context.php | `ai_chat_normalize_text`, `ai_chat_query_tokens`, `ai_chat_expand_tokens`, `ai_chat_question_is_leadership`, `ai_chat_context_mode`, `ai_chat_score_text`, `ai_chat_snip`, `ai_chat_resolve_leadership`, `ai_chat_collect_candidates`, `ai_chat_build_context` | lib/ai-chat.js retrieve/context/instantAnswer (leadership) | **COVERED** | Token scoring + leadership resolution ported (commit 08d687b). |
| ai-chat-helpers.php | `ai_chat_require_crypto`, `ai_chat_can_encrypt`, `ai_chat_store_api_key`, `ai_chat_get_api_key`, `ai_chat_has_api_key`, `ai_chat_is_enabled`, `ai_chat_provider`, `ai_chat_default_model`, `ai_chat_model`, `ai_chat_welcome`, `ai_chat_is_sensitive_question`, `ai_chat_is_jailbreak_attempt`, `ai_chat_sensitive_refusal`, `ai_chat_answer_has_sensitive_leak`, `ai_chat_answer_looks_like_prompt_leak`, `ai_chat_redact_secrets`, `ai_chat_public_setting_keys` | lib/ai-chat.js aiSettings, lib/ai-guard.js (isSensitive, isJailbreak, refusal, answerLeaks, looksLikePromptLeak, redact), settings.js decrypts enc:v1 key | **COVERED** |  |
| ai-chat-instant.php | `ai_chat_base_url`, `ai_chat_public_links`, `ai_chat_links_prompt_block`, `ai_chat_leader_contact_row`, `ai_chat_format_instant_rates`, `ai_chat_format_instant_member_count`, `ai_chat_try_instant_answer`, `ai_chat_suggest_links_for_answer` | lib/ai-chat.js instantAnswer/dataAnswer/suggestLinks | **COVERED** |  |
| ai-chat-providers.php | `ai_chat_http_json`, `ai_chat_call_openai`, `ai_chat_call_gemini`, `ai_chat_call_deepseek`, `ai_chat_ask_provider` | lib/ai-chat.js httpJson/askProvider (openai, gemini, deepseek) | **COVERED** |  |
| appointment-submit-helper.php | `appointmentInsertRow`, `appointmentNormalizeDate`, `submitAppointmentUnified` | modules/applications.js `appointment`, submissions.hooks.appointment, forms.optionSources.officeTimes | **COVERED** | member vs cooperative visit, office-time slots, 10-digit mobile, guest email. |
| auction-tables.php | `auctionNormalizeDate`, `auctionFormatDateDisplay`, `auctionEndTimestamp`, `auctionIsOpenForBids`, `auctionSanitizeMapEmbed`, `auctionTitle`, `auctionDescription`, `ensureAuctionTables`, `auctionGenerateBidTrackingId` | lib/auctions.js endTimestamp/isOpen, submissions.hooks.bid, resources.js auction_notices, util.trackingId | **COVERED** | auctionSanitizeMapEmbed → lib/maps.js. ensureAuctionTables → migrations (NOT-NEEDED). |
| audit.php | `auditLog`, `softDelete`, `softRestore` | lib/auth.js audit(); resources trash (admin.js /r/:res/:id/restore|purge) | **COVERED** |  |
| auth-roles.php | `admin_db_role_is_superadmin`, `admin_canonical_db_role`, `coop_widen_admin_role_enum`, `coop_normalize_admin_role_aliases`, `current_admin_role`, `role_level`, `has_role`, `is_superadmin`, `is_admin_or_above`, `is_staff_or_above`, `coop_admin_page_min_role`, `coop_admin_nav_allowed`, `require_role`, `set_admin_session` | lib/auth.js requireAdmin(role levels), lib/admin-perms.js | **COVERED** | set_admin_session → auth.completeAdminLogin; enum widening NOT-NEEDED. |
| boot-shared.php | `coop_require_boot_shared` | src/app.js middleware chain | **NOT-NEEDED** | PHP bootstrap plumbing. |
| card-verify-helpers.php | `getCardPrefix`, `pickNameForCardCvv`, `normalizeCvvInput`, `deriveMemberCardCvv`, `mb_str_pad`, `normalizeMemberNameForMatch`, `memberNamesMatch`, `cvvCredentialsMatch`, `generateCardVerification`, `normalizeCardCode`, `normalizeCardLookupKey`, `ensureCardSecurityColumns`, `cardTableHasColumn`, `lockCardOnFailure`, `_cardVerifyRateLimited`, `_cardVerifyMemberJoinSql`, `_cardVerifySelectSql`, `_cardDisplayNameFromRow`, `_finalizeCardVerifySuccess`, `_cardVerifyStatusGate`, `verifyCardCredentials`, `verifyCardByNameAndMemberId`, `_logVerifyAttempt` | lib/member-portal.js cardPrefix/issueCard/namesMatch/cardFailure/verifyByNameIdMobile; routes/public-members.js POST /verify | **PARTIAL** | **deriveMemberCardCvv / cvvCredentialsMatch / normalizeCardLookupKey not ported** — PHP-issued 7-char derived CVVs (e.g. SUJ0123) can never match (Node keeps 4 digits only) and cards lock after 5 tries; card_no / un-hyphenated code lookup missing; success does not refresh cvv. See SM-1, SM-6. |
| careers-tables.php | `careerNormalizeDate`, `careerDeadlineAd`, `careerDeadlinePassed`, `careerDaysLeft`, `careerIsOpen`, `careerIsNew`, `careerFormatDeadlineDisplay`, `ensureCareersTables` | lib/nepali-date.js toAd/daysUntil (careerDeadlineAd), routes/public.js /careers (isNew, days left, urgent) | **COVERED** |  |
| compatibility.php | `str_contains`, `str_starts_with`, `str_ends_with`, `array_is_list`, `getSystemCompatibilityInfo` | — | **NOT-NEEDED** | PHP polyfills / host compatibility report. |
| components/stat-card.php | — | views/partials (stat tiles in admin/dashboard.ejs) | **COVERED** | No functions. |
| config.php | `coop_request_is_https`, `getDB`, `dbTableExists`, `dbColumnExists`, `sanitize`, `clean_text`, `e`, `coop_sanitize_icon_class`, `coop_canonical_icon_for_storage`, `coop_canonicalize_icon_db_rows`, `coop_nav_icon_html`, `coop_sanitize_cms_html`, `coop_render_cms_prose`, `coop_notice_date_bs`, `coop_notice_date_ad`, `coop_notice_date_normalize_input`, `coop_notice_bs_day_month`, `coop_notice_media_src`, `safe_http_url`, `coop_safe_cta_url`, `coop_safe_webhook_url`, `coopAuthSecret`, `coopVerifyHmac`, `coop_new_tracking_id`, `coop_is_public_tracking_id`, `seo_is_search_crawler`, `coop_pretty_path`, `coop_url`, `seo_canonical_url`, `seo_absolute_asset_url`, `seo_default_share_image`, `coop_versioned_asset_url`, `seo_meta_description_from_html`, `seo_document_title`, `seo_resolve_meta_description`, `seo_normalize_clock`, `seo_organization_json_ld`, `seo_website_json_ld`, `seo_breadcrumb_json_ld`, `seo_faq_page_json_ld`, `seo_news_article_json_ld`, `safe_public_upload_path`, `safe_public_media_path`, `safe_media_src`, `coop_resolve_stored_upload_rel`, `coop_stored_upload_exists`, `coop_public_download_url`, `safe_versioned_media_src`, `safe_versioned_media_src_absolute`, `getLoggedInMemberProfile`, `selected`, `checked`, `getSettingInvalidate`, `getSetting`, `coop_footer_copyright_text`, `getLocalizedLogoPath`, `getSiteFaviconPath`, `getSiteFaviconMime`, `updateSetting`, `formatDate`, `toNepaliNumeral`, `getNepaliMonthName`, `formatNepaliDate`, `formatNepaliCurrency`, `formatNepaliNumber`, `generateSlug`, `uploadFile`, `deleteFile`, `uploadImage`, `getAssetUrl`, `setFlash`, `getFlash`, `displayFlash`, `generateCSRFToken`, `csrfField`, `verifyCSRFToken`, `coop_ini_bytes`, `coop_post_exceeded_php_limit`, `coop_upload_error_text`, `checkCSRF`, `sanitizeFilename`, `isValidEmail`, `isValidPhone`, `coop_client_ip`, `coop_ip_is_cloudflare_edge`, `coop_ip_network_key`, `coop_rate_limit_hit`, `coop_rate_limit_ip_factor`, `checkRateLimit`, `logSecurityEvent`, `isAdminLoggedIn`, `coop_csv_safe_cell`, `coop_admin_password_fingerprint`, `coop_admin_session_db_recheck`, `requireAdminLogin`, `redirect`, `adminSelfUrl`, `getCurrentPage`, `truncateText`, `coop_csp_nonce`, `coop_csp_ob_filter`, `coopUiLangIsSecureRequest`, `coopSetUiLang`, `coopResolveUiLang`, `getCurrentLang`, `isEnglish`, `getUnifiedTimeOptions`, `getOfficeTimeOptions`, `portalLangToggleUrl`, `coopLangSwitchUrl`, `portalLangToggleBadge`, `appGetText`, `getLangField`, `getLangStrings`, `lang`, `safeAddColumn`, `safeAddIndex`, `safeWidenEnumColumn`, `adminUploadFile`, `adminAttachmentHtml`, `ensureLoginAttemptsTable`, `checkLoginAttempts`, `recordLoginAttempt`, `resetLoginAttempts`, `purgeOldRecords`, `validateUploadedFile`, `safeColumnExists`, `safeTableExists` | see breakdown table below | **PARTIAL** | Almost all mapped; gaps: legacy /assets/uploads URL serving (SM-2), social in-app bounce. |
| contact-spam-guard.php | `coop_contact_rate_ok`, `coop_contact_honeypot_tripped`, `coop_math_challenge_issue`, `coop_math_challenge_verify`, `coop_contact_looks_like_spam`, `coop_turnstile_configured`, `coop_turnstile_site_key`, `coop_turnstile_verify`, `coop_public_form_spam_parts`, `coop_public_form_bot_block`, `coop_contact_guard_block_reason`, `coop_public_form_guard_message`, `coop_public_form_gate`, `coop_public_form_math_payload`, `coop_public_form_anti_bot_html` | lib/antispam.js (looksLikeSpam, mathIssue/mathVerify/mathPrompt, verifyTurnstile, check), security.isBot (honeypot), routes rate limiters | **COVERED** |  |
| coop-date-ui.php | `coop_date_ui_use_bs`, `coop_date_ui_to_display`, `coop_date_ui_normalize_ad`, `coop_date_label_calendar`, `coop_date_hint_html`, `coop_date_input_html` | lib/forms.js bsdate/normalizeAdDate, views/partials/field.ejs, public/js/forms.js | **COVERED** |  |
| coop-terms.php | `coop_is_en`, `coop_term_kym`, `coop_term_kym_full`, `coop_term_kym_online`, `coop_term_kym_apps`, `coop_term_office`, `coop_term_offices`, `coop_term_office_preferred`, `coop_term_office_select` | labels in navigation.js/applications.js (KYM / केवाइएम wording) | **COVERED** | Terms are inline bilingual strings rather than one helper; acceptable. |
| credentials-crypto.php | `cred_encrypt`, `cred_decrypt`, `cred_log_action` | lib/credentials-crypto.js, routes/admin-credentials.js (audit log of reveals) | **COVERED** | PHP AES-CBC values re-encrypted on migration (site-migration.js). |
| data-ssot.php | — | — | **NOT-NEEDED** | Documentation-only file. |
| database.dist.php | — | src/config.js (env) | **NOT-NEEDED** | Config template. |
| digital-service-requests-tables.php | `ensureDigitalServiceRequestsTables` | db/migrations | **NOT-NEEDED** | Schema bootstrap. |
| digital-service-submit-helper.php | `digitalServiceUploadAttachment`, `submitDigitalServiceRequestUnified` | modules/applications.js `digital` (showIf per service, requiredIf requires_document, service_amount>0), hooks.digital | **COVERED** |  |
| digital-service-types.php | `digitalServiceTypesDefaults`, `digitalServiceTypeSlugify`, `ensureDigitalServiceTypes`, `digitalServiceTypesMap`, `digitalServiceTypeLabel`, `digitalServiceTypeUsageCount` | resources.js digital_service_types + forms optionSources; delete guard | **COVERED** |  |
| election-tables.php | `ensureElectionTables`, `ensureElectionVotingTables`, `isElectionVotingOpen`, `electionCombineBsDateTime`, `electionFormatDtBs`, `electionVoteWindowState`, `electionVoteStateBadgeHtml`, `electionPickDefaultPublicCycle`, `electionMemberHasBallot`, `electionMemberAttendanceOnly`, `ensureDesignationsTable`, `designationCategories`, `fetchDesignations` | lib/elections.js windowState/isOpen/submit/finalize; routes/admin-elections.js; member.js /member/elections/:id (attendanceOnly); resources designations | **COVERED** | ensure* → migrations. |
| ensure-tables.php | `ensurePublicTables` | db/migrations/*.sql | **NOT-NEEDED** | Replaced by idempotent migrations. |
| error-handler.php | `_show_error_page` | lib/error-log.js, app.js error handler, views/public/error.ejs | **COVERED** |  |
| footer.php | `toggleFaq`, `openFooterMetrics`, `closeFooterMetrics`, `openUsefulLinks`, `closeUsefulLinks`, `openSearchModal`, `closeSearchModal`, `toggleDarkMode`, `updateDarkModeIcon`, `getAnimationClass`, `applyStagger`, `loadScrollA11y`, `copyTrk`, `q`, `byId`, `log`, `menuState`, `checkSizes`, `inspectVisibleCloseElements`, `forceReset`, `buildPanel`, `applyMath`, `esc`, `bubbleHtml`, `addBubble`, `syncBodyOpen`, `closePanel`, `openPanel`, `openLive`, `openFaq`, `ask` | views/layouts/public* + partials/float-widgets.ejs, public/js/site.js (search modal, FAQ bot, dark mode, copy tracking) | **COVERED** | JS helper funcs (toggleFaq, openSearchModal, ask …) are client UI; live-chat panel (api-public-chat) intentionally folded into contact form (1-public P3). |
| gallery-albums.php | `galleryAlbumNormalizeKey`, `galleryAlbumCategoryLabels`, `galleryAlbumLabel`, `ensureGalleryAlbumsSchema`, `galleryMigrateLegacyVideos`, `galleryLegacyAlbumKeyExpr`, `galleryMigrateLegacyAlbums`, `galleryHasMediaTypeColumn`, `galleryPhotoWhereSql`, `galleryFetchAdminAlbums`, `galleryFetchPublicAlbums`, `galleryResolveAlbumParam`, `galleryFetchAlbumMedia`, `galleryFetchAlbumPhotos`, `galleryAlbumPhotoCount`, `galleryAlbumMediaCount`, `galleryFetchAlbumById` | routes/public.js /gallery, resources gallery/gallery_albums, admin-tools /gallery/upload|video | **COVERED** | Legacy album/video migration helpers → site-migration import (NOT-NEEDED at runtime). |
| google-map-embed.php | `resolveHttpRedirectUrl`, `normalizeGoogleMapEmbedUrl` | lib/maps.js (short links goo.gl / maps.app, coords → embed) | **COVERED** |  |
| grievance-submit-helper.php | `grievanceUploadAttachment`, `submitGrievanceUnified` | modules/applications.js `grievance`, hooks.grievance (anonymous) | **COVERED** |  |
| header.php | `coop_nav_cms_page_li`, `hide`, `bindPflMobileMenu`, `setToggleLucide`, `syncToggleVisualState`, `cleanupDdButtons`, `openNav`, `closeNav`, `fitNav`, `bindCascadeParents` | views/layouts/*, lib/navigation.js (CMS pages by menu_position, committees show_in_navbar, careers badge), partials/header-extras.ejs, notice-popup.ejs | **COVERED** | himal_bg header background (P3, 1-public) still absent. |
| honor-submit-helper.php | `honorUploadAttachment`, `submitHonorApplicationUnified` | modules/applications.js `honor` (filterBy programs = honorProgramAllowsCategory), hooks.honor | **COVERED** |  |
| honor-tables.php | `ensureHonorTables`, `honorSeedDefaultCategories`, `honorNowSql`, `honorIsProgramOpenRow`, `honorFetchOpenPrograms`, `honorFetchUpcomingPrograms`, `honorHasOpenProgram`, `honorHasPublicProgram`, `honorFormatDtBs`, `honorCombineBsDateTime`, `honorProgramWindowState`, `honorFetchProgramById`, `honorFetchCategoryById`, `honorFetchProgramCategories`, `honorProgramAllowsCategory`, `honorProgramLabel`, `honorCategorySlugify`, `honorCategoryLabel`, `honorStatusLabel`, `honorShowNewBadge` | forms.optionSources honorPrograms/honorCategories, public.js renderHonorClosed, admin-applications /honor-programs/:id categories | **COVERED** | honorShowNewBadge → navigation badge (open programme) — verify visually. |
| information-room-tables.php | `ensureInformationRoomTables`, `ensureInformationRoomMemberColumn`, `irCategories`, `irCategoryLabel`, `irMemberHasAccess`, `irFetchItem`, `irFetchActiveItems`, `irLogAccess`, `irResolveFilePath`, `irDeleteStoredFile`, `irAllowedUploadExtensions`, `irIsPreviewableExt`, `irNormalizeStoredPath`, `irFetchAccessLogs`, `irCanAccessItem` | routes/member.js /member/information-room*, admin-tools /information-room/logs|browse|view | **PARTIAL** | irLogAccess logs on file fetch only, action recorded as "download" even for inline views; the /view page itself is not logged (P3). |
| information-room-viewer.php | — | views/member/information-room-view.ejs (watermark) | **PARTIAL** | Copy / context-menu / print / PrintScreen deterrence and blur-on-hidden (assets/js/information-room-viewer.js) not ported (P3). |
| installer-lock.php | `coop_installer_root`, `coop_installer_status`, `coop_installer_auto_lock`, `coop_installer_toggle_lock` | platform tenant creation (routes/platform.js, scripts/tenant-create.js) | **NOT-NEEDED** | No installer in a multi-tenant platform. |
| institutional-profile-helpers.php | `coopIpShortAmt`, `coopIpMonthLabel`, `coopIpResolveMonth`, `coopIpSortKey`, `coopIpFetchLatestProfile`, `coopIpBuildChartSeries`, `coopIpFormatAmtFull`, `coopIpProfileUptoAdDate`, `coopIpWelfareReliefByType` | routes/public.js /institutional-profile (charts, month cards, FY filters), lib/welfare.js forProfile | **COVERED** |  |
| institutional-profile-welfare.php | `coopIpEnsureWelfareTables`, `coopIpWelfareTypesForAdmin`, `coopIpWelfareOpeningMap`, `coopIpWelfareSaveOpening`, `coopIpWelfareClaimsAgg`, `coopIpWelfareMergeMaps`, `coopIpWelfareListFromMaps`, `coopIpReportAdBounds`, `coopIpPreviousProfileRow`, `coopIpWelfareLoadProfileRows`, `coopIpWelfareSaveProfileRows`, `coopIpWelfarePrefillForMonth`, `coopIpWelfareResolveForProfile`, `coopIpWelfareParsePostRows` | lib/welfare.js (types, openingMap, saveOpening, claimsAgg, reportBounds, previousSnapshot, load/saveProfileRows, prefill, forProfile); routes/admin-welfare.js | **COVERED** |  |
| kyc-capture-helpers.php | `saveBase64Image`, `kyc_is_jpeg_upload`, `captureOrUpload`, `composeAddress`, `publicSiteAssetUrl`, `kycDocNeedsUpload` | lib/uploads.js saveDataUrl, forms.composeAddress, public/js/kyc-capture.js, member-self /profile/kyc-docs (kycDocNeedsUpload) | **COVERED** |  |
| kyc-public-form.php | `kycApplicationsMemberIdColumnPublic`, `verifyPublicFormKycByMemberId`, `verifyPublicFormKycApprovedByMemberId`, `verifyPublicFormKycTriple`, `loadKycRowForLoggedMemberPublic` | lib/kym.js verifyForForm/requireMemberIdAndMobile/identityFrom, lib/submissions.js applyMemberIdentity | **COVERED** |  |
| leadership-message-helpers.php | `coop_load_leadership_messages` | routes/public.js /message/:who | **COVERED** |  |
| loan-submit-helper.php | `loanUploadDocuments`, `submitLoanApplicationUnified` | modules/applications.js `loan` (min 1000, docs ×5), RULES.mobile10/guestEmail | **COVERED** |  |
| member-auth.php | `ensureMembersListSchema`, `ensureMemberTables`, `memberSecurityHeaders`, `memberSafeRedirect`, `memberCheckRateLimit`, `memberRecordFailedLogin`, `memberClearRateLimit`, `memberIsLoggedIn`, `currentMember`, `memberStripAuthSecrets`, `requireMemberLogin`, `memberLogout`, `memberSafeAvatarUrl`, `validatePhoneAgainstKYC`, `memberPasswordPolicyError`, `memberPasswordPolicyErrorEn`, `memberRegister`, `memberLoginEligibilityError`, `memberLogin`, `memberOAuthLogin`, `memberSetSession`, `memberPasswordFingerprint`, `memberSessionStillValid`, `adminApproveMember`, `adminRejectMember`, `adminGenerateMemberIdCard`, `notifyAdminOfPasswordResetRequest`, `memberRequestPasswordReset`, `adminApprovePasswordReset`, `createMemberNotification`, `getMemberUnreadCount`, `getMemberApplications`, `memberStatusBadge`, `memberStatusSteps`, `findMemberByContact`, `googleOAuthUrl`, `facebookOAuthUrl`, `createMemberStatusNotification`, `sendDirectSMS`, `findMemberForReset`, `generateAndStoreOTP`, `verifyOTP`, `sendOTPviaSMS`, `sendOTPviaEmail`, `dispatchOTP`, `maskPhone`, `maskEmail` | lib/auth.js, lib/member-portal.js (register, eligibilityError, checkCardExpiry, approve/reject, issueCard, OTP create/verify/dispatch, findForReset, alertOffice), routes/member*.js, admin-members.js /password-requests | **PARTIAL** | createMemberStatusNotification: Node matches the member by memberCol or exact `phone =` only (no member_portal_id, no normalised phone/email) and the text lacks first name/tracking/remarks lines (SM-12). Everything else covered. |
| member-import-helpers.php | `ensureMemberImportTables`, `memberImportTempPassword`, `memberImportUploadDir`, `memberImportNormalizeHeader`, `memberImportNormalizeGender`, `memberImportNormalizeMobile`, `memberImportNormalizeEmail`, `memberImportIsValidContact`, `memberImportShouldGenerateCards`, `memberImportShouldRunKyc`, `memberImportClearOutputBuffers`, `memberImportReconcileJobCounts`, `memberImportFinishJob`, `memberImportStripUtf8BomFile`, `memberImportNormalizeDob`, `memberImportNormalizeCitizenship`, `memberImportApplyOptionalExtras`, `memberImportCreateJob`, `memberImportGetJob`, `memberImportJobProgress`, `memberImportProcessTick`, `memberImportFgetcsv`, `_memberImportCountDataRows`, `_memberImportParseChunk`, `_memberImportImportChunk`, `memberImportExportErrors`, `memberImportFieldUpdate`, `memberImportFieldUpdateView` | lib/member-import.js (parseCsv, mapHeader, normGender, normDob, stage, commit), routes/admin-members.js /members/import*, member-portal monthlySavingFieldUpdate | **COVERED** | Temp passwords deliberately not ported (docs/parity 4 b-9). Chunked tick/BOM/output-buffer helpers are PHP plumbing. |
| member-marketplace-public-page.php | — | routes/marketplace.js pub, views/public/marketplace*.ejs | **COVERED** |  |
| member-marketplace-tables.php | `ensureMemberMarketplaceTables`, `mpExpireStaleListings`, `mpProductCategories`, `mpSkillCategories`, `mpCategoryLabel`, `mpCategoryIcon`, `mpNormalizeDate`, `mpNormalizeTime`, `mpCombineUntil`, `mpIsPubliclyVisible`, `mpPublicWhereSql`, `mpIsApproveEligible`, `mpFetchPublicListings`, `mpFetchPublicCount`, `mpFetchListingById`, `mpPriceDisplay`, `mpListingImageUrl`, `mpPhoneDigits`, `mpWhatsAppUrl`, `mpStatusMeta`, `mpTypeLabel`, `mpPublicPageUrl`, `mpDefaultUntilDays`, `mpAdToBsDisplay`, `mpMarkInquiriesRead` | routes/marketplace.js (EXPIRE_SQL, categories, WhatsApp link, status meta), scripts/cleanup.js | **COVERED** |  |
| member-monthly-saving.php | `coop_monthly_saving_ensure_column`, `coop_monthly_saving_parse`, `coop_monthly_saving_from_db`, `coop_monthly_saving_label`, `coop_monthly_saving_modifier`, `coop_monthly_saving_badge_html`, `coop_monthly_saving_get`, `coop_monthly_saving_set`, `coop_monthly_saving_radios_html` | lib/member-portal.js parseMonthlySaving/msLabel, admin-programs desk | **COVERED** |  |
| member-of-year-tables.php | `ensureMemberOfYearTable` | resources member_of_year, /awards, home spotlight | **COVERED** |  |
| member-partner-services-tables.php | `ensureMemberPartnerServicesTable` | lib/partners.js logService, member dashboard #partner-services | **COVERED** |  |
| member-portal-identity.php | — | lib/kym.js loadLinkedKyc | **PARTIAL** | Not used everywhere: member.js ownKyc()/kyc-print and certificate use ad-hoc lookups (SM-10). |
| member-prefill-block.php | — | views/public/apply-form.ejs identity card + forms.identitySkipped | **COVERED** |  |
| member-ssot.php | `memberSsotDevanagariDigitsToLatin`, `memberSsotNormalizeId`, `memberSsotLatinDigitsToDevanagari`, `memberSsotIdLookupVariants`, `memberSsotResolveSadasyata`, `memberSsotLoadLinkedKyc`, `memberSsotHasDocPath`, `memberSsotExistingDocFlags`, `memberSsotKymRequiresExistingMember`, `memberSsotFindBySadasyata`, `memberSsotFindKycByMemberId`, `memberSsotLinkMemberToKyc`, `memberSsotAttachKycToMemberBySadasyata`, `memberSsotBsFromAd`, `memberSsotEnsureKycStubFromMember`, `memberSsotLinkMemberBySadasyataToKyc`, `memberSsotStatusBadgeHtml`, `memberSsotBatchStatusForKycRows`, `memberSsotKycLinkFilterSql`, `memberSsotLinkStatusLabel`, `memberSsotLinkStatusBadgeClass`, `memberSsotStatusForMemberRow`, `memberSsotStatusForKycRow`, `memberSsotRequireExistingMember`, `memberSsotPhoneOwnedByOther`, `memberSsotKycLinkedToOtherMember`, `memberSsotNormalizeMobile`, `memberSsotPhonesMatch`, `memberSsotRequireMemberIdAndMobile`, `memberSsotMergePublicKycFillEmpty`, `memberSsotPublicGateStore`, `memberSsotPublicGateClear`, `memberSsotPublicGateCheck`, `memberSsotPrefillEmptyOnlyFromKyc`, `memberSsotAfterKycWrite`, `memberSsotSyncKycFromMember`, `memberSsotAfterMemberWrite`, `memberSsotUpsertMemberFromKyc`, `memberSsotRegisterOrAttach`, `memberSsotDuplicateSadasyataReport`, `memberSsotEmptySadasyataCount`, `memberSsotTryAddUniqueIndex`, `memberSsotNormalizePhoneCompare`, `memberSsotCompareSharedContact`, `memberSsotDivergenceAlertHtml`, `memberSsotEditGuideHtml`, `memberSsotAdminHelpHtml` | lib/kym.js (normalizeId, findMemberBySadasyata, findKycByMemberId, loadLinkedKyc, linkMember, upsertMemberFromKyc, afterKycWrite, mergeFillEmpty, compareShared, ensureStubFromMember), member-portal.js (idVariants, phonesMatch, phoneOwnedByOther, duplicateReport, tryUniqueGuard), admin-members /members/duplicates | **COVERED** | Status badge/help HTML helpers → views. |
| member-success-stories-tables.php | `ensureMemberSuccessStoriesTable`, `fetchActiveMemberSuccessStories` | /success-stories, resources | **COVERED** |  |
| membership-applications.php | `membershipEnsureTable`, `membershipNewTrackingId`, `membershipCreateRequest`, `membershipApproveWithMemberId`, `membershipReject`, `membershipPendingCount` | modules/applications.js `membership`, submissions.hooks.membership, admin-applications POST /inbox/membership/:id/approve | **COVERED** |  |
| nav-menu-badges.php | `nav_get_public_submenu_badges`, `nav_submenu_count_badge_html` | lib/navigation.js (openJobs badge), marketplace counts | **COVERED** |  |
| nepal-address.php | `getNepalAddressData`, `printNepalAddressJs` | src/lib/nepal-address.json + GET /js/form-data.js | **COVERED** |  |
| nepali-bs-convert.php | `nepali_parse_ad_ymd`, `nepali_parse_bs_ymd`, `nepali_bs_month_lens`, `nepali_bs_sum_year_days`, `nepali_count_ad_days`, `nepali_count_bs_days`, `nepali_add_ad_days`, `nepali_add_bs_days`, `nepali_bs_to_ad_components`, `nepali_ad_to_bs_components`, `nepali_bs_to_ad_string`, `nepali_ad_to_bs_string`, `nepali_bs_date_valid`, `nepali_bs_ymd_compare`, `nepali_kathmandu_today_bs`, `nepali_latin_digits_to_devanagari`, `nepali_devanagari_digits_to_latin` | lib/nepali-date.js (bsToAd, adToBs, isValidBs, todayBs, digits) | **COVERED** |  |
| nepali-bs-month-days.generated.php | `nepali_bs_month_days_map` | src/lib/bs-month-days.json | **COVERED** |  |
| notification-log-tables.php | `ensureNotificationLogTable` | notification_log (migrations), notify.log | **COVERED** |  |
| notification-templates-tables.php | `ensureNotificationTemplatesSchema` | migrations | **NOT-NEEDED** |  |
| notification-templates.php | `ensureNotificationTemplatesTable`, `getNotificationTemplate`, `renderNotificationTemplate`, `getNotificationEventsList` | lib/notify.js template/moduleTemplate/render ({var} + {{var}}) | **COVERED** |  |
| notifications.php | `ensureNotificationTable`, `logNotification`, `isNotificationEnabled`, `buildEmailHtml`, `sendEmailNotification`, `sendSMSNotification`, `sendSmtpEmail`, `sendMemberStatusUpdate`, `sendAdminNotification`, `_legacyNotificationConfig`, `sendEmailNotificationRaw` | lib/notify.js (sendSms, sendEmail, transport, applicationEvent, adminEvent, notifyMember, overLimit, log, recordOutcome) | **COVERED** | sendMemberStatusUpdate per-module templates → applicationEvent. |
| nrb-forex-fetch.php | `nrbFetchForex`, `nrbHttpGet`, `nrbNormaliseRates`, `nrbStaticFallback` | lib/exchange-rate.js fetchLatest/latest (disk fallback) | **COVERED** |  |
| panel-uniform.php | `coopAlert`, `coopFlash`, `coopPanelType`, `coopCurrentUser`, `coopBreadcrumb`, `coopTableOpen`, `coopTableClose`, `coopTableCell`, `coopEmptyRow`, `coopStatusBadge`, `coopPageHeader`, `coopInfoCard`, `coopPaginationLinks` | views/partials/* (page-head, pagination, request-row), admin.css | **COVERED** | UI helpers. |
| partner-facilities-tables.php | `ensurePartnerFacilitiesTables`, `partnerGenerateCode`, `partnerFacilityDisplayName`, `partnerFacilityDescription`, `partnerFacilityLogoUrl`, `partnerDiscountDisplay`, `getActivePartnerFacilities`, `partnerFindById`, `partnerFindByCode`, `partnerVerifyPin`, `partnerHasServiceLogs`, `partnerUsageCount`, `logMemberPartnerService`, `partnerBuildVerifyDisplayResult`, `partnerRecentDuplicateLog`, `fetchMemberPartnerServiceLogs`, `fetchPartnerFacilityServiceLogs`, `promoteVendorToPartner` | lib/partners.js (generateCode, verifyPin, setPin, logService 90 s duplicate, promoteVendor), routes/admin-partners.js, /partner-facilities | **COVERED** |  |
| pii-crypto.php | `pii_key`, `pii_active`, `pii_is_encrypted`, `pii_enc`, `pii_dec`, `pii_dec_row`, `pii_columns` | lib/pii-crypto.js (pii1:/pii2:), db.js auto-decrypt, scripts/pii.js | **COVERED** |  |
| program-attendance-helpers.php | `programResolveMemberBySadasyata`, `programMemberSadasyataNo`, `programFilterBsDateToAd`, `programAttendanceMethodLabel`, `mapSourceToMethod`, `programFetchById`, `programFetchOccurrenceById`, `programResolveScopeId`, `programResolveParentProgramId`, `programResolveQrContext`, `programIsWindowOpen`, `programIsQrEnabled`, `programFindExistingAttendance`, `programAttendanceDisplayLocation`, `programLogAttempt`, `programLogAttemptOnce`, `programAuditLog`, `programClosePendingRequests`, `programValidateMemberEligible`, `recordProgramAttendance`, `programValidLockSql`, `voidProgramAttendance`, `programCanVoidAttendance`, `programCountUniqueAttended`, `programCountActiveMembers`, `programOccurrenceCounts`, `programFormatExistingAttendanceMessage`, `programFormatAttendedAt`, `programMemberPhotoUrl`, `programHasPendingAttendanceRequest`, `programCountPreregistrations`, `programLiveStatsForProgram`, `programFetchValidAttendanceByScope`, `programFetchValidAttendanceByOccurrence`, `programFetchValidAttendanceByProgram` | lib/attendance.js (eligibility, record, logAttempt, closedReason, voidAttendance, findMember), lib/program-reports.js, routes/admin-programs.js, member.js /attend | **PARTIAL** | programCanVoidAttendance (staff may void only own records) and programClosePendingRequests not ported (SM-9, SM-14). |
| program-member-insights.php | `programKycJoinParts`, `programGenderKey`, `programGenderLabel`, `programMemberIdentity`, `programAttendanceRecordedBy`, `programFatherNamesForScope`, `programMemberAttendanceLog`, `programMemberTypeRegister`, `programMemberHistorySummary`, `programAttendanceBreakdown`, `programDesksForProgram`, `programBreakdownFilterSpec`, `programBreakdownBaseSql`, `programAttendanceBreakdownFiltered`, `programAttendanceDetailRows` | lib/program-reports.js (genderKey, memberLog, memberTypeRegister, memberHistorySummary, breakdown*, desksFor) | **COVERED** |  |
| program-tables.php | `programIndexExists`, `programColumnExists`, `ensureProgramTables`, `programEventDateToAd`, `programCombineBsDateTime`, `programMysqlDtToBsDate`, `programMysqlDtToTime`, `programNormalizeBsDate`, `programMemberDob`, `programScheduleTimeOptions`, `programNormalizeScheduleTime`, `programScheduleTimeSelectOptions`, `programWindowTimeSelectHtml`, `programTypeOptions`, `programTypeLabel`, `programBackfillV2Columns`, `programAttendanceSourceLabel` | migrations + admin-programs.js (BS date/time combine via nepali-date), program type options in resources | **COVERED** |  |
| public-member-access.php | `coopAccessLevelNormalize`, `coopMemberAccessIsAdmin`, `coopMemberAccessUnlocked`, `coopMemberAccessCanOpen`, `coopMemberAccessClientIp`, `coopMemberAccessGuardState`, `coopMemberAccessNormalizeSadasyata`, `coopMemberAccessNormalizeMobile`, `coopTryUnlockBySadasyata`, `coopMemberAccessRegisterFail`, `coopMemberAccessSafeReturnPath`, `coopMemberAccessHandleUnlockPost`, `coopMemberAccessWantsAjax`, `coopMemberAccessJsonRespond`, `coopMemberAccessProcessUnlockRequest`, `coopMemberAccessResolveAbsolutePath`, `coopMemberAccessStreamFile`, `coopMemberAccessCreateFileToken`, `coopMemberAccessCheckFileToken`, `coopMemberAccessFileUrl`, `coopMemberAccessIsSocialInAppBrowser`, `coopMemberAccessIsSocialLinkCrawler`, `coopMemberAccessBounceSocialInAppToPage`, `coopMemberAccessUnlockFormHtml`, `coopMemberAccessUnlockClientScriptOnce` | lib/member-access.js (unlocked, canOpen, guard, tryUnlock, fileToken, checkFileToken); public.js /reports/unlock | **PARTIAL** | coopMemberAccessIsSocialInAppBrowser / IsSocialLinkCrawler / BounceSocialInAppToPage not ported (SM-13). |
| public-ui-look.php | `coopPublicUiLooks`, `coopPublicUiLook`, `coopPublicUiLookNormalize`, `coopVerifyPublicLookChangePin` | lib/layouts.js + lib/themes.js (site layouts, palette policy) | **COVERED** | Look presets replaced by layouts/themes. |
| push-helper.php | `ensurePushTables`, `vapidB64url`, `vapidDerToRaw`, `vapidBuildJwt`, `vapidSend`, `broadcastWebPush` | lib/push.js (web-push, VAPID keys, sendTo/sendToMember/sendToAll, subscribe) | **COVERED** |  |
| push-vapid-config.php | — | lib/setting-defs.js vapid keys | **COVERED** |  |
| pwa-icons.php | `getSitePwaIconSourcePath`, `getPwaIconPublicUrl`, `pwaClampIconSize`, `pwaClearIconCache`, `pwaServeIcon`, `pwaEmitPngFile`, `pwaBuildIconPng` | routes/public.js /pwa-icon-:size.png, manifest | **COVERED** | Legacy pwa-icon.php?s= URL not redirected (SM-16). |
| qr-local.php | `coop_qr_scripts_html`, `coop_qr_img_tag` | qrcode npm (server-side data URLs) | **COVERED** |  |
| request-status-history.php | `ensureRequestStatusHistoryTable`, `logRequestStatusHistory`, `fetchRequestStatusHistory` | request_status_history writes in admin-applications.js, notify.recordOutcome | **COVERED** |  |
| safe-query.php | `sqWhere`, `sqTable`, `sqOrderBy`, `sqCount`, `core_safe_count` | db.js parameterised helpers, db.ident whitelist | **NOT-NEEDED** | PHP SQL helper. |
| sahakari-calendar-events-tables.php | `ensureSahakariCalendarEventTables`, `sahakariCalendarEventTypeLabel`, `sahakariCalendarFetchYearEvents`, `sahakariCalendarEventsByDay` | /calendar (public.js), resources calendar events | **COVERED** |  |
| satisfaction-links-tables.php | `ensureSatisfactionLinksTables`, `satisfactionWidgetEnabled`, `satisfactionFetchActiveLinks`, `satisfactionHasNewBadge`, `satisfactionLinkTitle` | /admin/satisfaction, partials/float-widgets.ejs | **COVERED** |  |
| satisfaction-widget.php | `positionPopup`, `openWidget`, `closeWidget` | partials/float-widgets.ejs + site.js | **COVERED** |  |
| schema-migrations.php | `coop_ensure_schema_migrations_table`, `coop_schema_migration_applied`, `coop_record_schema_migration`, `coop_list_schema_migrations` | scripts/migrate.js, schema_migrations | **COVERED** |  |
| service-centers-helpers.php | `fetchActiveServiceCenters`, `serviceCenterDisplayName` | /service-centers, branches optionSource | **COVERED** |  |
| service-products-tables.php | `ensureServiceProductsTables` | migrations | **NOT-NEEDED** |  |
| simple-cache.php | `getCachedData`, `clearCache`, `coop_homepage_cache_keys`, `clearHomepageCache`, `coop_bust_public_cache` | lib/public-cache.js (home 60 s per tenant) | **COVERED** |  |
| site-license-renewal.php | `site_license_pay_id_or_default`, `ensureSiteLicenseRenewalNoticesTable`, `site_license_renewal_pending_count`, `site_license_renewal_clear_pending`, `site_license_renewal_cancel_pending`, `site_license_renewal_apply_office_notice`, `site_license_renewal_notify_vendor` | lib/license.js payInfo, admin.js /license, /license/blocked (payment notice, cancel) | **COVERED** |  |
| site-license.php | `site_license_sync_mirror_settings`, `site_license_until_bs`, `site_license_until_ad`, `site_license_until_bs_np`, `site_license_is_configured`, `site_license_expired`, `site_license_login_blocked_for_user`, `site_license_public_guard` | lib/license.js (status, guard, loginBlocked, todayKathmandu) | **COVERED** |  |
| superadmin-config.php | `file_managed_superadmin_username`, `filter_out_file_managed_superadmin_rows`, `admin_row_is_file_managed_superadmin`, `admin_user_id_is_file_managed_superadmin` | platform operators (routes/platform.js) | **NOT-NEEDED** | File-managed superadmin replaced by platform console. |
| team-chart-helpers.php | `team_resolve_chart_row`, `team_group_by_chart_rows`, `team_member_photo_src`, `team_member_distinct_name_en`, `team_staff_group_uses_chart`, `team_render_org_chart` | lib/team.js chartRow/chartRows/usesChart | **COVERED** |  |
| team-menu-categories.php | `ensureCommitteeTypesExtendedColumns`, `syncTeamMenuCategoryLinks`, `ensureTeamMenuCategoriesTable`, `teamMenuCategorySlugify`, `fetchTeamMenuCategories`, `fetchAllTeamMenuCategories`, `teamFallbackCommitteesMenuId`, `teamFallbackStaffMenuId`, `teamCommitteeBelongsToMenuCategory`, `teamStaffGroupBelongsToMenuCategory`, `healBoardAliasTeamMembers`, `healMigratedTeamNavData`, `fetchPublicNavCommittees`, `teamNavCategoryItemCount`, `teamBoardNavLabel`, `isBoardCommitteeTypeAlias`, `findBoardCommitteeTypeAlias` | lib/team.js navCategories/sections/isBoardAlias, navigation.js | **COVERED** | heal* data-repair helpers NOT-NEEDED (import normalises). |
| team-staff-groups.php | `ensureTeamStaffGroupsTable`, `teamStaffGroupSlugify`, `fetchTeamStaffGroups`, `teamStaffGroupHasActiveMembers`, `fetchPublicNavStaffGroups`, `teamStaffGroupAnchor` | lib/team.js sections, resources team_staff_groups | **COVERED** |  |
| theme-assets.php | `coopThemeIsUiTestMode`, `coopThemeCssUrl`, `coopThemeCssVer`, `coopThemeLink`, `coopThemeLinkHtml`, `coopThemeColorHex`, `coopThemeColorMeta`, `coopThemeLinkDeferred`, `coopThemeRequireGlobal`, `coopThemeGoogleFontsHtml`, `coopThemeGoogleFonts`, `coopThemeLucide`, `coopThemeLucideInit`, `toPascalCase`, `normalizeLucideNames`, `lucideIconExists`, `renderLucide`, `coopThemeDetectPanel`, `coopThemeHeadAssets`, `memberHeadAssets` | lib/themes.js, lib/icons.js (Lucide inline SVG), layouts | **COVERED** | Google Fonts/CDN Lucide intentionally dropped (CSP, self-hosted). |
| totp-2fa.php | `twoFaBase32Decode`, `twoFaGenerateSecret`, `twoFaCurrentTotp`, `twoFaVerifyCode`, `twoFaVerifyCodeOnce`, `twoFaProvisioningUri`, `twoFaQrImgTag`, `twoFaGenerateBackupCodes`, `twoFaConsumeBackupCode` | lib/totp.js (verify returns step; routes keep usedSteps → replay-safe), backupCodes/consumeBackupCode | **COVERED** | Replay guard is in-process Map (lost on restart / not shared across PM2 instances) vs PHP file lock — P3 hardening. |
| upload-gate.php | `coop_upload_gate_folders`, `coop_upload_gate_off`, `coop_upload_gate_split`, `coop_upload_grant`, `coop_upload_granted`, `coop_upload_gate_map`, `coop_upload_gate_digits`, `coop_upload_gate_row_owned`, `coop_upload_gate_member_owns`, `coop_upload_gate_deny`, `coop_upload_gate_serve` | lib/uploads.js _private storage + /admin/files/*; site-migration privatise step | **PARTIAL** | Migration privatises only single-path module/resource columns; files in gated folders referenced by comma lists, admin_attachment or nothing stay publicly served (SM-3). Applicant cannot open own uploaded docs from /member/requests (P3). |
| vendors-tables.php | `ensureVendorsTables` | modules/applications.js `vendor` | **COVERED** |  |
| welfare-claim-types.php | `welfareClaimTypesDefaults`, `welfareClaimTypeSlugify`, `welfareClaimTypeProfiles`, `ensureWelfareClaimTypes`, `welfareClaimTypesMap`, `welfareClaimTypeLabel`, `welfareClaimTypeUsageCount` | resources welfare_claim_types (profiles, requires_document), forms optionSources | **COVERED** |  |
| welfare-claims-submit-helper.php | `welfareClaimTypeLabelNp`, `welfareUploadSupportingDocuments`, `welfareUploadDeathCertificate`, `welfareHasSupportingDocuments`, `submitWelfareClaimUnified` | modules/applications.js `welfare`, hooks.welfare (claim_type_np, docs join) | **COVERED** |  |
| welfare-claims-tables.php | `ensureWelfareClaimsTables` | migrations | **NOT-NEEDED** |  |
| why-choose-tables.php | `ensureWhyChooseFeaturesTable` | /about#why, resources why_choose | **COVERED** |  |

## 5. `assets/js/*.js`

| PHP asset | Node equivalent | Status | Notes |
|---|---|---|---|
| coop-a11y.js (aria-labels for placeholder-only inputs, icon buttons) | partials/field.ejs, admin-field.ejs render real `<label>`s; icon buttons carry aria-label in views | COVERED | fixed at markup level instead of a runtime shim |
| coop-mobile.js (mobile UX) | public/js/site.js + app.css mobile-first | COVERED | |
| form-validation.js (10-digit 9XXXXXXXXX, email, inline errors) | public/js/forms.js + server forms.validate / RULES.mobile10 | COVERED | |
| information-room-viewer.js (block copy/cut/contextmenu/drag, Ctrl+S/P/C/U/A, PrintScreen, blur when hidden) | — | MISSING | SM-19 (P3) |
| init-uniformity.js (BS date inputs) | public/js/forms.js bsdate + /js/form-data.js | COVERED | |
| kyc-capture.js (camera, crop/rotate, signature pad, thumb, quality score) | public/js/kyc-capture.js + uploads.saveDataUrl | COVERED | |
| main.js (popup carousel, loader, back-to-top, counters) | public/js/site.js, app.js, partials/notice-popup.ejs | COVERED | |
| modal-focus-trap.js | site.js `trapFocus` (popup, search, chat) | COVERED | |
| nepali.datepicker.min.js (0 bytes in repo) | forms.js BS selects | NOT-NEEDED | empty file |
| pull-to-refresh.js | — | NOT-NEEDED | optional gesture, 1-public P3 "optional" — record as deliberate |
| pwa-register.js (standalone detect, install prompt, SW register) | app.js SW register, site.js `beforeinstallprompt` | COVERED | |
| scroll-accessibility.js (Nepali voice scroll, camera/tilt scroll) | — | NOT-NEEDED | 1-public lists it as optional P3; record as deliberate in docs/parity |
| search-improved.js (voice + suggestions + page index) | site.js search dialog + lib/search-index.js + /search | COVERED | |
| totp-qr.js (local QR) | server-side `qrcode` data URLs | COVERED | |
| v9-mobile-fix.js (drawer, submenu taps) | site.js nav | COVERED | |


## 6. Still missing — consolidated (after branch claude/tender-ramanujan-e5xzgu)

### P1

**SM-1 · Card verification rejects every PHP-issued derived CVV (cards then lock).** — **COVERED**: `lib/member-portal.js` `deriveCardCvv` / `derivedCvvs` / `cvvMatches` (stored or derived, case-insensitive, constant time), used by both POST /verify paths (`routes/public-members.js`); `cvv` widened to VARCHAR(20) (`065_coverage_gaps.sql`); inputs `maxlength=20` text. The stored CVV is not overwritten on success (Node-printed 4-digit CVVs stay valid). Test: `test/coverage-gaps.test.js`.
PHP (`includes/card-verify-helpers.php:89-120 deriveMemberCardCvv`, `:203-230 cvvCredentialsMatch`, `:553-610 verifyCardCredentials`, `:457-500 _finalizeCardVerifySuccess`; column widened to VARCHAR(20) at `:331`): the CVV printed on cards is *first 3 letters of the first name (Latin preferred, else Devanagari) + last 4 digits of the Member ID*, e.g. `SUJ0123`; input is compared case-insensitively against BOTH the stored `cvv` and a freshly derived one, and success re-stores the derived value.
Node: `routes/public-members.js:177` `cvv = toLatinDigits(...).slice(0, 4)` and `card.cvv !== cvv`; `lib/member-portal.js:375` strips every non-digit and keeps 4; `views/public/verify.ejs:16,25` `inputmode="numeric" maxlength="4"`. A migrated card with `cvv='SUJ0123'` can never verify; five honest tries lock it (`cardFailure`).
Spec: in `lib/member-portal.js` add `deriveCardCvv(fullName, memberNo)` (port exactly, incl. Devanagari 3-char + 'X' padding, last-4 digits zero-padded) and `cvvMatches(input, stored, derived)` (trim, remove whitespace, upper-case, constant-time compare per candidate). Use it in both POST /verify paths (code+CVV and name+ID+mobile) with derived = `deriveCardCvv(kyc.full_name_en||kyc.full_name||member.name, member.sadasyata_number||member.member_card_no||member.id)`. Accept up to 20 chars of input; change both inputs to `maxlength="20"` text (no `inputmode=numeric`). Keep 4-digit random CVVs issued by Node working (stored candidate). Tests: PHP-style card with derived CVV verifies; wrong derived CVV counts toward the lock; lowercase input accepted.

**SM-2 · Legacy `/assets/uploads/...` URLs 404.** — **COVERED**: `src/app.js` `GET /assets/uploads/*rest` → 301 `/uploads/…` (query kept); gated folders → 404 (302 to `/admin/files/_private/…` for signed-in staff); `uploads.mediaUrl` maps gated legacy paths to the private route and `assets/images/…` theme defaults to ''; migration rewrites `src=/href=` links (relative or the old `site_url` host) in every text column (`site-migration.protectGatedUploads`). Test: `test/coverage-gaps.test.js`.
PHP served `assets/uploads/<folder>/<file>` directly (`.htaccess`, `router.php:36-49`); those URLs are embedded in migrated HTML (news/notice/page bodies, CMS rich text, AI-chat context), in links shared on social media, and in settings like `assets/images/logo.png`. Node maps DB *paths* (`uploads.mediaUrl`) but has no route for the URL and `site-migration.js` does not rewrite HTML bodies.
Spec: in `src/app.js` before the public router add `app.get('/assets/uploads/*rest', …)` → 301 to `/uploads/<rest>` for non-gated folders; for gated folders (list in SM-3) → 404 (or `/admin/files/_private/<rest>` when `req.admin`). Optionally rewrite `src="(https?://old-host)?/?assets/uploads/` → `/uploads/` in rich-text columns during migration (`site-migration.js`, after copy). Also make `mediaUrl` treat `assets/images/…` defaults as `/static/img/…` or empty. Test: GET /assets/uploads/news/x.jpg → 301 /uploads/news/x.jpg; GET /assets/uploads/kyc/x.jpg → 404.

**SM-3 · Confidential files in gated folders stay public after migration.** — **COVERED**: `uploads.GATED_FOLDERS`/`isGated` (one list); `site-migration.protectGatedUploads` moves each gated folder wholesale to `_private/<folder>` (orphans included) and rewrites every single/comma-separated stored path in all text columns; the privatise step now handles comma lists; `admin_attachment` added to `fileColumns()`; `/uploads` returns 404 for gated folders; `resolveStored` falls back to the private copy for un-rewritten legacy paths. Fix-up for tenants already migrated: `node scripts/privatise-uploads.js --tenant=<slug>|--all`. Test: `test/coverage-gaps.test.js`.
PHP gated `kyc, loan, accounts, welfare_claims, grievances, digital_services, honor_applications, appointments, admin-replies, job-applications, hrm` (`includes/upload-gate.php:21-27`, `.htaccess` rule) for every file in those folders. Node `site-migration.js:243-271` privatises only files referenced by single-path module/resource file columns: comma lists (`loan_applications.documents`, `member_welfare_claims.supporting_documents` — counted as "missing"), `admin_attachment` (office replies, not a field), KYC paths not modelled as fields, and orphan files remain under `uploads/<tenant>/<folder>/` and are served by the public `/uploads` static route (`app.js:163-168`).
Spec: in `site-migration.js` after "copy uploads": move each gated folder wholesale to `_private/<folder>` (fs.renameSync dir), then for every text column of every module/resource table plus `admin_attachment`, `supporting_documents`, `documents`, rewrite each comma-separated path that starts with a gated folder to `_private/…` (SQL `regexp_replace`). Also add `admin_attachment` to `fileColumns()` as private. Add a defensive rule in the `/uploads` middleware: 404 for first segment in the gated list. Test with a fixture tenant.

### P2

**SM-4 · (merged into SM-3)** — `admin_attachment` office replies of migrated rows publicly reachable. — **COVERED** with SM-3.

**SM-5 · Members-only reports / institutional-profile files are public until first opened.** — **COVERED**: `res.reports` / `res.institutional_profile` have `privateFiles` (admin uploads go to `_private` from the start); migration step `site-migration.privatiseFileColumns` moves every migrated report / profile file to `_private` (also handles comma lists); the same runs for tenants already migrated via `scripts/privatise-uploads.js`; the lazy move in `/reports/:id/file` stays as a last resort. Test: `test/coverage-gaps.test.js`.
`routes/public.js:441-452` moves a members-only report into `_private` lazily on first access; until then `/uploads/reports/<file>` serves it to anyone. Spec: privatise rows with `access_level='member'` during migration and in the resource save hook (resources.js `reports`, `institutional_profile` afterSave: move file to `_private` when level = member, back when public).

**SM-6 · Card lookup by card number / un-hyphenated code.** — **COVERED**: `routes/public-members.js` POST /verify matches the code as typed, the code without dashes, or `card_no` without dashes (input up to 40 chars, label "code or card number"). Test: `test/coverage-gaps.test.js`.
PHP `normalizeCardLookupKey` (`card-verify-helpers.php:296-306`) and lookup `:569-575` accept `verification_code`, the code without dashes, or `card_no` without dashes. Node (`public-members.js:178`) matches `upper(verification_code)` exactly and requires ≥8 chars. Spec: `WHERE upper(verification_code)=$1 OR regexp_replace(upper(verification_code),'[^A-Z0-9]','','g')=$2 OR regexp_replace(upper(card_no),'[^A-Z0-9]','','g')=$2`; widen the input sanitiser to keep the raw then normalise.

**SM-7 · Partner-desk QR codes lose the partner.** — **COVERED**: `legacy-urls.js` `verify.php` keeps `partner`, `partner_id`, `code`, `mode`. Test: `test/coverage-gaps.test.js`.
`legacy-urls.js` `'verify.php': () => '/verify'` drops `?partner=CODE` / `?partner_id=` (PHP `verify.php:337-338`), although Node `/verify` supports both. Spec: `'verify.php': q => '/verify' + keep(q, ['partner', 'partner_id', 'code'])`. Test.

**SM-8 · Membership certificate lacks KYM details.** — **COVERED**: `routes/member.js` GET /certificate loads `kym.loadLinkedKyc` and `views/member/certificate.ejs` prints photo (owner-only `/member/kyc-print/file/photo`), father's name, DOB (BS), permanent address, citizenship (masked except last 4), account type, mobile, email. Test: `test/coverage-gaps.test.js`.
PHP `member/certificate.php:18-46,139-180`: photo, father's name, DOB, permanent address, citizenship no., account type, phone/email from the linked KYM. Node `member.js:309-317` + `certificate.ejs` print none of them. Spec: load `kym.loadLinkedKyc(req.member)` and pass `kyc`; render the photo through `/member/kyc-print/file/photo` (owner-only), mask citizenship except last 4 (CLAUDE.md PII rule), show DOB in BS via `nd`. Bilingual labels.

**SM-9 · Any staff user can void any attendance.** — **COVERED**: `lib/attendance.canVoid` (admin+/super-admin, custom role with Delete on programmes, else only `staff_admin_id = me`) enforced in `admin-programs.js` POST `/:id/attendance/:aid/void` (flash + no change) and used to hide the Void button. `actionFlag` left as `e` so staff with edit rights can still void their own records (PHP behaviour). Test: `test/coverage-gaps.test.js`.
PHP `programCanVoidAttendance` (`program-attendance-helpers.php:599-611`): role ≥ admin or explicit `d` permission on the desk; otherwise only the staff member who recorded it (`staff_admin_id = me`). Node `admin-programs.js:394-399` only requires `staff`, and `admin-perms.actionFlag` classifies `/void` as `e`. Spec: in the void route allow when `auth.roleLevel(req.admin.role) >= admin` or `perms.can(req.admin, section, 'd')` or `row.staff_admin_id === req.admin.id`; else 403 + flash. Add `void` to the delete regex in `actionFlag`. Test.

**SM-12 · In-portal status notification goes to the wrong / no member.** — **COVERED**: `lib/notify.memberForRequest` (portal id → Member ID via `kym.findMemberBySadasyata` → unique normalised phone, email deciding when shared) + `memberStatusNotification` (PHP wording: "<first name> जी … «status» … Tracking ID … Admin टिप्पणी", link `/member/requests/<module>/<id>`), used by `admin-applications.changeStatus` and the API v1 status change. Test: `test/coverage-gaps.test.js`.
Node `admin-applications.js:271-275` finds the member by `memberCol` value OR exact `phone = $1`, ignoring `member_portal_id` (stored on portal submissions, migrations 020/062) and normalised phones; a shared or reformatted phone notifies the wrong member or nobody. PHP `createMemberStatusNotification` (`member-auth.php:1481-1526`) also used email and wrote "<first name> जी, … Tracking ID … Admin टिप्पणी". Spec: resolve in order `row.member_portal_id` → `kym.findMemberBySadasyata(row[memberCol])` → `phoneDigitsSql` match on normalised phone AND (email match when present); message body as PHP; link `/member/requests/<module>/<id>`. Put it in `lib/notify.js` (`memberForRequest(mod,row)`) so api-v1 status changes reuse it.

### P3

**SM-10 · SSOT: member KYM lookups not through `kym.loadLinkedKyc`.** — **COVERED**: `ownKyc` and `/kyc-print` in `routes/member.js` now use `kym.loadLinkedKyc`. `routes/member.js:318-335` (`ownKyc`, `/kyc-print`) query `kyc_applications` by id OR `member_id = ANY(...) AND mobile = m.phone` (exact string). Replace with `kym.loadLinkedKyc(req.member)` (PHP `member-portal-identity.php`, `memberSsotLoadLinkedKyc`).

**SM-13 · Social in-app browser / crawler bounce for document links.** PHP `public-member-access.php:598-660` sends Facebook/Instagram in-app browsers and link-preview crawlers (facebookexternalhit, WhatsApp, Twitterbot…) from `report-file.php?id=` / `institutional-profile-file.php?id=` to the HTML page (OG card) unless `?nav=1` or same-site referer. Add `memberAccess.bounceSocial(req, res, pageUrl)` and call it in `/reports/:id/file` and `/institutional-profile/:id/file`; add `nav=1` to in-page links.

**SM-14 · Pending attendance requests are not closed when attendance is recorded.** — **COVERED**: `attendance.record()` closes the member's pending request (status approved, `admin_note='Closed by attendance record'`) except on the request-approval path itself. PHP `programClosePendingRequests` (`program-attendance-helpers.php:371-382`) marks the member's pending request for that programme approved when a desk/QR record succeeds. Add to `attendance.record()` after insert: `UPDATE member_program_attendance_requests SET status='approved', processed_at=now(), admin_id=$staff, admin_note='Closed by attendance record' WHERE member_id=$1 AND program_id=$2 AND status='pending'`.

**SM-15 · Public tracker: notify-channel chips and GET lookups.** Show email/SMS sent/failed/skipped chips (no reasons) per history row in `views/public/track.ejs` (PHP `application-tracker.php:1585-1620`); consider making ID+phone lookup a POST (PHP never loaded PII on GET; phone currently lands in access logs/Referer).

**SM-16 · Unmapped legacy entry points.** Add to `legacy-urls.js`: `backup-restore.php` → `/admin/backup`; `upload-file.php` → 404 (or admin files when admin); `pwa-icon.php` → `/pwa-icon-<s>.png` (clamp 192/512, `maskable`); `program-attendance-verify.php` → `/admin/programs/<program_id>#desk` (currently `/member/programs`).

**SM-17 · Legacy query params dropped.** `partner-facilities.php?type=&view=`, `sahakari-patro.php?cal_year=&cal_month=&sel_day=&tab=` (map to `/calendar?y=&m=&d=`), `institutional-profile.php?id=`, `honor-apply.php?program_id=` (→ `?program=`), `team.php?cat=`, `news.php?page=`/`notices.php?page=`.

**SM-18 · Record deliberate drops in docs/parity.** sw.js member-page offline cache + `member/offline.php` cached dashboard (privacy on shared phones), `api-public-chat.php` live chat (contact form), `scroll-accessibility.js`, `pull-to-refresh.js`, iframe `?embed=1` modes, `core/helpers.php` dead finance helpers. Also create `docs/parity/coverage.md` (CLAUDE.md §1 says it must exist; it does not).

**SM-19 · Information-room viewer deterrence + logging.** Port `assets/js/information-room-viewer.js` into `public/js/` (block copy/cut/contextmenu/dragstart, Ctrl/Cmd+S/P/C/U/A, PrintScreen; blur class on `visibilitychange`) for items with `allow_download=0`; log `view` when `/member/information-room/:id/view` is opened and log the inline fetch as `view` not `download` (`member.js:401-416`). Also move the viewer's inline `style=` into app.css (CLAUDE.md §4).

**SM-20 · Applicant cannot open own uploaded documents.** PHP `coop_upload_gate_member_owns` (`upload-gate.php:155-189`) let the member open files on their own KYC/applications. Add `GET /member/requests/:module/:id/file/:field` (ownership via `myRequests`, field must be in `mod.fileFields`, comma lists → `?i=`) using `uploads.sendStored`.

**SM-21 · TOTP replay guard is per-process.** `usedSteps` Map in `routes/admin.js:76-82`, `member-account.js:225-227`, platform.js is lost on restart (and would not be shared if PM2 ever runs >1 instance) (PHP used a locked file per scope, `totp-2fa.php:73-111`). Store the last used step in `admin_users.twofa_last_step` / `members.twofa_last_step` (new migration) with `UPDATE … WHERE twofa_last_step < $step RETURNING`.


---

# Part B


PHP: `/home/user/websourcecode` · Node: `/home/user/websitenextgen` (branch `claude/tender-ramanujan-e5xzgu`, HEAD d5b8018).
Method: every PHP file was listed; per page the POST actions / GET filters / exports were extracted (`grep $_POST/$action/$_GET`) and checked against the Node route, lib and view by reading the code (not by name). The gap specs in `docs/parity/3-admin-system.md` and `4-admin-ops.md` were re-verified one by one; nearly all of them are now implemented on this branch (noted "verified" below). DB columns were compared with a parser over `database/install.sql` vs `db/schema.sql` + `db/migrations/*.sql`, then grepped for use in `src/`, `views/`, `scripts/`, `public/js/`.

Note: `CLAUDE.md` says `docs/parity/coverage.md` maps every PHP file; **that file does not exist yet** — this matrix (with matrix A) is the material for it.

Legend: COVERED / PARTIAL / MISSING / NOT-NEEDED. Node refs: `admin.js` = `src/routes/admin.js`, `res.<key>` = `src/modules/resources.js` resource, `inbox:<key>` = `src/modules/applications.js` module served by `src/routes/admin-applications.js`.

---

## 1. admin/*.php (pages)

| PHP file | Node equivalent | Status | Actions / fields compared, gaps |
|---|---|---|---|
| _bootstrap.php | `app.js` middleware chain, `admin.js:154` requireAdmin | COVERED | |
| about-settings.php | settings tab `about` (`src/lib/setting-defs.js`) | COVERED | update_history_text (history_content_np/en richtext), upload/remove_history_photo (image + `remove_` checkbox, admin.js:620), update_about_stats (years_experience, total_services, satisfaction_rate, total_members, established_year) all in defs. |
| account-applications.php | `inbox:account` | COVERED | list/search/date/status, quick_status, update_status, delete, CSV, status cards (verified `statusCounts`). |
| admin-roles.php | `/admin/roles` (admin-tools.js:21) | COVERED | save_role, delete_role. |
| ai-settings.php | settings tab `ai` | PARTIAL | save (provider select, model + datalist, welcome NP/EN, enable) and clear_key (secret clear checkbox) covered. **Missing `test` action** (ai-settings.php:49-63: ping the provider with "Reply OK", flash provider/model/preview). |
| analytics.php | `/admin/analytics` (admin-tools.js:88) | COVERED | members growth, applications by type, monthly, KYC/member status, welfare, attendance, visitors. |
| app-features.php | `res.app_features` (minRole admin) | COVERED | add/edit/delete/toggle, is_new, icon. |
| appointments.php | `inbox:appointment` | COVERED | kind filter, preferred_date order, cards (verified). |
| auction-bids.php | `inbox:bid` (mutateRole admin, auction filter, amount order, `bidSideEffects` admin-applications.js:270) | COVERED | exclusive winner / reopen verified. |
| auctions.php | `res.auction_notices` | COVERED | area units → area text, AUC tracking no., map embed normalise, images gallery, doc kind, status filter, tracking search, delete guard (bids). quick_status = generic edit/toggle. |
| audit-log.php | `/admin/audit` (admin.js:955) | COVERED | actor/action/entity/from/to (BS or AD)/q filters, 30/page, CSV, legacy admin_activity_log UNION. |
| awards.php | `res.awards` | COVERED | description EN, awarded_by NP/EN. |
| backup-restore.php (admin) | `/admin/backup`, `/admin/backup/restore(+confirm)` (admin-system.js:53-106), `src/lib/backup-restore.js` | COVERED | .sql download → JSON backup (better, tenant-scoped); PHP .sql dumps are imported through `site-migration`/`sql-dump.js` instead. |
| careers.php | `res.careers` | COVERED | allow_online_apply, toggle, delete. |
| change-password.php | `/admin/password` (admin.js:791) | COVERED | stronger rules, other sessions bumped; PHP `activity_log` insert → audit_log. |
| committees.php | `res.committee_types/_tenures/_members` | PARTIAL | add/edit/delete type/tenure/member, is_current, show_in_navbar, icon, address, delete guards all present. **Missing: webcam photo capture** (committees.php:127-133 `webcam_photo` base64 → saveBase64Image). |
| credentials.php | `/admin/credentials` (admin-credentials.js) | COVERED | staff view/reveal, admin create/update/delete, site_logo, per-entry log (`/:id/log`). |
| dashboard.php | `/admin` + `dashboardWidgets` (admin.js:201-260) | COVERED | KYC pending/due, loans, password requests, programmes (totals/pending/recent/top), welfare tab, credentials quick launch, pending members, recent activity. |
| db-setup.php | migrations + `npm run db:migrate`, platform console | NOT-NEEDED | browser SQL runner dropped on purpose (security). |
| designations.php | `res.designations` | COVERED | delete guard (election_posts). |
| digital-service-requests.php | `inbox:digital` | COVERED | type filter, view, update_status, delete. |
| digital-service-types.php | `res.digital_service_types` + `typeGuard` | COVERED | icon, colour, requires_document, auto slug, builtin/in-use → deactivate. |
| downloads.php | `res.downloads` (bulk) | COVERED | bulk_status, file_type/download_count readonly. |
| election-candidates.php | `res.election_positions`, `res.election_candidates` | COVERED | post-master fill, deactivate when votes exist, bio_en/email/address. |
| election-information.php | `res.election_cycles`, `res.election_milestones` | COVERED | voting window validation, show_in_navbar, intro_en, detail_np/en, cascade delete / block with ballots. |
| election-posts.php | `res.election_posts` | COVERED | |
| election-results.php | `/admin/elections/:id` (+finalize, convert) | COVERED | |
| election-voting-attendance.php | `/admin/elections/:id/desk` | COVERED | mark_manual_vote. |
| error-log.php | `/admin/error-log` (+clear) | COVERED | DB log instead of file. |
| faqs.php | `res.faqs` | COVERED | bulk activate/deactivate: every resource with `is_active` now gets `bulk` (resources.js, B-7). Was: add/edit/delete/toggle, category filter covered. **`bulk_status` missing** (faqs.php:46,129) — resource lacks `bulk: true`. |
| feedbacks.php | `inbox:feedback` | COVERED | type filter, remove_attachment, note. |
| footer-settings.php | settings tab `footer` (supported_name/url) + `views/layouts/public.ejs` | COVERED | |
| gallery.php | `res.gallery_albums`, `res.gallery`, `/admin/gallery/upload`, `/admin/gallery/video` | COVERED | album CRUD + delete guard, update_media, album/media_type filters. |
| grievance-officer.php | `res.team_members` flag `is_grievance_officer` + `teamExclusiveFlags` | COVERED | |
| grievances.php | `inbox:grievance` | COVERED | quick_resolve (= quick status resolved, `resolved_at` set admin-applications.js:251), remove_attachment. |
| help-center.php | `res.chatbot_faqs` | COVERED | |
| help-guide.php | — | MISSING | 1,100-line in-app user manual (no `/admin/help` route or view). |
| honor-applications.php | `inbox:honor` | COVERED | program/category filters. |
| honor-programs.php | `res.honor_programs`, `res.honor_categories`, `/admin/honor-programs/:id/categories` | COVERED | event_label, instructions_en, show_new_badge, deactivate when used. |
| hrm-contracts / hrm-dashboard / hrm-departments / hrm-documents / hrm-employee-directory / hrm-employee-id-card / hrm-employee-view / hrm-employees / hrm-messenger (.php, 9 files) | `db/migrations/005_remove_hrm.sql` | NOT-NEEDED | HRM removed by decision (already 5-line stubs in PHP). |
| index.php (login, 2FA verify/setup/backup_ack, licence) | `admin.js:37-148`, `src/lib/auth.js` | COVERED | forced enrolment + backup-code ack, 2FA throttle, licence-blocked notice route. |
| info-officer.php | `res.team_members` `is_information_officer` | COVERED | |
| information-room-browse.php | `/admin/information-room/browse` | COVERED | |
| information-room-logs.php | `/admin/information-room/logs` | COVERED | |
| information-room-view.php | `/admin/information-room/view/:id` | COVERED | |
| information-room.php | `res.information_room_items` (bulk, fixed categories) | PARTIAL | add/edit/delete/bulk_status/allow_download covered. **`restrict_copy` flag missing** (information-room.php:109,126,280; column exists in Node schema but is never read or edited; PHP default 1 = copy-protected viewer). |
| institutional-profile.php | `res.institutional_profile` + `/admin/institutional-welfare` | COVERED | 13 indicators, FY select, BS date → month/AD, duplicate guard, private attachment, welfare_prefill → welfare routes. |
| institutional-welfare-opening.php | `/admin/institutional-welfare` (admin-welfare.js) | COVERED | |
| interest-rates.php | `res.interest_rates` | COVERED | category filter. |
| job-applications.php | `inbox:job` | COVERED | career filter, bucket, pipeline order, mark_read (`/read`). |
| kyc-applications.php | `inbox:kyc` + `/inbox/kyc/:id/link-member`, `/profile`, `kycLinkStatus`, `kym.compareShared` | COVERED | link/risk filters, link badge, divergence, from_member crumb, ssot_create_member (`upsertMemberFromKyc`), update_kyc_profile, export, quick status. |
| kyc-import-sample.php | — | NOT-NEEDED | PHP only redirected (KYM import removed). |
| kyc-risk-reviews.php | `/admin/kyc-risk-reviews` (+reviewed) | COVERED | |
| loan-applications.php | `inbox:loan` | COVERED | pending sum card, quick status (+ optional notify setting `inbox_quick_status_notify`). |
| login.php | redirect map → `/admin/login` | COVERED | |
| logout.php | POST `/admin/logout` | COVERED | |
| manage-admins.php | `/admin/users` (requireAdmin admin) | COVERED | create, assign_role, reset_password, toggle_active, delete (soft), reset_2fa (superadmin), edit name/email; `normalize_role_aliases` NOT-NEEDED (no `super_admin` alias in Node). |
| member-activities.php | `/admin/members/:id/activities(.csv)` | COVERED | partner services source added; member search goes through the members list. |
| member-import-sample.php | `/members/import/sample.csv`, `/field-sample.csv` | COVERED | father/citizenship/membership_date/monthly_saving columns. |
| member-import.php | `/admin/members/import*`, `src/lib/member-import.js` | COVERED | Chunked commit (B-2): `memberImport.commitChunk` (200 rows / request, job `running` → `done`), `status.json`, progress bar + auto-continue with back-off retries in `public/js/admin-tools.js`, Continue + Retry-failed buttons. Earlier: aliases, KYM stub soft-fill, ≤400-row ID cards, membership_date, errors.csv, field_update all present. **Commit is one synchronous request** for up to 20,000 rows (admin-members.js:206); PHP ran it as AJAX ticks with progress bar, resume and 10 retries (member-import.php:437-535). |
| member-marketplace.php | `/admin/marketplace`, `/:id` detail (marketplace.js:105-124) | COVERED | approve/reject/expire/extend/delete, inquiries, all tab. |
| member-of-year.php | `res.member_of_year` | COVERED | quote_en/achievement_en, one per year. |
| member-online-portal.php | `/admin/member-portal`, `/admin/password-requests`, `/members/:id/card(/unlock)` | COVERED | approve/reject, toggle_active, generate_id_card, unlock_card, approve_reset/reject_reset, stats, partner services, rating. |
| member-ssot-duplicates.php | `/admin/members/duplicates` (+guard) | COVERED | |
| member-success-stories.php | `res.member_success_stories` | COVERED | all EN fields + member_id_no/member_since/institution_help. |
| members.php | `/admin/members*` (admin-members.js) | COVERED | search/status/ms/kyc filters, stats strip, export, send_notif (one + bulk audience), toggle_active, toggle_information_room (`information_room_enabled`), reset_member_2fa, update_member_profile, archive/restore. |
| membership-applications.php | `inbox:membership` + `/approve` | COVERED | |
| menu-control.php | `/admin/menu-control` | COVERED | password confirm replaces PIN. |
| messages.php | `inbox:contact` | COVERED | filter/view/delete/read. |
| news.php | `res.news` (bulk) | COVERED | |
| notices.php | `res.notices` (bulk, is_popup filter) | COVERED | BS date entry (admin.js:409-415), remove_attachment / remove_popup_image via `remove_` checkbox, popup_photo_only. |
| notification-settings.php | settings tab `notify` + `/admin/notifications/test` | PARTIAL | SMTP/SMS/recipients, per-event matrix, member toggles, test covered; legacy keys mapped (`settings.mapLegacy`). **`clear_log` action missing** (notification-settings.php:117-121, delete log rows older than 30 days on demand); Node only purges >365 days in `scripts/cleanup.js`. |
| notification-templates.php | `res.notification_templates` + `/admin/notifications/template-test` | COVERED | |
| pages.php | `res.pages` + settings tab `sections` (static vision/mission/values/chairman/CEO NP+EN+titles) | COVERED | auto slug, footer position rule, menu_icon. (`is_new`/`new_until` were never editable in PHP admin either; see DB §4.) |
| partner-facilities.php | `res.partner_facilities` + `/admin/partners` (PIN, promote vendor) | COVERED | clear_pin (`setPin` null), deactivate (toggle). |
| print-form.php | `/admin/inbox/:m/:id/print` | COVERED | |
| profile.php | `/admin/profile` (admin.js:776) | COVERED | |
| program-attendance.php | `/admin/programs/register` (+ export=attendance/prereg/requests), per-programme request/prereg routes | COVERED | approve/reject/link/create_member, bulk_notify_prereg(+test), mark_prereg_attended, void, filters q/date/active_only/show_done. |
| program-dashboard.php | `/admin/programs/dashboard` | COVERED | |
| program-detail.php | `/admin/programs/:id` (+desks, void) | COVERED | |
| program-member-history.php | `/admin/programs/reports/history` (+export=csv) | COVERED | |
| program-occurrences.php | `/admin/programs/:id/occurrences(/:occ)(/delete)`, `/:id/qr` | COVERED | save/edit, delete, gen/clear QR. |
| program-registration-desk.php | `/admin/programs/:id/desk`, `/desk/lookup`, `public/js/program-desk.js` | COVERED | lookup card, eligibility, history, monthly saving, void own. |
| program-reports-absent / -breakdown / -consolidated / -duplicates / -location / -member (.php, 6 files) | `/admin/programs/reports/*` (admin-program-reports.js) | COVERED | each export=csv present. |
| program-settings.php | `/admin/programs/settings` | COVERED | |
| programs.php | `res.upcoming_programs` + `/admin/programs/:id/qr` | COVERED | multi-location, instant, shared QR, scope, gen/clear QR, toggle, deactivate-when-used. |
| push-notifications.php | `/admin/notifications/push` (+clear-expired), push log | COVERED | single-member target, type. |
| reports.php | `res.reports` | COVERED | type/FY/month/quarter selects, view_only, access_level, filters. |
| run-migration.php | `scripts/migrate.js` | NOT-NEEDED | custom SQL from browser dropped on purpose. |
| sahakari-calendar-events.php | `res.sahakari_calendar_events` | COVERED | |
| satisfaction-settings.php | `/admin/satisfaction` + `res.satisfaction_links` | COVERED | toggle_widget, link CRUD, icon. |
| security-settings.php | `/admin/security` (admin-tools.js:246) | COVERED | 2FA policy, idle minutes, Turnstile (+clear). CSP toggles NOT-NEEDED (fixed strict CSP). |
| service-centers.php | `res.service_centers` | COVERED | |
| services.php | `res.services`, `res.service_categories`, `res.service_products` | COVERED | bulk status via the generic `bulk` default (B-7). Was: cat_*/product_* CRUD, icon, nav_group, category delete guard covered. **`bulk_status` missing** (services.php:104,250) — `services` lacks `bulk: true`. |
| settings.php | `/admin/settings` (registry `setting-defs.js`) + `/admin/theme` | COVERED (himal_bg handled by the header-image work) | `hero_title`, `hero_subtitle`, `pwa_app_name`, `site_version` (admin footer) added to `setting-defs.js` (B-3). Was: ~90 keys, images with remove, secrets with clear, upload-error handling covered; colours → theme. **Not editable: `hero_title`, `hero_subtitle`** (read by `views/public/home.ejs:6`), **`pwa_app_name`** (read by `public.js:1080`), `site_version` (settings.php:47-66 textSettings), **`himal_bg` + `himal_bg_opacity`** header background photo (settings.php:293-300, `includes/header.php:52`) — no Node def, no public use. `public_ui_look` → replaced by themes (NOT-NEEDED). |
| site-health.php | `/admin/system` | COVERED | create_folder NOT-NEEDED (uploads lib creates dirs). |
| site-license-blocked.php | `/admin/license/blocked` (admin.js:116-147, rate-limited) | COVERED | |
| site-license.php | `/admin/license` (+cancel) and platform `/tenants/:id/license` | PARTIAL | cancel_renewal_pending covered; vendor email on notice covered (env). **Renewal amount / eSewa / Khalti are one global env set** (`license.payInfo`, license.js:38) instead of per-site (PHP `site_license_renewal_amount` setting, save_renewal_settings); **licence date entered in AD only** (platform.js:219; PHP save_license_date took BS). |
| site-setup.php | platform console + settings | NOT-NEEDED | cPanel setup-config / installer lock. |
| sliders.php | `res.sliders` | COVERED | |
| staff.php | — | NOT-NEEDED | redirect alias of team.php. |
| system-info.php | `/admin/system` | COVERED | |
| team-karmachari.php | — | NOT-NEEDED | alias of team.php. |
| team.php | `res.team_members`, `res.team_staff_groups`, `res.team_menu_categories` | COVERED | flags, chart_row, group/menu CRUD, icons, include_board/contact, show_in_nav, category filter, delete guards. |
| update-checklist.php | docs/DEPLOY.md | NOT-NEEDED | static checklist. |
| useful-links.php | `res.useful_links` | COVERED | is_popup, icon. |
| vendor-enlistment.php | `inbox:vendor` + `/admin/partners/promote-vendor/:vid` | COVERED | |
| welfare-claim-types.php | `res.welfare_claim_types` + `typeGuard` | COVERED | |
| welfare-claims.php | `inbox:welfare` | COVERED | under_review/paid/completed, paid_at, type filter, pending sum. |
| why-choose.php | `res.why_choose_features` | COVERED | icon. |

## 2. admin/applications/, admin/members/, admin/api/

| PHP file | Node equivalent | Status | Notes |
|---|---|---|---|
| applications/account.php | `legacy-admin-urls.js` STUBS → `/admin/inbox/account` | COVERED | |
| applications/kyc.php | STUBS → `/admin/inbox/kyc` | COVERED | |
| applications/kyc-generate-member.php | STUBS → `/admin/inbox/kyc`; logic = `/inbox/kyc/:id/link-member` | COVERED | |
| applications/kyc-view.php | STUBS → `/admin/inbox/kyc/:id` | COVERED | |
| members/index.php, add.php, edit.php, view.php | STUBS → `/admin/members(/new | /:id)` | COVERED | |
| api/member-monthly-saving.php | desk POST `monthly_saving` (admin-programs.js:262-266), KYC profile, member form | COVERED | inline save is part of the desk confirm. |
| api/program-desk-lookup.php | GET `/admin/programs/:id/desk/lookup` | COVERED | |
| api/program-live-stats.php | `/admin/programs/reports/live.json` + `public/js/program-live.js` | COVERED | |
| api/quick-search.php | `/admin/quick-search` | COVERED | |

## 3. admin/includes/ and admin/assets/

| PHP file | Node equivalent | Status | Notes |
|---|---|---|---|
| includes/admin-excel-export.php | `util.sendCsv` (BOM, formula-safe), inbox/members export | COVERED | |
| includes/admin-footer.php | `views/layouts/admin.ejs`, `public/js/admin-*.js` | COVERED | Bootstrap/jQuery/DataTables/Nepali datepicker → server search + `data-ad-date` (forms.js:92). CSRF inject N/A. |
| includes/admin-header.php | `views/layouts/admin.ejs` (sidebar, quick search, bell) | PARTIAL | bell exists (admin.ejs:75-77) but only counts inbox modules + member-portal queue. **Bell lacks: KYC risk-review due, marketplace pending, programme attendance requests** (admin-header.php:1219-1238). **"New pending requests" popup** shown once when the total grows (admin-header.php:1243-1250, 1361-1404) missing. Help-guide link missing (see help-guide). |
| includes/admin-page-boot.php | `requireAdmin` + `admin-perms` middleware | COVERED | |
| includes/admin-request-view.php | `views/admin/inbox-view.ejs` (tabs, docs grid, history with per-channel notify chips) | COVERED | |
| includes/admin-ui.php | partials (page-head, pagination…), Live/Archive tabs (resource-list.ejs:7-9), fiscal-year select (`fyOptions`) | COVERED | |
| includes/audit-log.php | `auth.audit` → `audit_log` | COVERED | |
| includes/bs-fiscal-years.php | `fyOptions` in resources.js:57 | COVERED | |
| includes/ensure-admin-tables.php | `db/schema.sql` + migrations | COVERED | runtime DDL → migrations. |
| includes/program-reports-common.php | `src/lib/program-reports.js`, `sendCsv` | COVERED | |
| includes/sql-utils.php (splitSqlStatements) | `src/lib/sql-dump.js` (import only) | NOT-NEEDED | only served the browser SQL runner. |
| assets/admin.js | `public/js/admin-inbox.js`, `admin-tools.js`, `rich-editor.js` | COVERED | CKEditor → self-hosted rich editor; modal/tab helpers N/A. |
| assets/icon-picker.js, icon-picker.css | `ICON` field type, `views/partials/admin-field.ejs:19` icon-picker, `icons.faToNode` | COVERED | |

## 4. Root files

| PHP file | Node equivalent | Status | Notes |
|---|---|---|---|
| install.php | `npm run tenant:create`, platform `/tenants` create, `tenant:admin` | COVERED | DB test/install/lock wizard is replaced by the platform console (per-tenant schema, admin, design). Contact/phone/address go in settings afterwards. |
| cron-cleanup.php | `scripts/cleanup.js` | COVERED | PHP purged activity_log 90d, login_attempts 1d, OTP; marketplace expiry. Node does more (audit 730d, errors 90d, admin_activity_log 365d…). `activity_log` itself is not in RULES (table unused in Node, harmless). Token-gated HTTP trigger NOT-NEEDED (CLI cron). |
| backup-restore.php (root) | — | NOT-NEEDED | was only a 302 to admin/backup-restore.php; no Node redirect, harmless (old bookmark → 404). |

## 5. scripts/

| PHP file | Node equivalent | Status | Notes |
|---|---|---|---|
| build-css-late-bundles.py, build-public-ui-looks.py, dedupe-app-css.py, extract-app-css-section.py, inventory-app-css.py, inventory-css-deep-audit.py, prune-app-css-dead-rules.py (7) | — | NOT-NEEDED | PHP CSS bundle tooling; Node has one design system. |
| inventory-icon-dual-read.py | — | NOT-NEEDED | FA→Lucide planning. |
| inventory-icon-db-canonicalize.php | `icons.faToNode` render-time alias | COVERED | DB keeps FA values, mapped on render. |
| deploy-pull-safe.sh | docs/DEPLOY.md, deploy/yeti | NOT-NEEDED | |
| drop-hrm-tables-safe.php | migration 005_remove_hrm.sql | COVERED | |
| generate-auth-secret.php | `SESSION_SECRET` / `CREDENTIALS_KEY` env (DEPLOY.md:27) | COVERED | PHP-signed tracker/ID-card links (`.auth-secret`) do not verify after migration (public slice). |
| migrate-program-v2.php | schema already v2 | NOT-NEEDED | |
| pii-encrypt.php | `scripts/pii.js` (`npm run pii -- status|keygen|migrate|decrypt`) | COVERED | |
| push-vapid-rotate.php | `src/lib/push.js` per-tenant auto VAPID keys | COVERED | Note: PHP site VAPID key is not imported, so migrated push subscriptions must re-subscribe (P3). |
| run-all-smokes.sh | `npm test` | COVERED | |
| run-migration-safe.php | `scripts/migrate.js` | COVERED | |
| reports/* (8 files: *.pruned.txt, *.json) | — | NOT-NEEDED | build artefacts. |
| smoke-admin-buttons.php | test/coverage-gaps.test.js "every admin <button> declares its type" | COVERED | 120 admin buttons given an explicit `type` |
| smoke-admin-permissions.php | admin-tools.test.js "permission matrix…", "custom role limits…" | COVERED | |
| smoke-cms-html.php | app.test.js "sanitizer strips…", security.test.js "rich text sanitizer…" | COVERED | |
| smoke-contact-guard.php | admin-tools.test.js "spam heuristics…", "contact form rejects link spam", security2 antispam | COVERED | |
| smoke-csp.php | test/coverage-gaps.test.js "B-1: strict CSP header…" | COVERED | header asserted on public/member/admin pages; views scanned for inline `<script>`, `on*=`, external assets. Was: no test asserts the CSP header (no `unsafe-inline`, no CDN) nor that views carry no inline `<script>`/`on*=` (only one page checked, public-parity.test.js:126). P2 because CSP is a CLAUDE.md §6 rule. |
| smoke-css-order.php | — | NOT-NEEDED | |
| smoke-deploy.php | — | NOT-NEEDED | cPanel. |
| smoke-dynamic-pages-nav.php | admin-cms-parity.test.js (menu_position/show_in_menu) | COVERED | |
| smoke-form-a11y.php | forms-member-parity.test.js + test/coverage-gaps.test.js label `for=` lint | COVERED | no global "every input with id has a label for=" lint. P3. |
| smoke-img-alt.php | test/coverage-gaps.test.js (view lint) | COVERED | every `<img>` has `alt` |
| smoke-information-room.php | admin-tools / admin-ops-parity / security tests | COVERED | |
| smoke-member-import-optional.php | admin-ops-parity.test.js (father_name / citizenship_no / membership_date) | COVERED | |
| smoke-member-marketplace.php | parity.test.js "marketplace…", forms-member-parity | COVERED | |
| smoke-menu-control.php | admin-tools.test.js "menu control hides a group…" | COVERED | |
| smoke-monthly-saving.php | members.test.js (parser, field-update import, admin) | COVERED | |
| smoke-notice-date-rbac.php | admin-cms-parity.test.js:345 (BS notice date), security.test.js "editor role cannot…" | COVERED | |
| smoke-pii-crypto.php | applications / admin-ops-parity pii tests | COVERED | |
| smoke-pretty-urls.php | members.test.js "legacy PHP URLs redirect (301)…" | COVERED | |
| smoke-program-attendance-db.php | parity.test.js "programmes: defaults…, desks, pre-reg…" | COVERED | |
| smoke-program-concurrency.php | DB unique index `member_program_attendance_uniq_scope_member_status` + sequential duplicate test (parity.test.js:195) + concurrent Promise.all test (test/coverage-gaps.test.js) | COVERED | no concurrent (Promise.all) double check-in test. P3. |
| smoke-program-ui.php | — | NOT-NEEDED | PHP UI static check. |
| smoke-public-cache.php | public-parity / parity Cache-Control tests | COVERED | |
| smoke-pull-to-refresh.php | `public/js/site.js` (feature) — no test | PARTIAL | P3 (public slice). |
| smoke-quarantine-stubs.php | legacy redirect tests | COVERED | |
| smoke-report-upload.php | app.test.js "POST without CSRF (multipart)" + over-size upload test (test/coverage-gaps.test.js) | COVERED | the over-size upload case (must report "too large", not a false CSRF error) is not tested. P3. |
| smoke-schema-ensure.php | migration.test.js | COVERED | |
| smoke-scroll-a11y.php | — | NOT-NEEDED | PHP `scroll-accessibility.js` voice widget has no Node counterpart; confirm with public slice (matrix A) that dropping it is intended. |
| smoke-security.php | security.test.js, security2.test.js, test/coverage-gaps.test.js (headers, `rel=noopener`) | COVERED | headers (X-Frame-Options/nosniff/Referrer-Policy) and `rel=noopener` tabnabbing are not asserted. P3. |
| smoke-seo.php | public-parity.test.js (sitemap/robots), admin-tools "public SEO head…" | COVERED | |
| smoke-upload-gate.php | api.test.js magic-byte, forms-member-parity saveDataUrl PHP-payload test | COVERED | |

---

## 6. database/install.sql — tables and columns

### 6.1 Schema presence
- 103 `CREATE TABLE` in `database/install.sql`; **all 103 exist in `db/schema.sql` (+ migrations) with every column** (parser comparison; the only diff was a comment parse artefact in `notification_log.module`). Node adds 15 tables (admin_roles, api_*, app_error_log, group_centres, institutional_profile_welfare, institutional_welfare_opening, member_accounts, member_documents, member_profile_change_requests, member_transactions, payment_channels, rate_disclosures).
- `db/legacy/install.sql` differs from the PHP file (older copy); `npm run schema:convert` reads it — keep it in sync or point the script at the real PHP file (P3).

### 6.2 Tables present in schema but never used by Node code

| Table | PHP use | Status | Notes |
|---|---|---|---|
| `activity_log` | written by admin/logout.php:9, change-password.php:59; never displayed by PHP | NOT-NEEDED | Node writes `audit_log`. Not purged by cleanup.js (add a rule or drop in a migration). |
| `help_topics` | read by `includes/ai-chat-context.php:488` as AI context (no PHP admin UI; help-center uses chatbot_faqs) | PARTIAL | Imported help_topics rows are silently ignored by the Node assistant. Spec: in `site-migration.js`/`import-from-mysql.js` copy active rows into `chatbot_faqs` (question=title_np, question_en=title, answer=content_np, answer_en=content, category) once. P3. |

### 6.3 Columns in schema but never read or written by Node (that carried PHP behaviour)

| Table.column | PHP behaviour | Status | Pri |
|---|---|---|---|
| `information_room_items.restrict_copy` | per-item copy protection flag (default 1), edited in information-room.php:109/126, badge :280; viewer disables copy/print | MISSING | P3 |
| `information_room_items.created_by` | admin id stamped on insert (information-room.php:109) | MISSING | P3 (resource `afterSave`/insert should stamp `created_by`) |
| `pages.is_new`, `pages.new_until` | "New" badge on dynamic page menu items until a date (`includes/header.php:419-474`); not editable in PHP admin | PARTIAL | P3 (`is_new` exists; neither shown in Node menu nor editable) |
| `kyc_applications.member_id_generated/member_generated_at/member_generated_by` | legacy stamps from the old kyc-generate-member flow (now a stub in PHP) | NOT-NEEDED | – |
| `member_program_attendance.is_priority` | shown as "Priority" badge/column (program-attendance.php:85,836) but no PHP caller ever sets it to 1 | NOT-NEEDED | – |
| `member_program_attendance.device_fingerprint` | stored on QR check-in (program-attendance-helpers.php:432,515) | MISSING | P3 (record `sha256(UA)` prefix from member QR flow; audit value only) |
| `program_audit_logs.payload_json`, `.ip_address` | void audit stored payload + IP (program-attendance-helpers.php:351) | PARTIAL | P3 (attendance.js:98 omits both) |
| `program_occurrences.venue_id` | DDL only, never used in PHP | NOT-NEEDED | – |
| `visitor_counter.page_visited/ip_address/user_agent/visit_date` | per-hit log (includes/footer.php:47) | NOT-NEEDED | Node aggregates in `visitor_stats`; table only purged. |
| `notification_templates.variables` | informational list of placeholders | NOT-NEEDED | Node shows placeholders as a hint. |
| `member_import_jobs.error_message` | job-level failure text | COVERED | `memberImport.setError` on a failed commit request, shown on the job page |
| `member_marketplace_listings.available_from/available_time_from/available_time_to` | member form fields (member/marketplace.php:121-209) | PARTIAL | shown in admin view only; check member form in matrix A. |
| application tables `tracking_id`, `is_read`, `reviewed_by/at`, `resolved_at`, `service_type_np`, `member_portal_id`, `is_member` | | COVERED | used through the generic inbox/submission code (`cols.has(...)`), verified admin-applications.js:248-251, submissions.js:75-84, public.js:924-925. |

### 6.4 Tables with PHP admin features and where they are edited in Node
Every other install.sql table is edited through `res.*`, `inbox:*` or a dedicated route listed in §1 (verified per table: content/CMS tables via resources.js; 14 application tables via applications.js; members/member_* via admin-members.js and member-portal.js; program_* via admin-programs.js; election_* via resources + admin-elections.js; office_credentials(_log) via admin-credentials.js; site_license_renewal_notices via admin.js/platform.js; login_attempts/card_verify_attempts/member_otp_tokens/member_push_* as runtime tables). `site_stats` is editable as `res.site_stats`.

---

## 7. Still missing (consolidated)

### P1
- none found in this slice. All P1 items of reports 3 and 4 (2FA policy and forced enrolment, settings registry, legacy key mapping, about sections, audit filters + legacy rows, institutional profile, delete guards, auction exclusive winner) are implemented and were verified in code.

### P2
1. **COVERED** (`test/coverage-gaps.test.js`) — **CSP regression test** (smoke-csp.php): `test/security*.test.js` — GET a public page, an admin page and a member page; assert `content-security-policy` has no `'unsafe-inline'` in `script-src` and no external host; walk `views/**/*.ejs` and fail on `<script>` without `src` or any ` on[a-z]+=` attribute.
2. **COVERED** (`memberImport.commitChunk` / `progress` / `retryFailed`; routes `/commit` (JSON or form), `/status.json`, `/retry`; test in `test/coverage-gaps.test.js`) — **Member import commit for large files** (member-import.php:437-535): commit runs inside one HTTP request for up to 20,000 rows. Spec: `POST /admin/members/import/:id/commit` sets `member_import_jobs.status='running'` and processes rows in batches of 200 via `notify.later`-style background loop (or `?step=1` ticks from `public/js/admin-tools.js`), updating `processed_rows`; `member-import-job.ejs` polls `GET /admin/members/import/:id/status.json` for a progress bar; rows already `imported` are skipped so a rerun resumes. Store failures in `member_import_jobs.error_message`.
3. **COVERED** for `hero_title`, `hero_subtitle`, `pwa_app_name`, `site_version` (`setting-defs.js`, version shown in `layouts/admin.ejs`); `himal_bg` is part of the separate header-background work — **Settings keys read by the site but not editable** (settings.php:47-66, 293-300): add to `src/lib/setting-defs.js` — `hero_title`, `hero_subtitle` (group general, text, max 200), `pwa_app_name` (general, text, max 60), `site_version` (general, text, max 20, shown in admin footer). Decide `himal_bg`/`himal_bg_opacity`: either port as theme header background (image + number 0-100 in `/admin/theme`, used by the public header) or record as deliberately dropped in docs/parity.

### P3
4. **help-guide.php**: `/admin/help` (ALWAYS in admin-perms), `views/admin/help.ejs`, bilingual sections per sidebar group linking each page; content adapted from admin/help-guide.php minus cPanel/PHP parts; link in the admin top bar.
5. **AI connection test** (ai-settings.php:49-63): POST `/admin/settings/ai-test` (admin), calls `ai-chat` provider with system "Reply with exactly: OK", user "ping", 10 s timeout; flash `Connection OK (<provider>/<model>): <first 80 chars>` or the error; button on the `ai` tab; audited.
6. **Admin bell completeness** (admin-header.php:1219-1238): add to `pendingCounts` — `_kycRisk` (`kyc_applications status='approved' AND risk_review_status='due_review'` → `/admin/kyc-risk-reviews`), `_marketplace` (`member_marketplace_listings status='pending'` → `/admin/marketplace?tab=pending`), `_attendance` (`member_program_attendance_requests status='pending'` → `/admin/programs/register?tab=requests`), each gated by `can()`/plan. Optional once-per-increase popup: store `req.session.pendingSeen`; when the total grows, render the bell open (`<details open>`), no JS modal needed.
7. **COVERED** (`resources.js`: `bulk` defaults to true for every resource with an `is_active` field) — **bulk_status for faqs and services** (faqs.php:46, services.php:104): add `bulk: true` to `res.faqs` and `res.services`.
8. **Committee webcam photo** (committees.php:127-133): optional "Take photo" button on `image` fields with `capture: true` (set on `committee_members.photo`), reusing `public/js/kyc-capture.js` camera dialog to fill the file input through DataTransfer so the normal upload path applies.
9. **Information room `restrict_copy`**: `B('restrict_copy', 'कपी रोक्ने', 'Block copy / print', { default: 1 })` on `res.information_room_items`; the member viewer adds `user-select:none`, blocks context menu/print CSS (`@media print { body { display:none } }`) when set; also stamp `created_by = req.admin.id` on create.
10. **notification log clear** (notification-settings.php:117-121): POST `/admin/notifications/clear-old` (admin, audited) → `DELETE FROM notification_log WHERE created_at < now() - interval '30 days'`.
11. **Licence per tenant** (site-license.php save_renewal_settings / save_license_date): optional per-tenant overrides `renewal_amount`, `esewa_id`, `khalti_id` on `platform.tenants` falling back to env in `license.payInfo(tenant)`; accept a BS date in platform `/tenants/:id/license` (`nd.bsToAd` when year ≥ 2050).
12. **Legacy admin redirects for CMS pages**: `src/lib/legacy-admin-urls.js` maps ~50 pages but not news/notices/pages/sliders/team/staff/team-karmachari/settings/messages/faqs/downloads/gallery/services/… (list in §1). Add `news.php → /admin/r/news`, `messages.php → /admin/inbox/contact`, `settings.php → /admin/settings`, `staff.php|team-karmachari.php|team.php → /admin/r/team_members`, etc.; root `backup-restore.php → /admin/backup`.
13. **help_topics import** into chatbot_faqs (§6.2).
14. **COVERED** (`attendance.voidAttendance` writes `payload_json` + `ip_address`; member QR check-in stores `device_fingerprint` = sha256(UA) prefix) — **Attendance audit details**: write `program_audit_logs.payload_json` + `ip_address` on void; `member_program_attendance.device_fingerprint` on member QR check-ins.
15. **pages.is_new / new_until**: show a "New" chip on dynamic-page menu items while `is_new=1 AND (new_until IS NULL OR new_until >= CURRENT_DATE)` and expose both fields on `res.pages`.
16. **COVERED** (`test/coverage-gaps.test.js`: admin button type, img alt, label for=, headers + noopener, concurrent check-in, over-size upload) — **Tests to add** (smoke parity): admin `<button>` type lint, `<img>` alt lint, label `for=` lint, security headers + `rel=noopener`, concurrent double check-in (Promise.all → one VALID row), over-size upload error message.
17. **VAPID key import**: copy the PHP site's VAPID key pair (push-vapid.local.php / settings) into `push_vapid_public/private` during site migration so existing member push subscriptions keep working.
18. `db/legacy/install.sql` is an older copy of the PHP file; refresh it or point `schema:convert` at the PHP repo copy.
19. Create `docs/parity/coverage.md` (required by CLAUDE.md §1, currently absent) from this matrix + matrix A.

---

### Counts (files in this slice)
admin/*.php (incl. 9 HRM): 123 · admin/applications+members+api: 12 · admin/includes+assets: 14 · root: 3 · scripts (incl. 8 reports, 30 smokes): 55 → **207 files**.
Status (grouped rows expanded): **COVERED 148 · PARTIAL 15 · MISSING 4 · NOT-NEEDED 40**.
PARTIAL: ai-settings, committees, faqs, information-room, member-import, notification-settings, services, settings, site-license, includes/admin-header, smoke-form-a11y, smoke-program-concurrency, smoke-pull-to-refresh, smoke-report-upload, smoke-security.
MISSING: help-guide.php, smoke-admin-buttons, smoke-csp, smoke-img-alt (the last three = missing Node tests, the behaviour itself exists).
DB: 103/103 tables and all columns present; 2 tables unused (activity_log NOT-NEEDED, help_topics PARTIAL); 6 columns with lost PHP behaviour (§6.3).
