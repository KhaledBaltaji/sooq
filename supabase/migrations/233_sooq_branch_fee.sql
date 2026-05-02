-- ============================================================
-- 233: SOOQ Branch Fee — Wire branch_fee_rate into execution
--
-- The branch_fee_rate column (default 5%, range 0-20%) has existed
-- on the branches table since migration 202, but was never read
-- or applied. This migration:
--
-- 1. Adds 'sooq_branch_fee' enum value to branch_pool_entry_type
-- 2. Adds sooq_fee_revenue column to branch_revenue
-- 3. Updates execute_branch_trade (buy) to deduct fee from pool
-- 4. Updates _branch_worst_case_market to use SUM(amount) instead
--    of selective CASE (unifies with reconcile_branch_solvency)
-- 5. Updates record_branch_revenue to track SOOQ fees
-- 6. Updates accounting RPCs to surface branch fee revenue
--
-- Fee is charged on GROSS BUY VOLUME only (not sells/exits).
-- Deducted from branch pool in real-time on each buy.
-- SOOQ fee is senior to payback sweep (guaranteed revenue).
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. Add enum value
-- ═══════════════════════════════════════════════════════════

ALTER TYPE branch_pool_entry_type ADD VALUE IF NOT EXISTS 'sooq_branch_fee';

-- ═══════════════════════════════════════════════════════════
-- 2. Add column to branch_revenue
-- ═══════════════════════════════════════════════════════════

ALTER TABLE branch_revenue ADD COLUMN IF NOT EXISTS sooq_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════
-- 3. Update _branch_worst_case_market — use SUM(amount)
--    Unifies with reconcile_branch_solvency (migration 219)
--    which already uses SUM(amount). Prevents divergence when
--    new entry types are added to branch_pool_entry_type.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _branch_worst_case_market(
  p_branch_id UUID,
  p_market_id UUID
)
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yes_shares DECIMAL := 0;
  v_no_shares DECIMAL := 0;
  v_pool_cash DECIMAL := 0;
  v_worst DECIMAL;
