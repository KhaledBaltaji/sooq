-- 159_add_post_trade_prices.sql — Store post-trade marginal prices + fix price history RPC
-- Fixes: price_per_share is the average execution price, NOT the post-trade marginal price.
-- The chart was showing flat lines because it used the wrong value.

BEGIN;

-- ============================================================
-- 1. Add post-trade price columns to trades table
-- ============================================================
ALTER TABLE trades ADD COLUMN post_yes_price DECIMAL(10,6);
ALTER TABLE trades ADD COLUMN post_no_price DECIMAL(10,6);

-- ============================================================
-- 2. Backfill existing trades by replaying LMSR math
--    Loop through trades per market in order, track cumulative
--    q_yes/q_no, and compute post-trade marginal prices.
-- ============================================================
DO $$
DECLARE
  v_market RECORD;
  v_trade RECORD;
  v_q_yes DECIMAL := 0;
  v_q_no DECIMAL := 0;
  v_b DECIMAL;
BEGIN
  -- Process each market that has trades without post prices
  FOR v_market IN
    SELECT DISTINCT t.market_id, a.liquidity_param
    FROM trades t
    JOIN amm_state a ON a.market_id = t.market_id
    WHERE t.post_yes_price IS NULL
  LOOP
    v_b := v_market.liquidity_param;
    v_q_yes := 0;
    v_q_no := 0;

    -- Replay trades in chronological order
    FOR v_trade IN
      SELECT id, side, direction, shares
      FROM trades
      WHERE market_id = v_market.market_id
      ORDER BY created_at ASC
    LOOP
      -- Update cumulative q values
      IF v_trade.direction = 'buy' AND v_trade.side = 'yes' THEN
        v_q_yes := v_q_yes + v_trade.shares;
      ELSIF v_trade.direction = 'sell' AND v_trade.side = 'yes' THEN
        v_q_yes := v_q_yes - v_trade.shares;
      ELSIF v_trade.direction = 'buy' AND v_trade.side = 'no' THEN
        v_q_no := v_q_no + v_trade.shares;
      ELSIF v_trade.direction = 'sell' AND v_trade.side = 'no' THEN
        v_q_no := v_q_no - v_trade.shares;
      END IF;

      -- Set post-trade prices
      UPDATE trades SET
        post_yes_price = lmsr_price(v_b, v_q_yes, v_q_no, 'yes'),
        post_no_price = lmsr_price(v_b, v_q_yes, v_q_no, 'no')
      WHERE id = v_trade.id;
    END LOOP;
  END LOOP;
END;
$$;


