-- Admin panel / CMS parity with the PHP app (docs/parity/3-admin-system.md). Safe to re-run.

-- ---------------------------------------------------------------- security policy (P1-1, P2-2)
-- admin_2fa_required: '0' for new tenants (opt-in); the PHP import sets '1' because the PHP app forced 2FA on every admin.
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('admin_2fa_required', '0', 'text', 'Require 2FA for every admin (1 = yes)', 'security'),
  ('admin_idle_minutes', '30', 'number', 'Admin idle sign-out (minutes)', 'security')
ON CONFLICT (setting_key) DO NOTHING;
