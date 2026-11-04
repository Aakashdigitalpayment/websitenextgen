-- Integration API for core banking (CBS) / document management (DMS) systems

-- API clients: one per external system; the secret is stored only as a SHA-256 hash
CREATE TABLE IF NOT EXISTS api_clients (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  system_type VARCHAR(20) NOT NULL DEFAULT 'cbs' CHECK (system_type IN ('cbs','dms','other')),
  key_prefix VARCHAR(24) NOT NULL UNIQUE,
  key_hash CHAR(64) NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  allowed_ips TEXT,                       -- comma separated IPs/CIDRs; empty = any
  webhook_url VARCHAR(500),
  webhook_events TEXT[] NOT NULL DEFAULT '{}',
  webhook_secret_enc TEXT, webhook_secret_iv VARCHAR(64), webhook_secret_tag VARCHAR(64),
  is_active SMALLINT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_request_log (
  id BIGSERIAL PRIMARY KEY,
  client_id INTEGER,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(300) NOT NULL,
  status SMALLINT NOT NULL,
  ip_address VARCHAR(45),
  duration_ms INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS api_request_log_client_idx ON api_request_log (client_id, created_at DESC);

-- Idempotency-Key support for writes (replayed requests get the stored response)
CREATE TABLE IF NOT EXISTS api_idempotency (
  client_id INTEGER NOT NULL,
  idem_key VARCHAR(100) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status SMALLINT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, idem_key)
);

-- Outgoing webhooks (queue with retries)
CREATE TABLE IF NOT EXISTS api_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES api_clients(id) ON DELETE CASCADE,
  event VARCHAR(60) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','delivered','failed')),
  attempts SMALLINT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_http_status SMALLINT,
  last_error VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  delivered_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS api_webhook_due_idx ON api_webhook_deliveries (status, next_attempt_at);

-- Members: change tracking for pull-sync, and the external (CBS) identifier
ALTER TABLE members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
ALTER TABLE members ADD COLUMN IF NOT EXISTS external_id VARCHAR(80);
ALTER TABLE members ADD COLUMN IF NOT EXISTS external_source VARCHAR(40);
UPDATE members SET updated_at = COALESCE(updated_at, created_at, now());
CREATE INDEX IF NOT EXISTS members_updated_idx ON members (updated_at, id);
CREATE UNIQUE INDEX IF NOT EXISTS members_external_uq ON members (external_source, external_id) WHERE external_id IS NOT NULL;
DROP TRIGGER IF EXISTS trg_touch_updated_at ON members;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION coop_touch_updated_at();

-- Accounts / loans / shares pushed from CBS (shown to the member in the portal)
CREATE TABLE IF NOT EXISTS member_accounts (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  account_no VARCHAR(60) NOT NULL,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('saving','fixed','loan','share','other')),
  product_name VARCHAR(150),
  balance NUMERIC(18,2) NOT NULL DEFAULT 0,
  interest_rate NUMERIC(6,3),
  opened_on DATE,
  maturity_date DATE,
  installment_amount NUMERIC(18,2),
  next_due_date DATE,
  overdue_amount NUMERIC(18,2),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  as_of TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE (member_id, account_no)
);
DROP TRIGGER IF EXISTS trg_touch_updated_at ON member_accounts;
CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON member_accounts FOR EACH ROW EXECUTE FUNCTION coop_touch_updated_at();

CREATE TABLE IF NOT EXISTS member_transactions (
  id BIGSERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  account_no VARCHAR(60) NOT NULL,
  txn_id VARCHAR(80) NOT NULL,
  txn_date TIMESTAMP NOT NULL,
  description VARCHAR(255),
  debit NUMERIC(18,2) NOT NULL DEFAULT 0,
  credit NUMERIC(18,2) NOT NULL DEFAULT 0,
  balance_after NUMERIC(18,2),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (member_id, account_no, txn_id)
);
CREATE INDEX IF NOT EXISTS member_transactions_recent_idx ON member_transactions (member_id, txn_date DESC);

-- Documents pushed by a DMS (stored privately)
CREATE TABLE IF NOT EXISTS member_documents (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  doc_type VARCHAR(40) NOT NULL DEFAULT 'other',
  title VARCHAR(200) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  external_ref VARCHAR(120),
  visible_to_member SMALLINT NOT NULL DEFAULT 0,
  source VARCHAR(40),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS member_documents_member_idx ON member_documents (member_id);
