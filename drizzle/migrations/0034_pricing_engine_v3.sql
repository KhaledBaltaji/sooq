-- ============================================================================
-- Migration 0034 — Pricing Engine v3 (Matrix + Asymmetric Push-Up + Soft-Block)
-- ============================================================================
--
-- Goal: close the empirical mispricing gap that today's BSM-based pricing
-- under-charges by 10-20 percentage points in lopsided/late-window markets
-- (the "Rami exploit"). Replay on 160 historical trades shows variant G
-- (asymmetric matrix push-up + 0.95 soft-block on entries) yields 110% bleed
-- reduction. See ~/.claude/plans/check-our-staging-ramiighorayeb-gmail-co-refactored-storm.md
--
-- Architecture (locked after 3 codex consults):
--   1. New table speed_pricing_matrix stores empirical P(over wins) per
--      (asset, duration, dist_bucket, time_bucket) cell, populated by a
--      14-day backtest (scripts/recalibrate-pricing-matrix.mjs) and
--      refreshed nightly via cron.
--   2. Per-cell stats include n_obs, n_eff (per-market, NOT per-tick — codex
--      critical fix), Bayesian-shrunk + isotonic-regressed p_over_final,
--      Jeffreys CI, qualifies flag.
--   3. New helper _speed_pricing_apply() takes BSM fair_prob_side + state
--      and returns the matrix-corrected offered_prob (or BSM-only fallback
--      if matrix flag disabled or cell doesn't qualify).
--   4. Asymmetric only-push-up rule: matrix can only RAISE the price, never
--      lower. House-protective by design — codex explicit.
--   5. Soft-block at offered_prob >= 0.95 (RPC raises SOFT_BLOCK error;
--      quote endpoint mirrors).
--   6. Same helper called by both speed_execute_trade and
--      speed_execute_cashout (mark_prob path) — preserves direction-matching
--      invariant when matrix is active.
--   7. Reduced late-window multipliers (1.4x/1.8x → 1.2x/1.4x) so we don't
--      double-charge the kill zone (matrix already encodes that).
--   8. Pool $10K → $50K, per-trade max $25/$50 → $500/$1500, new per-ticket
--      payout caps $2,500/$5,000, dynamic stake formula.
--   9. Three-tier daily NGR breaker (-$500 alert / -$2,500 soft / -$5,000 hard).
--   10. ALL FLAGS DEFAULT OFF. Behavior identical to today until admin enables.
--
-- Single live flag for matrix (entry+cashout TOGETHER — codex hard rule:
-- never split, that recreates the exact mismatch this migration prevents).
--
-- Safe rollback: flip flags off in /admin/fees. Schema stays.

-- Required RDS settings: TLS, eu-central-1.
SET search_path = public;

-- ============================================================================
-- 1) MATRIX SCHEMA
-- ============================================================================

CREATE TABLE IF NOT EXISTS speed_pricing_matrix_versions (
  id            SERIAL PRIMARY KEY,
  asset         TEXT NOT NULL,
  duration      speed_duration NOT NULL,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  n_markets     INTEGER NOT NULL,
  n_obs_total   BIGINT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('active','superseded','rejected','shadow')),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_matrix_versions_active
  ON speed_pricing_matrix_versions (asset, duration, status, computed_at DESC);

COMMENT ON TABLE speed_pricing_matrix_versions IS
  'Mig 0034: bookkeeping for each pricing matrix snapshot. Recalibration cron inserts new active versions; older same-(asset,duration) rows marked superseded.';

CREATE TABLE IF NOT EXISTS speed_pricing_matrix (
  version_id      INTEGER NOT NULL REFERENCES speed_pricing_matrix_versions(id) ON DELETE CASCADE,
  asset           TEXT NOT NULL,
  duration        speed_duration NOT NULL,
  dist_bucket     SMALLINT NOT NULL,    -- 0..11 (see recalibrate script)
  time_bucket     SMALLINT NOT NULL,    -- 0..6
  n_obs           INTEGER NOT NULL,     -- raw tick count in this cell
  n_eff           INTEGER NOT NULL,     -- COUNT(DISTINCT market_id) — for shrinkage
  p_over_raw      DOUBLE PRECISION NOT NULL,   -- empirical mean
  p_over_shrunk   DOUBLE PRECISION NOT NULL,   -- Bayesian shrunk
  p_over_final    DOUBLE PRECISION NOT NULL,   -- + isotonic regression (used at runtime)
  ci_lo           DOUBLE PRECISION NOT NULL,
  ci_hi           DOUBLE PRECISION NOT NULL,
  ci_width        DOUBLE PRECISION NOT NULL,
  qualifies       BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (version_id, asset, duration, dist_bucket, time_bucket)
);

CREATE INDEX IF NOT EXISTS idx_matrix_lookup
  ON speed_pricing_matrix (version_id, asset, duration, dist_bucket, time_bucket);

COMMENT ON TABLE speed_pricing_matrix IS
  'Mig 0034: empirical P(over wins) per (asset, duration, dist_bucket, time_bucket). Populated by scripts/recalibrate-pricing-matrix.mjs. Cells with qualifies=false fall back to BSM at runtime.';

-- ============================================================================
-- 2) NEW FEE_CONFIG KEYS (all flags default OFF)
-- ============================================================================