BEGIN
  SELECT COALESCE(SUM(shares_held), 0) INTO v_yes_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;

  SELECT COALESCE(SUM(shares_held), 0) INTO v_no_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

  -- All entry types affect pool cash (unified with reconcile_branch_solvency)
  SELECT COALESCE(SUM(amount), 0) INTO v_pool_cash
  FROM branch_pools
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  v_worst := GREATEST(0,
    GREATEST(v_yes_shares * 0.99, v_no_shares * 0.99) - v_pool_cash
  );

  RETURN v_worst;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. Update execute_branch_trade — add SOOQ fee on buys
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION execute_branch_trade(
  p_market_id UUID,
  p_branch_id UUID,
  p_side TEXT,
  p_amount DECIMAL DEFAULT NULL,
  p_shares_to_sell DECIMAL DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
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
  v_branch RECORD;
  v_position RECORD;
  v_assignment RECORD;
  v_market_config RECORD;

  -- Fee/config
  v_price_impact_cap DECIMAL;
  v_min_trade DECIMAL;

  -- Markup
  v_markup_pct DECIMAL;
  v_markup_amount DECIMAL;
  v_net_canonical DECIMAL;

  -- SOOQ fee
  v_sooq_fee DECIMAL := 0;
  v_net_pool_inflow DECIMAL;

  -- LMSR
  v_b DECIMAL;
  v_shares DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_price_per_share DECIMAL;
  v_price_impact DECIMAL;

  -- Solvency
  v_solvency JSONB;
  v_old_worst_case DECIMAL;
  v_new_worst_case DECIMAL;
  v_worst_case_delta DECIMAL;

  -- Position cap
  v_position_cap DECIMAL;
  v_current_shares DECIMAL := 0;

  -- Payback sweep
  v_sweep DECIMAL := 0;

  -- Output
  v_trade_id UUID;
  v_branch_trade_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Bypass protected columns trigger
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ═══ BUY PATH ONLY in this migration (sell in 212) ═══
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Buy requires positive p_amount';
  END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT bt.id INTO v_branch_trade_id
    FROM branch_trades bt
    WHERE bt.branch_id = p_branch_id AND bt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'trade_id', v_branch_trade_id,
        'idempotent', true,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  -- Lock order: user → market → amm_state → branches
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

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.status IN ('frozen', 'suspended') THEN
    RAISE EXCEPTION 'Branch is %', v_branch.status;
  END IF;

  -- Validate user is assigned to this branch
  SELECT * INTO v_assignment
  FROM branch_user_assignments
  WHERE user_id = v_user_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  -- Check if market is enabled for this branch
  SELECT * INTO v_market_config
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  IF FOUND AND NOT v_market_config.is_enabled THEN
    RAISE EXCEPTION 'Market is disabled for this branch';
  END IF;

  -- Read config
  SELECT rate INTO v_price_impact_cap FROM fee_config
  WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;

  SELECT rate INTO v_min_trade FROM fee_config
  WHERE fee_type = 'min_trade_amount' AND level IS NULL;

  -- Minimum trade guard
  IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
    RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
  END IF;

  -- Check user balance
  IF p_amount > v_user.balance_usd THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ═══ MARKUP EXTRACTION ═══
  v_markup_pct := CASE WHEN p_side = 'yes' THEN v_branch.yes_markup_pct
                       ELSE v_branch.no_markup_pct END;
  v_markup_amount := ROUND(p_amount * v_markup_pct, 2);
  v_net_canonical := p_amount - v_markup_amount;

  IF v_net_canonical <= 0 THEN
    RAISE EXCEPTION 'Trade too small after markup';
  END IF;

  -- ═══ SOOQ FEE CALCULATION (on gross buy volume) ═══
  v_sooq_fee := ROUND(p_amount * v_branch.branch_fee_rate, 2);
  v_net_pool_inflow := p_amount - v_sooq_fee;

  -- ═══ POSITION CAP CHECK ═══
  v_position_cap := CASE WHEN p_side = 'yes' THEN
    COALESCE(v_market_config.position_cap_yes, v_branch.default_position_cap_yes)
  ELSE
    COALESCE(v_market_config.position_cap_no, v_branch.default_position_cap_no)
  END;

  IF v_position_cap IS NOT NULL THEN
    SELECT COALESCE(shares_held, 0) INTO v_current_shares
    FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id
      AND side = p_side::bet_side AND branch_id = p_branch_id;
  END IF;

  -- ═══ LMSR EXECUTION ═══
  v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_canonical);

  IF v_shares <= 0 THEN
    RAISE EXCEPTION 'Trade too small';
  END IF;

  -- Position cap enforcement
  IF v_position_cap IS NOT NULL AND (v_current_shares + v_shares) * 0.99 > v_position_cap THEN
    RAISE EXCEPTION 'Position cap exceeded (max $%)', v_position_cap;
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

  -- ═══ PRICE IMPACT CAP ═══
  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
  IF v_price_impact > v_price_impact_cap THEN
    RAISE EXCEPTION 'Price impact exceeds cap (%.1f%% > %.1f%%)',
      v_price_impact * 100, v_price_impact_cap * 100;
  END IF;

  -- ═══ SOLVENCY GATE ═══
  v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

  -- Estimate post-trade worst case
  DECLARE
    v_est_yes_shares DECIMAL;
    v_est_no_shares DECIMAL;
    v_est_pool_cash DECIMAL;
    v_est_worst DECIMAL;
  BEGIN
    SELECT COALESCE(SUM(shares_held), 0) INTO v_est_yes_shares
    FROM positions
    WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;

    SELECT COALESCE(SUM(shares_held), 0) INTO v_est_no_shares
    FROM positions
    WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

    IF p_side = 'yes' THEN
      v_est_yes_shares := v_est_yes_shares + v_shares;
    ELSE
      v_est_no_shares := v_est_no_shares + v_shares;
    END IF;

    -- Use SUM(amount) to match _branch_worst_case_market
    SELECT COALESCE(SUM(amount), 0) INTO v_est_pool_cash
    FROM branch_pools
    WHERE branch_id = p_branch_id AND market_id = p_market_id;

    -- Add net pool inflow (gross minus SOOQ fee)
    v_est_pool_cash := v_est_pool_cash + v_net_pool_inflow;

    v_est_worst := GREATEST(0,
      GREATEST(v_est_yes_shares * 0.99, v_est_no_shares * 0.99) - v_est_pool_cash
    );

    v_worst_case_delta := v_est_worst - v_old_worst_case;
  END;

  -- Check solvency with net inflow (after SOOQ fee)
  v_solvency := branch_solvency_check(p_branch_id, v_net_pool_inflow, v_worst_case_delta);

  IF NOT (v_solvency->>'can_trade')::BOOLEAN THEN
    RAISE EXCEPTION 'Branch solvency gate: trade rejected (utilization %)',
      v_solvency->>'utilization';
  END IF;

  -- ═══ PAYBACK MODE: additional constraint ═══
  IF v_branch.status = 'payback' THEN
    DECLARE
      v_post_pool DECIMAL;
      v_after_reserving DECIMAL;
    BEGIN
      v_post_pool := v_branch.pool_balance + v_net_pool_inflow;
      v_after_reserving := v_post_pool - v_branch.pending_payouts;
      IF v_after_reserving < (v_branch.worst_case_total + v_worst_case_delta) THEN
        RAISE EXCEPTION 'Payback mode: insufficient post-trade coverage';
      END IF;
    END;
  END IF;

  -- ═══ ALL CHECKS PASSED — EXECUTE ═══

  v_price_per_share := v_net_canonical / v_shares;

  -- Update canonical AMM state (shared with retail)
  UPDATE amm_state SET
    q_yes = v_new_q_yes, q_no = v_new_q_no,
    current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
    total_volume = total_volume + v_net_canonical, total_trades = total_trades + 1,
    updated_at = NOW()
  WHERE market_id = p_market_id;

  -- Insert position (with branch_id)
  INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
  VALUES (v_user_id, p_market_id, p_side::bet_side, p_branch_id, v_shares, v_price_per_share, v_net_canonical)
  ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
    avg_entry_price = (positions.total_invested + v_net_canonical) / (positions.shares_held + v_shares),
    shares_held = positions.shares_held + v_shares,
    total_invested = positions.total_invested + v_net_canonical;

  -- Insert canonical trade record (with branch_id)
  INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                      total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                      post_yes_price, post_no_price, branch_id)
  VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
          v_price_per_share, p_amount, 0, v_markup_amount, 0,
          v_new_yes_price, v_new_no_price, p_branch_id)
  RETURNING id INTO v_trade_id;

  -- Insert branch audit trail
  INSERT INTO branch_trades (
    trade_id, branch_id, agent_id, user_id, market_id,
    gross_amount, branch_markup, net_canonical_amount,
    branch_quote_shown,
    canonical_pre_yes_price, canonical_pre_no_price,
    canonical_post_yes_price, canonical_post_no_price,
    shares_issued, idempotency_key,
    side, direction, exit_fee_amount
  ) VALUES (
    v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
    p_amount, v_markup_amount, v_net_canonical,
    v_price_per_share,
    v_amm.current_yes_price, v_amm.current_no_price,
    v_new_yes_price, v_new_no_price,
    v_shares, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
    p_side::bet_side, 'buy', 0
  );

  -- Credit branch pool (gross amount)
  INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
  VALUES (p_branch_id, p_market_id, 'trade_buy', p_amount,
          v_branch.pool_balance + p_amount, v_trade_id,
          'Buy ' || p_side || ' — gross $' || p_amount || ', markup $' || v_markup_amount);

  -- Payback sweep: if in payback mode, sweep inflow to pending payouts
  -- SOOQ fee is senior — sweep ceiling is gross minus fee
  IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 THEN
    v_sweep := LEAST(v_net_pool_inflow, v_branch.pending_payouts);
    IF v_sweep > 0 THEN
      INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
      VALUES (p_branch_id, 'payback_sweep', -v_sweep,
              v_branch.pool_balance + p_amount - v_sweep,
              'Payback sweep on buy inflow');

      UPDATE branches SET
        pending_payouts = GREATEST(0, pending_payouts - v_sweep)
      WHERE id = p_branch_id;
    END IF;
  END IF;

  -- SOOQ fee deduction (AFTER payback sweep, fee is guaranteed)
  IF v_sooq_fee > 0 THEN
    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'sooq_branch_fee', -v_sooq_fee,
            v_branch.pool_balance + p_amount - v_sweep - v_sooq_fee, v_trade_id,
            'SOOQ ' || ROUND(v_branch.branch_fee_rate * 100, 1) || '% fee on $' || p_amount || ' buy volume');
  END IF;

  -- Update branch pool balance cache + worst_case_total (single UPDATE)
  UPDATE branches SET
    pool_balance = pool_balance + p_amount - v_sooq_fee - v_sweep,
    worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
    updated_at = NOW()
  WHERE id = p_branch_id;

  -- Debit user balance
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id,
          'Branch buy ' || p_side || ' shares');

  UPDATE users SET
    balance_usd = balance_usd - p_amount,
    total_wagered = total_wagered + p_amount,
    updated_at = NOW()
  WHERE id = v_user_id;

  -- Update market stats
  UPDATE markets SET
    trade_count = trade_count + 1,
    unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(v_shares, 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(p_amount, 2),
    'markup', ROUND(v_markup_amount, 2),
    'net_canonical', ROUND(v_net_canonical, 2),
    'sooq_fee', ROUND(v_sooq_fee, 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6),
    'solvency_status', v_solvency->>'status'
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. Update record_branch_revenue — add SOOQ fee tracking
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_branch_revenue(
  p_market_id UUID,
  p_branch_id UUID,
  p_outcome bet_side,
  p_resolution_fee_collected DECIMAL DEFAULT 0
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_markup DECIMAL;
  v_explicit DECIMAL;
  v_exit DECIMAL;
  v_sooq_fee DECIMAL;
  v_total DECIMAL;
BEGIN
  -- Sum markup fees from branch buy trades
  SELECT COALESCE(SUM(branch_markup), 0) INTO v_markup
  FROM branch_trades
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND direction = 'buy';

  -- Sum explicit fees from trades table (branch trades)
  SELECT COALESCE(SUM(explicit_fee), 0) INTO v_explicit
  FROM trades
  WHERE market_id = p_market_id AND branch_id = p_branch_id;

  -- Sum exit fees from branch sell trades
  SELECT COALESCE(SUM(exit_fee_amount), 0) INTO v_exit
  FROM branch_trades
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND direction = 'sell';

  -- Sum SOOQ fees from branch_pools ledger
  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_sooq_fee
  FROM branch_pools
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND type = 'sooq_branch_fee';

  -- total_revenue is GROSS (branch's fees earned, NOT reduced by SOOQ cut)
  v_total := v_markup + v_explicit + v_exit + p_resolution_fee_collected;

  INSERT INTO branch_revenue (
    branch_id, market_id, markup_revenue, explicit_fee_revenue,
    exit_fee_revenue, resolution_fee_revenue, sooq_fee_revenue, total_revenue
  ) VALUES (
    p_branch_id, p_market_id, v_markup, v_explicit,
    v_exit, p_resolution_fee_collected, v_sooq_fee, v_total
  )
  ON CONFLICT (branch_id, market_id) DO UPDATE SET
    markup_revenue = EXCLUDED.markup_revenue,
    explicit_fee_revenue = EXCLUDED.explicit_fee_revenue,
    exit_fee_revenue = EXCLUDED.exit_fee_revenue,
    resolution_fee_revenue = EXCLUDED.resolution_fee_revenue,
    sooq_fee_revenue = EXCLUDED.sooq_fee_revenue,
    total_revenue = EXCLUDED.total_revenue;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. Update get_accounting_branches — surface SOOQ fee
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_branches(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(br.total_revenue), 0) as total_branch_revenue,
          COALESCE(SUM(br.markup_revenue), 0) as total_markup_revenue,
          COALESCE(SUM(br.explicit_fee_revenue), 0) as total_explicit_fee_revenue,
          COALESCE(SUM(br.exit_fee_revenue), 0) as total_exit_fee_revenue,
          COALESCE(SUM(br.resolution_fee_revenue), 0) as total_resolution_fee_revenue,
          COALESCE(SUM(br.sooq_fee_revenue), 0) as total_sooq_fee_revenue,
          COALESCE((
            SELECT SUM(ba.cumulative_pl)
            FROM branch_agents ba
            WHERE ba.is_active = true
          ), 0) as total_agent_payouts
        FROM branch_revenue br
        WHERE br.created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'branches', (
      SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.total_revenue DESC), '[]'::jsonb)
      FROM (
        SELECT
          br_agg.branch_id,
          bch.name as branch_name,
          bch.branch_code as branch_code,
          bch.status as branch_status,
          bch.branch_fee_rate,
          br_agg.markup_revenue,
          br_agg.explicit_fee_revenue,
          br_agg.exit_fee_revenue,
          br_agg.resolution_fee_revenue,
          br_agg.sooq_fee_revenue,
          br_agg.total_revenue,
          COALESCE(agent_agg.agent_payouts, 0) as agent_payouts,
          br_agg.sooq_fee_revenue + (br_agg.total_revenue - COALESCE(agent_agg.agent_payouts, 0)) as net_to_platform,
          COALESCE(agent_agg.agent_count, 0) as agent_count
        FROM (
          SELECT
            br.branch_id,
            SUM(br.markup_revenue) as markup_revenue,
            SUM(br.explicit_fee_revenue) as explicit_fee_revenue,
            SUM(br.exit_fee_revenue) as exit_fee_revenue,
            SUM(br.resolution_fee_revenue) as resolution_fee_revenue,
            SUM(br.sooq_fee_revenue) as sooq_fee_revenue,
            SUM(br.total_revenue) as total_revenue
          FROM branch_revenue br
          WHERE br.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY br.branch_id
        ) br_agg
        JOIN branches bch ON bch.id = br_agg.branch_id
        LEFT JOIN (
          SELECT
            ba.branch_id,
            SUM(ba.cumulative_pl) as agent_payouts,
            COUNT(*) as agent_count
          FROM branch_agents ba
          WHERE ba.is_active = true
          GROUP BY ba.branch_id
        ) agent_agg ON agent_agg.branch_id = br_agg.branch_id
      ) b
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. Update get_accounting_pnl — add branch fee revenue
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_pnl(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
    'revenue', (
      SELECT row_to_json(r) FROM (
        SELECT
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE(SUM(dynamic_spread), 0) as dynamic_spread,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0) as trade_revenue,
          COALESCE((
            SELECT SUM(resolution_fee_revenue)
            FROM platform_revenue
            WHERE created_at BETWEEN p_start_date AND p_end_date
          ), 0) as resolution_fees,
          COALESCE((
            SELECT SUM(ABS(amount))
            FROM branch_pools
            WHERE type = 'sooq_branch_fee' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as branch_fee_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((
                SELECT SUM(resolution_fee_revenue)
                FROM platform_revenue
                WHERE created_at BETWEEN p_start_date AND p_end_date
              ), 0)
            + COALESCE((
                SELECT SUM(ABS(amount))
                FROM branch_pools
                WHERE type = 'sooq_branch_fee' AND created_at BETWEEN p_start_date AND p_end_date
              ), 0) as gross_revenue
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) r
    ),
    'costs', (
      SELECT row_to_json(c) FROM (
        SELECT
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_escrowed,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_losses,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl >= 0 THEN a.seed_pnl ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_gains,
          COALESCE((
            SELECT SUM(a.seed_pnl)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_net_pnl
        ) c
    ),
    'previous_period', (
      SELECT row_to_json(pp) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN v_prev_start AND p_start_date), 0)
            + COALESCE((SELECT SUM(ABS(amount)) FROM branch_pools WHERE type = 'sooq_branch_fee' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as gross_revenue,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN v_prev_start AND p_start_date
          ), 0) as amm_losses
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) pp
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          tr.date,
          tr.revenue,
          COALESCE(rc_agg.commissions, 0) as commissions,
          0 as amm_losses
        FROM (
          SELECT
            t.created_at::date as date,
            COALESCE(SUM(t.explicit_fee + t.amm_spread_cost + t.cash_out_premium + COALESCE(t.dynamic_spread, 0)), 0) as revenue
          FROM trades t
          WHERE t.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY t.created_at::date
        ) tr
        LEFT JOIN (
          SELECT rc.created_at::date as date, SUM(rc.commission_amount) as commissions
          FROM referral_commissions rc
          WHERE rc.status = 'credited' AND rc.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY rc.created_at::date
        ) rc_agg ON rc_agg.date = tr.date
      ) d
    )
  );
END;
$$;
