-- ============================================================================
-- 325_speed_admin_freeze.sql
--
-- Three PIN-gated admin RPCs for branch operational controls:
--
-- - `speed_admin_freeze_branch` — set speed_status to 'frozen'. Blocks
--   new bets and cashouts. Existing positions resolve normally.
--
-- - `speed_admin_unfreeze_branch` — back to 'active'.
--
-- - `speed_admin_suspend_branch` — terminal status. Blocks everything.
--   No automatic recovery; requires re-enable to use again.
--
-- All three audit to branch_admin_overrides + system_logs.
-- Auto-freeze (when pool < freeze_hard_pct of last collateral mark) is
-- separate and lives in the trigger logic when implemented (Part 3).
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_freeze_branch(
  p_branch_id UUID,
  p_reason    TEXT,
  p_pin       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id    UUID;
  v_branch      RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  UPDATE speed_branches SET speed_status = 'frozen', updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch frozen: ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'frozen')
  );

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Branch frozen ' || p_branch_id,
    jsonb_build_object('event', 'freeze_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'frozen');
END;
$$;


CREATE OR REPLACE FUNCTION speed_admin_unfreeze_branch(
  p_branch_id UUID,
  p_pin       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id   UUID;
  v_branch     RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;
  IF v_branch.speed_status NOT IN ('frozen', 'warning') THEN
    RAISE EXCEPTION 'Branch is %, not frozen/warning', v_branch.speed_status;
  END IF;

  UPDATE speed_branches SET speed_status = 'active', updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch unfrozen',
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'active')
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Branch unfrozen ' || p_branch_id,
    jsonb_build_object('event', 'unfreeze_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'active');
END;
$$;


CREATE OR REPLACE FUNCTION speed_admin_suspend_branch(
  p_branch_id UUID,
  p_reason    TEXT,
  p_pin       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id   UUID;
  v_branch     RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  UPDATE speed_branches SET
    speed_status = 'suspended',
    suspension_reason = p_reason,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch suspended: ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'suspended', 'suspension_reason', p_reason)
  );

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'Branch SUSPENDED ' || p_branch_id || ': ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('event', 'suspend_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'suspended');
END;
$$;
