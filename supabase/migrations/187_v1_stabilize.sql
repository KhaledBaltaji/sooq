-- 187_v1_stabilize.sql — V1 stabilization: two code fixes
--
-- Fix 1: Add separate dynamic_spread column to trades table.
--   Previously dynamic_spread was bundled into amm_spread_cost (line 154 of migration 177).
--   Now they are stored separately for accurate revenue attribution.
--
-- Fix 2: Use UPDATE ... RETURNING for balance_after instead of arithmetic on cached read.
--   Previously balance_after = v_user.balance_usd ± amount (stale if concurrent mutations).
--   Now: UPDATE users first, RETURNING balance_usd, then use that for the ledger entry.
--
-- Also: Max trade size rule changed from total_volume-based to liquidity_param-based.
--   Old: p_amount > total_volume * max_trade_pct + 100
--   New: p_amount > GREATEST(b * amm_max_trade_pct, 100)
--   Reads amm_max_trade_pct from fee_config (0.05 = 5% of b = $50 on b=1000, floored to $100).

-- ══════════════════════════════════════════════════════════════
-- Fix 1: Add dynamic_spread column
-- ══════════════════════════════════════════════════════════════
ALTER TABLE trades ADD COLUMN IF NOT EXISTS dynamic_spread DECIMAL(18,6) NOT NULL DEFAULT 0;

