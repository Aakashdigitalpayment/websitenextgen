-- PHP site: the complete database schema a production install can hold (MariaDB 10.11, generated).
-- = database/install.sql + every table/column the PHP app creates or adds at runtime (ensure*() in includes/,
--   admin/includes/ensure-admin-tables.php, admin pages, scripts/). Regenerate: scripts/legacy/inventory-php-schema.php.
-- Used by test/legacy-migration.test.js (fixture for every source table) and the parity audit in docs/MIGRATION.md.

/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `account_applications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `account_type` varchar(50) NOT NULL,
  `full_name` varchar(100) NOT NULL,
  `full_name_en` varchar(100) DEFAULT NULL,
  `dob_bs` varchar(20) DEFAULT NULL,
  `dob_ad` date DEFAULT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `marital_status` varchar(30) DEFAULT NULL,
  `mobile` varchar(20) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `permanent_address` text DEFAULT NULL,
  `temporary_address` text DEFAULT NULL,
  `citizenship_no` varchar(50) DEFAULT NULL,
  `citizenship_issued_date` varchar(20) DEFAULT NULL,
  `citizenship_issued_place` varchar(100) DEFAULT NULL,
  `father_name` varchar(100) DEFAULT NULL,
  `mother_name` varchar(100) DEFAULT NULL,
  `occupation` varchar(100) DEFAULT NULL,
  `monthly_income` varchar(50) DEFAULT NULL,
  `initial_deposit` varchar(50) DEFAULT NULL,
  `nominee_name` varchar(100) DEFAULT NULL,
  `nominee_relation` varchar(50) DEFAULT NULL,
  `nominee_phone` varchar(20) DEFAULT NULL,
  `branch` varchar(100) DEFAULT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `citizenship_front` varchar(255) DEFAULT NULL,
  `citizenship_back` varchar(255) DEFAULT NULL,
  `signature` varchar(255) DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `tracking_id` varchar(60) DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_mobile` (`mobile`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_status_date` (`status`,`created_at`),
  KEY `idx_account_mobile_created` (`mobile`,`created_at`),
  KEY `idx_account_email_created` (`email`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `activity_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) DEFAULT NULL,
  `action` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_admin` (`admin_id`),
  KEY `idx_action` (`action`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_activity_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) NOT NULL,
  `action` varchar(64) NOT NULL,
  `target_type` varchar(32) DEFAULT NULL,
  `target_id` int(11) DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `ip` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_activity_admin` (`admin_id`,`created_at`),
  KEY `idx_activity_target` (`target_type`,`target_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_roles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `description` varchar(255) NOT NULL DEFAULT '',
  `permissions` mediumtext DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password` varchar(255) NOT NULL,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `role` enum('superadmin','super_admin','admin','staff','editor') DEFAULT 'admin',
  `is_active` tinyint(1) DEFAULT 1,
  `status` varchar(20) DEFAULT 'active',
  `must_change_password` tinyint(1) NOT NULL DEFAULT 0,
  `twofa_enabled` tinyint(4) DEFAULT 0,
  `twofa_secret` varchar(64) DEFAULT NULL,
  `twofa_backup_codes` text DEFAULT NULL,
  `twofa_enabled_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `created_by` int(11) DEFAULT NULL,
  `last_login` timestamp NULL DEFAULT NULL,
  `last_password_change` timestamp NULL DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `custom_role_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  KEY `idx_role` (`role`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `app_features` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(100) NOT NULL,
  `title_np` varchar(100) DEFAULT NULL,
  `icon` varchar(100) DEFAULT 'fas fa-star',
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `is_new` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_appfeat_active_order` (`is_active`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `appointments` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `name` varchar(200) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `visit_kind` varchar(20) NOT NULL DEFAULT 'member',
  `organization_address` varchar(500) DEFAULT NULL,
  `organization_website` varchar(255) DEFAULT NULL,
  `contact_person` varchar(120) DEFAULT NULL,
  `purpose` enum('account_inquiry','loan_inquiry','kyc_update','loan_repayment','account_opening','other') DEFAULT 'other',
  `purpose_detail` text DEFAULT NULL,
  `preferred_date` date NOT NULL,
  `preferred_time` varchar(50) NOT NULL,
  `branch` varchar(200) DEFAULT NULL,
  `status` enum('pending','confirmed','completed','cancelled') DEFAULT 'pending',
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_date` (`preferred_date`),
  KEY `idx_phone` (`phone`),
  KEY `idx_appt_visit_kind` (`visit_kind`),
  KEY `idx_appt_status_created` (`status`,`created_at`),
  KEY `idx_status_date` (`status`,`preferred_date`),
  KEY `idx_deleted_at` (`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auction_bids` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `auction_id` int(11) NOT NULL,
  `bidder_name` varchar(120) NOT NULL,
  `bidder_phone` varchar(20) NOT NULL,
  `bidder_email` varchar(120) DEFAULT NULL,
  `bidder_address` varchar(255) DEFAULT NULL,
  `bid_amount` decimal(15,2) NOT NULL,
  `message` text DEFAULT NULL,
  `status` enum('pending','accepted','rejected') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `tracking_id` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_auction` (`auction_id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auction_notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_number` varchar(30) DEFAULT NULL,
  `title` varchar(255) NOT NULL,
  `title_en` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_en` text DEFAULT NULL,
  `property_type` varchar(100) DEFAULT NULL,
  `location` varchar(255) DEFAULT NULL,
  `google_map_link` varchar(600) DEFAULT NULL,
  `google_map_embed` text DEFAULT NULL,
  `area_bigha` decimal(10,2) DEFAULT 0.00,
  `area_ropani` decimal(10,2) DEFAULT 0.00,
  `area_aana` decimal(10,2) DEFAULT 0.00,
  `area_paisa` decimal(10,2) DEFAULT 0.00,
  `area` varchar(100) DEFAULT NULL,
  `minimum_price` decimal(15,2) DEFAULT 0.00,
  `auction_date` date DEFAULT NULL,
  `auction_time` varchar(30) DEFAULT NULL,
  `contact_person` varchar(120) DEFAULT NULL,
  `contact_phone` varchar(20) DEFAULT NULL,
  `image` varchar(255) DEFAULT NULL,
  `images` text DEFAULT NULL COMMENT 'JSON array of additional images',
  `document` varchar(255) DEFAULT NULL COMMENT 'PDF/Word document path',
  `status` enum('upcoming','ongoing','completed','cancelled') DEFAULT 'upcoming',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_number` (`tracking_number`),
  KEY `idx_status` (`status`),
  KEY `idx_date` (`auction_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` bigint(20) unsigned NOT NULL AUTO_INCREMENT,
  `actor_type` enum('admin','superadmin','member','system','public') NOT NULL DEFAULT 'system',
  `actor_id` int(10) unsigned DEFAULT NULL,
  `actor_name` varchar(150) DEFAULT NULL,
  `action` varchar(64) NOT NULL,
  `entity_type` varchar(64) NOT NULL,
  `entity_id` bigint(20) unsigned DEFAULT NULL,
  `summary` varchar(255) DEFAULT NULL,
  `old_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`old_values`)),
  `new_values` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`new_values`)),
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_actor` (`actor_type`,`actor_id`),
  KEY `idx_entity` (`entity_type`,`entity_id`),
  KEY `idx_action_date` (`action`,`created_at`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `awards` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_np` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `awarded_by` varchar(255) DEFAULT NULL,
  `awarded_by_np` varchar(255) DEFAULT NULL,
  `award_date` date DEFAULT NULL,
  `image` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_awards_active_order` (`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `card_verify_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip` varchar(45) NOT NULL,
  `code_tried` varchar(20) DEFAULT NULL,
  `success` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_attempt_ip_time` (`ip`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `careers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_np` varchar(255) DEFAULT NULL,
  `department` varchar(150) DEFAULT NULL,
  `location` varchar(150) DEFAULT NULL,
  `job_type` varchar(50) DEFAULT 'full_time',
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `requirements` text DEFAULT NULL,
  `deadline` date DEFAULT NULL,
  `attachment` varchar(255) DEFAULT NULL,
  `vacancies` int(11) DEFAULT 1,
  `min_qualification` varchar(255) DEFAULT NULL,
  `experience_required` varchar(150) DEFAULT NULL,
  `salary_range` varchar(150) DEFAULT NULL,
  `allow_online_apply` tinyint(1) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_careers_active` (`is_active`),
  KEY `idx_careers_deadline` (`deadline`),
  KEY `idx_careers_active_deadline` (`is_active`,`deadline`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `chatbot_faqs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `question` varchar(255) NOT NULL,
  `question_en` varchar(255) DEFAULT NULL,
  `answer` text NOT NULL,
  `answer_en` text DEFAULT NULL,
  `category` varchar(50) DEFAULT NULL,
  `keywords` text DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_category` (`category`),
  KEY `idx_faq_active_order` (`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `committee_members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tenure_id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `name_en` varchar(100) DEFAULT NULL,
  `position` varchar(100) NOT NULL,
  `position_en` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tenure` (`tenure_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `committee_tenures` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `committee_type_id` int(11) NOT NULL,
  `tenure_name` varchar(100) NOT NULL,
  `tenure_name_np` varchar(100) DEFAULT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `is_current` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_committee` (`committee_type_id`),
  KEY `idx_current` (`is_current`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `committee_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `name_np` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `show_in_navbar` tinyint(1) DEFAULT 0,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `icon` varchar(80) DEFAULT 'fas fa-users-gear',
  `menu_category_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_navbar` (`show_in_navbar`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `contact_messages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `subject` varchar(200) DEFAULT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_read` (`is_read`),
  KEY `idx_date` (`created_at`),
  KEY `idx_read_created` (`is_read`,`created_at`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_status_date` (`is_read`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `designations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_np` varchar(160) NOT NULL,
  `title_en` varchar(160) NOT NULL DEFAULT '',
  `category` varchar(50) NOT NULL DEFAULT 'committee',
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_desig_cat_ord` (`category`,`display_order`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `digital_service_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(50) NOT NULL,
  `requester_name` varchar(120) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(120) DEFAULT NULL,
  `service_type` varchar(60) NOT NULL,
  `service_type_np` varchar(120) DEFAULT NULL,
  `account_number` varchar(50) DEFAULT NULL,
  `statement_from` date DEFAULT NULL,
  `statement_to` date DEFAULT NULL,
  `biller_name` varchar(120) DEFAULT NULL,
  `bill_reference` varchar(120) DEFAULT NULL,
  `recharge_number` varchar(20) DEFAULT NULL,
  `recharge_amount` decimal(12,2) DEFAULT NULL,
  `service_amount` decimal(12,2) DEFAULT NULL,
  `request_details` text DEFAULT NULL,
  `attachment` varchar(255) DEFAULT NULL,
  `preferred_contact` enum('phone','email','branch') DEFAULT 'phone',
  `status` enum('pending','processing','approved','rejected','completed') DEFAULT 'pending',
  `admin_remarks` text DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '' COMMENT 'Admin reply file',
  `reviewed_by` varchar(100) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_status` (`status`),
  KEY `idx_service_type` (`service_type`),
  KEY `idx_created` (`created_at`),
  KEY `idx_dsr_phone_created` (`phone`,`created_at`),
  KEY `idx_dsr_email_created` (`email`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `digital_service_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(60) NOT NULL,
  `name_np` varchar(160) NOT NULL,
  `name_en` varchar(160) DEFAULT '',
  `icon` varchar(80) NOT NULL DEFAULT 'fas fa-laptop',
  `color` varchar(40) NOT NULL DEFAULT 'var(--primary-color)',
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `is_builtin` tinyint(1) NOT NULL DEFAULT 0,
  `requires_document` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dst_slug` (`slug`),
  KEY `idx_dst_active` (`is_active`),
  KEY `idx_dst_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `downloads` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `file_path` varchar(255) NOT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `category` varchar(50) DEFAULT 'general',
  `download_count` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_category` (`category`),
  KEY `idx_downloads_active_cat` (`is_active`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_candidates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cycle_id` int(11) NOT NULL,
  `position_id` int(11) NOT NULL,
  `name` varchar(160) NOT NULL,
  `name_en` varchar(160) NOT NULL DEFAULT '',
  `photo` varchar(500) DEFAULT NULL,
  `bio_np` text DEFAULT NULL,
  `bio_en` text DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `symbol_no` varchar(20) DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ec_cycle` (`cycle_id`),
  KEY `idx_ec_position` (`position_id`),
  KEY `idx_ec_pos_ord` (`position_id`,`display_order`,`id`),
  KEY `idx_ec_cycle_active` (`cycle_id`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_cycles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_np` varchar(200) NOT NULL,
  `title_en` varchar(200) NOT NULL DEFAULT '',
  `intro_np` text DEFAULT NULL,
  `intro_en` text DEFAULT NULL,
  `period_label` varchar(80) DEFAULT NULL,
  `date_from` date DEFAULT NULL,
  `date_to` date DEFAULT NULL,
  `is_published` tinyint(1) NOT NULL DEFAULT 0,
  `show_in_navbar` tinyint(1) NOT NULL DEFAULT 0,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `vote_start_at` datetime DEFAULT NULL,
  `vote_end_at` datetime DEFAULT NULL,
  `voting_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `results_finalized` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_ec_pub_nav` (`is_published`,`show_in_navbar`),
  KEY `idx_ec_sort` (`sort_order`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_milestones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cycle_id` int(11) NOT NULL,
  `event_date` date DEFAULT NULL,
  `title_np` varchar(220) NOT NULL,
  `title_en` varchar(220) NOT NULL DEFAULT '',
  `detail_np` text DEFAULT NULL,
  `detail_en` text DEFAULT NULL,
  `attachment` varchar(500) DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_em_cycle` (`cycle_id`),
  KEY `idx_em_cycle_ord` (`cycle_id`,`display_order`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_positions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cycle_id` int(11) NOT NULL,
  `post_id` int(11) DEFAULT NULL,
  `title_np` varchar(160) NOT NULL,
  `title_en` varchar(160) NOT NULL DEFAULT '',
  `seats` int(11) NOT NULL DEFAULT 1,
  `max_votes_per_voter` int(11) NOT NULL DEFAULT 1,
  `committee_type_id` int(11) DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ep_cycle` (`cycle_id`),
  KEY `idx_ep_cycle_ord` (`cycle_id`,`display_order`,`id`),
  KEY `idx_ep_cycle_active` (`cycle_id`,`is_active`),
  KEY `idx_ep_post` (`post_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_posts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `designation_id` int(11) DEFAULT NULL,
  `title_np` varchar(160) NOT NULL,
  `title_en` varchar(160) NOT NULL DEFAULT '',
  `committee_type_id` int(11) DEFAULT NULL,
  `default_seats` int(11) NOT NULL DEFAULT 1,
  `default_max_votes` int(11) NOT NULL DEFAULT 1,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_epost_active` (`is_active`,`display_order`),
  KEY `idx_epost_ctype` (`committee_type_id`),
  KEY `idx_epost_designation` (`designation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_vote_submissions` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cycle_id` int(11) NOT NULL,
  `member_id` int(11) NOT NULL,
  `submitted_at` timestamp NULL DEFAULT current_timestamp(),
  `source` varchar(30) NOT NULL DEFAULT 'member_portal',
  `proof_type` varchar(30) NOT NULL DEFAULT '',
  `verified_by_admin_id` int(11) DEFAULT NULL,
  `verified_by_name` varchar(120) NOT NULL DEFAULT '',
  `note` varchar(500) NOT NULL DEFAULT '',
  `is_ballot` tinyint(1) NOT NULL DEFAULT 1,
  `ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cycle_member` (`cycle_id`,`member_id`),
  KEY `idx_evs_cycle` (`cycle_id`),
  KEY `idx_evs_cycle_source` (`cycle_id`,`source`),
  KEY `idx_evs_cycle_ballot` (`cycle_id`,`is_ballot`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `election_votes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cycle_id` int(11) NOT NULL,
  `position_id` int(11) NOT NULL,
  `candidate_id` int(11) NOT NULL,
  `member_id` int(11) NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_member_pos_cand` (`member_id`,`position_id`,`candidate_id`),
  KEY `idx_ev_cycle` (`cycle_id`),
  KEY `idx_ev_candidate` (`candidate_id`),
  KEY `idx_ev_position` (`position_id`),
  KEY `idx_ev_cycle_cand` (`cycle_id`,`candidate_id`),
  KEY `idx_ev_cycle_pos` (`cycle_id`,`position_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `faqs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `question` varchar(500) NOT NULL,
  `question_np` varchar(500) DEFAULT NULL,
  `answer` text NOT NULL,
  `answer_np` text DEFAULT NULL,
  `category` varchar(100) DEFAULT 'general',
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_category` (`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gallery` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) DEFAULT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `image` varchar(255) NOT NULL,
  `category` varchar(50) DEFAULT 'general',
  `album_id` int(11) DEFAULT NULL,
  `album` varchar(200) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `media_type` varchar(20) DEFAULT 'photo',
  `video_url` varchar(500) DEFAULT '',
  `thumbnail` varchar(255) DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_category` (`category`),
  KEY `idx_gallery_album_id` (`album_id`),
  KEY `idx_gallery_active_cat` (`is_active`,`category`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gallery_albums` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name_np` varchar(200) NOT NULL,
  `name_en` varchar(200) DEFAULT '',
  `category` varchar(50) NOT NULL DEFAULT 'general',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_gal_album_active` (`is_active`),
  KEY `idx_gal_album_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `grievances` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `name` varchar(100) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `category` enum('service','staff','loan','account','branch','other') DEFAULT 'other',
  `subject` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `attachment` varchar(255) DEFAULT NULL,
  `is_anonymous` tinyint(1) DEFAULT 0,
  `status` enum('pending','in_progress','resolved','closed') DEFAULT 'pending',
  `admin_response` text DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '',
  `admin_note` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_category` (`category`),
  KEY `idx_phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_status_date` (`status`,`created_at`),
  KEY `idx_grievances_status_created` (`status`,`created_at`),
  KEY `idx_grievances_phone_created` (`phone`,`created_at`),
  KEY `idx_grievances_email_created` (`email`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `help_topics` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_np` varchar(255) DEFAULT NULL,
  `content` text NOT NULL,
  `content_np` text DEFAULT NULL,
  `icon` varchar(100) DEFAULT 'fas fa-question-circle',
  `category` varchar(100) DEFAULT 'general',
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `honor_applications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) NOT NULL,
  `program_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  `applicant_name` varchar(160) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(120) DEFAULT '',
  `address` varchar(255) DEFAULT '',
  `is_member` tinyint(1) NOT NULL DEFAULT 0,
  `member_id` varchar(50) DEFAULT '',
  `member_portal_id` int(11) DEFAULT NULL,
  `nominee_name` varchar(160) DEFAULT '',
  `nominee_relation` varchar(80) DEFAULT '',
  `exam_year` varchar(40) DEFAULT '',
  `institution` varchar(200) DEFAULT '',
  `business_note` varchar(255) DEFAULT '',
  `description` text DEFAULT NULL,
  `attachment` varchar(255) DEFAULT '',
  `status` enum('pending','under_review','shortlisted','selected','rejected','closed') NOT NULL DEFAULT 'pending',
  `admin_remarks` text DEFAULT NULL,
  `reviewed_by` varchar(100) DEFAULT '',
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_honor_tracking` (`tracking_id`),
  KEY `idx_honor_app_program` (`program_id`),
  KEY `idx_honor_app_category` (`category_id`),
  KEY `idx_honor_app_status` (`status`),
  KEY `idx_honor_app_phone` (`phone`),
  KEY `idx_honor_app_created` (`created_at`),
  KEY `idx_honor_app_portal` (`member_portal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `honor_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(60) NOT NULL,
  `name_np` varchar(160) NOT NULL,
  `name_en` varchar(160) DEFAULT '',
  `requires_nominee` tinyint(1) NOT NULL DEFAULT 1,
  `requires_document` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_honor_cat_slug` (`slug`),
  KEY `idx_honor_cat_active` (`is_active`),
  KEY `idx_honor_cat_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `honor_program_categories` (
  `program_id` int(11) NOT NULL,
  `category_id` int(11) NOT NULL,
  PRIMARY KEY (`program_id`,`category_id`),
  KEY `idx_hpc_cat` (`category_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `honor_programs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_np` varchar(200) NOT NULL,
  `title_en` varchar(200) DEFAULT '',
  `event_label` varchar(120) DEFAULT '',
  `fiscal_year` varchar(40) DEFAULT '',
  `opens_at` datetime NOT NULL,
  `closes_at` datetime NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_new_badge` tinyint(1) NOT NULL DEFAULT 1,
  `instructions_np` text DEFAULT NULL,
  `instructions_en` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_honor_prog_active` (`is_active`),
  KEY `idx_honor_prog_window` (`opens_at`,`closes_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `important_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `url` varchar(255) NOT NULL,
  `icon` varchar(255) DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `information_room_access_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `item_id` int(11) NOT NULL,
  `viewer_type` enum('admin','member') NOT NULL,
  `viewer_id` int(11) NOT NULL,
  `viewer_name` varchar(200) DEFAULT NULL,
  `action` varchar(30) NOT NULL DEFAULT 'view',
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ir_log_item` (`item_id`,`created_at`),
  KEY `idx_ir_log_viewer` (`viewer_type`,`viewer_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `information_room_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_np` varchar(255) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'other',
  `file_path` varchar(255) NOT NULL,
  `file_type` varchar(50) DEFAULT NULL,
  `meeting_date` date DEFAULT NULL,
  `reference_no` varchar(100) DEFAULT NULL,
  `allow_download` tinyint(1) NOT NULL DEFAULT 0,
  `restrict_copy` tinyint(1) NOT NULL DEFAULT 1,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_ir_active` (`is_active`,`category`,`display_order`),
  KEY `idx_ir_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `institutional_profile` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fiscal_year` varchar(20) NOT NULL,
  `report_month` tinyint(3) unsigned NOT NULL DEFAULT 0 COMMENT 'BS month 1-12; 0=annual/unset',
  `total_members` int(11) DEFAULT 0,
  `share_capital` decimal(18,2) DEFAULT 0.00,
  `deposit` decimal(18,2) DEFAULT 0.00,
  `loan` decimal(18,2) DEFAULT 0.00,
  `total_assets` decimal(18,2) DEFAULT 0.00,
  `other_fund` decimal(18,2) DEFAULT 0.00,
  `bank_cash_balance` decimal(18,2) DEFAULT 0.00,
  `fixed_assets` decimal(18,2) DEFAULT 0.00,
  `total_loan_members` int(11) DEFAULT 0,
  `npa_percent` decimal(5,2) DEFAULT 0.00,
  `profit_loss` decimal(18,2) DEFAULT 0.00,
  `access_level` enum('none','member') NOT NULL DEFAULT 'none',
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `report_date_bs` varchar(60) DEFAULT '',
  `report_date_ad` date DEFAULT NULL,
  `total_balance_member` int(11) DEFAULT 0,
  `share_capital_percent` decimal(8,2) DEFAULT 0.00,
  `reserved_fund` decimal(18,2) DEFAULT 0.00,
  `reserved_fund_percent` decimal(8,2) DEFAULT 0.00,
  `deposit_percent` decimal(8,2) DEFAULT 0.00,
  `loan_percent` decimal(8,2) DEFAULT 0.00,
  `total_loan_reserve_fund` decimal(15,2) DEFAULT 0.00,
  `total_loan_reserve_percent` decimal(8,2) DEFAULT 0.00,
  `npl_percent` decimal(5,2) DEFAULT 0.00,
  `liquidity_percent` decimal(8,2) DEFAULT 0.00,
  `net_profit` decimal(18,2) DEFAULT 0.00,
  `report_note` text DEFAULT NULL,
  `attachment_path` varchar(255) DEFAULT '' COMMENT 'PDF/photo attachment',
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_year` (`fiscal_year`),
  KEY `idx_fy_month` (`fiscal_year`,`report_month`),
  KEY `idx_ip_active_fy_month` (`is_active`,`fiscal_year`,`report_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `institutional_profile_welfare` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `profile_id` int(11) NOT NULL,
  `claim_type` varchar(60) NOT NULL,
  `month_count` int(11) NOT NULL DEFAULT 0,
  `month_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `cum_count` int(11) NOT NULL DEFAULT 0,
  `cum_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ipw_profile_type` (`profile_id`,`claim_type`),
  KEY `idx_ipw_profile` (`profile_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `institutional_welfare_opening` (
  `claim_type` varchar(60) NOT NULL,
  `opening_count` int(11) NOT NULL DEFAULT 0,
  `opening_amount` decimal(18,2) NOT NULL DEFAULT 0.00,
  `note` varchar(255) NOT NULL DEFAULT '',
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`claim_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `interest_rates` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `category` enum('saving','loan') NOT NULL,
  `name` varchar(100) NOT NULL,
  `name_np` varchar(100) DEFAULT NULL,
  `rate` decimal(5,2) NOT NULL,
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_active` (`is_active`),
  KEY `idx_order` (`display_order`),
  KEY `idx_rates_cat_active_order` (`category`,`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_applications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `career_id` int(11) NOT NULL DEFAULT 0,
  `full_name` varchar(200) NOT NULL,
  `email` varchar(100) NOT NULL,
  `phone` varchar(20) NOT NULL,
  `address` varchar(255) DEFAULT NULL,
  `date_of_birth` date DEFAULT NULL,
  `gender` enum('male','female','other') DEFAULT 'male',
  `education` varchar(255) DEFAULT NULL,
  `experience` varchar(255) DEFAULT NULL,
  `current_employer` varchar(200) DEFAULT NULL,
  `expected_salary` varchar(50) DEFAULT NULL,
  `cover_letter` text DEFAULT NULL,
  `resume_path` varchar(255) DEFAULT NULL,
  `photo_path` varchar(255) DEFAULT NULL,
  `citizenship_path` varchar(255) DEFAULT NULL,
  `certificates_path` varchar(255) DEFAULT NULL,
  `status` enum('pending','shortlisted','interviewed','selected','rejected') DEFAULT 'pending',
  `admin_notes` text DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_career` (`career_id`),
  KEY `idx_status` (`status`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_job_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `kyc_applications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` varchar(50) DEFAULT NULL,
  `full_name` varchar(100) NOT NULL,
  `full_name_en` varchar(100) DEFAULT NULL,
  `dob_bs` varchar(20) DEFAULT NULL,
  `dob_ad` date DEFAULT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `marital_status` varchar(30) DEFAULT NULL,
  `nationality` varchar(50) DEFAULT 'à¤¨à¥‡à¤ªà¤¾à¤²à¥€',
  `mobile` varchar(20) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `permanent_address` text DEFAULT NULL,
  `temporary_address` text DEFAULT NULL,
  `citizenship_no` varchar(50) DEFAULT NULL,
  `citizenship_issued_date` varchar(20) DEFAULT NULL,
  `citizenship_issued_place` varchar(100) DEFAULT NULL,
  `father_name` varchar(100) DEFAULT NULL,
  `mother_name` varchar(100) DEFAULT NULL,
  `grandfather_name` varchar(100) DEFAULT NULL,
  `spouse_name` varchar(100) DEFAULT NULL,
  `occupation` varchar(100) DEFAULT NULL,
  `organization_name` varchar(200) DEFAULT NULL,
  `monthly_income` varchar(50) DEFAULT NULL,
  `account_type` varchar(50) DEFAULT NULL,
  `branch` varchar(100) DEFAULT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `citizenship_front` varchar(255) DEFAULT NULL,
  `citizenship_back` varchar(255) DEFAULT NULL,
  `signature` varchar(255) DEFAULT NULL,
  `status` enum('pending','approved','rejected','incomplete','partial') DEFAULT 'pending',
  `member_id_generated` varchar(20) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `member_generated_at` datetime DEFAULT NULL,
  `member_generated_by` int(11) DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '',
  `left_thumb` varchar(255) DEFAULT NULL,
  `right_thumb` varchar(255) DEFAULT NULL,
  `national_id_number` varchar(50) DEFAULT NULL,
  `national_id_card` varchar(255) DEFAULT NULL,
  `photo_quality_score` tinyint(3) unsigned DEFAULT NULL,
  `risk_category` enum('low','medium','high') DEFAULT 'medium',
  `kyc_verified_at` datetime DEFAULT NULL,
  `risk_review_due_at` date DEFAULT NULL,
  `risk_review_status` enum('normal','due_review') DEFAULT 'normal',
  `family_details_json` text DEFAULT NULL,
  `aml_details_json` longtext DEFAULT NULL,
  `permanent_province` varchar(60) DEFAULT NULL,
  `permanent_district` varchar(60) DEFAULT NULL,
  `permanent_municipality` varchar(120) DEFAULT NULL,
  `permanent_ward` varchar(10) DEFAULT NULL,
  `permanent_tole` varchar(120) DEFAULT NULL,
  `temporary_province` varchar(60) DEFAULT NULL,
  `temporary_district` varchar(60) DEFAULT NULL,
  `temporary_municipality` varchar(120) DEFAULT NULL,
  `temporary_ward` varchar(10) DEFAULT NULL,
  `temporary_tole` varchar(120) DEFAULT NULL,
  `tracking_id` varchar(60) DEFAULT NULL,
  `want_id_card` tinyint(4) DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_kyc_tracking` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_mobile` (`mobile`),
  KEY `idx_kyc_member` (`member_id`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_status_date` (`status`,`created_at`),
  KEY `idx_kyc_member_generated` (`member_id_generated`),
  KEY `idx_kyc_member_status` (`member_id`,`status`),
  KEY `idx_kyc_status_created` (`status`,`created_at`),
  KEY `idx_kyc_mobile_status` (`mobile`,`status`),
  KEY `idx_kyc_email_status` (`email`,`status`),
  KEY `idx_kyc_updated` (`updated_at`),
  KEY `idx_kyc_risk_review` (`risk_review_status`,`risk_review_due_at`),
  KEY `idx_kyc_tracking` (`tracking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `loan_applications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `full_name` varchar(100) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `mobile` varchar(20) NOT NULL,
  `email` varchar(100) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `citizenship_no` varchar(50) DEFAULT NULL,
  `loan_type` varchar(100) DEFAULT NULL,
  `loan_amount` decimal(15,2) DEFAULT NULL,
  `loan_purpose` text DEFAULT NULL,
  `loan_tenure` int(11) DEFAULT NULL,
  `repayment_method` varchar(50) DEFAULT NULL,
  `occupation` varchar(100) DEFAULT NULL,
  `organization_name` varchar(200) DEFAULT NULL,
  `monthly_income` decimal(15,2) DEFAULT NULL,
  `other_income` text DEFAULT NULL,
  `collateral_type` varchar(100) DEFAULT NULL,
  `collateral_description` text DEFAULT NULL,
  `collateral_value` decimal(15,2) DEFAULT NULL,
  `guarantor_name` varchar(100) DEFAULT NULL,
  `guarantor_relation` varchar(50) DEFAULT NULL,
  `guarantor_phone` varchar(20) DEFAULT NULL,
  `guarantor_address` text DEFAULT NULL,
  `branch` varchar(100) DEFAULT NULL,
  `documents` text DEFAULT NULL,
  `status` enum('pending','processing','approved','rejected','disbursed') DEFAULT 'pending',
  `remarks` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `tracking_id` varchar(60) DEFAULT NULL,
  `admin_attachment` varchar(500) DEFAULT '',
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_mobile` (`mobile`),
  KEY `idx_status_created` (`status`,`created_at`),
  KEY `idx_member` (`member_id`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_status_date` (`status`,`created_at`),
  KEY `idx_email` (`email`),
  KEY `idx_loan_mobile_created` (`mobile`,`created_at`),
  KEY `idx_loan_email_created` (`email`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `login_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(100) NOT NULL,
  `ip_address` varchar(45) NOT NULL,
  `attempted_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_lookup` (`username`,`ip_address`,`attempted_at`),
  KEY `idx_attempted` (`attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_feedback` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `name` varchar(120) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(120) DEFAULT NULL,
  `type` enum('feedback','suggestion','complaint','inquiry') DEFAULT 'feedback',
  `subject` varchar(255) DEFAULT NULL,
  `message` text NOT NULL,
  `status` enum('pending','reviewed','resolved') DEFAULT 'pending',
  `admin_reply` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `admin_attachment` varchar(500) DEFAULT '',
  `admin_note` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_type` (`type`),
  KEY `idx_phone` (`phone`),
  KEY `idx_email` (`email`),
  KEY `idx_feedback_phone_created` (`phone`,`created_at`),
  KEY `idx_feedback_email_created` (`email`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_id_cards` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` varchar(20) NOT NULL,
  `card_no` varchar(40) NOT NULL,
  `verification_code` varchar(20) DEFAULT NULL,
  `cvv` varchar(20) DEFAULT NULL,
  `issued_date` date NOT NULL,
  `expiry_date` date DEFAULT NULL,
  `status` enum('active','expired','revoked','locked') DEFAULT 'active',
  `verify_count` int(11) DEFAULT 0,
  `last_verified_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `failed_verify_count` int(11) DEFAULT 0,
  `locked_at` timestamp NULL DEFAULT NULL,
  `unlock_requested` tinyint(1) DEFAULT 0,
  `unlock_requested_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `card_no` (`card_no`),
  UNIQUE KEY `verification_code` (`verification_code`),
  KEY `idx_card_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_import_jobs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `admin_id` int(11) DEFAULT NULL,
  `filename` varchar(255) NOT NULL DEFAULT '',
  `stored_path` varchar(500) NOT NULL DEFAULT '',
  `status` varchar(20) NOT NULL DEFAULT 'uploaded',
  `mode` varchar(10) NOT NULL DEFAULT 'skip',
  `total_rows` int(11) NOT NULL DEFAULT 0,
  `parsed_rows` int(11) NOT NULL DEFAULT 0,
  `ok_count` int(11) NOT NULL DEFAULT 0,
  `skip_count` int(11) NOT NULL DEFAULT 0,
  `fail_count` int(11) NOT NULL DEFAULT 0,
  `cards_count` int(11) NOT NULL DEFAULT 0,
  `parse_offset` int(11) NOT NULL DEFAULT 0,
  `parse_byte_offset` int(11) NOT NULL DEFAULT 0,
  `error_message` text DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mij_status` (`status`),
  KEY `idx_mij_admin` (`admin_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_import_rows` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `job_id` int(11) NOT NULL,
  `row_num` int(11) NOT NULL DEFAULT 0,
  `sadasyata_number` varchar(50) NOT NULL DEFAULT '',
  `full_name` varchar(255) NOT NULL DEFAULT '',
  `mobile` varchar(20) NOT NULL DEFAULT '',
  `email` varchar(255) NOT NULL DEFAULT '',
  `address` text DEFAULT NULL,
  `dob` varchar(20) NOT NULL DEFAULT '',
  `gender` varchar(20) NOT NULL DEFAULT '',
  `branch` varchar(100) NOT NULL DEFAULT '',
  `remarks` varchar(500) NOT NULL DEFAULT '',
  `status` varchar(20) NOT NULL DEFAULT 'queued',
  `message` varchar(500) NOT NULL DEFAULT '',
  `member_id` int(11) DEFAULT NULL,
  `name_np` varchar(255) NOT NULL DEFAULT '',
  `father_name` varchar(100) NOT NULL DEFAULT '',
  `citizenship_no` varchar(50) NOT NULL DEFAULT '',
  `membership_date` varchar(20) NOT NULL DEFAULT '',
  `monthly_saving` varchar(2) NOT NULL DEFAULT '',
  PRIMARY KEY (`id`),
  KEY `idx_mir_job_status` (`job_id`,`status`),
  KEY `idx_mir_job_row` (`job_id`,`row_num`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_marketplace_inquiries` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `listing_id` int(11) NOT NULL,
  `member_id` int(11) DEFAULT NULL,
  `inquirer_name` varchar(120) NOT NULL,
  `inquirer_phone` varchar(20) NOT NULL DEFAULT '',
  `message` varchar(1000) NOT NULL DEFAULT '',
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mkt_inq_listing` (`listing_id`,`created_at`),
  KEY `idx_mkt_inq_read` (`is_read`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_marketplace_listings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `listing_type` enum('product','skill') NOT NULL,
  `category` varchar(80) NOT NULL DEFAULT '',
  `title` varchar(200) NOT NULL,
  `description` text DEFAULT NULL,
  `unit` varchar(40) NOT NULL DEFAULT '',
  `price` decimal(12,2) DEFAULT NULL,
  `price_note` varchar(120) NOT NULL DEFAULT '',
  `quantity` varchar(80) NOT NULL DEFAULT '',
  `experience_years` tinyint(3) unsigned DEFAULT NULL,
  `location` varchar(200) NOT NULL DEFAULT '',
  `contact_name` varchar(120) NOT NULL DEFAULT '',
  `contact_phone` varchar(20) NOT NULL DEFAULT '',
  `image` varchar(255) DEFAULT NULL,
  `available_from` date DEFAULT NULL,
  `available_until` datetime DEFAULT NULL,
  `available_time_from` time DEFAULT NULL,
  `available_time_to` time DEFAULT NULL,
  `status` enum('pending','approved','rejected','expired','withdrawn') NOT NULL DEFAULT 'pending',
  `admin_note` varchar(500) NOT NULL DEFAULT '',
  `approved_at` datetime DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mkt_public` (`listing_type`,`status`,`is_active`,`available_until`),
  KEY `idx_mkt_member` (`member_id`,`created_at`),
  KEY `idx_mkt_status` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_notifications` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text DEFAULT NULL,
  `type` varchar(30) DEFAULT 'info',
  `link` varchar(500) DEFAULT NULL,
  `is_read` tinyint(4) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mn_member` (`member_id`),
  KEY `idx_mn_member_read` (`member_id`,`is_read`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_of_year` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `spotlight_year` varchar(10) NOT NULL,
  `member_name` varchar(200) NOT NULL,
  `member_name_en` varchar(100) DEFAULT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `photo` varchar(500) DEFAULT NULL,
  `member_since` varchar(20) DEFAULT NULL,
  `quote` text DEFAULT NULL,
  `quote_en` text DEFAULT NULL,
  `achievement` text DEFAULT NULL,
  `achievement_en` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `spotlight_year` (`spotlight_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_otp_tokens` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `otp_code` varchar(128) NOT NULL,
  `purpose` varchar(50) DEFAULT 'password_reset',
  `channel` varchar(10) DEFAULT 'sms',
  `sent_to` varchar(200) DEFAULT NULL,
  `is_used` tinyint(4) DEFAULT 0,
  `attempts` tinyint(4) DEFAULT 0,
  `expires_at` timestamp NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mot_member` (`member_id`),
  KEY `idx_mot_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_partner_services` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `member_card_no` varchar(50) DEFAULT '',
  `partner_id` int(11) DEFAULT NULL,
  `partner_name` varchar(255) NOT NULL,
  `service_name` varchar(255) DEFAULT '',
  `service_taken` tinyint(1) DEFAULT 0,
  `service_note` varchar(500) DEFAULT '',
  `verified_by_ip` varchar(45) DEFAULT '',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mps_member` (`member_id`),
  KEY `idx_mps_partner` (`partner_id`),
  KEY `idx_mps_date` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_password_reset_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `requested_at` timestamp NULL DEFAULT current_timestamp(),
  `admin_id` int(11) DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `temp_password` varchar(255) DEFAULT NULL,
  `admin_note` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `member_id` (`member_id`),
  CONSTRAINT `member_password_reset_requests_ibfk_1` FOREIGN KEY (`member_id`) REFERENCES `members` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_program_attendance` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `member_card_no` varchar(60) DEFAULT '',
  `program_id` int(11) NOT NULL,
  `occurrence_id` int(11) DEFAULT NULL,
  `parent_program_id` int(11) DEFAULT NULL,
  `attendance_scope_key` int(11) NOT NULL DEFAULT 0,
  `program_title` varchar(180) NOT NULL,
  `is_priority` tinyint(1) DEFAULT 0,
  `attendance_note` varchar(500) DEFAULT '',
  `verified_by_ip` varchar(45) DEFAULT '',
  `source` varchar(30) DEFAULT 'verify_portal',
  `attendance_method` enum('MEMBER_SELF','ADMIN_MANUAL','QR_SCAN','STAFF_VERIFY','ADMIN_APPROVE','ADMIN_PREREG') NOT NULL DEFAULT 'STAFF_VERIFY',
  `attendance_status` enum('VALID','VOID') NOT NULL DEFAULT 'VALID',
  `valid_lock` tinyint(4) DEFAULT NULL,
  `location_label` varchar(180) DEFAULT NULL,
  `desk_id` int(11) DEFAULT NULL,
  `staff_admin_id` int(11) DEFAULT NULL,
  `device_fingerprint` varchar(120) DEFAULT NULL,
  `voided_by` int(11) DEFAULT NULL,
  `voided_at` datetime DEFAULT NULL,
  `void_reason` varchar(500) DEFAULT NULL,
  `attended_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_scope_member_valid` (`attendance_scope_key`,`member_id`,`valid_lock`),
  KEY `idx_mpa_member_program` (`member_id`,`program_id`),
  KEY `idx_mpa_member` (`member_id`),
  KEY `idx_mpa_program` (`program_id`),
  KEY `idx_mpa_occurrence` (`occurrence_id`),
  KEY `idx_mpa_parent` (`parent_program_id`),
  KEY `idx_mpa_scope` (`attendance_scope_key`),
  KEY `idx_mpa_scope_member` (`attendance_scope_key`,`member_id`),
  KEY `idx_mpa_date` (`attended_at`),
  KEY `idx_mpa_prog_att` (`program_id`,`attended_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_program_attendance_requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `member_card_no` varchar(60) DEFAULT '',
  `member_name` varchar(150) DEFAULT '',
  `member_phone` varchar(30) DEFAULT '',
  `member_address` varchar(255) DEFAULT '',
  `program_id` int(11) NOT NULL,
  `occurrence_id` int(11) DEFAULT NULL,
  `program_title` varchar(180) NOT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `requested_at` timestamp NULL DEFAULT current_timestamp(),
  `processed_at` timestamp NULL DEFAULT NULL,
  `verified_by_ip` varchar(45) DEFAULT '',
  `user_agent` varchar(255) DEFAULT '',
  `admin_id` int(11) DEFAULT NULL,
  `admin_note` varchar(500) DEFAULT '',
  `source` varchar(40) DEFAULT 'public_qr_request',
  PRIMARY KEY (`id`),
  KEY `idx_mpar_status` (`status`),
  KEY `idx_mpar_program` (`program_id`),
  KEY `idx_mpar_member` (`member_id`),
  KEY `idx_mpar_status_prog` (`status`,`program_id`),
  KEY `idx_mpar_occurrence` (`occurrence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_program_preregistrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `member_card_no` varchar(60) DEFAULT '',
  `member_name` varchar(150) DEFAULT '',
  `phone` varchar(30) DEFAULT '',
  `email` varchar(120) DEFAULT '',
  `program_id` int(11) NOT NULL,
  `program_title` varchar(180) NOT NULL,
  `event_date` date DEFAULT NULL,
  `note` varchar(500) DEFAULT '',
  `source` varchar(30) DEFAULT 'member_portal',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_member_program_prereg` (`member_id`,`program_id`),
  KEY `idx_mppr_member` (`member_id`),
  KEY `idx_mppr_program` (`program_id`),
  KEY `idx_mppr_date` (`created_at`),
  KEY `idx_mppr_prog_created` (`program_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_push_log` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `notif_id` int(10) unsigned DEFAULT NULL,
  `member_id` int(10) unsigned DEFAULT NULL,
  `endpoint` varchar(255) NOT NULL DEFAULT '',
  `http_code` smallint(5) unsigned DEFAULT 0,
  `sent_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_notif` (`notif_id`),
  KEY `idx_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_push_subscriptions` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `member_id` int(10) unsigned NOT NULL,
  `endpoint` text NOT NULL,
  `p256dh` varchar(512) NOT NULL,
  `auth` varchar(64) NOT NULL,
  `user_agent` varchar(255) DEFAULT '',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_endpoint` (`endpoint`(255)),
  KEY `idx_member` (`member_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_success_stories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_name` varchar(200) NOT NULL,
  `member_name_en` varchar(200) DEFAULT NULL,
  `member_id_no` varchar(50) DEFAULT NULL,
  `photo` varchar(500) DEFAULT NULL,
  `member_since` varchar(40) DEFAULT NULL,
  `location` varchar(150) DEFAULT NULL,
  `location_en` varchar(150) DEFAULT NULL,
  `profession` varchar(150) DEFAULT NULL,
  `profession_en` varchar(150) DEFAULT NULL,
  `headline_np` varchar(255) NOT NULL,
  `headline_en` varchar(255) DEFAULT NULL,
  `story_np` text NOT NULL,
  `story_en` text DEFAULT NULL,
  `institution_help_np` text DEFAULT NULL,
  `institution_help_en` text DEFAULT NULL,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_mss_active_order` (`is_active`,`display_order`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_survey` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(50) NOT NULL,
  `member_name` varchar(120) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `satisfaction_level` tinyint(4) DEFAULT 3 COMMENT '1-5 scale',
  `service_quality` tinyint(4) DEFAULT 3,
  `staff_behavior` tinyint(4) DEFAULT 3,
  `response_time` tinyint(4) DEFAULT 3,
  `suggestions` text DEFAULT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `member_welfare_claims` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `member_name` varchar(120) NOT NULL,
  `member_id` varchar(50) DEFAULT NULL,
  `phone` varchar(20) NOT NULL,
  `email` varchar(120) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `claim_type` varchar(60) NOT NULL DEFAULT 'other',
  `claim_amount` decimal(12,2) DEFAULT 0.00,
  `description` text DEFAULT NULL,
  `claim_date_bs` varchar(20) DEFAULT NULL,
  `claim_date_ad` date DEFAULT NULL,
  `status` enum('pending','processing','approved','rejected') DEFAULT 'pending',
  `approved_amount` decimal(12,2) DEFAULT NULL,
  `admin_remarks` text DEFAULT NULL,
  `attachment_path` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `policy_number` varchar(80) DEFAULT NULL,
  `insurer_name` varchar(150) DEFAULT NULL,
  `member_portal_id` int(11) DEFAULT NULL,
  `full_name` varchar(120) GENERATED ALWAYS AS (`member_name`) VIRTUAL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_phone` (`phone`),
  KEY `idx_status` (`status`),
  KEY `idx_created` (`created_at`),
  KEY `idx_welfare_phone_created` (`phone`,`created_at`),
  KEY `idx_welfare_email_created` (`email`,`created_at`),
  KEY `idx_claim_type` (`claim_type`),
  KEY `idx_member_id` (`member_id`),
  KEY `idx_portal` (`member_portal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `name_np` varchar(255) NOT NULL DEFAULT '',
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `sadasyata_number` varchar(50) NOT NULL DEFAULT '',
  `password_hash` varchar(255) DEFAULT NULL,
  `google_id` varchar(255) DEFAULT NULL,
  `facebook_id` varchar(255) DEFAULT NULL,
  `avatar_url` varchar(500) DEFAULT NULL,
  `member_card_no` varchar(50) DEFAULT NULL,
  `kyc_application_id` int(11) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `dob` date DEFAULT NULL,
  `gender` varchar(20) DEFAULT NULL,
  `approval_status` varchar(20) DEFAULT 'pending',
  `kyc_id` int(11) DEFAULT NULL,
  `approved_at` timestamp NULL DEFAULT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `id_card_generated` tinyint(4) DEFAULT 0,
  `id_card_generated_at` timestamp NULL DEFAULT NULL,
  `card_expires_at` timestamp NULL DEFAULT NULL,
  `is_verified` tinyint(4) DEFAULT 0,
  `is_active` tinyint(4) DEFAULT 1,
  `information_room_enabled` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `last_login` timestamp NULL DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `twofa_enabled` tinyint(4) DEFAULT 0,
  `twofa_secret` varchar(64) DEFAULT NULL,
  `twofa_backup_codes` text DEFAULT NULL,
  `twofa_enabled_at` datetime DEFAULT NULL,
  `membership_date` date DEFAULT NULL,
  `monthly_saving_regular` tinyint(1) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_members_sadasyata` (`sadasyata_number`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_members_sadasyata` (`sadasyata_number`),
  KEY `idx_approval_status` (`approval_status`),
  KEY `idx_members_kyc_app` (`kyc_application_id`),
  KEY `idx_members_phone_active` (`phone`,`is_active`),
  KEY `idx_is_active` (`is_active`),
  KEY `idx_approval_created` (`approval_status`,`created_at`),
  KEY `idx_active_verified` (`is_active`,`is_verified`),
  KEY `idx_deleted_at` (`deleted_at`),
  KEY `idx_approval_active` (`approval_status`,`is_active`),
  KEY `idx_created` (`created_at`),
  KEY `idx_members_kyc` (`kyc_id`),
  KEY `idx_members_email_active` (`email`,`is_active`),
  KEY `idx_members_phone` (`phone`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `membership_applications` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(40) NOT NULL,
  `full_name` varchar(200) NOT NULL,
  `mobile` varchar(20) NOT NULL DEFAULT '',
  `email` varchar(254) DEFAULT NULL,
  `address` text DEFAULT NULL,
  `citizenship_no` varchar(80) DEFAULT NULL,
  `remarks` text DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'pending',
  `assigned_sadasyata` varchar(50) DEFAULT NULL,
  `member_pk` int(10) unsigned DEFAULT NULL,
  `admin_remarks` text DEFAULT NULL,
  `reviewed_by` int(10) unsigned DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_membership_tracking` (`tracking_id`),
  KEY `idx_membership_status` (`status`),
  KEY `idx_membership_mobile` (`mobile`),
  KEY `idx_membership_sadasyata` (`assigned_sadasyata`),
  KEY `idx_membapp_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `news` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `content` text DEFAULT NULL,
  `content_np` text DEFAULT NULL,
  `image` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_news_active_created` (`is_active`,`created_at`),
  KEY `idx_news_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `title_np` varchar(255) DEFAULT NULL,
  `content` text DEFAULT NULL,
  `content_np` text DEFAULT NULL,
  `notice_date` date DEFAULT NULL,
  `attachment` varchar(255) DEFAULT NULL,
  `popup_image` varchar(255) DEFAULT NULL,
  `popup_photo_only` tinyint(1) NOT NULL DEFAULT 0,
  `popup_expires_at` date DEFAULT NULL COMMENT 'AD date; popup hidden after this day',
  `is_active` tinyint(1) DEFAULT 1,
  `is_popup` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_popup` (`is_popup`),
  KEY `idx_popup_active` (`is_popup`,`is_active`),
  KEY `idx_date` (`notice_date`),
  KEY `idx_active_date` (`is_active`,`notice_date`),
  KEY `idx_notices_active_id` (`is_active`,`id`),
  KEY `idx_notices_popup` (`is_popup`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `event_type` varchar(100) NOT NULL COMMENT 'loan_application, grievance, etc.',
  `channel` enum('email','sms') NOT NULL,
  `recipient` varchar(200) NOT NULL,
  `subject` varchar(500) DEFAULT NULL,
  `message` text DEFAULT NULL,
  `status` enum('sent','failed') DEFAULT 'sent',
  `error_msg` varchar(500) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_event` (`event_type`),
  KEY `idx_created` (`created_at`),
  KEY `idx_status_date` (`status`,`created_at`),
  KEY `idx_event_type` (`event_type`,`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Notification send log';
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_templates` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `event_type` varchar(64) NOT NULL,
  `audience` enum('admin','member') NOT NULL DEFAULT 'admin',
  `channel` enum('email','sms') NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT 1,
  `subject` varchar(255) DEFAULT NULL,
  `body` text NOT NULL,
  `variables` varchar(255) DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_event_audience_channel` (`event_type`,`audience`,`channel`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `office_credentials` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `site_name` varchar(120) NOT NULL,
  `site_url` varchar(500) NOT NULL,
  `site_logo` varchar(255) DEFAULT NULL,
  `username` varchar(255) NOT NULL,
  `password_enc` text NOT NULL,
  `password_iv` varchar(64) NOT NULL,
  `category` varchar(60) DEFAULT 'general',
  `notes` text DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `sort_order` int(11) DEFAULT 0,
  `created_by` int(11) NOT NULL,
  `updated_by` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_category` (`category`),
  KEY `idx_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `office_credentials_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `credential_id` int(11) NOT NULL,
  `admin_id` int(11) NOT NULL,
  `admin_username` varchar(50) DEFAULT NULL,
  `action` varchar(30) NOT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cred` (`credential_id`),
  KEY `idx_admin` (`admin_id`),
  KEY `idx_action` (`action`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pages` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(100) NOT NULL,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `title_en` varchar(200) DEFAULT NULL,
  `content` longtext DEFAULT NULL,
  `content_np` longtext DEFAULT NULL,
  `show_in_menu` tinyint(1) DEFAULT 0,
  `menu_position` varchar(50) DEFAULT 'about',
  `menu_order` int(11) DEFAULT 0,
  `menu_icon` varchar(80) NOT NULL DEFAULT 'fas fa-file-lines',
  `is_new` tinyint(1) DEFAULT 0,
  `new_until` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `slug` (`slug`),
  KEY `idx_active` (`is_active`),
  KEY `idx_menu` (`show_in_menu`,`menu_position`),
  KEY `idx_pages_nav` (`is_active`,`show_in_menu`,`menu_order`),
  KEY `idx_pages_nav_pos` (`is_active`,`show_in_menu`,`menu_position`,`menu_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `partner_facilities` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `partner_name` varchar(200) NOT NULL,
  `partner_name_en` varchar(200) NOT NULL DEFAULT '',
  `location` varchar(200) NOT NULL DEFAULT '',
  `facility_type` varchar(100) NOT NULL DEFAULT '',
  `discount_percent` decimal(5,2) DEFAULT 0.00,
  `discount_label` varchar(160) NOT NULL DEFAULT '',
  `description` text DEFAULT NULL,
  `description_en` text DEFAULT NULL,
  `terms_np` text DEFAULT NULL,
  `logo_path` varchar(500) DEFAULT NULL,
  `contact_phone` varchar(30) NOT NULL DEFAULT '',
  `contact_email` varchar(120) NOT NULL DEFAULT '',
  `website_url` varchar(255) NOT NULL DEFAULT '',
  `partner_code` varchar(32) DEFAULT NULL,
  `pin_hash` varchar(255) DEFAULT NULL,
  `vendor_id` int(11) DEFAULT NULL,
  `is_featured` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(4) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_pf_code` (`partner_code`),
  KEY `idx_pf_active` (`is_active`,`display_order`),
  KEY `idx_pf_type` (`facility_type`),
  KEY `idx_pf_vendor` (`vendor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `program_attendance_attempts` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `member_id` int(11) NOT NULL,
  `parent_program_id` int(11) NOT NULL,
  `program_id` int(11) NOT NULL,
  `occurrence_id` int(11) DEFAULT NULL,
  `attempted_method` varchar(40) NOT NULL DEFAULT '',
  `attempted_at` timestamp NULL DEFAULT current_timestamp(),
  `previous_attendance_id` int(11) DEFAULT NULL,
  `result` enum('DUPLICATE_BLOCKED','WINDOW_CLOSED','INELIGIBLE','INVALID_MEMBER','INVALID_PROGRAM','OTHER') NOT NULL DEFAULT 'OTHER',
  `result_message` varchar(500) DEFAULT '',
  `verified_by_ip` varchar(45) DEFAULT '',
  `desk_id` int(11) DEFAULT NULL,
  `staff_admin_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_paa_member` (`member_id`),
  KEY `idx_paa_parent` (`parent_program_id`),
  KEY `idx_paa_program` (`program_id`),
  KEY `idx_paa_result` (`result`),
  KEY `idx_paa_at` (`attempted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `program_audit_logs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `action_type` varchar(60) NOT NULL,
  `program_id` int(11) DEFAULT NULL,
  `occurrence_id` int(11) DEFAULT NULL,
  `attendance_id` int(11) DEFAULT NULL,
  `member_id` int(11) DEFAULT NULL,
  `admin_id` int(11) DEFAULT NULL,
  `reason` varchar(500) DEFAULT '',
  `payload_json` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT '',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_pal_program` (`program_id`),
  KEY `idx_pal_attendance` (`attendance_id`),
  KEY `idx_pal_action` (`action_type`),
  KEY `idx_pal_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `program_occurrences` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `parent_program_id` int(11) NOT NULL,
  `location_name` varchar(180) NOT NULL DEFAULT '',
  `venue_id` int(11) DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `start_time` varchar(30) DEFAULT NULL,
  `end_time` varchar(30) DEFAULT NULL,
  `attendance_open_at` datetime DEFAULT NULL,
  `attendance_close_at` datetime DEFAULT NULL,
  `qr_token` varchar(64) DEFAULT NULL,
  `qr_enabled` tinyint(1) NOT NULL DEFAULT 1,
  `qr_starts_at` datetime DEFAULT NULL,
  `qr_expires_at` datetime DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `qr_token` (`qr_token`),
  KEY `idx_po_parent` (`parent_program_id`),
  KEY `idx_po_active` (`is_active`),
  KEY `idx_po_date` (`event_date`),
  KEY `idx_po_qr` (`qr_token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `program_registration_desks` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `parent_program_id` int(11) NOT NULL,
  `occurrence_id` int(11) DEFAULT NULL,
  `desk_label` varchar(60) NOT NULL DEFAULT 'Desk 01',
  `assigned_staff_admin_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_prd_parent` (`parent_program_id`),
  KEY `idx_prd_occurrence` (`occurrence_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reports` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `report_type` varchar(50) DEFAULT 'annual',
  `report_year` varchar(20) DEFAULT NULL,
  `report_month` varchar(20) DEFAULT NULL,
  `report_quarter` varchar(10) DEFAULT NULL,
  `file_path` varchar(255) DEFAULT NULL,
  `access_level` enum('none','member') NOT NULL DEFAULT 'none',
  `view_only` tinyint(1) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_type` (`report_type`),
  KEY `idx_year` (`report_year`),
  KEY `idx_reports_type_active` (`report_type`,`is_active`,`report_year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `request_status_history` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `module` varchar(64) NOT NULL,
  `request_id` int(11) NOT NULL,
  `old_status` varchar(64) DEFAULT NULL,
  `new_status` varchar(64) DEFAULT NULL,
  `admin_comment` text DEFAULT NULL,
  `notify_sent` tinyint(1) NOT NULL DEFAULT 0,
  `actor_admin_id` int(11) DEFAULT NULL,
  `actor_name` varchar(120) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `admin_chose_to_notify` tinyint(1) NOT NULL DEFAULT 0,
  `notify_email_status` varchar(20) NOT NULL DEFAULT 'not_attempted',
  `notify_email_reason` varchar(180) DEFAULT NULL,
  `notify_email_to` varchar(180) DEFAULT NULL,
  `notify_sms_status` varchar(20) NOT NULL DEFAULT 'not_attempted',
  `notify_sms_reason` varchar(180) DEFAULT NULL,
  `notify_sms_to` varchar(40) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_module_request` (`module`,`request_id`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sahakari_calendar_events` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title_np` varchar(200) NOT NULL,
  `title_en` varchar(200) NOT NULL DEFAULT '',
  `description_np` text DEFAULT NULL,
  `description_en` text DEFAULT NULL,
  `event_type` varchar(40) NOT NULL DEFAULT 'program',
  `recurrence` varchar(20) NOT NULL DEFAULT 'once',
  `bs_year` smallint(6) NOT NULL,
  `bs_month` tinyint(4) DEFAULT NULL,
  `bs_day` tinyint(4) NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sce_year` (`bs_year`),
  KEY `idx_sce_active` (`is_active`),
  KEY `idx_sce_ym` (`bs_year`,`bs_month`),
  KEY `idx_sce_day` (`bs_day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `satisfaction_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_en` varchar(200) DEFAULT NULL,
  `url` varchar(500) NOT NULL,
  `icon` varchar(100) DEFAULT 'fas fa-smile',
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `version` varchar(50) NOT NULL,
  `applied_at` timestamp NULL DEFAULT current_timestamp(),
  `description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(120) NOT NULL,
  `name_en` varchar(120) DEFAULT '',
  `name_np` varchar(120) DEFAULT '',
  `icon` varchar(80) DEFAULT 'fas fa-th-large',
  `display_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_centers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(200) NOT NULL,
  `name_np` varchar(200) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `province` varchar(50) DEFAULT NULL,
  `opening_hours` varchar(100) DEFAULT NULL,
  `map_url` varchar(500) DEFAULT NULL,
  `is_main_branch` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_main` (`is_main_branch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `service_products` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `service_id` int(11) NOT NULL,
  `title_np` varchar(255) NOT NULL,
  `title_en` varchar(255) DEFAULT '',
  `description_np` text DEFAULT NULL,
  `description_en` text DEFAULT NULL,
  `display_order` int(11) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_service` (`service_id`),
  KEY `idx_service_active` (`service_id`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `services` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(100) NOT NULL,
  `title_np` varchar(100) DEFAULT NULL,
  `title_en` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `icon` varchar(50) DEFAULT 'fas fa-star',
  `image` varchar(255) DEFAULT NULL,
  `nav_group` varchar(40) DEFAULT 'general',
  `service_category_id` int(11) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_order` (`display_order`),
  KEY `idx_nav_group` (`nav_group`,`is_active`),
  KEY `idx_services_active_order` (`is_active`,`display_order`),
  KEY `idx_services_nav_group` (`nav_group`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_license_renewal_notices` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `status` enum('pending','cleared','cancelled') NOT NULL DEFAULT 'pending',
  `gateway` varchar(32) NOT NULL DEFAULT '',
  `txn_reference` varchar(180) NOT NULL DEFAULT '',
  `amount_reported` varchar(40) NOT NULL DEFAULT '',
  `note` text DEFAULT NULL,
  `submitted_by_admin_id` int(11) DEFAULT NULL,
  `submitted_by_username` varchar(80) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `setting_type` enum('text','textarea','image','number','color','url') DEFAULT 'text',
  `setting_label` varchar(200) DEFAULT NULL,
  `setting_group` varchar(50) DEFAULT 'general',
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`),
  KEY `idx_group` (`setting_group`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `site_stats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `stat_key` varchar(100) NOT NULL,
  `stat_value` bigint(20) DEFAULT 0,
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `stat_key` (`stat_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sliders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) DEFAULT NULL,
  `subtitle` varchar(255) DEFAULT NULL,
  `image` varchar(255) NOT NULL,
  `button_text` varchar(50) DEFAULT NULL,
  `button_url` varchar(255) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_order` (`display_order`),
  KEY `idx_sliders_active_order` (`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_members` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `name_en` varchar(100) DEFAULT NULL,
  `position` varchar(100) DEFAULT NULL,
  `position_np` varchar(100) DEFAULT NULL,
  `position_en` varchar(100) DEFAULT NULL,
  `photo` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `category` varchar(50) NOT NULL DEFAULT 'staff',
  `is_information_officer` tinyint(1) DEFAULT 0,
  `is_grievance_officer` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `chart_row` tinyint(3) unsigned NOT NULL DEFAULT 0 COMMENT '0=auto, 1-5=manual org chart row',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `is_chairman` tinyint(1) DEFAULT 0,
  `is_ceo` tinyint(1) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_category` (`category`),
  KEY `idx_team_active_order` (`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_menu_categories` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(50) NOT NULL,
  `name_np` varchar(120) NOT NULL DEFAULT '',
  `name_en` varchar(120) NOT NULL DEFAULT '',
  `icon` varchar(80) NOT NULL DEFAULT 'fas fa-folder',
  `source_type` varchar(20) NOT NULL DEFAULT 'staff',
  `include_contact_officers` tinyint(1) NOT NULL DEFAULT 0,
  `include_board` tinyint(1) NOT NULL DEFAULT 0,
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_nav` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_team_menu_categories_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_staff_groups` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(50) NOT NULL,
  `name_np` varchar(120) NOT NULL DEFAULT '',
  `name_en` varchar(120) NOT NULL DEFAULT '',
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `show_in_nav` tinyint(1) NOT NULL DEFAULT 1,
  `menu_category_id` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_team_staff_groups_slug` (`slug`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `upcoming_programs` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(180) NOT NULL,
  `program_type` enum('General','AGM','SGM','Orientation','Training','Seminar','Workshop','Financial_Literacy','Other') NOT NULL DEFAULT 'General',
  `parent_program_id` int(11) DEFAULT NULL,
  `is_multi_location` tinyint(1) NOT NULL DEFAULT 0,
  `description` text DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `event_time` varchar(30) DEFAULT NULL,
  `location` varchar(180) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `pre_registration_open` tinyint(1) DEFAULT 0,
  `qr_enabled` tinyint(1) DEFAULT 1,
  `qr_token` varchar(64) DEFAULT NULL,
  `qr_starts_at` datetime DEFAULT NULL,
  `qr_expires_at` datetime DEFAULT NULL,
  `attendance_open_at` datetime DEFAULT NULL,
  `attendance_close_at` datetime DEFAULT NULL,
  `eligible_member_scope` varchar(30) NOT NULL DEFAULT 'all_active',
  `instant_attendance` tinyint(1) NOT NULL DEFAULT 0,
  `shared_qr_mode` tinyint(1) NOT NULL DEFAULT 1,
  `created_by` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `qr_token` (`qr_token`),
  KEY `idx_up_date` (`event_date`),
  KEY `idx_up_active` (`is_active`),
  KEY `idx_up_prereg` (`pre_registration_open`),
  KEY `idx_up_parent` (`parent_program_id`),
  KEY `idx_up_multi` (`is_multi_location`),
  KEY `idx_up_type` (`program_type`),
  KEY `idx_up_active_date` (`is_active`,`event_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `useful_links` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(200) NOT NULL,
  `title_np` varchar(200) DEFAULT NULL,
  `url` varchar(500) NOT NULL,
  `icon` varchar(100) DEFAULT 'fas fa-link',
  `description` text DEFAULT NULL,
  `description_np` text DEFAULT NULL,
  `is_popup` tinyint(1) DEFAULT 0,
  `is_active` tinyint(1) DEFAULT 1,
  `display_order` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_active` (`is_active`),
  KEY `idx_ul_active_order` (`is_active`,`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendors` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tracking_id` varchar(60) DEFAULT NULL,
  `company_name` varchar(255) NOT NULL,
  `owner_name` varchar(100) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `pan_no` varchar(50) DEFAULT NULL,
  `business_type` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') DEFAULT 'pending',
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `linked_partner_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `tracking_id` (`tracking_id`),
  KEY `idx_status` (`status`),
  KEY `idx_vendors_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitor_counter` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ip_address` varchar(45) NOT NULL,
  `user_agent` text DEFAULT NULL,
  `page_visited` varchar(255) DEFAULT NULL,
  `visit_date` date NOT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_visit_date` (`visit_date`),
  KEY `idx_ip_date` (`ip_address`,`visit_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `visitor_stats` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `visit_date` date NOT NULL,
  `visitor_count` int(11) DEFAULT 0,
  `page_views` int(11) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `visit_date` (`visit_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `welfare_claim_types` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `slug` varchar(60) NOT NULL,
  `name_np` varchar(160) NOT NULL,
  `name_en` varchar(160) DEFAULT '',
  `icon` varchar(80) NOT NULL DEFAULT 'fas fa-gift',
  `color` varchar(40) NOT NULL DEFAULT '#ff9800',
  `form_profile` varchar(40) NOT NULL DEFAULT 'other',
  `display_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `is_builtin` tinyint(1) NOT NULL DEFAULT 0,
  `requires_document` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_wct_slug` (`slug`),
  KEY `idx_wct_active` (`is_active`),
  KEY `idx_wct_order` (`display_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `why_choose_features` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `icon` varchar(100) NOT NULL DEFAULT 'fas fa-star',
  `title_np` varchar(200) NOT NULL DEFAULT '',
  `title_en` varchar(200) NOT NULL DEFAULT '',
  `desc_np` text DEFAULT NULL,
  `desc_en` text DEFAULT NULL,
  `sort_order` int(11) NOT NULL DEFAULT 0,
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
