-- ============================================================
-- 217: S2 Branch System — Admin Branch Operations
--
-- PIN-protected admin functions for branch management.
-- All overrides logged in branch_admin_overrides.
-- ============================================================

-- ============================================================
-- Helper: _verify_admin_pin — reusable PIN check
-- ============================================================
CREATE OR REPLACE FUNCTION _verify_admin_pin(p_admin_id UUID, p_pin TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config admin_config%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = p_admin_id FOR UPDATE;
  IF v_config IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured. Set up your PIN first.';
  END IF;

  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;

  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      failed_pin_attempts = failed_pin_attempts + 1,
      pin_locked_until = CASE
        WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE admin_user_id = p_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = p_admin_id;
END;
$$;

-- ============================================================
-- 1. admin_create_branch
-- ============================================================
CREATE OR REPLACE FUNCTION admin_create_branch(
  p_name TEXT,
  p_code TEXT,
  p_manager_user_id UUID,
  p_config JSONB DEFAULT '{}',
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- PIN required for branch creation
  IF p_pin IS NOT NULL THEN
    PERFORM _verify_admin_pin(v_admin_id, p_pin);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Unauthorized: not an admin';
    END IF;
  END IF;

  -- Validate manager exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_manager_user_id) THEN
    RAISE EXCEPTION 'Manager user not found';
  END IF;

  -- Validate code uniqueness
  IF EXISTS (SELECT 1 FROM branches WHERE branch_code = p_code) THEN
    RAISE EXCEPTION 'Branch code already exists';
  END IF;

  -- Create branch with optional config overrides
  INSERT INTO branches (
    branch_code, name, manager_user_id,
    yes_markup_pct, no_markup_pct, branch_fee_rate,
    exit_fee_pct, display_mode, cash_out_enabled,
    default_position_cap_yes, default_position_cap_no
  ) VALUES (
    p_code, p_name, p_manager_user_id,
    COALESCE((p_config->>'yes_markup_pct')::DECIMAL, 0.0500),
    COALESCE((p_config->>'no_markup_pct')::DECIMAL, 0.0500),
    COALESCE((p_config->>'branch_fee_rate')::DECIMAL, 0.050000),
    COALESCE((p_config->>'exit_fee_pct')::DECIMAL, 0.0050),
    COALESCE((p_config->>'display_mode')::branch_display_mode, 'betting'),
    COALESCE((p_config->>'cash_out_enabled')::BOOLEAN, true),
    (p_config->>'default_position_cap_yes')::DECIMAL,
    (p_config->>'default_position_cap_no')::DECIMAL
  )
  RETURNING id INTO v_branch_id;

  -- Auto-assign manager to branch
  INSERT INTO branch_user_assignments (user_id, branch_id)
  VALUES (p_manager_user_id, v_branch_id)
  ON CONFLICT DO NOTHING;

  PERFORM log_system_event('info'::log_severity, 'branch/created',
    'Branch "' || p_name || '" created',
    jsonb_build_object(
      'branch_id', v_branch_id, 'code', p_code,
      'manager_id', p_manager_user_id, 'admin_id', v_admin_id
    )
  );

  RETURN jsonb_build_object(
    'branch_id', v_branch_id,
    'branch_code', p_code,
    'name', p_name,
    'manager_user_id', p_manager_user_id
  );
END;
$$;

-- ============================================================
-- 2. admin_update_branch_status
-- ============================================================
CREATE OR REPLACE FUNCTION admin_update_branch_status(
  p_branch_id UUID,
  p_new_status TEXT,
  p_reason TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_old_status TEXT;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  v_old_status := v_branch.status::TEXT;

  -- Validate not self-transition
  IF v_old_status = p_new_status THEN
    RAISE EXCEPTION 'Branch is already in % status', p_new_status;
  END IF;

  -- Validate new status is a valid enum value
  IF p_new_status NOT IN ('active', 'payback', 'frozen', 'suspended') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  -- If clearing payback, check pending_payouts
  IF v_old_status = 'payback' AND p_new_status = 'active' THEN
    IF v_branch.pending_payouts > 0 THEN
      -- Admin can override but must provide reason
      IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Reason required when clearing payback with pending payouts ($%)',
          ROUND(v_branch.pending_payouts, 2);
      END IF;
      -- Clear pending payouts as part of admin override
      UPDATE branches SET pending_payouts = 0 WHERE id = p_branch_id;
    END IF;
  END IF;

  -- Execute status change
  UPDATE branches SET
    status = p_new_status::branch_status,
    suspension_reason = CASE WHEN p_new_status IN ('frozen', 'suspended') THEN p_reason ELSE NULL END,
    payback_activated_at = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_activated_at, now())
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_activated_at
    END,
    payback_reason = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_reason, p_reason)
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_reason
    END,
    updated_at = NOW()
  WHERE id = p_branch_id;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'status_change', COALESCE(p_reason, 'Admin status change'),
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/status_change',
    'Branch status: ' || v_old_status || ' → ' || p_new_status,
    jsonb_build_object(
      'branch_id', p_branch_id, 'admin_id', v_admin_id,
      'old_status', v_old_status, 'new_status', p_new_status, 'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'reason', p_reason
  );
END;
$$;

