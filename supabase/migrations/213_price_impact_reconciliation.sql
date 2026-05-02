-- ============================================================
-- 213: S2 Branch System — Price impact cap on retail,
-- retail exposure cap, solvency reconciliation cron
--
-- 1. Add price impact cap to retail execute_trade
-- 2. Add retail exposure cap to retail execute_trade
-- 3. reconcile_branch_solvency() for cron health check
-- ============================================================

-- ============================================================
-- 1. Update execute_trade with price impact cap + retail exposure cap
--
-- Only adding the two new guards. Full function recreated to
-- include these checks alongside existing logic from 207b.
-- ============================================================

CREATE OR REPLACE FUNCTION execute_trade(
  p_market_id UUID,
  p_side TEXT,
  p_amount DECIMAL DEFAULT NULL,
  p_shares_to_sell DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_position RECORD;

  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_max_trade_pct DECIMAL;
  v_dyn_threshold DECIMAL;
  v_dyn_multiplier DECIMAL;
  v_dynamic_spread DECIMAL := 0;
  v_min_trade DECIMAL;
  v_price_impact_cap DECIMAL;
  v_exposure_cap_mult DECIMAL;

  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_b DECIMAL;
  v_net_amount DECIMAL;
  v_explicit_fee DECIMAL;
  v_amm_spread DECIMAL;
  v_price_per_share DECIMAL;
  v_gross_proceeds DECIMAL;
  v_net_proceeds DECIMAL;
  v_cash_out_premium DECIMAL;
  v_sell_pnl DECIMAL;
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_current_price DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  -- Read fee config
  SELECT rate INTO v_explicit_fee_rate FROM fee_config WHERE fee_type = 'explicit_fee' AND level IS NULL;
  SELECT rate INTO v_cash_out_rate FROM fee_config WHERE fee_type = 'cash_out_premium' AND level IS NULL;
  SELECT rate INTO v_max_trade_pct FROM fee_config WHERE fee_type = 'max_trade_pct' AND level IS NULL;
  SELECT rate INTO v_dyn_threshold FROM fee_config WHERE fee_type = 'dynamic_spread_threshold' AND level IS NULL;
  SELECT rate INTO v_dyn_multiplier FROM fee_config WHERE fee_type = 'dynamic_spread_multiplier' AND level IS NULL;
  SELECT rate INTO v_min_trade FROM fee_config WHERE fee_type = 'min_trade_amount' AND level IS NULL;
  SELECT rate INTO v_price_impact_cap FROM fee_config WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  SELECT rate INTO v_exposure_cap_mult FROM fee_config WHERE fee_type = 'retail_exposure_cap_multiplier' AND level IS NULL;

  IF v_explicit_fee_rate IS NULL THEN v_explicit_fee_rate := 0.005; END IF;
  IF v_cash_out_rate IS NULL THEN v_cash_out_rate := 0.005; END IF;
  IF v_max_trade_pct IS NULL THEN v_max_trade_pct := 0.10; END IF;
  IF v_dyn_threshold IS NULL THEN v_dyn_threshold := 0.05; END IF;
  IF v_dyn_multiplier IS NULL THEN v_dyn_multiplier := 0.5; END IF;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;
  IF v_exposure_cap_mult IS NULL THEN v_exposure_cap_mult := 2.0; END IF;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══

    IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
      RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
    END IF;

    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    IF p_amount > v_amm.total_volume * v_max_trade_pct + 100 THEN
      RAISE EXCEPTION 'Trade exceeds maximum size';
    END IF;

    v_explicit_fee := ROUND(p_amount * v_explicit_fee_rate, 2);
    v_net_amount := p_amount - v_explicit_fee;

    IF p_side = 'yes' THEN
      v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', v_net_amount);
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', v_net_amount);
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

    v_current_price := CASE WHEN p_side = 'yes' THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;
    IF v_current_price > (1 - v_dyn_threshold) OR v_current_price < v_dyn_threshold THEN
      v_dynamic_spread := v_net_amount * v_dyn_multiplier * 0.01;
      v_net_amount := v_net_amount - v_dynamic_spread;
      IF p_side = 'yes' THEN
        v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', v_net_amount);
        v_new_q_yes := v_amm.q_yes + v_shares;
      ELSE
        v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', v_net_amount);
        v_new_q_no := v_amm.q_no + v_shares;
      END IF;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    -- ═══ NEW: Price impact cap (Section 23) ═══
    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap (%.1f%% > %.1f%%)',
        v_price_impact * 100, v_price_impact_cap * 100;
    END IF;

    -- ═══ NEW: Retail exposure cap ═══
    DECLARE
      v_retail_yes DECIMAL;
      v_retail_no DECIMAL;
      v_retail_cash DECIMAL;
      v_retail_worst DECIMAL;
      v_exposure_cap DECIMAL;
    BEGIN
      SELECT COALESCE(SUM(shares_held), 0) INTO v_retail_yes
      FROM positions WHERE market_id = p_market_id AND branch_id IS NULL AND side = 'yes' AND shares_held > 0;
      SELECT COALESCE(SUM(shares_held), 0) INTO v_retail_no
      FROM positions WHERE market_id = p_market_id AND branch_id IS NULL AND side = 'no' AND shares_held > 0;

      IF p_side = 'yes' THEN v_retail_yes := v_retail_yes + v_shares;
      ELSE v_retail_no := v_retail_no + v_shares; END IF;

      v_retail_cash := v_amm.retail_net_cash + v_net_amount;
      v_retail_worst := GREATEST(0, GREATEST(v_retail_yes * 0.99, v_retail_no * 0.99) - v_retail_cash);
      v_exposure_cap := v_b * v_exposure_cap_mult;

      IF v_retail_worst > v_exposure_cap THEN
        RAISE EXCEPTION 'Retail exposure cap exceeded';
      END IF;
    END;

    v_price_per_share := v_net_amount / v_shares;
    v_amm_spread := v_net_amount - (v_shares * CASE WHEN p_side = 'yes' THEN v_amm.current_yes_price ELSE v_amm.current_no_price END);
    IF v_amm_spread < 0 THEN v_amm_spread := 0; END IF;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount, total_trades = total_trades + 1,
      retail_net_cash = retail_net_cash + v_net_amount,
      retail_shares_yes = CASE WHEN p_side = 'yes' THEN retail_shares_yes + v_shares ELSE retail_shares_yes END,
      retail_shares_no = CASE WHEN p_side = 'no' THEN retail_shares_no + v_shares ELSE retail_shares_no END,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, NULL, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_amount) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_amount;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_explicit_fee, v_amm_spread + v_dynamic_spread, 0,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id, 'Buy ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, p_amount);

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id;

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH ═══
    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
      AND branch_id IS NULL
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

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

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    -- Price impact cap on sell too
    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_explicit_fee := ROUND(v_gross_proceeds * v_explicit_fee_rate, 2);
    v_cash_out_premium := ROUND(v_gross_proceeds * v_cash_out_rate, 2);
    v_amm_spread := 0;
    v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds, total_trades = total_trades + 1,
      retail_net_cash = retail_net_cash - v_net_proceeds,
      retail_shares_yes = CASE WHEN p_side = 'yes' THEN retail_shares_yes - v_shares_to_sell ELSE retail_shares_yes END,
      retail_shares_no = CASE WHEN p_side = 'no' THEN retail_shares_no - v_shares_to_sell ELSE retail_shares_no END,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    UPDATE positions SET shares_held = 0, total_invested = 0
    WHERE id = v_position.id AND shares_held > 0 AND shares_held < 0.001;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, v_explicit_fee, v_amm_spread, v_cash_out_premium,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_user.balance_usd + v_net_proceeds, v_trade_id, 'Sell ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, v_gross_proceeds);

    UPDATE markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id;

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;

  -- Check price alerts
  UPDATE price_alerts SET is_triggered = true, triggered_at = NOW()
  WHERE market_id = p_market_id AND is_triggered = false
    AND (
      (side = 'yes' AND direction = 'above' AND v_new_yes_price >= target_price) OR
      (side = 'yes' AND direction = 'below' AND v_new_yes_price <= target_price) OR
      (side = 'no' AND direction = 'above' AND v_new_no_price >= target_price) OR
      (side = 'no' AND direction = 'below' AND v_new_no_price <= target_price)
    );

  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(COALESCE(v_shares, v_shares_to_sell), 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(COALESCE(p_amount, v_net_proceeds), 2),
    'explicit_fee', ROUND(v_explicit_fee, 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6)
  );
