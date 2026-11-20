-- Admin panel / CMS parity with the PHP app (docs/parity/3-admin-system.md). Safe to re-run.

-- ---------------------------------------------------------------- security policy (P1-1, P2-2)
-- admin_2fa_required: '0' for new tenants (opt-in); the PHP import sets '1' because the PHP app forced 2FA on every admin.
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('admin_2fa_required', '0', 'text', 'Require 2FA for every admin (1 = yes)', 'security'),
  ('admin_idle_minutes', '30', 'number', 'Admin idle sign-out (minutes)', 'security')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------- settings registry (P1-2): tidy imported rows
-- The PHP app never set a group/type, so imported keys all sit in general/text. Give known keys their tab and input type
-- (src/lib/setting-defs.js; the admin form itself is driven by that registry, so this is cosmetic for exports / the console).
UPDATE site_settings s SET setting_group = v.grp, setting_type = v.typ
FROM (VALUES
  ('site_name', 'general', 'text'),
  ('site_name_en', 'general', 'text'),
  ('site_tagline', 'general', 'text'),
  ('site_slogan', 'general', 'text'),
  ('site_slogan_en', 'general', 'text'),
  ('logo', 'general', 'image'),
  ('logo_np', 'general', 'image'),
  ('logo_en', 'general', 'image'),
  ('site_favicon', 'general', 'image'),
  ('site_url', 'general', 'url'),
  ('pwa_short_name', 'general', 'text'),
  ('site_launch_date', 'general', 'text'),
  ('phone', 'contact', 'text'),
  ('mobile', 'contact', 'text'),
  ('email', 'contact', 'text'),
  ('address', 'contact', 'textarea'),
  ('address_en', 'contact', 'textarea'),
  ('office_address', 'contact', 'textarea'),
  ('working_hours', 'contact', 'text'),
  ('saturday_hours', 'contact', 'text'),
  ('office_time_start', 'contact', 'text'),
  ('office_time_end', 'contact', 'text'),
  ('map_embed_url', 'contact', 'url'),
  ('google_map_url', 'contact', 'url'),
  ('established_year', 'about', 'text'),
  ('registration_no', 'about', 'text'),
  ('about_short', 'about', 'textarea'),
  ('about_content', 'about', 'textarea'),
  ('about_page_image', 'about', 'image'),
  ('about_intro_image', 'about', 'image'),
  ('history_content_np', 'about', 'textarea'),
  ('history_content_en', 'about', 'textarea'),
  ('history_photo', 'about', 'image'),
  ('years_experience', 'about', 'number'),
  ('total_services', 'about', 'number'),
  ('satisfaction_rate', 'about', 'number'),
  ('total_members', 'about', 'number'),
  ('mobile_app_photo', 'about', 'image'),
  ('certificate_signatory', 'about', 'text'),
  ('certificate_signatory_title', 'about', 'text'),
  ('vision_content_title_np', 'sections', 'text'),
  ('vision_content_title_en', 'sections', 'text'),
  ('vision_content_np', 'sections', 'textarea'),
  ('vision_content_en', 'sections', 'textarea'),
  ('mission_content_title_np', 'sections', 'text'),
  ('mission_content_title_en', 'sections', 'text'),
  ('mission_content_np', 'sections', 'textarea'),
  ('mission_content_en', 'sections', 'textarea'),
  ('values_content_title_np', 'sections', 'text'),
  ('values_content_title_en', 'sections', 'text'),
  ('values_content_np', 'sections', 'textarea'),
  ('values_content_en', 'sections', 'textarea'),
  ('chairman_name', 'sections', 'text'),
  ('chairman_name_en', 'sections', 'text'),
  ('chairman_designation_np', 'sections', 'text'),
  ('chairman_designation_en', 'sections', 'text'),
  ('chairman_photo', 'sections', 'image'),
  ('chairman_message_title_np', 'sections', 'text'),
  ('chairman_message_title_en', 'sections', 'text'),
  ('chairman_message_np', 'sections', 'textarea'),
  ('chairman_message_en', 'sections', 'textarea'),
  ('ceo_name', 'sections', 'text'),
  ('ceo_name_en', 'sections', 'text'),
  ('ceo_designation_np', 'sections', 'text'),
  ('ceo_designation_en', 'sections', 'text'),
  ('ceo_photo', 'sections', 'image'),
  ('ceo_message_title_np', 'sections', 'text'),
  ('ceo_message_title_en', 'sections', 'text'),
  ('ceo_message_np', 'sections', 'textarea'),
  ('ceo_message_en', 'sections', 'textarea'),
  ('facebook_url', 'social', 'url'),
  ('youtube_url', 'social', 'url'),
  ('instagram_url', 'social', 'url'),
  ('twitter_url', 'social', 'url'),
  ('linkedin_url', 'social', 'url'),
  ('tiktok_url', 'social', 'url'),
  ('whatsapp_number', 'social', 'text'),
  ('viber_number', 'social', 'text'),
  ('play_store_url', 'apps', 'url'),
  ('app_store_url', 'apps', 'url'),
  ('internet_banking_url', 'apps', 'url'),
  ('web_login_url', 'apps', 'url'),
  ('seo_title', 'seo', 'text'),
  ('seo_title_en', 'seo', 'text'),
  ('seo_tagline', 'seo', 'text'),
  ('seo_tagline_en', 'seo', 'text'),
  ('meta_description', 'seo', 'textarea'),
  ('meta_description_en', 'seo', 'textarea'),
  ('meta_keywords', 'seo', 'text'),
  ('site_city', 'seo', 'text'),
  ('site_city_en', 'seo', 'text'),
  ('seo_og_image', 'seo', 'image'),
  ('google_site_verification', 'seo', 'text'),
  ('supported_name', 'footer', 'text'),
  ('supported_url', 'footer', 'url'),
  ('notify_email_enabled', 'notify', 'text'),
  ('smtp_host', 'notify', 'text'),
  ('smtp_port', 'notify', 'number'),
  ('smtp_encryption', 'notify', 'text'),
  ('smtp_user', 'notify', 'text'),
  ('smtp_password', 'notify', 'text'),
  ('smtp_from_email', 'notify', 'text'),
  ('smtp_from_name', 'notify', 'text'),
  ('notify_admin_emails', 'notify', 'text'),
  ('notify_email_daily_limit', 'notify', 'number'),
  ('notify_sms_enabled', 'notify', 'text'),
  ('notify_sms_gateway', 'notify', 'text'),
  ('notify_sms_api_url', 'notify', 'url'),
  ('notify_sms_token', 'notify', 'text'),
  ('notify_sms_sender_id', 'notify', 'text'),
  ('notify_sms_recipients', 'notify', 'text'),
  ('notify_sms_daily_limit', 'notify', 'number'),
  ('notify_member_email', 'notify', 'text'),
  ('notify_member_sms', 'notify', 'text'),
  ('inbox_quick_status_notify', 'notify', 'text'),
  ('ai_enabled', 'ai', 'text'),
  ('ai_provider', 'ai', 'text'),
  ('ai_model', 'ai', 'text'),
  ('ai_api_key', 'ai', 'text'),
  ('ai_welcome_np', 'ai', 'textarea'),
  ('ai_welcome_en', 'ai', 'textarea'),
  ('ai_daily_limit', 'ai', 'number'),
  ('ai_extra_context', 'ai', 'textarea'),
  ('google_client_id', 'oauth', 'text'),
  ('google_client_secret', 'oauth', 'text'),
  ('facebook_app_id', 'oauth', 'text'),
  ('facebook_app_secret', 'oauth', 'text'),
  ('turnstile_site_key', 'security', 'text'),
  ('turnstile_secret_key', 'security', 'text'),
  ('spam_block_links', 'security', 'text'),
  ('spam_math_captcha', 'security', 'text')
) AS v(key, grp, typ)
WHERE s.setting_key = v.key AND (s.setting_group IS DISTINCT FROM v.grp OR s.setting_type IS DISTINCT FROM v.typ);