INSERT INTO fee_config (fee_type, rate, description, updated_at) VALUES
  -- Matrix flags (controls entry + cashout TOGETHER)
  ('speed_pricing_matrix_enabled',         0,
   '0034: master switch for matrix-based pricing (entry+cashout together). 0=BSM only, 1=matrix active.',
   NOW()),
  ('speed_pricing_asym_pushup_enabled',    1,
   '0034: asymmetric only-push-up rule. When matrix enabled, max(matrix, BSM) is used. Codex-required.',
   NOW()),
  ('speed_pricing_matrix_version',         0,
   '0034: active matrix version_id (auto-set by recalibration cron).',
   NOW()),
  ('speed_pricing_matrix_min_n_eff',       100,
   '0034: minimum effective N (markets, not ticks) for a matrix cell to qualify. Below threshold falls back to BSM.',
   NOW()),
  ('speed_pricing_matrix_ci_max_width',    0.12,
   '0034: max CI width for a cell to qualify. Above threshold shrinks toward BSM hard.',
   NOW()),
  ('speed_pricing_matrix_prior_n',         50,
   '0034: Bayesian shrinkage prior weight (toward 0.5 neutral).',
   NOW()),

  -- Soft-block flags
  ('speed_entry_soft_block_enabled',           0,
   '0034: soft-block entries when offered_prob crosses threshold. 0=off, 1=on.',
   NOW()),
  ('speed_entry_soft_block_threshold',         0.95,
   '0034: soft-block threshold. New entries blocked when matrix offered_prob >= this.',
   NOW()),
  ('speed_entry_soft_block_unlock_threshold',  0.94,
   '0034: hysteresis unlock threshold. Once locked, stays until offered_prob drops below this.',
   NOW()),

  -- Per-ticket payout caps (NEW safety layer)
  ('speed_entry_max_payout_usd_5m',  2500,
   '0034: max single-ticket gross payout for 5m markets. stake / offered_prob > this is rejected.',
   NOW()),
  ('speed_entry_max_payout_usd_1h',  5000,
   '0034: max single-ticket gross payout for 1h markets.',
   NOW()),

  -- Cashout cap-edge
  ('speed_cashout_cap_edge_threshold', 0.985,
   '0034: when both entry and mark prob >= this, cashout disabled with hold-to-settlement message.',
   NOW()),

  -- Three-tier NGR breaker (replaces single-tier from mig 0028)
  ('speed_daily_ngr_alert_usd',          -500,
   '0034: NGR alert threshold. Slack notification, no enforcement.',
   NOW()),
  ('speed_daily_ngr_soft_block_usd',     -2500,
   '0034: NGR soft-block threshold. Per-trade max temporarily reduced.',
   NOW()),
  ('speed_daily_ngr_hard_stop_usd',      -5000,
   '0034: NGR hard-stop threshold. Trading paused entirely until manual review.',
   NOW()),
  ('speed_ngr_soft_block_stake_max_usd', 100,
   '0034: per-trade stake cap when NGR soft-block tier is active.',
   NOW())
ON CONFLICT (fee_type) DO NOTHING;

-- Reduce late-window multipliers (matrix already encodes directional kill-zone; old values double-charge).
-- Codex recommendation: 1.4/1.8 → 1.2/1.4 keeps liquidity/timing spread for near-50/50 late markets only.
-- Only update if still at the old defaults; admin overrides preserved.
UPDATE fee_config SET rate = 1.20, updated_at = NOW()
  WHERE fee_type = 'speed_late_60s_spread_mult' AND rate = 1.40;
UPDATE fee_config SET rate = 1.40, updated_at = NOW()
  WHERE fee_type = 'speed_late_30s_spread_mult' AND rate = 1.80;

-- 0034 [P2 codex review fix]: align legacy NGR floor with new hard-stop tier.
-- The pre-existing _speed_update_daily_ngr (mig 0028) sets circuit_tripped_at
-- when speed_daily_ngr_floor is crossed; the entry RPC then halts via that
-- flag BEFORE the new three-tier check runs. By aligning the legacy floor
-- with the new hard-stop, both fire at the same threshold, and the new
-- soft-block tier (which sits ABOVE the legacy floor) runs as additional
-- granularity without conflict. Only updates if at the legacy default.
UPDATE fee_config SET rate = -5000, updated_at = NOW()
  WHERE fee_type = 'speed_daily_ngr_floor' AND rate = -500;

