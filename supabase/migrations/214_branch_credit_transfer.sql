-- ============================================================
-- 214: S2 Branch System — Credit Chain Transfer
--
-- Downward-only money flow: Admin → Branch Manager → Agent → Sub-agent → User
-- Every credit debits issuer balance, credits recipient balance.
-- Append-only audit trail in credit_chain_ledger.
-- ============================================================

-- New transaction types (must be outside transaction block)
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'branch_credit_out';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'branch_credit_in';

CREATE OR REPLACE FUNCTION branch_credit_transfer(
  p_branch_id UUID,
  p_recipient_id UUID,
  p_amount DECIMAL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_issuer_id UUID;
  v_branch RECORD;
  v_issuer RECORD;
  v_recipient RECORD;
  v_issuer_role credit_chain_role;
  v_recipient_role credit_chain_role;
  v_issuer_rank INT;
  v_recipient_rank INT;
  v_issuer_agent RECORD;
  v_recipient_agent RECORD;
  v_issuer_new_balance DECIMAL;
  v_recipient_new_balance DECIMAL;
  v_credit_id UUID;
BEGIN
  v_issuer_id := auth.uid();
  IF v_issuer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum ($100,000)';
  END IF;

  -- Lock branch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended — no credits allowed';
  END IF;

  -- Lock both user rows (issuer first, then recipient — consistent order)
  IF v_issuer_id < p_recipient_id THEN
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
  END IF;

  IF v_issuer IS NULL THEN RAISE EXCEPTION 'Issuer not found'; END IF;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF v_issuer.is_frozen THEN RAISE EXCEPTION 'Your account is frozen'; END IF;
  IF v_recipient.is_frozen THEN RAISE EXCEPTION 'Recipient account is frozen'; END IF;

  -- ═══ DETERMINE ISSUER ROLE ═══
  IF v_issuer.is_admin THEN
    v_issuer_role := 'admin';
    v_issuer_rank := 0;
  ELSIF v_branch.manager_user_id = v_issuer_id THEN
    v_issuer_role := 'branch_manager';
    v_issuer_rank := 1;
  ELSE
    SELECT * INTO v_issuer_agent
    FROM branch_agents
    WHERE user_id = v_issuer_id AND branch_id = p_branch_id AND is_active = true;

    IF FOUND THEN
      IF v_issuer_agent.parent_agent_id IS NULL THEN
        v_issuer_role := 'agent';
        v_issuer_rank := 2;
      ELSE
        v_issuer_role := 'sub_agent';
        v_issuer_rank := 3;
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to issue credits in this branch';
    END IF;
  END IF;

  -- ═══ DETERMINE RECIPIENT ROLE ═══
  IF v_recipient.is_admin THEN
    -- Admins cannot receive credits (upward flow)
    v_recipient_role := 'admin';
    v_recipient_rank := 0;
  ELSIF v_branch.manager_user_id = p_recipient_id THEN
    v_recipient_role := 'branch_manager';
    v_recipient_rank := 1;
  ELSE
    SELECT * INTO v_recipient_agent
    FROM branch_agents
    WHERE user_id = p_recipient_id AND branch_id = p_branch_id;

    IF FOUND THEN
      IF v_recipient_agent.parent_agent_id IS NULL THEN
        v_recipient_role := 'agent';
        v_recipient_rank := 2;
      ELSE
        v_recipient_role := 'sub_agent';
        v_recipient_rank := 3;
      END IF;
    ELSE
      -- Check if user is assigned to this branch
      IF EXISTS (SELECT 1 FROM branch_user_assignments WHERE user_id = p_recipient_id AND branch_id = p_branch_id) THEN
        v_recipient_role := 'user';
        v_recipient_rank := 4;
      ELSE
        RAISE EXCEPTION 'Recipient not assigned to this branch';
      END IF;
    END IF;
  END IF;

  -- ═══ HIERARCHY VALIDATION (downward only) ═══
  IF v_issuer_rank >= v_recipient_rank THEN
    RAISE EXCEPTION 'Credits can only flow downward (% cannot credit %)',
      v_issuer_role, v_recipient_role;
  END IF;

  -- Agent → sub_agent: verify parent chain
  IF v_issuer_role = 'agent' AND v_recipient_role = 'sub_agent' THEN
    IF v_recipient_agent.parent_agent_id != v_issuer_agent.id THEN
      RAISE EXCEPTION 'Sub-agent does not belong to your agent network';
    END IF;
  END IF;

  -- Sub-agent → user: verify user is assigned to this sub-agent
  IF v_issuer_role = 'sub_agent' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments
      WHERE user_id = p_recipient_id AND branch_id = p_branch_id
        AND agent_id = v_issuer_agent.id
    ) THEN
      RAISE EXCEPTION 'User is not assigned to your agent network';
    END IF;
  END IF;

  -- Agent → user: verify user is assigned to this agent (or sub-agents of this agent)
  IF v_issuer_role = 'agent' AND v_recipient_role = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments bua
      WHERE bua.user_id = p_recipient_id AND bua.branch_id = p_branch_id
        AND (bua.agent_id = v_issuer_agent.id
          OR bua.agent_id IN (SELECT id FROM branch_agents WHERE parent_agent_id = v_issuer_agent.id))
    ) THEN
      RAISE EXCEPTION 'User is not in your agent network';
    END IF;
  END IF;

  -- ═══ BALANCE CHECK ═══
  IF v_issuer.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance ($% available)', ROUND(v_issuer.balance_usd, 2);
  END IF;

  -- ═══ EXECUTE TRANSFER ═══
  UPDATE users SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE id = v_issuer_id
  RETURNING balance_usd INTO v_issuer_new_balance;

  UPDATE users SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_recipient_id
  RETURNING balance_usd INTO v_recipient_new_balance;

  -- Ledger entries
  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (v_issuer_id, 'branch_credit_out', -p_amount, v_issuer_new_balance,
          COALESCE(p_description, 'Branch credit to ' || p_recipient_id::TEXT), v_issuer_id);

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_recipient_id, 'branch_credit_in', p_amount, v_recipient_new_balance,
          COALESCE(p_description, 'Branch credit from ' || v_issuer_id::TEXT), v_issuer_id);

  -- Credit chain audit trail
  INSERT INTO credit_chain_ledger (branch_id, issuer_id, recipient_id, issuer_role, recipient_role, amount, description)
  VALUES (p_branch_id, v_issuer_id, p_recipient_id, v_issuer_role, v_recipient_role, p_amount, p_description)
  RETURNING id INTO v_credit_id;

  -- System log
  PERFORM log_system_event('info'::log_severity, 'branch/credit_transfer',
    'Credit transfer: ' || v_issuer_role || ' → ' || v_recipient_role || ' $' || p_amount,
    jsonb_build_object(
      'credit_id', v_credit_id, 'branch_id', p_branch_id,
      'issuer_id', v_issuer_id, 'recipient_id', p_recipient_id,
      'issuer_role', v_issuer_role, 'recipient_role', v_recipient_role,
      'amount', p_amount
    )
  );

  RETURN jsonb_build_object(
    'credit_id', v_credit_id,
    'issuer_new_balance', ROUND(v_issuer_new_balance, 2),
    'recipient_new_balance', ROUND(v_recipient_new_balance, 2),
    'issuer_role', v_issuer_role,
    'recipient_role', v_recipient_role
  );
END;
$$;
