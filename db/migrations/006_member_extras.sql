-- Google sign-in (per tenant) and certificate settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('google_client_id', '', 'text', 'Google OAuth client ID (member sign-in)', 'oauth'),
  ('google_client_secret', '', 'text', 'Google OAuth client secret', 'oauth'),
  ('certificate_signatory', '', 'text', 'Membership certificate: signatory name', 'about'),
  ('certificate_signatory_title', 'अध्यक्ष', 'text', 'Membership certificate: signatory title', 'about')
ON CONFLICT (setting_key) DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS members_google_id_uq ON members (google_id) WHERE google_id IS NOT NULL AND google_id <> '';
