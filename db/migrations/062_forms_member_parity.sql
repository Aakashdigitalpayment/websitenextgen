-- Public forms + member portal parity with the PHP site (docs/parity/2-forms-member.md). Idempotent.

-- auction bids get a tracking number (BID-…) so bidders can follow them in the public tracker
ALTER TABLE auction_bids ADD COLUMN IF NOT EXISTS tracking_id VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS auction_bids_tracking_uq ON auction_bids (tracking_id);
CREATE INDEX IF NOT EXISTS auction_bids_idx_phone ON auction_bids (auction_id, bidder_phone, created_at);
