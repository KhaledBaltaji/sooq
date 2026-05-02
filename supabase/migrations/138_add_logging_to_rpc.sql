-- 138_add_logging_to_rpc.sql — Add error logging to critical Postgres functions
-- Wraps the key functions with EXCEPTION handlers that log to system_logs before re-raising.
-- This catches errors that may not reach the Next.js layer (e.g., timeout, connection drop).

-- ============================================================================
-- execute_trade: wrap the entire body in an exception handler
-- We re-create the function with a top-level EXCEPTION block that logs and re-raises
-- ============================================================================
CREATE OR REPLACE FUNCTION execute_trade(
  p_market_id UUID,
  p_side TEXT,
  p_direction TEXT,
  p_amount DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_position RECORD;
  v_last_trade TIMESTAMPTZ;

  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_max_trade_pct DECIMAL;
  v_dyn_threshold DECIMAL;
  v_dyn_multiplier DECIMAL;

  v_b DECIMAL;
  v_explicit_fee DECIMAL;
  v_dynamic_spread DECIMAL := 0;
  v_net_amount DECIMAL;
  v_shares DECIMAL;
  v_current_price DECIMAL;
  v_amm_spread DECIMAL := 0;
  v_cash_out_premium DECIMAL := 0;
  v_price_per_share DECIMAL;
  v_total_cost DECIMAL;

  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_gross_proceeds DECIMAL;
  v_net_proceeds DECIMAL;

  v_shares_to_sell DECIMAL;
  v_cost_basis DECIMAL;
  v_sell_pnl DECIMAL;

  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_price_impact_warning BOOLEAN := FALSE;

  v_chain UUID[];
BEGIN
  -- ======= AUTH =======
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ======= VALIDATE INPUTS =======
  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Side must be yes or no';
  END IF;
  IF p_direction NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'Direction must be buy or sell';
  END IF;
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- ======= LOCK ORDER: users → ancestors → markets → amm_state =======
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  v_chain := v_user.referral_chain;
  IF v_chain IS NOT NULL AND array_length(v_chain, 1) > 0 THEN
    PERFORM 1 FROM users
    WHERE id = ANY(ARRAY(SELECT unnest(v_chain) ORDER BY 1))
    FOR UPDATE;
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open';
  END IF;
  IF NOW() > v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed';
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF v_amm IS NULL THEN
    RAISE EXCEPTION 'AMM not initialized for this market';
  END IF;

  -- ======= RATE LIMIT =======
  SELECT MAX(created_at) INTO v_last_trade
  FROM trades WHERE user_id = v_user_id AND market_id = p_market_id;
  IF v_last_trade IS NOT NULL AND v_last_trade > NOW() - INTERVAL '30 seconds' THEN
    RAISE EXCEPTION 'Rate limit: wait 30 seconds between trades on same market';
  END IF;

  -- ======= READ FEE RATES =======
  SELECT rate INTO v_explicit_fee_rate FROM fee_config WHERE fee_type = 'explicit_fee' LIMIT 1;
  SELECT rate INTO v_cash_out_rate FROM fee_config WHERE fee_type = 'cash_out_premium' LIMIT 1;
  SELECT rate INTO v_max_trade_pct FROM fee_config WHERE fee_type = 'amm_max_trade_pct' LIMIT 1;
  SELECT rate INTO v_dyn_threshold FROM fee_config WHERE fee_type = 'dynamic_spread_threshold' LIMIT 1;
  SELECT rate INTO v_dyn_multiplier FROM fee_config WHERE fee_type = 'dynamic_spread_multiplier' LIMIT 1;

  v_explicit_fee_rate := COALESCE(v_explicit_fee_rate, 0.005);
  v_cash_out_rate := COALESCE(v_cash_out_rate, 0.005);
  v_max_trade_pct := COALESCE(v_max_trade_pct, 0.05);
  v_dyn_threshold := COALESCE(v_dyn_threshold, 0.65);
  v_dyn_multiplier := COALESCE(v_dyn_multiplier, 1.5);

  v_b := v_amm.liquidity_param;

  -- ================================================================
  -- BUY FLOW
  -- ================================================================
  IF p_direction = 'buy' THEN

    IF v_user.balance_usd < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_explicit_fee := p_amount * v_explicit_fee_rate;
    v_net_amount := p_amount - v_explicit_fee;

    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;

    IF v_current_price > v_dyn_threshold THEN
      v_dynamic_spread := v_net_amount * (v_dyn_multiplier - 1.0) * v_explicit_fee_rate;
      v_net_amount := v_net_amount - v_dynamic_spread;
    END IF;

    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_amount);

    IF v_shares > v_max_trade_pct * v_b THEN
      RAISE EXCEPTION 'Trade too large: maximum % shares per trade', ROUND(v_max_trade_pct * v_b, 2);
    END IF;

    v_amm_spread := v_net_amount - (v_shares * v_current_price);
    IF v_amm_spread < 0 THEN
      v_amm_spread := 0;
    END IF;

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');
    v_price_per_share := v_net_amount / v_shares;
    v_total_cost := p_amount;

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount,
      total_trades = total_trades + 1
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_amount) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_amount;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_explicit_fee, v_amm_spread + v_dynamic_spread, 0)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd,
            v_trade_id, 'Buy ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, p_amount);

    UPDATE markets SET
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      total_trades = leader_stats.total_trades + 1;

  -- ================================================================
  -- SELL FLOW
  -- ================================================================
  ELSIF p_direction = 'sell' THEN

    v_shares_to_sell := p_amount;

    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
    FOR UPDATE;

    IF v_position IS NULL THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;
    IF v_position.shares_held < v_shares_to_sell THEN
      RAISE EXCEPTION 'Insufficient shares: you hold %, trying to sell %',
        ROUND(v_position.shares_held, 4), ROUND(v_shares_to_sell, 4);
    END IF;

    IF p_side = 'yes' AND v_shares_to_sell > v_amm.q_yes THEN
      RAISE EXCEPTION 'Cannot sell more shares than AMM holds on this side';
    END IF;
    IF p_side = 'no' AND v_shares_to_sell > v_amm.q_no THEN
      RAISE EXCEPTION 'Cannot sell more shares than AMM holds on this side';
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    v_explicit_fee := v_gross_proceeds * v_explicit_fee_rate;
    v_cash_out_premium := v_gross_proceeds * v_cash_out_rate;
    v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;

    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;
    v_amm_spread := (v_shares_to_sell * v_current_price) - v_gross_proceeds;
    IF v_amm_spread < 0 THEN
      v_amm_spread := 0;
    END IF;

    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_shares := v_shares_to_sell;
    v_total_cost := v_net_proceeds;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    UPDATE users SET balance_usd = balance_usd + v_net_proceeds
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds,
      total_trades = total_trades + 1
    WHERE market_id = p_market_id;

    v_cost_basis := v_position.avg_entry_price * v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - v_cost_basis;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, v_explicit_fee, v_amm_spread, v_cash_out_premium)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'cash_out', v_net_proceeds, v_user.balance_usd,
            v_trade_id, 'Sell ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, v_gross_proceeds);

    UPDATE markets SET
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      total_trades = leader_stats.total_trades + 1;

  END IF;

  -- ================================================================
  -- PRICE ALERT CHECK
  -- ================================================================
  UPDATE price_alerts SET
    is_triggered = TRUE,
    is_active = FALSE,
    triggered_at = NOW()
  WHERE market_id = p_market_id
    AND is_active = TRUE
    AND is_triggered = FALSE
    AND (
      (side = 'yes' AND direction = 'above' AND v_new_yes_price >= target_price) OR
      (side = 'yes' AND direction = 'below' AND v_new_yes_price <= target_price) OR
      (side = 'no' AND direction = 'above' AND v_new_no_price >= target_price) OR
      (side = 'no' AND direction = 'below' AND v_new_no_price <= target_price)
    );

  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
  SELECT
    pa.user_id, 'price_alert',
    'Price Alert Triggered', 'تنبيه السعر',
    pa.side || ' price reached $' || ROUND(pa.target_price, 2),
    'وصل سعر ' || pa.side || ' إلى $' || ROUND(pa.target_price, 2),
    pa.market_id
  FROM price_alerts pa
  WHERE pa.market_id = p_market_id
    AND pa.is_triggered = TRUE
    AND pa.triggered_at = NOW();

  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
  v_price_impact_warning := v_price_impact > 0.05;

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(v_shares, 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(v_total_cost, 2),
    'fee', ROUND(v_explicit_fee, 6),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact_warning', v_price_impact_warning
  );

