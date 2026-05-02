-- 024_fn_process_withdrawal.sql — User-initiated withdrawal request
-- Uses auth.uid(). FOR UPDATE. Validates balance, wagering, 24hr delay.

CREATE OR REPLACE FUNCTION process_withdrawal(
  p_amount DECIMAL,
  p_destination TEXT,
  p_currency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_withdrawal_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_withdrawal_id UUID;
  v_min_withdrawal DECIMAL := 10;
  v_first_deposit_time TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < v_min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', v_min_withdrawal;
  END IF;

  -- Lock user row
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- Wagering requirement check
  IF v_user.total_wagered < v_user.wagering_requirement THEN
    RAISE EXCEPTION 'Wagering requirement not met. Wagered: $%, Required: $%',
      ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
  END IF;

  -- 24hr delay: must have first deposit older than 24hr
  SELECT MIN(confirmed_at) INTO v_first_deposit_time
  FROM deposits WHERE user_id = v_user_id AND status = 'confirmed';

  IF v_first_deposit_time IS NULL OR v_first_deposit_time > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Withdrawals available 24 hours after first deposit';
  END IF;

  -- Fee calculation
  SELECT rate INTO v_withdrawal_fee_rate
  FROM fee_config WHERE fee_type = 'withdrawal_fee' LIMIT 1;

  v_fee := p_amount * COALESCE(v_withdrawal_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  -- Balance check
  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Hold funds (debit immediately, credit back if rejected)
  UPDATE users SET balance_usd = balance_usd - p_amount WHERE id = v_user_id;

  -- Create pending withdrawal first so we have the reference_id
  INSERT INTO withdrawals (user_id, amount, fee, net_amount, currency, destination)
  VALUES (v_user_id, p_amount, v_fee, v_net_amount, p_currency, p_destination)
  RETURNING id INTO v_withdrawal_id;

  -- Ledger entry (with withdrawal reference_id)
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount,
    v_user.balance_usd - p_amount,
    v_withdrawal_id,
    'Withdrawal request (' || p_currency || ')'
  );

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2)
  );
END;
$$;
