-- ============================================================================
-- 352_speed_pricing_smoothing.sql
--
-- Speed-market pricing smoothness — Seams 2a / 2 / 3 / 4.
--
-- Bundles four related changes into one migration. They all touch the live
-- trade RPC body or its inputs, so splitting adds no safety:
--
--   Seam 2a: normal_cdf safety clip at |x| >= 37 — fixes 22003 EXP underflow
--            in production for extreme d² (the production half of the bug
--            Fix A patches in tests at e48fcd3). Preserves the polynomial
--            in the normal range; just short-circuits to the asymptote
--            beyond ~|37| where EXP(-x²/2) underflows Postgres double-precision.
--
--   Seam 2:  Widen speed_fair_prob_over clip from [0.01, 0.99] → [0.001, 0.999].
--            Removes the visible flat region in normal use; payout multipliers
--            remain bounded (max 1000x).
--
--   Seam 3:  Replace the "Market too imbalanced" hard reject in
--            speed_execute_trade with a quadratic spread widening as fair
--            approaches 0 or 1. Trade button stays enabled at extremes
--            (with a wider spread); existing 0.99/0.01 cap on offered
--            probability still applies.
--
--   Seam 4:  Realized volatility (RV) replacing constant σ = 0.6.
--            - speed_realized_vol(asset, window_seconds) — gap-aware,
--              per-second variance normalization, source='binance' filter,
--              [0.2, 2.0] clamp.
--            - speed_realized_vol_cache table — single row per asset.
--            - speed_rv_refresh() — populates cache.
--            - pg_cron job 'speed-rv-refresh' every 30s (matches mig 332
--              pattern; do NOT use Vercel cron — that doesn't run on staging).
--            - get_speed_volatility(asset) public RPC for client (badge).
--            - Trade & cashout RPCs read RV cache first, fall back to
--              fee_config.speed_iv_btc when cache empty/stale/null.
--
-- Two new fee_config keys:
--   speed_use_realized_vol   = 1     (kill switch — set to 0 to disable RV
--                                     and read fee_config.speed_iv_btc)
--   speed_extreme_spread_coeff = 8   (Seam 3 widening coefficient)
--
-- Rollback baselines (per Codex #1, plan-eng-review):
--   - normal_cdf:               restore from mig 318 (drop the |x|>=37 clip)
--   - speed_fair_prob_over:     restore from mig 318 (clip back to [0.01, 0.99])
--   - speed_execute_trade:      restore body from mig 345 (NOT mig 318/340)
--   - speed_execute_cashout:    restore body from MIG 351 (NOT mig 345 — keeps
--                               the cashout multiplier swap from Seam 1)
-- The RV cache table, helper functions, and pg_cron job get DROP'd. See
-- ROLLBACK REFERENCE block at the bottom of this file for the exact bodies
-- to restore.
--
-- Side effect on existing tests:
--   speed-idempotency-retry.test.ts: already unblocked by Fix A (e48fcd3).
--   speed-cashout-smooth.test.ts and speed-pool-concurrency.test.ts: also
--     use hardcoded $67k strikes; mig 352 makes them safe at the math layer
--     against any real-BTC drift via Seam 2a (no fixture rewrite required).
-- ============================================================================

-- ───────────────────────────────────────────────────────────────────────────
-- Part A — Seam 2a: normal_cdf safety clip
-- ───────────────────────────────────────────────────────────────────────────
-- For |x| >= ~37, EXP(-x²/2) is below safe Postgres double-precision range
-- (22003 numeric underflow). The polynomial result is already
-- indistinguishable from the asymptote (0 or 1) within float-double
-- precision; clip earlier and skip the EXP entirely.
--
-- normal_cdf(37)  ≈ 1 - 5.5e-301  → indistinguishable from 1.0
-- normal_cdf(-37) ≈ 5.5e-301      → indistinguishable from 0.0
--
-- Stays IMMUTABLE — no DB reads added.

CREATE OR REPLACE FUNCTION normal_cdf(x DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k DOUBLE PRECISION;
  phi DOUBLE PRECISION;
  approx DOUBLE PRECISION;
  abs_x DOUBLE PRECISION;
  a1 CONSTANT DOUBLE PRECISION := 0.319381530;
  a2 CONSTANT DOUBLE PRECISION := -0.356563782;
  a3 CONSTANT DOUBLE PRECISION := 1.781477937;
  a4 CONSTANT DOUBLE PRECISION := -1.821255978;
  a5 CONSTANT DOUBLE PRECISION := 1.330274429;
BEGIN
  abs_x := ABS(x);

  -- Mig 352 (Seam 2a): clip extreme inputs before EXP() to avoid 22003
  -- numeric underflow. Beyond ~|38| the polynomial result is float-double
  -- precision noise around the asymptote (0 or 1). EXP(-38²/2) = EXP(-722)
  -- is already below ~1e-313, dangerously close to underflow. Clip earlier
  -- to leave headroom for the 1/SQRT(2π) division.
  IF abs_x >= 37 THEN
    RETURN CASE WHEN x >= 0 THEN 1.0 ELSE 0.0 END;
  END IF;

  k := 1.0 / (1.0 + 0.2316419 * abs_x);
  phi := EXP(-(x * x) / 2.0) / SQRT(2.0 * pi());
  approx := 1.0 - phi * (a1 * k + a2 * k * k + a3 * k * k * k + a4 * k * k * k * k + a5 * k * k * k * k * k);
  IF x >= 0 THEN
    RETURN approx;
  ELSE
    RETURN 1.0 - approx;
  END IF;
END;
$$;

COMMENT ON FUNCTION normal_cdf(DOUBLE PRECISION) IS
'Standard normal cumulative distribution function. Abramowitz & Stegun polynomial approximation, ~7.5e-8 accuracy. Used by speed-market binary pricing. Mig 352 (Seam 2a): added |x|>=37 clip to avoid 22003 EXP underflow at extreme d².';

-- ───────────────────────────────────────────────────────────────────────────
-- Part B — Seam 2: widen speed_fair_prob_over clip
-- ───────────────────────────────────────────────────────────────────────────
-- Widen [0.01, 0.99] → [0.001, 0.999]. Keeps payout multipliers bounded
-- (max 1000x) but removes the visible flat region in normal use. The Seam 3
-- widened spread does the user-facing work in the extreme region.

CREATE OR REPLACE FUNCTION speed_fair_prob_over(
  p_spot          DECIMAL,
  p_strike        DECIMAL,
  p_seconds_left  DOUBLE PRECISION,
  p_iv            DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_T   DOUBLE PRECISION;
  v_sig DOUBLE PRECISION;
  v_d2  DOUBLE PRECISION;
  v_p   DOUBLE PRECISION;
BEGIN
  IF p_seconds_left <= 0 THEN
    -- At or past expiry. Resolve based on direction.
    IF p_spot > p_strike THEN RETURN 0.999;
    ELSIF p_spot < p_strike THEN RETURN 0.001;
    ELSE RETURN 0.5; END IF;
  END IF;
  v_T := p_seconds_left / (365.0 * 24.0 * 60.0 * 60.0);   -- years
  v_sig := p_iv::DOUBLE PRECISION;
  IF v_sig <= 0 THEN v_sig := 0.6; END IF;
  v_d2 := (LN(p_spot::DOUBLE PRECISION / p_strike::DOUBLE PRECISION)
           + (0.0 - v_sig * v_sig / 2.0) * v_T)
          / (v_sig * SQRT(v_T));
  v_p := normal_cdf(v_d2);
  -- Mig 352 (Seam 2): widen clip from [0.01, 0.99] to [0.001, 0.999].
  -- Removes the visible flat region while keeping payout multipliers bounded.
  IF v_p < 0.001 THEN v_p := 0.001;
  ELSIF v_p > 0.999 THEN v_p := 0.999;
  END IF;
  RETURN v_p::DECIMAL;
END;
$$;

COMMENT ON FUNCTION speed_fair_prob_over(DECIMAL, DECIMAL, DOUBLE PRECISION, DECIMAL) IS
'Black-Scholes fair probability that spot > strike at expiry. Inputs: spot, strike, seconds-to-expiry, implied vol. Output clipped to [0.001, 0.999] (mig 352 widened from [0.01, 0.99]).';

-- ───────────────────────────────────────────────────────────────────────────
-- Part C — Seam 4: Realized volatility plumbing
-- ───────────────────────────────────────────────────────────────────────────

-- C.1 — Cache table (single row per asset)
CREATE TABLE IF NOT EXISTS speed_realized_vol_cache (
  asset       speed_asset PRIMARY KEY,
  rv          DECIMAL NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE speed_realized_vol_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS speed_rv_cache_admin_all ON speed_realized_vol_cache;
CREATE POLICY speed_rv_cache_admin_all ON speed_realized_vol_cache
  FOR ALL TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

DROP POLICY IF EXISTS speed_rv_cache_public_read ON speed_realized_vol_cache;
CREATE POLICY speed_rv_cache_public_read ON speed_realized_vol_cache
  FOR SELECT TO anon, authenticated
  USING (TRUE);

COMMENT ON TABLE speed_realized_vol_cache IS
'Mig 352 (Seam 4): cached realized volatility per asset. Refreshed every 60s by speed_rv_refresh() via pg_cron. Trade/cashout RPCs read here first, fall back to fee_config.speed_iv_btc on cache miss/stale.';

-- C.2 — speed_realized_vol(asset, window_seconds) — gap-aware
-- STABLE (reads fee_config and speed_oracle_klines), not IMMUTABLE.
-- Per-second variance normalization handles gaps in the kline stream:
-- if returns are 1s apart on average but a 5-second gap appears, that
-- 5s return has roughly 5× the variance of a 1s return. Dividing each r²
-- by its actual dt_s normalizes each contribution to per-second; we
-- annualize once at the end.

CREATE OR REPLACE FUNCTION speed_realized_vol(
  p_asset speed_asset,
  p_window_seconds INTEGER DEFAULT 3600
) RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_var      DOUBLE PRECISION;
  v_n        INTEGER;
  v_floor    DECIMAL;
  v_use_rv   DECIMAL;
BEGIN
  -- Kill switch: speed_use_realized_vol = 0 → return floor IV directly.
  SELECT rate INTO v_use_rv FROM fee_config WHERE fee_type = 'speed_use_realized_vol' LIMIT 1;
  IF COALESCE(v_use_rv, 1) = 0 THEN
    SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    RETURN COALESCE(v_floor, 0.6);
  END IF;

  WITH closes AS (
    -- Filter to single source so duplicate timestamps don't bias variance.
    SELECT close_price, ts
    FROM speed_oracle_klines
    WHERE asset = p_asset
      AND source = 'binance'
      AND ts >= NOW() - (p_window_seconds || ' seconds')::INTERVAL
    ORDER BY ts
  ),
  rets AS (
    SELECT
      LN(close_price / LAG(close_price) OVER (ORDER BY ts)) AS r,
      EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) AS dt_s
    FROM closes
  ),
  normalized AS (
    -- per-second variance contribution; gap-robust.
    SELECT (r * r) / NULLIF(dt_s, 0) AS per_sec_var
    FROM rets
    WHERE r IS NOT NULL AND dt_s > 0
  )
  SELECT AVG(per_sec_var), COUNT(*) INTO v_var, v_n FROM normalized;

  IF v_n < 60 OR v_var IS NULL THEN
    -- Insufficient data → fall back to fee_config IV.
    SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    RETURN COALESCE(v_floor, 0.6);
  END IF;

  -- Annualize: σ = sqrt(per_sec_var * seconds_per_year), clamped to [0.2, 2.0].
  RETURN GREATEST(0.2, LEAST(2.0, SQRT(v_var * 365.0 * 24.0 * 3600.0)::DECIMAL));
END;
$$;

COMMENT ON FUNCTION speed_realized_vol(speed_asset, INTEGER) IS
'Mig 352 (Seam 4): annualized realized volatility from speed_oracle_klines. Per-second variance normalization handles gaps. Filters source=binance to avoid duplicate-timestamp bias. Returns σ ∈ [0.2, 2.0]; falls back to fee_config.speed_iv_btc on insufficient data or kill-switch (speed_use_realized_vol=0). STABLE — reads fee_config and klines.';

-- C.3 — Cache refresh function
CREATE OR REPLACE FUNCTION speed_rv_refresh() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO speed_realized_vol_cache (asset, rv, computed_at)
  SELECT 'BTC'::speed_asset, speed_realized_vol('BTC'::speed_asset, 3600), NOW()
  ON CONFLICT (asset) DO UPDATE
    SET rv = EXCLUDED.rv, computed_at = EXCLUDED.computed_at;
END;
$$;

COMMENT ON FUNCTION speed_rv_refresh() IS
'Mig 352 (Seam 4): writes the latest 1h-window σ into speed_realized_vol_cache for BTC. Called by pg_cron every 60s (job: speed-rv-refresh — see Part C.5; Supabase pg_cron does not support 6-field sub-minute schedules). When more assets are added, expand this to loop through speed_asset values.';

-- C.4 — Public RPC for client badge
-- Returns { rv, computed_at, source: 'cache' | 'fallback' } as jsonb.
CREATE OR REPLACE FUNCTION get_speed_volatility(p_asset speed_asset)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     RECORD;
  v_floor   DECIMAL;
BEGIN
  SELECT rv, computed_at INTO v_row
  FROM speed_realized_vol_cache
  WHERE asset = p_asset;

  -- Fresh cache (within 5 minutes) → return cached value.
  IF FOUND AND v_row.computed_at > NOW() - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object(
      'rv', v_row.rv,
      'computed_at', v_row.computed_at,
      'source', 'cache'
    );
  END IF;

  -- Otherwise → fall back to fee_config.speed_iv_btc.
  SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  RETURN jsonb_build_object(
    'rv', COALESCE(v_floor, 0.6),
    'computed_at', NOW(),
    'source', 'fallback'
  );
END;
$$;

COMMENT ON FUNCTION get_speed_volatility(speed_asset) IS
'Mig 352 (Seam 4): public RPC for client volatility badge. Returns {rv, computed_at, source} as jsonb. source=cache when speed_realized_vol_cache is fresh (<5min); source=fallback when stale/empty (returns fee_config.speed_iv_btc).';

GRANT EXECUTE ON FUNCTION get_speed_volatility(speed_asset) TO authenticated, anon;

-- C.5 — pg_cron schedule
-- Drop any existing job with the same name (idempotent re-run), then
-- (re-)create it. Wrapped in DO/EXCEPTION so a fresh deploy where pg_cron
-- isn't installed yet doesn't blow up the migration.
--
-- Schedule format: 5-field POSIX `* * * * *` = once per minute. Supabase's
-- pg_cron does NOT support the 6-field (sub-minute) format — it accepts
-- the syntax silently but the job never fires. Confirmed against the
-- existing speed-roll / speed-resolve jobs from mig 332 which all use
-- 5-field. 1-min granularity is fine here because:
--   - Trade RPC reads RV cache with a 5-minute staleness window
--   - 1-min latency on σ updates is well below user-perceptible thresholds
--   - Reduces load (fewer SUM-over-1h-of-klines computations)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'speed-rv-refresh') THEN
    PERFORM cron.unschedule('speed-rv-refresh');
  END IF;
  PERFORM cron.schedule(
    'speed-rv-refresh',
    '* * * * *',                       -- once per minute (5-field)
    $cron$ SELECT public.speed_rv_refresh(); $cron$
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron not installed (cron.job missing); skipping speed-rv-refresh schedule';
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron functions missing; skipping speed-rv-refresh schedule';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Part D — fee_config seeds for new keys
-- ───────────────────────────────────────────────────────────────────────────
-- speed_use_realized_vol: kill switch (1=on, 0=off). When 0, RV is bypassed
-- and the trade RPC reads fee_config.speed_iv_btc directly.
-- speed_extreme_spread_coeff: Seam 3 quadratic widening coefficient. Larger
-- = wider spread at extremes.
--
-- Note: fee_config's unique index is on (fee_type, COALESCE(level, -1),
-- COALESCE(depth, -1)) (mig 246), not a plain UNIQUE on fee_type. Use a
-- pre-check pattern instead of ON CONFLICT so this migration is idempotent
-- across re-runs without specifying the COALESCE expression as a conflict
-- target.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM fee_config
    WHERE fee_type = 'speed_use_realized_vol'
      AND COALESCE(level, -1) = -1
      AND COALESCE(depth, -1) = -1
  ) THEN
    INSERT INTO fee_config (fee_type, level, depth, rate, description)
    VALUES (
      'speed_use_realized_vol', NULL, NULL, 1,
      'Mig 352 (Seam 4): kill switch for realized volatility. 1=use cache, 0=force fee_config.speed_iv_btc.'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fee_config
    WHERE fee_type = 'speed_extreme_spread_coeff'
      AND COALESCE(level, -1) = -1
      AND COALESCE(depth, -1) = -1
  ) THEN
    INSERT INTO fee_config (fee_type, level, depth, rate, description)
    VALUES (
      'speed_extreme_spread_coeff', NULL, NULL, 8,
      'Mig 352 (Seam 3): quadratic widening coefficient. spread = base + max(0, |fair-0.5| - 0.45)^2 * coeff.'
    );
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Part E — Patch speed_execute_trade body (was last in mig 345)
-- ───────────────────────────────────────────────────────────────────────────
-- Three changes versus mig 345's body:
--   1. IV lookup reads speed_realized_vol_cache first (Seam 4)
--   2. Drop pricing-bound reject + "Market too imbalanced" exception (Seam 3)
--   3. Replace fixed offered = fair + spread/2 with quadratic widening (Seam 3)
-- Everything else is byte-for-byte identical to mig 345 — locking, idempotency,
-- exposure caps, atomic-write block, commission walk.

CREATE OR REPLACE FUNCTION speed_execute_trade(
  p_market_id        UUID,
  p_side             TEXT,
  p_stake            DECIMAL,
  p_idempotency_key  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_user              RECORD;
  v_market            RECORD;
  v_oracle            RECORD;

  v_signup_branch_id  UUID;
  v_signup_branch     RECORD;
  v_routing_branch_id UUID;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;
  v_is_reseller_flow  BOOLEAN;

  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_max_exposure_pct  DECIMAL;
  v_extreme_coeff     DECIMAL;

  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_widened_spread    DOUBLE PRECISION;
  v_distance          DOUBLE PRECISION;
  v_overage           DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;

  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_for_duration  DECIMAL;

  v_market_exposure   RECORD;
  v_pool_collateral   DECIMAL;
  v_payout_if_won     DECIMAL;
  v_side_worst_case   DECIMAL;

  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;

  v_fee_share_amount  DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_side NOT IN ('over', 'under') THEN
    RAISE EXCEPTION 'Side must be over or under';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Stake must be positive';
  END IF;

  -- ── Idempotency check ──────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.user_id = v_user_id
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

  -- ── Master kill switch ─────────────────────────────────────────────────
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  -- ── Lock user row + frozen check ───────────────────────────────────────
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- ── Lock market + status check ─────────────────────────────────────────
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

  -- ── Oracle freshness check ─────────────────────────────────────────────
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  -- ── Determine routing flow ─────────────────────────────────────────────
  v_signup_branch_id := v_user.signup_branch_id;

  IF v_signup_branch_id IS NULL THEN
    v_is_reseller_flow := FALSE;
    v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE;
      v_routing_branch_id := NULL;
    ELSE
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;

      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches
        WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE;
          v_routing_branch_id := v_signup_branch_id;
        ELSE
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        v_is_reseller_flow := FALSE;
        v_routing_branch_id := NULL;
      END IF;
    END IF;
  END IF;

  -- ── Lock the main-pool sentinel for retail/commission flow ─────────────
  IF NOT v_is_reseller_flow THEN
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN
      RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
    END IF;
  END IF;

  -- ── Stake range check ──────────────────────────────────────────────────
  IF v_is_reseller_flow THEN
    IF p_stake < v_speed_branch.stake_min OR p_stake > v_speed_branch.stake_max THEN
      RAISE EXCEPTION 'Stake $% outside branch limits ($% - $%)',
        p_stake, v_speed_branch.stake_min, v_speed_branch.stake_max;
    END IF;
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    IF p_stake < 1.00 OR p_stake > 25.00 THEN
      RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake;
    END IF;
    v_cap_for_duration := 200.00;
  END IF;

  -- ── Per-user per-side cap ──────────────────────────────────────────────
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side
    AND status = 'open';

  IF v_current_side_sum + p_stake > v_cap_for_duration THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_for_duration - v_current_side_sum);
  END IF;

  -- ── User balance check ─────────────────────────────────────────────────
  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── Read pricing constants ─────────────────────────────────────────────
  -- Mig 352 (Seam 4): IV from speed_realized_vol_cache first; fall back to
  -- fee_config.speed_iv_btc on cache miss/stale (>5min) or NULL.
  -- Mig 352 (Seam 3): drop speed_pricing_bound_pct lookup; replace with
  -- speed_extreme_spread_coeff for quadratic widening.

  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);

  SELECT rv INTO v_iv FROM speed_realized_vol_cache
   WHERE asset = v_market.asset
     AND computed_at > NOW() - INTERVAL '5 minutes';
  IF v_iv IS NULL THEN
    SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    v_iv := COALESCE(v_iv, 0.60);
  END IF;

  v_handle_fee := p_stake * v_handle_fee_pct;

  -- ── Compute pricing ────────────────────────────────────────────────────
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );

  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- Mig 352 (Seam 3): quadratic spread widening, no rejection branch.
  -- distance = |fair - 0.5|; overage = max(0, distance - 0.45)
  -- spread = base_spread + overage² × extreme_coeff
  -- offered = fair + spread/2, then clamped to [0.01, 0.99] (existing cap).
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- ── Per-market aggregate exposure cap ──────────────────────────────────
  SELECT rate INTO v_max_exposure_pct
  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);

  v_payout_if_won := p_stake / v_offered_prob;

  IF v_is_reseller_flow THEN
    v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE
    v_pool_collateral := GREATEST(v_main_pool.speed_pool_balance, 0);
  END IF;

  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure
    FROM speed_market_exposure_live
    WHERE market_id = p_market_id
    FOR UPDATE;

    IF p_side = 'over' THEN
      v_side_worst_case := COALESCE(v_market_exposure.net_notional, 0)
                         + p_stake * 2;
    ELSE
      v_side_worst_case := -COALESCE(v_market_exposure.net_notional, 0)
                         + p_stake * 2;
    END IF;
    v_side_worst_case := GREATEST(v_side_worst_case, p_stake * 2);

    IF v_side_worst_case > v_max_exposure_pct * v_pool_collateral THEN
      RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
        USING HINT = format('worst case $%.2f vs cap $%.2f', v_side_worst_case, v_max_exposure_pct * v_pool_collateral);
    END IF;
  END IF;

  -- ── ATOMIC WRITE BLOCK ─────────────────────────────────────────────────
  -- 1. INSERT speed_positions
  INSERT INTO speed_positions (
    user_id, market_id, branch_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, v_routing_branch_id, p_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  -- 2. INSERT speed_trades
  INSERT INTO speed_trades (
    position_id, user_id, market_id, branch_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, v_routing_branch_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- 3. INSERT speed_pool_ledger (stake_in)
  IF v_is_reseller_flow THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side
    );

    v_fee_share_amount := ROUND(v_handle_fee * v_speed_branch.fee_share_pct, 2);
    IF v_fee_share_amount > 0 THEN
      v_new_pool_balance := v_new_pool_balance + v_fee_share_amount;
      INSERT INTO speed_pool_ledger (
        branch_id, market_id, type, amount, balance_after, reference_id, description
      ) VALUES (
        v_routing_branch_id, p_market_id, 'fee_share_in', v_fee_share_amount, v_new_pool_balance, v_trade_id,
        'Branch fee share — ' || ROUND(v_speed_branch.fee_share_pct * 100, 1) || '% of $' || ROUND(v_handle_fee, 4)
      );
    END IF;

    UPDATE speed_branches
    SET speed_pool_balance = v_new_pool_balance,
        updated_at = NOW()
    WHERE branch_id = v_routing_branch_id;
  ELSE
    -- Main pool: balance from sentinel (locked at top of function, race-free).
    v_new_pool_balance := v_main_pool.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side
    );
    UPDATE speed_main_pool_state
    SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE id = 1;
  END IF;

  -- 5. UPDATE users.balance_usd
  UPDATE users SET
    balance_usd = balance_usd - p_stake,
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  -- 6. INSERT transactions
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration
  );

  -- 7. Commission walk for retail/commission flow ONLY
  IF NOT v_is_reseller_flow THEN
    v_total_commissions := pay_speed_trade_commissions(v_trade_id, v_user_id, p_stake, p_market_id);
  END IF;

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
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'handle_fee', ROUND(v_handle_fee, 4),
    'flow', CASE WHEN v_is_reseller_flow THEN 'reseller' ELSE 'retail_or_commission' END,
    'commissions_paid', ROUND(v_total_commissions, 4)
  );
