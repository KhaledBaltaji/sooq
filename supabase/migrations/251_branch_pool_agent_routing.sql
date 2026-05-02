-- ═══════════════════════════════════════════════════════════════════
-- Migration 251: Branch Pool Agent Routing + Commission-Type Activation
--                (PR 2 of 3)
--
-- Plan reference: ~/.claude/plans/glittery-wiggling-lagoon.md
--   "PR 2 IMPLEMENTATION PLAN — Migration 251" section.
--
-- WHAT THIS DOES
--   1. Extends `branch_pools.type` enum with 'agent_commission'.
--   2. Extends `referral_commissions` with `source_type` enum and
--      `branch_id`, making it the single source of truth for both
--      retail and branch commissions.
--   3. Introduces `_credit_branch_commission` — mirrors PR 1's
--      unlock_at logic for branch-agent commissions, without retail
--      tier lookup or activation gate.
--   4. Re-creates `execute_branch_trade` from its LATEST baseline
--      (migration 237) with an inserted commission block in the buy
--      path. Commission = markup × agent.rate, paid only if the
--      referring agent is commission-type, active, and the branch
--      is not in payback mode.
--
-- WHY NOW
--   Before this migration, approved branch agents earned $0 even on
--   their referred users' trades (see migration 211/237 buy path —
--   no commission write exists). Commission-type logic is simpler
--   (volume-based, trade-time) so it ships in PR 2. P/L settlement
--   is deferred to PR 3.
--
-- COMMISSION FORMULA (product-decided)
--   commission = markup × branch_agent.rate
--   Guarantees the pool never goes negative — pool keeps
--   markup × (1 − agent_rate) ≥ 0.
--
-- RELIES ON
--   • PR 1 (migration 250) — fee_config.commission_hold_enabled +
--     unlock_at semantics.
--   • branch_user_assignments.agent_id (migration 205) — tells us
--     who referred the trader.
--
-- BASELINE
--   execute_branch_trade function body here is copied from
--   migration 237 verbatim. ONLY the buy path gains an injected
--   commission block. Sell path is unchanged (sells have no markup,
--   so no commission on cash-outs).
-- ═══════════════════════════════════════════════════════════════════


-- ============================================================
-- 1. Extend branch_pools.type enum
-- ============================================================
ALTER TYPE branch_pool_entry_type ADD VALUE IF NOT EXISTS 'agent_commission';


-- ============================================================
-- 2. Extend referral_commissions schema
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'commission_source_type') THEN
    CREATE TYPE commission_source_type AS ENUM (
      'referral_trade',
      'referral_resolution',
      'branch_commission',
      'branch_pl'
    );
  END IF;
END $$;

ALTER TABLE referral_commissions
  ADD COLUMN IF NOT EXISTS source_type commission_source_type
    NOT NULL DEFAULT 'referral_trade';

ALTER TABLE referral_commissions
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

COMMENT ON COLUMN referral_commissions.source_type IS
'Discriminator: which commission flow produced this row. referral_trade/referral_resolution for retail, branch_commission for branch commission-type agents (PR 2), branch_pl reserved for PR 3.';

COMMENT ON COLUMN referral_commissions.branch_id IS
'Non-null for branch-sourced commissions. References branches(id) for scoped reporting.';

CREATE INDEX IF NOT EXISTS idx_referral_commissions_branch
  ON referral_commissions (branch_id)
  WHERE branch_id IS NOT NULL;

-- Backfill resolution-type retail rows for semantic accuracy.
-- Functionally inert (no code path filters by source_type yet).
UPDATE referral_commissions
   SET source_type = 'referral_resolution'
 WHERE revenue_type = 'resolution'
   AND source_type = 'referral_trade'
   AND branch_id IS NULL;


-- ============================================================
-- 3. Helper: _credit_branch_commission
-- ============================================================

CREATE OR REPLACE FUNCTION _credit_branch_commission(
  p_branch_id     UUID,
  p_agent_user_id UUID,
  p_trader_id     UUID,
  p_market_id     UUID,
  p_trade_id      UUID,
  p_amount        DECIMAL,
  p_markup_amount DECIMAL,
  p_agent_rate    DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_hold_enabled DECIMAL;
  v_unlock_at    TIMESTAMPTZ;
  v_new_balance  DECIMAL;
BEGIN
  IF p_amount < 0.01 THEN
    RETURN 0;
  END IF;

  SELECT rate INTO v_hold_enabled
    FROM fee_config
   WHERE fee_type = 'commission_hold_enabled'
   LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id,
    layer, agent_level_at_time,
    platform_revenue_amount, commission_rate, commission_amount,
    status, revenue_type,
    unlock_at, source_type, branch_id
  ) VALUES (
    p_agent_user_id, p_trader_id, p_market_id, p_trade_id,
    1, 1,
    p_markup_amount, p_agent_rate, p_amount,
    'credited'::commission_status, 'trade',
    v_unlock_at, 'branch_commission'::commission_source_type, p_branch_id
  );

  UPDATE users
     SET agent_balance_usd = agent_balance_usd + p_amount
   WHERE id = p_agent_user_id
   RETURNING agent_balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_agent_user_id, 'commission', p_amount, v_new_balance,
    COALESCE(p_trade_id, p_market_id),
    'Branch Commission — ' || ROUND(p_agent_rate * 100, 1) || '% of $'
      || ROUND(p_markup_amount, 2) || ' markup'
  );

  RETURN p_amount;
