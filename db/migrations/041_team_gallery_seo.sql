-- Team (leadership flags, org-chart rows, staff groups / navbar menu categories), gallery videos,
-- SEO / anti-spam / widget / leadership-message settings.

-- team_members.category may now also hold a staff-group slug or "cmt_<committee id>" (legacy PHP behaviour)
DO $$
DECLARE c text;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'team_members'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE team_members DROP CONSTRAINT %I', c);
  END LOOP;
END $$;
ALTER TABLE team_members ALTER COLUMN category TYPE VARCHAR(60);
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS is_chairman SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS is_ceo SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS chart_row SMALLINT NOT NULL DEFAULT 0; -- 0 = auto, 1–5 = manual org-chart row

ALTER TABLE committee_types ADD COLUMN IF NOT EXISTS menu_category_id INTEGER NULL DEFAULT NULL;
ALTER TABLE committee_types ADD COLUMN IF NOT EXISTS icon VARCHAR(80) NULL DEFAULT NULL;

-- default navbar categories (same seed as the PHP site)
INSERT INTO team_menu_categories (slug, name_np, name_en, icon, source_type, include_contact_officers, include_board, display_order, is_active, show_in_nav)
SELECT * FROM (VALUES
  ('management', 'व्यवस्थापन', 'Management', 'fas fa-briefcase', 'staff', 1, 0, 10, 1, 1),
  ('committees', 'समिति / उपसमिति', 'Committees / Subcommittees', 'fas fa-sitemap', 'committees', 0, 1, 20, 1, 1)
) AS v(slug, name_np, name_en, icon, source_type, include_contact_officers, include_board, display_order, is_active, show_in_nav)
WHERE NOT EXISTS (SELECT 1 FROM team_menu_categories);
CREATE UNIQUE INDEX IF NOT EXISTS team_menu_categories_slug_uq ON team_menu_categories (slug);

-- gallery: YouTube videos next to photos
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS media_type VARCHAR(10) NOT NULL DEFAULT 'photo';
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS video_url VARCHAR(500) NULL;
ALTER TABLE gallery ADD COLUMN IF NOT EXISTS thumbnail VARCHAR(500) NULL;
ALTER TABLE gallery ALTER COLUMN image DROP NOT NULL;

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  -- SEO
  ('seo_title', '', 'text', 'SEO title (Nepali, home page, ≤70)', 'seo'),
  ('seo_title_en', '', 'text', 'SEO title (English, home page, ≤70)', 'seo'),
  ('seo_tagline', '', 'text', 'SEO tagline (Nepali)', 'seo'),
  ('seo_tagline_en', '', 'text', 'SEO tagline (English)', 'seo'),
  ('meta_description_en', '', 'textarea', 'SEO description (English)', 'seo'),
  ('meta_keywords', '', 'text', 'Meta keywords (comma separated)', 'seo'),
  ('site_city', '', 'text', 'City / location (Nepali)', 'seo'),
  ('site_city_en', '', 'text', 'City / location (English)', 'seo'),
  ('google_site_verification', '', 'text', 'Google site verification code', 'seo'),
  ('seo_og_image', '', 'image', 'Share image (1200×630)', 'seo'),
  -- anti-spam
  ('turnstile_site_key', '', 'text', 'Cloudflare Turnstile site key', 'security'),
  ('turnstile_secret_key', '', 'text', 'Cloudflare Turnstile secret key', 'security'),
  ('spam_block_links', '1', 'text', 'Block links / promo text in messages (1 = on)', 'security'),
  -- floating widgets
  ('satisfaction_widget_enabled', '0', 'text', 'Satisfaction widget', 'internal'),
  -- leadership messages
  ('chairman_name', '', 'text', 'Chairperson name (Nepali)', 'about'),
  ('chairman_name_en', '', 'text', 'Chairperson name (English)', 'about'),
  ('chairman_photo', '', 'image', 'Chairperson photo', 'about'),
  ('chairman_designation_np', 'अध्यक्ष', 'text', 'Chairperson designation (Nepali)', 'about'),
  ('chairman_designation_en', 'Chairman', 'text', 'Chairperson designation (English)', 'about'),
  ('chairman_message_title_np', '', 'text', 'Chairperson message title (Nepali)', 'about'),
  ('chairman_message_title_en', '', 'text', 'Chairperson message title (English)', 'about'),
  ('chairman_message_en', '', 'textarea', 'Chairperson message (English)', 'about'),
  ('ceo_name', '', 'text', 'CEO name (Nepali)', 'about'),
  ('ceo_name_en', '', 'text', 'CEO name (English)', 'about'),
  ('ceo_photo', '', 'image', 'CEO photo', 'about'),
  ('ceo_designation_np', 'प्रमुख कार्यकारी अधिकृत', 'text', 'CEO designation (Nepali)', 'about'),
  ('ceo_designation_en', 'Chief Executive Officer', 'text', 'CEO designation (English)', 'about'),
  ('ceo_message_title_np', '', 'text', 'CEO message title (Nepali)', 'about'),
  ('ceo_message_title_en', '', 'text', 'CEO message title (English)', 'about'),
  ('ceo_message_en', '', 'textarea', 'CEO message (English)', 'about')
ON CONFLICT (setting_key) DO NOTHING;
