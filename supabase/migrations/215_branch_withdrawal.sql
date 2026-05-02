-- ============================================================
-- 215: S2 Branch System — Branch Withdrawal
--
-- Branch manager withdraws from pool to external wallet.
-- 1% fee (from fee_config). Reserve lock prevents overdrawing
-- past worst_case_total + pending_payouts.
-- Blocked in payback/frozen/suspended states.
-- ============================================================

CREATE OR REPLACE FUNCTION branch_withdrawal(
  p_branch_id UUID,
  p_amount DECIMAL,
  p_destination TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_solvency JSONB;
  v_withdrawal_available DECIMAL;
  v_new_pool_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  IF p_destination IS NULL OR length(trim(p_destination)) = 0 THEN
    RAISE EXCEPTION 'Destination is required';
  END IF;

  -- Lock branch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Authorization: only manager can withdraw
  IF v_user_id != v_branch.manager_user_id THEN
    RAISE EXCEPTION 'Only the branch manager can make withdrawals';
  END IF;

  -- Status checks
  IF v_branch.status = 'payback' THEN
    RAISE EXCEPTION 'Withdrawals blocked in payback mode';
  END IF;
  IF v_branch.status = 'frozen' THEN
    RAISE EXCEPTION 'Branch is frozen — withdrawals blocked';
  END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended — withdrawals blocked';
  END IF;

  -- Read fee from config
  SELECT rate INTO v_fee_rate FROM fee_config
  WHERE fee_type = 'branch_withdrawal_fee' AND level IS NULL;
  IF v_fee_rate IS NULL THEN v_fee_rate := 0.01; END IF;

  -- Reserve lock check via solvency function
  v_solvency := branch_solvency_check(p_branch_id);
  v_withdrawal_available := (v_solvency->>'withdrawal_available')::DECIMAL;

  IF p_amount > v_withdrawal_available THEN
    RAISE EXCEPTION 'Insufficient available balance — reserve lock ($% available)',
      ROUND(v_withdrawal_available, 2);
  END IF;

  -- Calculate fee
  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- Pool ledger: withdrawal entry (negative)
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'withdrawal', -p_amount,
          v_branch.pool_balance - p_amount,
          'Withdrawal to ' || p_destination || COALESCE(' — ' || p_note, ''));

  -- Pool ledger: fee retained (positive)
  IF v_fee > 0 THEN
    INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
    VALUES (p_branch_id, 'withdrawal_fee', v_fee,
            v_branch.pool_balance - p_amount + v_fee,
            'Withdrawal fee retained (1%)');
  END IF;

  -- Update branch pool balance cache
  UPDATE branches SET
    pool_balance = pool_balance - p_amount + v_fee,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_pool_balance;

  -- Audit log
  PERFORM log_system_event('info'::log_severity, 'branch/withdrawal',
    'Branch withdrawal $' || p_amount || ' to ' || p_destination,
    jsonb_build_object(
      'branch_id', p_branch_id, 'manager_id', v_user_id,
      'gross_amount', p_amount, 'fee', v_fee, 'net_amount', v_net_amount,
      'destination', p_destination, 'note', p_note,
      'new_pool_balance', v_new_pool_balance
    )
  );

  RETURN jsonb_build_object(
    'withdrawal_amount', ROUND(p_amount, 2),
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'new_pool_balance', ROUND(v_new_pool_balance, 2),
    'destination', p_destination
  );
END;
$$;
