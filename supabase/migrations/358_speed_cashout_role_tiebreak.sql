-- ============================================================================
-- 358_speed_cashout_role_tiebreak.sql
--
-- Cashout role tie-breaker fix: when fair_prob_side equals entry_offered_prob
-- exactly (which happens at the clipped boundary even after mig 357), the
-- previous role determination `>=` flipped to "winner" → cashout = stake +
-- 0 × multiplier = stake. Break-even round-trip violates strict invariant
-- (cashout < stake always).
--
-- Change: > instead of >= in role determination. Tie breaks toward loser,
-- whose payout = fair_value × multiplier (always less than stake when
-- fair = offered).
--
-- Caught by src/tests/db/speed-cashout-invariant.test.ts (eng-review 8A).
-- ============================================================================

-- Full body re-emitted with the single-character fix at the role check.
-- See current schema for details — this migration only changes one IF condition.

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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
  v_spread_pct          DECIMAL;
  v_extreme_coeff       DECIMAL;
  v_distance            DOUBLE PRECISION;
  v_overage             DOUBLE PRECISION;
  v_widened_spread      DOUBLE PRECISION;
  v_surcharged_offered  DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result');
    END IF;
  END IF;
  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN RAISE EXCEPTION 'Position not found'; END IF;
  IF v_position.user_id <> v_user_id THEN RAISE EXCEPTION 'Not your position'; END IF;
  IF v_position.status <> 'open' THEN RAISE EXCEPTION 'Position is not open (status: %)', v_position.status; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed; cannot cash out'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable'; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN RAISE EXCEPTION 'Speed branch row missing for this position'; END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  ELSE
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;

  v_iv := _speed_get_iv(v_market.asset);
  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_seconds_left  := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF v_position.side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);
  v_surcharged_offered := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_surcharged_offered > 0.99 THEN v_surcharged_offered := 0.99;
  ELSIF v_surcharged_offered < 0.01 THEN v_surcharged_offered := 0.01;
  END IF;

  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;

  IF v_seconds_left < 30 THEN
    v_fair_value := v_fair_value * (v_fair_prob_side / v_surcharged_offered);
  END IF;
  v_fair_profit := v_fair_value - v_position.stake;

  -- Mig 358 fix: strict > instead of >= so a tie at the clipped boundary
  -- breaks toward loser, preserving the cashout-round-trip-loses invariant.
  IF v_fair_prob_side > v_position.entry_offered_prob THEN v_role := 'winner';
  ELSE v_role := 'loser';
  END IF;
  IF v_seconds_total > 0 THEN v_pct := v_seconds_left / v_seconds_total;
  ELSE v_pct := 0;
  END IF;
  v_multiplier := speed_cashout_multiplier(v_market.duration, v_role, v_pct);

  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;
  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET status = 'cashed_out', payout_amount = v_cashout_amount, closed_at = NOW()
  WHERE id = p_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key)
  VALUES (p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_position.branch_id IS NOT NULL THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id);
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)');
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', mult ' || v_multiplier || ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')');
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'trade_id', v_trade_id, 'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2), 'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role, 'multiplier', v_multiplier, 'pct_time_left', ROUND(v_pct::NUMERIC, 4));
END;
$$;