END;
$$;

REVOKE ALL ON FUNCTION _credit_branch_commission(UUID, UUID, UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL) FROM PUBLIC;


-- ============================================================
-- 4. Re-create execute_branch_trade from migration 237 baseline,
--    with inserted commission block in the buy path.
--    Sell path is identical to 237 (no markup → no commission).
-- ============================================================

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

  v_price_impact_cap DECIMAL;
  v_min_trade DECIMAL;

  v_markup_pct DECIMAL;
  v_markup_amount DECIMAL;
  v_net_canonical DECIMAL;

  v_sooq_fee DECIMAL := 0;
  v_net_pool_inflow DECIMAL;

  v_b DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_price_per_share DECIMAL;
  v_price_impact DECIMAL;

  v_gross_proceeds DECIMAL;
  v_exit_fee DECIMAL;
  v_net_proceeds DECIMAL;
  v_sell_pnl DECIMAL;
  v_cash_out_enabled BOOLEAN;

  v_solvency JSONB;
  v_old_worst_case DECIMAL;
  v_new_worst_case DECIMAL;
  v_worst_case_delta DECIMAL;

  v_position_cap DECIMAL;
  v_current_shares DECIMAL := 0;

  v_sweep DECIMAL := 0;

  v_trade_id UUID;
  v_branch_trade_id UUID;

  -- ───── PR 2 NEW ─────
  v_agent RECORD;
  v_agent_commission DECIMAL;
  v_pool_balance_after_commission DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

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

  SELECT * INTO v_assignment
  FROM branch_user_assignments
  WHERE user_id = v_user_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  SELECT * INTO v_market_config
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  IF FOUND AND NOT v_market_config.is_enabled THEN
    RAISE EXCEPTION 'Market is disabled for this branch';
  END IF;

  SELECT rate INTO v_price_impact_cap FROM fee_config
  WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;

  SELECT rate INTO v_min_trade FROM fee_config
  WHERE fee_type = 'min_trade_amount' AND level IS NULL;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══

    IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
      RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
    END IF;

    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_markup_pct := CASE WHEN p_side = 'yes' THEN v_branch.yes_markup_pct
                         ELSE v_branch.no_markup_pct END;
    v_markup_amount := ROUND(p_amount * v_markup_pct, 2);
    v_net_canonical := p_amount - v_markup_amount;

    IF v_net_canonical <= 0 THEN
      RAISE EXCEPTION 'Trade too small after markup';
    END IF;

    v_sooq_fee := ROUND(p_amount * v_branch.branch_fee_rate, 2);
    v_net_pool_inflow := p_amount - v_sooq_fee;

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

    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_canonical);

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

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

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap (%.1f%% > %.1f%%)',
        v_price_impact * 100, v_price_impact_cap * 100;
    END IF;

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

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

      SELECT COALESCE(SUM(amount), 0) INTO v_est_pool_cash
      FROM branch_pools
      WHERE branch_id = p_branch_id AND market_id = p_market_id;

      v_est_pool_cash := v_est_pool_cash + v_net_pool_inflow;

      v_est_worst := GREATEST(0,
        GREATEST(v_est_yes_shares * 0.99, v_est_no_shares * 0.99) - v_est_pool_cash
      );

      v_worst_case_delta := v_est_worst - v_old_worst_case;
    END;

    v_solvency := branch_solvency_check(p_branch_id, v_net_pool_inflow, v_worst_case_delta);

    IF NOT (v_solvency->>'can_trade')::BOOLEAN THEN
      RAISE EXCEPTION 'Branch solvency gate: trade rejected (utilization %)',
        v_solvency->>'utilization';
    END IF;

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

    v_price_per_share := v_net_canonical / v_shares;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_net_canonical, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, p_branch_id, v_shares, v_price_per_share, v_net_canonical)
    ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_canonical) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_canonical;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, 0, v_markup_amount, 0,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

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

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_buy', p_amount,
            v_branch.pool_balance + p_amount, v_trade_id,
            'Buy ' || p_side || ' — gross $' || p_amount || ', markup $' || v_markup_amount);

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

    IF v_sooq_fee > 0 THEN
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (p_branch_id, p_market_id, 'sooq_branch_fee', -v_sooq_fee,
              v_branch.pool_balance + p_amount - v_sweep - v_sooq_fee, v_trade_id,
              'SOOQ ' || ROUND(v_branch.branch_fee_rate * 100, 1) || '% fee on $' || p_amount || ' buy volume');
    END IF;

    UPDATE branches SET
      pool_balance = pool_balance + p_amount - v_sooq_fee - v_sweep,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    -- ═══ PR 2 NEW: commission-type branch agent payout ═══
    -- Runs AFTER the main pool update so pool_balance reflects inflows
    -- and any payback sweep. We debit commission on top of that.
    -- Skipped during payback mode (agents wait until branch recovers).
    IF v_branch.status != 'payback' AND v_assignment.agent_id IS NOT NULL THEN
      SELECT user_id, rate, agent_type, is_active
      INTO v_agent
      FROM branch_agents
      WHERE id = v_assignment.agent_id;

      IF FOUND AND v_agent.is_active AND v_agent.agent_type = 'commission' THEN
        v_agent_commission := ROUND(v_markup_amount * v_agent.rate, 2);

        IF v_agent_commission >= 0.01 THEN
          UPDATE branches
             SET pool_balance = pool_balance - v_agent_commission
           WHERE id = p_branch_id
           RETURNING pool_balance INTO v_pool_balance_after_commission;

          INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
          VALUES (
            p_branch_id, p_market_id, 'agent_commission',
            -v_agent_commission, v_pool_balance_after_commission, v_trade_id,
            'Agent commission — ' || ROUND(v_agent.rate * 100, 1) || '% of $'
              || ROUND(v_markup_amount, 2) || ' markup'
          );

          PERFORM _credit_branch_commission(
            p_branch_id,
            v_agent.user_id,
            v_user_id,
            p_market_id,
            v_trade_id,
            v_agent_commission,
            v_markup_amount,
            v_agent.rate
          );
        END IF;
      END IF;
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id,
            'Branch buy ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id;

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

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH (unchanged from migration 237) ═══
    -- Sells have no markup, so no commission payment.

    v_cash_out_enabled := COALESCE(v_market_config.cash_out_enabled, v_branch.cash_out_enabled);
    IF NOT v_cash_out_enabled THEN
      RAISE EXCEPTION 'Cash-out is disabled for this market';
    END IF;

    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id
      AND side = p_side::bet_side AND branch_id = p_branch_id
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

    IF v_branch.pool_balance < v_gross_proceeds THEN
      RAISE EXCEPTION 'Branch pool insufficient for cash-out';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_exit_fee := ROUND(v_gross_proceeds * v_branch.exit_fee_pct, 2);
    v_net_proceeds := v_gross_proceeds - v_exit_fee;
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

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

    UPDATE positions SET shares_held = 0, total_invested = 0
    WHERE id = v_position.id AND shares_held > 0 AND shares_held < 0.001;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, 0, 0, v_exit_fee,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

    INSERT INTO branch_trades (
      trade_id, branch_id, agent_id, user_id, market_id,
      gross_amount, branch_markup, net_canonical_amount, branch_quote_shown,
      canonical_pre_yes_price, canonical_pre_no_price,
      canonical_post_yes_price, canonical_post_no_price,
      shares_issued, idempotency_key,
      side, direction, exit_fee_amount
    ) VALUES (
      v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
      v_gross_proceeds, 0, v_net_proceeds, v_price_per_share,
      v_amm.current_yes_price, v_amm.current_no_price,
      v_new_yes_price, v_new_no_price,
      v_shares_to_sell, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
      p_side::bet_side, 'sell', v_exit_fee
    );

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_sell', -v_gross_proceeds,
            v_branch.pool_balance - v_gross_proceeds, v_trade_id,
            'Sell ' || p_side || ' — payout $' || v_gross_proceeds);

    IF v_exit_fee > 0 THEN
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (p_branch_id, p_market_id, 'exit_fee', v_exit_fee,
              v_branch.pool_balance - v_gross_proceeds + v_exit_fee, v_trade_id,
              'Exit fee retained $' || v_exit_fee);
    END IF;

    v_new_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);
    v_worst_case_delta := v_new_worst_case - v_old_worst_case;

    UPDATE branches SET
      pool_balance = pool_balance - v_gross_proceeds + v_exit_fee,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 AND v_exit_fee > 0 THEN
      DECLARE v_sell_sweep DECIMAL;
      BEGIN
        v_sell_sweep := LEAST(v_exit_fee, v_branch.pending_payouts);
        IF v_sell_sweep > 0 THEN
          INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
          VALUES (p_branch_id, 'payback_sweep', -v_sell_sweep,
                  v_branch.pool_balance - v_gross_proceeds + v_exit_fee - v_sell_sweep,
                  'Payback sweep on exit fee');
          UPDATE branches SET
            pending_payouts = GREATEST(0, pending_payouts - v_sell_sweep),
            pool_balance = pool_balance - v_sell_sweep
          WHERE id = p_branch_id;
        END IF;
      END;
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_user.balance_usd + v_net_proceeds, v_trade_id,
            'Branch sell ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'trade_id', v_trade_id,
      'shares', ROUND(v_shares_to_sell, 6),
      'price_per_share', ROUND(v_price_per_share, 6),
      'gross_proceeds', ROUND(v_gross_proceeds, 2),
      'exit_fee', ROUND(v_exit_fee, 2),
      'net_proceeds', ROUND(v_net_proceeds, 2),
      'new_yes_price', ROUND(v_new_yes_price, 6),
      'new_no_price', ROUND(v_new_no_price, 6),
      'price_impact', ROUND(v_price_impact, 6)
    );

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;
END;
$$;
