-- 271_demo_rpcs.sql — Demo Mode: all RPCs + process_deposit analytics edit
--
-- All demo RPCs are SECURITY DEFINER and scope to auth.uid(). They mirror the
-- shape of live RPCs (execute_trade, resolve_market, initialize_amm, etc.) but
-- write ONLY to demo_* tables. Zero rows land in transactions, positions, trades,
-- commissions, platform_revenue, leader_stats, or price_alerts.
--
-- Admin RBAC: all admin-only RPCs accept both super-admins
-- (admin_allowed_views IS NULL OR empty) and sub-admins with 'demo' in their
-- allowed_views array.
--
-- Re-used math utilities from 107_v3_fn_lmsr_math.sql: lmsr_cost, lmsr_price,
-- lmsr_shares_for_cost (all IMMUTABLE, safe to share).

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- Helper: admin authorization check with RBAC scope
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _demo_assert_admin()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_caller RECORD;
BEGIN
  v_caller_id := auth.uid();
  -- Service-role invocations (auth.uid() IS NULL) are always allowed. Callers
  -- already enforce service-role-or-admin at their boundary.
  IF v_caller_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, is_admin, admin_allowed_views INTO v_caller
  FROM users WHERE id = v_caller_id;

  IF NOT FOUND OR NOT v_caller.is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Super admin (no scope restriction) passes.
  IF v_caller.admin_allowed_views IS NULL
     OR array_length(v_caller.admin_allowed_views, 1) IS NULL
     OR array_length(v_caller.admin_allowed_views, 1) = 0 THEN
    RETURN v_caller_id;
  END IF;

  -- Sub-admin: must have 'demo' in allowed views
  IF NOT ('demo' = ANY(v_caller.admin_allowed_views)) THEN
    RAISE EXCEPTION 'Admin access required (demo scope)';
  END IF;

  RETURN v_caller_id;
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. toggle_demo_mode(p_enabled) — atomic first-enable grants $10K
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Atomicity: on first enable, the UPDATE uses a WHERE guard on
-- demo_first_enabled_at IS NULL. If two parallel calls race, only one passes
-- the guard and grants $10K. The other call sees demo_first_enabled_at is
-- already set and takes the no-balance-change path.

