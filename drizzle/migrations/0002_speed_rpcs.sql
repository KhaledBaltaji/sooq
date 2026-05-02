-- ============================================================================
-- 0002_speed_rpcs.sql
--
-- Speed mode RPCs + math helpers + app.user_id() GUC helper. Bundled so a
-- single drizzle-kit migrate gets the speed flow operational on RDS.
--
-- Sources (consolidated from the original supabase/migrations/ stripped tree):
--   - normal_cdf, speed_fair_prob_over, speed_time_bucket  ← mig 318 + 357
--   - app schema + app.user_id()                            ← mig 367
--   - speed_execute_trade, speed_execute_cashout,
--     speed_resolve_market (retail-only, app.user_id())     ← mig 368 (W6 swap of W4 366)
-- ============================================================================

set check_function_bodies = off;

-- ── app schema + app.user_id() helper ──────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

GRANT USAGE ON SCHEMA app TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.user_id() TO PUBLIC;

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
CREATE OR REPLACE FUNCTION public.speed_fair_prob_over(
  p_spot DECIMAL,
  p_strike DECIMAL,
  p_seconds_left DOUBLE PRECISION,
  p_iv DECIMAL
) RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_seconds_left DOUBLE PRECISION;
  v_years_left   DOUBLE PRECISION;
  v_sigma_sqrt_t DOUBLE PRECISION;
  v_d2           DOUBLE PRECISION;
  v_iv_dbl       DOUBLE PRECISION;
  v_fair         DOUBLE PRECISION;
BEGIN
  v_seconds_left := GREATEST(p_seconds_left, 1.0);
  v_years_left := v_seconds_left / (365.0 * 24.0 * 3600.0);
  v_iv_dbl := p_iv::DOUBLE PRECISION;
  v_sigma_sqrt_t := v_iv_dbl * SQRT(v_years_left);

  IF v_sigma_sqrt_t = 0 THEN
    RETURN CASE WHEN p_spot > p_strike THEN 0.99 ELSE 0.01 END;
  END IF;

  v_d2 := (LN(p_spot::DOUBLE PRECISION / p_strike::DOUBLE PRECISION)
           - (v_iv_dbl * v_iv_dbl * v_years_left) / 2.0) / v_sigma_sqrt_t;
  v_fair := normal_cdf(v_d2);

  -- Mig 357: tightened clip from Seam 2's [0.001, 0.999] to [0.01, 0.99]
  -- to ensure fair < offered (cap 0.99) at extremes.
  RETURN GREATEST(0.01, LEAST(0.99, v_fair))::DECIMAL;
END;
$$;
CREATE OR REPLACE FUNCTION speed_time_bucket(
  p_seconds_total DOUBLE PRECISION,
  p_seconds_left  DOUBLE PRECISION
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v_pct DOUBLE PRECISION;
BEGIN
  IF p_seconds_total <= 0 THEN RETURN 'low'; END IF;
  v_pct := p_seconds_left / p_seconds_total;
  IF v_pct >= 0.6 THEN RETURN 'high';
  ELSIF v_pct >= 0.2 THEN RETURN 'mid';
  ELSE RETURN 'low';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id uuid,
  p_side text,
  p_stake numeric,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id           UUID;
  v_user              RECORD;
  v_market            RECORD;
  v_oracle            RECORD;

  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;

  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_seconds_left      DOUBLE PRECISION;

  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_per_side      DECIMAL := 200.00;     -- hardcoded retail cap
  v_stake_min         DECIMAL := 1.00;
  v_stake_max         DECIMAL := 25.00;

  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
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

  -- Idempotency
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

  -- Master kill switch
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  -- Lock user
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- Lock market
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

  -- Oracle freshness
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  -- Stake range (retail hardcoded)
  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)',
      p_stake, v_stake_min, v_stake_max;
  END IF;

  -- Per-side cap
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side
    AND status = 'open';
  IF v_current_side_sum + p_stake > v_cap_per_side THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_per_side - v_current_side_sum);
  END IF;

  -- Balance check
  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Pricing
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct     FROM fee_config WHERE fee_type = 'speed_spread_pct'     LIMIT 1;
  SELECT rate INTO v_iv             FROM fee_config WHERE fee_type = 'speed_iv_btc'         LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct     := COALESCE(v_spread_pct, 0.04);
  v_iv             := COALESCE(v_iv, 0.60);

  v_handle_fee := p_stake * v_handle_fee_pct;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  v_offered_prob := v_fair_prob_side + v_spread_pct / 2.0;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- Atomic write block
  INSERT INTO speed_positions (
    user_id, market_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, p_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key
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
    'handle_fee', ROUND(v_handle_fee, 4)
  );
END;
$function$;