-- ============================================================
-- 3. Update execute_trade to store post-trade prices
-- ============================================================
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
  v_dynamic_spread DECIMAL := 0;

  -- Trade calculation
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_net_amount DECIMAL;
  v_explicit_fee DECIMAL;
  v_amm_spread DECIMAL;
  v_cash_out_premium DECIMAL := 0;
  v_price_per_share DECIMAL;
  v_total_cost DECIMAL;
  v_gross_proceeds DECIMAL;
  v_net_proceeds DECIMAL;
  v_cost_basis DECIMAL;
  v_sell_pnl DECIMAL;

  -- AMM state
  v_b DECIMAL;
  v_current_price DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;

  -- Output
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_price_impact_warning BOOLEAN := FALSE;
BEGIN
  -- 1. Authenticate
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 2. Read fee config
  SELECT value INTO v_explicit_fee_rate FROM fee_config WHERE key = 'explicit_fee_rate';
  SELECT value INTO v_cash_out_rate FROM fee_config WHERE key = 'cash_out_premium_rate';
  SELECT value INTO v_max_trade_pct FROM fee_config WHERE key = 'max_trade_pct';
  SELECT value INTO v_dyn_threshold FROM fee_config WHERE key = 'dynamic_spread_threshold';
  SELECT value INTO v_dyn_multiplier FROM fee_config WHERE key = 'dynamic_spread_multiplier';

  -- Default fee rates if not configured
  v_explicit_fee_rate := COALESCE(v_explicit_fee_rate, 0.005);
  v_cash_out_rate := COALESCE(v_cash_out_rate, 0.005);
  v_max_trade_pct := COALESCE(v_max_trade_pct, 0.10);
  v_dyn_threshold := COALESCE(v_dyn_threshold, 0.85);
  v_dyn_multiplier := COALESCE(v_dyn_multiplier, 2.0);

  -- 3. Lock user, market, and AMM state (deterministic lock ordering)
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status != 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF v_amm IS NULL THEN RAISE EXCEPTION 'AMM not initialized for this market'; END IF;

  v_b := v_amm.liquidity_param;

  -- Rate limiting: max 1 trade per 2 seconds
  SELECT MAX(created_at) INTO v_last_trade FROM trades
  WHERE user_id = v_user_id AND created_at > NOW() - INTERVAL '2 seconds';
  IF v_last_trade IS NOT NULL THEN
    RAISE EXCEPTION 'Rate limited: please wait before trading again';
  END IF;

  -- ================================================================
  -- BUY FLOW
  -- ================================================================
  IF p_direction = 'buy' THEN

    IF p_amount <= 0 THEN RAISE EXCEPTION 'Amount must be positive'; END IF;
    IF p_amount > v_user.balance_usd THEN RAISE EXCEPTION 'Insufficient balance'; END IF;

    -- Max trade size check
    IF p_amount > v_amm.total_volume * v_max_trade_pct AND v_amm.total_volume > 0 THEN
      -- Allow but track (no hard block for now)
      NULL;
    END IF;

    -- 4. Calculate shares from LMSR
    v_explicit_fee := p_amount * v_explicit_fee_rate;
    v_net_amount := p_amount - v_explicit_fee;

    -- Dynamic spread for extreme prices
    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;
    IF v_current_price > v_dyn_threshold THEN
      v_dynamic_spread := v_net_amount * (v_current_price - v_dyn_threshold) * v_dyn_multiplier;
      v_net_amount := v_net_amount - v_dynamic_spread;
    END IF;

    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_amount);
    IF v_shares <= 0 THEN RAISE EXCEPTION 'Trade too small'; END IF;

    -- 5. Calculate AMM spread cost (for revenue tracking)
    v_amm_spread := v_net_amount - (v_shares * v_current_price);
    IF v_amm_spread < 0 THEN
      v_amm_spread := 0;
    END IF;

    -- 6. New q values and prices
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

    -- 7. Debit user balance + update wagering (buys only)
    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    -- 8. Update AMM state
    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount,
      total_trades = total_trades + 1
    WHERE market_id = p_market_id;

    -- 9. UPSERT position
    INSERT INTO positions (user_id, market_id, side, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_amount) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_amount;

    -- 10. Insert trade record
    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_explicit_fee, v_amm_spread + v_dynamic_spread, 0,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- 11. Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd,
            v_trade_id, 'Buy ' || p_side || ' shares');

    -- 12. Real-time commission payment
    PERFORM pay_trade_commissions(v_trade_id, v_user_id, p_amount);

    -- 13. Update market counters
    UPDATE markets SET
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    -- 14. UPSERT leader_stats
    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      total_trades = leader_stats.total_trades + 1;

  -- ================================================================
  -- SELL FLOW
  -- ================================================================
  ELSIF p_direction = 'sell' THEN

    v_shares_to_sell := p_amount;  -- p_amount = share count for sells

    -- Validate position
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

    -- Validate sell doesn't exceed AMM q values
    IF p_side = 'yes' AND v_shares_to_sell > v_amm.q_yes THEN
      RAISE EXCEPTION 'Cannot sell more shares than AMM holds on this side';
    END IF;
    IF p_side = 'no' AND v_shares_to_sell > v_amm.q_no THEN
      RAISE EXCEPTION 'Cannot sell more shares than AMM holds on this side';
    END IF;

    -- Calculate LMSR sell proceeds
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

    -- Deduct fees
    v_explicit_fee := v_gross_proceeds * v_explicit_fee_rate;
    v_cash_out_premium := v_gross_proceeds * v_cash_out_rate;
    v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;

    -- AMM spread for tracking
    v_current_price := CASE WHEN p_side = 'yes'
      THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;
    v_amm_spread := (v_shares_to_sell * v_current_price) - v_gross_proceeds;
    IF v_amm_spread < 0 THEN
      v_amm_spread := 0;
    END IF;

    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_shares := v_shares_to_sell;
    v_total_cost := v_net_proceeds;

    -- New prices
    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    -- Credit user balance
    UPDATE users SET balance_usd = balance_usd + v_net_proceeds
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_user.balance_usd;

    -- Update AMM state
    UPDATE amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds,
      total_trades = total_trades + 1
    WHERE market_id = p_market_id;

    -- Update position
    v_cost_basis := v_position.avg_entry_price * v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - v_cost_basis;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    -- Insert trade record
    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, v_explicit_fee, v_amm_spread, v_cash_out_premium,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'cash_out', v_net_proceeds, v_user.balance_usd,
            v_trade_id, 'Sell ' || p_side || ' shares');

    -- Real-time commission payment
    PERFORM pay_trade_commissions(v_trade_id, v_user_id, v_gross_proceeds);

    -- Update market counters
    UPDATE markets SET
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    -- UPSERT leader_stats
    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET
      total_trades = leader_stats.total_trades + 1;

  END IF;

  -- ================================================================
  -- PRICE ALERT CHECK (after both buy and sell)
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

  -- Insert notifications for triggered alerts
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
    'price_impact_warning', v_price_impact_warning,
    'price_impact', ROUND(v_price_impact, 4)
  );
