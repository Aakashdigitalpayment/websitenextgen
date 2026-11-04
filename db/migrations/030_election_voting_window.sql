-- Elections: voting switch + Nepal-time window (legacy election-information.php), results finalisation,
-- reusable post master link (legacy election_positions.post_id).
ALTER TABLE election_cycles ADD COLUMN IF NOT EXISTS vote_start_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE election_cycles ADD COLUMN IF NOT EXISTS vote_end_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE election_cycles ADD COLUMN IF NOT EXISTS voting_enabled SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE election_cycles ADD COLUMN IF NOT EXISTS results_finalized SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE election_positions ADD COLUMN IF NOT EXISTS post_id INTEGER NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS election_positions_idx_ep_post ON election_positions (post_id);
CREATE INDEX IF NOT EXISTS election_vote_submissions_idx_evs_cycle_ballot ON election_vote_submissions (cycle_id, is_ballot);
