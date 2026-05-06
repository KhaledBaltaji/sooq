-- 0029_iv_cache_and_helper.sql
--
-- Creates the realized-volatility cache infrastructure that mig 0028
-- references but does not yet populate. The cache + helper exists today
-- only as a comment in mig 0016 ("`_speed_get_iv()` would be a helper
-- call without changing call site behavior") — never implemented. This
-- migration makes that aspirational comment real.
--
-- Why this matters: every entry in the W11/W12 test data shows
-- `iv_used = 0.6000` exactly. Real BTC sigma on 5m windows over the last
-- 24h is ~0.049% (annualized ~16%). The engine has been pricing as if
-- BTC were 60% annualized vol — 3.7x too high. Effect: BSM fair_prob
-- compresses toward 0.5 even when the outcome is essentially decided.
-- Mig 0028 added hard rejects on fair_prob > 0.97 / < 0.03 to stop the
-- exploit, but those rejects only fire when the engine COMPUTES the
-- fair_prob correctly. With IV stuck at 0.60, the engine underestimates
-- saturation and the exploit window stays open for fair_prob in the
-- 0.85–0.96 band. Fixing IV makes the existing defenses bite.
--
-- Architecture:
--   * `speed_volatility_cache` table — one row per (asset, horizon).
--     Multi-horizon: 5m, 15m, 1h, 24h. Plus an EWMA blend across
--     horizons so the BSM input adapts to volatility regime changes.
--   * `_speed_get_iv(asset, duration)` helper — reads cache, validates
--     freshness, applies floor/ceiling. Returns annualized sigma.
--     Fail-closed mode (configurable): raise if stale instead of
--     silently falling back to `fee_config.speed_iv_btc`.
--   * Trade and cashout RPCs refactored to call the helper instead of
--     reading `fee_config.speed_iv_btc` inline. The fallback path stays
--     in the helper so the system can still operate during the
--     transition period when the cache is empty (oracle worker change
--     comes after this migration ships).
--
-- Phased rollout:
--   1. Mig 0029 ships. Cache table is empty. Helper falls back to
--      `fee_config.speed_iv_btc = 0.6` for every call. SAME BEHAVIOR AS
--      BEFORE THIS MIGRATION — pricing stays broken. This phase exists
--      only to deploy the cache infrastructure with zero behavior change.
--   2. Oracle worker (services/speed-oracle/) deploys with the RV writer
--      enabled. Cache starts populating at ~1 row per asset/horizon per
--      minute. Pricing immediately uses real RV. Hard rejects from mig
--      0028 begin firing on actual late-window deep-tail entries.
--   3. After 24-48h of stable cache writes, flip `speed_iv_fail_closed`
--      to 1 in fee_config. Helper now raises EXCEPTION instead of
--      falling back when the cache is stale. Hard guarantee that
--      pricing never silently uses the 0.6 fallback in production.
--
-- Freshness:
--   * 5m horizon: <= 10s cache age (oracle writes every minute)
--   * 1h horizon: <= 30s cache age
--   * 15m / 24h: <= 60s
--
-- Floor/ceiling:
--   * Annualized IV bounded to [0.05, 2.00] (5% to 200%). BTC has never
--     run sustained sigma below 5% annualized; 200% is a sanity cap that
--     prevents a corrupt cache row from making fair_prob useless.

BEGIN;

-- ============================================================================
-- 1) speed_volatility_cache — multi-horizon RV cache
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.speed_volatility_cache (
  asset             TEXT NOT NULL,
  horizon           TEXT NOT NULL,            -- '5m' | '15m' | '1h' | '24h' | 'ewma'
  sigma_annualized  DECIMAL(8,6) NOT NULL,    -- e.g. 0.16 for 16% annualized
  sample_count      INTEGER,                  -- N return samples used in computation
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asset, horizon),
  CONSTRAINT speed_volatility_cache_horizon_chk
    CHECK (horizon IN ('5m','15m','1h','24h','ewma')),
  CONSTRAINT speed_volatility_cache_sigma_bounds_chk
    CHECK (sigma_annualized >= 0.05 AND sigma_annualized <= 2.00)
);

CREATE INDEX IF NOT EXISTS speed_volatility_cache_computed_idx
  ON public.speed_volatility_cache (computed_at DESC);

COMMENT ON TABLE public.speed_volatility_cache IS
  '0029: multi-horizon realized-volatility cache. Written by services/speed-oracle/ at ~1 row/asset/horizon/minute. Read by _speed_get_iv() inside speed_execute_trade and speed_execute_cashout. Empty cache + missing fee_config flag = fall back to speed_iv_btc.';

COMMENT ON COLUMN public.speed_volatility_cache.sigma_annualized IS
  'Realized volatility, annualized. Floor 0.05, ceiling 2.00. Out-of-range writes rejected by CHECK constraint.';

COMMENT ON COLUMN public.speed_volatility_cache.horizon IS
  'Lookback horizon: 5m (last 5 minutes of ticks), 15m, 1h, 24h, ewma (blended). Trade RPC selects horizon based on speed_market.duration.';

