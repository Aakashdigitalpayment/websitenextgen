-- Security hardening (review round 1)

-- Sessions are invalidated when credentials change (compared against the value stored in the session)
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE members     ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
-- Members given a temporary password must choose their own
ALTER TABLE members     ADD COLUMN IF NOT EXISTS must_change_password SMALLINT NOT NULL DEFAULT 0;

-- Secret ballot: votes no longer record who cast them (the ballot submission row does)
DROP INDEX IF EXISTS election_votes_uniq_member_pos_cand;
ALTER TABLE election_votes ALTER COLUMN member_id DROP NOT NULL;
UPDATE election_votes SET member_id = NULL WHERE member_id IS NOT NULL;

-- Throttle keys are case-insensitive
CREATE INDEX IF NOT EXISTS login_attempts_lower_user_idx ON login_attempts (lower(username), attempted_at);

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('notify_sms_daily_limit', '300', 'number', 'Max SMS per day (all recipients)', 'notify'),
  ('notify_email_daily_limit', '1000', 'number', 'Max emails per day (all recipients)', 'notify'),
  ('ai_daily_limit', '300', 'number', 'Max AI chat answers per day', 'ai')
ON CONFLICT (setting_key) DO NOTHING;
