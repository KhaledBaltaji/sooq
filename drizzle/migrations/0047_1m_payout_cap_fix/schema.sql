-- ============================================================================
-- Migration 0047 — Sprint 3 P1 fix: 1m payout cap missing fee_config key
-- ============================================================================
--
-- /investigate found that mig 0046 added '1m' to the trade RPC duration list
-- but the per-ticket payout cap branch only handles 5m and 1h (everything
-- else falls through to 1h's $5000 cap).
--
--   IF v_market.duration::TEXT = '5m' THEN ... 'speed_entry_max_payout_usd_5m'
--   ELSE                              ... 'speed_entry_max_payout_usd_1h'
--
-- A 1m trade lands in the ELSE branch and uses 1h's $5000 cap instead of
-- the intended $250 (10× $25 stake). When admin flips speed_1m_markets_enabled,
-- 1m trades immediately bypass the payout cap until Phase 2 lands.
--
-- Fix:
--   1. Add speed_entry_max_payout_usd_1m = 250 to fee_config
--   2. Replace speed_execute_trade payout cap branch with explicit 1m / 5m / 1h.

SET search_path = public;

-- 1) Missing fee_config key
INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_entry_max_payout_usd_1m', 250,
   '0047 Sprint 3 fix: per-ticket payout cap for 1m markets. Matches speed_market_config.payout_max_usd. Was missing — mig 0046 only had 5m and 1h variants and 1m was falling through to the 1h $5000 cap.')
ON CONFLICT (fee_type) DO NOTHING;
