-- 190_fix_deposit_withdrawal_returning.sql — Use UPDATE ... RETURNING for balance_after
--
-- Bug: Both process_deposit and process_withdrawal compute balance_after from a
-- pre-read snapshot (v_user.balance_usd ± amount). Under concurrent mutations the
-- snapshot is stale, producing incorrect balance_after in the transactions ledger.
--
-- Fix: Same pattern applied to execute_trade in migration 187 — do the UPDATE first,
-- capture the actual post-update balance via RETURNING, then use that for the ledger.

-- ══════════════════════════════════════════════════════════════
-- 1. process_deposit — UPDATE ... RETURNING balance_usd
-- ══════════════════════════════════════════════════════════════

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
  v_new_balance DECIMAL;
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

  -- Credit balance — capture actual post-update balance via RETURNING
  UPDATE users SET balance_usd = balance_usd + v_net_amount WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  -- Ledger entry (uses actual balance from RETURNING, not stale snapshot)
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_user_id, 'deposit', v_net_amount,
    v_new_balance,
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


-- ══════════════════════════════════════════════════════════════
-- 2. process_withdrawal — UPDATE ... RETURNING balance_usd
-- ══════════════════════════════════════════════════════════════

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
  v_new_balance DECIMAL;
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

  -- Hold funds (debit immediately) — capture actual post-update balance via RETURNING
  UPDATE users SET balance_usd = balance_usd - p_amount WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  -- Create pending withdrawal first so we have the reference_id
  INSERT INTO withdrawals (user_id, amount, fee, net_amount, currency, destination)
  VALUES (v_user_id, p_amount, v_fee, v_net_amount, p_currency, p_destination)
  RETURNING id INTO v_withdrawal_id;

  -- Ledger entry (uses actual balance from RETURNING, not stale snapshot)
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount,
    v_new_balance,
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
