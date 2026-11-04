-- Per-user theme preference ("palette.mode.epoch"); tenant defaults live in site_settings (group 'appearance').
ALTER TABLE members     ADD COLUMN IF NOT EXISTS theme_pref VARCHAR(40);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS theme_pref VARCHAR(40);

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('theme_default_palette', 'brand', 'text', 'Default theme palette', 'appearance'),
  ('theme_default_mode', 'system', 'text', 'Default theme mode', 'appearance'),
  ('theme_user_choice', '1', 'text', 'Users may change the theme', 'appearance'),
  ('theme_epoch', '0', 'text', 'Theme reset counter', 'appearance')
ON CONFLICT (setting_key) DO NOTHING;
