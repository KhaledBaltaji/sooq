-- ============================================================
-- 219: Branch Settlement at Resolution
--
-- Creates:
-- 1. branch_revenue table — per-branch per-market fee accounting
-- 2. record_branch_revenue() — records branch fee breakdown
-- 3. branch_settle_resolution() — settles branch positions at resolution
--
-- Called by resolve_market (migration 220) after retail payouts.
-- Winners ALWAYS get paid in full — if branch pool is insufficient,
-- the deficit becomes pending_payouts and payback mode activates.
-- ============================================================

-- ============================================================
-- 1. branch_revenue table
-- ============================================================

CREATE TABLE IF NOT EXISTS branch_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL REFERENCES branches(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  markup_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  explicit_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  exit_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  resolution_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_revenue DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(branch_id, market_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_revenue_branch ON branch_revenue(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_revenue_market ON branch_revenue(market_id);

-- RLS
ALTER TABLE branch_revenue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read branch_revenue" ON branch_revenue;
CREATE POLICY "Admin can read branch_revenue" ON branch_revenue
  FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

-- Fix reconcile_branch_solvency: respect pool_balance >= 0 CHECK constraint
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
    v_computed := _recompute_branch_worst_case(v_branch.id);
    v_diff := v_branch.worst_case_total - v_computed;

    SELECT COALESCE(SUM(amount), 0) INTO v_ledger_balance
    FROM branch_pools WHERE branch_pools.branch_id = v_branch.id;
    v_pool_diff := v_branch.pool_balance - v_ledger_balance;

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

      -- Auto-fix: respect pool_balance >= 0 CHECK constraint
      PERFORM set_config('app.trigger_bypass', 'true', true);
      UPDATE branches SET
        worst_case_total = v_computed,
        pool_balance = GREATEST(0, v_ledger_balance)
      WHERE id = v_branch.id;
    END IF;

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

-- ============================================================
-- 2. record_branch_revenue(market_id, branch_id, outcome)
-- ============================================================

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

  v_total := v_markup + v_explicit + v_exit + p_resolution_fee_collected;

  INSERT INTO branch_revenue (
    branch_id, market_id, markup_revenue, explicit_fee_revenue,
    exit_fee_revenue, resolution_fee_revenue, total_revenue
  ) VALUES (
    p_branch_id, p_market_id, v_markup, v_explicit,
    v_exit, p_resolution_fee_collected, v_total
  )
  ON CONFLICT (branch_id, market_id) DO UPDATE SET
    markup_revenue = EXCLUDED.markup_revenue,
    explicit_fee_revenue = EXCLUDED.explicit_fee_revenue,
    exit_fee_revenue = EXCLUDED.exit_fee_revenue,
    resolution_fee_revenue = EXCLUDED.resolution_fee_revenue,
    total_revenue = EXCLUDED.total_revenue;
END;
$$;

-- ============================================================
-- 3. branch_settle_resolution(market_id, outcome)
--
-- For each branch with winning positions:
-- - Pay winners from branch pool (users ALWAYS get paid)
-- - If pool insufficient → deficit becomes pending_payouts, payback activates
-- - Update pool_balance, worst_case_total
-- - Record branch revenue
-- ============================================================

CREATE OR REPLACE FUNCTION branch_settle_resolution(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch_rec RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout DECIMAL;
  v_fee_amount DECIMAL;
  v_branch_total_paid DECIMAL;
  v_branch_fees DECIMAL;
  v_branch_winners INTEGER;
  v_deficit DECIMAL;
  v_new_worst_case DECIMAL;
  v_branches_settled INTEGER := 0;
  v_total_branch_payouts DECIMAL := 0;
  v_branches_in_payback INTEGER := 0;
  v_branch_id UUID;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Find all branches with positions on this market
  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    -- Lock branch
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_paid := 0;
    v_branch_fees := 0;
    v_branch_winners := 0;

    -- ======= PAY BRANCH WINNERS =======
    FOR v_pos IN
      SELECT * FROM positions
      WHERE market_id = p_market_id
        AND branch_id = v_branch_id
        AND side = p_outcome
        AND shares_held > 0
      ORDER BY user_id
    LOOP
      SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

      v_payout := v_pos.shares_held * (1.0 - v_resolution_fee_rate);
      v_fee_amount := v_pos.shares_held * v_resolution_fee_rate;

      -- Winners ALWAYS get paid (even if pool is insufficient)
      UPDATE users SET balance_usd = balance_usd + v_payout
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_pos_user.balance_usd;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'resolution_payout', v_payout,
              v_pos_user.balance_usd, p_market_id,
              'Won (branch): ' || ROUND(v_pos.shares_held, 2) || ' shares × $'
              || ROUND(1.0 - v_resolution_fee_rate, 2));

      v_branch_total_paid := v_branch_total_paid + v_payout;
      v_branch_fees := v_branch_fees + v_fee_amount;
      v_branch_winners := v_branch_winners + 1;
    END LOOP;

    -- ======= UPDATE BRANCH POOL (respect pool_balance >= 0 CHECK) =======
    IF v_branch_total_paid > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_paid - v_branch_rec.pool_balance);

      -- Set pool to floored value (never negative due to CHECK constraint)
      UPDATE branches SET
        pool_balance = GREATEST(0, pool_balance - v_branch_total_paid),
        pending_payouts = CASE WHEN v_deficit > 0 THEN pending_payouts + v_deficit ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      -- Branch pool ledger entry
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'resolution_payout', -v_branch_total_paid,
              GREATEST(0, v_branch_rec.pool_balance - v_branch_total_paid), p_market_id);

      -- Activate payback if there's a deficit and branch is active
      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Resolution shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0  -- deficit already added to pending_payouts above
        );
        v_branches_in_payback := v_branches_in_payback + 1;
      END IF;
    END IF;

    -- ======= RECOMPUTE WORST CASE =======
    -- Positions on this market are now settled, so worst case should drop
    v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
    UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;

    -- ======= RECORD BRANCH REVENUE =======
    PERFORM record_branch_revenue(p_market_id, v_branch_id, p_outcome, v_branch_fees);

    v_branches_settled := v_branches_settled + 1;
    v_total_branch_payouts := v_total_branch_payouts + v_branch_total_paid;

    -- Log per-branch settlement
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/resolution', format('Branch %s settled for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'winners', v_branch_winners,
        'total_paid', ROUND(v_branch_total_paid, 2),
        'resolution_fees', ROUND(v_branch_fees, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id)
      ));
  END LOOP;

  RETURN jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback
  );
END;
$$;
