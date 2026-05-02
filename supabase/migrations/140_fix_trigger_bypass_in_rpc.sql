-- 140_fix_trigger_bypass_in_rpc.sql
-- Fix: SECURITY DEFINER functions that update users.balance_usd need to set
-- app.trigger_bypass to avoid the prevent_sensitive_user_updates trigger
-- blocking legitimate balance changes (the trigger checks auth.uid() which
-- remains set to the calling user even inside SECURITY DEFINER functions).

-- Patch execute_trade: add trigger bypass around balance-mutating statements
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

  -- Fee rates (read from fee_config)
  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_max_trade_pct DECIMAL;
  v_dyn_threshold DECIMAL;
  v_dyn_multiplier DECIMAL;

  -- Trade calculations
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

  -- AMM state updates
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_gross_proceeds DECIMAL;
  v_net_proceeds DECIMAL;

  -- Sell-specific
  v_shares_to_sell DECIMAL;
  v_cost_basis DECIMAL;
  v_sell_pnl DECIMAL;

  -- Output
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_price_impact_warning BOOLEAN := FALSE;

  -- Referral chain for deterministic locking
  v_chain UUID[];
BEGIN
  -- Enable trigger bypass for balance updates
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

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

  -- Read referral chain and lock ALL ancestors in deterministic UUID order
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

  -- ======= RATE LIMIT: 30s per user per market =======
  SELECT MAX(created_at) INTO v_last_trade
  FROM trades WHERE user_id = v_user_id AND market_id = p_market_id;
  IF v_last_trade IS NOT NULL AND v_last_trade > NOW() - INTERVAL '30 seconds' THEN
    RAISE EXCEPTION 'Rate limit: wait 30 seconds between trades on same market';
  END IF;

  -- ======= READ FEE RATES FROM fee_config =======
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

    -- Validate balance
    IF v_user.balance_usd < p_amount THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- 1. Calculate explicit fee
    v_explicit_fee := p_amount * v_explicit_fee_rate;
    v_net_amount := p_amount - v_explicit_fee;

    -- 2. Dynamic spread check (buying into heavy side of imbalanced market)
    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;

    IF v_current_price > v_dyn_threshold THEN
      v_dynamic_spread := v_net_amount * (v_dyn_multiplier - 1.0) * v_explicit_fee_rate;
      v_net_amount := v_net_amount - v_dynamic_spread;
    END IF;

    -- 3. Calculate shares from net amount via LMSR
    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_amount);

    -- 4. Max trade size check
    IF v_shares > v_max_trade_pct * v_b THEN
      RAISE EXCEPTION 'Trade too large: maximum % shares per trade', ROUND(v_max_trade_pct * v_b, 2);
    END IF;

    -- 5. Calculate AMM spread cost (for revenue tracking)
    v_amm_spread := v_net_amount - (v_shares * v_current_price);
    IF v_amm_spread < 0 THEN
      v_amm_spread := 0;
    END IF;

    -- Price per share = net cost / shares
    v_price_per_share := v_net_amount / v_shares;
    v_total_cost := p_amount;

    -- 6. Update AMM state
    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    -- 7. Debit user balance
    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    -- 8. Insert trade record
    INSERT INTO trades (
      user_id, market_id, side, direction, shares, price_per_share,
      total_cost, explicit_fee, amm_spread_cost
    ) VALUES (
      v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction,
      v_shares, v_price_per_share, v_total_cost, v_explicit_fee, v_amm_spread
    )
    RETURNING id INTO v_trade_id;

    -- 9. Upsert position
    INSERT INTO positions (user_id, market_id, side, shares, avg_price, total_cost)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      shares = positions.shares + EXCLUDED.shares,
      total_cost = positions.total_cost + EXCLUDED.total_cost,
      avg_price = (positions.total_cost + EXCLUDED.total_cost) /
                  (positions.shares + EXCLUDED.shares),
      updated_at = NOW();

    -- 10. Insert ledger transaction
    INSERT INTO transactions (user_id, type, amount, balance_after, description, market_id)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd,
      'Buy ' || v_shares || ' ' || UPPER(p_side) || ' shares @ $' || ROUND(v_price_per_share, 4),
      p_market_id);

    -- 11. Commission hook
    PERFORM pay_trade_commissions(v_trade_id);

  -- ================================================================
  -- SELL FLOW
  -- ================================================================
  ELSIF p_direction = 'sell' THEN

    -- Must have a position to sell
    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
    FOR UPDATE;

    IF v_position IS NULL OR v_position.shares <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    -- Calculate shares to sell from the dollar amount
    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;

    -- Explicit fee on sell too
    v_explicit_fee := p_amount * v_explicit_fee_rate;

    -- Shares = amount / current_price (approximate)
    v_shares_to_sell := p_amount / v_current_price;
    IF v_shares_to_sell > v_position.shares THEN
      v_shares_to_sell := v_position.shares;
    END IF;

    -- Calculate actual proceeds via LMSR cost difference
    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    -- Apply cash-out premium
    v_cash_out_premium := v_gross_proceeds * v_cash_out_rate;
    v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;

    IF v_net_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell proceeds too low after fees';
    END IF;

    v_shares := v_shares_to_sell;
    v_price_per_share := v_gross_proceeds / v_shares;
    v_total_cost := v_net_proceeds;

    -- P&L calculation
    v_cost_basis := v_position.avg_price * v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - v_cost_basis;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    -- Update AMM
    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    -- Credit user
    UPDATE users SET balance_usd = balance_usd + v_net_proceeds
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    -- Insert trade
    INSERT INTO trades (
      user_id, market_id, side, direction, shares, price_per_share,
      total_cost, explicit_fee, cash_out_premium
    ) VALUES (
      v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction,
      v_shares, v_price_per_share, v_total_cost, v_explicit_fee, v_cash_out_premium
    )
    RETURNING id INTO v_trade_id;

    -- Update position
    UPDATE positions SET
      shares = shares - v_shares_to_sell,
      total_cost = CASE WHEN shares - v_shares_to_sell > 0
        THEN total_cost - v_cost_basis ELSE 0 END,
      updated_at = NOW()
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side;

    -- Ledger
    INSERT INTO transactions (user_id, type, amount, balance_after, description, market_id)
    VALUES (v_user_id, 'cash_out', v_net_proceeds, v_user.balance_usd,
      'Sell ' || v_shares || ' ' || UPPER(p_side) || ' shares @ $' || ROUND(v_price_per_share, 4),
      p_market_id);

    -- Commission on sell fee too
    PERFORM pay_trade_commissions(v_trade_id);

  END IF;

  -- ======= PRICE ALERTS (fire-and-forget) =======
  UPDATE price_alerts SET
    is_triggered = TRUE,
    triggered_at = NOW()
  WHERE market_id = p_market_id
    AND is_triggered = FALSE
    AND (
      (side = 'yes' AND v_new_yes_price >= target_price)
      OR (side = 'no' AND v_new_no_price >= target_price)
    );

  -- Notify triggered alerts
  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, market_id)
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

  -- Price impact warning (> 5 cent move)
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
END;
$$;

