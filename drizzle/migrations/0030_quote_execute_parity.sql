-- 0030_quote_execute_parity.sql
--
-- Quote/execute parity: closes a class of race-window exploits where a
-- client gets a quote at price A and the server executes at price B
-- because the market state changed between quote and execute. Today the
-- only parity check is `expected_iv` (drift tolerance 10%); everything
-- else (spot price, fair_prob, offered_prob, seconds-left bucket) can
-- silently change between quote and execute.
--
-- Codex review pushback during planning: client `expected_iv` was
-- additionally being USED for pricing (`v_iv_to_use := p_expected_iv`).
-- That was removed in mig 0028 — server now ALWAYS prices with server IV.
-- Mig 0030 extends parity to all the user-visible quote fields.
--
-- New parameters on speed_execute_trade and speed_execute_cashout:
--   * p_expected_spot               — server's spot when client got quote
--   * p_expected_seconds_left_bucket — coarse bucket: 0=60s+, 1=30-60s,
--                                       2=10-30s. Exact-match required.
--   * p_expected_fair_prob          — server fair_prob at quote time
--   * p_expected_offered_prob       — server offered_prob at quote time
--
-- Cashout adds:
--   * p_expected_mark_prob
--   * p_expected_cashout_amount
--
-- All new parameters are nullable. Clients not sending them get the same
-- behavior as today (no parity check). Once /api/speed/quote ships and
-- the trade modal is wired to send them, parity is enforced for every
-- new bet.
--
-- Drift tolerances configured in fee_config — admin-tunable. Defaults:
--   * offered_prob / fair_prob / mark_prob: 2% relative drift
--   * spot: 0.1% relative drift (BTC moves fast; tighter than IV's 10%)
--   * cashout_amount: 2% relative drift
--   * seconds_left_bucket: exact match required (no tolerance)
--
-- Why bucket-not-seconds for time: clients quote a fair_prob computed
-- from the seconds-left at quote time. By the time execute fires, a few
-- hundred ms have passed. We don't want to reject for sub-second drift,
-- but we DO want to reject if the quote crossed a regime boundary (e.g.,
-- went from 60s+ to last-30s window where spread escalates 1.4x→1.8x).
-- Bucketing seconds-left into the same regimes the engine uses gives us
-- "regime stayed the same" parity without sub-second jitter false-rejects.

BEGIN;

-- ============================================================================
-- 1) Drift tolerance fee_config keys
-- ============================================================================

INSERT INTO public.fee_config (fee_type, rate, description) VALUES
  ('speed_parity_prob_drift_pct', 0.02,
    '0030: max relative drift between client expected_*_prob and server recompute. Applies to fair_prob, offered_prob, mark_prob.'),
  ('speed_parity_spot_drift_pct', 0.001,
    '0030: max relative drift between client expected_spot and server spot. BTC moves fast; tighter than prob drift.'),
  ('speed_parity_cashout_drift_pct', 0.02,
    '0030: max relative drift between client expected_cashout_amount and server recompute.')
ON CONFLICT (fee_type) DO UPDATE
  SET description = EXCLUDED.description,
      updated_at = NOW();

-- ============================================================================
-- 2) Helper: classify seconds_left into a regime bucket
-- ============================================================================
--
-- 0 = >= 60s remaining (no late-window surcharge)
-- 1 = 30s <= secs < 60s (1.4x spread mult)
-- 2 = 10s <= secs < 30s (1.8x spread mult)
-- 3 = < 10s (rejected entirely)
--
-- Used for bucket-comparison parity: client's bucket at quote time must
-- match server's bucket at execute time.

CREATE OR REPLACE FUNCTION public._speed_seconds_left_bucket(
  p_seconds_left DOUBLE PRECISION
) RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_seconds_left < 10 THEN RETURN 3;
  ELSIF p_seconds_left < 30 THEN RETURN 2;
  ELSIF p_seconds_left < 60 THEN RETURN 1;
  ELSE RETURN 0;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._speed_seconds_left_bucket(DOUBLE PRECISION) IS
  '0030: classifies seconds_left into a coarse regime bucket so parity checks survive sub-second jitter but reject regime crossings.';

