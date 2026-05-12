-- Mig 0061 Phase 5: speed_execute_trade — gates wrapped in speed_use_new_curve flag.
--
-- Changes vs mig 0034 body (all gated by fee_config.speed_use_new_curve):
--   1. Parity bucket check: ±1 tolerance instead of strict equality. ALWAYS ON.
--      Kills the 30s/60s cliff that rejected legitimate 1-2s click latency.
--   2. Hard reject fair > reject_high: SKIPPED when flag = 1.
--   3. Hard reject fair < reject_low:  SKIPPED when flag = 1.
--   4. Last-30s near-decided block: converted to sticky on 5m only when
--      flag = 1. The first qualifying tap in the window sets
--      speed_markets.late_block_fired = TRUE (atomic via the FOR UPDATE
--      taken on v_market earlier in the function). Subsequent attempts
--      read the flag and reject without recomputing |fair - 0.5|.
--   5. Soft-block exception: SKIPPED when flag = 1. The curve in
--      _speed_pricing_apply will not produce a soft_blocked=true value
--      under flag=1 anyway, but the explicit IF is defensive.
--
-- Unchanged: idempotency, account/balance/market checks, oracle staleness,
-- IV drift, spot parity, fair-prob parity, cap-per-side, daily wager cap,
-- NGR circuit breakers, dynamic stake max, payout cap, market exposure,
-- strike cluster, position insert, trade insert, balance update,
-- transactions log, CLV shading.

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id uuid,
  p_side text,
  p_stake numeric,
  p_idempotency_key text DEFAULT NULL::text,
  p_expected_iv numeric DEFAULT NULL::numeric,
  p_expected_spot numeric DEFAULT NULL::numeric,
  p_expected_seconds_left_bucket integer DEFAULT NULL::integer,
  p_expected_fair_prob numeric DEFAULT NULL::numeric,
  p_expected_offered_prob numeric DEFAULT NULL::numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id            UUID;
  v_user               RECORD;
  v_market             RECORD;
  v_oracle             RECORD;
  v_existing_dup       RECORD;
  v_mc                 speed_market_config%ROWTYPE;

  v_master_enabled     DECIMAL;
  v_use_new_curve      DECIMAL;   -- 0061 Phase 5: pricing curve flag
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
  v_offered_pre_shade  DECIMAL;
  v_shading_applied    BOOLEAN := FALSE;
  v_soft_block_thresh  DECIMAL;
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

  -- 0061 Phase 5: read pricing curve flag once at RPC entry. Default 0
  -- means: keep all legacy gates active (soft-block, hard reject, etc).
  SELECT rate INTO v_use_new_curve FROM fee_config WHERE fee_type = 'speed_use_new_curve' LIMIT 1;
  v_use_new_curve := COALESCE(v_use_new_curve, 0);

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- FOR UPDATE on the market row gives us atomic guard for the sticky
  -- last_block_fired write below (silent failure #9 mitigation).
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
  IF v_market.duration::TEXT NOT IN ('5m','1h','1m') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;
  IF v_market.strike_price IS NULL THEN
    RAISE EXCEPTION 'Speed market strike not yet finalized';
  END IF;

  -- 0061 Phase 5: sticky 30s gate (5m markets only). If a prior tap in
  -- the last 30s already set late_block_fired, reject without recomputing.
  -- This branch is flag-gated; when flag=0, late_block_fired stays FALSE
  -- forever (no writes happen below) so this read is a harmless no-op.
  IF v_use_new_curve = 1
     AND v_market.duration::TEXT = '5m'
     AND v_market.late_block_fired = TRUE THEN
    RAISE EXCEPTION 'Round near-decided — closed for the rest of this round'
      USING HINT = 'Wait for the next round';
  END IF;

  SELECT * INTO v_mc FROM speed_market_config
  WHERE asset = v_market.asset AND duration = v_market.duration;

  SELECT oracle_stale_seconds INTO v_oracle_stale_secs FROM speed_asset_config WHERE asset = v_market.asset;
  IF v_oracle_stale_secs IS NULL THEN
    SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  END IF;
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
  v_late_reject_s := COALESCE(v_mc.last_n_reject_secs::DECIMAL, v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  -- 0061 Phase 5: parity bucket tolerance ±1 (always on, flag-independent).
  -- Replaces strict equality (mig 0030) that rejected legitimate clicks
  -- near the 30s/60s cliff. A click latency of 1-2s can legitimately push
  -- bucket 1 → 2 or 2 → 3; we accept that. Drift of 2+ buckets is still
  -- real drift and gets rejected.
  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND ABS(v_seconds_left_bucket - p_expected_seconds_left_bucket) > 1 THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=% (drift > 1 bucket)',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Market regime changed substantially between quote and execute — refresh quote';
  END IF;

  SELECT rate INTO v_cap_per_side FROM fee_config WHERE fee_type = 'speed_cap_per_side_usd' LIMIT 1;
  v_cap_per_side := COALESCE(v_mc.cap_per_side_usd, v_cap_per_side, 200);
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

  SELECT spread_pct INTO v_spread_pct
  FROM speed_market_config
  WHERE asset = v_market.asset AND duration = v_market.duration AND enabled = TRUE;
  IF v_spread_pct IS NULL THEN
    SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct';
  END IF;
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

  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('fair_prob', p_expected_fair_prob, v_fair_prob_side, v_parity_prob_tol);

  -- 0061 Phase 5: hard rejects gated by flag. Under new curve the price
  -- itself produces negative EV at these extremes — no gate needed.
  IF v_use_new_curve = 0 THEN
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
  END IF;

  -- 0061 Phase 5: last-30s near-decided block.
  --   Flag=0: legacy behavior — raise exception EVERY tap in the window
  --           if |fair - 0.5| > threshold. Causes flicker.
  --   Flag=1: sticky behavior on 5m only. First qualifying tap in the
  --           30s window sets speed_markets.late_block_fired = TRUE
  --           and rejects. All later taps see the flag and reject
  --           without recomputing — both sides stay closed.
  --   1m markets always exempt (founder decision — 1m is exploit-
  --           resistant; 3-second hard close is enough).
  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_mc.near_decided_dist, v_late_30s_imbalance, 0.30);
    IF ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      IF v_use_new_curve = 1 AND v_market.duration::TEXT = '5m' THEN
        -- Set sticky flag under the FOR UPDATE lock from earlier. Atomic
        -- relative to concurrent trade attempts (silent failure #9).
        UPDATE speed_markets
           SET late_block_fired = TRUE
         WHERE id = p_market_id AND late_block_fired = FALSE;
        RAISE EXCEPTION 'Round near-decided — closed for the rest of this round'
          USING HINT = format(
            'fair_prob=%s, secs_left=%s. Sticky block active.',
            ROUND(v_fair_prob_side, 4), ROUND(v_seconds_left::NUMERIC, 1)
          );
      ELSIF v_use_new_curve = 0 THEN
        -- Legacy: raise every tap (no sticky).
        RAISE EXCEPTION 'Trade rejected: too late and too one-sided (fair_prob=%, secs_left=%)',
          ROUND(v_fair_prob_side, 4), ROUND(v_seconds_left::NUMERIC, 1)
          USING HINT = 'Place this bet earlier in the market';
      END IF;
      -- Else: flag=1 AND duration != '5m' (i.e. 1m): no block. Fall through.
    END IF;
  END IF;

  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_mult FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult';
    v_spread_mult := COALESCE(v_mc.late_window_30s_mult::DOUBLE PRECISION, v_late_30s_mult::DOUBLE PRECISION, 1.40);
  ELSIF v_seconds_left < 60 THEN
    SELECT rate INTO v_late_60s_mult FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult';
    v_spread_mult := COALESCE(v_mc.late_window_60s_mult::DOUBLE PRECISION, v_late_60s_mult::DOUBLE PRECISION, 1.20);
  ELSE
    v_spread_mult := 1.0;
  END IF;
  v_widened_spread := v_widened_spread * v_spread_mult;

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

  -- 0061 Phase 5: soft-block exception gated. Under new curve,
  -- _speed_pricing_apply returns soft_blocked=false unconditionally, so
  -- this branch never fires. We keep the IF as a defensive guard.
  IF v_use_new_curve = 0 AND v_pricing.soft_blocked THEN
    RAISE EXCEPTION 'SOFT_BLOCK: market closing — try next round in a moment'
      USING HINT = format('offered_prob=%s exceeds soft_block_threshold', ROUND(v_offered_prob, 4));
  END IF;

  IF v_offered_prob < 0.01 THEN v_offered_prob := 0.01; END IF;
  IF v_offered_prob > 0.99 THEN
    RAISE EXCEPTION 'Trade rejected: pricing saturated (offered_prob=% would exceed 0.99 cap)', ROUND(v_offered_prob, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;

  -- ── 0044 Sprint 2: per-user CLV shading (LAST pricing layer) ───────────
  -- Unchanged from prior. Under new curve, the curve is layer N and
  -- shading is layer N+1, so the Rami-style exploit defense order holds.
  v_offered_pre_shade := v_offered_prob;
  SELECT rate INTO v_soft_block_thresh FROM fee_config WHERE fee_type = 'speed_entry_soft_block_threshold' LIMIT 1;
  v_soft_block_thresh := COALESCE(v_soft_block_thresh, 0.95);

  v_offered_prob := _speed_apply_user_shading(
    v_user_id,
    v_offered_prob::DOUBLE PRECISION,
    v_soft_block_thresh::DOUBLE PRECISION
  )::DECIMAL;

  IF v_offered_prob > v_offered_pre_shade THEN
    v_shading_applied := TRUE;
  END IF;

  IF NOT (v_pricing.matrix_used AND v_pricing.mark_prob > v_fair_prob_side::DOUBLE PRECISION)
     AND NOT v_shading_applied THEN
    PERFORM _speed_assert_parity('offered_prob', p_expected_offered_prob, v_offered_prob, v_parity_prob_tol);
  END IF;

  v_stake_max_dyn := _speed_max_stake_for_offered(v_market.asset, v_market.duration, v_offered_prob::DOUBLE PRECISION);
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

  v_payout_if_won := p_stake / v_offered_prob;
  IF v_mc.payout_max_usd IS NOT NULL THEN
    v_payout_cap := v_mc.payout_max_usd;
  ELSIF v_market.asset = 'GOLD' AND v_market.duration::TEXT = '1m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_gold_1m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 50);
  ELSIF v_market.asset = 'GOLD' AND v_market.duration::TEXT = '5m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_gold_5m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 250);
  ELSIF v_market.duration::TEXT = '1m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_1m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 250);
  ELSIF v_market.duration::TEXT = '5m' THEN
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

  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_mc.per_side_pool_pct, v_max_side_pct, 0.25);

  SELECT COALESCE(SUM(stake / entry_offered_prob), 0) INTO v_side_payout_sum
  FROM speed_positions
  WHERE market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open'
    AND entry_offered_prob IS NOT NULL
    AND entry_offered_prob > 0;

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
    AND m.strike_price BETWEEN v_strike_lo AND v_strike_hi
    AND p.entry_offered_prob IS NOT NULL
    AND p.entry_offered_prob > 0;

  IF v_cluster_payout_sum + v_payout_if_won > v_max_cluster_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Strike cluster exposure cap reached on % side', p_side
      USING HINT = format('cluster liability $%.2f vs cap $%.2f',
        v_cluster_payout_sum + v_payout_if_won, v_max_cluster_pct * v_pool_collateral);
  END IF;

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
    'offered_pre_shade', ROUND(v_offered_pre_shade, 6),
    'shading_applied', v_shading_applied,
    'shading_delta', ROUND((v_offered_prob - v_offered_pre_shade)::NUMERIC, 6),
    'mark_prob', ROUND(v_pricing.mark_prob::NUMERIC, 6),
    'matrix_used', v_pricing.matrix_used,
    'matrix_version', v_pricing.matrix_version,
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'iv_used', ROUND(v_iv, 6),
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$function$;

COMMENT ON FUNCTION public.speed_execute_trade(uuid, text, numeric, text, numeric, numeric, integer, numeric, numeric) IS
  $$0061 Phase 5: pricing curve flag (speed_use_new_curve) gates soft-block exception, hard rejects at fair > 0.97 / < 0.03, and the legacy last-30s near-decided block. Under flag=1, last-30s on 5m is sticky via speed_markets.late_block_fired (FOR UPDATE atomic). Parity bucket tolerance widened to ±1 always. Default flag=0 preserves prior behavior.$$;

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(uuid, text, numeric, text, numeric, numeric, integer, numeric, numeric) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.speed_execute_trade(uuid, text, numeric, text, numeric, numeric, integer, numeric, numeric) TO sooqadmin;