CREATE OR REPLACE FUNCTION toggle_demo_mode(p_enabled BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_granted BOOLEAN := FALSE;
  v_new_balance DECIMAL;
  v_first_enabled_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_enabled THEN
    -- Atomic first-enable: only one caller can pass the WHERE guard.
    UPDATE users
    SET demo_balance_usd = 10000,
        demo_first_enabled_at = now(),
        demo_mode = TRUE,
        updated_at = NOW()
    WHERE id = v_user_id
      AND demo_first_enabled_at IS NULL
    RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;

    IF FOUND THEN
      v_granted := TRUE;
      -- Seed the ledger with the initial grant.
      INSERT INTO demo_transactions (user_id, type, amount, balance_after, description)
      VALUES (v_user_id, 'demo_seed', 10000, v_new_balance, 'Initial demo balance grant');
    ELSE
      -- Already initialized — just flip the preference flag.
      UPDATE users
      SET demo_mode = TRUE,
          updated_at = NOW()
      WHERE id = v_user_id
      RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;
    END IF;
  ELSE
    -- Disable: just flip the preference. Balance + positions preserved.
    UPDATE users
    SET demo_mode = FALSE,
        updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;
  END IF;

  RETURN jsonb_build_object(
    'demo_mode', p_enabled,
    'demo_balance_usd', v_new_balance,
    'demo_first_enabled_at', v_first_enabled_at,
    'granted_initial_balance', v_granted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_demo_mode(BOOLEAN) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. demo_reset_balance() — reset to $10K, positions untouched
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION demo_reset_balance()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_delta DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_user.demo_first_enabled_at IS NULL THEN
    RAISE EXCEPTION 'Demo mode not initialized';
  END IF;

  v_delta := 10000 - v_user.demo_balance_usd;

  UPDATE users
  SET demo_balance_usd = 10000,
      updated_at = NOW()
  WHERE id = v_user_id
  RETURNING demo_balance_usd INTO v_new_balance;

  INSERT INTO demo_transactions (user_id, type, amount, balance_after, description)
  VALUES (v_user_id, 'demo_reset', v_delta, v_new_balance, 'Demo balance reset to $10,000');

  RETURN jsonb_build_object(
    'demo_balance_usd', v_new_balance,
    'delta', v_delta
  );
END;
$$;

GRANT EXECUTE ON FUNCTION demo_reset_balance() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. demo_execute_trade — pure LMSR, no fees / commissions / revenue
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Mirrors execute_trade (migration 173) but operates entirely on demo_* tables
-- and users.demo_balance_usd. Skips: pay_trade_commissions, record_revenue,
-- price_alerts, leader_stats, branch settlement, total_wagered, explicit_fee,
-- cash_out_premium, dynamic_spread. Pure LMSR cost function.

CREATE OR REPLACE FUNCTION demo_execute_trade(
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

  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_b DECIMAL;
  v_price_per_share DECIMAL;
  v_gross_proceeds DECIMAL;
  v_sell_pnl DECIMAL;
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid side: must be "yes" or "no"';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Lock user, market, amm in deterministic order to avoid deadlocks.
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;
  IF v_user.demo_first_enabled_at IS NULL THEN
    RAISE EXCEPTION 'Demo mode not initialized';
  END IF;

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM demo_amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══
    IF p_amount > v_user.demo_balance_usd THEN
      RAISE EXCEPTION 'Insufficient demo balance';
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);

    IF p_side = 'yes' THEN
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', p_amount);
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', p_amount);
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price  := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');
    v_price_per_share := p_amount / v_shares;

    -- Update AMM
    UPDATE demo_amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price  = v_new_no_price,
      total_volume = total_volume + p_amount,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    -- Upsert position
    INSERT INTO demo_positions (user_id, market_id, side, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, p_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      avg_entry_price = (demo_positions.total_invested + p_amount) / (demo_positions.shares_held + v_shares),
      shares_held = demo_positions.shares_held + v_shares,
      total_invested = demo_positions.total_invested + p_amount;

    -- Record trade
    INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                             price_per_share, total_cost, post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- Debit balance (RETURNING for post-update value)
    UPDATE users SET
      demo_balance_usd = demo_balance_usd - p_amount,
      demo_first_trade_at = COALESCE(demo_first_trade_at, NOW()),
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    -- Ledger
    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'demo_bet', -p_amount, v_new_balance, v_trade_id, 'Buy ' || p_side || ' demo shares');

    -- Market stats
    UPDATE demo_markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM demo_trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH ═══
    SELECT * INTO v_position FROM demo_positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no  := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no  := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price  := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_gross_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    UPDATE demo_amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price  = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE demo_positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl,
      updated_at = NOW()
    WHERE id = v_position.id;

    INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                             price_per_share, total_cost, post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_gross_proceeds, v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    UPDATE users SET
      demo_balance_usd = demo_balance_usd + v_gross_proceeds,
      demo_first_trade_at = COALESCE(demo_first_trade_at, NOW()),
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'demo_bet', v_gross_proceeds, v_new_balance, v_trade_id, 'Sell ' || p_side || ' demo shares');

    UPDATE demo_markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;

  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(COALESCE(v_shares, v_shares_to_sell), 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(COALESCE(p_amount, v_gross_proceeds), 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6),
    'demo_balance_usd', v_new_balance
  );
END;
$$;

GRANT EXECUTE ON FUNCTION demo_execute_trade(UUID, TEXT, DECIMAL, DECIMAL) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. initialize_demo_amm — mirrors initialize_amm for demo_amm_state
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION initialize_demo_amm(
  p_market_id UUID,
  p_liquidity_param DECIMAL DEFAULT 5000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_b DECIMAL;
  v_market RECORD;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- Allow service_role or admin
  PERFORM _demo_assert_admin();

  v_b := COALESCE(p_liquidity_param, 5000);
  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  IF EXISTS (SELECT 1 FROM demo_amm_state WHERE market_id = p_market_id) THEN
    RAISE EXCEPTION 'Demo AMM already initialized for this market';
  END IF;

  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price  := lmsr_price(v_b, 0, 0, 'no');

  INSERT INTO demo_amm_state (market_id, liquidity_param, q_yes, q_no,
                              current_yes_price, current_no_price)
  VALUES (p_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  UPDATE demo_markets SET amm_liquidity_param = v_b WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. demo_seed_initial_price — synthetic "market created" trade for charts
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Fixes blank-chart on fresh markets. Inserts a synthetic buy-zero trade into
-- demo_trades at price 0.50 so demo_get_price_history returns a single-point
-- series. Mirrors live behavior of markets showing a flat 50% line pre-first-trade.

CREATE OR REPLACE FUNCTION demo_seed_initial_price(p_market_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
BEGIN
  PERFORM _demo_assert_admin();

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  -- Use the market creator as the synthetic trade user so FK holds.
  INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                           price_per_share, total_cost, post_yes_price, post_no_price,
                           created_at)
  VALUES (v_market.created_by, p_market_id, 'yes'::bet_side, 'buy'::trade_direction,
          0.000001, 0.500000, 0.00, 0.500000, 0.500000, v_market.created_at);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. admin_create_demo_market — atomic: market + outcome + amm + initial price
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_create_demo_market(
  p_question_en TEXT,
  p_question_ar TEXT,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'politics',
  p_keywords TEXT[] DEFAULT '{}',
  p_liquidity_param DECIMAL DEFAULT 5000,
  p_opens_at TIMESTAMPTZ DEFAULT now(),
  p_closes_at TIMESTAMPTZ DEFAULT NULL,
  p_scheduled_outcome TEXT DEFAULT NULL,
  p_resolves_at TIMESTAMPTZ DEFAULT NULL,
  p_image_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
  v_closes_at TIMESTAMPTZ;
  v_resolves_at TIMESTAMPTZ;
BEGIN
  v_admin_id := _demo_assert_admin();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate
  IF p_question_en IS NULL OR length(trim(p_question_en)) = 0 THEN
    RAISE EXCEPTION 'English question is required';
  END IF;
  IF p_question_ar IS NULL OR length(trim(p_question_ar)) = 0 THEN
    RAISE EXCEPTION 'Arabic question is required';
  END IF;
  IF p_scheduled_outcome IS NULL OR p_scheduled_outcome NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Scheduled outcome required (yes or no)';
  END IF;
  IF p_resolves_at IS NULL OR p_resolves_at <= now() THEN
    RAISE EXCEPTION 'resolves_at must be in the future';
  END IF;

  v_closes_at := COALESCE(p_closes_at, p_resolves_at);
  v_resolves_at := p_resolves_at;

  IF v_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;
  IF v_resolves_at < v_closes_at THEN
    RAISE EXCEPTION 'Resolves date must be at or after close date';
  END IF;

  v_b := COALESCE(p_liquidity_param, 5000);
  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- 1. Insert market
  INSERT INTO demo_markets (
    question_en, question_ar, description_en, description_ar,
    category, keywords, amm_liquidity_param,
    opens_at, closes_at, resolves_at,
    created_by, status, image_url, resolution_fee_rate_snapshot
  ) VALUES (
    p_question_en, p_question_ar, p_description_en, p_description_ar,
    p_category, p_keywords, v_b,
    p_opens_at, v_closes_at, v_resolves_at,
    v_admin_id, 'open', p_image_url, 0
  )
  RETURNING id INTO v_market_id;

  -- 2. Insert scheduled outcome (admin-only table)
  INSERT INTO demo_market_scheduled_outcomes (market_id, scheduled_outcome, created_by)
  VALUES (v_market_id, p_scheduled_outcome::bet_side, v_admin_id);

  -- 3. Initialize AMM
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price  := lmsr_price(v_b, 0, 0, 'no');
  INSERT INTO demo_amm_state (market_id, liquidity_param, q_yes, q_no,
                              current_yes_price, current_no_price)
  VALUES (v_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- 4. Seed initial price point so charts render immediately
  INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                           price_per_share, total_cost, post_yes_price, post_no_price)
  VALUES (v_admin_id, v_market_id, 'yes'::bet_side, 'buy'::trade_direction,
          0.000001, 0.500000, 0.00, 0.500000, 0.500000);

  -- 5. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_demo_market', format('Demo market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'category', p_category,
      'liquidity_param', v_b,
      'scheduled_outcome', p_scheduled_outcome,
      'resolves_at', v_resolves_at
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', v_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6),
    'scheduled_outcome', p_scheduled_outcome,
    'resolves_at', v_resolves_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_create_demo_market(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], DECIMAL, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. admin_resolve_demo_market — credits winners, no fees
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Idempotent: double-resolve returns {already_resolved: true}. Winners credited
-- at $1/share (no 1% resolution fee). Reads the answer from
-- demo_market_scheduled_outcomes (admin-only table).

CREATE OR REPLACE FUNCTION admin_resolve_demo_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_schedule RECORD;
  v_pos RECORD;
  v_payout DECIMAL;
  v_total_paid DECIMAL := 0;
  v_winners_paid INTEGER := 0;
  v_new_balance DECIMAL;
BEGIN
  PERFORM _demo_assert_admin();

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

  -- Idempotency: if already resolved, return early
  IF v_market.status = 'resolved' THEN
    RETURN jsonb_build_object(
      'already_resolved', true,
      'outcome', v_market.outcome::text,
      'resolved_at', v_market.resolved_at
    );
  END IF;

  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  SELECT * INTO v_schedule FROM demo_market_scheduled_outcomes
  WHERE market_id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No scheduled outcome for demo market';
  END IF;

  -- Pay winners: shares_held × $1.00 (no resolution fee)
  FOR v_pos IN
    SELECT * FROM demo_positions
    WHERE market_id = p_market_id
      AND side = v_schedule.scheduled_outcome
      AND shares_held > 0
    ORDER BY user_id
  LOOP
    v_payout := v_pos.shares_held * 1.0;

    UPDATE users SET
      demo_balance_usd = demo_balance_usd + v_payout,
      updated_at = NOW()
    WHERE id = v_pos.user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_pos.user_id, 'demo_win', v_payout, v_new_balance, p_market_id,
            'Demo win: ' || ROUND(v_pos.shares_held, 2) || ' shares × $1.00');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  UPDATE demo_markets SET
    status = 'resolved',
    outcome = v_schedule.scheduled_outcome,
    resolved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_market_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/resolve_demo_market', format('Demo market resolved: %s', v_schedule.scheduled_outcome),
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome', v_schedule.scheduled_outcome::text,
      'winners_paid', v_winners_paid,
      'total_paid', ROUND(v_total_paid, 2)
    ));

  RETURN jsonb_build_object(
    'success', true,
    'outcome', v_schedule.scheduled_outcome::text,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2)
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. demo_get_price_history — mirrors get_price_history for demo charts
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION demo_get_price_history(
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
SET search_path = public
AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ := NOW();
  v_interval INTERVAL;
  v_first_trade TIMESTAMPTZ;
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  SELECT MIN(t.created_at) INTO v_first_trade
  FROM demo_trades t WHERE t.market_id = p_market_id;

  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '6H'  THEN v_start := v_end - INTERVAL '6 hours';   v_interval := INTERVAL '2 minutes';
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

  IF p_period != 'ALL' AND v_first_trade IS NOT NULL THEN
    DECLARE
      v_period_duration INTERVAL;
      v_buffer INTERVAL;
    BEGIN
      v_period_duration := v_end - v_start;
      v_buffer := v_period_duration * 0.1;
      IF v_first_trade > v_start + v_period_duration * 0.5 THEN
        v_start := v_first_trade - v_buffer;
      END IF;
    END;
  END IF;

  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(tr.post_yes_price,
        CASE WHEN tr.side::text = 'yes' THEN tr.price_per_share
             ELSE 1 - tr.price_per_share END) AS y_price,
      COALESCE(tr.post_no_price,
        CASE WHEN tr.side::text = 'yes' THEN 1 - tr.price_per_share
             ELSE tr.price_per_share END) AS n_price
    FROM demo_trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;

GRANT EXECUTE ON FUNCTION demo_get_price_history(UUID, TEXT, TIMESTAMPTZ) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. get_demo_conversion_stats — admin funnel KPI
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_demo_conversion_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_stats JSONB;
  v_total_enabled INTEGER;
  v_total_traded  INTEGER;
  v_total_deposited INTEGER;
  v_median_hours DECIMAL;
  v_cohort_7d_enabled  INTEGER;
  v_cohort_7d_deposited INTEGER;
  v_cohort_30d_enabled INTEGER;
  v_cohort_30d_deposited INTEGER;
BEGIN
  PERFORM _demo_assert_admin();

  SELECT COUNT(*) INTO v_total_enabled
  FROM users WHERE demo_first_enabled_at IS NOT NULL;

  SELECT COUNT(*) INTO v_total_traded
  FROM users WHERE demo_first_trade_at IS NOT NULL;

  SELECT COUNT(*) INTO v_total_deposited
  FROM users WHERE first_real_deposit_after_demo_at IS NOT NULL;

  SELECT ROUND(
    EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (
      ORDER BY first_real_deposit_after_demo_at - demo_first_enabled_at
    )) / 3600.0, 2
  ) INTO v_median_hours
  FROM users
  WHERE demo_first_enabled_at IS NOT NULL
    AND first_real_deposit_after_demo_at IS NOT NULL;

  SELECT
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '7 days'),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '7 days' AND first_real_deposit_after_demo_at IS NOT NULL),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '30 days'),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '30 days' AND first_real_deposit_after_demo_at IS NOT NULL)
  INTO v_cohort_7d_enabled, v_cohort_7d_deposited, v_cohort_30d_enabled, v_cohort_30d_deposited
  FROM users;

  v_stats := jsonb_build_object(
    'total_enabled', v_total_enabled,
    'total_traded', v_total_traded,
    'total_deposited_after_demo', v_total_deposited,
    'trade_rate', CASE WHEN v_total_enabled > 0
      THEN ROUND(v_total_traded::DECIMAL / v_total_enabled * 100, 2) ELSE 0 END,
    'deposit_rate', CASE WHEN v_total_enabled > 0
      THEN ROUND(v_total_deposited::DECIMAL / v_total_enabled * 100, 2) ELSE 0 END,
    'median_hours_to_deposit', COALESCE(v_median_hours, 0),
    'cohort_7d', jsonb_build_object(
      'enabled', v_cohort_7d_enabled,
      'deposited', v_cohort_7d_deposited,
      'conversion_rate', CASE WHEN v_cohort_7d_enabled > 0
        THEN ROUND(v_cohort_7d_deposited::DECIMAL / v_cohort_7d_enabled * 100, 2) ELSE 0 END
    ),
    'cohort_30d', jsonb_build_object(
      'enabled', v_cohort_30d_enabled,
      'deposited', v_cohort_30d_deposited,
      'conversion_rate', CASE WHEN v_cohort_30d_enabled > 0
        THEN ROUND(v_cohort_30d_deposited::DECIMAL / v_cohort_30d_enabled * 100, 2) ELSE 0 END
    )
  );

  RETURN v_stats;
