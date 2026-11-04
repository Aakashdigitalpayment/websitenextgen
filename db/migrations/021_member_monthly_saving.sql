-- मासिक बचत (includes/member-monthly-saving.php COOP_MONTHLY_SAVING_COL): 1 = regular, 0 = not regular, NULL = unknown.
-- Shown and edited on the KYM record, stored on the linked member, included in the KYC export.
ALTER TABLE members ADD COLUMN IF NOT EXISTS monthly_saving_regular SMALLINT NULL;
