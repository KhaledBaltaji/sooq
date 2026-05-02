-- ═══════════════════════════════════════════════════════════════════
-- Migration 254: Hotfix for get_branch_owner_summary column references
--
-- Migration 253 tried to use ba.approved_at but staging rejects that
-- reference. Strip to the minimum set of columns that are guaranteed
-- by migration 204 (the branch_agents CREATE TABLE). Dashboard can
-- survive without approved_at.
-- ═══════════════════════════════════════════════════════════════════

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

  -- Only columns from migration 204's CREATE TABLE — guaranteed present.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ba.id,
    'user_id', ba.user_id,
    'display_name', u.display_name,
    'agent_type', ba.agent_type,
    'rate', ba.rate,
    'is_active', ba.is_active,
    'cumulative_pl', ba.cumulative_pl,
    'created_at', ba.created_at,
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
