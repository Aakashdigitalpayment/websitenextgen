-- =====================================================================
-- Aakash Cooperative — PostgreSQL schema (generated from database/install.sql)
-- Regenerate: npm run schema:convert
-- =====================================================================
SET client_min_messages = warning;

CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  role VARCHAR(20) DEFAULT 'admin',
  is_active SMALLINT DEFAULT 1,
  must_change_password SMALLINT NOT NULL DEFAULT 0,
  twofa_enabled SMALLINT DEFAULT 0,
  twofa_secret VARCHAR(64) NULL,
  twofa_backup_codes TEXT NULL,
  twofa_enabled_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_by INTEGER NULL,
  last_password_change TIMESTAMP NULL,
  CHECK (role IN ('superadmin','super_admin','admin','staff','editor'))
);

CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  name_np VARCHAR(255) NOT NULL DEFAULT '',
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20),
  sadasyata_number VARCHAR(50) NOT NULL DEFAULT '',
  password_hash VARCHAR(255),
  google_id VARCHAR(255),
  facebook_id VARCHAR(255),
  avatar_url VARCHAR(500),
  member_card_no VARCHAR(50),
  kyc_application_id INTEGER NULL DEFAULT NULL,
  address TEXT,
  dob DATE,
  gender VARCHAR(20),
  approval_status VARCHAR(20) DEFAULT 'pending',
  approved_at TIMESTAMP NULL DEFAULT NULL,
  approved_by INTEGER NULL DEFAULT NULL,
  rejection_reason TEXT,
  id_card_generated SMALLINT DEFAULT 0,
  id_card_generated_at TIMESTAMP NULL DEFAULT NULL,
  card_expires_at TIMESTAMP NULL DEFAULT NULL,
  is_verified SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  information_room_enabled SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  kyc_id INTEGER NULL,
  created_by INTEGER NULL
);

CREATE TABLE IF NOT EXISTS site_settings (
  id SERIAL PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  setting_type VARCHAR(20) DEFAULT 'text',
  setting_label VARCHAR(200),
  setting_group VARCHAR(50) DEFAULT 'general',
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (setting_type IN ('text', 'textarea', 'image', 'number', 'color', 'url'))
);