-- about sections NP + EN (legacy pages.php?tab=static) and footer credit
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('values_content_np', '', 'textarea', 'Values (Nepali)', 'sections'),
  ('vision_content_en', '', 'textarea', 'Vision (English)', 'sections'),
  ('mission_content_en', '', 'textarea', 'Mission (English)', 'sections'),
  ('values_content_en', '', 'textarea', 'Values (English)', 'sections'),
  ('vision_content_title_np', '', 'text', 'Vision — title (Nepali)', 'sections'),
  ('vision_content_title_en', '', 'text', 'Vision — title (English)', 'sections'),
  ('mission_content_title_np', '', 'text', 'Mission — title (Nepali)', 'sections'),
  ('mission_content_title_en', '', 'text', 'Mission — title (English)', 'sections'),
  ('values_content_title_np', '', 'text', 'Values — title (Nepali)', 'sections'),
  ('values_content_title_en', '', 'text', 'Values — title (English)', 'sections'),
  ('history_content_np', '', 'textarea', 'History (Nepali)', 'about'),
  ('history_content_en', '', 'textarea', 'History (English)', 'about'),
  ('supported_name', '', 'text', '"Supported by" name', 'footer'),
  ('supported_url', '', 'url', '"Supported by" link (https)', 'footer')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------- PHP setting names (P1-3) for tenants imported earlier
