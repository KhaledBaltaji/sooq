-- Add keywords column to markets for news matching
-- Keywords are manually curated per market (e.g., ['lebanon', 'president', 'election'])

ALTER TABLE markets ADD COLUMN keywords TEXT[] DEFAULT '{}';