CREATE TABLE IF NOT EXISTS notices (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_np VARCHAR(255),
  content TEXT,
  content_np TEXT,
  notice_date DATE,
  attachment VARCHAR(255),
  popup_image VARCHAR(255) DEFAULT NULL,
  popup_photo_only SMALLINT NOT NULL DEFAULT 0,
  popup_expires_at DATE NULL,
  is_active SMALLINT DEFAULT 1,
  is_popup SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS interest_rates (
  id SERIAL PRIMARY KEY,
  category VARCHAR(20) NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_np VARCHAR(100),
  rate DECIMAL(5,2) NOT NULL,
  description TEXT,
  description_np TEXT,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (category IN ('saving', 'loan'))
);

CREATE TABLE IF NOT EXISTS services (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  title_np VARCHAR(100),
  title_en VARCHAR(100),
  description TEXT,
  description_np TEXT,
  icon VARCHAR(50) DEFAULT 'fas fa-star',
  image VARCHAR(255),
  nav_group VARCHAR(40) DEFAULT 'general',
  service_category_id INTEGER DEFAULT NULL,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sliders (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200),
  subtitle VARCHAR(255),
  image VARCHAR(255) NOT NULL,
  button_text VARCHAR(50),
  button_url VARCHAR(255),
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gallery (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200),
  title_np VARCHAR(200),
  image VARCHAR(255) NOT NULL,
  category VARCHAR(50) DEFAULT 'general',
  album_id INTEGER NULL,
  album VARCHAR(200) NULL,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS gallery_albums (
  id SERIAL PRIMARY KEY,
  name_np VARCHAR(200) NOT NULL,
  name_en VARCHAR(200) DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'general',
  is_active SMALLINT NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  position VARCHAR(100),
  position_np VARCHAR(100),
  position_en VARCHAR(100),
  photo VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(100),
  category VARCHAR(20) DEFAULT 'staff',
  is_information_officer SMALLINT DEFAULT 0,
  is_grievance_officer SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (category IN ('board', 'management', 'staff'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100),
  phone VARCHAR(20),
  subject VARCHAR(200),
  message TEXT NOT NULL,
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(100) NOT NULL UNIQUE,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  title_en VARCHAR(200),
  content TEXT,
  content_np TEXT,
  show_in_menu SMALLINT DEFAULT 0,
  menu_position VARCHAR(50) DEFAULT 'about',
  menu_order INTEGER DEFAULT 0,
  menu_icon VARCHAR(80) NOT NULL DEFAULT 'fas fa-file-lines',
  is_new SMALLINT DEFAULT 0,
  new_until DATE,
  is_active SMALLINT DEFAULT 1,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS downloads (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(50),
  category VARCHAR(50) DEFAULT 'general',
  download_count INTEGER DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS information_room_items (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_np VARCHAR(255) NULL,
  description TEXT NULL,
  description_np TEXT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'other',
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(50) NULL,
  meeting_date DATE NULL,
  reference_no VARCHAR(100) NULL,
  allow_download SMALLINT NOT NULL DEFAULT 0,
  restrict_copy SMALLINT NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_by INTEGER NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS information_room_access_log (
  id SERIAL PRIMARY KEY,
  item_id INTEGER NOT NULL,
  viewer_type VARCHAR(20) NOT NULL,
  viewer_id INTEGER NOT NULL,
  viewer_name VARCHAR(200) NULL,
  action VARCHAR(30) NOT NULL DEFAULT 'view',
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (viewer_type IN ('admin','member'))
);

CREATE TABLE IF NOT EXISTS careers (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_np VARCHAR(255) DEFAULT NULL,
  department VARCHAR(150) DEFAULT NULL,
  location VARCHAR(150) DEFAULT NULL,
  job_type VARCHAR(50) DEFAULT 'full_time',
  description TEXT,
  description_np TEXT,
  requirements TEXT,
  deadline DATE DEFAULT NULL,
  attachment VARCHAR(255) DEFAULT NULL,
  vacancies INTEGER DEFAULT 1,
  min_qualification VARCHAR(255) DEFAULT NULL,
  experience_required VARCHAR(150) DEFAULT NULL,
  salary_range VARCHAR(150) DEFAULT NULL,
  allow_online_apply SMALLINT DEFAULT 1,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  report_type VARCHAR(50) DEFAULT 'annual',
  report_year VARCHAR(20),
  report_month VARCHAR(20),
  report_quarter VARCHAR(10),
  file_path VARCHAR(255),
  access_level VARCHAR(20) NOT NULL DEFAULT 'none',
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (access_level IN ('none','member'))
);

CREATE TABLE IF NOT EXISTS member_feedback (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  name VARCHAR(120) NOT NULL,
  member_id VARCHAR(50),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120),
  type VARCHAR(20) DEFAULT 'feedback',
  subject VARCHAR(255),
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  admin_reply TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (type IN ('feedback','suggestion','complaint','inquiry')),
  CHECK (status IN ('pending','reviewed','resolved'))
);

CREATE TABLE IF NOT EXISTS news (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  content TEXT,
  content_np TEXT,
  image VARCHAR(255),
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS why_choose_features (
  id SERIAL PRIMARY KEY,
  icon VARCHAR(100) NOT NULL DEFAULT 'fas fa-star',
  title_np VARCHAR(200) NOT NULL DEFAULT '',
  title_en VARCHAR(200) NOT NULL DEFAULT '',
  desc_np TEXT,
  desc_en TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS satisfaction_links (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_en VARCHAR(200),
  url VARCHAR(500) NOT NULL,
  icon VARCHAR(100) DEFAULT 'fas fa-smile',
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS member_of_year (
  id SERIAL PRIMARY KEY,
  spotlight_year VARCHAR(10) NOT NULL UNIQUE,
  member_name VARCHAR(200) NOT NULL,
  member_name_en VARCHAR(100),
  member_id VARCHAR(50),
  photo VARCHAR(500),
  member_since VARCHAR(20),
  quote TEXT,
  quote_en TEXT,
  achievement TEXT,
  achievement_en TEXT,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS member_success_stories (
  id SERIAL PRIMARY KEY,
  member_name VARCHAR(200) NOT NULL,
  member_name_en VARCHAR(200) NULL,
  member_id_no VARCHAR(50) NULL,
  photo VARCHAR(500) NULL,
  member_since VARCHAR(40) NULL,
  location VARCHAR(150) NULL,
  location_en VARCHAR(150) NULL,
  profession VARCHAR(150) NULL,
  profession_en VARCHAR(150) NULL,
  headline_np VARCHAR(255) NOT NULL,
  headline_en VARCHAR(255) NULL,
  story_np TEXT NOT NULL,
  story_en TEXT NULL,
  institution_help_np TEXT NULL,
  institution_help_en TEXT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS service_centers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  name_np VARCHAR(200),
  address VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(100),
  province VARCHAR(50),
  opening_hours VARCHAR(100),
  map_url VARCHAR(500),
  is_main_branch SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  company_name VARCHAR(255) NOT NULL,
  owner_name VARCHAR(100),
  address VARCHAR(255),
  phone VARCHAR(20),
  email VARCHAR(100),
  pan_no VARCHAR(50),
  business_type VARCHAR(100),
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS digital_service_requests (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(50) UNIQUE NOT NULL,
  requester_name VARCHAR(120) NOT NULL,
  member_id VARCHAR(50),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120),
  service_type VARCHAR(60) NOT NULL,
  service_type_np VARCHAR(120),
  account_number VARCHAR(50),
  statement_from DATE NULL,
  statement_to DATE NULL,
  biller_name VARCHAR(120),
  bill_reference VARCHAR(120),
  recharge_number VARCHAR(20),
  recharge_amount DECIMAL(12,2),
  service_amount DECIMAL(12,2) NULL,
  request_details TEXT,
  attachment VARCHAR(255),
  preferred_contact VARCHAR(20) DEFAULT 'phone',
  status VARCHAR(20) DEFAULT 'pending',
  admin_remarks TEXT,
  admin_attachment VARCHAR(500) DEFAULT '',
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (preferred_contact IN ('phone','email','branch')),
  CHECK (status IN ('pending','processing','approved','rejected','completed'))
);

CREATE TABLE IF NOT EXISTS honor_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(60) NOT NULL,
  name_np VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) DEFAULT '',
  requires_nominee SMALLINT NOT NULL DEFAULT 1,
  requires_document SMALLINT NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS honor_programs (
  id SERIAL PRIMARY KEY,
  title_np VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) DEFAULT '',
  event_label VARCHAR(120) DEFAULT '',
  fiscal_year VARCHAR(40) DEFAULT '',
  opens_at TIMESTAMP NOT NULL,
  closes_at TIMESTAMP NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  show_new_badge SMALLINT NOT NULL DEFAULT 1,
  instructions_np TEXT,
  instructions_en TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS honor_program_categories (
  program_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  PRIMARY KEY (program_id, category_id)
);

CREATE TABLE IF NOT EXISTS honor_applications (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) NOT NULL,
  program_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  applicant_name VARCHAR(160) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120) DEFAULT '',
  address VARCHAR(255) DEFAULT '',
  is_member SMALLINT NOT NULL DEFAULT 0,
  member_id VARCHAR(50) DEFAULT '',
  member_portal_id INTEGER NULL,
  nominee_name VARCHAR(160) DEFAULT '',
  nominee_relation VARCHAR(80) DEFAULT '',
  exam_year VARCHAR(40) DEFAULT '',
  institution VARCHAR(200) DEFAULT '',
  business_note VARCHAR(255) DEFAULT '',
  description TEXT,
  attachment VARCHAR(255) DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_remarks TEXT,
  reviewed_by VARCHAR(100) DEFAULT '',
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (status IN ('pending','under_review','shortlisted','selected','rejected','closed'))
);

CREATE TABLE IF NOT EXISTS useful_links (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  url VARCHAR(500) NOT NULL,
  icon VARCHAR(100) DEFAULT 'fas fa-link',
  description TEXT,
  description_np TEXT,
  is_popup SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS important_links (
  id SERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  title_np VARCHAR(200),
  url VARCHAR(255) NOT NULL,
  icon VARCHAR(255),
  description VARCHAR(255),
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER,
  action VARCHAR(100),
  description TEXT,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  recipient VARCHAR(200) NOT NULL,
  subject VARCHAR(500),
  message TEXT,
  status VARCHAR(20) DEFAULT 'sent',
  error_msg VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (channel IN ('email','sms')),
  CHECK (status IN ('sent','failed'))
);

CREATE TABLE IF NOT EXISTS committee_types (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  name_np VARCHAR(100) NOT NULL,
  description TEXT,
  is_active SMALLINT DEFAULT 1,
  show_in_navbar SMALLINT DEFAULT 0,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS committee_tenures (
  id SERIAL PRIMARY KEY,
  committee_type_id INTEGER NOT NULL,
  tenure_name VARCHAR(100) NOT NULL,
  tenure_name_np VARCHAR(100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS committee_members (
  id SERIAL PRIMARY KEY,
  tenure_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  name_en VARCHAR(100),
  position VARCHAR(100) NOT NULL,
  position_en VARCHAR(100),
  phone VARCHAR(20),
  email VARCHAR(100),
  address VARCHAR(255),
  photo VARCHAR(255),
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kyc_applications (
  id SERIAL PRIMARY KEY,
  member_id VARCHAR(50),
  full_name VARCHAR(100) NOT NULL,
  full_name_en VARCHAR(100),
  dob_bs VARCHAR(20),
  dob_ad DATE,
  gender VARCHAR(20),
  marital_status VARCHAR(30),
  nationality VARCHAR(50) DEFAULT 'नेपाली',
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  permanent_address TEXT,
  temporary_address TEXT,
  citizenship_no VARCHAR(50),
  citizenship_issued_date VARCHAR(20),
  citizenship_issued_place VARCHAR(100),
  father_name VARCHAR(100),
  mother_name VARCHAR(100),
  grandfather_name VARCHAR(100),
  spouse_name VARCHAR(100),
  occupation VARCHAR(100),
  organization_name VARCHAR(200),
  monthly_income VARCHAR(50),
  account_type VARCHAR(50),
  branch VARCHAR(100),
  photo VARCHAR(255),
  citizenship_front VARCHAR(255),
  citizenship_back VARCHAR(255),
  signature VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  member_id_generated VARCHAR(20) NULL,
  member_generated_at TIMESTAMP NULL,
  member_generated_by INTEGER NULL,
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS loan_applications (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  member_id VARCHAR(50),
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  address TEXT,
  citizenship_no VARCHAR(50),
  loan_type VARCHAR(100),
  loan_amount DECIMAL(15,2),
  loan_purpose TEXT,
  loan_tenure INTEGER,
  repayment_method VARCHAR(50),
  occupation VARCHAR(100),
  organization_name VARCHAR(200),
  monthly_income DECIMAL(15,2),
  other_income TEXT,
  collateral_type VARCHAR(100),
  collateral_description TEXT,
  collateral_value DECIMAL(15,2),
  guarantor_name VARCHAR(100),
  guarantor_relation VARCHAR(50),
  guarantor_phone VARCHAR(20),
  guarantor_address TEXT,
  branch VARCHAR(100),
  documents TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (status IN ('pending', 'processing', 'approved', 'rejected', 'disbursed'))
);

CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  member_id VARCHAR(50),
  visit_kind VARCHAR(20) NOT NULL DEFAULT 'member',
  organization_address VARCHAR(500) NULL,
  organization_website VARCHAR(255) NULL,
  contact_person VARCHAR(120) NULL,
  purpose VARCHAR(20) DEFAULT 'other',
  purpose_detail TEXT,
  preferred_date DATE NOT NULL,
  preferred_time VARCHAR(20) NOT NULL,
  branch VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (purpose IN ('account_inquiry', 'loan_inquiry', 'kyc_update', 'loan_repayment', 'account_opening', 'other')),
  CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS auction_notices (
  id SERIAL PRIMARY KEY,
  tracking_number VARCHAR(30) UNIQUE,
  title VARCHAR(255) NOT NULL,
  title_en VARCHAR(255),
  description TEXT,
  description_en TEXT,
  property_type VARCHAR(100),
  location VARCHAR(255),
  google_map_link VARCHAR(600),
  google_map_embed TEXT,
  area_bigha DECIMAL(10,2) DEFAULT 0,
  area_ropani DECIMAL(10,2) DEFAULT 0,
  area_aana DECIMAL(10,2) DEFAULT 0,
  area_paisa DECIMAL(10,2) DEFAULT 0,
  area VARCHAR(100),
  minimum_price DECIMAL(15,2) DEFAULT 0,
  auction_date DATE NULL,
  auction_time VARCHAR(30),
  contact_person VARCHAR(120),
  contact_phone VARCHAR(20),
  image VARCHAR(255),
  images TEXT,
  document VARCHAR(255),
  status VARCHAR(20) DEFAULT 'upcoming',
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('upcoming','ongoing','completed','cancelled'))
);

CREATE TABLE IF NOT EXISTS auction_bids (
  id SERIAL PRIMARY KEY,
  auction_id INTEGER NOT NULL,
  bidder_name VARCHAR(120) NOT NULL,
  bidder_phone VARCHAR(20) NOT NULL,
  bidder_email VARCHAR(120),
  bidder_address VARCHAR(255),
  bid_amount DECIMAL(15,2) NOT NULL,
  message TEXT,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending','accepted','rejected'))
);

CREATE TABLE IF NOT EXISTS account_applications (
  id SERIAL PRIMARY KEY,
  account_type VARCHAR(50) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  full_name_en VARCHAR(100),
  dob_bs VARCHAR(20),
  dob_ad DATE,
  gender VARCHAR(20),
  marital_status VARCHAR(30),
  mobile VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  permanent_address TEXT,
  temporary_address TEXT,
  citizenship_no VARCHAR(50),
  citizenship_issued_date VARCHAR(20),
  citizenship_issued_place VARCHAR(100),
  father_name VARCHAR(100),
  mother_name VARCHAR(100),
  occupation VARCHAR(100),
  monthly_income VARCHAR(50),
  initial_deposit VARCHAR(50),
  nominee_name VARCHAR(100),
  nominee_relation VARCHAR(50),
  nominee_phone VARCHAR(20),
  branch VARCHAR(100),
  photo VARCHAR(255),
  citizenship_front VARCHAR(255),
  citizenship_back VARCHAR(255),
  signature VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  remarks TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE TABLE IF NOT EXISTS grievances (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  name VARCHAR(100) NOT NULL,
  member_id VARCHAR(50),
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(100),
  category VARCHAR(20) DEFAULT 'other',
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  attachment VARCHAR(255),
  is_anonymous SMALLINT DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending',
  admin_response TEXT,
  resolved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (category IN ('service', 'staff', 'loan', 'account', 'branch', 'other')),
  CHECK (status IN ('pending', 'in_progress', 'resolved', 'closed'))
);

CREATE TABLE IF NOT EXISTS chatbot_faqs (
  id SERIAL PRIMARY KEY,
  question VARCHAR(255) NOT NULL,
  question_en VARCHAR(255),
  answer TEXT NOT NULL,
  answer_en TEXT,
  category VARCHAR(50),
  keywords TEXT,
  display_order INTEGER DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS faqs (
  id SERIAL PRIMARY KEY,
  question VARCHAR(500) NOT NULL,
  question_np VARCHAR(500),
  answer TEXT NOT NULL,
  answer_np TEXT,
  category VARCHAR(100) DEFAULT 'general',
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS awards (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_np VARCHAR(255),
  description TEXT,
  description_np TEXT,
  awarded_by VARCHAR(255),
  awarded_by_np VARCHAR(255),
  award_date DATE,
  image VARCHAR(255),
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS help_topics (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  title_np VARCHAR(255),
  content TEXT NOT NULL,
  content_np TEXT,
  icon VARCHAR(100) DEFAULT 'fas fa-question-circle',
  category VARCHAR(100) DEFAULT 'general',
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS site_stats (
  id SERIAL PRIMARY KEY,
  stat_key VARCHAR(100) NOT NULL UNIQUE,
  stat_value BIGINT DEFAULT 0,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS visitor_counter (
  id SERIAL PRIMARY KEY,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT,
  page_visited VARCHAR(255),
  visit_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_features (
  id SERIAL PRIMARY KEY,
  title VARCHAR(100) NOT NULL,
  title_np VARCHAR(100),
  icon VARCHAR(100) DEFAULT 'fas fa-star',
  description TEXT,
  description_np TEXT,
  is_new SMALLINT DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS institutional_profile (
  id SERIAL PRIMARY KEY,
  fiscal_year VARCHAR(20) NOT NULL,
  report_month SMALLINT NOT NULL DEFAULT 0,
  total_members INTEGER DEFAULT 0,
  share_capital DECIMAL(18,2) DEFAULT 0,
  deposit DECIMAL(18,2) DEFAULT 0,
  loan DECIMAL(18,2) DEFAULT 0,
  total_assets DECIMAL(18,2) DEFAULT 0,
  other_fund DECIMAL(18,2) DEFAULT 0,
  bank_cash_balance DECIMAL(18,2) DEFAULT 0,
  fixed_assets DECIMAL(18,2) DEFAULT 0,
  total_loan_members INTEGER DEFAULT 0,
  npa_percent DECIMAL(5,2) DEFAULT 0,
  profit_loss DECIMAL(18,2) DEFAULT 0,
  access_level VARCHAR(20) NOT NULL DEFAULT 'none',
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (access_level IN ('none','member'))
);

CREATE TABLE IF NOT EXISTS job_applications (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  career_id INTEGER NOT NULL DEFAULT 0,
  full_name VARCHAR(200) NOT NULL,
  email VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  address VARCHAR(255),
  date_of_birth DATE,
  gender VARCHAR(20) DEFAULT 'male',
  education VARCHAR(255),
  experience VARCHAR(255),
  current_employer VARCHAR(200),
  expected_salary VARCHAR(50),
  cover_letter TEXT,
  resume_path VARCHAR(255),
  photo_path VARCHAR(255),
  citizenship_path VARCHAR(255),
  certificates_path VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending',
  admin_notes TEXT,
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (gender IN ('male','female','other')),
  CHECK (status IN ('pending','shortlisted','interviewed','selected','rejected'))
);

CREATE TABLE IF NOT EXISTS member_welfare_claims (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(60) UNIQUE NULL,
  member_name VARCHAR(120) NOT NULL,
  member_id VARCHAR(50) DEFAULT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(120) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  claim_type VARCHAR(60) NOT NULL,
  claim_amount DECIMAL(12,2) DEFAULT 0.00,
  description TEXT,
  claim_date_bs VARCHAR(20) DEFAULT NULL,
  claim_date_ad DATE DEFAULT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  approved_amount DECIMAL(12,2) DEFAULT NULL,
  admin_remarks TEXT,
  attachment_path VARCHAR(255) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (status IN ('pending','processing','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS welfare_claim_types (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(60) NOT NULL,
  name_np VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) DEFAULT '',
  icon VARCHAR(80) NOT NULL DEFAULT 'fas fa-gift',
  color VARCHAR(40) NOT NULL DEFAULT '#ff9800',
  form_profile VARCHAR(40) NOT NULL DEFAULT 'other',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  is_builtin SMALLINT NOT NULL DEFAULT 0,
  requires_document SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS digital_service_types (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(60) NOT NULL,
  name_np VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) DEFAULT '',
  icon VARCHAR(80) NOT NULL DEFAULT 'fas fa-laptop',
  color VARCHAR(40) NOT NULL DEFAULT 'var(--primary-color)',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  is_builtin SMALLINT NOT NULL DEFAULT 0,
  requires_document SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_survey (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(50) UNIQUE NOT NULL,
  member_name VARCHAR(120) NOT NULL,
  member_id VARCHAR(50),
  phone VARCHAR(20),
  email VARCHAR(120),
  satisfaction_level SMALLINT DEFAULT 3,
  service_quality SMALLINT DEFAULT 3,
  staff_behavior SMALLINT DEFAULT 3,
  response_time SMALLINT DEFAULT 3,
  suggestions TEXT,
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(50) PRIMARY KEY,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_type VARCHAR(20) NOT NULL DEFAULT 'system',
  actor_id INTEGER NULL,
  actor_name VARCHAR(150) NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id BIGINT NULL,
  summary VARCHAR(255) NULL,
  old_values JSONB NULL,
  new_values JSONB NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (actor_type IN ('admin','superadmin','member','system','public'))
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  audience VARCHAR(20) NOT NULL DEFAULT 'admin',
  channel VARCHAR(20) NOT NULL,
  enabled SMALLINT NOT NULL DEFAULT 1,
  subject VARCHAR(255) NULL,
  body TEXT NOT NULL,
  variables VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (audience IN ('admin','member')),
  CHECK (channel IN ('email','sms'))
);

CREATE TABLE IF NOT EXISTS member_password_reset_requests (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  admin_id INTEGER NULL DEFAULT NULL,
  resolved_at TIMESTAMP NULL DEFAULT NULL,
  temp_password VARCHAR(255) NULL DEFAULT NULL,
  admin_note TEXT
);

CREATE TABLE IF NOT EXISTS office_credentials (
  id SERIAL PRIMARY KEY,
  site_name VARCHAR(120) NOT NULL,
  site_url VARCHAR(500) NOT NULL,
  site_logo VARCHAR(255) DEFAULT NULL,
  username VARCHAR(255) NOT NULL,
  password_enc TEXT NOT NULL,
  password_iv VARCHAR(64) NOT NULL,
  category VARCHAR(60) DEFAULT 'general',
  notes TEXT DEFAULT NULL,
  is_active SMALLINT DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS office_credentials_log (
  id SERIAL PRIMARY KEY,
  credential_id INTEGER NOT NULL,
  admin_id INTEGER NOT NULL,
  admin_username VARCHAR(50),
  action VARCHAR(30) NOT NULL,
  ip_address VARCHAR(45),
  user_agent VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_id_cards (
  id SERIAL PRIMARY KEY,
  member_id VARCHAR(20) NOT NULL,
  card_no VARCHAR(40) NOT NULL UNIQUE,
  issued_date DATE NOT NULL,
  expiry_date DATE NULL,
  status VARCHAR(20) DEFAULT 'active',
  created_by INTEGER NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verification_code VARCHAR(20) NULL UNIQUE,
  cvv CHAR(4) NULL,
  verify_count INTEGER DEFAULT 0,
  last_verified_at TIMESTAMP NULL,
  CHECK (status IN ('active','expired','revoked'))
);

CREATE TABLE IF NOT EXISTS admin_activity_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NOT NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(32) NULL,
  target_id INTEGER NULL,
  details JSONB NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS card_verify_attempts (
  id SERIAL PRIMARY KEY,
  ip VARCHAR(45) NOT NULL,
  code_tried VARCHAR(20) NULL,
  success SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS upcoming_programs (
  id SERIAL PRIMARY KEY,
  title VARCHAR(180) NOT NULL,
  program_type VARCHAR(20) NOT NULL DEFAULT 'General',
  parent_program_id INTEGER NULL,
  is_multi_location SMALLINT NOT NULL DEFAULT 0,
  description TEXT NULL,
  event_date DATE NULL,
  event_time VARCHAR(30) NULL,
  location VARCHAR(180) NULL,
  is_active SMALLINT DEFAULT 1,
  pre_registration_open SMALLINT DEFAULT 0,
  qr_enabled SMALLINT DEFAULT 1,
  qr_token VARCHAR(64) UNIQUE NULL,
  qr_starts_at TIMESTAMP NULL,
  qr_expires_at TIMESTAMP NULL,
  attendance_open_at TIMESTAMP NULL,
  attendance_close_at TIMESTAMP NULL,
  eligible_member_scope VARCHAR(30) NOT NULL DEFAULT 'all_active',
  instant_attendance SMALLINT NOT NULL DEFAULT 0,
  shared_qr_mode SMALLINT NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (program_type IN ('General','AGM','SGM','Orientation','Training','Seminar','Workshop','Financial_Literacy','Other'))
);

CREATE TABLE IF NOT EXISTS program_occurrences (
  id SERIAL PRIMARY KEY,
  parent_program_id INTEGER NOT NULL,
  location_name VARCHAR(180) NOT NULL DEFAULT '',
  venue_id INTEGER NULL,
  event_date DATE NULL,
  start_time VARCHAR(30) NULL,
  end_time VARCHAR(30) NULL,
  attendance_open_at TIMESTAMP NULL,
  attendance_close_at TIMESTAMP NULL,
  qr_token VARCHAR(64) UNIQUE NULL,
  qr_enabled SMALLINT NOT NULL DEFAULT 1,
  qr_starts_at TIMESTAMP NULL,
  qr_expires_at TIMESTAMP NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS member_program_attendance (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  member_card_no VARCHAR(60) DEFAULT '',
  program_id INTEGER NOT NULL,
  occurrence_id INTEGER NULL,
  parent_program_id INTEGER NULL,
  attendance_scope_key INTEGER NOT NULL DEFAULT 0,
  program_title VARCHAR(180) NOT NULL,
  is_priority SMALLINT DEFAULT 0,
  attendance_note VARCHAR(500) DEFAULT '',
  verified_by_ip VARCHAR(45) DEFAULT '',
  source VARCHAR(30) DEFAULT 'verify_portal',
  attendance_method VARCHAR(20) NOT NULL DEFAULT 'STAFF_VERIFY',
  attendance_status VARCHAR(20) NOT NULL DEFAULT 'VALID',
  location_label VARCHAR(180) NULL,
  desk_id INTEGER NULL,
  staff_admin_id INTEGER NULL,
  device_fingerprint VARCHAR(120) NULL,
  voided_by INTEGER NULL,
  voided_at TIMESTAMP NULL,
  void_reason VARCHAR(500) NULL,
  attended_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (attendance_method IN ('MEMBER_SELF','ADMIN_MANUAL','QR_SCAN','STAFF_VERIFY','ADMIN_APPROVE','ADMIN_PREREG')),
  CHECK (attendance_status IN ('VALID','VOID'))
);

CREATE TABLE IF NOT EXISTS program_attendance_attempts (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  parent_program_id INTEGER NOT NULL,
  program_id INTEGER NOT NULL,
  occurrence_id INTEGER NULL,
  attempted_method VARCHAR(40) NOT NULL DEFAULT '',
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  previous_attendance_id INTEGER NULL,
  result VARCHAR(20) NOT NULL DEFAULT 'OTHER',
  result_message VARCHAR(500) DEFAULT '',
  verified_by_ip VARCHAR(45) DEFAULT '',
  desk_id INTEGER NULL,
  staff_admin_id INTEGER NULL,
  CHECK (result IN ('DUPLICATE_BLOCKED','WINDOW_CLOSED','INELIGIBLE','INVALID_MEMBER','INVALID_PROGRAM','OTHER'))
);

CREATE TABLE IF NOT EXISTS program_registration_desks (
  id SERIAL PRIMARY KEY,
  parent_program_id INTEGER NOT NULL,
  occurrence_id INTEGER NULL,
  desk_label VARCHAR(60) NOT NULL DEFAULT 'Desk 01',
  assigned_staff_admin_id INTEGER NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS program_audit_logs (
  id SERIAL PRIMARY KEY,
  action_type VARCHAR(60) NOT NULL,
  program_id INTEGER NULL,
  occurrence_id INTEGER NULL,
  attendance_id INTEGER NULL,
  member_id INTEGER NULL,
  admin_id INTEGER NULL,
  reason VARCHAR(500) DEFAULT '',
  payload_json TEXT NULL,
  ip_address VARCHAR(45) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_program_attendance_requests (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  member_card_no VARCHAR(60) DEFAULT '',
  member_name VARCHAR(150) DEFAULT '',
  member_phone VARCHAR(30) DEFAULT '',
  member_address VARCHAR(255) DEFAULT '',
  program_id INTEGER NOT NULL,
  occurrence_id INTEGER NULL,
  program_title VARCHAR(180) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL DEFAULT NULL,
  verified_by_ip VARCHAR(45) DEFAULT '',
  user_agent VARCHAR(255) DEFAULT '',
  admin_id INTEGER NULL,
  admin_note VARCHAR(500) DEFAULT '',
  source VARCHAR(40) DEFAULT 'public_qr_request',
  CHECK (status IN ('pending','approved','rejected'))
);

CREATE TABLE IF NOT EXISTS member_program_preregistrations (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  member_card_no VARCHAR(60) DEFAULT '',
  member_name VARCHAR(150) DEFAULT '',
  phone VARCHAR(30) DEFAULT '',
  email VARCHAR(120) DEFAULT '',
  program_id INTEGER NOT NULL,
  program_title VARCHAR(180) NOT NULL,
  event_date DATE NULL,
  note VARCHAR(500) DEFAULT '',
  source VARCHAR(30) DEFAULT 'member_portal',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_partner_services (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  member_card_no VARCHAR(50) DEFAULT '',
  partner_id INTEGER NULL,
  partner_name VARCHAR(255) NOT NULL,
  service_name VARCHAR(255) DEFAULT '',
  service_taken SMALLINT DEFAULT 0,
  service_note VARCHAR(500) DEFAULT '',
  verified_by_ip VARCHAR(45) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS election_cycles (
  id SERIAL PRIMARY KEY,
  title_np VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) NOT NULL DEFAULT '',
  intro_np TEXT NULL,
  intro_en TEXT NULL,
  period_label VARCHAR(80) NULL DEFAULT NULL,
  date_from DATE NULL DEFAULT NULL,
  date_to DATE NULL DEFAULT NULL,
  is_published SMALLINT NOT NULL DEFAULT 0,
  show_in_navbar SMALLINT NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS election_milestones (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  event_date DATE NULL DEFAULT NULL,
  title_np VARCHAR(220) NOT NULL,
  title_en VARCHAR(220) NOT NULL DEFAULT '',
  detail_np TEXT NULL,
  detail_en TEXT NULL,
  attachment VARCHAR(500) NULL DEFAULT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS designations (
  id SERIAL PRIMARY KEY,
  title_np VARCHAR(160) NOT NULL,
  title_en VARCHAR(160) NOT NULL DEFAULT '',
  category VARCHAR(50) NOT NULL DEFAULT 'committee',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS election_posts (
  id SERIAL PRIMARY KEY,
  designation_id INTEGER NULL DEFAULT NULL,
  title_np VARCHAR(160) NOT NULL,
  title_en VARCHAR(160) NOT NULL DEFAULT '',
  committee_type_id INTEGER NULL DEFAULT NULL,
  default_seats INTEGER NOT NULL DEFAULT 1,
  default_max_votes INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS election_positions (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  title_np VARCHAR(160) NOT NULL,
  title_en VARCHAR(160) NOT NULL DEFAULT '',
  seats INTEGER NOT NULL DEFAULT 1,
  max_votes_per_voter INTEGER NOT NULL DEFAULT 1,
  committee_type_id INTEGER NULL DEFAULT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS election_candidates (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  name VARCHAR(160) NOT NULL,
  name_en VARCHAR(160) NOT NULL DEFAULT '',
  photo VARCHAR(500) NULL DEFAULT NULL,
  bio_np TEXT NULL,
  bio_en TEXT NULL,
  phone VARCHAR(20) NULL DEFAULT NULL,
  email VARCHAR(120) NULL DEFAULT NULL,
  address VARCHAR(255) NULL DEFAULT NULL,
  symbol_no VARCHAR(20) NULL DEFAULT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS election_vote_submissions (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  source VARCHAR(30) NOT NULL DEFAULT 'member_portal',
  proof_type VARCHAR(30) NOT NULL DEFAULT '',
  verified_by_admin_id INTEGER NULL DEFAULT NULL,
  verified_by_name VARCHAR(120) NOT NULL DEFAULT '',
  note VARCHAR(500) NOT NULL DEFAULT '',
  is_ballot SMALLINT NOT NULL DEFAULT 1,
  ip VARCHAR(64) NULL DEFAULT NULL,
  user_agent VARCHAR(255) NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS election_votes (
  id SERIAL PRIMARY KEY,
  cycle_id INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  candidate_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS partner_facilities (
  id SERIAL PRIMARY KEY,
  partner_name VARCHAR(200) NOT NULL,
  partner_name_en VARCHAR(200) NOT NULL DEFAULT '',
  location VARCHAR(200) NOT NULL DEFAULT '',
  facility_type VARCHAR(100) NOT NULL DEFAULT '',
  discount_percent DECIMAL(5,2) DEFAULT 0,
  discount_label VARCHAR(160) NOT NULL DEFAULT '',
  description TEXT,
  description_en TEXT NULL,
  terms_np TEXT NULL,
  logo_path VARCHAR(500) NULL DEFAULT NULL,
  contact_phone VARCHAR(30) NOT NULL DEFAULT '',
  contact_email VARCHAR(120) NOT NULL DEFAULT '',
  website_url VARCHAR(255) NOT NULL DEFAULT '',
  partner_code VARCHAR(32) NULL DEFAULT NULL,
  pin_hash VARCHAR(255) NULL DEFAULT NULL,
  vendor_id INTEGER NULL DEFAULT NULL,
  is_featured SMALLINT NOT NULL DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_notifications (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  type VARCHAR(30) DEFAULT 'info',
  link VARCHAR(500),
  is_read SMALLINT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_otp_tokens (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  otp_code VARCHAR(10) NOT NULL,
  purpose VARCHAR(50) DEFAULT 'password_reset',
  channel VARCHAR(10) DEFAULT 'sms',
  sent_to VARCHAR(200),
  is_used SMALLINT DEFAULT 0,
  attempts SMALLINT DEFAULT 0,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_push_subscriptions (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh VARCHAR(512) NOT NULL,
  auth VARCHAR(64) NOT NULL,
  user_agent VARCHAR(255) DEFAULT '',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_push_log (
  id SERIAL PRIMARY KEY,
  notif_id INTEGER DEFAULT NULL,
  member_id INTEGER DEFAULT NULL,
  endpoint VARCHAR(255) NOT NULL DEFAULT '',
  http_code SMALLINT DEFAULT 0,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_marketplace_listings (
  id SERIAL PRIMARY KEY,
  member_id INTEGER NOT NULL,
  listing_type VARCHAR(20) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT '',
  title VARCHAR(200) NOT NULL,
  description TEXT,
  unit VARCHAR(40) NOT NULL DEFAULT '',
  price DECIMAL(12,2) NULL DEFAULT NULL,
  price_note VARCHAR(120) NOT NULL DEFAULT '',
  quantity VARCHAR(80) NOT NULL DEFAULT '',
  experience_years SMALLINT NULL DEFAULT NULL,
  location VARCHAR(200) NOT NULL DEFAULT '',
  contact_name VARCHAR(120) NOT NULL DEFAULT '',
  contact_phone VARCHAR(20) NOT NULL DEFAULT '',
  image VARCHAR(255) NULL DEFAULT NULL,
  available_from DATE NULL DEFAULT NULL,
  available_until TIMESTAMP NULL DEFAULT NULL,
  available_time_from TIME NULL DEFAULT NULL,
  available_time_to TIME NULL DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_note VARCHAR(500) NOT NULL DEFAULT '',
  approved_at TIMESTAMP NULL DEFAULT NULL,
  approved_by INTEGER NULL DEFAULT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL,
  CHECK (listing_type IN ('product','skill')),
  CHECK (status IN ('pending','approved','rejected','expired','withdrawn'))
);

CREATE TABLE IF NOT EXISTS member_marketplace_inquiries (
  id SERIAL PRIMARY KEY,
  listing_id INTEGER NOT NULL,
  member_id INTEGER NULL DEFAULT NULL,
  inquirer_name VARCHAR(120) NOT NULL,
  inquirer_phone VARCHAR(20) NOT NULL DEFAULT '',
  message VARCHAR(1000) NOT NULL DEFAULT '',
  is_read SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  attempted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visitor_stats (
  id SERIAL PRIMARY KEY,
  visit_date DATE NOT NULL UNIQUE,
  visitor_count INTEGER DEFAULT 0,
  page_views INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS membership_applications (
  id SERIAL PRIMARY KEY,
  tracking_id VARCHAR(40) NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  mobile VARCHAR(20) NOT NULL DEFAULT '',
  email VARCHAR(254) NULL,
  address TEXT NULL,
  citizenship_no VARCHAR(80) NULL,
  remarks TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  assigned_sadasyata VARCHAR(50) NULL,
  member_pk INTEGER NULL,
  admin_remarks TEXT NULL,
  reviewed_by INTEGER NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS request_status_history (
  id SERIAL PRIMARY KEY,
  module VARCHAR(64) NOT NULL,
  request_id INTEGER NOT NULL,
  old_status VARCHAR(64) DEFAULT NULL,
  new_status VARCHAR(64) DEFAULT NULL,
  admin_comment TEXT,
  notify_sent SMALLINT NOT NULL DEFAULT 0,
  actor_admin_id INTEGER DEFAULT NULL,
  actor_name VARCHAR(120) DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  admin_chose_to_notify SMALLINT NOT NULL DEFAULT 0,
  notify_email_status VARCHAR(20) NOT NULL DEFAULT 'not_attempted',
  notify_email_reason VARCHAR(180) DEFAULT NULL,
  notify_email_to VARCHAR(180) DEFAULT NULL,
  notify_sms_status VARCHAR(20) NOT NULL DEFAULT 'not_attempted',
  notify_sms_reason VARCHAR(180) DEFAULT NULL,
  notify_sms_to VARCHAR(40) DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS team_staff_groups (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) NOT NULL,
  name_np VARCHAR(120) NOT NULL DEFAULT '',
  name_en VARCHAR(120) NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  show_in_nav SMALLINT NOT NULL DEFAULT 1,
  menu_category_id INTEGER NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_menu_categories (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(50) NOT NULL,
  name_np VARCHAR(120) NOT NULL DEFAULT '',
  name_en VARCHAR(120) NOT NULL DEFAULT '',
  icon VARCHAR(80) NOT NULL DEFAULT 'fas fa-folder',
  source_type VARCHAR(20) NOT NULL DEFAULT 'staff',
  include_contact_officers SMALLINT NOT NULL DEFAULT 0,
  include_board SMALLINT NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active SMALLINT NOT NULL DEFAULT 1,
  show_in_nav SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  name_en VARCHAR(120) DEFAULT '',
  name_np VARCHAR(120) DEFAULT '',
  icon VARCHAR(80) DEFAULT 'fas fa-th-large',
  display_order INTEGER DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS service_products (
  id SERIAL PRIMARY KEY,
  service_id INTEGER NOT NULL,
  title_np VARCHAR(255) NOT NULL,
  title_en VARCHAR(255) DEFAULT '',
  description_np TEXT NULL,
  description_en TEXT NULL,
  display_order INTEGER DEFAULT 0,
  is_active SMALLINT DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sahakari_calendar_events (
  id SERIAL PRIMARY KEY,
  title_np VARCHAR(200) NOT NULL,
  title_en VARCHAR(200) NOT NULL DEFAULT '',
  description_np TEXT NULL,
  description_en TEXT NULL,
  event_type VARCHAR(40) NOT NULL DEFAULT 'program',
  recurrence VARCHAR(20) NOT NULL DEFAULT 'once',
  bs_year SMALLINT NOT NULL,
  bs_month SMALLINT NULL,
  bs_day SMALLINT NOT NULL,
  is_active SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS member_import_jobs (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER NULL,
  filename VARCHAR(255) NOT NULL DEFAULT '',
  stored_path VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'uploaded',
  mode VARCHAR(10) NOT NULL DEFAULT 'skip',
  total_rows INTEGER NOT NULL DEFAULT 0,
  parsed_rows INTEGER NOT NULL DEFAULT 0,
  ok_count INTEGER NOT NULL DEFAULT 0,
  skip_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  cards_count INTEGER NOT NULL DEFAULT 0,
  parse_offset INTEGER NOT NULL DEFAULT 0,
  parse_byte_offset INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS member_import_rows (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL,
  row_num INTEGER NOT NULL DEFAULT 0,
  sadasyata_number VARCHAR(50) NOT NULL DEFAULT '',
  full_name VARCHAR(255) NOT NULL DEFAULT '',
  mobile VARCHAR(20) NOT NULL DEFAULT '',
  email VARCHAR(255) NOT NULL DEFAULT '',
  address TEXT NULL,
  dob VARCHAR(20) NOT NULL DEFAULT '',
  gender VARCHAR(20) NOT NULL DEFAULT '',
  branch VARCHAR(100) NOT NULL DEFAULT '',
  remarks VARCHAR(500) NOT NULL DEFAULT '',
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  message VARCHAR(500) NOT NULL DEFAULT '',
  member_id INTEGER NULL
);

CREATE TABLE IF NOT EXISTS site_license_renewal_notices (
  id SERIAL PRIMARY KEY,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  gateway VARCHAR(32) NOT NULL DEFAULT '',
  txn_reference VARCHAR(180) NOT NULL DEFAULT '',
  amount_reported VARCHAR(40) NOT NULL DEFAULT '',
  note TEXT,
  submitted_by_admin_id INTEGER NULL,
  submitted_by_username VARCHAR(80) NULL DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CHECK (status IN ('pending','cleared','cancelled'))
);



CREATE INDEX IF NOT EXISTS admin_users_idx_role ON admin_users (role);
CREATE INDEX IF NOT EXISTS members_idx_members_sadasyata ON members (sadasyata_number);
CREATE INDEX IF NOT EXISTS members_idx_approval_status ON members (approval_status);
CREATE INDEX IF NOT EXISTS members_idx_members_kyc_app ON members (kyc_application_id);
CREATE INDEX IF NOT EXISTS members_idx_members_phone_active ON members (phone, is_active);
CREATE INDEX IF NOT EXISTS members_idx_is_active ON members (is_active);
CREATE INDEX IF NOT EXISTS site_settings_idx_group ON site_settings (setting_group);
CREATE INDEX IF NOT EXISTS notices_idx_active ON notices (is_active);
CREATE INDEX IF NOT EXISTS notices_idx_popup ON notices (is_popup);
CREATE INDEX IF NOT EXISTS notices_idx_popup_active ON notices (is_popup, is_active);
CREATE INDEX IF NOT EXISTS notices_idx_date ON notices (notice_date);
CREATE INDEX IF NOT EXISTS interest_rates_idx_category ON interest_rates (category);
CREATE INDEX IF NOT EXISTS interest_rates_idx_active ON interest_rates (is_active);
CREATE INDEX IF NOT EXISTS interest_rates_idx_order ON interest_rates (display_order);
CREATE INDEX IF NOT EXISTS services_idx_active ON services (is_active);
CREATE INDEX IF NOT EXISTS services_idx_order ON services (display_order);
CREATE INDEX IF NOT EXISTS services_idx_nav_group ON services (nav_group, is_active);
CREATE INDEX IF NOT EXISTS sliders_idx_active ON sliders (is_active);
CREATE INDEX IF NOT EXISTS sliders_idx_order ON sliders (display_order);
CREATE INDEX IF NOT EXISTS gallery_idx_active ON gallery (is_active);
CREATE INDEX IF NOT EXISTS gallery_idx_category ON gallery (category);
CREATE INDEX IF NOT EXISTS gallery_idx_gallery_album_id ON gallery (album_id);
CREATE INDEX IF NOT EXISTS gallery_albums_idx_gal_album_active ON gallery_albums (is_active);
CREATE INDEX IF NOT EXISTS gallery_albums_idx_gal_album_order ON gallery_albums (display_order);
CREATE INDEX IF NOT EXISTS team_members_idx_active ON team_members (is_active);
CREATE INDEX IF NOT EXISTS team_members_idx_category ON team_members (category);
CREATE INDEX IF NOT EXISTS contact_messages_idx_read ON contact_messages (is_read);
CREATE INDEX IF NOT EXISTS contact_messages_idx_date ON contact_messages (created_at);
CREATE INDEX IF NOT EXISTS pages_idx_active ON pages (is_active);
CREATE INDEX IF NOT EXISTS pages_idx_menu ON pages (show_in_menu, menu_position);
CREATE INDEX IF NOT EXISTS downloads_idx_active ON downloads (is_active);
CREATE INDEX IF NOT EXISTS downloads_idx_category ON downloads (category);
CREATE INDEX IF NOT EXISTS information_room_items_idx_ir_active ON information_room_items (is_active, category, display_order);
CREATE INDEX IF NOT EXISTS information_room_items_idx_ir_created ON information_room_items (created_at);
CREATE INDEX IF NOT EXISTS information_room_access_log_idx_ir_log_item ON information_room_access_log (item_id, created_at);
CREATE INDEX IF NOT EXISTS information_room_access_log_idx_ir_log_viewer ON information_room_access_log (viewer_type, viewer_id, created_at);
CREATE INDEX IF NOT EXISTS careers_idx_careers_active ON careers (is_active);
CREATE INDEX IF NOT EXISTS careers_idx_careers_deadline ON careers (deadline);
CREATE INDEX IF NOT EXISTS reports_idx_active ON reports (is_active);
CREATE INDEX IF NOT EXISTS reports_idx_type ON reports (report_type);
CREATE INDEX IF NOT EXISTS reports_idx_year ON reports (report_year);
CREATE INDEX IF NOT EXISTS member_feedback_idx_status ON member_feedback (status);
CREATE INDEX IF NOT EXISTS member_feedback_idx_type ON member_feedback (type);
CREATE INDEX IF NOT EXISTS member_feedback_idx_phone ON member_feedback (phone);
CREATE INDEX IF NOT EXISTS member_feedback_idx_email ON member_feedback (email);
CREATE INDEX IF NOT EXISTS news_idx_active ON news (is_active);
CREATE INDEX IF NOT EXISTS news_idx_date ON news (created_at);
CREATE INDEX IF NOT EXISTS member_success_stories_idx_mss_active_order ON member_success_stories (is_active, display_order, id);
CREATE INDEX IF NOT EXISTS service_centers_idx_active ON service_centers (is_active);
CREATE INDEX IF NOT EXISTS service_centers_idx_main ON service_centers (is_main_branch);
CREATE INDEX IF NOT EXISTS vendors_idx_status ON vendors (status);
CREATE INDEX IF NOT EXISTS vendors_idx_vendors_status_created ON vendors (status, created_at);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_phone ON digital_service_requests (phone);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_email ON digital_service_requests (email);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_status ON digital_service_requests (status);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_service_type ON digital_service_requests (service_type);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_created ON digital_service_requests (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS honor_categories_uq_honor_cat_slug ON honor_categories (slug);
CREATE INDEX IF NOT EXISTS honor_categories_idx_honor_cat_active ON honor_categories (is_active);
CREATE INDEX IF NOT EXISTS honor_categories_idx_honor_cat_order ON honor_categories (display_order);
CREATE INDEX IF NOT EXISTS honor_programs_idx_honor_prog_active ON honor_programs (is_active);
CREATE INDEX IF NOT EXISTS honor_programs_idx_honor_prog_window ON honor_programs (opens_at, closes_at);
CREATE INDEX IF NOT EXISTS honor_program_categories_idx_hpc_cat ON honor_program_categories (category_id);
CREATE UNIQUE INDEX IF NOT EXISTS honor_applications_uq_honor_tracking ON honor_applications (tracking_id);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_program ON honor_applications (program_id);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_category ON honor_applications (category_id);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_status ON honor_applications (status);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_phone ON honor_applications (phone);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_created ON honor_applications (created_at);
CREATE INDEX IF NOT EXISTS honor_applications_idx_honor_app_portal ON honor_applications (member_portal_id);
CREATE INDEX IF NOT EXISTS useful_links_idx_active ON useful_links (is_active);
CREATE INDEX IF NOT EXISTS activity_log_idx_admin ON activity_log (admin_id);
CREATE INDEX IF NOT EXISTS activity_log_idx_action ON activity_log (action);
CREATE INDEX IF NOT EXISTS activity_log_idx_date ON activity_log (created_at);
CREATE INDEX IF NOT EXISTS notification_log_idx_event ON notification_log (event_type);
CREATE INDEX IF NOT EXISTS notification_log_idx_created ON notification_log (created_at);
CREATE INDEX IF NOT EXISTS committee_types_idx_active ON committee_types (is_active);
CREATE INDEX IF NOT EXISTS committee_types_idx_navbar ON committee_types (show_in_navbar);
CREATE INDEX IF NOT EXISTS committee_tenures_idx_committee ON committee_tenures (committee_type_id);
CREATE INDEX IF NOT EXISTS committee_tenures_idx_current ON committee_tenures (is_current);
CREATE INDEX IF NOT EXISTS committee_members_idx_tenure ON committee_members (tenure_id);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_status ON kyc_applications (status);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_mobile ON kyc_applications (mobile);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_kyc_member ON kyc_applications (member_id);
CREATE INDEX IF NOT EXISTS loan_applications_idx_status ON loan_applications (status);
CREATE INDEX IF NOT EXISTS loan_applications_idx_mobile ON loan_applications (mobile);
CREATE INDEX IF NOT EXISTS appointments_idx_status ON appointments (status);
CREATE INDEX IF NOT EXISTS appointments_idx_date ON appointments (preferred_date);
CREATE INDEX IF NOT EXISTS appointments_idx_phone ON appointments (phone);
CREATE INDEX IF NOT EXISTS appointments_idx_appt_visit_kind ON appointments (visit_kind);
CREATE INDEX IF NOT EXISTS appointments_idx_appt_status_created ON appointments (status, created_at);
CREATE INDEX IF NOT EXISTS auction_notices_idx_status ON auction_notices (status);
CREATE INDEX IF NOT EXISTS auction_notices_idx_date ON auction_notices (auction_date);
CREATE INDEX IF NOT EXISTS auction_bids_idx_auction ON auction_bids (auction_id);
CREATE INDEX IF NOT EXISTS auction_bids_idx_status ON auction_bids (status);
CREATE INDEX IF NOT EXISTS account_applications_idx_status ON account_applications (status);
CREATE INDEX IF NOT EXISTS account_applications_idx_mobile ON account_applications (mobile);
CREATE INDEX IF NOT EXISTS grievances_idx_status ON grievances (status);
CREATE INDEX IF NOT EXISTS grievances_idx_category ON grievances (category);
CREATE INDEX IF NOT EXISTS grievances_idx_phone ON grievances (phone);
CREATE INDEX IF NOT EXISTS grievances_idx_email ON grievances (email);
CREATE INDEX IF NOT EXISTS chatbot_faqs_idx_active ON chatbot_faqs (is_active);
CREATE INDEX IF NOT EXISTS chatbot_faqs_idx_category ON chatbot_faqs (category);
CREATE INDEX IF NOT EXISTS faqs_idx_active ON faqs (is_active);
CREATE INDEX IF NOT EXISTS faqs_idx_category ON faqs (category);
CREATE INDEX IF NOT EXISTS awards_idx_active ON awards (is_active);
CREATE INDEX IF NOT EXISTS help_topics_idx_active ON help_topics (is_active);
CREATE INDEX IF NOT EXISTS visitor_counter_idx_visit_date ON visitor_counter (visit_date);
CREATE INDEX IF NOT EXISTS visitor_counter_idx_ip_date ON visitor_counter (ip_address, visit_date);
CREATE INDEX IF NOT EXISTS app_features_idx_active ON app_features (is_active);
CREATE INDEX IF NOT EXISTS institutional_profile_idx_active ON institutional_profile (is_active);
CREATE INDEX IF NOT EXISTS institutional_profile_idx_year ON institutional_profile (fiscal_year);
CREATE INDEX IF NOT EXISTS institutional_profile_idx_fy_month ON institutional_profile (fiscal_year, report_month);
CREATE INDEX IF NOT EXISTS job_applications_idx_career ON job_applications (career_id);
CREATE INDEX IF NOT EXISTS job_applications_idx_status ON job_applications (status);
CREATE INDEX IF NOT EXISTS member_welfare_claims_idx_phone ON member_welfare_claims (phone);
CREATE INDEX IF NOT EXISTS member_welfare_claims_idx_status ON member_welfare_claims (status);
CREATE INDEX IF NOT EXISTS member_welfare_claims_idx_created ON member_welfare_claims (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS welfare_claim_types_uq_wct_slug ON welfare_claim_types (slug);
CREATE INDEX IF NOT EXISTS welfare_claim_types_idx_wct_active ON welfare_claim_types (is_active);
CREATE INDEX IF NOT EXISTS welfare_claim_types_idx_wct_order ON welfare_claim_types (display_order);
CREATE UNIQUE INDEX IF NOT EXISTS digital_service_types_uq_dst_slug ON digital_service_types (slug);
CREATE INDEX IF NOT EXISTS digital_service_types_idx_dst_active ON digital_service_types (is_active);
CREATE INDEX IF NOT EXISTS digital_service_types_idx_dst_order ON digital_service_types (display_order);
CREATE INDEX IF NOT EXISTS members_idx_approval_created ON members (approval_status, created_at);
CREATE INDEX IF NOT EXISTS members_idx_phone ON members (phone);
CREATE INDEX IF NOT EXISTS members_idx_active_verified ON members (is_active, is_verified);
CREATE INDEX IF NOT EXISTS loan_applications_idx_status_created ON loan_applications (status, created_at);
CREATE INDEX IF NOT EXISTS loan_applications_idx_member ON loan_applications (member_id);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_status_created ON kyc_applications (status, created_at);
CREATE INDEX IF NOT EXISTS account_applications_idx_status_created ON account_applications (status, created_at);
CREATE INDEX IF NOT EXISTS appointments_idx_status_date ON appointments (status, preferred_date);
CREATE INDEX IF NOT EXISTS grievances_idx_status_created ON grievances (status, created_at);
CREATE INDEX IF NOT EXISTS job_applications_idx_status_created ON job_applications (status, created_at);
CREATE INDEX IF NOT EXISTS member_notifications_idx_member_read ON member_notifications (member_id, is_read);
CREATE INDEX IF NOT EXISTS member_notifications_idx_created ON member_notifications (created_at);
CREATE INDEX IF NOT EXISTS contact_messages_idx_read_created ON contact_messages (is_read, created_at);
CREATE INDEX IF NOT EXISTS news_idx_active_date ON news (is_active, created_at);
CREATE INDEX IF NOT EXISTS notices_idx_active_date ON notices (is_active, notice_date);
CREATE INDEX IF NOT EXISTS login_attempts_idx_lookup ON login_attempts (username, ip_address, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_idx_attempted ON login_attempts (attempted_at);
CREATE INDEX IF NOT EXISTS member_otp_tokens_idx_expires ON member_otp_tokens (expires_at);
CREATE INDEX IF NOT EXISTS audit_log_idx_actor ON audit_log (actor_type, actor_id);
CREATE INDEX IF NOT EXISTS audit_log_idx_entity ON audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_log_idx_action_date ON audit_log (action, created_at);
CREATE INDEX IF NOT EXISTS audit_log_idx_created ON audit_log (created_at);
CREATE INDEX IF NOT EXISTS members_idx_deleted_at ON members (deleted_at);
CREATE INDEX IF NOT EXISTS loan_applications_idx_deleted_at ON loan_applications (deleted_at);
CREATE INDEX IF NOT EXISTS account_applications_idx_deleted_at ON account_applications (deleted_at);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_deleted_at ON kyc_applications (deleted_at);
CREATE INDEX IF NOT EXISTS grievances_idx_deleted_at ON grievances (deleted_at);
CREATE INDEX IF NOT EXISTS contact_messages_idx_deleted_at ON contact_messages (deleted_at);
CREATE INDEX IF NOT EXISTS appointments_idx_deleted_at ON appointments (deleted_at);
CREATE INDEX IF NOT EXISTS members_idx_approval_active ON members (approval_status, is_active);
CREATE INDEX IF NOT EXISTS members_idx_created ON members (created_at);
CREATE INDEX IF NOT EXISTS loan_applications_idx_email ON loan_applications (email);
CREATE INDEX IF NOT EXISTS notices_idx_notices_active_id ON notices (is_active, id);
CREATE INDEX IF NOT EXISTS notification_log_idx_status_date ON notification_log (status, created_at);
CREATE INDEX IF NOT EXISTS notification_log_idx_event_type ON notification_log (event_type, channel);
CREATE INDEX IF NOT EXISTS member_notifications_idx_member_unread ON member_notifications (member_id, is_read, created_at);
CREATE INDEX IF NOT EXISTS login_attempts_idx_user_date ON login_attempts (username, attempted_at);
CREATE INDEX IF NOT EXISTS login_attempts_idx_ip_date ON login_attempts (ip_address, attempted_at);
CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_uniq_event_audience_channel ON notification_templates (event_type, audience, channel);
CREATE INDEX IF NOT EXISTS office_credentials_idx_category ON office_credentials (category);
CREATE INDEX IF NOT EXISTS office_credentials_idx_active ON office_credentials (is_active);
CREATE INDEX IF NOT EXISTS office_credentials_log_idx_cred ON office_credentials_log (credential_id);
CREATE INDEX IF NOT EXISTS office_credentials_log_idx_admin ON office_credentials_log (admin_id);
CREATE INDEX IF NOT EXISTS office_credentials_log_idx_action ON office_credentials_log (action);
CREATE INDEX IF NOT EXISTS kyc_applications_idx_kyc_member_generated ON kyc_applications (member_id_generated);
CREATE INDEX IF NOT EXISTS members_idx_members_kyc ON members (kyc_id);
CREATE INDEX IF NOT EXISTS member_id_cards_idx_card_member ON member_id_cards (member_id);
CREATE INDEX IF NOT EXISTS admin_activity_log_idx_activity_admin ON admin_activity_log (admin_id, created_at);
CREATE INDEX IF NOT EXISTS admin_activity_log_idx_activity_target ON admin_activity_log (target_type, target_id);
CREATE INDEX IF NOT EXISTS member_id_cards_idx_card_verify ON member_id_cards (verification_code);
CREATE INDEX IF NOT EXISTS card_verify_attempts_idx_attempt_ip_time ON card_verify_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS grievances_idx_grievances_phone_created ON grievances (phone, created_at);
CREATE INDEX IF NOT EXISTS grievances_idx_grievances_email_created ON grievances (email, created_at);
CREATE INDEX IF NOT EXISTS loan_applications_idx_loan_mobile_created ON loan_applications (mobile, created_at);
CREATE INDEX IF NOT EXISTS loan_applications_idx_loan_email_created ON loan_applications (email, created_at);
CREATE INDEX IF NOT EXISTS account_applications_idx_account_mobile_created ON account_applications (mobile, created_at);
CREATE INDEX IF NOT EXISTS account_applications_idx_account_email_created ON account_applications (email, created_at);
CREATE INDEX IF NOT EXISTS member_feedback_idx_feedback_phone_created ON member_feedback (phone, created_at);
CREATE INDEX IF NOT EXISTS member_feedback_idx_feedback_email_created ON member_feedback (email, created_at);
CREATE INDEX IF NOT EXISTS member_welfare_claims_idx_welfare_phone_created ON member_welfare_claims (phone, created_at);
CREATE INDEX IF NOT EXISTS member_welfare_claims_idx_welfare_email_created ON member_welfare_claims (email, created_at);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_dsr_phone_created ON digital_service_requests (phone, created_at);
CREATE INDEX IF NOT EXISTS digital_service_requests_idx_dsr_email_created ON digital_service_requests (email, created_at);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_date ON upcoming_programs (event_date);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_active ON upcoming_programs (is_active);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_prereg ON upcoming_programs (pre_registration_open);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_parent ON upcoming_programs (parent_program_id);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_multi ON upcoming_programs (is_multi_location);
CREATE INDEX IF NOT EXISTS upcoming_programs_idx_up_type ON upcoming_programs (program_type);
CREATE INDEX IF NOT EXISTS program_occurrences_idx_po_parent ON program_occurrences (parent_program_id);
CREATE INDEX IF NOT EXISTS program_occurrences_idx_po_active ON program_occurrences (is_active);
CREATE INDEX IF NOT EXISTS program_occurrences_idx_po_date ON program_occurrences (event_date);
CREATE INDEX IF NOT EXISTS program_occurrences_idx_po_qr ON program_occurrences (qr_token);
CREATE UNIQUE INDEX IF NOT EXISTS member_program_attendance_uniq_scope_member_status ON member_program_attendance (attendance_scope_key, member_id, attendance_status);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_member_program ON member_program_attendance (member_id, program_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_member ON member_program_attendance (member_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_program ON member_program_attendance (program_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_occurrence ON member_program_attendance (occurrence_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_parent ON member_program_attendance (parent_program_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_scope ON member_program_attendance (attendance_scope_key);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_scope_member ON member_program_attendance (attendance_scope_key, member_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_date ON member_program_attendance (attended_at);
CREATE INDEX IF NOT EXISTS member_program_attendance_idx_mpa_prog_att ON member_program_attendance (program_id, attended_at);
CREATE INDEX IF NOT EXISTS program_attendance_attempts_idx_paa_member ON program_attendance_attempts (member_id);
CREATE INDEX IF NOT EXISTS program_attendance_attempts_idx_paa_parent ON program_attendance_attempts (parent_program_id);
CREATE INDEX IF NOT EXISTS program_attendance_attempts_idx_paa_program ON program_attendance_attempts (program_id);
CREATE INDEX IF NOT EXISTS program_attendance_attempts_idx_paa_result ON program_attendance_attempts (result);
CREATE INDEX IF NOT EXISTS program_attendance_attempts_idx_paa_at ON program_attendance_attempts (attempted_at);
CREATE INDEX IF NOT EXISTS program_registration_desks_idx_prd_parent ON program_registration_desks (parent_program_id);
CREATE INDEX IF NOT EXISTS program_registration_desks_idx_prd_occurrence ON program_registration_desks (occurrence_id);
CREATE INDEX IF NOT EXISTS program_audit_logs_idx_pal_program ON program_audit_logs (program_id);
CREATE INDEX IF NOT EXISTS program_audit_logs_idx_pal_attendance ON program_audit_logs (attendance_id);
CREATE INDEX IF NOT EXISTS program_audit_logs_idx_pal_action ON program_audit_logs (action_type);
CREATE INDEX IF NOT EXISTS program_audit_logs_idx_pal_at ON program_audit_logs (created_at);
CREATE INDEX IF NOT EXISTS member_program_attendance_requests_idx_mpar_status ON member_program_attendance_requests (status);
CREATE INDEX IF NOT EXISTS member_program_attendance_requests_idx_mpar_program ON member_program_attendance_requests (program_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_requests_idx_mpar_member ON member_program_attendance_requests (member_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_requests_idx_mpar_status_prog ON member_program_attendance_requests (status, program_id);
CREATE INDEX IF NOT EXISTS member_program_attendance_requests_idx_mpar_occurrence ON member_program_attendance_requests (occurrence_id);
CREATE UNIQUE INDEX IF NOT EXISTS member_program_preregistrations_uniq_member_program_prereg ON member_program_preregistrations (member_id, program_id);
CREATE INDEX IF NOT EXISTS member_program_preregistrations_idx_mppr_member ON member_program_preregistrations (member_id);
CREATE INDEX IF NOT EXISTS member_program_preregistrations_idx_mppr_program ON member_program_preregistrations (program_id);
CREATE INDEX IF NOT EXISTS member_program_preregistrations_idx_mppr_date ON member_program_preregistrations (created_at);
CREATE INDEX IF NOT EXISTS member_program_preregistrations_idx_mppr_prog_created ON member_program_preregistrations (program_id, created_at);
CREATE INDEX IF NOT EXISTS member_partner_services_idx_mps_member ON member_partner_services (member_id);
CREATE INDEX IF NOT EXISTS member_partner_services_idx_mps_partner ON member_partner_services (partner_id);
CREATE INDEX IF NOT EXISTS member_partner_services_idx_mps_date ON member_partner_services (created_at);
CREATE INDEX IF NOT EXISTS election_cycles_idx_ec_pub_nav ON election_cycles (is_published, show_in_navbar);
CREATE INDEX IF NOT EXISTS election_cycles_idx_ec_sort ON election_cycles (sort_order, id);
CREATE INDEX IF NOT EXISTS election_milestones_idx_em_cycle ON election_milestones (cycle_id);
CREATE INDEX IF NOT EXISTS election_milestones_idx_em_cycle_ord ON election_milestones (cycle_id, display_order, id);
CREATE INDEX IF NOT EXISTS designations_idx_desig_cat_ord ON designations (category, display_order, id);
CREATE INDEX IF NOT EXISTS election_posts_idx_epost_active ON election_posts (is_active, display_order);
CREATE INDEX IF NOT EXISTS election_posts_idx_epost_ctype ON election_posts (committee_type_id);
CREATE INDEX IF NOT EXISTS election_posts_idx_epost_designation ON election_posts (designation_id);
CREATE INDEX IF NOT EXISTS election_positions_idx_ep_cycle ON election_positions (cycle_id);
CREATE INDEX IF NOT EXISTS election_positions_idx_ep_cycle_ord ON election_positions (cycle_id, display_order, id);
CREATE INDEX IF NOT EXISTS election_candidates_idx_ec_cycle ON election_candidates (cycle_id);
CREATE INDEX IF NOT EXISTS election_candidates_idx_ec_position ON election_candidates (position_id);
CREATE INDEX IF NOT EXISTS election_candidates_idx_ec_pos_ord ON election_candidates (position_id, display_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS election_vote_submissions_uniq_cycle_member ON election_vote_submissions (cycle_id, member_id);
CREATE INDEX IF NOT EXISTS election_vote_submissions_idx_evs_cycle ON election_vote_submissions (cycle_id);
CREATE UNIQUE INDEX IF NOT EXISTS election_votes_uniq_member_pos_cand ON election_votes (member_id, position_id, candidate_id);
CREATE INDEX IF NOT EXISTS election_votes_idx_ev_cycle ON election_votes (cycle_id);
CREATE INDEX IF NOT EXISTS election_votes_idx_ev_candidate ON election_votes (candidate_id);
CREATE INDEX IF NOT EXISTS election_votes_idx_ev_position ON election_votes (position_id);
CREATE UNIQUE INDEX IF NOT EXISTS partner_facilities_uniq_pf_code ON partner_facilities (partner_code);
CREATE INDEX IF NOT EXISTS partner_facilities_idx_pf_active ON partner_facilities (is_active, display_order);
CREATE INDEX IF NOT EXISTS partner_facilities_idx_pf_type ON partner_facilities (facility_type);
CREATE INDEX IF NOT EXISTS partner_facilities_idx_pf_vendor ON partner_facilities (vendor_id);
CREATE INDEX IF NOT EXISTS member_notifications_idx_mn_member ON member_notifications (member_id);
CREATE INDEX IF NOT EXISTS member_otp_tokens_idx_mot_member ON member_otp_tokens (member_id);
CREATE INDEX IF NOT EXISTS member_push_subscriptions_idx_member ON member_push_subscriptions (member_id);
CREATE INDEX IF NOT EXISTS member_push_log_idx_notif ON member_push_log (notif_id);
CREATE INDEX IF NOT EXISTS member_push_log_idx_member ON member_push_log (member_id);
CREATE INDEX IF NOT EXISTS member_marketplace_listings_idx_mkt_public ON member_marketplace_listings (listing_type, status, is_active, available_until);
CREATE INDEX IF NOT EXISTS member_marketplace_listings_idx_mkt_member ON member_marketplace_listings (member_id, created_at);
CREATE INDEX IF NOT EXISTS member_marketplace_listings_idx_mkt_status ON member_marketplace_listings (status, created_at);
CREATE INDEX IF NOT EXISTS member_marketplace_inquiries_idx_mkt_inq_listing ON member_marketplace_inquiries (listing_id, created_at);
CREATE INDEX IF NOT EXISTS member_marketplace_inquiries_idx_mkt_inq_read ON member_marketplace_inquiries (is_read, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS membership_applications_uq_membership_tracking ON membership_applications (tracking_id);
CREATE INDEX IF NOT EXISTS membership_applications_idx_membership_status ON membership_applications (status);
CREATE INDEX IF NOT EXISTS membership_applications_idx_membership_mobile ON membership_applications (mobile);
CREATE INDEX IF NOT EXISTS membership_applications_idx_membership_sadasyata ON membership_applications (assigned_sadasyata);
CREATE INDEX IF NOT EXISTS request_status_history_idx_module_request ON request_status_history (module, request_id);
CREATE INDEX IF NOT EXISTS request_status_history_idx_created_at ON request_status_history (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS team_staff_groups_uq_team_staff_groups_slug ON team_staff_groups (slug);
CREATE UNIQUE INDEX IF NOT EXISTS team_menu_categories_uq_team_menu_categories_slug ON team_menu_categories (slug);
CREATE INDEX IF NOT EXISTS service_products_idx_service ON service_products (service_id);
CREATE INDEX IF NOT EXISTS service_products_idx_service_active ON service_products (service_id, is_active);
CREATE INDEX IF NOT EXISTS sahakari_calendar_events_idx_sce_year ON sahakari_calendar_events (bs_year);
CREATE INDEX IF NOT EXISTS sahakari_calendar_events_idx_sce_active ON sahakari_calendar_events (is_active);
CREATE INDEX IF NOT EXISTS sahakari_calendar_events_idx_sce_ym ON sahakari_calendar_events (bs_year, bs_month);
CREATE INDEX IF NOT EXISTS sahakari_calendar_events_idx_sce_day ON sahakari_calendar_events (bs_day);
CREATE INDEX IF NOT EXISTS member_import_jobs_idx_mij_status ON member_import_jobs (status);
CREATE INDEX IF NOT EXISTS member_import_jobs_idx_mij_admin ON member_import_jobs (admin_id);
CREATE INDEX IF NOT EXISTS member_import_rows_idx_mir_job_status ON member_import_rows (job_id, status);
CREATE INDEX IF NOT EXISTS member_import_rows_idx_mir_job_row ON member_import_rows (job_id, row_num);
CREATE INDEX IF NOT EXISTS site_license_renewal_notices_idx_status ON site_license_renewal_notices (status);
