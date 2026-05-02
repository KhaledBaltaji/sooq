-- 285_withdrawal_lifecycle_rpcs.sql
-- Three RPC changes paired with schema migration 284:
--
-- 1. process_withdrawal — new signature with destination_type + network,
--    per-type destination format validation, stores provider + destination_type
--    + network alongside destination. OLD signature dropped — callers must
--    pass the destination type explicitly.
--
-- 2. admin_mark_withdrawal_sent — NEW RPC. Moves an approved withdrawal
--    to 'sent' status after ops manually sends the money externally.
--    PIN-protected. Records external_reference_id (whish tx id, blockchain
--    tx hash, or bank wire ref). Without this, approved withdrawals had no
--    terminal state and reconciliation was impossible.
--
-- 3. admin_review_withdrawal — re-checks wagering requirement at approval
--    time. Previously only checked at submit. If user placed losing bets
--    between submit and approval, wagering could drift below the gate and
--    admin could still approve. Now approval is blocked; admin must reject.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. process_withdrawal — new signature with destination validation
-- ═══════════════════════════════════════════════════════════════════

-- Drop old 3-arg signature. Tests + withdraw-modal.tsx callers MUST be
-- updated to pass p_destination_type (and p_network for crypto).
DROP FUNCTION IF EXISTS process_withdrawal(DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION process_withdrawal(
  p_amount DECIMAL,
  p_destination TEXT,            -- actual address / phone / IBAN
  p_currency TEXT,
  p_destination_type TEXT,        -- 'crypto' | 'whish' | 'bank'
  p_network TEXT DEFAULT NULL     -- 'TRC20' | 'ERC20' for crypto; NULL otherwise
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

  -- ═══ Destination validation ═══
  IF p_destination_type IS NULL OR p_destination_type NOT IN ('crypto', 'whish', 'bank') THEN
    RAISE EXCEPTION 'Invalid destination_type: must be crypto, whish, or bank';
  END IF;

  v_destination_trimmed := TRIM(COALESCE(p_destination, ''));
  IF v_destination_trimmed = '' THEN
    RAISE EXCEPTION 'Destination cannot be empty';
  END IF;

  IF p_destination_type = 'crypto' THEN
    IF p_network IS NULL OR p_network NOT IN ('TRC20', 'ERC20') THEN
      RAISE EXCEPTION 'Network must be TRC20 or ERC20 for crypto withdrawal';
    END IF;
    IF p_network = 'TRC20' AND v_destination_trimmed !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
      RAISE EXCEPTION 'Invalid TRC20 address format';
    END IF;
    IF p_network = 'ERC20' AND v_destination_trimmed !~ '^0x[a-fA-F0-9]{40}$' THEN
      RAISE EXCEPTION 'Invalid ERC20 address format';
    END IF;
    v_provider := '3pay';
  ELSIF p_destination_type = 'whish' THEN
    -- Lebanese phone: loose validation — 8-15 digits, optional leading +
    IF v_destination_trimmed !~ '^[+]?[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone number format for Whish withdrawal';
    END IF;
    IF p_network IS NOT NULL THEN
      RAISE EXCEPTION 'Network must be NULL for whish withdrawal';
    END IF;
    v_provider := 'whish_manual';
  ELSE  -- bank
    IF length(v_destination_trimmed) < 8 THEN
      RAISE EXCEPTION 'Bank account / IBAN must be at least 8 characters';
    END IF;
    IF p_network IS NOT NULL THEN
      RAISE EXCEPTION 'Network must be NULL for bank withdrawal';
    END IF;
    v_provider := 'bank_manual';
  END IF;

  -- ═══ Lock user row + guards ═══
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- Wagering requirement
  IF v_user.total_wagered < v_user.wagering_requirement THEN
    RAISE EXCEPTION 'Wagering requirement not met. Wagered: $%, Required: $%',
      ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
  END IF;

  -- 24hr delay
  SELECT MIN(confirmed_at) INTO v_first_deposit_time
  FROM deposits WHERE user_id = v_user_id AND status = 'confirmed';
  IF v_first_deposit_time IS NULL OR v_first_deposit_time > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Withdrawals available 24 hours after first deposit';
  END IF;

  -- Fee
  SELECT rate INTO v_withdrawal_fee_rate
  FROM fee_config WHERE fee_type = 'withdrawal_fee' LIMIT 1;
  v_fee := p_amount * COALESCE(v_withdrawal_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  -- Balance
  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ═══ Hold funds — debit now, refund if admin rejects ═══
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

  -- Ledger entry
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


-- ═══════════════════════════════════════════════════════════════════
-- 2. admin_mark_withdrawal_sent — approved → sent with external ref
-- ═══════════════════════════════════════════════════════════════════
--
-- Called after ops has manually sent the money externally (via Whish app,
-- bank wire, or 3pay payout API). Records external_reference_id so we can
-- reconcile later. PIN-protected. Idempotent via status guard +
-- external_reference_id uniqueness check.

CREATE OR REPLACE FUNCTION admin_mark_withdrawal_sent(
  p_withdrawal_id UUID,
  p_external_reference_id TEXT,
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
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ Input validation ═══
  IF p_external_reference_id IS NULL OR TRIM(p_external_reference_id) = '' THEN
    RAISE EXCEPTION 'External reference ID is required (Whish tx id, blockchain tx hash, or bank wire ref)';
  END IF;

  -- ═══ PIN verification (same pattern as admin_review_withdrawal) ═══
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

  -- ═══ Lock + validate withdrawal ═══
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved withdrawals can be marked sent (current status: %)', v_withdrawal.status;
  END IF;
  IF v_withdrawal.external_reference_id IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal already has an external reference (marked sent previously)';
  END IF;

  -- ═══ Transition approved → sent ═══
  UPDATE withdrawals
  SET status = 'sent',
      sent_at = now(),
      sent_by = v_admin_id,
      external_reference_id = TRIM(p_external_reference_id)
  WHERE id = p_withdrawal_id;

  PERFORM log_system_event(
    'info',
    'admin/withdrawal',
    'Withdrawal marked as sent',
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount,
      'net_amount', v_withdrawal.net_amount,
      'provider', v_withdrawal.provider,
      'external_reference_id', TRIM(p_external_reference_id),
      'admin_id', v_admin_id
    )
  );

  RETURN jsonb_build_object(
    'status', 'sent',
    'withdrawal_id', p_withdrawal_id,
    'external_reference_id', TRIM(p_external_reference_id),
    'sent_at', now()
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. admin_review_withdrawal — wagering recheck at approval time
-- ═══════════════════════════════════════════════════════════════════
--
-- Replaces migration 243. Same PIN pattern, same reject refund logic. New:
-- approval now re-locks the user row and re-verifies wagering requirement.
-- Prevents drift: user places losing bets between submit & approval.

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
  v_user RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ PIN verification ═══
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

  -- ═══ Lock withdrawal + validate status ═══
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

  IF p_action = 'approve' THEN
    -- ═══ Wagering recheck at approval (P2 #10 fix) ═══
    SELECT * INTO v_user FROM users WHERE id = v_withdrawal.user_id FOR UPDATE;
    IF v_user.total_wagered < v_user.wagering_requirement THEN
      RAISE EXCEPTION 'Wagering requirement no longer met (wagered: $%, required: $%). Reject this withdrawal and ask user to resubmit.',
        ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
    END IF;

    UPDATE withdrawals SET status = 'approved' WHERE id = p_withdrawal_id;

    PERFORM log_system_event(
      'info',
      'admin/withdrawal',
      'Withdrawal approved by admin',
      jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'net_amount', v_withdrawal.net_amount,
        'destination', v_withdrawal.destination,
        'destination_type', v_withdrawal.destination_type,
        'provider', v_withdrawal.provider,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'amount', v_withdrawal.amount,
      'net_amount', v_withdrawal.net_amount,
      'destination', v_withdrawal.destination,
      'provider', v_withdrawal.provider
    );

  ELSE
    -- ═══ REJECT: refund full amount ═══
    UPDATE users SET balance_usd = balance_usd + v_withdrawal.amount
    WHERE id = v_withdrawal.user_id
    RETURNING balance_usd INTO v_new_balance;

    UPDATE withdrawals SET status = 'rejected' WHERE id = p_withdrawal_id;

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

COMMIT;
