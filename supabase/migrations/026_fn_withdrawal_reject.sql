-- 026_fn_withdrawal_reject.sql — Admin rejects a pending withdrawal (refunds user)

CREATE OR REPLACE FUNCTION withdrawal_reject(
  p_withdrawal_id UUID,
  p_admin_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_withdrawal RECORD;
  v_user RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending';
  END IF;

  -- Refund the held amount
  SELECT * INTO v_user FROM users WHERE id = v_withdrawal.user_id FOR UPDATE;

  UPDATE users SET balance_usd = balance_usd + v_withdrawal.amount
  WHERE id = v_withdrawal.user_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_withdrawal.user_id, 'refund', v_withdrawal.amount,
    v_user.balance_usd + v_withdrawal.amount,
    p_withdrawal_id,
    'Withdrawal rejected — funds returned'
  );

  UPDATE withdrawals SET
    status = 'rejected',
    admin_notes = p_admin_notes,
    processed_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;
