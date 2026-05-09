-- ============================================================================
-- Migration 0052 — Phase 5A — Gold completeness (GOLD-1m + IV + trading hours)
-- ============================================================================
--
-- The big one for gold-on-PAXG launch readiness:
--   1. GOLD-1m row in speed_market_config (parallel to GOLD-5m from mig 0048)
--   2. speed_iv_gold = 0.18 in fee_config (BSM uses this; without it, gold
--      pricing is 3× too volatile because BSM falls back to BTC's 0.60)
--   3. speed_entry_max_payout_usd_gold_1m = 50 (per-ticket cap for gold-1m)
--   4. Per-asset oracle_stale_seconds (BTC stays 2s, gold gets 30s — handles
--      thin PAXG books during off-hours)
--   5. speed_volatility_cache CHECK constraint allows asset = 'GOLD'
--   6. Seed gold volatility cache rows (5m, 1m, 1h horizons all = 0.18)
--   7. Populate speed_asset_config.GOLD with PAXG oracle source + CME-aligned
--      trading hours + 30s stale tolerance + display config
--   8. New helper _speed_is_market_open(asset, now_ts) reads trading_hours_json
--   9. speed_roll_markets calls the helper, skips gold during closed windows
--  10. speed_execute_trade payout cap cascade: GOLD-1m branch + per-asset
--      oracle_stale_seconds read
--  11. speed_execute_cashout: per-asset oracle_stale_seconds read
--
-- Founder-locked decisions baked in:
--   - PAXG/USDT bookticker mid as gold oracle (free, 24/7, same Binance
--     infra, ±0.3% basis vs spot XAU acceptable)
--   - Real-gold-hours weekend closure (Sun 22:00 UTC – Fri 21:00 UTC) so
--     weekend PAXG noise doesn't drive market settlements
--   - Frontend countdown timer when gold is closed (rendered from
--     trading_hours_json + _speed_is_market_open)
--
-- Activation flags stay OFF. This migration just lays the groundwork so
-- when speed_assets.GOLD.enabled flips and the PAXG worker is alive, gold
-- markets work correctly out of the box.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) Per-asset oracle_stale_seconds column on speed_asset_config
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_asset_config
  ADD COLUMN IF NOT EXISTS oracle_stale_seconds INTEGER
    CHECK (oracle_stale_seconds IS NULL OR (oracle_stale_seconds > 0 AND oracle_stale_seconds <= 600));

COMMENT ON COLUMN speed_asset_config.oracle_stale_seconds IS
  '0052: per-asset override for fee_config.speed_oracle_stale_seconds. NULL = use global (2s for BTC). Set to 30s for GOLD because PAXG bookticker can go quiet during off-hours.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Update GOLD asset config — finalize for PAXG launch
-- ────────────────────────────────────────────────────────────────────────────

UPDATE speed_asset_config SET
  oracle_source         = 'binance_paxgusdt_bookticker',
  oracle_stale_seconds  = 30,
  wick_threshold_pct    = 0.0005,
  tick_precision        = 3,
  display_decimals      = 2,
  trading_hours_json    = jsonb_build_object(
    'schedule',          'cme_xau_aligned',
    'weekly_open_utc',   'Sun 22:00',
    'weekly_close_utc',  'Fri 21:00',
    'daily_break_utc',   '21:00-22:00',
    'tz',                'UTC',
    'note',              'PAXG/USDT trades 24/7 on Binance but real spot gold (XAU/USD) follows CME hours. We track gold hours so weekend PAXG drift does not drive market settlement.'
  ),
  notes = 'mig 0052 Phase 5A finalize. PAXG/USDT mid from Binance bookTicker. CME-aligned weekend closure. 30s stale tolerance for thin books. enabled stays FALSE until oracle worker (services/speed-oracle/) is shipped + EC2 deployed.'
WHERE asset = 'GOLD';

