-- Applications parity with the PHP app: full KYM, office reply attachments, internal notes,
-- welfare claim type fields, PII-ready columns, per-module notification templates. Safe to re-run.

-- ---------------------------------------------------------------- KYC / KYM (online-kyc.php v10.4 columns)
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS want_id_card SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS national_id_number VARCHAR(50);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS national_id_card VARCHAR(255);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS photo_quality_score SMALLINT;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS risk_category VARCHAR(10) DEFAULT 'medium';
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS risk_review_due_at DATE;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS risk_review_status VARCHAR(20) DEFAULT 'normal';
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS family_details_json TEXT;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS aml_details_json TEXT;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS left_thumb VARCHAR(255);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS right_thumb VARCHAR(255);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS permanent_province VARCHAR(60);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS permanent_district VARCHAR(60);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS permanent_municipality VARCHAR(120);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS permanent_ward VARCHAR(10);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS permanent_tole VARCHAR(120);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS temporary_province VARCHAR(60);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS temporary_district VARCHAR(60);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS temporary_municipality VARCHAR(120);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS temporary_ward VARCHAR(10);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS temporary_tole VARCHAR(120);
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);
ALTER TABLE kyc_applications ALTER COLUMN monthly_income TYPE VARCHAR(100);

-- statuses used by the PHP app: incomplete (stub from member), partial (public quick KYM)
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT con.conname FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
           WHERE t.relname = 'kyc_applications' AND t.relnamespace = current_schema()::regnamespace
             AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ~ '\(status\)'
  LOOP EXECUTE format('ALTER TABLE kyc_applications DROP CONSTRAINT %I', c.conname); END LOOP;
END $$;
ALTER TABLE kyc_applications ADD CONSTRAINT kyc_applications_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'incomplete', 'partial'));
CREATE INDEX IF NOT EXISTS kyc_applications_member_id_idx ON kyc_applications (upper(member_id));

-- ---------------------------------------------------------------- PII: encrypted values need room (pii3: base64)
ALTER TABLE kyc_applications        ALTER COLUMN citizenship_no TYPE VARCHAR(512);
ALTER TABLE account_applications    ALTER COLUMN citizenship_no TYPE VARCHAR(512);
ALTER TABLE loan_applications       ALTER COLUMN citizenship_no TYPE VARCHAR(512);
ALTER TABLE membership_applications ALTER COLUMN citizenship_no TYPE VARCHAR(512);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'member_import_rows' AND column_name = 'citizenship_no') THEN
    ALTER TABLE member_import_rows ALTER COLUMN citizenship_no TYPE VARCHAR(512);
  END IF;
END $$;

-- ---------------------------------------------------------------- office reply attachment + internal notes
ALTER TABLE loan_applications    ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);
ALTER TABLE account_applications ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);
ALTER TABLE appointments         ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);
ALTER TABLE grievances           ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);
ALTER TABLE grievances           ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE member_feedback      ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE digital_service_requests ADD COLUMN IF NOT EXISTS admin_attachment VARCHAR(500);

-- ---------------------------------------------------------------- welfare claims: type-specific fields
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS claim_type_np VARCHAR(160);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS beneficiary_name VARCHAR(160);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS beneficiary_relation VARCHAR(80);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS supporting_documents TEXT;
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS deceased_name VARCHAR(160);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS deceased_relation VARCHAR(80);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS death_date DATE;
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS death_certificate VARCHAR(255);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS delivery_date DATE;
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS hospital_name VARCHAR(200);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS disease_illness VARCHAR(200);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS treatment_date DATE;
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS hospital_clinic VARCHAR(200);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS policy_number VARCHAR(100);
ALTER TABLE member_welfare_claims ADD COLUMN IF NOT EXISTS insurer_name VARCHAR(200);

-- ---------------------------------------------------------------- settings
INSERT INTO site_settings (setting_key, setting_value, setting_type, setting_label, setting_group) VALUES
  ('notify_sms_recipients', '', 'text', 'Admin SMS numbers for new applications (comma separated)', 'notify')
ON CONFLICT (setting_key) DO NOTHING;

