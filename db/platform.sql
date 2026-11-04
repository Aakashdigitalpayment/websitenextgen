-- =====================================================================
-- Platform (shared) schema — tenants registry + sessions.
-- Tenant data never lives here; each tenant has its own schema.
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS platform;

CREATE TABLE IF NOT EXISTS platform.tenants (
  id           SERIAL PRIMARY KEY,
  slug         VARCHAR(40)  NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9_]{1,39}$'),
  name         VARCHAR(200) NOT NULL,
  schema_name  VARCHAR(63)  NOT NULL UNIQUE,
  status       VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  plan         VARCHAR(40)  NOT NULL DEFAULT 'standard',
  contact_email VARCHAR(200),
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Custom domains (and subdomains) mapped to a tenant
CREATE TABLE IF NOT EXISTS platform.tenant_domains (
  id         SERIAL PRIMARY KEY,
  tenant_id  INTEGER NOT NULL REFERENCES platform.tenants(id) ON DELETE CASCADE,
  domain     VARCHAR(253) NOT NULL UNIQUE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Platform operators (manage tenants via /platform)
CREATE TABLE IF NOT EXISTS platform.operators (
  id         SERIAL PRIMARY KEY,
  username   VARCHAR(60) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  full_name  VARCHAR(120),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

-- connect-pg-simple session store (sessions carry tenant_id and are checked per request)
CREATE TABLE IF NOT EXISTS platform.user_sessions (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON platform.user_sessions (expire);

-- Site licence (per tenant). NULL = no expiry.
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS license_valid_until DATE;
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS license_note TEXT;

-- Operator 2FA + throttling; operator sessions kept apart from tenant sessions
ALTER TABLE platform.operators ADD COLUMN IF NOT EXISTS twofa_secret VARCHAR(64);
ALTER TABLE platform.operators ADD COLUMN IF NOT EXISTS twofa_enabled BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS platform.login_attempts (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45),
  attempted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_login_attempts_idx ON platform.login_attempts (username, attempted_at);
CREATE TABLE IF NOT EXISTS platform.operator_sessions (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS operator_sessions_expire_idx ON platform.operator_sessions (expire);

-- Custom domains: every tenant gets a unique generated hostname (CNAME target);
-- client domains are served only after DNS verification.
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS cname_target VARCHAR(253);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_cname_target_uq ON platform.tenants (cname_target);
ALTER TABLE platform.tenants ADD COLUMN IF NOT EXISTS redirect_to_primary BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE platform.tenant_domains ADD COLUMN IF NOT EXISTS status VARCHAR(12) NOT NULL DEFAULT 'active';
ALTER TABLE platform.tenant_domains ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;
ALTER TABLE platform.tenant_domains ADD COLUMN IF NOT EXISTS last_check_at TIMESTAMP;
ALTER TABLE platform.tenant_domains ADD COLUMN IF NOT EXISTS last_error VARCHAR(255);
ALTER TABLE platform.tenant_domains ADD COLUMN IF NOT EXISTS check_count INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE platform.tenant_domains ADD CONSTRAINT tenant_domains_status_chk CHECK (status IN ('pending','active','failed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_domains_one_primary ON platform.tenant_domains (tenant_id) WHERE is_primary;