-- (the import now maps them itself, and src/lib/settings.js also applies the mapping at read time)
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group)
SELECT DISTINCT ON (v.node) v.node, s.setting_value, 'text', v.node, v.grp FROM (VALUES
  ('ai_chat_enabled', 'ai_enabled', 'ai'), ('ai_welcome', 'ai_welcome_np', 'ai'),
  ('notify_email_recipients', 'notify_admin_emails', 'notify'), ('notify_email_from', 'smtp_from_email', 'notify'),
  ('smtp_enabled', 'notify_email_enabled', 'notify'), ('notify_smtp_enabled', 'notify_email_enabled', 'notify')
) AS v(php, node, grp)
JOIN site_settings s ON s.setting_key = v.php AND COALESCE(s.setting_value, '') <> ''
ORDER BY v.node, v.php DESC
ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value
  WHERE site_settings.setting_value IS NULL OR site_settings.setting_value = '';

-- ---------------------------------------------------------------- institutional profile: full indicator set (P1-6, legacy institutional-profile.php)
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS report_date_bs VARCHAR(60) DEFAULT '';
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS report_date_ad DATE NULL;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS report_note TEXT NULL;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS total_balance_member INTEGER DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS total_loan_reserve_fund NUMERIC(15,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS total_loan_reserve_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS share_capital_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS reserved_fund NUMERIC(18,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS reserved_fund_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS deposit_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS loan_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS liquidity_percent NUMERIC(8,2) DEFAULT 0;
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS npl_percent NUMERIC(5,2) DEFAULT 0;
-- one record per fiscal year + month (0 = annual): unique when the existing data allows it, else the form check alone
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM institutional_profile GROUP BY fiscal_year, COALESCE(report_month, 0) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS institutional_profile_fy_month_uq ON institutional_profile (fiscal_year, (COALESCE(report_month, 0)));
  ELSE
    CREATE INDEX IF NOT EXISTS institutional_profile_fy_month_idx ON institutional_profile (fiscal_year, (COALESCE(report_month, 0)));
  END IF;
END $$;

-- ---------------------------------------------------------------- CMS fields (P2-7 / P2-8)
ALTER TABLE team_staff_groups ADD COLUMN IF NOT EXISTS icon VARCHAR(80) DEFAULT 'users';
