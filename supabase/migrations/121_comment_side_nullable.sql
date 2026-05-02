BEGIN;

ALTER TABLE market_comments DROP CONSTRAINT IF EXISTS market_comments_side_check;
ALTER TABLE market_comments ALTER COLUMN side DROP NOT NULL;
ALTER TABLE market_comments ADD CONSTRAINT market_comments_side_check CHECK (side IS NULL OR side IN ('yes', 'no'));

COMMIT;
