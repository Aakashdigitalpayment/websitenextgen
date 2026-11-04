-- Security hardening (review round 2)

-- secret ballot: election_votes ids are random, so vote rows cannot be matched to submissions by insertion order
ALTER TABLE election_votes ALTER COLUMN id SET DEFAULT (floor(random() * 2147483000) + 1)::int;

-- partner desk PIN: lock a partner after repeated wrong PINs
ALTER TABLE partner_facilities ADD COLUMN IF NOT EXISTS pin_failed_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE partner_facilities ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMP NULL;
