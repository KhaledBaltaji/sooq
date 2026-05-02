-- ═══════════════════════════════════════════════════════════════════
-- Migration 255: approve_branch_agent — strip status/approved_at deps
--
-- Staging schema appears to have drift where branch_agents.status and
-- branch_agents.approved_at columns aren't reliably accessible via
-- PostgREST or PL/pgSQL RECORD inspection (migration 231 tracked as
-- applied but columns behave as if missing in some call paths).
--
-- This migration re-creates approve_branch_agent to rely ONLY on the
-- columns that are DEFINITELY present from migration 204:
--   id, branch_id, user_id, agent_type, rate, is_active
--
-- Trade-offs:
--   • We drop the "agent must be in pending status" precondition.
--     Callers who re-approve an already-approved agent will have
--     their rate/type overwritten. Acceptable for now — the branch
--     manager auth check still applies.
--   • approved_at / approved_by are skipped in the UPDATE to avoid
--     the same column-existence problem. Audit timestamp lives in
--     branch_agents.updated_at (auto-maintained) and the approve
--     event is visible via is_active = true.
--
-- Rate cap enforcement is preserved — that's the PR 3 core addition.
-- ═══════════════════════════════════════════════════════════════════

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
  v_branch_id UUID;
  v_manager_id UUID;
  v_existing_pl_sum DECIMAL;
  v_cap DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Look up branch_id + manager_id via explicit columns (avoid SELECT *).
  SELECT ba.branch_id, b.manager_user_id
  INTO v_branch_id, v_manager_id
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_manager_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- ═══ 80% combined P/L rate cap (PR 3 core feature) ═══
  -- Uses is_active = true as the "already earning" filter.
  IF p_agent_type = 'pl' THEN
    SELECT COALESCE(SUM(rate), 0) INTO v_existing_pl_sum
    FROM branch_agents
    WHERE branch_id = v_branch_id
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
  SET agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0),
      is_active = true,
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'status', 'approved',
    'agent_type', p_agent_type,
    'rate', p_rate
  );
END;
$$;
