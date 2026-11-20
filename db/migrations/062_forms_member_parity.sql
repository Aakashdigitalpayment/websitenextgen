-- Public forms + member portal parity with the PHP site (docs/parity/2-forms-member.md). Idempotent.

-- auction bids get a tracking number (BID-…) so bidders can follow them in the public tracker
ALTER TABLE auction_bids ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS auction_bids_tracking_uq ON auction_bids (tracking_id);
CREATE INDEX IF NOT EXISTS auction_bids_idx_phone ON auction_bids (auction_id, bidder_phone, created_at);

-- verified Member ID on account opening (online-account.php account_member_id)
ALTER TABLE account_applications ADD COLUMN IF NOT EXISTS member_id VARCHAR(50);

-- applications made while signed in to the portal stay linked to the member even when the phone changes
ALTER TABLE loan_applications ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE account_applications ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE grievances ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE digital_service_requests ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE member_feedback ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE job_applications ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE kyc_applications ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE member_survey ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
ALTER TABLE auction_bids ADD COLUMN IF NOT EXISTS member_portal_id INTEGER;
