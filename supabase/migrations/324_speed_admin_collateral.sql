-- ============================================================================
-- 324_speed_admin_collateral.sql
--
-- Two PIN-gated admin RPCs for branch collateral management:
--
-- - `speed_admin_collateral_credit` — admin posts collateral top-up (or
--   discretionary credit such as a hedge offset). Always positive amount.
--
-- - `speed_admin_collateral_withdraw` — admin posts collateral pull
--   (e.g., branch requests to reduce capital). Negative amount.
--
-- Both update speed_branches.speed_pool_balance and append to
-- speed_pool_ledger. Audit to branch_admin_overrides + system_logs.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_collateral_credit(
  p_branch_id UUID,
  p_amount    DECIMAL,
  p_notes     TEXT,
  p_pin       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id     UUID;
  v_branch       RECORD;
  v_new_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Credit amount must be positive'; END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  v_new_balance := v_branch.speed_pool_balance + p_amount;

  UPDATE speed_branches SET
    speed_pool_balance = v_new_balance,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_credit', p_amount, v_new_balance,
    NULL, COALESCE(p_notes, 'Admin collateral credit')
  );

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'pool_adjustment',
    'Speed collateral credit: ' || COALESCE(p_notes, '(no notes)'),
    jsonb_build_object('pool_balance', v_branch.speed_pool_balance),
    jsonb_build_object('pool_balance', v_new_balance, 'amount', p_amount)
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Collateral credit ' || p_amount || ' to branch ' || p_branch_id,
    jsonb_build_object('event', 'collateral_credit', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'amount', p_amount, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'amount_credited', p_amount,
    'new_pool_balance', v_new_balance
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_collateral_credit(UUID, DECIMAL, TEXT, TEXT) IS
'PIN-gated admin RPC. Credits collateral to a speed-enabled branch (top-up, hedge offset, etc).';


CREATE OR REPLACE FUNCTION speed_admin_collateral_withdraw(
  p_branch_id UUID,
  p_amount    DECIMAL,
  p_notes     TEXT,
  p_pin       TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id     UUID;
  v_branch       RECORD;
  v_new_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Withdraw amount must be positive'; END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  v_new_balance := v_branch.speed_pool_balance - p_amount;

  UPDATE speed_branches SET
    speed_pool_balance = v_new_balance,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_withdraw', -p_amount, v_new_balance,
    NULL, COALESCE(p_notes, 'Admin collateral withdrawal')
  );

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'pool_adjustment',
    'Speed collateral withdraw: ' || COALESCE(p_notes, '(no notes)'),
    jsonb_build_object('pool_balance', v_branch.speed_pool_balance),
    jsonb_build_object('pool_balance', v_new_balance, 'amount_withdrawn', p_amount)
  );

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Collateral withdraw ' || p_amount || ' from branch ' || p_branch_id,
    jsonb_build_object('event', 'collateral_withdraw', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'amount', p_amount, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'amount_withdrawn', p_amount,
    'new_pool_balance', v_new_balance
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_collateral_withdraw(UUID, DECIMAL, TEXT, TEXT) IS
'PIN-gated admin RPC. Withdraws collateral from a speed-enabled branch. Negative ledger entry.';
