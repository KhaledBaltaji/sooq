-- ============================================================
-- 231: Branch Agent Approval Workflow
--
-- Adds status enum, nullable agent_type/rate (set at approval),
-- rejection_reason, approved_at/by. 4 new RPCs.
-- ============================================================

BEGIN;

-- 1. Status enum
CREATE TYPE branch_agent_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- 2. New columns
ALTER TABLE branch_agents ADD COLUMN status branch_agent_status NOT NULL DEFAULT 'pending';
ALTER TABLE branch_agents ADD COLUMN rejection_reason TEXT;
ALTER TABLE branch_agents ADD COLUMN approved_at TIMESTAMPTZ;
ALTER TABLE branch_agents ADD COLUMN approved_by UUID REFERENCES users(id);

-- 3. Make agent_type and rate nullable (set at approval, not application)
ALTER TABLE branch_agents ALTER COLUMN agent_type DROP NOT NULL;
ALTER TABLE branch_agents ALTER COLUMN rate DROP NOT NULL;

-- Drop the existing check constraint on rate, recreate allowing null
ALTER TABLE branch_agents DROP CONSTRAINT IF EXISTS branch_agents_rate_check;
ALTER TABLE branch_agents ADD CONSTRAINT branch_agents_rate_check CHECK (rate IS NULL OR (rate > 0 AND rate <= 1.000000));

-- 4. Backfill existing rows
UPDATE branch_agents SET status = 'approved' WHERE is_active = true;
UPDATE branch_agents SET status = 'suspended' WHERE is_active = false;

-- 5. Index for filtering by status
CREATE INDEX idx_branch_agents_status ON branch_agents(branch_id, status);

-- ============================================================
-- RPC: apply_branch_agent
-- ============================================================
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

  -- Verify branch exists and is active
  SELECT id, status INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended';
  END IF;

  -- Verify user is assigned to this branch
  IF NOT EXISTS (
    SELECT 1 FROM branch_user_assignments
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  -- Check for duplicate application
  IF EXISTS (
    SELECT 1 FROM branch_agents
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Already applied to this branch';
  END IF;

  -- Generate referral code
  v_code := encode(gen_random_bytes(4), 'hex');

  -- Insert pending application
  INSERT INTO branch_agents (branch_id, user_id, status, agent_type, rate, referral_code, is_active)
  VALUES (p_branch_id, v_user_id, 'pending', NULL, NULL, v_code, false)
  RETURNING id INTO v_agent_id;

  RETURN jsonb_build_object('agent_id', v_agent_id, 'status', 'pending');
END;
$$;

-- ============================================================
-- RPC: approve_branch_agent
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
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get agent + branch
  SELECT ba.*, b.manager_user_id, b.id as bid
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  -- Verify caller is branch manager
  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  -- Verify pending status
  IF v_agent.status != 'pending' THEN
    RAISE EXCEPTION 'Agent is not in pending status';
  END IF;

  -- Validate rate
  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  -- Validate agent_type
  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- Update agent
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

-- ============================================================
-- RPC: reject_branch_agent
-- ============================================================
CREATE OR REPLACE FUNCTION reject_branch_agent(
  p_agent_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id
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

  UPDATE branch_agents
  SET status = 'rejected',
      rejection_reason = p_reason,
      is_active = false
  WHERE id = p_agent_id;

  RETURN jsonb_build_object('agent_id', p_agent_id, 'status', 'rejected');
END;
$$;

-- ============================================================
-- RPC: update_branch_agent_deal
-- ============================================================
CREATE OR REPLACE FUNCTION update_branch_agent_deal(
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
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id
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

  IF v_agent.status != 'approved' THEN
    RAISE EXCEPTION 'Can only update deal for approved agents';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  UPDATE branch_agents
  SET agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0)
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_type', p_agent_type,
    'rate', p_rate,
    'deposit_required', COALESCE(p_deposit_required, 0)
  );
END;
$$;

COMMIT;
