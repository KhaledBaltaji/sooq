-- ============================================================================
-- 323_speed_admin_enable_branch.sql
--
-- PIN-gated admin RPC to enable a reseller branch on speed markets.
--
-- Creates the `speed_branches` row, posts initial collateral as a
-- `collateral_credit` ledger entry, and audits to `branch_admin_overrides`.
--
-- Reseller branches only — commission branches don't need a `speed_branches`
-- row (they earn fee share via the speed_pool_ledger but don't post collateral).
--
-- Idempotency: if `speed_branches.branch_id` already exists, the RPC errors.
-- Use the dedicated update RPCs (freeze/unfreeze/collateral_credit) to
-- modify an active branch.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_enable_branch(
  p_branch_id            UUID,
  p_collateral           DECIMAL,
  p_fee_share_pct        DECIMAL,
  p_freeze_warn_pct      DECIMAL,
  p_freeze_hard_pct      DECIMAL,
  p_unfreeze_pct         DECIMAL,
  p_stake_min            DECIMAL,
  p_stake_max            DECIMAL,
  p_stake_caps_per_side  JSONB,
  p_pin                  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id      UUID;
  v_branch        RECORD;
  v_existing      RECORD;
  v_pool_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Pre-flight: branch exists, not already speed-enabled ────────────
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.book_type <> 'reseller' THEN
    RAISE EXCEPTION 'Speed enable is for reseller branches only (this branch is %)', v_branch.book_type;
  END IF;

  SELECT * INTO v_existing FROM speed_branches WHERE branch_id = p_branch_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Branch already speed-enabled (status: %)', v_existing.speed_status;
  END IF;

  -- ── Validate inputs ─────────────────────────────────────────────────
  IF p_collateral <= 0 THEN RAISE EXCEPTION 'Collateral must be positive'; END IF;
  IF p_fee_share_pct < 0 OR p_fee_share_pct > 1 THEN
    RAISE EXCEPTION 'fee_share_pct must be in [0, 1]';
  END IF;
  IF p_stake_min <= 0 OR p_stake_max <= p_stake_min THEN
    RAISE EXCEPTION 'Invalid stake range';
  END IF;
  IF NOT (p_unfreeze_pct < p_freeze_warn_pct AND p_freeze_warn_pct < p_freeze_hard_pct) THEN
    RAISE EXCEPTION 'Freeze thresholds must satisfy unfreeze < warn < hard';
  END IF;
  IF jsonb_typeof(p_stake_caps_per_side) <> 'object' THEN
    RAISE EXCEPTION 'stake_caps_per_side must be a JSON object';
  END IF;

  -- ── Create speed_branches row ───────────────────────────────────────
  INSERT INTO speed_branches (
    branch_id, speed_status, speed_pool_balance,
    fee_share_pct, freeze_warn_pct, freeze_hard_pct, unfreeze_pct,
    stake_min, stake_max, stake_caps_per_side,
    activated_at, activated_by
  ) VALUES (
    p_branch_id, 'active', p_collateral,
    p_fee_share_pct, p_freeze_warn_pct, p_freeze_hard_pct, p_unfreeze_pct,
    p_stake_min, p_stake_max, p_stake_caps_per_side,
    NOW(), v_admin_id
  );

  -- ── Initial collateral ledger entry ─────────────────────────────────
  v_pool_balance := p_collateral;
  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_credit', p_collateral, v_pool_balance,
    NULL, 'Initial collateral on speed enable by admin ' || v_admin_id
  );

  -- ── Audit ───────────────────────────────────────────────────────────
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'config_change',
    'Speed markets enabled',
    NULL,
    jsonb_build_object(
      'collateral', p_collateral,
      'fee_share_pct', p_fee_share_pct,
      'stake_min', p_stake_min,
      'stake_max', p_stake_max,
      'stake_caps_per_side', p_stake_caps_per_side
    )
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Speed markets enabled for branch ' || p_branch_id,
    jsonb_build_object(
      'event', 'enable_branch',
      'admin_id', v_admin_id, 'branch_id', p_branch_id, 'collateral', p_collateral
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'speed_status', 'active',
    'pool_balance', v_pool_balance
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_enable_branch(UUID, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, DECIMAL, JSONB, TEXT) IS
'PIN-gated admin RPC. Speed-enables a reseller branch, posts initial collateral, audits to branch_admin_overrides + system_logs.';