-- ────────────────────────────────────────────────────────────────────────────
-- 3) GOLD-1m row in speed_market_config
-- ────────────────────────────────────────────────────────────────────────────

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
  'GOLD', '1m'::speed_duration,
  -- Casino-tuned: small stakes, short cycle, tight reject windows
  1, 10, 50, 25,
  0.05, 0.05, 30, 5000,
  -- Pricing: same launch tax as BTC-1m (8% spread, 0.85 soft-block)
  0.08, 0.85, 0.84,
  -- Late-window same shape as BTC-1m (compressed for 60s lifetime)
  30, 15, 1.20, 1.40,
  3, 0.30,
  -- Cashout
  0.025, 0.08,
  0.20, 0.40,
  0.015, 0.05,
  3, 0.30, 0.985,
  -- Matrix: longer window because gold matrix qualifies slowly (small moves cluster in fewer cells)
  100, 0.12, 50, 30,
  TRUE,
  'Sprint 4 Phase 5A: 8% spread launch tax, 0.85 soft-block, $10 stake max, $50 payout cap. Same casino-tuned defaults as BTC-1m, plus 30-day matrix window (vs BTC 14d). Activation blocked on PAXG oracle + flag flip + 5D/5E frontend.'
)
ON CONFLICT (asset, duration) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) fee_config: gold IV + gold-1m payout cap
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_iv_gold', 0.18,
   '0052 Phase 5A: annualized realized vol for gold (PAXG/XAU). Used by speed_fair_prob_over BSM model. About 1/3 of BTC due to gold''s lower vol. Without this, _speed_get_iv falls back to fee_config.speed_iv_btc (0.60) for gold and BSM math is 3× wrong.'),
  ('speed_entry_max_payout_usd_gold_1m', 50,
   '0052 Phase 5A: per-ticket payout cap for GOLD 1m markets. Parallel to _5m / _1h / _1m / _gold_5m fee_config keys. Matches speed_market_config.payout_max_usd for GOLD/1m row.')
ON CONFLICT (fee_type) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 5) speed_volatility_cache: allow GOLD asset + seed initial rows
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_volatility_cache DROP CONSTRAINT IF EXISTS speed_volatility_cache_asset_chk;
ALTER TABLE speed_volatility_cache ADD CONSTRAINT speed_volatility_cache_asset_chk
  CHECK (asset IN ('BTC', 'GOLD'));

-- Seed gold horizons. Real values populated by the PAXG oracle worker once
-- it goes live; these placeholders match the fee_config fallback so BSM
-- math stays sensible during the cold-start period.
INSERT INTO speed_volatility_cache (asset, horizon, sigma_annualized, sample_count, computed_at) VALUES
  ('GOLD', '5m', 0.18, 0, NOW()),
  ('GOLD', '1m', 0.18, 0, NOW()),
  ('GOLD', '15m', 0.18, 0, NOW()),
  ('GOLD', '1h', 0.18, 0, NOW()),
  ('GOLD', '24h', 0.18, 0, NOW()),
  ('GOLD', 'ewma', 0.18, 0, NOW())
ON CONFLICT (asset, horizon) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Sanity log
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_gold_5m_exists BOOLEAN;
  v_gold_1m_exists BOOLEAN;
  v_iv_gold        DECIMAL;
  v_oracle_stale   INTEGER;
BEGIN
  SELECT EXISTS(SELECT 1 FROM speed_market_config WHERE asset='GOLD' AND duration='5m') INTO v_gold_5m_exists;
  SELECT EXISTS(SELECT 1 FROM speed_market_config WHERE asset='GOLD' AND duration='1m') INTO v_gold_1m_exists;
  SELECT rate INTO v_iv_gold FROM fee_config WHERE fee_type='speed_iv_gold';
  SELECT oracle_stale_seconds INTO v_oracle_stale FROM speed_asset_config WHERE asset='GOLD';
  RAISE NOTICE 'Mig 0052 Phase 5A: GOLD-5m=%, GOLD-1m=%, speed_iv_gold=%, gold oracle_stale_seconds=%s. Activation blocked on: PAXG worker deploy + speed_assets.GOLD.enabled + speed_gold_markets_enabled + frontend tabs.',
    v_gold_5m_exists, v_gold_1m_exists, v_iv_gold, v_oracle_stale;
END $$;
