-- Coverage gaps from docs/parity/coverage.md (SM-n, Part B §7). Safe to re-run.

-- ---------------------------------------------------------------- SM-1 card CVV
-- PHP widened cvv to VARCHAR(20) for the name+Member-ID CVV printed on its cards (e.g. SUJ0123; card-verify-helpers.php:331).
ALTER TABLE member_id_cards ALTER COLUMN cvv TYPE VARCHAR(20) USING trim(cvv);
