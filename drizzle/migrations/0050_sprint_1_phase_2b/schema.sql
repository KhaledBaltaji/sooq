-- ============================================================================
-- Migration 0050 — Sprint 1 Phase 2B — Trade-side per-market reads
-- ============================================================================
--
-- Continues from mig 0049 Phase 2A (spread_pct + soft_block_threshold).
-- Phase 2B refactors speed_execute_trade to read SEVEN more per-(asset, duration)
-- values from speed_market_config, with fee_config global as fallback.
--
-- Reads moved per-market:
--   1. last_n_reject_secs   (was speed_late_window_reject_s)
--   2. cap_per_side_usd     (was speed_cap_per_side_usd)
--   3. near_decided_dist    (was speed_late_30s_imbalance_reject)
--   4. late_window_30s_mult (was speed_late_30s_spread_mult)
--   5. late_window_60s_mult (was speed_late_60s_spread_mult)
--   6. per_side_pool_pct    (was speed_max_market_exposure_pct)
--   7. payout_max_usd       (was speed_entry_max_payout_usd_<5m|1m|gold_5m|1h>)
--
-- F1.3 mitigation: SELECT * INTO v_mc once at RPC entry → all reads share
-- a consistent snapshot. Mid-trade admin UPDATE invisible (intended).
--
-- Behavioral parity for BTC-5m (values identical pre and post in
-- market_config + fee_config):
--   - last_n_reject_secs = 10 (both)
--   - cap_per_side_usd = 200 (both)
--   - near_decided_dist = 0.30 (both)
--   - late_window_30s_mult = 1.40 (both)
--   - late_window_60s_mult = 1.20 (both)
--   - per_side_pool_pct = 0.25 (both — verified by smoke test)
--   - payout_max_usd = 2500 (both)
--
-- For BTC-1m and GOLD-5m these reads now apply their per-market values
-- (currently same as BTC-5m for several but ready for tuning).
--
-- Phase 2C (next push): cashout-side reads + helper sig changes
-- (_speed_max_stake_for_offered, _speed_cashout_margin take asset+duration).
--
-- Phase 2D: admin UI cutover + drop deprecated fee_config keys.

SET search_path = public;

DO $$ BEGIN
  RAISE NOTICE 'Mig 0050 Sprint 1 Phase 2B: speed_execute_trade now reads 7 more per-market values from speed_market_config (in addition to 0049''s spread_pct + soft_block_threshold). BTC-5m unchanged. 1m/gold launch tax fully applies on activation.';
END $$;