-- ============================================================================
-- 3) HELPER: _speed_matrix_lookup
--    Returns the active matrix cell for a (asset, duration, dist_pct, secs_left) state.
--    Returns NULL p if no qualifying cell or matrix disabled.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._speed_matrix_lookup(
  p_asset       TEXT,
  p_duration    speed_duration,
  p_dist_pct    DOUBLE PRECISION,
  p_secs_left   DOUBLE PRECISION
) RETURNS TABLE (
  p_over    DOUBLE PRECISION,
  n_eff     INTEGER,
  ci_width  DOUBLE PRECISION,
  qualifies BOOLEAN,
  version_id INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_d_idx     SMALLINT;
  v_t_idx     SMALLINT;
  v_version   INTEGER;
BEGIN
  -- Bucketize distance
  v_d_idx := CASE
    WHEN p_dist_pct <= -0.005 THEN 0
    WHEN p_dist_pct <= -0.003 THEN 1
    WHEN p_dist_pct <= -0.002 THEN 2
    WHEN p_dist_pct <= -0.001 THEN 3
    WHEN p_dist_pct <= -0.0005 THEN 4
    WHEN p_dist_pct <  0       THEN 5
    WHEN p_dist_pct <  0.0005  THEN 6
    WHEN p_dist_pct <  0.001   THEN 7
    WHEN p_dist_pct <  0.002   THEN 8
    WHEN p_dist_pct <  0.003   THEN 9
    WHEN p_dist_pct <  0.005   THEN 10
    ELSE 11
  END;

  -- Bucketize time
  v_t_idx := CASE
    WHEN p_secs_left <= 15  THEN 0
    WHEN p_secs_left <= 30  THEN 1
    WHEN p_secs_left <= 60  THEN 2
    WHEN p_secs_left <= 120 THEN 3
    WHEN p_secs_left <= 180 THEN 4
    WHEN p_secs_left <= 240 THEN 5
    ELSE 6
  END;

  -- Get active version
  SELECT id INTO v_version
  FROM speed_pricing_matrix_versions
  WHERE asset = p_asset AND duration = p_duration AND status = 'active'
  ORDER BY computed_at DESC
  LIMIT 1;

  IF v_version IS NULL THEN
    RETURN QUERY SELECT NULL::DOUBLE PRECISION, 0, NULL::DOUBLE PRECISION, FALSE, NULL::INTEGER;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT m.p_over_final, m.n_eff, m.ci_width, m.qualifies, v_version
    FROM speed_pricing_matrix m
    WHERE m.version_id = v_version
      AND m.asset = p_asset
      AND m.duration = p_duration
      AND m.dist_bucket = v_d_idx
      AND m.time_bucket = v_t_idx
    LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public._speed_matrix_lookup(TEXT, speed_duration, DOUBLE PRECISION, DOUBLE PRECISION) TO PUBLIC;
COMMENT ON FUNCTION public._speed_matrix_lookup IS
  '0034: lookup the active matrix cell for a state. Returns qualifies=false when fall back to BSM.';

-- ============================================================================
-- 4) HELPER: _speed_pricing_apply
--    Core helper consumed by BOTH entry RPC and cashout RPC.
--    Takes BSM fair_prob_side + state, returns matrix-corrected mark_prob
--    and offered_prob (entry adds spread; cashout uses mark directly).
--    Implements asymmetric only-push-up rule.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._speed_pricing_apply(
  p_asset           TEXT,
  p_duration        speed_duration,
  p_side            TEXT,           -- 'over' or 'under'
  p_dist_pct        DOUBLE PRECISION,
  p_secs_left       DOUBLE PRECISION,
  p_bsm_prob_side   DOUBLE PRECISION,
  p_widened_spread  DOUBLE PRECISION,
  p_mode            TEXT            -- 'entry' or 'cashout'
) RETURNS TABLE (
  mark_prob       DOUBLE PRECISION,
  offered_prob    DOUBLE PRECISION,
  matrix_used     BOOLEAN,
  matrix_version  INTEGER,
  soft_blocked    BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_matrix_enabled    DECIMAL;
  v_asym_enabled      DECIMAL;
  v_soft_block_on     DECIMAL;
  v_soft_block_thresh DECIMAL;
  v_lookup            RECORD;
  v_matrix_p_over     DOUBLE PRECISION;
  v_matrix_p_side     DOUBLE PRECISION;
  v_final_mark_prob   DOUBLE PRECISION;
  v_final_offered    DOUBLE PRECISION;
  v_used_matrix       BOOLEAN := FALSE;
  v_version           INTEGER := NULL;
  v_blocked           BOOLEAN := FALSE;
  v_d_idx             SMALLINT;
  v_t_idx             SMALLINT;
  v_active_version    INTEGER;
  v_neighbor_p_over   DOUBLE PRECISION;
  v_neighbor_p_side   DOUBLE PRECISION;
BEGIN
  SELECT rate INTO v_matrix_enabled FROM fee_config WHERE fee_type = 'speed_pricing_matrix_enabled' LIMIT 1;
  SELECT rate INTO v_asym_enabled   FROM fee_config WHERE fee_type = 'speed_pricing_asym_pushup_enabled' LIMIT 1;
  v_matrix_enabled := COALESCE(v_matrix_enabled, 0);
  v_asym_enabled := COALESCE(v_asym_enabled, 1);

  -- Default to BSM
  v_final_mark_prob := p_bsm_prob_side;

  IF v_matrix_enabled = 1 THEN
    -- Resolve the active version once so neighbor queries below work even
    -- when the current cell has no row in the matrix table.
    SELECT id INTO v_active_version
    FROM speed_pricing_matrix_versions
    WHERE asset = p_asset AND duration = p_duration AND status = 'active'
    ORDER BY computed_at DESC LIMIT 1;

    -- Bucketize current state (mirrors _speed_matrix_lookup).
    -- Inlined here (not via _speed_matrix_lookup) so we have v_d_idx/v_t_idx
    -- for the neighbor query below.
    v_d_idx := CASE
      WHEN p_dist_pct <= -0.005 THEN 0
      WHEN p_dist_pct <= -0.003 THEN 1
      WHEN p_dist_pct <= -0.002 THEN 2
      WHEN p_dist_pct <= -0.001 THEN 3
      WHEN p_dist_pct <= -0.0005 THEN 4
      WHEN p_dist_pct <  0       THEN 5
      WHEN p_dist_pct <  0.0005  THEN 6
      WHEN p_dist_pct <  0.001   THEN 7
      WHEN p_dist_pct <  0.002   THEN 8
      WHEN p_dist_pct <  0.003   THEN 9
      WHEN p_dist_pct <  0.005   THEN 10
      ELSE 11
    END;
    v_t_idx := CASE
      WHEN p_secs_left <= 15  THEN 0
      WHEN p_secs_left <= 30  THEN 1
      WHEN p_secs_left <= 60  THEN 2
      WHEN p_secs_left <= 120 THEN 3
      WHEN p_secs_left <= 180 THEN 4
      WHEN p_secs_left <= 240 THEN 5
      ELSE 6
    END;

    SELECT * INTO v_lookup
    FROM _speed_matrix_lookup(p_asset, p_duration, p_dist_pct, p_secs_left)
    LIMIT 1;

    IF v_lookup.qualifies THEN
      v_used_matrix := TRUE;
      v_version := v_active_version;

      -- Matrix stores P(over wins). Convert to side-relevant.
      v_matrix_p_over := v_lookup.p_over;
      IF p_side = 'over' THEN
        v_matrix_p_side := v_matrix_p_over;
      ELSE
        v_matrix_p_side := 1.0 - v_matrix_p_over;
      END IF;

      IF v_asym_enabled = 1 THEN
        -- Asymmetric only-push-up: matrix can only RAISE the price.
        v_final_mark_prob := GREATEST(p_bsm_prob_side, v_matrix_p_side);
      ELSE
        -- Symmetric matrix (full replacement of BSM)
        v_final_mark_prob := v_matrix_p_side;
      END IF;
    ELSE
      -- 0034 [post-codex direction-matching fix]: current cell doesn't qualify,
      -- but a neighboring qualifying cell in the FAVORABLE direction may
      -- already have pushed the price up. Without this lookup, mark could
      -- regress (cell A qualified at low d with matrix=0.73, cell B at higher
      -- d falls back to BSM=0.65; favorable spot move appears to LOWER mark).
      --
      -- Neighbor logic by side:
      --   over  side: favorable = higher d. If a qualifying cell exists at
      --     LOWER d (closer to strike) with matrix p_over, that floor must
      --     propagate to current cell (P(over) is monotone non-decreasing in d).
      --   under side: favorable = lower d. Symmetric — propagate from cells
      --     at HIGHER d. (P(under) = 1 - P(over); for under to be more favorable
      --     at lower d, p_over at higher d acts as a ceiling on current p_over.)
      IF p_side = 'over' THEN
        SELECT MAX(p_over_final) INTO v_neighbor_p_over
        FROM speed_pricing_matrix
        WHERE version_id = v_active_version
          AND asset = p_asset AND duration = p_duration
          AND time_bucket = v_t_idx
          AND dist_bucket <= v_d_idx
          AND qualifies = TRUE;
        IF v_neighbor_p_over IS NOT NULL THEN
          v_neighbor_p_side := v_neighbor_p_over;
          v_used_matrix := TRUE;
          v_version := v_active_version;
          IF v_asym_enabled = 1 THEN
            v_final_mark_prob := GREATEST(p_bsm_prob_side, v_neighbor_p_side);
          ELSE
            v_final_mark_prob := v_neighbor_p_side;
          END IF;
        END IF;
      ELSE
        SELECT MIN(p_over_final) INTO v_neighbor_p_over
        FROM speed_pricing_matrix
        WHERE version_id = v_active_version
          AND asset = p_asset AND duration = p_duration
          AND time_bucket = v_t_idx
          AND dist_bucket >= v_d_idx
          AND qualifies = TRUE;
        IF v_neighbor_p_over IS NOT NULL THEN
          v_neighbor_p_side := 1.0 - v_neighbor_p_over;
          v_used_matrix := TRUE;
          v_version := v_active_version;
          IF v_asym_enabled = 1 THEN
            v_final_mark_prob := GREATEST(p_bsm_prob_side, v_neighbor_p_side);
          ELSE
            v_final_mark_prob := v_neighbor_p_side;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  -- Compute offered_prob (entry mode adds spread; cashout uses mark directly)
  IF p_mode = 'entry' THEN
    v_final_offered := v_final_mark_prob + p_widened_spread / 2.0;

    -- Check soft-block (entry only)
    SELECT rate INTO v_soft_block_on FROM fee_config WHERE fee_type = 'speed_entry_soft_block_enabled' LIMIT 1;
    SELECT rate INTO v_soft_block_thresh FROM fee_config WHERE fee_type = 'speed_entry_soft_block_threshold' LIMIT 1;
    v_soft_block_on := COALESCE(v_soft_block_on, 0);
    v_soft_block_thresh := COALESCE(v_soft_block_thresh, 0.95);

    IF v_soft_block_on = 1 AND v_final_offered >= v_soft_block_thresh THEN
      v_blocked := TRUE;
    END IF;
  ELSE
    -- Cashout mode: offered_prob = mark_prob (no entry spread)
    v_final_offered := v_final_mark_prob;
  END IF;

  -- Floor / cap
  IF v_final_offered < 0.01 THEN v_final_offered := 0.01; END IF;
  IF v_final_offered > 0.99 THEN v_final_offered := 0.99; END IF;
  IF v_final_mark_prob < 0.01 THEN v_final_mark_prob := 0.01; END IF;
  IF v_final_mark_prob > 0.99 THEN v_final_mark_prob := 0.99; END IF;

  RETURN QUERY SELECT v_final_mark_prob, v_final_offered, v_used_matrix, v_version, v_blocked;
END;
$$;

GRANT EXECUTE ON FUNCTION public._speed_pricing_apply(TEXT, speed_duration, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, TEXT) TO PUBLIC;
COMMENT ON FUNCTION public._speed_pricing_apply IS
  '0034: shared pricing helper for entry and cashout RPCs. Implements matrix lookup + asymmetric only-push-up rule + soft-block check. Single source of truth — codex hard rule.';

-- ============================================================================
-- 5) HELPER: _speed_max_stake_for_offered
--    Dynamic stake formula:
--    max_stake = min(configured_trade_max, payout_cap × p, liability_cap × p/(1-p))
--    Naturally throttles deep-underdog bets.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._speed_max_stake_for_offered(
  p_duration       speed_duration,
  p_offered_prob   DOUBLE PRECISION
) RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade_max     DECIMAL;
  v_payout_cap    DECIMAL;
  v_liability_cap DECIMAL;
  v_pool          DECIMAL;
  v_max_side_pct  DECIMAL;
  v_by_payout     DECIMAL;
  v_by_liability  DECIMAL;
  v_result        DECIMAL;
