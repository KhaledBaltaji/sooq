-- 025_fn_withdrawal_approve.sql — Admin approves a pending withdrawal

CREATE OR REPLACE FUNCTION withdrawal_approve(
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
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending';
  END IF;

  UPDATE withdrawals SET
    status = 'approved',
    admin_notes = p_admin_notes,
    processed_at = NOW()
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;
