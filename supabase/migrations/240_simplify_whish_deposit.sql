-- 240_simplify_whish_deposit.sql — Simplify Whish manual deposit flow
--
-- User form now only shows deposit numbers + optional screenshot.
-- Amount is set by admin on approval, not by user on submission.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. Update submit_manual_deposit — relax validations
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_manual_deposit(
  p_amount DECIMAL,
  p_whish_number TEXT DEFAULT NULL,
  p_proof_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_deposit_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Amount can be 0 (admin sets real amount on approval)
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must not be negative';
  END IF;

  INSERT INTO deposits (
    user_id, amount, fee, net_amount, currency,
    provider, status, whish_number, proof_image_url
  )
  VALUES (
    v_user_id, p_amount, 0, 0, 'USD',
    'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
  )
  RETURNING id INTO v_deposit_id;

  -- Log the event
  PERFORM log_system_event(
    'info',
    'deposit/manual',
    'Manual Whish deposit submitted',
    jsonb_build_object(
      'deposit_id', v_deposit_id,
      'user_id', v_user_id,
      'has_proof', p_proof_image_url IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'status', 'pending_review'
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 2. Update admin_review_deposit — admin sets amount on approve
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_review_deposit(
  p_deposit_id UUID,
  p_action TEXT,
  p_amount DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit RECORD;
  v_new_balance DECIMAL;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_final_amount DECIMAL;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- Lock deposit row
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_deposit.status != 'pending_review' THEN
    RAISE EXCEPTION 'Deposit is not pending review (current: %)', v_deposit.status;
  END IF;

  IF p_action = 'approve' THEN
    -- Use admin-provided amount, fall back to original deposit amount
    v_final_amount := COALESCE(p_amount, v_deposit.amount);

    IF v_final_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit amount must be greater than zero';
    END IF;

    -- Read deposit fee from config
    SELECT rate INTO v_deposit_fee_rate
    FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

    v_fee := v_final_amount * COALESCE(v_deposit_fee_rate, 0);
    v_net_amount := v_final_amount - v_fee;

    -- Update deposit with final amount, fee, net_amount
    UPDATE deposits
    SET status = 'confirmed',
        confirmed_at = NOW(),
        amount = v_final_amount,
        fee = v_fee,
        net_amount = v_net_amount
    WHERE id = p_deposit_id;

    -- Lock user row, credit balance
    UPDATE users
    SET balance_usd = balance_usd + v_net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_deposit.user_id, 'deposit', v_net_amount,
      v_new_balance, p_deposit_id,
      'Manual Whish deposit approved'
    );

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_final_amount,
        'fee', v_fee,
        'net_amount', v_net_amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'amount', v_final_amount,
      'net_amount', v_net_amount
    );
  ELSE
    -- Reject — no balance mutation needed
    UPDATE deposits
    SET status = 'rejected'
    WHERE id = p_deposit_id;

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;

COMMIT;
