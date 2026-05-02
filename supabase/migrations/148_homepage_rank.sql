-- Add homepage_rank column for popularity-based homepage market selection
-- Ranked daily by cron job at midnight UTC. NULL = not ranked.
ALTER TABLE markets ADD COLUMN homepage_rank INTEGER DEFAULT NULL;
