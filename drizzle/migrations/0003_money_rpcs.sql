-- 0003_money_rpcs.sql — V1 money RPCs adapted to slim Sooq schema
--
-- Differences from prediction-market originals:
--   * No fee/net_amount columns — handled in the app layer for v1.
--   * No wagering requirement, no 24h hold (per plan: instant withdrawals,
--     accepted fraud exposure for v1; admin still reviews each one).
--   * Withdrawal uses (method, account_details JSONB) instead of the old
--     (destination, destination_type, network, provider) split.
--   * auth.uid() → app.user_id() (set by Drizzle on every connection).
--   * Deposit status enum is 'pending'/'verified'/'rejected'/'expired'
--     (no 'pending_review' / 'confirmed').
--
-- Webhooks call process_deposit via service-role connection (no GUC set,
-- so app.user_id() returns NULL — auth bypass for trusted callers).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. process_deposit — webhook entry point (3pay + Whish)
-- ═══════════════════════════════════════════════════════════════════
--
-- Idempotent on (provider, provider_ref). Service-role only — refuses
-- to run if app.user_id() is set unless that user is an admin (manual
-- credit by ops). Webhook routes do NOT set the GUC, so they pass.

CREATE OR REPLACE FUNCTION process_deposit(
  p_user_id UUID,
  p_amount NUMERIC,
  p_currency TEXT,
  p_provider_ref TEXT,
  p_provider TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_caller UUID;
  v_existing UUID;
  v_deposit_id UUID;
  v_new_balance NUMERIC;
  v_target users%ROWTYPE;
BEGIN
  -- Auth gate: caller must be either service-role (no GUC) or an admin.
  v_caller := app.user_id();
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_caller AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'process_deposit: unauthorized — admin or service-role only';
    END IF;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must be positive';
  END IF;

  IF p_provider IS NULL OR p_provider NOT IN ('3pay', 'whish') THEN
    RAISE EXCEPTION 'Invalid provider: must be 3pay or whish';
  END IF;

  -- Idempotency: provider_ref is unique in the deposits table, but we
  -- also short-circuit early to avoid wasted work on duplicate webhook
  -- redelivery.
  SELECT id INTO v_existing
  FROM deposits
  WHERE provider_ref = p_provider_ref;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('deposit_id', v_existing, 'status', 'already_processed');
  END IF;

  -- Lock target user row before touching balance.
  SELECT * INTO v_target FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;
  IF v_target.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- Insert verified deposit + credit balance + write ledger entry.
  INSERT INTO deposits (user_id, provider, provider_ref, amount, currency, status, verified_at)
  VALUES (p_user_id, p_provider, p_provider_ref, p_amount, COALESCE(p_currency, 'USD'), 'verified', NOW())
  RETURNING id INTO v_deposit_id;

  UPDATE users SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_user_id, 'deposit', p_amount, v_new_balance, v_deposit_id,
    'Deposit ' || COALESCE(p_currency, 'USD') || ' via ' || p_provider
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'new_balance', v_new_balance,
    'status', 'verified'
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 2. process_withdrawal — user-initiated, instant balance hold
-- ═══════════════════════════════════════════════════════════════════
--
-- Caller must be authenticated (app.user_id() set). Funds debited
-- immediately to row 'pending' state; admin approve/reject decides
-- final disposition. Reject path refunds via admin_review_withdrawal.
--
-- v1 deltas vs old: no wagering check, no 24h post-deposit gate.

CREATE OR REPLACE FUNCTION process_withdrawal(
  p_amount NUMERIC,
  p_method TEXT,
  p_account_details JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_user_id UUID;
  v_user users%ROWTYPE;
  v_withdrawal_id UUID;
  v_new_balance NUMERIC;
  v_min_withdrawal NUMERIC := 10;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount IS NULL OR p_amount < v_min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', v_min_withdrawal;
  END IF;

  IF p_method IS NULL OR p_method NOT IN ('whish', 'crypto', 'bank') THEN
    RAISE EXCEPTION 'Invalid method: must be whish, crypto, or bank';
  END IF;

  IF p_account_details IS NULL OR p_account_details = 'null'::jsonb THEN
    RAISE EXCEPTION 'Account details required';
  END IF;

  -- Method-specific shape validation. Frontend should send normalized
  -- JSON; we re-validate here as a defense-in-depth gate.
  IF p_method = 'whish' THEN
    IF (p_account_details->>'phone') IS NULL OR (p_account_details->>'phone') !~ '^[+]?[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone for whish withdrawal';
    END IF;
  ELSIF p_method = 'crypto' THEN
    IF (p_account_details->>'network') NOT IN ('TRC20', 'ERC20') THEN
      RAISE EXCEPTION 'Crypto network must be TRC20 or ERC20';
    END IF;
    IF (p_account_details->>'address') IS NULL OR length(p_account_details->>'address') < 30 THEN
      RAISE EXCEPTION 'Invalid crypto address';
    END IF;
  ELSE  -- bank
    IF (p_account_details->>'account') IS NULL OR length(p_account_details->>'account') < 8 THEN
      RAISE EXCEPTION 'Bank account / IBAN must be at least 8 characters';
    END IF;
  END IF;

  -- Lock user row + balance check.
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;
  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Hold funds: debit now, refund on reject.
  UPDATE users SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO withdrawals (user_id, amount, method, account_details, status)
  VALUES (v_user_id, p_amount, p_method, p_account_details, 'pending')
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount, v_new_balance, v_withdrawal_id,
    'Withdrawal request via ' || p_method
  );

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'amount', p_amount,
    'new_balance', v_new_balance,
    'status', 'pending'
  );
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 3. admin_review_withdrawal — approve/reject (PIN-protected)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_review_withdrawal(
  p_withdrawal_id UUID,
  p_action TEXT,
  p_pin TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_withdrawal withdrawals%ROWTYPE;
  v_new_balance NUMERIC;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- PIN verification (bcrypt-style hash check via pgcrypto.crypt).
  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_admin_id FOR UPDATE;
  IF v_config IS NULL OR v_config.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured';
  END IF;
  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;
  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      pin_attempts = pin_attempts + 1,
      pin_locked_until = CASE WHEN pin_attempts + 1 >= 5 THEN NOW() + interval '15 minutes' ELSE NULL END,
      updated_at = NOW()
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  UPDATE admin_config SET pin_attempts = 0, pin_locked_until = NULL, updated_at = NOW()
  WHERE admin_user_id = v_admin_id;

  -- Lock + validate withdrawal.
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

  IF p_action = 'approve' THEN
    UPDATE withdrawals
    SET status = 'approved',
        reviewer_id = v_admin_id,
        reviewed_at = NOW(),
        notes = p_notes
    WHERE id = p_withdrawal_id;

    RETURN jsonb_build_object(
      'status', 'approved',
      'withdrawal_id', p_withdrawal_id,
      'amount', v_withdrawal.amount
    );

  ELSE
    -- Reject: refund the held amount.
    UPDATE users SET balance_usd = balance_usd + v_withdrawal.amount, updated_at = NOW()
    WHERE id = v_withdrawal.user_id
    RETURNING balance_usd INTO v_new_balance;

    UPDATE withdrawals
    SET status = 'rejected',
        reviewer_id = v_admin_id,
        reviewed_at = NOW(),
        notes = p_notes
    WHERE id = p_withdrawal_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
    VALUES (
      v_withdrawal.user_id, 'admin_credit', v_withdrawal.amount, v_new_balance,
      p_withdrawal_id, 'Withdrawal rejected — funds returned', v_admin_id
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'withdrawal_id', p_withdrawal_id,
      'refunded_amount', v_withdrawal.amount,
      'new_balance', v_new_balance
    );
  END IF;
END;
$$;


-- ═══════════════════════════════════════════════════════════════════
-- 4. admin_mark_withdrawal_sent — approved → sent (PIN-protected)
-- ═══════════════════════════════════════════════════════════════════
--
-- Stores external reference (whish tx id, blockchain hash, bank wire ref)
-- in withdrawals.notes for v1 — when v2 needs reconciliation reports we
-- can split that into its own column.

CREATE OR REPLACE FUNCTION admin_mark_withdrawal_sent(
  p_withdrawal_id UUID,
  p_external_reference TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_withdrawal withdrawals%ROWTYPE;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_external_reference IS NULL OR TRIM(p_external_reference) = '' THEN
    RAISE EXCEPTION 'External reference required';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_admin_id FOR UPDATE;
  IF v_config IS NULL OR v_config.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured';
  END IF;
  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;
  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      pin_attempts = pin_attempts + 1,
      pin_locked_until = CASE WHEN pin_attempts + 1 >= 5 THEN NOW() + interval '15 minutes' ELSE NULL END,
      updated_at = NOW()
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;
  UPDATE admin_config SET pin_attempts = 0, pin_locked_until = NULL, updated_at = NOW()
  WHERE admin_user_id = v_admin_id;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved withdrawals can be marked sent (current: %)', v_withdrawal.status;
  END IF;

  UPDATE withdrawals
  SET status = 'sent',
      sent_at = NOW(),
      notes = CASE
        WHEN notes IS NULL OR notes = '' THEN 'sent_ref:' || TRIM(p_external_reference)
        ELSE notes || E'\nsent_ref:' || TRIM(p_external_reference)
      END
  WHERE id = p_withdrawal_id;

  RETURN jsonb_build_object(
    'status', 'sent',
    'withdrawal_id', p_withdrawal_id,
    'external_reference', TRIM(p_external_reference)
  );
END;
$$;

COMMIT;