-- ============================================================================
-- 3) speed_execute_cashout — retail-only
-- ============================================================================
CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;

  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_payout_per_dollar DECIMAL;
  v_fair_value        DECIMAL;
  v_fair_profit       DECIMAL;

  v_bucket            TEXT;
  v_role              TEXT;
  v_multiplier_key    TEXT;
  v_multiplier        DECIMAL;
  v_cashout_amount    DECIMAL;

  v_existing_trade    RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result'
      );
    END IF;
  END IF;

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

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
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

  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  v_iv := COALESCE(v_iv, 0.60);

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

  v_bucket := speed_time_bucket(v_seconds_total, v_seconds_left);
  IF v_fair_prob_side >= v_position.entry_offered_prob THEN
    v_role := 'winner';
  ELSE
    v_role := 'loser';
  END IF;
  v_multiplier_key := 'speed_cashout_' || v_market.duration::TEXT || '_' || v_role || '_' || v_bucket;

  SELECT rate INTO v_multiplier FROM fee_config WHERE fee_type = v_multiplier_key LIMIT 1;
  IF v_multiplier IS NULL THEN
    RAISE EXCEPTION 'Cashout multiplier not configured: %', v_multiplier_key;
  END IF;

  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', ' || v_bucket || ', mult ' || v_multiplier || ')'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2),
    'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role,
    'bucket', v_bucket,
    'multiplier', v_multiplier,
    'pct_time_left', ROUND((v_seconds_left / v_seconds_total)::NUMERIC, 4)
  );
END;
$function$;

-- ============================================================================
-- 4) speed_resolve_market — retail-only
-- ============================================================================
CREATE OR REPLACE FUNCTION public.speed_resolve_market(p_market_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lock_acquired   BOOLEAN;
  v_market          RECORD;
  v_twap            DECIMAL;
  v_tick_count      INTEGER;
  v_window_start    TIMESTAMPTZ;
  v_window_end      TIMESTAMPTZ;
  v_outcome         speed_market_outcome;
  v_pos             RECORD;
  v_payout          DECIMAL;
  v_winners         INTEGER := 0;
  v_losers          INTEGER := 0;
  v_total_paid      DECIMAL := 0;
  v_existing        RECORD;
  v_new_balance     DECIMAL;
  v_voided          BOOLEAN := FALSE;
  v_void_reason     TEXT;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('skipped', TRUE, 'reason', 'Another invocation is already resolving this market');
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'resolving') THEN
    RETURN jsonb_build_object('skipped', TRUE, 'status', v_market.status, 'reason', 'Market not in resolvable state');
  END IF;
  IF NOW() < v_market.closes_at THEN
    RAISE EXCEPTION 'Market has not closed yet';
  END IF;

  UPDATE speed_markets SET status = 'resolving', updated_at = NOW()
  WHERE id = p_market_id AND status = 'open';

  -- TWAP
  v_window_start := v_market.closes_at - INTERVAL '30 seconds';
  v_window_end   := v_market.closes_at;
  SELECT AVG(price)::DECIMAL, COUNT(*)
  INTO v_twap, v_tick_count
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset AND ts >= v_window_start AND ts <= v_window_end;

  IF v_tick_count IS NULL OR v_tick_count = 0 THEN
    v_voided := TRUE;
    v_void_reason := 'No oracle ticks available in TWAP window';
  END IF;

  -- Void path: refund all
  IF v_voided THEN
    FOR v_pos IN
      SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open'
    LOOP
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;

      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
              'Speed market voided — full refund');

      UPDATE speed_positions SET status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      INSERT INTO speed_settlements (position_id, market_id, user_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, 'at_strike', v_pos.stake);
    END LOOP;

    UPDATE speed_markets SET status = 'voided', updated_at = NOW(), resolved_at = NOW(),
                            twap_at_close = NULL, void_reason = v_void_reason
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'success', TRUE, 'voided', TRUE, 'reason', v_void_reason,
      'refunded', v_winners + v_losers
    );
  END IF;

  -- Determine outcome from TWAP
  IF v_twap > v_market.strike_price THEN
    v_outcome := 'over';
  ELSIF v_twap < v_market.strike_price THEN
    v_outcome := 'under';
  ELSE
    v_outcome := 'at_strike';
  END IF;

  -- Settle each position
  FOR v_pos IN
    SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open'
  LOOP
    SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
    IF FOUND THEN CONTINUE; END IF;

    IF v_outcome = 'at_strike' THEN
      -- push: refund stake
      v_payout := v_pos.stake;
      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_payout, v_new_balance, v_pos.id,
              'Speed market settled at strike — push refund');

      UPDATE speed_positions SET status = 'refunded', payout_amount = v_payout, closed_at = NOW()
      WHERE id = v_pos.id;
    ELSIF v_pos.side = v_outcome::TEXT THEN
      -- winner: payout = stake / entry_offered_prob
      v_payout := ROUND(v_pos.stake / v_pos.entry_offered_prob, 2);
      v_winners := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;

      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_payout', v_payout, v_new_balance, v_pos.id,
              'Speed payout (' || v_pos.side || ')');

      UPDATE speed_positions SET status = 'won', payout_amount = v_payout, closed_at = NOW()
      WHERE id = v_pos.id;
    ELSE
      -- loser: zero payout, position closed
      v_losers := v_losers + 1;
      v_payout := 0;
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;
    END IF;

    INSERT INTO speed_settlements (position_id, market_id, user_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_outcome, v_payout);
  END LOOP;

  UPDATE speed_markets SET status = 'resolved', updated_at = NOW(), resolved_at = NOW(),
                          twap_at_close = v_twap, outcome = v_outcome
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'voided', FALSE, 'outcome', v_outcome,
    'twap', ROUND(v_twap, 8), 'strike', ROUND(v_market.strike_price, 8),
    'winners', v_winners, 'losers', v_losers, 'total_paid', ROUND(v_total_paid, 2)
  );
END;
$function$;