-- ---------------------------------------------------------------- per-module templates (includes/notification-templates.php events)
INSERT INTO notification_templates (event_type, audience, channel, enabled, subject, body, variables)
SELECT * FROM (VALUES
  ('loan_application', 'admin', 'email', 1, 'नयाँ ऋण आवेदन प्राप्त भयो ({{tracking_id}})', 'नयाँ ऋण आवेदन\n{{details}}\n\nAdmin panel मा हेर्नुहोस्।', 'name,amount,date,tracking_id,details,site'),
  ('loan_application', 'admin', 'sms', 1, '', 'New Loan Application by {{name}}. Amount: {{amount}}. ID: {{tracking_id}} — {{site}}', 'name,amount,tracking_id,site'),
  ('kyc_application', 'admin', 'email', 1, 'नयाँ केवाइएम आवेदन ({{tracking_id}})', 'नयाँ केवाइएम आवेदन\n{{details}}', 'name,tracking_id,details,site'),
  ('kyc_application', 'admin', 'sms', 1, '', 'New KYM by {{name}}. ID: {{tracking_id}} — {{site}}', 'name,tracking_id,site'),
  ('account_application', 'admin', 'email', 1, 'नयाँ खाता खोल्ने आवेदन ({{tracking_id}})', 'नयाँ खाता आवेदन\n{{details}}', 'name,tracking_id,details,site'),
  ('account_application', 'admin', 'sms', 1, '', 'New Account Application by {{name}}. ID: {{tracking_id}} — {{site}}', 'name,tracking_id,site'),
  ('grievance', 'admin', 'email', 1, 'नयाँ गुनासो दर्ता भयो ({{tracking_id}})', 'नयाँ गुनासो\n{{details}}', 'name,tracking_id,details,site'),
  ('grievance', 'admin', 'sms', 1, '', 'New Grievance. ID: {{tracking_id}} — {{site}}', 'tracking_id,site'),
  ('appointment', 'admin', 'email', 1, 'नयाँ भेटघाट बुकिङ ({{tracking_id}})', 'नयाँ भेटघाट\n{{details}}', 'name,date,tracking_id,details,site'),
  ('appointment', 'admin', 'sms', 1, '', 'New Appointment by {{name}} on {{date}}. ID: {{tracking_id}} — {{site}}', 'name,date,tracking_id,site'),
  ('digital_service', 'admin', 'email', 1, 'नयाँ डिजिटल सेवा अनुरोध ({{tracking_id}})', 'नयाँ डिजिटल सेवा अनुरोध\n{{details}}', 'name,tracking_id,details,site'),
  ('digital_service', 'admin', 'sms', 1, '', 'New Digital Service Request. ID: {{tracking_id}} — {{site}}', 'tracking_id,site'),
  ('honor_application', 'admin', 'email', 1, 'नयाँ सम्मान आवेदन ({{tracking_id}})', 'नयाँ सम्मान आवेदन\n{{details}}', 'name,tracking_id,details,site'),
  ('honor_application', 'admin', 'sms', 1, '', 'New Honor Application. ID: {{tracking_id}} — {{site}}', 'tracking_id,site'),
  ('job_application', 'admin', 'email', 1, 'नयाँ जागिर आवेदन ({{tracking_id}})', 'नयाँ जागिर आवेदन\n{{details}}', 'name,tracking_id,details,site'),
  ('job_application', 'admin', 'sms', 1, '', 'New Job Application by {{name}}. ID: {{tracking_id}} — {{site}}', 'name,tracking_id,site'),
  ('contact_message', 'admin', 'email', 1, 'नयाँ सम्पर्क सन्देश: {{name}}', 'नयाँ सम्पर्क सन्देश\n{{details}}', 'name,details,site'),
  ('contact_message', 'admin', 'sms', 1, '', 'New Contact Message from {{name}} — {{site}}', 'name,site'),
  ('membership_application', 'admin', 'email', 1, 'नयाँ सदस्यता अनुरोध ({{tracking_id}})', 'नयाँ सदस्यता अनुरोध\n{{details}}', 'name,tracking_id,details,site'),
  ('membership_application', 'admin', 'sms', 1, '', 'New membership request by {{name}}. ID: {{tracking_id}} — {{site}}', 'name,tracking_id,site'),
  ('welfare_claim', 'admin', 'email', 1, 'नयाँ कल्याण दाबी ({{tracking_id}})', 'नयाँ सदस्य कल्याण दाबी\n{{details}}', 'name,amount,tracking_id,details,site'),
  ('loan', 'member', 'sms', 1, '', '{{site}}: ऋण आवेदन ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,status,remarks,site'),
  ('loan', 'member', 'email', 1, '{{site}} — तपाईंको ऋण आवेदनको स्थिति अपडेट भयो', 'नमस्ते {{name}},\n\nतपाईंको ऋण आवेदन ({{tracking_id}}) को स्थिति: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,status,remarks,site'),
  ('kyc', 'member', 'sms', 1, '', '{{site}}: केवाइएम ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,status,remarks,site'),
  ('kyc', 'member', 'email', 1, '{{site}} — तपाईंको केवाइएम आवेदनको स्थिति अपडेट भयो', 'नमस्ते {{name}},\n\nतपाईंको केवाइएम आवेदन ({{tracking_id}}) को स्थिति: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,status,remarks,site'),
  ('account', 'member', 'sms', 1, '', '{{site}}: खाता आवेदन ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,status,remarks,site'),
  ('account', 'member', 'email', 1, '{{site}} — तपाईंको खाता आवेदनको स्थिति अपडेट भयो', 'नमस्ते {{name}},\n\nतपाईंको खाता आवेदन ({{tracking_id}}) को स्थिति: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,status,remarks,site'),
  ('appointment', 'member', 'sms', 1, '', '{{site}}: भेटघाट ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,status,remarks,site'),
  ('appointment', 'member', 'email', 1, '{{site}} — तपाईंको भेटघाटको स्थिति अपडेट भयो', 'नमस्ते {{name}},\n\nतपाईंको भेटघाट ({{tracking_id}}) को स्थिति: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,status,remarks,site'),
  ('grievance', 'member', 'sms', 1, '', '{{site}}: गुनासो ({{tracking_id}}) को स्थिति: {{status}}। {{remarks}}', 'name,tracking_id,status,remarks,site'),
  ('grievance', 'member', 'email', 1, '{{site}} — तपाईंको गुनासोको स्थिति अपडेट भयो', 'नमस्ते {{name}},\n\nतपाईंको गुनासो ({{tracking_id}}) को स्थिति: {{status}}\n{{remarks}}\n\n{{site}}', 'name,tracking_id,status,remarks,site')
) AS v(event_type, audience, channel, enabled, subject, body, variables)
WHERE NOT EXISTS (SELECT 1 FROM notification_templates t WHERE t.event_type = v.event_type AND t.audience = v.audience AND t.channel = v.channel);