GRANT EXECUTE ON FUNCTION public._speed_seconds_left_bucket(DOUBLE PRECISION) TO PUBLIC;

-- ============================================================================
-- 3) Helper: relative drift check (raises on violation)
-- ============================================================================

CREATE OR REPLACE FUNCTION public._speed_assert_parity(
  p_field    TEXT,
  p_expected NUMERIC,
  p_actual   NUMERIC,
  p_tolerance DECIMAL
) RETURNS VOID
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_drift  NUMERIC;
BEGIN
  IF p_expected IS NULL THEN
    RETURN;
  END IF;
  IF p_actual = 0 OR p_actual IS NULL THEN
    RAISE EXCEPTION 'PARITY_DRIFT [%]: actual is zero/null, expected=%', p_field, p_expected;
  END IF;
  v_drift := ABS(p_actual - p_expected) / NULLIF(ABS(p_actual), 0);
  IF v_drift > p_tolerance THEN
    RAISE EXCEPTION 'PARITY_DRIFT [%]: expected=% actual=% drift=% > tol=%',
      p_field, p_expected, p_actual, ROUND(v_drift, 6), p_tolerance
      USING HINT = 'Quote stale — refresh and retry';
  END IF;
END;
$$;

COMMENT ON FUNCTION public._speed_assert_parity(TEXT, NUMERIC, NUMERIC, DECIMAL) IS
  '0030: relative drift assertion helper. Returns silently if expected is NULL (no client snapshot) or drift within tolerance. Raises PARITY_DRIFT otherwise.';

GRANT EXECUTE ON FUNCTION public._speed_assert_parity(TEXT, NUMERIC, NUMERIC, DECIMAL) TO PUBLIC;

-- ============================================================================
-- 4) speed_execute_trade — add parity parameters
-- ============================================================================

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

  -- 0030: spot parity check (sub-second drift only, BTC moves fast).
  SELECT rate INTO v_parity_spot_tol FROM fee_config WHERE fee_type = 'speed_parity_spot_drift_pct';
  v_parity_spot_tol := COALESCE(v_parity_spot_tol, 0.001);
  PERFORM _speed_assert_parity('spot_price', p_expected_spot, v_oracle.price, v_parity_spot_tol);

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  -- 0030: seconds-left bucket parity. Exact match required.
  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND v_seconds_left_bucket <> p_expected_seconds_left_bucket THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Market regime changed between quote and execute — refresh quote';
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

  -- 0030: fair_prob parity check (server's recompute vs client's quote-time value).
  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('fair_prob', p_expected_fair_prob, v_fair_prob_side, v_parity_prob_tol);

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

  -- 0030: offered_prob parity check.
  PERFORM _speed_assert_parity('offered_prob', p_expected_offered_prob, v_offered_prob, v_parity_prob_tol);

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
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) IS
  '0030: same body as 0029 plus parity-check parameters: expected_spot, expected_seconds_left_bucket, expected_fair_prob, expected_offered_prob. NULLs skip the check (backwards-compat). Drift tolerances tunable in fee_config.';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) TO PUBLIC;

-- 0030 keeps the prior signature alive for backwards compat. Old callers
-- (trade route before mig 0030 deploys) skip parity. Drop after route is
-- migrated and a version is tagged.

-- ============================================================================
-- 5) speed_execute_cashout — add parity parameters
-- ============================================================================

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
  v_mark_prob          DECIMAL;
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

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
  END IF;

  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('mark_prob', p_expected_mark_prob, v_mark_prob, v_parity_prob_tol);

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

  -- 0030: cashout_amount parity check (final number the user agreed to take).
  SELECT rate INTO v_parity_cashout_tol FROM fee_config WHERE fee_type = 'speed_parity_cashout_drift_pct';
  v_parity_cashout_tol := COALESCE(v_parity_cashout_tol, 0.02);
  PERFORM _speed_assert_parity('cashout_amount', p_expected_cashout_amount, v_cashout_amount, v_parity_cashout_tol);

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
    'pct_time_left', ROUND(v_pct::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) IS
  '0030: same body as 0029 plus parity-check parameters: expected_spot, expected_seconds_left_bucket, expected_mark_prob, expected_cashout_amount. NULLs skip the check.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) TO PUBLIC;

COMMIT;
