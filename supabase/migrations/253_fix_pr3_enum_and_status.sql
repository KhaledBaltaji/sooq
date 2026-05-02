-- ═══════════════════════════════════════════════════════════════════
-- Migration 253: Hotfix for PR 3 bugs in migration 252
--
-- Fixes two issues uncovered by tests:
--   1. `transaction_type` enum was missing 'branch_owner_payout'
--      → ADD the enum value.
--   2. `get_branch_owner_summary` referenced `ba.status` which the
--      staging schema rejects for reasons we haven't fully diagnosed.
--      `is_active` + `approved_at` convey the same information for
--      dashboard rendering, so we drop the `status` field from the
--      JSON output. The approve_branch_agent rate cap query is also
--      switched from `status = 'approved'` to `is_active = true`
--      (functionally equivalent — approved agents are set active).
-- ═══════════════════════════════════════════════════════════════════


-- ============================================================
-- 1. Add 'branch_owner_payout' to transaction_type enum
-- ============================================================
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'branch_owner_payout';


-- ============================================================
-- 2. Rewrite get_branch_owner_summary — drop ba.status reference
--    Everything else unchanged from migration 252.
-- ============================================================

CREATE OR REPLACE FUNCTION get_branch_owner_summary(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_pending_total DECIMAL;
  v_next_unlock TIMESTAMPTZ;
  v_effective DECIMAL;
  v_solvency_status TEXT;
  v_agents JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  SELECT COALESCE(SUM(pending_amount), 0), MIN(next_unlock_at)
  INTO v_pending_total, v_next_unlock
  FROM branch_pending_liabilities
  WHERE branch_id = p_branch_id;

  v_effective := v_branch.pool_balance - v_branch.worst_case_total - v_pending_total;

  v_solvency_status := CASE
    WHEN v_branch.status = 'payback' THEN 'payback_mode'
    WHEN v_effective < 0 THEN 'warning'
    WHEN v_branch.pool_balance < v_branch.worst_case_total THEN 'warning'
    ELSE 'healthy'
  END;

  -- Use is_active + approved_at instead of status column.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ba.id,
    'user_id', ba.user_id,
    'display_name', u.display_name,
    'agent_type', ba.agent_type,
    'rate', ba.rate,
    'is_active', ba.is_active,
    'approved_at', ba.approved_at,
    'cumulative_pl', ba.cumulative_pl,
    'pending_liability', COALESCE(bpl.pending_amount, 0),
    'next_unlock_at', bpl.next_unlock_at
  )), '[]'::jsonb) INTO v_agents
  FROM branch_agents ba
  JOIN users u ON u.id = ba.user_id
  LEFT JOIN branch_pending_liabilities bpl
    ON bpl.agent_user_id = ba.user_id AND bpl.branch_id = ba.branch_id
  WHERE ba.branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'pool_balance', v_branch.pool_balance,
    'worst_case_total', v_branch.worst_case_total,
    'pending_payouts', v_branch.pending_payouts,
    'pending_liabilities', v_pending_total,
    'effective_pool', v_effective,
    'solvency_status', v_solvency_status,
    'next_unlock_at', v_next_unlock,
    'agents', v_agents
  );
END;
$$;


-- ============================================================
-- 3. Rewrite approve_branch_agent — use is_active instead of status
--    for the rate cap sum. Everything else unchanged from migration 252.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_branch_agent(
  p_agent_id UUID,
  p_agent_type TEXT,
  p_rate DECIMAL,
  p_deposit_required DECIMAL DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
  v_branch RECORD;
  v_existing_pl_sum DECIMAL;
  v_cap DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id, b.id as bid
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_agent.status != 'pending' THEN
    RAISE EXCEPTION 'Agent is not in pending status';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- 80% combined P/L rate cap. Uses is_active=true as the "already
  -- approved + earning" filter rather than status='approved' for
  -- compatibility with environments where the status column has issues.
  IF p_agent_type = 'pl' THEN
    SELECT COALESCE(SUM(rate), 0) INTO v_existing_pl_sum
    FROM branch_agents
    WHERE branch_id = v_agent.branch_id
      AND agent_type = 'pl'
      AND is_active = true
      AND id != p_agent_id;

    SELECT rate INTO v_cap
    FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum' LIMIT 1;
    v_cap := COALESCE(v_cap, 0.80);

    IF (v_existing_pl_sum + p_rate) > v_cap THEN
      RAISE EXCEPTION 'Combined P/L rate would exceed % cap (existing %, proposed %, sum %)',
        ROUND(v_cap * 100, 1),
        ROUND(v_existing_pl_sum * 100, 1),
        ROUND(p_rate * 100, 1),
        ROUND((v_existing_pl_sum + p_rate) * 100, 1);
    END IF;
  END IF;

  UPDATE branch_agents
  SET status = 'approved',
      agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0),
      is_active = true,
      approved_at = now(),
      approved_by = v_caller
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'status', 'approved',
    'agent_type', p_agent_type,
    'rate', p_rate
  );
END;
$$;