-- ============================================================
-- 3. admin_override_solvency
-- ============================================================
CREATE OR REPLACE FUNCTION admin_override_solvency(
  p_branch_id UUID,
  p_new_pct DECIMAL,
  p_duration_hours INT,
  p_note TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_until TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate inputs
  IF p_new_pct < 0.80 OR p_new_pct > 1.00 THEN
    RAISE EXCEPTION 'Solvency threshold must be between 80%% and 100%%';
  END IF;
  IF p_duration_hours < 1 OR p_duration_hours > 168 THEN
    RAISE EXCEPTION 'Duration must be 1-168 hours (max 7 days)';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Note is required for solvency overrides';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  v_until := now() + (p_duration_hours || ' hours')::INTERVAL;

  UPDATE branches SET
    solvency_override_pct = p_new_pct,
    solvency_override_until = v_until,
    solvency_override_by = v_admin_id,
    updated_at = NOW()
  WHERE id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'solvency_gate_loosened', p_note,
    jsonb_build_object('old_pct', v_branch.solvency_override_pct, 'old_until', v_branch.solvency_override_until),
    jsonb_build_object('new_pct', p_new_pct, 'until', v_until, 'hours', p_duration_hours)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/solvency_override',
    'Solvency gate overridden to ' || (p_new_pct * 100) || '% for ' || p_duration_hours || 'h',
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'new_pct', p_new_pct, 'until', v_until)
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'new_threshold', p_new_pct,
    'until', v_until,
    'hours', p_duration_hours
  );
END;
$$;

-- ============================================================
-- 4. admin_override_withdrawal — bypasses reserve lock
-- ============================================================
CREATE OR REPLACE FUNCTION admin_override_withdrawal(
  p_branch_id UUID,
  p_amount DECIMAL,
  p_destination TEXT,
  p_note TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_new_pool_balance DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Note is required for override withdrawals';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Hard floor: cannot overdraw the actual pool
  IF p_amount > v_branch.pool_balance THEN
    RAISE EXCEPTION 'Amount exceeds pool balance ($%)', ROUND(v_branch.pool_balance, 2);
  END IF;

  -- Read fee
  SELECT rate INTO v_fee_rate FROM fee_config
  WHERE fee_type = 'branch_withdrawal_fee' AND level IS NULL;
  IF v_fee_rate IS NULL THEN v_fee_rate := 0.01; END IF;

  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- Pool ledger entries
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'withdrawal', -p_amount,
          v_branch.pool_balance - p_amount,
          'ADMIN OVERRIDE withdrawal to ' || p_destination);

  IF v_fee > 0 THEN
    INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
    VALUES (p_branch_id, 'withdrawal_fee', v_fee,
            v_branch.pool_balance - p_amount + v_fee,
            'Withdrawal fee retained');
  END IF;

  UPDATE branches SET
    pool_balance = pool_balance - p_amount + v_fee,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_pool_balance;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'withdrawal_lock_bypassed', p_note,
    jsonb_build_object('pool_balance', v_branch.pool_balance),
    jsonb_build_object('withdrawal', p_amount, 'fee', v_fee, 'destination', p_destination, 'new_pool', v_new_pool_balance)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/admin_withdrawal',
    'Admin override withdrawal $' || p_amount,
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'amount', p_amount, 'destination', p_destination)
  );

  RETURN jsonb_build_object(
    'withdrawal_amount', ROUND(p_amount, 2),
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'new_pool_balance', ROUND(v_new_pool_balance, 2),
    'destination', p_destination,
    'override', true
  );
END;
$$;

-- ============================================================
-- 5. admin_adjust_branch_pool — manual pool credit/debit
-- ============================================================
CREATE OR REPLACE FUNCTION admin_adjust_branch_pool(
  p_branch_id UUID,
  p_amount DECIMAL,
  p_description TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_new_balance DECIMAL;
  v_sweep DECIMAL := 0;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- For debits, check sufficient balance
  IF p_amount < 0 AND v_branch.pool_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient pool balance for debit';
  END IF;

  -- Update pool balance
  UPDATE branches SET
    pool_balance = pool_balance + p_amount,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_balance;

  -- Pool ledger entry
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'adjustment', p_amount, v_new_balance,
          COALESCE(p_description, 'Admin pool adjustment'));

  -- Payback sweep on positive adjustment
  IF p_amount > 0 AND v_branch.status = 'payback' AND v_branch.pending_payouts > 0 THEN
    v_sweep := LEAST(p_amount, v_branch.pending_payouts);
    IF v_sweep > 0 THEN
      INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
      VALUES (p_branch_id, 'payback_sweep', -v_sweep,
              v_new_balance - v_sweep,
              'Payback sweep on admin pool credit');

      UPDATE branches SET
        pending_payouts = GREATEST(0, pending_payouts - v_sweep),
        pool_balance = pool_balance - v_sweep
      WHERE id = p_branch_id
      RETURNING pool_balance INTO v_new_balance;

      -- Auto-clear payback if pending hits 0
      PERFORM _try_clear_payback(p_branch_id);
    END IF;
  END IF;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'pool_adjustment',
    COALESCE(p_description, 'Pool adjustment'),
    jsonb_build_object('pool_balance', v_branch.pool_balance),
    jsonb_build_object('adjustment', p_amount, 'new_balance', v_new_balance, 'sweep', v_sweep)
  );

  PERFORM log_system_event('info'::log_severity, 'branch/pool_adjustment',
    'Admin pool adjustment $' || p_amount,
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'amount', p_amount, 'new_balance', v_new_balance)
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'adjustment', ROUND(p_amount, 2),
    'new_pool_balance', ROUND(v_new_balance, 2),
    'payback_sweep', ROUND(v_sweep, 2)
  );
END;
$$;
