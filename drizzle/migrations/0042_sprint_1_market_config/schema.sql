-- ============================================================================
-- Migration 0042 — Sprint 1 Phase 1 — Foundation: speed_market_config tables
-- ============================================================================
--
-- Phase 1 of the foundation refactor. Creates the per-(asset, duration) and
-- per-asset config tables. Backfills BTC/5m row from current fee_config.
-- Inserts placeholder GOLD asset row (disabled) so Sprint 4 (gold) can flip
-- a flag instead of rebuilding schema.
--
-- IMPORTANT: helpers and RPCs are NOT yet refactored to read from these
-- tables. That's Phase 2 (mig 0043). Today this migration just stages the
-- schema; behavior is unchanged. Backfilled values are the source of truth
-- for Phase 2 to read from.
--
-- Why staged: a 1-shot refactor of every helper + every RPC simultaneously
-- with the new schema would be a high-blast-radius diff. Phase 1 lands the
-- tables; Phase 2 swaps reads one helper at a time with property tests
-- confirming zero behavior change at each step.
--
-- Related risk mitigations baked in:
--   F1.1 (two-source-of-truth): admin UI is NOT yet pointed at these tables.
--        Phase 3 of Sprint 1 cuts over the UI + drops fee_config keys.
--   F1.2 (silent-zero on missing row): NOT NULL on every column ensures
--        helpers can never see a NULL when the row exists. Phase 2 helpers
--        keep hardcoded fallbacks if the row is missing entirely.
--   F1.3 (mid-trade race): Phase 2 helpers will SELECT all columns at RPC
--        entry into local PL/pgSQL variables.
--   F1.4 (bucket array ordering): N/A here (no array columns yet — bucket
--        boundaries stay in fee_config until matrix calibration is per-asset).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING for seeds.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) speed_asset_config — per-asset oracle/wick/trading-hours config
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.speed_asset_config (
  asset                   text PRIMARY KEY REFERENCES public.speed_assets(id),
  oracle_source           text NOT NULL DEFAULT 'binance_bookticker',
  trading_hours_json      jsonb,
  wick_threshold_pct      numeric NOT NULL DEFAULT 0.0015 CHECK (wick_threshold_pct >= 0 AND wick_threshold_pct <= 0.1),
  tick_precision          int NOT NULL DEFAULT 8 CHECK (tick_precision BETWEEN 0 AND 18),
  display_decimals        int NOT NULL DEFAULT 2 CHECK (display_decimals BETWEEN 0 AND 8),
  enabled                 boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.speed_asset_config IS
  '0042 Sprint 1 Phase 1: per-asset config (oracle source, wick threshold, trading hours, tick precision). Phase 2 helpers will read from here. Phase 3 admin UI will write here.';

-- Trigger to keep updated_at fresh
CREATE OR REPLACE FUNCTION public._speed_market_config_touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS speed_asset_config_touch ON public.speed_asset_config;
CREATE TRIGGER speed_asset_config_touch
  BEFORE UPDATE ON public.speed_asset_config
  FOR EACH ROW EXECUTE FUNCTION public._speed_market_config_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 2) speed_market_config — per-(asset, duration) full config
-- ────────────────────────────────────────────────────────────────────────────
-- Every knob that varies per market type. Phase 2 helpers read these
-- values; Phase 3 admin UI writes to them; fee_config keys are eventually
-- dropped in Phase 4.
--
-- CHECK constraints (CC.1 mitigation): every numeric range bounded so a
-- bad admin save (typo, out-of-range value) is rejected at the DB layer
-- BEFORE pricing math sees it.

