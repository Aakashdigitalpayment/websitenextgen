-- Tenant migration: columns the PHP app added at runtime (includes/ensure-tables.php)
-- plus what the Node.js app needs. Runs inside each tenant schema. Safe to re-run.

ALTER TABLE loan_applications    ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(60);
ALTER TABLE account_applications ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(60);
ALTER TABLE kyc_applications     ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(60);
ALTER TABLE member_feedback      ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
CREATE UNIQUE INDEX IF NOT EXISTS loan_applications_tracking_uq    ON loan_applications (tracking_id);
CREATE UNIQUE INDEX IF NOT EXISTS account_applications_tracking_uq ON account_applications (tracking_id);
CREATE UNIQUE INDEX IF NOT EXISTS kyc_applications_tracking_uq     ON kyc_applications (tracking_id);

-- keep updated_at fresh (replaces MySQL "ON UPDATE CURRENT_TIMESTAMP")
CREATE OR REPLACE FUNCTION coop_touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
           WHERE c.table_schema = current_schema() AND c.column_name = 'updated_at' AND tb.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER trg_touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION coop_touch_updated_at()', t);
  END LOOP;
END $$;
