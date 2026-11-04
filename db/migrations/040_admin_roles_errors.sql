-- Admin system: custom roles (per-menu permission matrix), menu-group hiding, per-tenant error log.

CREATE TABLE IF NOT EXISTS admin_roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL DEFAULT '',
  permissions TEXT NULL,            -- JSON { "<section>": "vced" }
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS custom_role_id INTEGER NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS admin_users_custom_role_idx ON admin_users (custom_role_id);

-- server errors (HTTP 5xx) captured by the express error handler
CREATE TABLE IF NOT EXISTS app_error_log (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  status INTEGER NOT NULL DEFAULT 500,
  method VARCHAR(10),
  path VARCHAR(500),
  message TEXT,
  stack TEXT,
  code VARCHAR(60),
  admin_id INTEGER NULL,
  member_id INTEGER NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS app_error_log_created_idx ON app_error_log (created_at DESC);

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('admin_hidden_menu_groups', '[]', 'text', 'Hidden admin menu groups (JSON)', 'internal')
ON CONFLICT (setting_key) DO NOTHING;
