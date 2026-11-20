-- Public website parity with the PHP site (docs/parity/1-public.md). Idempotent.

-- ---------------------------------------------------------------- settings read by the public pages
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('notice_ticker_enabled', '1', 'text', 'Notice ticker under the header (1 = on, 0 = off)', 'general'),
  ('site_slogan_en', '', 'text', 'Slogan (English)', 'general'),
  ('mobile', '', 'text', 'Mobile', 'contact'),
  ('google_map_url', '', 'url', 'Google Maps link (any share link)', 'contact'),
  ('map_lat', '', 'text', 'Map latitude', 'contact'),
  ('map_lng', '', 'text', 'Map longitude', 'contact'),
  ('hero_title', '', 'text', 'Home hero title (when there are no slides)', 'general'),
  ('hero_subtitle', '', 'text', 'Home hero subtitle (when there are no slides)', 'general'),
  ('logo_np', '', 'image', 'Logo (Nepali)', 'general'),
  ('logo_en', '', 'image', 'Logo (English)', 'general'),
  ('site_favicon', '', 'image', 'Favicon', 'general'),
  ('pwa_app_name', '', 'text', 'App name (PWA)', 'general'),
  ('pwa_short_name', '', 'text', 'App short name (PWA)', 'general'),
  ('twitter_url', '', 'url', 'X / Twitter', 'social'),
  ('visitor_counter_enabled', '0', 'text', 'Show the visitor counter in the footer (1 = on)', 'general')
ON CONFLICT (setting_key) DO NOTHING;
