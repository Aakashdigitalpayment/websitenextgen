-- Members & member portal parity with the PHP app (self-registration, OTP reset, member 2FA,
-- Facebook sign-in, monthly saving flag, ID-card lock, profile change requests)

-- Member TOTP 2FA (same columns/format as the PHP app: base32 secret + bcrypt backup-code hashes)
ALTER TABLE members ADD COLUMN IF NOT EXISTS twofa_enabled SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE members ADD COLUMN IF NOT EXISTS twofa_secret VARCHAR(64);
ALTER TABLE members ADD COLUMN IF NOT EXISTS twofa_backup_codes TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS twofa_enabled_at TIMESTAMP NULL;

-- मासिक बचत: 1 = नियमित, 0 = नियमित नभएको, NULL = नतोकिएको (includes/member-monthly-saving.php)
ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_saving_regular SMALLINT NULL;
CREATE INDEX IF NOT EXISTS members_monthly_saving_idx ON members (monthly_saving_regular);
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS monthly_saving VARCHAR(2) NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS members_facebook_id_uq ON members (facebook_id) WHERE facebook_id IS NOT NULL AND facebook_id <> '';

-- ID card: 5 wrong CVV tries lock the card until the office unlocks it (card-verify-helpers.php lockCardOnFailure)
ALTER TABLE member_id_cards ADD COLUMN IF NOT EXISTS failed_verify_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE member_id_cards ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP NULL;
ALTER TABLE member_id_cards ADD COLUMN IF NOT EXISTS unlock_requested SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE member_id_cards ADD COLUMN IF NOT EXISTS unlock_requested_at TIMESTAMP NULL;

-- KYC documents a member may add from the portal (thumb prints were optional columns in the PHP app)
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS left_thumb VARCHAR(255);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS right_thumb VARCHAR(255);

-- Reset requests: who asked how, and why the office declined
ALTER TABLE member_password_reset_requests ADD COLUMN IF NOT EXISTS channel VARCHAR(20);

-- Profile changes that need the office (mobile number change without SMS OTP)
CREATE TABLE IF NOT EXISTS member_profile_change_requests (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  field VARCHAR(40) NOT NULL,
  old_value VARCHAR(255),
  new_value VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_id INTEGER NULL,
  admin_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  CHECK (status IN ('pending', 'approved', 'rejected'))
);
CREATE INDEX IF NOT EXISTS member_profile_change_requests_member_idx ON member_profile_change_requests (member_id, status);
-- OTPs are stored as an HMAC-SHA256 hex digest, never in plain text
ALTER TABLE member_otp_tokens ALTER COLUMN otp_code TYPE VARCHAR(128);
CREATE INDEX IF NOT EXISTS member_otp_tokens_member_idx ON member_otp_tokens (member_id, purpose, is_used);

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('facebook_app_id', '', 'text', 'Facebook app ID (member sign-in)', 'oauth'),
  ('facebook_app_secret', '', 'text', 'Facebook app secret', 'oauth'),
  ('member_self_register', '1', 'text', 'Members may register online (1 = yes, 0 = no)', 'members'),
  ('member_2fa_required', '0', 'text', 'Member 2FA (authenticator app) required for every member (1 = yes)', 'members'),
  ('card_prefix', '', 'text', 'ID card code prefix (3 letters; blank = from the site name)', 'members'),
  ('admin_notify_email', '', 'text', 'Email for member-portal alerts (password reset requests, registrations)', 'members')
ON CONFLICT (setting_key) DO NOTHING;

-- Membership number is unique (case/space-insensitive) — only added when the data is already clean;
-- otherwise Admin → Members → Duplicate member IDs lists the conflicts and adds the guard once fixed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM members WHERE deleted_at IS NULL AND trim(sadasyata_number) <> ''
    GROUP BY upper(trim(sadasyata_number)) HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS members_sadasyata_uq ON members (upper(trim(sadasyata_number)))
      WHERE deleted_at IS NULL AND trim(sadasyata_number) <> '';
  END IF;
END $$;
