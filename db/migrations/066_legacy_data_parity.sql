-- Legacy data parity: everything a real PHP database can hold has a place here (docs/MIGRATION.md,
-- src/lib/legacy-map.js). Safe to re-run.

-- ---------------------------------------------------------------- columns the PHP app had that were lost on import
-- member_feedback.admin_attachment: office reply file (PHP ensure-tables.php adds it to every request table)
ALTER TABLE member_feedback ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500) DEFAULT '';
-- services.is_new / new_until: the "New" chip of older installs (services.php reads them when present)
ALTER TABLE services ADD COLUMN IF NOT EXISTS is_new SMALLINT DEFAULT 0;
ALTER TABLE services ADD COLUMN IF NOT EXISTS new_until DATE NULL;

-- ---------------------------------------------------------------- columns narrower than on PHP (values were cut off / rows refused)
ALTER TABLE appointments ALTER COLUMN name TYPE VARCHAR(200);
ALTER TABLE appointments ALTER COLUMN branch TYPE VARCHAR(200);
ALTER TABLE appointments ALTER COLUMN preferred_time TYPE VARCHAR(50);
ALTER TABLE gallery ALTER COLUMN media_type TYPE VARCHAR(20);

-- ---------------------------------------------------------------- import quarantine: rows the new rules refuse, kept whole until an admin fixes them
CREATE TABLE IF NOT EXISTS import_quarantine (
  id SERIAL PRIMARY KEY,
  run_id VARCHAR(80) NOT NULL,
  source_table VARCHAR(64) NOT NULL,
  source_key VARCHAR(191) NOT NULL DEFAULT '',
  target_table VARCHAR(64),
  reason VARCHAR(40) NOT NULL,
  error TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  resolved_by VARCHAR(100) NULL,
  resolution VARCHAR(20) NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS import_quarantine_src_uq ON import_quarantine (source_table, source_key) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS import_quarantine_open_idx ON import_quarantine (source_table) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------- legacy archive: source values the new model has no column for (never thrown away)
CREATE TABLE IF NOT EXISTS legacy_archive (
  id SERIAL PRIMARY KEY,
  run_id VARCHAR(80) NOT NULL,
  source_table VARCHAR(64) NOT NULL,
  source_key VARCHAR(191) NOT NULL DEFAULT '',
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('row', 'columns')),
  reason TEXT,
  data JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS legacy_archive_src_uq ON legacy_archive (source_table, source_key, kind);
