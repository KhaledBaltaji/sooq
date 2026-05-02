-- ═══════════════════════════════════════════════════════════════════
-- Migration 256: Restore Branch Agent Approval Schema (PR 4)
--
-- Context: Migration 231 is tracked as applied but its ALTER TABLE
-- statements and RPC definitions are missing from staging. This was
-- discovered during PR 3 rollout — the `branch_agents` table only has
-- columns from migration 204; `apply_branch_agent`, `reject_branch_agent`,
-- and `update_branch_agent_deal` RPCs do not exist.
--
-- This migration is idempotent: uses IF NOT EXISTS guards so it can
-- safely run against partial/full schema state.
--
-- After this migration, the branch-agent application flow works end-
-- to-end: apply → approve (with 80% cap from PR 3) → reject / update.
--
-- CRITICAL: This migration builds ON TOP of PR 3's `approve_branch_agent`.
-- It adds back the `status = 'pending'` check and `approved_at`/`approved_by`
-- audit fields, while KEEPING the 80% P/L rate cap from PR 3.
-- ═══════════════════════════════════════════════════════════════════


-- ============================================================
-- 1. branch_agent_status enum (idempotent)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'branch_agent_status') THEN
    CREATE TYPE branch_agent_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
  END IF;
END $$;


-- ============================================================
-- 2. Add missing columns on branch_agents (idempotent)
-- ============================================================

ALTER TABLE branch_agents
  ADD COLUMN IF NOT EXISTS status branch_agent_status NOT NULL DEFAULT 'pending';

ALTER TABLE branch_agents
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

ALTER TABLE branch_agents
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

ALTER TABLE branch_agents
  ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id);


-- ============================================================
-- 3. Make agent_type and rate nullable (required for pending rows)
-- ============================================================

ALTER TABLE branch_agents ALTER COLUMN agent_type DROP NOT NULL;
ALTER TABLE branch_agents ALTER COLUMN rate DROP NOT NULL;

-- Drop the existing rate check constraint and recreate allowing null.
ALTER TABLE branch_agents DROP CONSTRAINT IF EXISTS branch_agents_rate_check;
ALTER TABLE branch_agents
  ADD CONSTRAINT branch_agents_rate_check
  CHECK (rate IS NULL OR (rate > 0 AND rate <= 1.000000));


-- ============================================================
-- 4. Backfill status from is_active (only for rows that just got
--    the column — existing rows had it set to pending default).
--    The is_active → status mapping preserves migration 231's logic.
-- ============================================================

UPDATE branch_agents SET status = 'approved'
  WHERE is_active = true AND status = 'pending';

UPDATE branch_agents SET status = 'suspended'
  WHERE is_active = false AND status = 'pending' AND approved_at IS NULL;


-- ============================================================
-- 5. Status index (idempotent)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_branch_agents_status
  ON branch_agents(branch_id, status);


-- ============================================================
-- 6. RPC: apply_branch_agent (restored from migration 231)
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

  v_code := encode(gen_random_bytes(4), 'hex');

  INSERT INTO branch_agents (branch_id, user_id, status, agent_type, rate, referral_code, is_active)
  VALUES (p_branch_id, v_user_id, 'pending', NULL, NULL, v_code, false)
  RETURNING id INTO v_agent_id;

  RETURN jsonb_build_object('agent_id', v_agent_id, 'status', 'pending');
END;
$$;


-- ============================================================
-- 7. RPC: approve_branch_agent — restored with status + 80% cap
--    Combines migration 231's canonical behavior with PR 3's
--    80% combined P/L rate cap.
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
  v_existing_pl_sum DECIMAL;
  v_cap DECIMAL;
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

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- 80% combined P/L rate cap (PR 3 feature — preserved).
  IF p_agent_type = 'pl' THEN
    SELECT COALESCE(SUM(rate), 0) INTO v_existing_pl_sum
    FROM branch_agents
    WHERE branch_id = v_agent.branch_id
      AND agent_type = 'pl'
      AND status = 'approved'
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
      approved_by = v_caller,
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


-- ============================================================
-- 8. RPC: reject_branch_agent (restored from migration 231)
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
      is_active = false,
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object('agent_id', p_agent_id, 'status', 'rejected');
END;
$$;


-- ============================================================
-- 9. RPC: update_branch_agent_deal (restored from migration 231)
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
      deposit_required = COALESCE(p_deposit_required, 0),
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_type', p_agent_type,
    'rate', p_rate,
    'deposit_required', COALESCE(p_deposit_required, 0)
  );
END;
$$;


-- ============================================================
-- 10. Update get_branch_owner_summary to include status + approved_at
--     now that those columns are guaranteed present.
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ba.id,
    'user_id', ba.user_id,
    'display_name', u.display_name,
    'agent_type', ba.agent_type,
    'rate', ba.rate,
    'status', ba.status,
    'is_active', ba.is_active,
    'approved_at', ba.approved_at,
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


-- ============================================================
-- 11. Grants
-- ============================================================

GRANT EXECUTE ON FUNCTION apply_branch_agent(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_branch_agent(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION update_branch_agent_deal(UUID, TEXT, DECIMAL, DECIMAL) TO authenticated;
-- approve_branch_agent and get_branch_owner_summary keep prior grants.