CREATE TABLE IF NOT EXISTS public.speed_market_config (
  asset                   text NOT NULL REFERENCES public.speed_assets(id),
  duration                speed_duration NOT NULL,

  -- Stake bounds
  stake_min_usd           numeric NOT NULL DEFAULT 1 CHECK (stake_min_usd > 0 AND stake_min_usd <= 100),
  stake_max_usd           numeric NOT NULL CHECK (stake_max_usd > 0 AND stake_max_usd <= 1000000),
  payout_max_usd          numeric NOT NULL CHECK (payout_max_usd > 0 AND payout_max_usd <= 10000000),
  cap_per_side_usd        numeric NOT NULL CHECK (cap_per_side_usd > 0 AND cap_per_side_usd <= 100000),

  -- Risk caps
  per_side_pool_pct                 numeric NOT NULL CHECK (per_side_pool_pct > 0 AND per_side_pool_pct <= 1),
  per_user_open_exposure_pct        numeric NOT NULL CHECK (per_user_open_exposure_pct > 0 AND per_user_open_exposure_pct <= 1),
  velocity_max_per_min              int NOT NULL CHECK (velocity_max_per_min > 0 AND velocity_max_per_min <= 10000),
  daily_handle_alert_usd            numeric NOT NULL CHECK (daily_handle_alert_usd >= 0),

  -- Pricing
  spread_pct              numeric NOT NULL CHECK (spread_pct >= 0 AND spread_pct <= 0.5),
  soft_block_threshold    numeric NOT NULL CHECK (soft_block_threshold > 0.5 AND soft_block_threshold < 1),
  soft_block_unlock       numeric NOT NULL CHECK (soft_block_unlock > 0.5 AND soft_block_unlock < 1),
  CONSTRAINT speed_market_config_unlock_below_block
    CHECK (soft_block_unlock < soft_block_threshold),

  -- Late-window thresholds (in seconds) + escalation multipliers
  late_window_60s_secs    int NOT NULL DEFAULT 60 CHECK (late_window_60s_secs > 0 AND late_window_60s_secs < 3600),
  late_window_30s_secs    int NOT NULL DEFAULT 30 CHECK (late_window_30s_secs > 0 AND late_window_30s_secs < 3600),
  late_window_60s_mult    numeric NOT NULL DEFAULT 1.20 CHECK (late_window_60s_mult >= 1 AND late_window_60s_mult <= 5),
  late_window_30s_mult    numeric NOT NULL DEFAULT 1.40 CHECK (late_window_30s_mult >= 1 AND late_window_30s_mult <= 5),
  last_n_reject_secs      int NOT NULL DEFAULT 10 CHECK (last_n_reject_secs >= 0 AND last_n_reject_secs < 600),
  near_decided_dist       numeric NOT NULL DEFAULT 0.30 CHECK (near_decided_dist >= 0 AND near_decided_dist <= 0.5),
  CONSTRAINT speed_market_config_60s_above_30s
    CHECK (late_window_60s_secs > late_window_30s_secs),

  -- Cashout (margin formula coefficients)
  cashout_winning_base                numeric NOT NULL CHECK (cashout_winning_base >= 0 AND cashout_winning_base < 1),
  cashout_losing_base                 numeric NOT NULL CHECK (cashout_losing_base >= 0 AND cashout_losing_base < 1),
  cashout_saturation_coef             numeric NOT NULL DEFAULT 0.20 CHECK (cashout_saturation_coef >= 0 AND cashout_saturation_coef <= 5),
  cashout_desperation_coef            numeric NOT NULL DEFAULT 0.40 CHECK (cashout_desperation_coef >= 0 AND cashout_desperation_coef <= 5),
  cashout_late_winning_coef           numeric NOT NULL DEFAULT 0.015 CHECK (cashout_late_winning_coef >= 0 AND cashout_late_winning_coef <= 1),
  cashout_late_losing_coef            numeric NOT NULL DEFAULT 0.05 CHECK (cashout_late_losing_coef >= 0 AND cashout_late_losing_coef <= 1),
  cashout_reject_secs                 int NOT NULL DEFAULT 10 CHECK (cashout_reject_secs >= 0 AND cashout_reject_secs < 600),
  cashout_late_30s_imbalance          numeric NOT NULL DEFAULT 0.30 CHECK (cashout_late_30s_imbalance >= 0 AND cashout_late_30s_imbalance <= 0.5),
  cashout_cap_edge_threshold          numeric NOT NULL DEFAULT 0.985 CHECK (cashout_cap_edge_threshold > 0.9 AND cashout_cap_edge_threshold < 1),

  -- Matrix calibration parameters (per-(asset, duration) since matrix is keyed by them)
  matrix_min_n_eff        int NOT NULL DEFAULT 100 CHECK (matrix_min_n_eff > 0 AND matrix_min_n_eff <= 100000),
  matrix_ci_max_width     numeric NOT NULL DEFAULT 0.12 CHECK (matrix_ci_max_width > 0 AND matrix_ci_max_width <= 1),
  matrix_prior_n          int NOT NULL DEFAULT 50 CHECK (matrix_prior_n >= 0 AND matrix_prior_n <= 10000),
  matrix_calibration_window_days  int NOT NULL DEFAULT 14 CHECK (matrix_calibration_window_days > 0 AND matrix_calibration_window_days <= 90),

  -- Operational
  enabled                 boolean NOT NULL DEFAULT true,
  notes                   text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (asset, duration)
);

COMMENT ON TABLE public.speed_market_config IS
  '0042 Sprint 1 Phase 1: per-(asset, duration) config table. Single source of truth for all knobs that vary per market type. Phase 2 helpers read from here; Phase 3 admin UI writes here; Phase 4 drops the now-dead fee_config keys. CHECK constraints reject typo/out-of-range values at the DB layer.';

DROP TRIGGER IF EXISTS speed_market_config_touch ON public.speed_market_config;
CREATE TRIGGER speed_market_config_touch
  BEFORE UPDATE ON public.speed_market_config
  FOR EACH ROW EXECUTE FUNCTION public._speed_market_config_touch_updated_at();

CREATE INDEX IF NOT EXISTS speed_market_config_enabled_idx
  ON public.speed_market_config (asset, duration) WHERE enabled = TRUE;

-- ────────────────────────────────────────────────────────────────────────────
-- 3) Backfill BTC asset config from current fee_config + global defaults
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.speed_asset_config (
  asset, oracle_source, trading_hours_json, wick_threshold_pct, tick_precision, display_decimals, enabled, notes
)
SELECT
  'BTC',
  'binance_bookticker',
  NULL, -- 24/7
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_wick_threshold_pct' LIMIT 1), 0.0015),
  8,
  2,
  TRUE,
  'Phase 1 backfill from fee_config. Oracle = Binance @bookticker mid (services/speed-oracle).'
