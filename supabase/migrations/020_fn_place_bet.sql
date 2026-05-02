-- 020_fn_place_bet.sql — Core betting function
-- Uses auth.uid() — NEVER accepts client user_id
-- SELECT FOR UPDATE on balance operations

CREATE OR REPLACE FUNCTION place_bet(
  p_market_id UUID,
  p_side bet_side,
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
  v_side_pool DECIMAL;
  v_other_pool DECIMAL;
  v_total_pool DECIMAL;
  v_payout_ratio DECIMAL;
  v_potential_payout DECIMAL;
  v_bet_id UUID;
  v_min_bet DECIMAL := 1;
  v_max_bet DECIMAL;
  v_last_bet TIMESTAMPTZ;
  v_pool_pct DECIMAL := 0.20;
  v_max_bet_floor DECIMAL := 100;
BEGIN
  -- Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate amount
  IF p_amount < v_min_bet THEN
    RAISE EXCEPTION 'Minimum bet is $%', v_min_bet;
  END IF;

  -- Lock user row and read balance
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;
  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Rate limit: 1 bet per user per market per minute
  SELECT MAX(created_at) INTO v_last_bet
  FROM bets WHERE user_id = v_user_id AND market_id = p_market_id;
  IF v_last_bet IS NOT NULL AND v_last_bet > NOW() - INTERVAL '1 minute' THEN
    RAISE EXCEPTION 'Rate limit: wait 1 minute between bets on same market';
  END IF;

  -- Lock market row and validate
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

  -- Dynamic max bet: 20% of relevant pool, floor $100
  IF p_side = 'yes' THEN
    v_side_pool := v_market.pool_yes;
    v_other_pool := v_market.pool_no;
  ELSE
    v_side_pool := v_market.pool_no;
    v_other_pool := v_market.pool_yes;
  END IF;

  v_max_bet := GREATEST(v_side_pool * v_pool_pct, v_max_bet_floor);
  IF p_amount > v_max_bet THEN
    RAISE EXCEPTION 'Maximum bet is $%', ROUND(v_max_bet, 2);
  END IF;

  -- Calculate payout ratio with zero-pool guard
  v_total_pool := v_side_pool + v_other_pool + p_amount;
  IF (v_side_pool + p_amount) = 0 THEN
    RAISE EXCEPTION 'Invalid pool state';
  END IF;
  v_payout_ratio := v_total_pool / (v_side_pool + p_amount);
  v_potential_payout := p_amount * v_payout_ratio;

  -- Insert bet
  INSERT INTO bets (user_id, market_id, side, amount, payout_ratio, potential_payout)
  VALUES (v_user_id, p_market_id, p_side, p_amount, v_payout_ratio, v_potential_payout)
  RETURNING id INTO v_bet_id;

  -- Debit user balance
  UPDATE users SET
    balance_usd = balance_usd - p_amount,
    total_wagered = total_wagered + p_amount
  WHERE id = v_user_id;

  -- Insert ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'bet', -p_amount,
    v_user.balance_usd - p_amount,
    v_bet_id,
    'Bet ' || p_side || ' on market'
  );

  -- Update market pool totals and counters
  IF p_side = 'yes' THEN
    UPDATE markets SET
      pool_yes = pool_yes + p_amount,
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM bets WHERE market_id = p_market_id)
    WHERE id = p_market_id;
  ELSE
    UPDATE markets SET
      pool_no = pool_no + p_amount,
      bet_count = bet_count + 1,
      unique_bettors = (SELECT COUNT(DISTINCT user_id) FROM bets WHERE market_id = p_market_id)
    WHERE id = p_market_id;
  END IF;

  RETURN jsonb_build_object(
    'bet_id', v_bet_id,
    'payout_ratio', ROUND(v_payout_ratio, 4),
    'potential_payout', ROUND(v_potential_payout, 2)
  );
END;
$$;
