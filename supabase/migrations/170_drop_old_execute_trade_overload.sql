-- ============================================================
-- 170: Drop old execute_trade overload with p_direction parameter
--
-- Migration 110 created execute_trade(UUID, TEXT, TEXT, DECIMAL)
-- with a p_direction parameter. Later migrations (159+) switched
-- to (UUID, TEXT, DECIMAL, DECIMAL) with p_amount/p_shares_to_sell.
-- Both overloads coexist in Postgres. The old one still references
-- the now-renamed bet_count column (renamed to trade_count in 169).
-- Drop the old overload so only the current signature remains.
-- ============================================================

DROP FUNCTION IF EXISTS execute_trade(UUID, TEXT, TEXT, DECIMAL);
