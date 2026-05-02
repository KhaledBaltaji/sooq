-- ============================================================
-- 210: S2 Branch System — branch_solvency_check
--
-- Pure function: computes branch solvency metrics per Section 23.
-- No side effects. Called by execute_branch_trade as pre-trade gate
-- and by admin dashboard for display.
--
-- worst_case_market = max(0, max(yes_shares*0.99, no_shares*0.99) - pool_cash_collected)
-- worst_case_total = SUM(worst_case_market) across active markets
-- utilization = (pending_payouts + worst_case_total) / pool_balance
-- Thresholds: <80% green, 80-95% yellow, >=95% red (blocked)
-- ============================================================

-- Helper: compute worst-case liability for a single branch in a single market
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
  -- Sum all YES shares held by branch users in this market
  SELECT COALESCE(SUM(shares_held), 0) INTO v_yes_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;

  -- Sum all NO shares held by branch users in this market
  SELECT COALESCE(SUM(shares_held), 0) INTO v_no_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

  -- Sum net cash collected by branch pool for this market (buys - sells)
  SELECT COALESCE(SUM(
    CASE WHEN type IN ('trade_buy', 'exit_fee') THEN amount
         WHEN type = 'trade_sell' THEN amount  -- negative
         ELSE 0 END
  ), 0) INTO v_pool_cash
  FROM branch_pools
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  -- worst_case = max(0, max(yes_payout, no_payout) - cash_collected)
  -- Winners get shares * $0.99 (1% resolution fee)
  v_worst := GREATEST(0,
    GREATEST(v_yes_shares * 0.99, v_no_shares * 0.99) - v_pool_cash
  );

  RETURN v_worst;
END;
$$;

-- Main solvency check function
CREATE OR REPLACE FUNCTION branch_solvency_check(
  p_branch_id UUID,
  -- Optional: project post-trade state for pre-trade gating
  p_additional_pool_inflow DECIMAL DEFAULT 0,
  p_additional_worst_case_delta DECIMAL DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
  v_worst_case_total DECIMAL;
  v_pool_balance DECIMAL;
  v_utilization DECIMAL;
  v_status TEXT;
  v_can_trade BOOLEAN;
  v_withdrawal_available DECIMAL;
  v_solvency_threshold DECIMAL := 0.95;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  -- Use cached worst_case_total (updated incrementally on each trade)
  v_worst_case_total := v_branch.worst_case_total + p_additional_worst_case_delta;
  v_pool_balance := v_branch.pool_balance + p_additional_pool_inflow;

  -- Check for admin solvency override
  IF v_branch.solvency_override_pct IS NOT NULL
     AND v_branch.solvency_override_until IS NOT NULL
     AND now() < v_branch.solvency_override_until THEN
    v_solvency_threshold := v_branch.solvency_override_pct;
  END IF;

  -- Calculate utilization
  IF v_pool_balance <= 0 THEN
    v_utilization := 1.0;  -- 100% = red
  ELSE
    v_utilization := (v_branch.pending_payouts + v_worst_case_total) / v_pool_balance;
  END IF;

  -- Determine status
  IF v_utilization >= v_solvency_threshold THEN
    v_status := 'red';
    v_can_trade := false;
  ELSIF v_utilization >= 0.80 THEN
    v_status := 'yellow';
    v_can_trade := true;
  ELSE
    v_status := 'green';
    v_can_trade := true;
  END IF;

  -- Frozen/suspended branches can never trade
  IF v_branch.status IN ('frozen', 'suspended') THEN
    v_can_trade := false;
    v_status := 'red';
  END IF;

  v_withdrawal_available := GREATEST(0,
    v_pool_balance - v_branch.pending_payouts - v_worst_case_total
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'pool_balance', ROUND(v_pool_balance, 2),
    'worst_case_total', ROUND(v_worst_case_total, 2),
    'pending_payouts', ROUND(v_branch.pending_payouts, 2),
    'utilization', ROUND(v_utilization, 4),
    'status', v_status,
    'can_trade', v_can_trade,
    'withdrawal_available', ROUND(v_withdrawal_available, 2),
    'branch_status', v_branch.status::TEXT
  );
END;
$$;

-- Recompute worst_case_total from scratch for a branch (used by reconciliation)
CREATE OR REPLACE FUNCTION _recompute_branch_worst_case(p_branch_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total DECIMAL := 0;
  v_market RECORD;
BEGIN
  -- Sum worst case across all open markets where this branch has positions
  FOR v_market IN
    SELECT DISTINCT market_id
    FROM positions
    WHERE branch_id = p_branch_id AND shares_held > 0
  LOOP
    v_total := v_total + _branch_worst_case_market(p_branch_id, v_market.market_id);
  END LOOP;

  RETURN v_total;
END;
$$;
