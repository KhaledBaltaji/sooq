-- ============================================================================
-- Migration 0048 — Sprint 4 Phase 1 — Gold market infrastructure
-- ============================================================================
--
-- Lays SQL groundwork for second asset class. Same pattern as Sprint 3 (1m):
-- flag-gated infrastructure now; user-facing activation blocked on:
--   1. Oracle source decision (OANDA / CoinAPI / TradingView — founder pick)
--   2. Oracle worker built (services/speed-oracle-gold or extension of existing)
--   3. Sprint 1 Phase 2 (helpers read per-(asset, duration) config so gold's
--      4% spread + 0.92 soft-block actually apply, instead of inheriting
--      BTC global fee_config values)
--   4. trading_hours_json populated (CME-aligned XAU/USD schedule)
--   5. Frontend asset switcher
--
-- What this migration does:
--   1. Refine GOLD speed_asset_config (tighter wick, NULL oracle_source until
--      decided, keep enabled=FALSE)
--   2. Insert GOLD-5m row in speed_market_config with conservative defaults
--   3. Add speed_entry_max_payout_usd_gold_5m fee_config key (parallel to
--      BTC's _5m / _1h / _1m keys; needed for trade RPC payout cap branch)
--   4. Add speed_gold_markets_enabled fee_config flag (default OFF; redundant
--      safety on top of speed_assets.enabled = FALSE)
--   5. Patch speed_execute_trade payout cap branch to handle GOLD-5m
--   6. Patch speed_roll_markets to gate GOLD rolling behind the flag (mirrors
--      the 1m flag-gating from mig 0046)
--
-- What this migration does NOT do:
--   - No oracle worker code (separate ticket)
--   - No frontend changes
--   - Doesn't activate gold trading (speed_assets.enabled stays FALSE)
--
-- Idempotent.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Refine GOLD speed_asset_config (placeholder from mig 0042)
-- ────────────────────────────────────────────────────────────────────────────

UPDATE speed_asset_config SET
  oracle_source     = 'TBD_PENDING_FOUNDER_DECISION',
  wick_threshold_pct = 0.0005,    -- gold moves smaller than BTC
  tick_precision    = 3,
  display_decimals  = 2,
  notes             = 'Sprint 4 Phase 1 (mig 0048). Oracle source pending founder decision (OANDA WS / CoinAPI XAU / other). trading_hours_json placeholder; Sprint 4 Phase 2 wires CME-aligned schedule. enabled stays FALSE until oracle worker is live and Phase 2 helpers refactor.'
WHERE asset = 'GOLD';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) GOLD-5m row in speed_market_config
-- ────────────────────────────────────────────────────────────────────────────
-- Conservative launch values:
--   - Spread 4% (gold's institutional spreads tighter than BTC's; matches
--     observed XAU/USD bid-ask of ~3-5 bps in normal conditions, padded for
--     our hedging cost)
--   - Soft-block 0.92 (between BTC's 0.95 and 1m's aggressive 0.85)
--   - Stake max $25, payout max $250 (small launch; raise after data)
--   - Per-side pool 5% (very small fraction; gold liquidity less proven)
--   - Wick threshold inherited from asset_config

INSERT INTO speed_market_config (
  asset, duration,
  stake_min_usd, stake_max_usd, payout_max_usd, cap_per_side_usd,
  per_side_pool_pct, per_user_open_exposure_pct, velocity_max_per_min, daily_handle_alert_usd,
  spread_pct, soft_block_threshold, soft_block_unlock,
  late_window_60s_secs, late_window_30s_secs, late_window_60s_mult, late_window_30s_mult,
  last_n_reject_secs, near_decided_dist,
  cashout_winning_base, cashout_losing_base,
  cashout_saturation_coef, cashout_desperation_coef,
  cashout_late_winning_coef, cashout_late_losing_coef,
  cashout_reject_secs, cashout_late_30s_imbalance, cashout_cap_edge_threshold,
  matrix_min_n_eff, matrix_ci_max_width, matrix_prior_n, matrix_calibration_window_days,
  enabled, notes
)
VALUES (
  'GOLD', '5m'::speed_duration,
  -- Stake bounds (small to start)
  1, 25, 250, 50,
  -- Risk caps (very small fraction; gold liquidity unproven)
  0.05, 0.05, 30, 5000,
  -- Pricing
  0.04, 0.92, 0.91,
  -- Late-window (same shape as BTC-5m)
  60, 30, 1.20, 1.40,
  10, 0.30,
  -- Cashout (same coefficients as BTC for now; tune after data)
  0.025, 0.08,
  0.20, 0.40,
  0.015, 0.05,
  10, 0.30, 0.985,
  -- Matrix calibration — gold needs longer window (slower regime changes)
  100, 0.12, 50, 30,
  -- Operational
  TRUE,
  'Sprint 4 Phase 1 (mig 0048). 4% spread, 0.92 soft-block, $25 stake max, $250 payout cap. 30-day matrix window (vs BTC 14d) — gold regimes change slower. Activation blocked on oracle worker + Phase 2 + flag flip.'
)
ON CONFLICT (asset, duration) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) fee_config keys: per-asset payout cap + gold flag
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_entry_max_payout_usd_gold_5m', 250,
   '0048 Sprint 4: per-ticket payout cap for GOLD 5m markets. Parallel to BTC''s _5m / _1h / _1m keys. Matches speed_market_config.payout_max_usd for GOLD/5m row.'),
  ('speed_gold_markets_enabled', 0,
   '0048 Sprint 4: master flag for gold market rolling. Default 0 (only BTC rolls) until oracle worker is live + Phase 2 helpers refactored. Redundant safety on top of speed_assets.enabled=FALSE.')
ON CONFLICT (fee_type) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE 'Mig 0048 Sprint 4 Phase 1: GOLD asset_config refined, GOLD-5m market_config seeded, gold flag added (default OFF). User-facing gold launch blocked on: oracle source decision, oracle worker, Sprint 1 Phase 2, frontend.';
END $$;
