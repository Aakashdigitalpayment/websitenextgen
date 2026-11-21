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

-- ---------------------------------------------------------------- default policy pages linked from the footer (page.php auto-seed)
INSERT INTO pages (slug, title, title_np, title_en, content, content_np, show_in_menu, menu_position, menu_order, is_active)
SELECT 'privacy-policy', 'गोपनीयता नीति', 'गोपनीयता नीति', 'Privacy Policy',
  '<h3>Our commitment to privacy</h3><p>Our cooperative values your privacy. This policy explains what data we collect, how we use it and how we keep it safe.</p><h4>1. Information we collect</h4><ul><li>Name, address and contact details</li><li>Membership and account details</li><li>KYM documents</li></ul><h4>2. Use</h4><p>Your information is used only to provide services, meet regulatory requirements and communicate with you.</p><h4>3. Security</h4><p>We protect your data with encryption, role-based access and secure servers.</p><h4>4. Contact</h4><p>For more information please <a href="/contact">contact us</a>.</p>',
  '<h3>हाम्रो गोपनीयता प्रति प्रतिबद्धता</h3><p>हाम्रो सहकारीले तपाईंको व्यक्तिगत जानकारीको गोपनीयतालाई महत्त्व दिन्छ। यो नीतिले हामी कुन प्रकारको जानकारी सङ्कलन गर्छौं, कसरी प्रयोग गर्छौं र सुरक्षित राख्छौं भन्ने बारेमा बताउँछ।</p><h4>१. सङ्कलित जानकारी</h4><ul><li>नाम, ठेगाना, सम्पर्क विवरण</li><li>सदस्यता र खाता विवरण</li><li>केवाइएम कागजातहरू</li></ul><h4>२. प्रयोग</h4><p>तपाईंको जानकारी सेवा प्रदान गर्न, नियामक आवश्यकता पूरा गर्न र सञ्चारका लागि मात्र प्रयोग गरिन्छ।</p><h4>३. सुरक्षा</h4><p>हामी encryption, भूमिकामा आधारित पहुँच र सुरक्षित सर्भरमार्फत तपाईंको विवरण सुरक्षित राख्छौं।</p><h4>४. सम्पर्क</h4><p>थप जानकारीका लागि <a href="/contact">सम्पर्क पृष्ठ</a>मा सम्पर्क गर्नुहोस्।</p>',
  0, 'footer', 99, 1
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'privacy-policy');
INSERT INTO pages (slug, title, title_np, title_en, content, content_np, show_in_menu, menu_position, menu_order, is_active)
SELECT 'terms-of-service', 'सेवाका सर्तहरू', 'सेवाका सर्तहरू', 'Terms of Service',
  '<h3>Terms of service</h3><p>By using this website you agree to the following terms.</p><h4>1. Membership</h4><p>Membership is governed by the bylaws of our cooperative.</p><h4>2. Responsibility</h4><p>Information you provide must be truthful.</p>',
  '<h3>सेवाका सर्तहरू</h3><p>यस वेबसाइट प्रयोग गरेर तपाईं निम्न सर्तहरूमा सहमत हुनुहुन्छ।</p><h4>१. सदस्यता</h4><p>सदस्यता हाम्रो सहकारीको विनियम अनुसार सञ्चालन हुन्छ।</p><h4>२. जिम्मेवारी</h4><p>तपाईंले दिएको जानकारी सत्य हुनुपर्छ।</p>',
  0, 'footer', 99, 1
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'terms-of-service');
INSERT INTO pages (slug, title, title_np, title_en, content, content_np, show_in_menu, menu_position, menu_order, is_active)
SELECT 'cookie-policy', 'कुकी नीति', 'कुकी नीति', 'Cookie Policy',
  '<h3>Cookie policy</h3><p>We use cookies only to manage your session, remember your language and theme, and protect forms. We do not use advertising cookies.</p>',
  '<h3>कुकी नीति</h3><p>हामी सत्र सञ्चालन, भाषा र रूप सम्झन तथा फारम सुरक्षाका लागि मात्र कुकी प्रयोग गर्छौं। विज्ञापन कुकी प्रयोग गर्दैनौं।</p>',
  0, 'footer', 99, 1
WHERE NOT EXISTS (SELECT 1 FROM pages WHERE slug = 'cookie-policy');

-- ---------------------------------------------------------------- CMS pages: featured image + tags (page.php renders them when present)
ALTER TABLE pages ADD COLUMN IF NOT EXISTS featured_image VARCHAR(255) NULL;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS meta_keywords VARCHAR(255) NULL;