-- ============================================================================
-- 2) Fee config flags for IV cache behavior
-- ============================================================================

INSERT INTO public.fee_config (fee_type, rate, description) VALUES
  ('speed_iv_fail_closed', 0,
    '0029: IV fail-closed mode. 1 = raise EXCEPTION when cache is stale (Phase 3 of rollout). 0 = fall back to speed_iv_btc (Phase 1-2 transition). Flip to 1 after cache has been populating stably for 24-48h.'),
  ('speed_iv_freshness_5m_secs', 30,
    '0029: max acceptable age (seconds) of speed_volatility_cache 5m row before considered stale. Oracle writes every 5s; 30s = 6× headroom.'),
  ('speed_iv_freshness_1h_secs', 60,
    '0029: max acceptable age (seconds) of speed_volatility_cache 1h row.'),
  ('speed_iv_freshness_15m_secs', 60,
    '0029: max acceptable age (seconds) of speed_volatility_cache 15m row.'),
  ('speed_iv_freshness_24h_secs', 120,
    '0029: max acceptable age (seconds) of speed_volatility_cache 24h row.'),
  ('speed_iv_freshness_ewma_secs', 60,
    '0029: max acceptable age (seconds) of speed_volatility_cache ewma row.')
ON CONFLICT (fee_type) DO UPDATE
  SET description = EXCLUDED.description,
      updated_at = NOW();

-- ============================================================================
-- 3) _speed_get_iv() helper
-- ============================================================================
--
-- Returns the IV (annualized sigma) to use for the given asset + duration.
-- Selection logic:
--   * speed_market.duration='5m' → cache horizon='5m'
--   * speed_market.duration='1h' → cache horizon='1h'
--   * Future durations map to nearest available horizon.
--
-- Behavior matrix:
--                            | cache_fresh | cache_stale | cache_empty
--   speed_iv_fail_closed=0    | use cache  | use cache  | fall back to speed_iv_btc
--   speed_iv_fail_closed=1    | use cache  | RAISE      | RAISE
--
-- Phase 1 (this migration): speed_iv_fail_closed=0 by default. Cache is
-- empty, so behavior matches pre-0029 (returns 0.6 from fee_config).
-- Phase 3 (post-launch): operator flips speed_iv_fail_closed=1.

CREATE OR REPLACE FUNCTION public._speed_get_iv(
  p_asset    TEXT,
  p_duration public.speed_duration
) RETURNS DECIMAL
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_horizon         TEXT;
  v_cache_row       RECORD;
  v_cache_age_secs  DOUBLE PRECISION;
  v_freshness_secs  DECIMAL;
  v_fail_closed     DECIMAL;
  v_fallback        DECIMAL;
BEGIN
  -- Map duration to cache horizon. 5m and 1h map directly. Future
  -- durations (e.g., 15m if reactivated) need to be added here.
  v_horizon := p_duration::TEXT;
  IF v_horizon NOT IN ('5m','1h','15m','24h') THEN
    RAISE EXCEPTION 'No volatility horizon mapping for duration %', p_duration;
  END IF;

  SELECT * INTO v_cache_row
  FROM speed_volatility_cache
  WHERE asset = p_asset AND horizon = v_horizon;

  -- Read fail-closed flag once.
  SELECT rate INTO v_fail_closed
  FROM fee_config WHERE fee_type = 'speed_iv_fail_closed';
  v_fail_closed := COALESCE(v_fail_closed, 0);

  IF v_cache_row IS NOT NULL THEN
    v_cache_age_secs := EXTRACT(EPOCH FROM (NOW() - v_cache_row.computed_at));

    SELECT rate INTO v_freshness_secs
    FROM fee_config
    WHERE fee_type = 'speed_iv_freshness_' || v_horizon || '_secs';
    v_freshness_secs := COALESCE(v_freshness_secs, 60);

    IF v_cache_age_secs <= v_freshness_secs THEN
      -- Fresh cache hit — primary path.
      RETURN v_cache_row.sigma_annualized;
    END IF;

    -- Stale cache.
    IF v_fail_closed > 0 THEN
      RAISE EXCEPTION 'IV cache stale for % %: % seconds old (max %s)',
        p_asset, v_horizon, ROUND(v_cache_age_secs::NUMERIC, 1), v_freshness_secs
        USING HINT = 'Oracle worker may be down. Check /api/health/oracle.';
    END IF;
    -- Fall through to fallback below.
  ELSIF v_fail_closed > 0 THEN
    RAISE EXCEPTION 'IV cache empty for % % and fail-closed mode is on',
      p_asset, v_horizon
      USING HINT = 'Oracle worker has not yet populated cache. Check services/speed-oracle/.';
  END IF;

  -- Fallback path. Used when cache is empty/stale AND fail-closed is OFF.
  -- This is the same behavior as pre-0029. After mig 0029 ships and the
  -- oracle worker is updated, the cache populates and this fallback only
  -- fires on misconfiguration or oracle outage.
  SELECT rate INTO v_fallback
  FROM fee_config WHERE fee_type = 'speed_iv_btc';

  IF v_fallback IS NULL THEN
    RAISE EXCEPTION 'IV fallback unavailable: speed_iv_btc not in fee_config';
  END IF;

  RETURN v_fallback;
