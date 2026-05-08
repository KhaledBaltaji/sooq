-- ============================================================================
-- Migration 0049 — Sprint 1 Phase 2A — Two surgical per-market reads
-- ============================================================================
--
-- Phase 2 of the foundation refactor (started in mig 0042). Helpers + RPC
-- start reading their tunables from speed_market_config per (asset, duration)
-- instead of the global fee_config.
--
-- Phase 2A (this migration): the TWO reads that actually unblock 1m and
-- gold launch behavior:
--   - spread_pct (1m needs 8% / gold needs 4% / BTC-5m stays 5%)
--   - soft_block_threshold (1m needs 0.85 / gold needs 0.92 / BTC-5m stays 0.95)
--
-- Phase 2B (next push): remaining per-market reads (late-window mults,
-- last_n_reject_secs, near_decided_dist, cap_per_side, payout_max,
-- per_side_pool_pct, cashout coefficients, stake_max, matrix params),
-- helper signature updates (_speed_get_stake_max, _speed_max_stake_for_offered,
-- _speed_cashout_margin all take asset+duration), admin UI cutover.
--
-- Phase 2C (after 2B soaks): drop deprecated fee_config keys.
--
-- Pattern: helpers SELECT from speed_market_config WHERE (asset, duration,
-- enabled). On row-missing, fall back to fee_config global read (F1.2 safety
-- net preserves behavior for any market without a config row). Future
-- markets without config rows are rejected at duration check anyway, so
-- this fallback only matters for the BTC-5m row which exists.
--
-- Behavioral verification on staging:
--   - BTC-5m: market_config has spread_pct=0.05 → matches old fee_config → no behavior change
--   - BTC-5m: market_config has soft_block=0.95 → matches old fee_config → no behavior change
--   - BTC-1m: market_config has spread_pct=0.08, soft_block=0.85 → activates launch tax
--     when speed_1m_markets_enabled flips ON
--   - GOLD-5m: market_config has spread_pct=0.04, soft_block=0.92 → applies when
--     gold flag flips ON

SET search_path = public;

-- No schema changes; pure function rewrites in functions/*.sql

DO $$ BEGIN
  RAISE NOTICE 'Mig 0049 Sprint 1 Phase 2A: _speed_pricing_apply + speed_execute_trade now read soft_block_threshold + spread_pct from speed_market_config per (asset, duration). Behavior unchanged for BTC-5m (values identical). 1m + gold launch tax unblocked when their flags flip.';
END $$;