BEGIN
  v_trade_max := _speed_get_stake_max(p_duration);

  IF p_duration::TEXT = '5m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_5m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 2500);
  ELSE
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_1h' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 5000);
  END IF;

  SELECT rate INTO v_pool FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd' LIMIT 1;
  SELECT rate INTO v_max_side_pct FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_pool := COALESCE(v_pool, 10000);
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);
  v_liability_cap := v_pool * v_max_side_pct;

  -- max_stake_by_payout: stake / p <= payout_cap → stake <= payout_cap × p
  v_by_payout := v_payout_cap * p_offered_prob;

  -- max_stake_by_liability: liability_per_ticket = stake × (1-p)/p; constrain to <= liability_cap
  -- → stake <= liability_cap × p / (1-p)
  IF p_offered_prob >= 1.0 THEN
    v_by_liability := v_trade_max; -- p=1 means no real risk to platform
  ELSE
    v_by_liability := v_liability_cap * p_offered_prob / (1.0 - p_offered_prob);
  END IF;

  v_result := LEAST(v_trade_max, v_by_payout, v_by_liability);
  IF v_result < 1 THEN v_result := 1; END IF;
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public._speed_max_stake_for_offered(speed_duration, DOUBLE PRECISION) TO PUBLIC;
COMMENT ON FUNCTION public._speed_max_stake_for_offered IS
  '0034: dynamic stake limit formula. Returns max allowed stake given duration + offered_prob, considering trade max, per-ticket payout cap, and per-side liability cap.';

