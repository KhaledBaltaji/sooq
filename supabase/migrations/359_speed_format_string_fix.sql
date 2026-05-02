-- ============================================================================
-- 359_speed_format_string_fix.sql
--
-- Fix bug in mig 353/354/356 exposure cap RAISE EXCEPTION HINT.
-- PostgreSQL format() doesn't support C-style %.2f / %d format specifiers —
-- only %s, %I, %L. The HINT was crashing with
-- "unrecognized format() type specifier '.'" instead of returning the
-- intended "Market exposure cap reached" message.
--
-- Fix: replace format() call with string concatenation + ROUND::TEXT.
--
-- Caught by src/tests/db/speed-exposure-cap-fix.test.ts (eng-review 7
-- iron-rule regression test) — the cap was correctly engaging but the
-- error message was getting swallowed by the format-string crash.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id      UUID,
  p_side           TEXT,
  p_stake          NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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
  v_over_payout_total  DECIMAL;
  v_under_payout_total DECIMAL;
  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_fee_share_amount  DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_side NOT IN ('over', 'under') THEN RAISE EXCEPTION 'Side must be over or under'; END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN RAISE EXCEPTION 'Stake must be positive'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id, 'message', 'Duplicate trade — returning existing result');
    END IF;
  END IF;
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN RAISE EXCEPTION 'Speed markets are currently disabled'; END IF;
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Speed market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Speed market has closed'; END IF;
  IF NOW() < v_market.opens_at THEN RAISE EXCEPTION 'Speed market has not opened yet'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;
  v_signup_branch_id := v_user.signup_branch_id;
  IF v_signup_branch_id IS NULL THEN
    v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
    ELSE
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;
      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE; v_routing_branch_id := v_signup_branch_id;
        ELSE
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
      END IF;
    END IF;
  END IF;
  IF NOT v_is_reseller_flow THEN
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;
  IF v_is_reseller_flow THEN
    IF p_stake < v_speed_branch.stake_min OR p_stake > v_speed_branch.stake_max THEN
      RAISE EXCEPTION 'Stake $% outside branch limits ($% - $%)', p_stake, v_speed_branch.stake_min, v_speed_branch.stake_max;
    END IF;
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    IF p_stake < 1.00 OR p_stake > 25.00 THEN RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake; END IF;
    v_cap_for_duration := 200.00;
  END IF;
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum FROM speed_positions
  WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side AND status = 'open';
  IF v_current_side_sum + p_stake > v_cap_for_duration THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%', p_side, GREATEST(0, v_cap_for_duration - v_current_side_sum);
  END IF;
  IF v_user.balance_usd < p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_iv := _speed_get_iv(v_market.asset);
  v_handle_fee := p_stake * v_handle_fee_pct;
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF p_side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);
  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;
  SELECT rate INTO v_max_exposure_pct FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);
  v_payout_if_won := p_stake / v_offered_prob;
  IF v_is_reseller_flow THEN v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE v_pool_collateral := GREATEST(v_main_pool.speed_pool_balance, 0);
  END IF;
  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure FROM speed_market_exposure_live
    WHERE market_id = p_market_id FOR UPDATE;
    SELECT
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'over'), 0),
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'under'), 0)
    INTO v_over_payout_total, v_under_payout_total
    FROM speed_positions WHERE market_id = p_market_id AND status = 'open';
    IF p_side = 'over' THEN v_side_worst_case := v_over_payout_total + v_payout_if_won;
    ELSE v_side_worst_case := v_under_payout_total + v_payout_if_won;
    END IF;
    IF v_side_worst_case > v_max_exposure_pct * v_pool_collateral THEN
      -- Mig 359 fix: PostgreSQL format() doesn't support C-style %.2f / %d.
      -- Use string concatenation with ROUND::TEXT instead.
      RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
        USING HINT = 'payout liability $' || ROUND(v_side_worst_case, 2)::TEXT
                  || ' vs cap $' || ROUND(v_max_exposure_pct * v_pool_collateral, 2)::TEXT
                  || ' (40% of $' || ROUND(v_pool_collateral, 2)::TEXT || ' pool)';
    END IF;
  END IF;
  INSERT INTO speed_positions (user_id, market_id, branch_id, side, stake, entry_price, entry_fair_prob, entry_offered_prob, status)
  VALUES (v_user_id, p_market_id, v_routing_branch_id, p_side, p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, 'open')
  RETURNING id INTO v_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, handle_fee, idempotency_key)
  VALUES (v_position_id, v_user_id, p_market_id, v_routing_branch_id, 'open', p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_is_reseller_flow THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side);
    v_fee_share_amount := ROUND(v_handle_fee * v_speed_branch.fee_share_pct, 2);
    IF v_fee_share_amount > 0 THEN
      v_new_pool_balance := v_new_pool_balance + v_fee_share_amount;
      INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (v_routing_branch_id, p_market_id, 'fee_share_in', v_fee_share_amount, v_new_pool_balance, v_trade_id,
        'Branch fee share — ' || ROUND(v_speed_branch.fee_share_pct * 100, 1) || '% of $' || ROUND(v_handle_fee, 4));
    END IF;
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE branch_id = v_routing_branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side);
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  UPDATE users SET balance_usd = balance_usd - p_stake, updated_at = NOW()
  WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration);
  IF NOT v_is_reseller_flow THEN
    v_total_commissions := pay_speed_trade_commissions(v_trade_id, v_user_id, p_stake, p_market_id);
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'position_id', v_position_id, 'trade_id', v_trade_id,
    'side', p_side, 'stake', ROUND(p_stake, 2), 'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8), 'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6), 'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'handle_fee', ROUND(v_handle_fee, 4),
    'flow', CASE WHEN v_is_reseller_flow THEN 'reseller' ELSE 'retail_or_commission' END,
    'commissions_paid', ROUND(v_total_commissions, 4));
END;
$$;