END;
$$;

-- ============================================================
-- 4. Update get_price_history to use post-trade prices
-- ============================================================
CREATE OR REPLACE FUNCTION get_price_history(
  p_market_id   UUID,
  p_period      TEXT DEFAULT '1D',
  p_created_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  bucket_time TIMESTAMPTZ,
  yes_price   DECIMAL,
  no_price    DECIMAL
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ := NOW();
  v_interval INTERVAL;
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  -- Determine time range and bucket interval based on period
  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '12H' THEN v_start := v_end - INTERVAL '12 hours';  v_interval := INTERVAL '3 minutes';
    WHEN '1D'  THEN v_start := v_end - INTERVAL '1 day';     v_interval := INTERVAL '5 minutes';
    WHEN '1W'  THEN v_start := v_end - INTERVAL '7 days';    v_interval := INTERVAL '30 minutes';
    WHEN '1M'  THEN v_start := v_end - INTERVAL '30 days';   v_interval := INTERVAL '2 hours';
    WHEN 'ALL' THEN
      v_start := COALESCE(p_created_at, v_end - INTERVAL '30 days');
      v_interval := GREATEST(
        (v_end - v_start) / 500,
        INTERVAL '1 minute'
      );
    ELSE
      v_start := v_end - INTERVAL '1 day'; v_interval := INTERVAL '5 minutes';
  END CASE;

  -- Get AMM initial price as fallback when no trade precedes a bucket
  SELECT a.current_yes_price, a.current_no_price
  INTO v_initial_yes, v_initial_no
  FROM amm_state a WHERE a.market_id = p_market_id;

  -- Generate time buckets and find the most recent trade price at or before each bucket
  -- Uses post_yes_price/post_no_price (post-trade marginal price) when available,
  -- falls back to price_per_share derivation for pre-migration trades
  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(tr.post_yes_price,
        CASE WHEN tr.side = 'yes' THEN tr.price_per_share
             ELSE 1 - tr.price_per_share END) AS y_price,
      COALESCE(tr.post_no_price,
        CASE WHEN tr.side = 'yes' THEN 1 - tr.price_per_share
             ELSE tr.price_per_share END) AS n_price
    FROM trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;

GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_price_history(UUID, TEXT, TIMESTAMPTZ) TO anon;

COMMIT;
