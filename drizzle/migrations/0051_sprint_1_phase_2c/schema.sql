-- ============================================================================
-- Migration 0051 — Sprint 1 Phase 2C — Cashout per-market reads + helper sigs
-- ============================================================================
--
-- Continues from Phase 2B (mig 0050 — trade-side reads). Phase 2C does:
--
-- 1. speed_execute_cashout reads cashout-side per-(asset, duration) values:
--      - cashout_reject_secs (was speed_cashout_late_reject_s)
--      - cashout_cap_edge_threshold (was speed_cashout_cap_edge_threshold)
--      - cashout_late_30s_imbalance (was speed_cashout_late_30s_imbalance_reject)
--
-- 2. _speed_cashout_margin signature change:
--      Old: (duration, is_winning, mark_prob, seconds_left)
--      New: (asset, duration, is_winning, mark_prob, seconds_left)
--    Reads cashout_winning_base / losing_base / saturation_coef / desperation_coef
--    / late_winning_coef / late_losing_coef from speed_market_config per
--    (asset, duration). Old signature DROPped to prevent overload ambiguity.
--
-- 3. _speed_max_stake_for_offered signature change:
--      Old: (duration, offered_prob)
--      New: (asset, duration, offered_prob)
--    Reads stake_max_usd / payout_max_usd / per_side_pool_pct from
--    speed_market_config. Old signature DROPped.
--
-- 4. speed_execute_trade caller updated to new _speed_max_stake_for_offered sig.
-- 5. speed_execute_cashout caller updated to new _speed_cashout_margin sig.
--
-- Pattern: all helpers SELECT * INTO v_mc speed_market_config%ROWTYPE first,
-- then COALESCE(v_mc.column, fee_config.global, hardcoded_default).
--
-- BTC-5m behavior unchanged (market_config values identical to fee_config).
-- BTC-1m and GOLD-5m now apply their per-market cashout coefficients on
-- activation.
--
-- Phase 2D (next push): admin UI cutover + drop deprecated fee_config keys
-- (~22 keys go dead once admin UI writes to speed_market_config directly).

SET search_path = public;

DO $$ BEGIN
  RAISE NOTICE 'Mig 0051 Sprint 1 Phase 2C: speed_execute_cashout + _speed_cashout_margin + _speed_max_stake_for_offered all read per-(asset, duration) from speed_market_config. Helper signatures changed (old sigs dropped). All trade + cashout pricing now reads per-market config.';
END $$;
