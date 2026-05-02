-- Add short_code to markets for cleaner share URLs
-- Pattern: 8-char random hex, same as referral_code on users

ALTER TABLE markets
  ADD COLUMN short_code VARCHAR(8) UNIQUE DEFAULT substr(md5(random()::text), 1, 8);

-- Backfill existing markets
UPDATE markets SET short_code = substr(md5(random()::text || id::text), 1, 8)
  WHERE short_code IS NULL;

-- Now enforce NOT NULL
ALTER TABLE markets ALTER COLUMN short_code SET NOT NULL;

-- Index for fast lookups on /m/{code} route
CREATE INDEX idx_markets_short_code ON markets(short_code);
