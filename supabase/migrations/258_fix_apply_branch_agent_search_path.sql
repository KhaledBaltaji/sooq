-- ═══════════════════════════════════════════════════════════════════
-- Migration 257: Fix apply_branch_agent search_path for gen_random_bytes
--
-- Migration 256 restored `apply_branch_agent` with `SET search_path = public`
-- which doesn't resolve `gen_random_bytes` (it lives in the `extensions`
-- schema on Supabase). Tests fail with "function gen_random_bytes(integer)
-- does not exist".
--
-- Fix: qualify the call with the schema explicitly. Safer than widening
-- search_path because it avoids shadowing surprises.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION apply_branch_agent(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_agent_id UUID;
  v_code TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, status INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM branch_user_assignments
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM branch_agents
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Already applied to this branch';
  END IF;

  -- Qualify gen_random_bytes with its schema since search_path is public-only.
  v_code := encode(extensions.gen_random_bytes(4), 'hex');

  INSERT INTO branch_agents (branch_id, user_id, status, agent_type, rate, referral_code, is_active)
  VALUES (p_branch_id, v_user_id, 'pending', NULL, NULL, v_code, false)
  RETURNING id INTO v_agent_id;

  RETURN jsonb_build_object('agent_id', v_agent_id, 'status', 'pending');
END;
$$;