EXCEPTION WHEN OTHERS THEN
  -- Log to system_logs before re-raising
  PERFORM log_system_event(
    'error'::log_severity,
    'pg/execute_trade',
    SQLERRM,
    jsonb_build_object(
      'user_id', v_user_id,
      'market_id', p_market_id,
      'side', p_side,
      'direction', p_direction,
      'amount', p_amount,
      'sqlstate', SQLSTATE
    )
  );
  RAISE;
END;
$$;


-- ============================================================================
-- resolve_market: add exception handler
-- ============================================================================
CREATE OR REPLACE FUNCTION resolve_market(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
  v_amm RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout DECIMAL;
  v_fee_amount DECIMAL;
  v_total_paid DECIMAL := 0;
  v_winners_paid INTEGER := 0;
  v_total_commissions DECIMAL;
  v_cash_in DECIMAL;
  v_cash_out_sells DECIMAL;
  v_seed_pnl DECIMAL;
  v_winning_positions INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;

  SELECT COUNT(*) INTO v_winning_positions
  FROM positions WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0;

  IF v_winning_positions = 0 THEN
    PERFORM _void_market_internal(p_market_id);
    RETURN jsonb_build_object(
      'success', TRUE,
      'action', 'voided',
      'reason', 'No positions on winning side'
    );
  END IF;

  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND side = p_outcome
      AND shares_held > 0
    ORDER BY user_id
  LOOP
    SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

    v_payout := v_pos.shares_held * (1.0 - v_resolution_fee_rate);
    v_fee_amount := v_pos.shares_held * v_resolution_fee_rate;

    UPDATE users SET balance_usd = balance_usd + v_payout
    WHERE id = v_pos.user_id
    RETURNING balance_usd INTO v_pos_user.balance_usd;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_pos.user_id, 'resolution_payout', v_payout,
            v_pos_user.balance_usd, p_market_id,
            'Won: ' || ROUND(v_pos.shares_held, 2) || ' shares × $' || ROUND(1.0 - v_resolution_fee_rate, 2)
            || ' (1% resolution fee applied)');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  UPDATE markets SET
    status = 'resolved',
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  v_total_commissions := settle_resolution_commissions(p_market_id);

  PERFORM record_revenue(p_market_id);

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM trades WHERE market_id = p_market_id AND direction = 'sell';

  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_paid;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  UPDATE leader_stats SET
    winning_trades = winning_trades + 1,
    accuracy_pct = CASE WHEN total_trades > 0
      THEN ROUND((winning_trades + 1)::DECIMAL / total_trades * 100, 2) ELSE 0 END
  WHERE user_id IN (
    SELECT DISTINCT user_id FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2),
    'total_commissions', ROUND(v_total_commissions, 2),
    'seed_pnl', ROUND(v_seed_pnl, 2)
  );

EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_event(
    'critical'::log_severity,
    'pg/resolve_market',
    SQLERRM,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome', p_outcome,
      'admin_id', v_user_id,
      'sqlstate', SQLSTATE
    )
  );
  RAISE;
END;
$$;
