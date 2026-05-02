-- 100_v3_drop_v2.sql — V3 Migration: Drop all V2 pool-based tables, functions, and columns
-- Pre-launch: no real users, full migration (no coexistence needed)

BEGIN;

-- ============================================================
-- 1. Drop V2 Functions (order matters: dependents first)
-- ============================================================

DROP FUNCTION IF EXISTS place_bet(UUID, bet_side, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS dynamic_max_bet(UUID, bet_side) CASCADE;
DROP FUNCTION IF EXISTS calculate_payouts(UUID, bet_side) CASCADE;
DROP FUNCTION IF EXISTS distribute_payouts(UUID, bet_side) CASCADE;
DROP FUNCTION IF EXISTS settle_commissions(UUID) CASCADE;
DROP FUNCTION IF EXISTS record_revenue(UUID, DECIMAL) CASCADE;
DROP FUNCTION IF EXISTS void_market(UUID) CASCADE;
DROP FUNCTION IF EXISTS _void_market_internal(UUID) CASCADE;
DROP FUNCTION IF EXISTS dead_market_check() CASCADE;
DROP FUNCTION IF EXISTS resolve_market(UUID, bet_side) CASCADE;

-- ============================================================
-- 2. Drop V2 Materialized View + refresh function/trigger
-- ============================================================

DROP TRIGGER IF EXISTS trg_refresh_leaderboard ON markets;
DROP FUNCTION IF EXISTS refresh_leaderboard() CASCADE;
DROP MATERIALIZED VIEW IF EXISTS leaderboard_stats CASCADE;

-- ============================================================
-- 3. Remove bets from Realtime publication
-- ============================================================

ALTER PUBLICATION supabase_realtime DROP TABLE bets;

-- ============================================================
-- 4. Drop V2 Tables
-- ============================================================

DROP TABLE IF EXISTS bets CASCADE;

-- ============================================================
-- 5. Drop V2 Pool Columns from markets
-- ============================================================

ALTER TABLE markets DROP COLUMN IF EXISTS pool_yes;
ALTER TABLE markets DROP COLUMN IF EXISTS pool_no;
ALTER TABLE markets DROP COLUMN IF EXISTS seed_amount_yes;
ALTER TABLE markets DROP COLUMN IF EXISTS seed_amount_no;

COMMIT;
