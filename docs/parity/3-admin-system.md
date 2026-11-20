# Gap report 3: admin panel (auth, system, CMS content, settings)

PHP source: `/home/user/websourcecode` (admin/*, includes/*, core/*, install.php, cron-cleanup.php, deploy/*)
Node target: `/home/user/websitenextgen`

Method: I read every PHP page in the slice and extracted its `$_POST`, `$_GET` and `$_FILES` keys, SQL tables, setting keys and special behaviours. I then compared them with `src/modules/resources.js` (the generic CRUD), `src/routes/admin*.js`, `views/admin/*`, `db/schema.sql` and `db/migrations/*`.

Main finding: for most CMS tables, **the Node schema already has the PHP columns, but `resources.js` does not expose them**. These are cheap fixes: add a field line, sometimes with a migration. The bigger gaps are:
- The settings UI is driven by database rows, so keys that were never seeded cannot be edited, and keys imported from PHP land in a mess.
- Admin 2FA is optional in Node; PHP required it for every admin.
- There is no profile page, no audit filters, and no WYSIWYG editor or BS (Nepali calendar) date entry in the generic form.
- Deletes have no referential guards.

HRM (`admin/hrm-*.php`, 9 pages) was deliberately removed in Node (`db/migrations/005_remove_hrm.sql`). It is not specified here.

---

## (a) Summary table

Legend: DONE / PARTIAL / MISSING / N/A (replaced by the platform design). Priority: P1 = do first (correctness, security, data loss, or things migrated tenants will notice); P2 = parity; P3 = nice to have.

### Auth and accounts
| PHP | Node | Status | Pri | Gap (short) |
|---|---|---|---|---|
| admin/login.php, index.php (login) | `/admin/login` (admin.js:35-46), lib/auth.js | PARTIAL | P1 | **Admin 2FA is mandatory in PHP** (enrol on first login, then verify every login). Node 2FA is opt-in. The licence-expired login has no renewal path for non-superadmins. |
| index.php 2FA verify/setup/backup_ack | `/admin/login/2fa` | PARTIAL | P1 | Node has verify only. A forced setup step at login and a backup-code acknowledgement page are missing. |
| logout.php | POST `/admin/logout` | DONE | – | |
| config.php isAdminLoggedIn (idle 30 min, UA binding) | session cookie 4h rolling (app.js:172-174) | PARTIAL | P2 | No admin idle timeout and no user-agent fingerprint. |
| profile.php (edit own full_name/email) | – | MISSING | P2 | |
| change-password.php | `/admin/password` | DONE (better: 10 chars, other sessions bumped) | – | |
| manage-admins.php | `/admin/users` (superadmin) | PARTIAL | P2 | PHP let `admin` role manage admin/editor accounts (never superadmins). Node is superadmin-only. Node cannot edit a user's full_name/email. Hard delete vs soft delete: Node is better. |
| staff.php, team-karmachari.php | – | N/A | – | Redirects / alias of team. |
| admin-roles.php | `/admin/roles` (admin-tools.js:21) | DONE | – | |
| menu-control.php | `/admin/menu-control` | DONE | – | Password confirm replaces the PIN. |
| security-settings.php (CSP toggles, Turnstile, 2FA policy) | settings tab `security` (turnstile) | PARTIAL | P1 | No admin 2FA policy toggle. The CSP toggles are not needed (Node CSP is fixed and strict), so N/A. |
| includes/totp-2fa.php | lib/totp.js | DONE | – | |
| includes/auth-roles.php, admin-permissions.php, admin-menu-control.php | lib/auth.js, lib/admin-perms.js | DONE | – | Min-role map differs slightly: PHP audit-log and error-log are admin+; Node error-log is superadmin. Acceptable. |
| site-license.php (BS date, renewal amount, eSewa/Khalti IDs, vendor email) | platform `/tenants/:id/license`, `/admin/license` | PARTIAL | P3 | No renewal amount or pay-to IDs shown to the tenant. No vendor email when a notice is submitted. Date is AD only. The tenant cannot cancel its own pending notice. |
| site-license-blocked.php | lib/license.js guard + `public/license-expired` | PARTIAL | P2 | A non-superadmin cannot submit a payment notice once expired, because login is refused. |
| includes/superadmin-config.php (file-managed superadmin) | platform operators + `npm run tenant:admin` | N/A | – | |

### Dashboard, search, logs, system
| PHP | Node | Status | Pri | Gap |
|---|---|---|---|---|
| dashboard.php | `/admin` (admin.js:122) | PARTIAL | P2 | Missing: KYC pending/incomplete and KYC due-review, loan pending, member password-reset requests, programme attendance (total, unique, pending requests, recent 10, top programmes), welfare tab (pending/review/approved, by type, recent 5), credential quick-launch tab, pending members preview (5), recent admin activity (10). |
| admin/api/quick-search.php | `/admin/quick-search` | DONE (better) | – | |
| audit-log.php (filters: admin, action, from/to date, 30/page) | `/admin/audit` | PARTIAL | P1 | No filters. Legacy `admin_activity_log` rows (imported) are never shown. |
| includes/audit.php, admin/includes/audit-log.php | auth.audit → `audit_log` | DONE | – | |
| error-log.php (file log + clear) | `/admin/error-log` (DB) | DONE (better) | – | |
| analytics.php | `/admin/analytics` | DONE | – | |
| system-info.php, site-health.php | `/admin/system` | DONE (better). Folder creation and the PHP-extension list are N/A | – | |
| update-checklist.php, run-migration.php, db-setup.php, install.php, includes/installer-lock.php, schema-migrations.php, ensure-tables.php, safe-query.php, compatibility.php, boot-shared.php, core/* | migrations + platform console | N/A | – | Running custom SQL from the browser was dropped on purpose (better). |
| backup-restore.php (.sql dump/restore) | `/admin/backup`, `/admin/backup/restore` (JSON) | DONE | – | |
| credentials.php (staff+ view/reveal, admin+ edit, `site_logo`, per-entry access log) | `/admin/credentials` (superadmin only) | PARTIAL | P2 | Role access is too narrow. No `site_logo`. No per-credential reveal-log viewer. |
| help-center.php (chatbot Q&A) | resource `chatbot_faqs` | DONE | – | |
| help-guide.php (1,100-line in-app manual) | – | MISSING | P3 | |
| print-form.php | `/admin/inbox/:m/:id/print` | DONE | – | |
| messages.php (contact messages) | inbox `contact` | DONE (inbox slice) | – | |
| cron-cleanup.php | scripts/cleanup.js | DONE | P3 | Add retention for `audit_log`, `app_error_log` and `admin_activity_log`. |
| admin header notification bell | sidebar badges | PARTIAL | P3 | No bell dropdown. |
| includes/error-handler.php | app_error_log | DONE | – | |
| includes/credentials-crypto.php | lib/credentials-crypto.js | DONE | – | |
| includes/push-vapid-config.php | lib/push.js (auto keys) | DONE | – | |
| includes/pwa-icons.php (sized 192/512 PNG from favicon/logo) | manifest uses logo as "512x512" | PARTIAL | P3 | |
| includes/qr-local.php | `qrcode` npm | DONE | – | |
| deploy/*, .cpanel.yml | docs/DEPLOY.md | N/A | – | |

### Settings pages
| PHP | Node | Status | Pri | Gap |
|---|---|---|---|---|
| settings.php (~55 text keys, 12 media keys, OAuth secrets with clear checkbox, map URL normalise, colours) | `/admin/settings` (admin.js:364-401, views/admin/settings.ejs) | PARTIAL | **P1** | The UI only shows keys that already exist as DB rows in one of 10 groups. Many keys that Node reads are never seeded, so new tenants cannot edit them. Imported PHP keys all land in `general/text`. Image uploads are hard-coded to 5 keys, and other image rows break the multipart parse; the upload error is then ignored. Secrets cannot be cleared, and images cannot be removed. Favicon, logo_np/logo_en and other media are missing. |
| about-settings.php (history_content_np/en, history_photo, stats) | settings `about` | PARTIAL | P2 | No history text. history_photo is uploaded but unused. years_experience, total_services, satisfaction_rate, total_members are not editable. |
| pages.php?tab=static (vision/mission/values/chairman/ceo, NP+EN + titles) | settings `about` (NP textarea only for some) | PARTIAL | P1 | No `values_content_np` row. No English versions of vision/mission/values. No rich text. |
| footer-settings.php (supported_name, supported_url) | – | MISSING | P3 | The footer has no "supported by" credit. |
| site-setup.php | platform + member-portal (card_prefix) | N/A | – | |
| ai-settings.php (provider, model pick and custom, welcome NP/EN, enable) | settings `ai` | PARTIAL | P1 | Key names differ from PHP (`ai_chat_enabled`, `ai_welcome_np/en`), so the AI is silently off after migration. Provider and model are free text, not selects. Single welcome text. |
| notification-settings.php (SMTP, SMS, recipients, per-event email/SMS toggles, test) | settings `notify` + `/admin/notifications/test` | PARTIAL | P1 | Key renames not mapped (`notify_email_recipients`, `notify_email_from`, `smtp_enabled`, `notify_member_enabled`). No per-event toggles `notify_email_<event>` / `notify_sms_<event>`. |
| notification-templates.php (CRUD + test send to email) | resource `notification_templates` | PARTIAL | P3 | No "send test of this template". |
| push-notifications.php (target one member, type, push log, clear expired subs) | `/admin/notifications/push` (broadcast only) | PARTIAL | P2 | |
| satisfaction-settings.php | `/admin/satisfaction` + resource `satisfaction_links` | PARTIAL | P3 | No `icon`. |
| app-features.php | resource `app_features` | PARTIAL | P3 | No `icon`. PHP was admin+ only. |
| includes/public-ui-look.php, settings colours | `/admin/theme` | DONE (different design) | – | |

### CMS content CRUD (resources.js)
| PHP page | Node resource | Status | Pri | Missing (columns already in schema unless marked *new*) |
|---|---|---|---|---|
| sliders.php | `sliders` | DONE | – | PHP cropped to 1920×600. Node keeps the original plus variants, which is fine. |
| news.php | `news` | DONE | – | |
| notices.php | `notices` | PARTIAL | P2 | Popup expiry is entered in BS in PHP; Node uses an AD date input. |
| pages.php (dynamic) | `pages` | PARTIAL | P2 | `menu_icon`, `menu_position=footer`, auto-slug when blank. |
| faqs.php | `faqs` | DONE | – | |
| downloads.php | `downloads` | PARTIAL | P3 | `download_count` and `file_type` not shown in the list. |
| gallery.php (+albums) | `gallery`, `gallery_albums`, `/admin/gallery/upload` | PARTIAL | P2 | Deleting an album that still has media is allowed (orphans). No album filter on the list. |
| awards.php | `awards` | PARTIAL | P2 | `description` (EN), `awarded_by` label wrong. |
| team.php | `team_members`, `team_staff_groups`, `team_menu_categories` | PARTIAL | P2 | `team_menu_categories.icon`, `team_staff_groups.icon` (*new*), `position_np`. No category filter. |
| designations.php | `designations` | PARTIAL | P3 | No delete guard (used by election_posts). |
| committees.php | `committee_types`, `committee_tenures`, `committee_members` | PARTIAL | P2 | `committee_types.icon`, `committee_members.address`, webcam photo capture. |
| services.php (+categories, +products) | `services`, `service_categories`, `service_products` | PARTIAL | P2 | `services.icon`, `services.nav_group`. No delete guard on categories. |
| interest-rates.php | `interest_rates` | PARTIAL | P3 | No list filter by category (saving/loan). |
| useful-links.php | `useful_links` | PARTIAL | P3 | `icon`. |
| why-choose.php | `why_choose_features` | PARTIAL | P2 | `icon` (the public "why choose us" cards use an icon). |
| service-centers.php | `service_centers` | DONE | – | |
| reports.php | `reports` | PARTIAL | P2 | `report_type` should be a select of 8 types. `view_only` (*new column*). Month/quarter only for monthly/quarterly. No type filter. |
| institutional-profile.php | `institutional_profile` | PARTIAL | **P1** | 13 *new* columns (percentages, reserve funds, NPL, liquidity, BS/AD report date, note). FY+month duplicate check. FY select. |
| grievance-officer.php, info-officer.php | `team_members` flags + `teamExclusiveFlags` | DONE | – | |
| member-of-year.php | `member_of_year` | PARTIAL | P2 | `quote_en`, `achievement_en`. One per year (upsert). |
| member-success-stories.php | `member_success_stories` | PARTIAL | P2 | `location_en`, `profession_en`, `member_id_no`, `member_since`, `institution_help_np/en`. |
| sahakari-calendar-events.php | `sahakari_calendar_events` | PARTIAL | P3 | `description_en`. No year filter. |
| digital-service-types.php | `digital_service_types` | PARTIAL | P2 | `icon`, `color`, auto-slug. Delete must deactivate when built-in or in use. |
| welfare-claim-types.php | `welfare_claim_types` | PARTIAL | P2 | Same as digital-service-types. |
| careers.php | `careers` | DONE | – | |
| auctions.php (content side) | `auction_notices` | PARTIAL | P2 | `description_en`, `google_map_embed`, `area_bigha/ropani/aana/paisa` with auto `area` text, `images` (gallery JSON), auto `tracking_number`, doc type limited to pdf/doc/docx, search/status filter, quick status. |
| *generic*: CKEditor on content fields | plain textarea + sanitizer | MISSING | P2 | |
| *generic*: BS date entry (PHP `coop-date-ui`) | AD `<input type=date>` | MISSING | P2 | |
| *generic*: icon picker (admin/assets/icon-picker.*) | – | MISSING | P2 | |
| *generic*: live/archived subtabs and counts (admin-ui.php:397-430) | single list | PARTIAL | P3 | |
| *generic*: list filters per resource | search box only | PARTIAL | P2 | |
| *generic*: delete guards, deactivate-instead-of-delete | `beforeDelete` only on election_posts | PARTIAL | P2 | |
| *generic*: soft-deleted records | no trash/restore UI | PARTIAL | P3 | Node is better than PHP, which hard-deleted, but deleted rows cannot be restored. |

### Where PHP was better
1. All admins (including superadmin) were forced into TOTP enrolment at first login.
2. Admin idle timeout of 30 min plus user-agent fingerprint.
3. Settings and media were hand-built forms with validation per key, image remove/clear, and secret clear checkboxes.
4. About sections had bilingual rich text.
5. Institutional profile had 13 more indicators and a duplicate guard.
6. Type tables (digital/welfare) could not be deleted while in use or built-in.
7. Album delete guard.
8. Audit-log filters.
9. Per-event notification toggles and single-member push.
10. Credentials were usable by staff.

---

## (b) Implementation specs

Conventions used below:
- New migration file: `db/migrations/060_admin_cms_parity.sql`. It is applied to every tenant by `npm run db:migrate`. Use `ADD COLUMN IF NOT EXISTS` and `INSERT … ON CONFLICT (setting_key) DO NOTHING`.
- Field helpers are from `src/modules/resources.js` (T, TA, RT, N, D, B, IMG, FILE, SEL, REF, ORDER, ACTIVE).
- All new admin routes go under the existing routers. Every new path must be registered in `src/lib/admin-perms.js` (EXTRA, ALIASES, ALWAYS or SUPER_ONLY), otherwise custom-role users fail closed.

---

### P1-1 Admin 2FA policy and forced enrolment at login
PHP: `admin/index.php:380-405` (after the password check: if `twofa_enabled` is false, set `admin_2fa_pending = {mode:'setup', secret}`; otherwise `{mode:'verify'}`), 155-262 (verify / setup / `backup_ack` branches), 453-460 (QR provisioning), 621-660 (views). The policy text is in `admin/security-settings.php:68-86` ("all admins incl. superadmin mandatory"). The licence check runs before 2FA (index.php:373-379).

Node changes:
- Settings key `admin_2fa_required` (default `'0'` for new tenants; set `'1'` when importing a PHP site to keep PHP behaviour). Seed in the 060 migration: `('admin_2fa_required','0','text','Require 2FA for every admin (1 = yes)','security')`.
- `src/lib/auth.js adminLogin()` (lines 53-76): after the licence check, if `!user.twofa_enabled` and `settings.get('admin_2fa_required') === '1'`, set `req.session.pending2fa = { id, tenantId, at, mode: 'setup', secret: totp.generateSecret() }` and return `{ needs2fa: 'setup' }`. Keep `mode: 'verify'` for enrolled users.
- `src/routes/admin.js`:
  - GET `/login/2fa`: when `mode === 'setup'`, render a QR code with `QRCode.toDataURL(totp.provisioningUri(siteName, username, secret))` and the secret.
  - POST `/login/2fa` in setup mode: verify the code against `p.secret`, then `totp.backupCodes()`. UPDATE `admin_users SET twofa_enabled=1, twofa_secret, twofa_backup_codes, twofa_enabled_at=now()`. Render a "save these backup codes" page (`admin/login-2fa` with `codes`), whose "Continue" button POSTs `/login/2fa/ack`, which calls `auth.completeAdminLogin`. This mirrors PHP `backup_ack`.
  - Add `/login/2fa/ack` before `router.use(requireAdmin…)`.
- `/admin/2fa/disable` (admin.js:596): refuse when the policy is on.
- `/admin/users` action `reset2fa` stays (the user re-enrols at next login).
- UI: add the toggle to `/admin/security` (P1-1b), or as a superadmin-only checkbox on the `security` settings tab.
- `/admin/system` check row (admin-system.js:42) already shows 2FA coverage. Fine.

### P1-1b Superadmin "Security" page
PHP `admin/security-settings.php:13-40`. Node: GET/POST `/admin/security` in `src/routes/admin-tools.js`, `requireAdmin('superadmin')`; add `/security` to SUPER_ONLY in admin-perms.js. Fields:
- `admin_2fa_required` (checkbox)
- `member_2fa_required` (move here or link to `/admin/member-portal`)
- `turnstile_site_key`
- `turnstile_secret_key` (blank keeps the existing value; a `turnstile_clear_secret` checkbox clears it)
- `admin_idle_minutes` (see P2-2)

Audit `security_settings_update`. Sidebar link in `views/layouts/admin.ejs` (System group).

### P1-2 Settings: a key registry instead of DB-row-driven forms
Problems found:
- (a) `views/admin/settings.ejs:8` only renders existing rows whose `setting_group` is one of 10 tabs. New tenants have no rows for keys Node reads: `values_content_np`, `years_experience`, `site_slogan(_en)`, `address_en`, `office_time_start`, `office_time_end`, `google_map_url`, `twitter_url`, `pwa_short_name`, `site_url`, `office_address` (checked against `src/lib/tenants.js:104-131` and the migrations).
- (b) Every PHP key arrives with group `general` and type `text` (legacy `site_settings` defaults, `db/legacy/install.sql:91-93`; PHP `updateSetting()` never sets a group). After migration the General tab holds about 100 keys, with images and long HTML shown as text inputs.
- (c) `admin.js:376-379` passes multer exactly 5 file fields. Any other `image`-type row renders `file_<key>`, which makes multer abort with "Unexpected field". The POST handler (admin.js:380) never checks `req.uploadError` and flashes "Settings saved" on a partial body.
- (d) Images cannot be removed. Secrets cannot be cleared.

Spec:
1. New `src/lib/setting-defs.js`: an ordered array of `{ key, group, type: text|textarea|richtext|image|color|url|email|number|bool|select|secret, label:[np,en], options?, max?, hint?, normalize? }`, plus `byKey`. It contains every key the app reads. Built from PHP `admin/settings.php:47-55` (textSettings), 160-330 (media), `about-settings.php`, `footer-settings.php`, `ai-settings.php`, `notification-settings.php`, plus the Node keys listed in `tenants.js` DEFAULT_SETTINGS and the migrations. Tabs:
   - general: site_name, site_name_en, site_tagline, site_slogan, site_slogan_en, logo, logo_np, logo_en, site_favicon, site_url, pwa_short_name, site_version, site_launch_date
   - contact: phone, mobile, email, address, address_en, office_address, working_hours, saturday_hours, office_time_start, office_time_end, map_embed_url, google_map_url
   - about: established_year, registration_no, about_short, about_content, about_page_image, about_intro_image, history_content_np (richtext), history_content_en (richtext), history_photo, years_experience, total_services, satisfaction_rate, mobile_app_photo, chairman_* and ceo_* fields (already seeded in migration 041)
   - social: facebook_url, youtube_url, instagram_url, twitter_url, whatsapp_number
   - apps: play_store_url, app_store_url, internet_banking_url, web_login_url
   - seo: existing keys
   - footer: supported_name, supported_url
   - notify, ai, oauth, security: as today
2. `settings.ejs`: iterate over `defs.filter(d => d.group === tab)`. The value comes from `settings.all()`, so a missing row shows as empty. Render by `def.type`:
   - `secret`: password input, plus a "clear" checkbox `clear_<key>`
   - `image`: thumbnail, a `remove_<key>` checkbox, and a file input
   - `richtext`: same editor as P2-5
   - `select`: options
   - Also show an "Other (imported)" tab, superadmin only, listing DB keys that have no def, read-only. This helps with migrations.
3. POST `/admin/settings`:
   - Build the multer field list from `defs.filter(type==='image')`.
   - If `req.uploadError`, flash the error and do not report success.
   - For each def in the posted `_tab`: normalise (hex colour; `google_map_url` through an embed normaliser, porting PHP `includes/google-map-embed.php normalizeGoogleMapEmbedUrl`; http(s)-only URLs with `/^https?:\/\//`; max lengths: meta_description 400, meta_keywords 500, seo_title 70, seo_tagline and site_city 120).
   - `settings.set(key, val, {type, group, label})` upserts, so rows get created.
   - Secrets: blank keeps the value; `clear_<key>` sets `''`.
   - Images: `remove_<key>` sets `''` and deletes the old file through `uploads.remove`.
4. Migration 060: `UPDATE site_settings SET setting_group = …, setting_type = …` for known keys whose group is `general` (makes imported tenants tidy). Insert missing defaults (`ON CONFLICT DO NOTHING`).
5. Public use (other slice, but needed for parity):
   - `site_favicon` goes into `<link rel=icon>` in `views/layouts/public.ejs:11` (fall back to logo).
   - `logo_np`/`logo_en` are chosen by language.
   - `supported_name`/`supported_url` go in the footer at line 125.
   - `history_content_*` and `history_photo` go on the about page.

### P1-3 Legacy setting-key mapping on import
PHP keys that Node reads under other names:

| PHP key | Node key |
|---|---|
| `ai_chat_enabled` | `ai_enabled` |
| `ai_welcome_np` / `ai_welcome_en` | `ai_welcome` (or keep both and change `src/lib/ai-chat.js` to pick by `req.lang`; preferred) |
| `notify_email_recipients` | `notify_admin_emails` |
| `notify_email_from` | `smtp_from_email` (if empty) |
| `smtp_enabled` / `notify_smtp_enabled` | `notify_email_enabled` (if empty) |
| `notify_member_enabled = '0'` | set `notify_member_email = notify_member_sms = '0'` |

Implement as an idempotent SQL block in migration 060, for example:
`INSERT INTO site_settings(setting_key,setting_value,setting_group) SELECT 'ai_enabled', setting_value, 'ai' FROM site_settings WHERE setting_key='ai_chat_enabled' ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value WHERE site_settings.setting_value IS NULL OR site_settings.setting_value=''`.
Also run the same mapping at the end of `src/lib/site-migration.js` and `scripts/import-from-mysql.js`. PHP references: `admin/ai-settings.php:20-45`, `admin/notification-settings.php:41-60`, `includes/notifications.php`.

### P1-4 About sections editor (vision / mission / values / chairman / CEO, NP+EN)
PHP `admin/pages.php:60-98`: keys `<k>_np`, `<k>_en`, `<k>_title_np`, `<k>_title_en` for k in `vision_content`, `mission_content`, `values_content`, `chairman_message`, `ceo_message`.

Node:
- Add these to setting-defs, group `about`, type `richtext`.
- Seed in 060: `values_content_np`, `vision_content_en`, `mission_content_en`, `values_content_en`, `vision_content_title_np/en`, `mission_content_title_np/en`, `values_content_title_np/en`. `chairman_message_en` and the titles already exist from migration 041.
- Change `src/routes/public.js:94-103` to pick `_en` when `req.lang === 'en'` and to use the stored titles.
- Optionally add an `/admin/about-sections` page with five cards, each with title NP/EN and content NP/EN. Otherwise the settings `about` tab is enough.

### P1-5 Audit log: filters and legacy rows
PHP `admin/audit-log.php:30-110`: filters `admin_id`, `action_type` (distinct dropdown), `from_date`, `to_date`; 30 per page; joins the admin name.

Node `src/routes/admin.js:625-630` and `views/admin/audit.ejs`:
- Query params `actor` (id), `action` (from `SELECT DISTINCT action FROM audit_log ORDER BY 1 LIMIT 200`), `entity` (entity_type), `from`, `to` (BS or AD; convert with `lib/nepali-date`), and `q` (summary ILIKE).
- Build WHERE with `$n` params. The actor dropdown comes from `SELECT DISTINCT actor_id, actor_name FROM audit_log WHERE actor_type IN ('admin','superadmin')`.
- Add CSV export (`?format=csv`, limit 50k) and a detail expander for `old_values`/`new_values` JSON.
- Legacy: in migration 060, insert `admin_activity_log` rows into `audit_log` once:
  `INSERT INTO audit_log(actor_type,actor_id,actor_name,action,entity_type,entity_id,summary,ip_address,created_at) SELECT 'admin', l.admin_id, a.username, l.action, COALESCE(l.target_type,'legacy'), l.target_id, left(COALESCE(l.details::text,''),255), l.ip, l.created_at FROM admin_activity_log l LEFT JOIN admin_users a ON a.id=l.admin_id WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE entity_type='legacy_marker')`
  Then insert a marker row, or guard with a `schema_migrations` check, since migrations run once anyway.

### P1-6 Institutional profile: the full indicator set
PHP `admin/institutional-profile.php:38-60` (columns), 98-200 (save, duplicate check, BS→month auto-fill, attachment), 80-96 (welfare prefill AJAX; Section 8 welfare rows are in the welfare slice, `src/routes/admin-welfare.js`).

Migration 060:
```
ALTER TABLE institutional_profile
  ADD COLUMN IF NOT EXISTS report_date_bs VARCHAR(60) DEFAULT '',
  ADD COLUMN IF NOT EXISTS report_date_ad DATE NULL,
  ADD COLUMN IF NOT EXISTS report_note TEXT NULL,
  ADD COLUMN IF NOT EXISTS total_balance_member INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_loan_reserve_fund NUMERIC(15,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_loan_reserve_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS share_capital_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_fund NUMERIC(18,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reserved_fund_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loan_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS liquidity_percent NUMERIC(8,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS npl_percent NUMERIC(5,2) DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS institutional_profile_fy_month_uq ON institutional_profile (fiscal_year, COALESCE(report_month,0));
```
Check for duplicates before creating the unique index. If duplicates exist, create a non-unique index instead and rely on `beforeSave`.

`resources.js` `institutional_profile` fields, in this order:
- fiscal_year: SEL with `optionsFn` = the last 10 BS fiscal years. Port `admin/includes/bs-fiscal-years.php` into `lib/nepali-date`.
- report_month: SEL 0-12 with Nepali month names (0 = annual).
- report_date_bs, report_date_ad
- total_members, total_balance_member, total_loan_members
- share_capital, share_capital_percent
- reserved_fund, reserved_fund_percent
- other_fund, bank_cash_balance, fixed_assets, total_assets
- deposit, deposit_percent
- loan, loan_percent
- total_loan_reserve_fund, total_loan_reserve_percent
- npa_percent, npl_percent, liquidity_percent (step 0.01)
- profit_loss
- report_note (TA)
- access_level, attachment_path, ACTIVE

`beforeSave`:
- If report_month is 0 and report_date_bs matches `^\d{4}-(\d{2})`, set the month from it.
- If report_date_bs is set and report_date_ad is empty, fill AD with `nd.bsToAd`.
- Duplicate check: `SELECT id FROM institutional_profile WHERE fiscal_year=$1 AND COALESCE(report_month,0)=$2 AND id<>$3`. On a hit, return the error `{ fiscal_year: 'यो आ.व./महिनाको प्रोफाइल पहिले नै छ / already exists for this FY and month' }`.

The public view `views/public/institutional-profile.ejs` should show the new indicators (public slice).

---

### P2-1 Profile page (own name / email)
PHP `admin/profile.php:10-18`. Node: GET/POST `/admin/profile` in admin.js. Add it to ALWAYS in admin-perms.js. Fields: full_name (required, max 100), email (optional, valid, lowercased, max 100). `UPDATE admin_users SET full_name, email`. Audit `profile_update`. Add a link in the admin top bar user menu (`views/layouts/admin.ejs`, next to `/admin/password` and `/admin/2fa`).

### P2-2 Admin idle timeout and session fingerprint
PHP `includes/config.php:2900-2935`: idle of `ADMIN_SESSION_IDLE` (default 1800 s, minimum 300); UA hash must match; the IP /24 key is refreshed, not enforced.

Node `src/lib/auth.js loadUsers()` (after line 141):
- Keep `req.session.adminSeen` (timestamp) and `req.session.adminUa` (sha256(UA) first 16 characters).
- If `Date.now() - adminSeen > idleMs`, where idleMs = `max(5, Number(settings.admin_idle_minutes) || 30) * 60_000`, or the UA does not match: drop `adminId`, then `flash` "session expired".
- Update `adminSeen` on each request.
- Set `adminUa` in `completeAdminLogin`.
- Member sessions are unchanged.

### P2-3 Admin-user management for the `admin` role, and edit name/email
PHP `admin/manage-admins.php:1-60` (has_role('admin'); `$maTargetIsSuper` guard), 68-300 (create, assign_role, reset_password, toggle_active, delete, reset_2fa superadmin-only).

Node `src/routes/admin.js:455-510`:
- Change `requireAdmin('superadmin')` to `requireAdmin('admin')` on `/users`.
- When `req.admin` is not a superadmin:
  - Allowed roles on create and role change are `admin`, `staff`, `editor` (never superadmin).
  - Every action on a target whose `roleLevel >= 4` is refused.
  - Self role change and disable are refused (already done for disable).
  - `reset2fa` stays superadmin-only.
- Remove `/users` from SUPER_ONLY in admin-perms.js and add it to EXTRA as `['admin_users', ['प्रशासक प्रयोगकर्ता','Admin users'], 'system', ['/users']]`.
- New action `edit` (full_name, email).
- `views/admin/users.ejs`: an inline edit form per row.

### P2-4 Dashboard widgets
PHP `admin/dashboard.php:40-160`. Node `src/routes/admin.js:122-139` and `views/admin/dashboard.ejs`. Add to the KPI row and the tabs. Each query is wrapped in `safe()` and gated by `res.locals.can(section)`:
- KYC pending: `SELECT count(*) FROM kyc_applications WHERE status IN ('pending','incomplete') AND deleted_at IS NULL`. Due review: `status='approved' AND risk_review_status='due_review'`. Link `/admin/kyc-risk-reviews`.
- Loans pending: `loan_applications status='pending'`.
- Password requests: `member_password_reset_requests status='pending'`. Link `/admin/password-requests`.
- Programme: `count(*)` and `count(DISTINCT member_id)` from `member_program_attendance`; `member_program_attendance_requests status='pending'`; recent 10 (program_title, member_card_no, attended_at, members.name); top 8 by program_title.
- Welfare: counts for pending, under_review and approved from `member_welfare_claims`; by claim_type with `sum(claim_amount)`; recent 5.
- Pending members preview: 5 rows from `members WHERE approval_status='pending'`.
- Credentials quick-launch: `SELECT id, site_name, site_url, username, category FROM office_credentials WHERE is_active=1 ORDER BY category, sort_order, site_name`. Show only when `can('credentials')` (see P2-9). Open the URL plus a copy-username button. Reveal stays on `/admin/credentials`.
- Recent activity: 10 rows from `audit_log` (actor_name, action, summary, created_at). Admin+ only.

Layout: tabs Office | Members | Welfare | Programmes | Credentials (CSS-only tabs or `?tab=`).

### P2-5 Rich-text editor for `richtext` fields
PHP `admin/assets/admin.js:215-245` uses CKEditor 5 (toolbar: heading, bold, italic, link, bulleted/numbered list, undo/redo).

Node CSP forbids CDN scripts. Bundle a small editor under `public/js/vendor/`; candidates are a self-hosted Quill 1.3.7 or Trix 2.x (around 90 KB). Init from `public/js/admin.js` on `textarea[data-richtext]`. In `views/partials/admin-field.ejs` add `data-richtext` when `fl.type === 'richtext'`. The server keeps `util.sanitizeHtml` (admin.js:229). Allowed tags must include whatever the editor emits (p, h2, h3, strong, em, a[href], ul, ol, li, br, blockquote).

### P2-6 BS (Nepali) date entry for `date` fields
PHP admin pages accept BS `YYYY-MM-DD` and convert to AD (for example `admin/notices.php:56-81`, `includes/coop-date-ui.php`).

Node:
- In `admin-field.ejs`, for `fl.type === 'date'` render a text input with `data-bsdate`, value = `nd.adToBs(val)`, and a hint showing the AD equivalent. Keep a hidden AD field, or convert on the server.
- `readResourceForm` (admin.js:224): if the value matches `^\d{4}-\d{2}-\d{2}$` and the year is 2000 or later (BS range 2000-2100), convert with `nd.bsToAd`. The site setting `admin_date_input = 'bs'|'ad'` (default `bs`) picks the mode.
- Optionally add a small BS date picker using `lib/nepali-date` month tables, exposed to the browser via `/static/js/nepali-date.js`.

### P2-7 Icon field type and picker
PHP `admin/assets/icon-picker.js` and `icon-picker.css` stored Font Awesome classes ("fas fa-star"). Node renders icons with `src/lib/icons.js icon(name)`, a set of about 56 SVG icons.

- Add field type `icon`: a `<select>` (or a grid of radio buttons) over `require('../lib/icons').names`, previewed with `icon(name)`.
- Add `faToNode(cls)` to `icons.js` (map: star→star, link→link, users→users, phone→phone, file-lines→file, …; unknown→info). Apply it at render time, so imported FA values still display.
- Expose `icon` on:
  - `services` (also `nav_group`)
  - `service_categories` (already a text field; switch it to the icon type)
  - `useful_links`, `why_choose_features`, `app_features`, `satisfaction_links`
  - `digital_service_types`, `welfare_claim_types`
  - `committee_types`, `team_menu_categories`
  - `pages` (`menu_icon`)
  - `team_staff_groups` (*new column* `icon VARCHAR(80) DEFAULT 'users'`)
- `services.nav_group`: SEL general/social/student/financial/other (PHP `admin/services.php:79`).

### P2-8 Expose existing columns that `resources.js` does not show
Add these field lines; the columns already exist in `db/schema.sql`:
- `awards`: `TA('description', 'विवरण (English)', 'Description (English)')`. Relabel `awarded_by` as "Awarded by (English)".
- `pages`:
  - `menu_icon` (icon type)
  - add `['footer','फुटर','Footer']` to the `menu_position` options. PHP maps it to `about` when `show_in_menu`, so keep that rule in `beforeSave` (pages.php:117-121).
  - `beforeSave`: if `slug` is blank, set it to `util.slugify(title_en || title_np)`, falling back to `'page-' + Date.now()`.
- `committee_members`: `TA('address','ठेगाना','Address')`.
- `committee_types`: `icon`.
- `team_members`: `position_np` (hidden; keep it in sync with `position`).
- `member_of_year`:
  - fields `TA('quote_en')`, `TA('achievement_en')`
  - `beforeSave`: if another row has the same `spotlight_year`, return an error. PHP upserts on the year (member-of-year.php:70).
- `member_success_stories`: `T('location_en')`, `T('profession_en')`, `T('member_id_no')`, `T('member_since')`, `TA('institution_help_np')`, `TA('institution_help_en')`.
- `sahakari_calendar_events`: `TA('description_en')`. Change `event_type` to a SEL. Add a list filter on `bs_year` (P2-11).
- `digital_service_types`, `welfare_claim_types`:
  - `icon`, and `T('color', …, {type:'color'})`
  - `slug` not required; in `beforeSave`, generate it from `name_en`/`name_np` with a uniqueness suffix (digital-service-types.php:55-72)
  - make `slug` read-only on edit (add a `readonlyOnEdit` flag to admin-field)
- `auction_notices`:
  - `RT('description_en')`, `TA('google_map_embed', hint 'iframe src URL')`
  - `N('area_bigha')`, `N('area_ropani')`, `N('area_aana')`, `N('area_paisa')`
  - `beforeSave` builds `area` = "x बिगाहा y रोपनी …" when `area` is blank (auctions.php:101-106)
  - on create, `tracking_number = 'AUC-' + 6 digits + '-' + YYMM` (auctions.php:113), or `util.trackingId('AUC')`
  - `images`: see P2-12
  - `document`: the FILE kind should be `doc` (pdf/doc/docx only; auctions.php:84-97). Extend `resourceUpload` (admin.js:238-243) to honour `f.kind`.
  - list fields: tracking_number, status
- `downloads`: show `download_count` read-only in the list (add a `readonly` field type that renders the value only).
- `reports`:
  - `report_type` becomes SEL monthly/quarterly/progress/annual/financial/audit/agm/other (reports.php:38, 202-210)
  - `report_month`: SEL with BS months
  - `report_quarter`: SEL Q1-Q4
  - `beforeSave` nulls month/quarter when the type does not match (reports.php:107-108)
  - *new column* `view_only SMALLINT NOT NULL DEFAULT 0` with `B('view_only','डाउनलोड बन्द (हेर्ने मात्र)','View only (no download)')`. The public file route `/reports/:id/file` must serve `Content-Disposition: inline` and hide the download button when `view_only=1`.

### P2-9 Office credentials access and fields
PHP `admin/credentials.php:8` (`require_role('staff')` to view and reveal, admin+ to mutate), 52-80 (reveal log via `ajax=log`), 90 (`site_logo`).

Node `src/routes/admin-credentials.js`:
- Remove `/credentials` from SUPER_ONLY in admin-perms.js and add it to EXTRA (`['credentials', ['पासवर्ड भण्डार','Office credentials'], 'system', ['/credentials']]`).
- Guard GET and reveal with `requireAdmin('staff')`; create, edit and delete with `requireAdmin('admin')`.
- Add `site_logo` (URL text, blank means `https://<host>/favicon.ico`). Check whether the column exists (it was in the PHP INSERT; add it in 060 if missing).
- Add GET `/credentials/:id/log`, which lists audit_log rows where `entity_type='office_credentials' AND entity_id=:id`. It works if reveal already audits; verify that it does.

### P2-10 Notifications: per-event toggles, targeted push, push log
PHP `admin/notification-settings.php:70-76`: per-event `notify_email_<ev>` and `notify_sms_<ev>` for ev in loan_application, grievance, digital_service, honor_application, kyc_application, appointment, account_application, job_application, contact_message, member_marketplace.

Node:
- In the settings `notify` tab, add a matrix with a row per module and two checkboxes. Store `notify_email_<module.key>` and `notify_sms_<module.key>` ('1' by default when absent).
- In `src/lib/notify.js adminEvent()` (lines 208-227): skip email when `s['notify_email_' + mod.key] === '0'`, and SMS likewise.
- Map the PHP event names to Node module keys in the P1-3 migration (loan_application→loan, kyc_application→kyc, account_application→account, job_application→job, contact_message→contact, honor_application→honor, digital_service→digital).

PHP `admin/push-notifications.php:43-118`. Node `/admin/notifications/push` (admin.js:549-560):
- Add `target_member_id` (member search: reuse the `/admin/quick-search` members group, or a `<select>` over the most recent 500 approved members) and `type` (info/success/warning/error, stored in `member_notifications.type`).
- When targeted, insert one notification and call `push.sendToMember(id, payload)`. Add that function to lib/push.js if missing.
- Show `member_push_log` (last 50, joined to members and member_notifications) on `/admin/notifications`.
- Add POST `/admin/notifications/push/clear-expired` (`DELETE FROM member_push_subscriptions WHERE created_at < now() - interval '90 days'`).

PHP `admin/notification-templates.php:41`: test send. Add a row action on resource `notification_templates`: POST `/admin/notifications/templates/:id/test` with `to`. Render the template with sample vars and call notify.sendEmail or sendSms.

### P2-11 List filters for generic resources
Add `filters: [{ name, type: 'select'|'year'|'bool', options|optionsFn|ref }]` to the resource definition. `GET /r/:resource` (admin.js:170-188) reads `req.query['f_'+name]` and adds `col = $n` to WHERE when the column exists. `views/admin/resource-list.ejs` renders selects in the toolbar. Apply to:
- interest_rates (category)
- team_members (category)
- gallery (album_id, media_type)
- reports (report_type, report_year)
- sahakari_calendar_events (bs_year)
- auction_notices (status)
- faqs (category)
- downloads (category)
- committee_members (tenure_id)
- service_products (service_id)
- notices (is_popup)

Also add a generic `?active=1|0` filter with tab counts for "Live / Archive" (PHP `admin/includes/admin-ui.php:397-430`). Extend search to include `tracking_number` for auctions.

### P2-12 Auction extra images (gallery)
PHP `admin/auctions.php:62-80` stores `images` as a JSON array of paths, keeps existing ones, and appends new ones.

Node:
- New field type `images` (multiple). In `resourceUpload`, use `{ name, kind:'image', maxCount: 10 }`.
- `readResourceForm`: merge `JSON.parse(existing.images || '[]')` minus the `remove_images[]` checkboxes, plus the uploaded array, then store `JSON.stringify`.
- `admin-field.ejs`: a thumbnail grid with remove checkboxes.

### P2-13 Delete guards and deactivate-instead-of-delete
Add `beforeDelete` (returns [np, en] to block) or a new `deleteMode` hook (returns `'deactivate'`) in resources.js:
- `gallery_albums`: block if `SELECT count(*) FROM gallery WHERE album_id=$1 AND deleted_at IS NULL` > 0 (PHP gallery.php:57-66).
- `digital_service_types`: if `is_builtin=1` or `SELECT count(*) FROM digital_service_requests WHERE service_type=<slug>` > 0, run `UPDATE … SET is_active=0` and flash "deactivated instead" (digital-service-types.php:104-125).
- `welfare_claim_types`: same, against `member_welfare_claims.claim_type` (welfare-claim-types.php:120-135).
- `service_categories`: block if services reference it.
- `committee_types`: block if tenures exist.
- `committee_tenures`: block if members exist.
- `designations`: block if election_posts reference it.
- `team_staff_groups`: block if `team_members.category = slug`.
- `team_menu_categories`: block if groups or committees reference it.

Implement in `POST /r/:resource/:id/delete` and in the bulk-delete path (admin.js:282-331; bulk currently skips `beforeDelete`, so call it per id).

### P2-14 Licence: let non-superadmins send a payment notice after expiry
PHP `admin/site-license-blocked.php:26-60`, rate-limited to 20 per hour.

Node:
- In `src/lib/auth.js adminLogin`: when `license.loginBlocked`, stash `req.session.licenseBlocked = { tenantId, at, username }` and redirect to `/admin/license/blocked`, a public route placed before `requireAdmin`.
- That page shows the expiry, the renewal amount and the pay-to IDs, plus the form (gateway, txn_reference, note). It POSTs to the same `INSERT INTO site_license_renewal_notices` as admin.js:617, with `submitted_by_username` from the stash. Rate-limit 20/h/IP with `lib/security`.
- Platform side: add `renewal_amount`, `esewa_id`, `khalti_id`, `vendor_email` to the licence form for each tenant in `src/routes/platform.js:216` (store them on `platform.tenants` or a `platform.settings` row). Show them on `views/admin/license.ejs`. Email `vendor_email` when a notice is submitted (`notify.sendEmail`).
- Accept a BS date in the platform licence form (convert with `nd.bsToAd`).
- Tenant action: POST `/admin/license/cancel` (`UPDATE site_license_renewal_notices SET status='cancelled' WHERE status='pending'`). PHP site-license.php:38-42.

### P2-15 Notices popup expiry
Covered by P2-6 (BS date entry). PHP also checked that only BS input is accepted (notices.php:56-81). Optional: show the "currently live popup(s)" count in the notices list header.

---

### P3 items (short specs)
- **footer-settings**: keys `supported_name`, `supported_url` (https only) in setting-defs group `footer`. In `views/layouts/public.ejs:124-126` append "Supported by <a>" when set. PHP footer-settings.php:20-40.
- **help-guide**: static bilingual manual at `/admin/help` (`views/admin/help.ejs`), sectioned by sidebar group, linking each page. Content adapted from PHP `admin/help-guide.php`; skip PHP/cPanel-specific sections. Add it to ALWAYS.
- **Header notification bell**: in `views/layouts/admin.ejs`, a dropdown that sums `res.locals.pendingCounts` plus member-portal and password-request counts, each linking to its inbox.
- **PWA icons**: GET `/pwa-icon-:size.png` (192, 512) renders `site_favicon || logo` with sharp (`fit: contain`, white background) and caches under `uploads/<slug>/_pwa/`. Update the manifest in `src/routes/public.js:611-618`. PHP `includes/pwa-icons.php`.
- **Trash for soft-deleted resources**: `/admin/r/:resource/trash` lists `deleted_at IS NOT NULL`, with restore (`deleted_at = NULL`) and purge (hard delete plus file removal). Superadmin only for purge.
- **AI settings UX**: `ai_provider` as SEL gemini/openai/deepseek. `ai_model` as SEL per provider plus "custom" (PHP ai-settings.php:29-45, 156-170). `ai_welcome_np` and `ai_welcome_en` instead of a single `ai_welcome`.
- **Retention**: in `scripts/cleanup.js` add `['audit_log', "created_at < now() - interval '730 days'"]`, `['app_error_log', "created_at < now() - interval '90 days'"]`, `['admin_activity_log', "created_at < now() - interval '365 days'"]`.
- **Committee member webcam photo**: PHP committees.php:127-131 posts a base64 `webcam_photo`. Node: an optional "Take photo" button on image fields (`getUserMedia` into a canvas) that fills a hidden `<input type=file>` through a DataTransfer object, so the normal upload path, magic-byte check and variants all apply.
- **Downloads**: show `file_type` and `download_count` in the list.
- **app_features min role**: PHP was admin+ (auth-roles.php:179). Add `minRole: 'admin'` if parity is wanted.
- **Interest rates / calendar list grouping**: covered by P2-11 filters.

---

## Files to touch (rollup)
- `db/migrations/060_admin_cms_parity.sql`: institutional_profile columns; reports.view_only; team_staff_groups.icon; office_credentials.site_logo (if missing); setting seeds and regrouping; legacy key mapping; admin_activity_log → audit_log copy.
- `src/lib/setting-defs.js` (new), `views/admin/settings.ejs`, `src/routes/admin.js` (settings POST, audit filters, profile, users for the admin role, push targeting, licence-blocked route).
- `src/lib/auth.js` (2FA setup mode, idle timeout, UA binding, licence-blocked stash).
- `src/routes/admin-tools.js` (`/security`, `/help`, template test), `src/lib/admin-perms.js` (new sections, ALWAYS, SUPER_ONLY changes).
- `src/modules/resources.js` (fields, beforeSave/beforeDelete, filters, icon/images types).
- `views/partials/admin-field.ejs` (icon, images, richtext editor hook, BS date, readonly), `views/admin/resource-list.ejs` (filters, live/archive).
- `public/js/admin.js` plus a vendored editor; `src/lib/icons.js` (`faToNode`).
- `src/lib/notify.js` (per-event toggles), `src/lib/push.js` (`sendToMember`).
- `src/routes/admin-credentials.js` (roles, site_logo, log), `src/routes/platform.js` and `views/admin/license.ejs` (renewal contact info).
- `views/admin/dashboard.ejs` (widgets), `views/admin/audit.ejs` (filters), new `views/admin/profile.ejs`, `views/admin/security.ejs`, `views/admin/help.ejs`, `views/admin/license-blocked.ejs`.
- `src/routes/public.js` (vision/mission/values EN, favicon, footer credit: public slice, listed for completeness).
