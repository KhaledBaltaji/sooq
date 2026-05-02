-- 243_admin_review_withdrawal.sql — Admin approve/reject withdrawal with refund + audit
--
-- Fixes critical bug: withdrawal rejection previously did a raw table update with
-- no balance refund, no audit trail, no PIN protection. Funds were already deducted
-- at request time by process_withdrawal, so rejecting without refund = money loss.
--
-- This RPC mirrors admin_review_deposit (migration 240) for consistency.

CREATE OR REPLACE FUNCTION admin_review_withdrawal(
  p_withdrawal_id UUID,
  p_action TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_withdrawal RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- ═══ 1. Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ 2. PIN verification (same pattern as admin_adjust_balance) ═══
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

  -- ═══ 3. Validate action ═══
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- ═══ 4. Lock withdrawal row + validate status ═══
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

  IF p_action = 'approve' THEN
    -- ═══ APPROVE: update status, log ═══
    UPDATE withdrawals
    SET status = 'approved'
    WHERE id = p_withdrawal_id;

    PERFORM log_system_event(
      'info',
      'admin/withdrawal',
      'Withdrawal approved by admin',
      jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'net_amount', v_withdrawal.net_amount,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'amount', v_withdrawal.amount,
      'net_amount', v_withdrawal.net_amount
    );

  ELSE
    -- ═══ REJECT: refund full amount to user balance + ledger entry ═══
    UPDATE users
    SET balance_usd = balance_usd + v_withdrawal.amount
    WHERE id = v_withdrawal.user_id
    RETURNING balance_usd INTO v_new_balance;

    UPDATE withdrawals
    SET status = 'rejected'
    WHERE id = p_withdrawal_id;

    -- Ledger entry: refund the held amount
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
    VALUES (
      v_withdrawal.user_id, 'refund', v_withdrawal.amount,
      v_new_balance, p_withdrawal_id,
      'Withdrawal rejected — funds returned',
      v_admin_id
    );

    PERFORM log_system_event(
      'info',
      'admin/withdrawal',
      'Withdrawal rejected by admin — funds refunded',
      jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'refunded_balance', v_new_balance,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'refunded_amount', v_withdrawal.amount,
      'new_balance', v_new_balance
    );
  END IF;
END;
$$;
