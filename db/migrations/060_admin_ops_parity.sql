-- Admin operational parity with the PHP app (docs/parity/4-admin-ops.md). Safe to re-run.

-- ---------------------------------------------------------------- welfare claims: review + payment stage (welfare-claims.php)
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL;
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
           WHERE t.relname = 'member_welfare_claims' AND t.relnamespace = current_schema()::regnamespace
             AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ~ '\(status\)'
  LOOP EXECUTE format('ALTER TABLE member_welfare_claims DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE member_welfare_claims ADD CONSTRAINT member_welfare_claims_status_check
  CHECK (status IN ('pending', 'processing', 'under_review', 'approved', 'rejected', 'paid', 'completed'));

-- ---------------------------------------------------------------- publications: view-only reports (report-file.php)
ALTER TABLE reports ADD COLUMN IF NOT EXISTS view_only SMALLINT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------- member import parity (member-import-helpers.php)
ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_date DATE NULL;
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS father_name VARCHAR(150) NULL;
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS citizenship_no VARCHAR(512) NULL;
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS membership_date DATE NULL;

-- ---------------------------------------------------------------- settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('inbox_quick_status_notify', '0', 'text', 'Quick / bulk status change from an inbox list also SMS/emails the applicant (1/0)', 'notify')
ON CONFLICT (setting_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS member_program_attendance_attended_idx ON member_program_attendance (attended_at);
