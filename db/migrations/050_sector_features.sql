-- Nepal cooperative / microfinance sector features

-- Monthly base rate & spread disclosure (आधार दर / ब्याजदर अन्तर)
CREATE TABLE IF NOT EXISTS rate_disclosures (
  id SERIAL PRIMARY KEY,
  fiscal_year VARCHAR(10) NOT NULL,              -- e.g. 2082/83
  month_bs SMALLINT NOT NULL CHECK (month_bs BETWEEN 1 AND 12),
  base_rate NUMERIC(6,2),
  avg_deposit_rate NUMERIC(6,2),
  avg_lending_rate NUMERIC(6,2),
  spread NUMERIC(6,2),
  cost_of_fund NUMERIC(6,2),
  note TEXT,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (fiscal_year, month_bs)
);

-- Where members can deposit / pay (QR, bank account, wallet)
CREATE TABLE IF NOT EXISTS payment_channels (
  id SERIAL PRIMARY KEY,
  kind VARCHAR(20) NOT NULL DEFAULT 'bank',      -- qr | bank | wallet
  name VARCHAR(150) NOT NULL,
  name_np VARCHAR(150),
  account_name VARCHAR(150),
  account_number VARCHAR(60),
  branch VARCHAR(150),
  qr_image VARCHAR(255),
  note TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Microfinance / group centres with their meeting schedule (केन्द्र बैठक)
CREATE TABLE IF NOT EXISTS group_centres (
  id SERIAL PRIMARY KEY,
  code VARCHAR(30),
  name VARCHAR(150) NOT NULL,
  name_np VARCHAR(150),
  address VARCHAR(255),
  ward VARCHAR(20),
  meeting_frequency VARCHAR(20) NOT NULL DEFAULT 'weekly', -- weekly | fortnightly | monthly
  meeting_day SMALLINT,                          -- 0 = Sunday … 6 = Saturday (weekly / fortnightly)
  meeting_date SMALLINT,                         -- day of BS month (monthly)
  meeting_time VARCHAR(20),
  facilitator VARCHAR(150),
  phone VARCHAR(40),
  members_count INTEGER,
  service_center_id INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('protection_officer_name', '', 'text', 'Grievance officer name', 'protection'),
  ('protection_officer_phone', '', 'text', 'Grievance officer phone', 'protection'),
  ('protection_officer_email', '', 'text', 'Grievance officer email', 'protection'),
  ('protection_regulator', 'coop', 'text', 'Regulator (coop | nrb)', 'protection'),
  ('protection_extra_np', '', 'textarea', 'Additional client protection text (Nepali)', 'protection'),
  ('deposit_tax_rate', '5', 'text', 'Tax on deposit interest (%) for calculators', 'protection')
ON CONFLICT (setting_key) DO NOTHING;