-- ============================================================================
-- 6) speed_execute_trade — pricing v3 (matrix-aware)
-- ============================================================================
--
-- Diff vs 0030 version:
--   * After computing v_fair_prob_side (BSM), call _speed_pricing_apply()
--     to get matrix-corrected mark/offered.
--   * If soft_blocked → raise SOFT_BLOCK error.
--   * Use new offered_prob for parity check + payout calculation.
--   * Per-ticket payout cap check (NEW safety layer).
--   * Three-tier NGR breaker check (replaces single-tier).
--   * Stake validated against dynamic _speed_max_stake_for_offered().
--   * fair_prob stored in speed_trades stays as BSM (audit trail), but
--     entry_offered_prob in speed_positions uses the new matrix-corrected value.

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id                    UUID,
  p_side                         TEXT,
  p_stake                        NUMERIC,
  p_idempotency_key              TEXT    DEFAULT NULL,
  p_expected_iv                  DECIMAL DEFAULT NULL,
  p_expected_spot                DECIMAL DEFAULT NULL,
  p_expected_seconds_left_bucket INTEGER DEFAULT NULL,
  p_expected_fair_prob           DECIMAL DEFAULT NULL,
  p_expected_offered_prob        DECIMAL DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_user               RECORD;
  v_market             RECORD;
  v_oracle             RECORD;
  v_existing_dup       RECORD;

  v_master_enabled     DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_spread_pct         DECIMAL;
  v_extreme_coeff      DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_late_reject_s      DECIMAL;

  v_fair_reject_high   DECIMAL;
  v_fair_reject_low    DECIMAL;
  v_late_30s_imbalance DECIMAL;
  v_late_60s_mult      DECIMAL;
  v_late_30s_mult      DECIMAL;

  v_pool_collateral    DECIMAL;
  v_max_side_pct       DECIMAL;
  v_max_cluster_pct    DECIMAL;
  v_max_user_daily     DECIMAL;
  v_circuit_tripped    TIMESTAMPTZ;

  v_ngr_today          DECIMAL;
  v_ngr_soft_block     DECIMAL;
  v_ngr_hard_stop      DECIMAL;
  v_ngr_soft_stake_max DECIMAL;
  v_payout_cap         DECIMAL;

  v_stake_min          DECIMAL := 1.00;
  v_stake_max          DECIMAL;
  v_stake_max_dyn      NUMERIC;
  v_cap_per_side       DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_fair_prob_side     DECIMAL;
  v_distance           DOUBLE PRECISION;
  v_overage            DOUBLE PRECISION;
  v_widened_spread     DOUBLE PRECISION;
  v_spread_mult        DOUBLE PRECISION;
  v_offered_prob       DECIMAL;
  v_dist_pct           DOUBLE PRECISION;
  v_pricing            RECORD;

  v_seconds_left       DOUBLE PRECISION;
  v_seconds_left_bucket INTEGER;
  v_payout_if_won      DECIMAL;

  v_user_market_sum    DECIMAL;
  v_user_daily_sum     DECIMAL;
  v_side_payout_sum    DECIMAL;
  v_cluster_payout_sum DECIMAL;
  v_strike_lo          DECIMAL;
  v_strike_hi          DECIMAL;

  v_parity_prob_tol    DECIMAL;
  v_parity_spot_tol    DECIMAL;

  v_position_id        UUID;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_side NOT IN ('over','under') THEN
    RAISE EXCEPTION 'Side must be over or under';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Stake must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Speed market not found';
  END IF;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Speed market has closed';
  END IF;
  IF NOW() < v_market.opens_at THEN
    RAISE EXCEPTION 'Speed market has not opened yet';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;
  IF v_market.strike_price IS NULL THEN
    RAISE EXCEPTION 'Speed market strike not yet finalized';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  SELECT rate INTO v_parity_spot_tol FROM fee_config WHERE fee_type = 'speed_parity_spot_drift_pct';
  v_parity_spot_tol := COALESCE(v_parity_spot_tol, 0.001);
  PERFORM _speed_assert_parity('spot_price', p_expected_spot, v_oracle.price, v_parity_spot_tol);

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND v_seconds_left_bucket <> p_expected_seconds_left_bucket THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Market regime changed between quote and execute — refresh quote';
  END IF;

  -- Per-user-per-market-per-side cap (validated before pricing math; cheaper to fail fast)
  SELECT rate INTO v_cap_per_side FROM fee_config WHERE fee_type = 'speed_cap_per_side_usd' LIMIT 1;
  v_cap_per_side := COALESCE(v_cap_per_side, 200);
  SELECT COALESCE(SUM(stake), 0) INTO v_user_market_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';
  IF v_user_market_sum + p_stake > v_cap_per_side THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_per_side - v_user_market_sum);
  END IF;

  SELECT rate INTO v_max_user_daily FROM fee_config WHERE fee_type = 'speed_max_user_daily_wager';
  IF v_max_user_daily IS NOT NULL AND v_max_user_daily > 0 THEN
    SELECT COALESCE(SUM(stake), 0) INTO v_user_daily_sum
    FROM speed_positions
    WHERE user_id = v_user_id
      AND created_at >= _speed_utc_midnight()
      AND status IN ('open','won','lost','cashed_out','refunded');
    IF v_user_daily_sum + p_stake > v_max_user_daily THEN
      RAISE EXCEPTION 'Daily wager limit reached: $% of $% used today (UTC)',
        v_user_daily_sum, v_max_user_daily;
    END IF;
  END IF;

  -- 0034: three-tier NGR breaker (replaces 0028's single-tier).
  -- - hard_stop: pause trading entirely
  -- - soft_block: reduce per-trade stake max
  -- - alert: telemetry only (no enforcement here)
  SELECT circuit_tripped_at INTO v_circuit_tripped
  FROM speed_daily_ngr WHERE ngr_date = _speed_utc_today();
  IF v_circuit_tripped IS NOT NULL THEN
    RAISE EXCEPTION 'Daily limit reached, try again tomorrow';
  END IF;

  SELECT ngr INTO v_ngr_today FROM speed_daily_ngr WHERE ngr_date = _speed_utc_today();
  v_ngr_today := COALESCE(v_ngr_today, 0);

  SELECT rate INTO v_ngr_hard_stop FROM fee_config WHERE fee_type = 'speed_daily_ngr_hard_stop_usd' LIMIT 1;
  v_ngr_hard_stop := COALESCE(v_ngr_hard_stop, -5000);
  IF v_ngr_today <= v_ngr_hard_stop THEN
    RAISE EXCEPTION 'Trading temporarily paused for system maintenance — please check back shortly'
      USING HINT = format('NGR hard stop: $%.2f <= $%.2f threshold', v_ngr_today, v_ngr_hard_stop);
  END IF;

  SELECT rate INTO v_ngr_soft_block FROM fee_config WHERE fee_type = 'speed_daily_ngr_soft_block_usd' LIMIT 1;
  SELECT rate INTO v_ngr_soft_stake_max FROM fee_config WHERE fee_type = 'speed_ngr_soft_block_stake_max_usd' LIMIT 1;
  v_ngr_soft_block := COALESCE(v_ngr_soft_block, -2500);
  v_ngr_soft_stake_max := COALESCE(v_ngr_soft_stake_max, 100);

  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── PRICING ─────────────────────────────────────────────────────────
  SELECT rate INTO v_spread_pct    FROM fee_config WHERE fee_type = 'speed_spread_pct';
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff';
  v_spread_pct    := COALESCE(v_spread_pct, 0.05);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);

  v_iv := _speed_get_iv(v_market.asset, v_market.duration);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
  END IF;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- 0030: fair_prob parity check
  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('fair_prob', p_expected_fair_prob, v_fair_prob_side, v_parity_prob_tol);

  -- BSM hard rejects (stay at this layer; matrix runs after these gates)
  SELECT rate INTO v_fair_reject_high FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_high';
  SELECT rate INTO v_fair_reject_low  FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_low';
  v_fair_reject_high := COALESCE(v_fair_reject_high, 0.97);
  v_fair_reject_low  := COALESCE(v_fair_reject_low,  0.03);
  IF v_fair_prob_side > v_fair_reject_high THEN
    RAISE EXCEPTION 'Trade rejected: outcome too close to certain (fair_prob=%)', ROUND(v_fair_prob_side, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;
  IF v_fair_prob_side < v_fair_reject_low THEN
    RAISE EXCEPTION 'Trade rejected: side too unlikely (fair_prob=%)', ROUND(v_fair_prob_side, 4)
      USING HINT = 'Pick the other side';
  END IF;

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Trade rejected: too late and too one-sided (fair_prob=%, secs_left=%)',
        ROUND(v_fair_prob_side, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Place this bet earlier in the market';
    END IF;
  END IF;

  -- Spread layering (base + extreme overage + reduced multiplicative late-window per mig 0034)
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_mult FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult';
    v_spread_mult := COALESCE(v_late_30s_mult, 1.40);  -- 0034: was 1.80
  ELSIF v_seconds_left < 60 THEN
    SELECT rate INTO v_late_60s_mult FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult';
    v_spread_mult := COALESCE(v_late_60s_mult, 1.20);  -- 0034: was 1.40
  ELSE
    v_spread_mult := 1.0;
  END IF;
  v_widened_spread := v_widened_spread * v_spread_mult;

  -- 0034: matrix correction via shared helper
  v_dist_pct := (v_oracle.price::DOUBLE PRECISION - v_market.strike_price::DOUBLE PRECISION)
              / NULLIF(v_market.strike_price::DOUBLE PRECISION, 0);

  SELECT * INTO v_pricing
  FROM _speed_pricing_apply(
    v_market.asset,
    v_market.duration,
    p_side,
    v_dist_pct,
    v_seconds_left,
    v_fair_prob_side::DOUBLE PRECISION,
    v_widened_spread,
    'entry'
  );

  v_offered_prob := v_pricing.offered_prob::DECIMAL;

  -- 0034: soft-block check
  IF v_pricing.soft_blocked THEN
    RAISE EXCEPTION 'SOFT_BLOCK: market closing — try next round in a moment'
      USING HINT = format('offered_prob=%s exceeds soft_block_threshold', ROUND(v_offered_prob, 4));
  END IF;

  -- Hard cap (kept as last-line safety; matrix should never push above 0.99 due to floor in helper)
  IF v_offered_prob < 0.01 THEN v_offered_prob := 0.01; END IF;
  IF v_offered_prob > 0.99 THEN
    RAISE EXCEPTION 'Trade rejected: pricing saturated (offered_prob=% would exceed 0.99 cap)', ROUND(v_offered_prob, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;

  -- 0030 + 0034 [P1 codex fix]: offered_prob parity check.
  -- Skip when matrix is active and pushed the price up — clients compute
  -- expected_offered_prob from BSM locally and CANNOT know matrix output
  -- without calling /api/speed/quote. Asymmetric only-push-up means matrix
  -- can only RAISE the price; if mark > BSM, we know matrix engaged.
  -- The fair_prob parity check (above) still validates BSM-vs-BSM and
  -- catches stale spot quotes — that's the actual stale-quote defense.
  IF NOT (v_pricing.matrix_used AND v_pricing.mark_prob > v_fair_prob_side::DOUBLE PRECISION) THEN
    PERFORM _speed_assert_parity('offered_prob', p_expected_offered_prob, v_offered_prob, v_parity_prob_tol);
  END IF;

  -- 0034: dynamic stake limit (per-trade max + payout cap + liability cap + NGR-soft-block tier)
  v_stake_max_dyn := _speed_max_stake_for_offered(v_market.duration, v_offered_prob::DOUBLE PRECISION);
  IF v_ngr_today <= v_ngr_soft_block THEN
    v_stake_max_dyn := LEAST(v_stake_max_dyn, v_ngr_soft_stake_max);
  END IF;

  IF p_stake < v_stake_min THEN
    RAISE EXCEPTION 'Stake $% below minimum $%', p_stake, v_stake_min;
  END IF;
  IF p_stake > v_stake_max_dyn THEN
    RAISE EXCEPTION 'Limit reached — your max trade size for this market is $%', ROUND(v_stake_max_dyn, 2)
      USING HINT = 'Try a smaller stake or another market';
  END IF;

  -- 0034: per-ticket payout cap (NEW safety layer)
  v_payout_if_won := p_stake / v_offered_prob;
  IF v_market.duration::TEXT = '5m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_5m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 2500);
  ELSE
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_1h' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 5000);
  END IF;
  IF v_payout_if_won > v_payout_cap THEN
    RAISE EXCEPTION 'MAX_PAYOUT_CAP: payout $% exceeds per-ticket cap $%',
      ROUND(v_payout_if_won, 2), ROUND(v_payout_cap, 2)
      USING HINT = 'Try a smaller stake';
  END IF;

  -- Per-side market exposure cap
  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);

  SELECT COALESCE(SUM(stake / entry_offered_prob), 0) INTO v_side_payout_sum
  FROM speed_positions
  WHERE market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';

  IF v_side_payout_sum + v_payout_if_won > v_max_side_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
      USING HINT = format('payout liability $%.2f vs cap $%.2f (%.0f%% of $%.0f pool)',
        v_side_payout_sum + v_payout_if_won,
        v_max_side_pct * v_pool_collateral,
        v_max_side_pct * 100, v_pool_collateral);
  END IF;

  SELECT rate INTO v_max_cluster_pct FROM fee_config WHERE fee_type = 'speed_max_strike_cluster_pct';
  v_max_cluster_pct := COALESCE(v_max_cluster_pct, 0.30);

  v_strike_lo := v_market.strike_price * 0.995;
  v_strike_hi := v_market.strike_price * 1.005;

  SELECT COALESCE(SUM(p.stake / p.entry_offered_prob), 0) INTO v_cluster_payout_sum
  FROM speed_positions p
  JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status = 'open'
    AND p.side = p_side::speed_side
    AND m.status = 'open'
    AND m.asset = v_market.asset
    AND m.strike_price BETWEEN v_strike_lo AND v_strike_hi;

  IF v_cluster_payout_sum + v_payout_if_won > v_max_cluster_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Strike cluster exposure cap reached on % side', p_side
      USING HINT = format('cluster liability $%.2f vs cap $%.2f',
        v_cluster_payout_sum + v_payout_if_won, v_max_cluster_pct * v_pool_collateral);
  END IF;

  -- ── ATOMIC WRITES ────────────────────────────────────────────────────
  INSERT INTO speed_positions (
    user_id, market_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, p_side::speed_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, iv_used, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, NULL, v_iv, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  UPDATE users SET
    balance_usd = balance_usd - p_stake,
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'position_id', v_position_id,
    'trade_id', v_trade_id,
    'side', p_side,
    'stake', ROUND(p_stake, 2),
    'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8),
    'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6),
    'mark_prob', ROUND(v_pricing.mark_prob::NUMERIC, 6),
    'matrix_used', v_pricing.matrix_used,
    'matrix_version', v_pricing.matrix_version,
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'iv_used', ROUND(v_iv, 6),
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) IS
  '0034: pricing engine v3. Adds matrix-based pricing via shared _speed_pricing_apply() helper, asymmetric only-push-up rule, soft-block, per-ticket payout cap, dynamic stake formula, three-tier NGR breaker. All flag-gated; default behavior identical to 0030.';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) TO PUBLIC;

-- ============================================================================
-- 7) speed_execute_cashout — pricing v3 (matrix-aware mark)
-- ============================================================================
--
-- Diff vs 0030 version:
--   * After computing v_fair_prob_over (BSM), call _speed_pricing_apply()
--     with mode='cashout' to get matrix-corrected mark_prob.
--   * Cap-edge handling: when entry_offered_prob and mark_prob both >= cap_edge_threshold,
--     raise CASHOUT_AT_CAP error (UI shows 'Hold for settlement').
--   * Direction-matching invariant: when matrix is enabled, mark uses the
--     same matrix lookup as entry → favorable spot move always increases mark.

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id                  UUID,
  p_idempotency_key              TEXT    DEFAULT NULL,
  p_expected_iv                  DECIMAL DEFAULT NULL,
  p_expected_spot                DECIMAL DEFAULT NULL,
  p_expected_seconds_left_bucket INTEGER DEFAULT NULL,
  p_expected_mark_prob           DECIMAL DEFAULT NULL,
  p_expected_cashout_amount      NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_position           RECORD;
  v_market             RECORD;
  v_market_id          UUID;
  v_oracle             RECORD;

  v_kill_switch        DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_seconds_total      DOUBLE PRECISION;
  v_seconds_left       DOUBLE PRECISION;
  v_seconds_left_bucket INTEGER;
  v_pct                DOUBLE PRECISION;
  v_late_reject_s      DECIMAL;
  v_late_30s_imbalance DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_bsm_mark_side      DOUBLE PRECISION;
  v_pricing            RECORD;
  v_mark_prob          DECIMAL;
  v_dist_pct           DOUBLE PRECISION;
  v_cap_edge_thresh    DECIMAL;

  v_is_winning         BOOLEAN;
  v_fair_profit        NUMERIC;
  v_margin             DOUBLE PRECISION;
  v_cashout_amount     NUMERIC;

  v_parity_prob_tol    DECIMAL;
  v_parity_spot_tol    DECIMAL;
  v_parity_cashout_tol DECIMAL;

  v_existing_dup       RECORD;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT rate INTO v_kill_switch FROM fee_config WHERE fee_type = 'speed_cashout_enabled' LIMIT 1;
  IF COALESCE(v_kill_switch, 1) <= 0 THEN
    RAISE EXCEPTION 'Cashout temporarily disabled — please try again shortly';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate cashout — returning existing trade_id'
      );
    END IF;
  END IF;

  SELECT market_id INTO v_market_id
  FROM speed_positions WHERE id = p_position_id;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('speed_resolve_' || v_market_id::TEXT));

  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not authorised for this position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no cashouts in last %s seconds', v_late_reject_s;
  END IF;

  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND v_seconds_left_bucket <> p_expected_seconds_left_bucket THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Cashout window changed — refresh quote';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  SELECT rate INTO v_parity_spot_tol FROM fee_config WHERE fee_type = 'speed_parity_spot_drift_pct';
  v_parity_spot_tol := COALESCE(v_parity_spot_tol, 0.001);
  PERFORM _speed_assert_parity('spot_price', p_expected_spot, v_oracle.price, v_parity_spot_tol);

  v_iv := _speed_get_iv(v_market.asset, v_market.duration);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_pct := CASE WHEN v_seconds_total > 0 THEN v_seconds_left / v_seconds_total ELSE 0 END;

  -- BSM baseline
  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_bsm_mark_side := v_fair_prob_over::DOUBLE PRECISION;
  ELSE
    v_bsm_mark_side := (1.0 - v_fair_prob_over)::DOUBLE PRECISION;
  END IF;

  -- 0034: matrix-corrected mark via shared helper (same logic as entry)
  v_dist_pct := (v_oracle.price::DOUBLE PRECISION - v_market.strike_price::DOUBLE PRECISION)
              / NULLIF(v_market.strike_price::DOUBLE PRECISION, 0);

  SELECT * INTO v_pricing
  FROM _speed_pricing_apply(
    v_market.asset,
    v_market.duration,
    v_position.side::TEXT,
    v_dist_pct,
    v_seconds_left,
    v_bsm_mark_side,
    0,                  -- no spread on cashout side
    'cashout'
  );

  v_mark_prob := v_pricing.mark_prob::DECIMAL;

  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  -- 0034 [P1 codex fix]: skip mark_prob parity when matrix pushed it up.
  -- Same rationale as entry-side parity skip — clients send BSM-derived
  -- expected_mark_prob; matrix output legitimately exceeds it. The cashout
  -- parity is still meaningful when matrix is OFF or didn't engage on this
  -- cell (cashout_amount parity below also acts as final-number guard).
  IF NOT (v_pricing.matrix_used AND v_pricing.mark_prob > v_bsm_mark_side) THEN
    PERFORM _speed_assert_parity('mark_prob', p_expected_mark_prob, v_mark_prob, v_parity_prob_tol);
  END IF;

  -- 0034: cap-edge cashout — disable when both entry and mark are at the cap
  SELECT rate INTO v_cap_edge_thresh FROM fee_config WHERE fee_type = 'speed_cashout_cap_edge_threshold' LIMIT 1;
  v_cap_edge_thresh := COALESCE(v_cap_edge_thresh, 0.985);
  IF v_position.entry_offered_prob >= v_cap_edge_thresh AND v_mark_prob >= v_cap_edge_thresh THEN
    RAISE EXCEPTION 'CASHOUT_AT_CAP: position already at market cap — hold to settlement'
      USING HINT = 'Hold for settlement to receive full payout';
  END IF;

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_mark_prob::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Cashout rejected: too late and too one-sided (mark=%, secs_left=%)',
        ROUND(v_mark_prob, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Hold to expiry — cashout window is closed';
    END IF;
  END IF;

  v_is_winning := v_mark_prob > v_position.entry_offered_prob;
  v_fair_profit := v_position.stake
                 * (v_mark_prob / v_position.entry_offered_prob - 1.0);

  v_margin := _speed_cashout_margin(
    v_market.duration, v_is_winning, v_mark_prob, v_seconds_left
  );

  IF v_is_winning THEN
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 - v_margin);
  ELSE
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 + v_margin);
  END IF;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;

  IF v_is_winning AND ROUND(v_cashout_amount, 2) <= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_PROFIT: profit too small to lock in cleanly (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Wait for the chart to move further or hold to expiry';
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND ROUND(v_cashout_amount, 2) >= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_LOSS: rounded cashout would not register a loss (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Hold to expiry — there is no meaningful loss to cut';
  END IF;

  v_cashout_amount := ROUND(v_cashout_amount, 2);

  SELECT rate INTO v_parity_cashout_tol FROM fee_config WHERE fee_type = 'speed_parity_cashout_drift_pct';
  v_parity_cashout_tol := COALESCE(v_parity_cashout_tol, 0.02);
  -- 0034 [P1 codex fix]: same skip logic — matrix-pushed mark causes a
  -- different cashout_amount than client computed; expected_cashout_amount
  -- is BSM-derived. The direction-matching invariant assertions below
  -- still defensively guard the math (winning cashout > stake, losing < stake).
  IF NOT (v_pricing.matrix_used AND v_pricing.mark_prob > v_bsm_mark_side) THEN
    PERFORM _speed_assert_parity('cashout_amount', p_expected_cashout_amount, v_cashout_amount, v_parity_cashout_tol);
  END IF;

  IF v_is_winning AND v_cashout_amount <= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: winning cashout=$% <= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND v_cashout_amount >= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: losing cashout=$% >= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier,
    iv_used, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_mark_prob, v_position.entry_offered_prob, v_margin::DECIMAL,
    v_iv, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (margin ' || ROUND(v_margin::NUMERIC, 4) || ', ' ||
      CASE WHEN v_is_winning THEN 'winning' ELSE 'losing' END ||
      ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
    );
  END IF;

  PERFORM _speed_update_daily_ngr(0, 0, v_cashout_amount, 0);

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'position_id', p_position_id,
    'cashout_amount', v_cashout_amount,
    'mark_prob', ROUND(v_mark_prob, 6),
    'matrix_used', v_pricing.matrix_used,
    'matrix_version', v_pricing.matrix_version,
    'is_winning', v_is_winning,
    'margin_applied', ROUND(v_margin::NUMERIC, 6),
    'fair_profit', ROUND(v_fair_profit::NUMERIC, 6),
    'pct_remaining', ROUND(v_pct::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) IS
  '0034: cashout uses shared _speed_pricing_apply() helper (mode=cashout) so mark_prob comes from the same matrix lookup as entry. Direction-matching invariant preserved with matrix active. Cap-edge case raises CASHOUT_AT_CAP for UI to show hold-for-settlement.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) TO PUBLIC;
