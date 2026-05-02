-- 288_narrow_withdrawal_to_whish_trc20.sql
-- Narrow process_withdrawal signature to match launch scope:
-- Only two rails are supported:
--   1. Whish — Lebanese mobile payment (destination = phone number)
--   2. USDT TRC20 — crypto on Tron (destination = TRC20 wallet address)
--
-- Migration 285 opened the RPC to 'bank' and ERC20 as well. We're dropping
-- those at the user's request:
--   - Bank withdrawals: out of scope for MENA launch
--   - USDT ERC20: gas fees make small withdrawals uneconomical; TRC20 covers
--     the same use case with ~zero fees
--
-- Schema (migration 284) keeps the columns as-is — we don't need to drop
-- destination_type='bank' or network='ERC20' support at the column level,
-- we just reject them in the RPC. If either rail comes back later, reversing
-- is additive (accept the value, not a schema change).

BEGIN;

CREATE OR REPLACE FUNCTION process_withdrawal(
  p_amount DECIMAL,
  p_destination TEXT,            -- actual address or phone number
  p_currency TEXT,
  p_destination_type TEXT,        -- 'crypto' | 'whish' — 'bank' no longer accepted
  p_network TEXT DEFAULT NULL     -- must be 'TRC20' when destination_type='crypto'; NULL otherwise
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
  v_provider TEXT;
  v_destination_trimmed TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < v_min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', v_min_withdrawal;
  END IF;

  -- ═══ Destination validation — Whish or USDT TRC20 only ═══
  IF p_destination_type IS NULL OR p_destination_type NOT IN ('crypto', 'whish') THEN
    RAISE EXCEPTION 'Invalid destination_type: must be crypto or whish';
  END IF;

  v_destination_trimmed := TRIM(COALESCE(p_destination, ''));
  IF v_destination_trimmed = '' THEN
    RAISE EXCEPTION 'Destination cannot be empty';
  END IF;

  IF p_destination_type = 'crypto' THEN
    -- Only TRC20 supported at launch. ERC20 intentionally disabled (gas fees
    -- make small withdrawals uneconomical). If NULL, default to TRC20.
    IF p_network IS NULL THEN
      p_network := 'TRC20';
    END IF;
    IF p_network != 'TRC20' THEN
      RAISE EXCEPTION 'Only USDT TRC20 is supported for crypto withdrawals at this time';
    END IF;
    IF v_destination_trimmed !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
      RAISE EXCEPTION 'Invalid TRC20 address format (must start with T, 34 characters, base58)';
    END IF;
    v_provider := '3pay';
  ELSE  -- whish
    -- Lebanese phone: loose validation — 8-15 digits, optional leading +
    IF v_destination_trimmed !~ '^[+]?[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone number format for Whish withdrawal';
    END IF;
    IF p_network IS NOT NULL THEN
      RAISE EXCEPTION 'Network must be NULL for Whish withdrawal';
    END IF;
    v_provider := 'whish_manual';
  END IF;

  -- ═══ Lock user row + guards ═══
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  IF v_user.total_wagered < v_user.wagering_requirement THEN
    RAISE EXCEPTION 'Wagering requirement not met. Wagered: $%, Required: $%',
      ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
  END IF;

  SELECT MIN(confirmed_at) INTO v_first_deposit_time
  FROM deposits WHERE user_id = v_user_id AND status = 'confirmed';
  IF v_first_deposit_time IS NULL OR v_first_deposit_time > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Withdrawals available 24 hours after first deposit';
  END IF;

  SELECT rate INTO v_withdrawal_fee_rate
  FROM fee_config WHERE fee_type = 'withdrawal_fee' LIMIT 1;
  v_fee := p_amount * COALESCE(v_withdrawal_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ═══ Hold funds ═══
  UPDATE users SET balance_usd = balance_usd - p_amount WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO withdrawals (
    user_id, amount, fee, net_amount, currency,
    destination, destination_type, network, provider
  )
  VALUES (
    v_user_id, p_amount, v_fee, v_net_amount, p_currency,
    v_destination_trimmed, p_destination_type, p_network, v_provider
  )
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount,
    v_new_balance,
    v_withdrawal_id,
    'Withdrawal request (' || p_currency || ' via ' || v_provider || ')'
  );

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'provider', v_provider
  );
END;
$$;

COMMIT;