END;
$$;

-- ============================================================
-- 2. Solvency reconciliation function
--
-- Called by check-errors cron. Recomputes worst_case_total from
-- positions, compares to cached value, logs discrepancies.
-- ============================================================

CREATE OR REPLACE FUNCTION reconcile_branch_solvency()
RETURNS TABLE (
  branch_id UUID,
  branch_name TEXT,
  cached_worst_case DECIMAL,
  computed_worst_case DECIMAL,
  difference DECIMAL,
  cached_pool_balance DECIMAL,
  ledger_pool_balance DECIMAL,
  pool_difference DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
  v_computed DECIMAL;
  v_ledger_balance DECIMAL;
  v_diff DECIMAL;
  v_pool_diff DECIMAL;
BEGIN
  FOR v_branch IN SELECT * FROM branches WHERE status NOT IN ('suspended') LOOP
    -- Recompute worst case from scratch
    v_computed := _recompute_branch_worst_case(v_branch.id);
    v_diff := v_branch.worst_case_total - v_computed;

    -- Recompute pool balance from ledger
    SELECT COALESCE(SUM(amount), 0) INTO v_ledger_balance
    FROM branch_pools WHERE branch_pools.branch_id = v_branch.id;
    v_pool_diff := v_branch.pool_balance - v_ledger_balance;

    -- Log discrepancies
    IF ABS(v_diff) > 0.01 OR ABS(v_pool_diff) > 0.01 THEN
      PERFORM log_system_event(
        'error'::log_severity,
        'branch_solvency_reconciliation',
        'Branch ' || v_branch.name || ' solvency mismatch',
        jsonb_build_object(
          'branch_id', v_branch.id,
          'cached_worst_case', v_branch.worst_case_total,
          'computed_worst_case', v_computed,
          'wc_difference', v_diff,
          'cached_pool', v_branch.pool_balance,
          'ledger_pool', v_ledger_balance,
          'pool_difference', v_pool_diff
        )
      );

      -- Auto-fix: update cached values to match reality
      UPDATE branches SET
        worst_case_total = v_computed,
        pool_balance = v_ledger_balance
      WHERE id = v_branch.id;
    END IF;

    -- Return row for monitoring
    branch_id := v_branch.id;
    branch_name := v_branch.name;
    cached_worst_case := v_branch.worst_case_total;
    computed_worst_case := v_computed;
    difference := v_diff;
    cached_pool_balance := v_branch.pool_balance;
    ledger_pool_balance := v_ledger_balance;
    pool_difference := v_pool_diff;
    RETURN NEXT;
  END LOOP;
END;
$$;