-- Backfill: all existing rows get 0 (we can't retroactively split the bundled value)
-- The DEFAULT 0 handles this, but be explicit for clarity:
UPDATE trades SET dynamic_spread = 0 WHERE dynamic_spread IS NULL;


-- ══════════════════════════════════════════════════════════════
-- Fixes 1+2: Rewrite execute_trade
-- ══════════════════════════════════════════════════════════════
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
  v_amm_max_trade_pct DECIMAL;
  v_dyn_threshold DECIMAL;
  v_dyn_multiplier DECIMAL;
  v_dynamic_spread DECIMAL := 0;

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
  v_price_impact_warning BOOLEAN := FALSE;
  v_new_balance DECIMAL;                    -- Fix 2: actual balance from RETURNING
  v_max_trade DECIMAL;                      -- Max trade size (b-based)
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Bypass protected columns trigger (SECURITY DEFINER context)
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
  SELECT rate INTO v_amm_max_trade_pct FROM fee_config WHERE fee_type = 'amm_max_trade_pct' AND level IS NULL;
  SELECT rate INTO v_dyn_threshold FROM fee_config WHERE fee_type = 'dynamic_spread_threshold' AND level IS NULL;
  SELECT rate INTO v_dyn_multiplier FROM fee_config WHERE fee_type = 'dynamic_spread_multiplier' AND level IS NULL;

  IF v_explicit_fee_rate IS NULL THEN v_explicit_fee_rate := 0.005; END IF;
  IF v_cash_out_rate IS NULL THEN v_cash_out_rate := 0.005; END IF;
  IF v_amm_max_trade_pct IS NULL THEN v_amm_max_trade_pct := 0.05; END IF;
  IF v_dyn_threshold IS NULL THEN v_dyn_threshold := 0.05; END IF;
  IF v_dyn_multiplier IS NULL THEN v_dyn_multiplier := 0.5; END IF;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══
    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    -- Max trade: percentage of liquidity_param (b), floored at $100
    v_max_trade := GREATEST(v_b * v_amm_max_trade_pct, 100);
    IF p_amount > v_max_trade THEN
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
    v_price_per_share := v_net_amount / v_shares;
    v_amm_spread := v_net_amount - (v_shares * CASE WHEN p_side = 'yes' THEN v_amm.current_yes_price ELSE v_amm.current_no_price END);
    IF v_amm_spread < 0 THEN v_amm_spread := 0; END IF;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_amount) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_amount;

    -- Fix 1: Write amm_spread_cost and dynamic_spread as separate columns
    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, dynamic_spread, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_explicit_fee, v_amm_spread, v_dynamic_spread, 0,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- Fix 2: UPDATE users FIRST, get actual balance from RETURNING, then use for ledger
    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_new_balance, v_trade_id, 'Buy ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, p_amount);

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- Note: dynamic_spread is always 0 on sells (no dynamic spread on sell path)
    -- ═══ SELL PATH ═══
    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
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
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    -- Fix 1: Write dynamic_spread = 0 explicitly on sells (no dynamic spread on sells)
    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, dynamic_spread, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, v_explicit_fee, v_amm_spread, 0, v_cash_out_premium,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- Fix 2: UPDATE users FIRST, get actual balance from RETURNING, then use for ledger
    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_new_balance, v_trade_id, 'Sell ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, v_gross_proceeds);

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

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
  v_price_impact_warning := v_price_impact > 0.05;

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(COALESCE(v_shares, v_shares_to_sell), 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(COALESCE(p_amount, v_net_proceeds), 2),
    'explicit_fee', ROUND(v_explicit_fee, 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6),
    'price_impact_warning', v_price_impact_warning
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- Fix 3: record_revenue — sum dynamic_spread from trades
-- ══════════════════════════════════════════════════════════════
-- Previously v_dynamic_spread was declared := 0 and never populated.
-- Now it reads SUM(dynamic_spread) from trades, and total revenue includes it.

CREATE OR REPLACE FUNCTION record_revenue(
  p_market_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_explicit DECIMAL;
  v_total_amm_spread DECIMAL;
  v_total_cash_out DECIMAL;
  v_resolution_fee DECIMAL;
  v_dynamic_spread DECIMAL;
  v_total_fees DECIMAL;
  v_total_commissions DECIMAL;
  v_net_revenue DECIMAL;
  v_total_volume DECIMAL;
  v_resolution_fee_rate DECIMAL;
  v_market RECORD;
BEGIN
  -- Sum fee columns from all trades on this market (now includes dynamic_spread)
  SELECT
    COALESCE(SUM(explicit_fee), 0),
    COALESCE(SUM(amm_spread_cost), 0),
    COALESCE(SUM(cash_out_premium), 0),
    COALESCE(SUM(dynamic_spread), 0)
  INTO v_total_explicit, v_total_amm_spread, v_total_cash_out, v_dynamic_spread
  FROM trades WHERE market_id = p_market_id;

  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Resolution fee: from winning positions
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  IF v_market.outcome IS NOT NULL THEN
    SELECT COALESCE(SUM(shares_held * v_resolution_fee_rate), 0) INTO v_resolution_fee
    FROM positions
    WHERE market_id = p_market_id
      AND side = v_market.outcome
      AND shares_held > 0;
  ELSE
    v_resolution_fee := 0;
  END IF;

  -- Query total commissions from referral_commissions (both trade + resolution)
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_commissions
  FROM referral_commissions
  WHERE market_id = p_market_id AND status = 'credited';

  -- Get total volume
  SELECT COALESCE(total_volume, 0) INTO v_total_volume
  FROM amm_state WHERE market_id = p_market_id;

  -- Calculate totals
  v_total_fees := v_total_explicit + v_total_amm_spread + v_resolution_fee
                  + v_dynamic_spread + v_total_cash_out;
  v_net_revenue := v_total_fees - v_total_commissions;

  -- Insert revenue record
  INSERT INTO platform_revenue (
    market_id, total_pot, seed_amount, platform_fee,
    total_commissions, net_revenue,
    explicit_fee_revenue, amm_spread_revenue, resolution_fee_revenue,
    dynamic_spread_revenue, cash_out_premium_revenue
  ) VALUES (
    p_market_id,
    v_total_volume,
    0,
    v_total_fees,
    v_total_commissions,
    v_net_revenue,
    v_total_explicit,
    v_total_amm_spread,
    v_resolution_fee,
    v_dynamic_spread,
    v_total_cash_out
  );
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- Fix 4: pay_trade_commissions — include dynamic_spread in platform_revenue
-- ══════════════════════════════════════════════════════════════
-- Commission base = explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium
-- This preserves pre-187 economics where dynamic_spread was bundled in amm_spread_cost.

CREATE OR REPLACE FUNCTION pay_trade_commissions(
  p_trade_id UUID,
  p_user_id UUID,
  p_trade_amount DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade RECORD;
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
  v_new_level INTEGER;
  -- First-trade activation variables
  v_is_first_trade BOOLEAN;
  v_referrer_id UUID;
  v_new_qual_count INTEGER;
  v_referrer_activated BOOLEAN;
  v_referrer_override BOOLEAN;
BEGIN
  -- 1. Read trade record for fee columns
  SELECT explicit_fee, amm_spread_cost, cash_out_premium, dynamic_spread, market_id
  INTO v_trade
  FROM trades WHERE id = p_trade_id;

  IF v_trade IS NULL THEN
    RETURN 0;
  END IF;

  -- 2. Calculate total platform revenue from this trade
  --    Rule: explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium
  v_platform_revenue := v_trade.explicit_fee + v_trade.amm_spread_cost
                       + v_trade.dynamic_spread + v_trade.cash_out_premium;

  IF v_platform_revenue <= 0 THEN
    RETURN 0;
  END IF;

  -- 3. First-trade detection: increment referrer's qualified_referral_count
  v_is_first_trade := NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = p_user_id AND id != p_trade_id
    LIMIT 1
  );

  IF v_is_first_trade THEN
    -- Get direct referrer
    SELECT referred_by INTO v_referrer_id FROM users WHERE id = p_user_id;

    IF v_referrer_id IS NOT NULL THEN
      UPDATE users
      SET qualified_referral_count = qualified_referral_count + 1
      WHERE id = v_referrer_id
      RETURNING qualified_referral_count, agent_activated, agent_activation_override
      INTO v_new_qual_count, v_referrer_activated, v_referrer_override;

      -- Check if referrer just hit the threshold (organic activation)
      IF NOT v_referrer_activated AND v_new_qual_count >= 5 THEN
        UPDATE users SET agent_activated = TRUE WHERE id = v_referrer_id;
        PERFORM _release_escrowed_commissions(v_referrer_id);
      END IF;
    END IF;
  END IF;

  -- 4. Read trader's referral chain
  SELECT referral_chain INTO v_chain
  FROM users WHERE id = p_user_id;

  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL OR array_length(v_chain, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- 5. Single-pass loop: volume + tier + commission for each ancestor
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 3) LOOP
    v_ancestor_id := v_chain[v_layer];

    IF v_ancestor_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id;
    IF v_ancestor IS NULL THEN
      CONTINUE;
    END IF;

    -- a. Update network volume
    UPDATE users SET network_volume = network_volume + p_trade_amount
    WHERE id = v_ancestor_id;

    -- b. Inline tier advancement check (ratchet: only goes up)
    v_new_level := CASE
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 200000 THEN 4
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 50000  THEN 3
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 10000  THEN 2
      ELSE 1
    END;

    IF v_new_level > v_ancestor.agent_level THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    -- c. Credit commission via shared helper (handles escrow/credit)
    v_commission := _credit_commission(
      v_ancestor_id, p_user_id, v_trade.market_id, p_trade_id,
      v_layer, v_ancestor.agent_level, v_platform_revenue,
      'ngr_commission', 'trade'
    );

    v_total_commissions := v_total_commissions + v_commission;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;


-- ══════════════════════════════════════════════════════════════
-- Fix 5: get_stats_revenue — include dynamic_spread in all revenue sums
-- ══════════════════════════════════════════════════════════════
-- All revenue formulas: explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium

CREATE OR REPLACE FUNCTION get_stats_revenue(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as net_revenue,
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE(SUM(dynamic_spread), 0) as dynamic_spread,
          COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN p_start_date AND p_end_date), 0) as resolution_fees,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as commissions_paid,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as escrowed_commissions,
          CASE WHEN COUNT(*) = 0 THEN 0
               ELSE ROUND(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium) / COUNT(*), 2)
          END as revenue_per_trade
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as net_revenue
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          created_at::date as date,
          COALESCE(SUM(explicit_fee), 0) as explicit,
          COALESCE(SUM(amm_spread_cost), 0) as spread,
          COALESCE(SUM(dynamic_spread), 0) as dynamic,
          COALESCE(SUM(cash_out_premium), 0) as cash_out,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as total
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY created_at::date
        ORDER BY date
      ) d
    )
  );
END;
$$;
