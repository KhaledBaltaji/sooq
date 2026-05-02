-- seed.sql — Test data for local development
-- Run after migrations. Creates test users, markets, fee_config is already seeded in 009.

-- Note: In real setup, users are created through auth.users first.
-- For local dev, insert directly (Supabase local does not enforce auth FK in seed).
