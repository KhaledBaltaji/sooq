-- 106_v3_fix_process_deposit.sql — Update process_deposit for V3 column rename + multi-provider
-- threepay_ref → provider_ref, add p_provider parameter

CREATE OR REPLACE FUNCTION process_deposit(
  p_user_id UUID,
  p_amount DECIMAL,
  p_currency TEXT,
  p_provider_ref TEXT,
  p_provider TEXT DEFAULT '3pay'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_deposit_id UUID;
  v_existing UUID;
BEGIN
  -- Auth check: block regular authenticated users; allow service_role and admins only
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'process_deposit: unauthorized — admin or service_role only';
    END IF;
  END IF;

  -- Validate amount (defense in depth — table CHECK also enforces > 0)
  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must be positive';
  END IF;

  -- Idempotency: check if this ref already processed
  SELECT id INTO v_existing FROM deposits WHERE provider_ref = p_provider_ref;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('deposit_id', v_existing, 'status', 'already_processed');
  END IF;

  -- Read deposit fee from config
  SELECT rate INTO v_deposit_fee_rate
  FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

  v_fee := p_amount * COALESCE(v_deposit_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  -- Lock user row
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Insert deposit record
  INSERT INTO deposits (user_id, amount, fee, net_amount, currency, provider_ref, provider, status, confirmed_at)
  VALUES (p_user_id, p_amount, v_fee, v_net_amount, p_currency, p_provider_ref, p_provider, 'confirmed', NOW())
  RETURNING id INTO v_deposit_id;

  -- Credit balance
  UPDATE users SET balance_usd = balance_usd + v_net_amount WHERE id = p_user_id;

  -- Ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_user_id, 'deposit', v_net_amount,
    v_user.balance_usd + v_net_amount,
    v_deposit_id,
    'Deposit ' || p_currency || ' via ' || p_provider
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'net_amount', v_net_amount,
    'status', 'confirmed'
  );
END;
$$;