END;
$$;

COMMENT ON FUNCTION public._speed_get_iv(TEXT, public.speed_duration) IS
  '0029: returns annualized realized volatility from speed_volatility_cache. Fail-closed mode controlled by fee_config.speed_iv_fail_closed (0=fallback to speed_iv_btc, 1=raise on stale/empty).';

GRANT EXECUTE ON FUNCTION public._speed_get_iv(TEXT, public.speed_duration) TO PUBLIC;

-- ============================================================================
-- 4) Refactor speed_execute_trade to call the helper
-- ============================================================================
--
-- Body diff vs mig 0028:
--   * Replace inline `SELECT rate INTO v_iv FROM fee_config WHERE
--     fee_type = 'speed_iv_btc'` + `v_iv := COALESCE(v_iv, 0.60)` with
--     a single call to `_speed_get_iv(asset, duration)`.
--   * Everything else identical.

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id       UUID,
  p_side            TEXT,
  p_stake           NUMERIC,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
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

  v_stake_min          DECIMAL := 1.00;
  v_stake_max          DECIMAL;
  v_cap_per_side       DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_fair_prob_side     DECIMAL;
  v_distance           DOUBLE PRECISION;
  v_overage            DOUBLE PRECISION;
  v_widened_spread     DOUBLE PRECISION;
  v_spread_mult        DOUBLE PRECISION;
  v_offered_prob       DECIMAL;

  v_seconds_left       DOUBLE PRECISION;
  v_payout_if_won      DECIMAL;

  v_user_market_sum    DECIMAL;
  v_user_daily_sum     DECIMAL;
  v_side_payout_sum    DECIMAL;
  v_cluster_payout_sum DECIMAL;
  v_strike_lo          DECIMAL;
  v_strike_hi          DECIMAL;

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

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  v_stake_max := _speed_get_stake_max(v_market.duration);
  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)', p_stake, v_stake_min, v_stake_max;
  END IF;

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

  SELECT circuit_tripped_at INTO v_circuit_tripped
  FROM speed_daily_ngr WHERE ngr_date = _speed_utc_today();
  IF v_circuit_tripped IS NOT NULL THEN
    RAISE EXCEPTION 'Daily limit reached, try again tomorrow';
  END IF;

  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── PRICING ─────────────────────────────────────────────────────────
  SELECT rate INTO v_spread_pct    FROM fee_config WHERE fee_type = 'speed_spread_pct';
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff';
  v_spread_pct    := COALESCE(v_spread_pct, 0.05);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);

  -- 0029: IV from cache with fallback (or fail-closed if configured).
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

  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_mult FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult';
    v_spread_mult := COALESCE(v_late_30s_mult, 1.80);
  ELSIF v_seconds_left < 60 THEN
    SELECT rate INTO v_late_60s_mult FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult';
    v_spread_mult := COALESCE(v_late_60s_mult, 1.40);
  ELSE
    v_spread_mult := 1.0;
  END IF;
  v_widened_spread := v_widened_spread * v_spread_mult;

  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob < 0.01 THEN v_offered_prob := 0.01; END IF;
  IF v_offered_prob > 0.99 THEN
    RAISE EXCEPTION 'Trade rejected: pricing saturated (offered_prob=% would exceed 0.99 cap)', ROUND(v_offered_prob, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;

  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);

  v_payout_if_won := p_stake / v_offered_prob;

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
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'iv_used', ROUND(v_iv, 6),
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL) IS
  '0029: same body as 0028 except IV is read from speed_volatility_cache via _speed_get_iv() helper instead of inline fee_config read. Behavior unchanged when cache is empty (helper falls back). Pricing improves automatically when oracle worker populates cache.';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL) TO PUBLIC;

-- ============================================================================
-- 5) Refactor speed_execute_cashout to call the helper
-- ============================================================================
--
-- Same diff: replace inline `SELECT rate ... speed_iv_btc` with a single
-- `_speed_get_iv()` call. Rest of body identical to mig 0028.

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id     UUID,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
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
  v_pct                DOUBLE PRECISION;
  v_late_reject_s      DECIMAL;
  v_late_30s_imbalance DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_mark_prob          DECIMAL;
  v_is_winning         BOOLEAN;
  v_fair_profit        NUMERIC;
  v_margin             DOUBLE PRECISION;
  v_cashout_amount     NUMERIC;

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

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  -- 0029: IV from helper (was: inline read of fee_config.speed_iv_btc).
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

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
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

  -- 0028 fix (Codex review): direction-matching after cents rounding.
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
    'is_winning', v_is_winning,
    'margin_applied', ROUND(v_margin::NUMERIC, 6),
    'fair_profit', ROUND(v_fair_profit, 4),
    'iv_used', ROUND(v_iv, 6),
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) IS
  '0029: same body as 0028 except IV is read from speed_volatility_cache via _speed_get_iv() helper. Direction-matching invariant intact.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) TO PUBLIC;

COMMIT;
