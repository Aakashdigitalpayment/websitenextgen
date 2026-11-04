-- Vendor → partner facility link (legacy vendors.linked_partner_id)
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS linked_partner_id INTEGER NULL DEFAULT NULL;

-- Institutional profile: attachment served through a gated route (legacy institutional-profile-file.php)
ALTER TABLE institutional_profile ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500) NULL DEFAULT NULL;

-- Institutional welfare (legacy includes/institutional-profile-welfare.php)
CREATE TABLE IF NOT EXISTS institutional_welfare_opening (
  claim_type VARCHAR(60) PRIMARY KEY,
  opening_count INTEGER NOT NULL DEFAULT 0,
  opening_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  note VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS institutional_profile_welfare (
  id SERIAL PRIMARY KEY,
  profile_id INTEGER NOT NULL,
  claim_type VARCHAR(60) NOT NULL,
  month_count INTEGER NOT NULL DEFAULT 0,
  month_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  cum_count INTEGER NOT NULL DEFAULT 0,
  cum_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (profile_id, claim_type)
);
CREATE INDEX IF NOT EXISTS institutional_profile_welfare_idx_profile ON institutional_profile_welfare (profile_id);