WHERE NOT EXISTS (SELECT 1 FROM speed_asset_config WHERE asset = 'BTC');

-- ────────────────────────────────────────────────────────────────────────────
-- 4) Placeholder GOLD asset config (disabled). Sprint 4 flips enabled=TRUE
-- ────────────────────────────────────────────────────────────────────────────

-- Add GOLD to speed_assets first if not present
INSERT INTO public.speed_assets (id, display_name, enabled)
VALUES ('GOLD', 'Gold (XAU/USD)', FALSE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.speed_asset_config (
  asset, oracle_source, trading_hours_json, wick_threshold_pct, tick_precision, display_decimals, enabled, notes
)
SELECT
  'GOLD',
  'PLACEHOLDER',  -- Sprint 4 sets actual feed
  jsonb_build_object(
    'sessions',
    jsonb_build_array(
      jsonb_build_object('open_utc', 'Sun 22:00', 'close_utc', 'Fri 21:00', 'daily_break_utc', '21:00-22:00')
    ),
    'note', 'CME-aligned XAU/USD; Sprint 4 finalizes the schedule'
  ),
  0.0005,  -- gold moves smaller; tighter wick
  3,
  2,
  FALSE,   -- disabled until Sprint 4 wires the oracle
  'Phase 1 placeholder. Sprint 4 wires actual oracle (OANDA/CoinAPI/etc.), confirms trading hours, and flips enabled=TRUE.'
WHERE NOT EXISTS (SELECT 1 FROM speed_asset_config WHERE asset = 'GOLD');

-- ────────────────────────────────────────────────────────────────────────────
-- 5) Backfill BTC/5m market config from current fee_config
-- ────────────────────────────────────────────────────────────────────────────
-- Reads each fee_config key with a sensible default if missing. NOT NULL
-- guarantees no row has a NULL column. Phase 2 helpers can safely SELECT
-- without COALESCE wrappers (modulo the row-missing case, which keeps
-- hardcoded fallbacks per F1.2).

INSERT INTO public.speed_market_config (
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
SELECT
  'BTC',
  '5m'::speed_duration,
  -- Stake bounds
  1,
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_stake_max_5m_usd' LIMIT 1), 25),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_5m' LIMIT 1), 2500),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cap_per_side_usd' LIMIT 1), 200),
  -- Risk
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1), 0.25),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_per_user_open_exposure_pct' LIMIT 1), 0.15),
  COALESCE((SELECT rate::int FROM fee_config WHERE fee_type = 'speed_per_user_velocity_max' LIMIT 1), 30),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_per_user_daily_handle_alert' LIMIT 1), 5000),
  -- Pricing
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1), 0.05),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_entry_soft_block_threshold' LIMIT 1), 0.95),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_entry_soft_block_unlock_threshold' LIMIT 1), 0.94),
  -- Late-window
  60, 30,
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult' LIMIT 1), 1.20),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult' LIMIT 1), 1.40),
  COALESCE((SELECT rate::int FROM fee_config WHERE fee_type = 'speed_late_window_reject_s' LIMIT 1), 10),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject' LIMIT 1), 0.30),
  -- Cashout
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_winning_base_5m' LIMIT 1), 0.025),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_losing_base_5m' LIMIT 1), 0.08),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_saturation_coef' LIMIT 1), 0.20),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_desperation_coef' LIMIT 1), 0.40),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_window_winning_coef' LIMIT 1), 0.015),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_window_losing_coef' LIMIT 1), 0.05),
  COALESCE((SELECT rate::int FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s' LIMIT 1), 10),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject' LIMIT 1), 0.30),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_cashout_cap_edge_threshold' LIMIT 1), 0.985),
  -- Matrix
  COALESCE((SELECT rate::int FROM fee_config WHERE fee_type = 'speed_pricing_matrix_min_n_eff' LIMIT 1), 100),
  COALESCE((SELECT rate FROM fee_config WHERE fee_type = 'speed_pricing_matrix_ci_max_width' LIMIT 1), 0.12),
  COALESCE((SELECT rate::int FROM fee_config WHERE fee_type = 'speed_pricing_matrix_prior_n' LIMIT 1), 50),
  14,
  -- Operational
  TRUE,
  'Phase 1 backfill from fee_config (mig 0042). Phase 2 helpers will read this row instead of fee_config.'
WHERE NOT EXISTS (
  SELECT 1 FROM speed_market_config WHERE asset = 'BTC' AND duration = '5m'::speed_duration
);

-- ────────────────────────────────────────────────────────────────────────────
-- 6) Sanity log
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_asset_count INT;
  v_market_count INT;
BEGIN
  SELECT COUNT(*) INTO v_asset_count FROM speed_asset_config;
  SELECT COUNT(*) INTO v_market_count FROM speed_market_config;
  RAISE NOTICE 'Mig 0042 Phase 1: % asset_config row(s) seeded, % market_config row(s) seeded. Phase 2 will refactor helpers to read from these tables.', v_asset_count, v_market_count;
END $$;