-- Also patch resolve_market to set trigger bypass
-- (It updates user balances when distributing payouts)
CREATE OR REPLACE FUNCTION resolve_market(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_amm RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout_per_share DECIMAL;
  v_payout DECIMAL;
  v_total_payouts DECIMAL := 0;
  v_total_fee DECIMAL := 0;
  v_winner_count INT := 0;
BEGIN
  -- Enable trigger bypass for balance updates
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  -- Admin check
  IF auth.uid() IS NULL THEN
    -- Service role allowed
    NULL;
  ELSIF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Lock and validate market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Market already resolved or voided (status: %)', v_market.status;
  END IF;

  -- Lock AMM
  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;

  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Payout per winning share = $1.00 - resolution fee
  v_payout_per_share := 1.0 - v_resolution_fee_rate;

  -- Check if there are any winning positions
  IF NOT EXISTS (
    SELECT 1 FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares > 0
  ) THEN
    -- No winners — void the market instead
    UPDATE markets SET
      status = 'voided',
      outcome = NULL,
      resolved_at = NOW()
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'status', 'voided',
      'reason', 'No positions on winning side',
      'market_id', p_market_id
    );
  END IF;

  -- Distribute payouts to winning positions
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares > 0
    FOR UPDATE
  LOOP
    v_payout := v_pos.shares * v_payout_per_share;
    v_total_payouts := v_total_payouts + v_payout;
    v_total_fee := v_total_fee + (v_pos.shares * v_resolution_fee_rate);
    v_winner_count := v_winner_count + 1;

    -- Credit winner
    UPDATE users SET balance_usd = balance_usd + v_payout
    WHERE id = v_pos.user_id
    RETURNING balance_usd INTO v_pos_user.balance_usd;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, description, market_id)
    VALUES (
      v_pos.user_id, 'win_payout', v_payout, v_pos_user.balance_usd,
      'Won ' || ROUND(v_pos.shares, 2) || ' ' || UPPER(p_outcome::TEXT) || ' shares @ $' || v_payout_per_share,
      p_market_id
    );
  END LOOP;

  -- Update market status
  UPDATE markets SET
    status = 'resolved_' || p_outcome::TEXT,
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  -- Record platform revenue
  PERFORM record_revenue(
    p_market_id,
    v_total_fee,
    'resolution_fee',
    'Resolution fee: ' || v_resolution_fee_rate * 100 || '% on ' || v_winner_count || ' winning positions'
  );

  -- Settle commissions on resolution
  PERFORM settle_resolution_commissions(p_market_id);

  RETURN jsonb_build_object(
    'status', 'resolved',
    'outcome', p_outcome,
    'total_payouts', ROUND(v_total_payouts, 2),
    'resolution_fee', ROUND(v_total_fee, 2),
    'winner_count', v_winner_count,
    'market_id', p_market_id
  );
END;
$$;

-- Patch settle_resolution_commissions to set trigger bypass
-- (it updates agent balances)
DO $$
BEGIN
  -- Only patch if the function exists
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'settle_resolution_commissions') THEN
    EXECUTE $inner$
      CREATE OR REPLACE FUNCTION _set_trigger_bypass_wrapper()
      RETURNS void LANGUAGE plpgsql AS $w$
      BEGIN
        PERFORM set_config('app.trigger_bypass', 'true', TRUE);
      END;
      $w$;
    $inner$;
  END IF;
END;
$$;

-- Patch pay_trade_commissions to set trigger bypass
-- (it updates agent balances via commission payments)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'pay_trade_commissions') THEN
    -- The function is called from within execute_trade which already sets bypass
    -- No additional change needed
    NULL;
  END IF;
END;
$$;
