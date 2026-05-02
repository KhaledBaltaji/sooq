-- 286_admin_review_deposit_pin.sql
-- Adds PIN protection to admin_review_deposit, matching the pattern in
-- admin_review_withdrawal (migration 243 / 285). Previous version had only
-- is_admin check — an admin cookie was sufficient to approve deposits.
-- PIN raises the bar to "something the admin knows" and lock-out policy
-- (5 wrong attempts → 15 min lock) makes brute force impractical.
--
-- Signature change: adds p_pin TEXT as last param. Frontend updated in
-- the same PR (src/components/admin/deposit-actions.tsx) to prompt.

BEGIN;

CREATE OR REPLACE FUNCTION admin_review_deposit(
  p_deposit_id UUID,
  p_action TEXT,
  p_amount DECIMAL DEFAULT NULL,
  p_pin TEXT DEFAULT NULL  -- nullable for Supabase function-overload resolution; enforced below
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_deposit RECORD;
  v_new_balance DECIMAL;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_final_amount DECIMAL;
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ PIN enforcement (required) ═══
  IF p_pin IS NULL OR length(p_pin) = 0 THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_admin_id FOR UPDATE;
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
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = v_admin_id;

  -- ═══ Validate action ═══
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- ═══ Lock deposit row ═══
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

    -- Update deposit with final amount, fee, and confirm
    UPDATE deposits
    SET amount = v_final_amount,
        fee = v_fee,
        net_amount = v_net_amount,
        status = 'confirmed',
        confirmed_at = now()
    WHERE id = p_deposit_id;

    -- Credit user balance
    UPDATE users
    SET balance_usd = balance_usd + v_net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
    VALUES (
      v_deposit.user_id, 'deposit', v_net_amount,
      v_new_balance, p_deposit_id,
      'Manual deposit approved (' || v_deposit.provider || ')',
      v_admin_id
    );

    PERFORM log_system_event(
      'info',
      'admin/deposit',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_final_amount,
        'net_amount', v_net_amount,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'confirmed',
      'amount', v_final_amount,
      'net_amount', v_net_amount,
      'new_balance', v_new_balance
    );

  ELSE
    -- ═══ REJECT: mark rejected, no balance change (no funds were held) ═══
    UPDATE deposits SET status = 'rejected' WHERE id = p_deposit_id;

    PERFORM log_system_event(
      'info',
      'admin/deposit',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;

COMMIT;
