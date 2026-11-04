-- Member CSV import: keep Nepali name and (hashed) initial password per row
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS name_np VARCHAR(255);
ALTER TABLE member_import_rows ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
CREATE INDEX IF NOT EXISTS member_import_rows_job_idx ON member_import_rows (job_id, row_num);

-- Programme attendance: one VALID check-in per member per programme/occurrence
CREATE UNIQUE INDEX IF NOT EXISTS member_program_attendance_valid_uq
  ON member_program_attendance (member_id, program_id, COALESCE(occurrence_id, 0)) WHERE attendance_status = 'VALID';
CREATE UNIQUE INDEX IF NOT EXISTS member_program_preregistrations_uq ON member_program_preregistrations (member_id, program_id);

-- Office credential manager: AES-256-GCM auth tag
ALTER TABLE office_credentials ADD COLUMN IF NOT EXISTS password_tag VARCHAR(64);