END;
$$;

COMMENT ON FUNCTION speed_execute_trade(UUID, TEXT, DECIMAL, TEXT) IS
'Place a speed bet. Three-flow dispatch (retail / commission-branch / reseller-branch). Mig 352 (Seams 3+4): IV from speed_realized_vol_cache (fallback fee_config.speed_iv_btc); quadratic spread widening at extreme fair-prob (no more "Market too imbalanced" reject). Mig 345 locking semantics preserved.';

-- ───────────────────────────────────────────────────────────────────────────
-- Part F — Patch speed_execute_cashout body (was last in mig 351)
-- ───────────────────────────────────────────────────────────────────────────
-- One change versus mig 351's body: IV lookup reads RV cache first, falls
-- back to fee_config.speed_iv_btc. Everything else (the cashout multiplier
-- swap from mig 351, locking, asymmetric winner/loser formula, ledger
-- semantics) is byte-for-byte identical.

CREATE OR REPLACE FUNCTION speed_execute_cashout(
  p_position_id     UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;

  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_pct               DOUBLE PRECISION;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_payout_per_dollar DECIMAL;
  v_fair_value        DECIMAL;
  v_fair_profit       DECIMAL;

  v_role              TEXT;
  v_multiplier        DECIMAL;
  v_cashout_amount    DECIMAL;

  v_existing_trade    RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_new_pool_balance  DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Idempotency check ──────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result'
      );
    END IF;
  END IF;

  -- ── Lock position + ownership check ───────────────────────────────────
  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not your position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  -- ── Lock market + status ──────────────────────────────────────────────
  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;

  -- ── Oracle freshness ───────────────────────────────────────────────────
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  -- ── Lock the right pool row (reseller branch OR main sentinel) ─────────
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches
    WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN
      RAISE EXCEPTION 'Speed branch row missing for this position';
    END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  ELSE
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN
      RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
    END IF;
  END IF;

  -- ── Compute current pricing ────────────────────────────────────────────
  -- Mig 352 (Seam 4): IV from RV cache first; fall back to fee_config.
  SELECT rv INTO v_iv FROM speed_realized_vol_cache
   WHERE asset = v_market.asset
     AND computed_at > NOW() - INTERVAL '5 minutes';
  IF v_iv IS NULL THEN
    SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    v_iv := COALESCE(v_iv, 0.60);
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_seconds_left  := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;
  v_fair_profit := v_fair_value - v_position.stake;

  -- ── Determine role + continuous multiplier (preserves mig 351) ─────────
  IF v_fair_prob_side >= v_position.entry_offered_prob THEN
    v_role := 'winner';
  ELSE
    v_role := 'loser';
  END IF;

  IF v_seconds_total > 0 THEN
    v_pct := v_seconds_left / v_seconds_total;
  ELSE
    v_pct := 0;
  END IF;

  v_multiplier := speed_cashout_multiplier(v_market.duration, v_role, v_pct);

  -- ── Cashout formula (unchanged) ────────────────────────────────────────
  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- ── ATOMIC WRITE BLOCK ─────────────────────────────────────────────────

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, branch_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- Pool ledger entry: cashout_out
  IF v_position.branch_id IS NOT NULL THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id
    );
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)'
    );
    UPDATE speed_main_pool_state
    SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE id = 1;
  END IF;

  -- Credit user balance
  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', mult ' || v_multiplier || ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2),
    'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role,
    'multiplier', v_multiplier,
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION speed_execute_cashout(UUID, TEXT) IS
'Cash out a single open speed position. Mig 352 (Seam 4): IV from speed_realized_vol_cache (fallback fee_config.speed_iv_btc). Mig 351: continuous cashout multiplier. Mig 345: main-pool sentinel locking.';