END;
$$;

GRANT EXECUTE ON FUNCTION get_demo_conversion_stats() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. admin_list_demo_markets_with_outcomes — admin-only view + schedule
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_list_demo_markets_with_outcomes()
RETURNS TABLE (
  market_id UUID,
  question_en TEXT,
  question_ar TEXT,
  category TEXT,
  status market_status,
  outcome bet_side,
  scheduled_outcome bet_side,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  resolves_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  trade_count INTEGER,
  unique_traders INTEGER,
  amm_liquidity_param DECIMAL,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  PERFORM _demo_assert_admin();

  RETURN QUERY
  SELECT
    m.id, m.question_en, m.question_ar, m.category, m.status,
    m.outcome, s.scheduled_outcome,
    m.opens_at, m.closes_at, m.resolves_at, m.resolved_at,
    m.trade_count, m.unique_traders, m.amm_liquidity_param,
    m.created_at
  FROM demo_markets m
  LEFT JOIN demo_market_scheduled_outcomes s ON s.market_id = m.id
  ORDER BY m.created_at DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_list_demo_markets_with_outcomes() TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. process_deposit — fold first_real_deposit_after_demo_at into the existing UPDATE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Zero behavioral change for non-demo users. For users who previously enabled
-- demo, sets first_real_deposit_after_demo_at = now() (COALESCE-guarded) on
-- their first real deposit. Single UPDATE prevents dual-update race.

CREATE OR REPLACE FUNCTION process_deposit(
  p_user_id UUID,
  p_amount DECIMAL,
  p_currency TEXT,
  p_provider_ref TEXT,
  p_provider TEXT DEFAULT '3pay'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_deposit_id UUID;
  v_existing UUID;
  v_new_balance DECIMAL;
BEGIN
  -- Auth check
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'process_deposit: unauthorized — admin or service_role only';
    END IF;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must be positive';
  END IF;

  -- Idempotency
  SELECT id INTO v_existing FROM deposits WHERE provider_ref = p_provider_ref;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('deposit_id', v_existing, 'status', 'already_processed');
  END IF;

  SELECT rate INTO v_deposit_fee_rate
  FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

  v_fee := p_amount * COALESCE(v_deposit_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO deposits (user_id, amount, fee, net_amount, currency, provider_ref, provider, status, confirmed_at)
  VALUES (p_user_id, p_amount, v_fee, v_net_amount, p_currency, p_provider_ref, p_provider, 'confirmed', NOW())
  RETURNING id INTO v_deposit_id;

  -- Single UPDATE folds balance credit + conversion analytics column.
  -- first_real_deposit_after_demo_at is set only if user previously enabled demo
  -- AND column is still null (COALESCE guard).
  UPDATE users SET
    balance_usd = balance_usd + v_net_amount,
    first_real_deposit_after_demo_at = COALESCE(
      first_real_deposit_after_demo_at,
      CASE WHEN demo_first_enabled_at IS NOT NULL THEN NOW() ELSE NULL END
    )
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_user_id, 'deposit', v_net_amount,
    v_new_balance,
    v_deposit_id,
    'Deposit ' || p_currency || ' via ' || p_provider
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'net_amount', v_net_amount,
    'status', 'confirmed'
  );
END;
$$;

COMMIT;