-- ============================================================================
-- ROLLBACK REFERENCE
-- ============================================================================
-- To roll back this migration cleanly, apply a follow-up migration containing:
--
--   1. Restore normal_cdf body verbatim from supabase/migrations/318_speed_rpc_helpers.sql
--      (drop the |x|>=37 clip — re-introduces 22003 underflow risk at extremes).
--
--   2. Restore speed_fair_prob_over body verbatim from
--      supabase/migrations/318_speed_rpc_helpers.sql (clip back to [0.01, 0.99]).
--
--   3. Restore speed_execute_trade body verbatim from
--      supabase/migrations/345_speed_main_pool_sentinel.sql lines 82–454.
--      (DO NOT use mig 318/340 — those are stale.)
--
--   4. Restore speed_execute_cashout body verbatim from
--      supabase/migrations/351_speed_cashout_smooth.sql lines 129–347.
--      (DO NOT use mig 345's cashout body — that's pre-mig-351 and would
--      lose the cashout multiplier swap.)
--
--   5. Drop the RV plumbing — each statement uses IF EXISTS so a partial
--      rollback won't fail:
--        DROP FUNCTION IF EXISTS speed_realized_vol(speed_asset, INTEGER);
--        DROP FUNCTION IF EXISTS speed_rv_refresh();
--        DROP FUNCTION IF EXISTS get_speed_volatility(speed_asset);
--        DROP TABLE IF EXISTS speed_realized_vol_cache;
--        SELECT cron.unschedule('speed-rv-refresh') WHERE EXISTS (...);
--
--   6. (Optional) clean up the new fee_config rows. Leaving them is harmless
--      since the restored trade RPC no longer reads them. If desired, run
--      a DELETE statement guarded with IF EXISTS-style WHERE clauses.
--
-- Master kill switches (no rollback needed):
--   - fee_config.speed_use_realized_vol = 0  → instantly disables RV
--   - fee_config.speed_markets_enabled = 0   → disables all new markets
-- ============================================================================
