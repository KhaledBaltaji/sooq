-- ============================================================================
-- Migration 0038 — Sprint 0 P0 fixes
-- ============================================================================
--
-- Surgical fixes for 7 P0 silent-break risks identified in /investigate audit
-- against current code. Each fix is independent; this migration bundles them
-- as one atomic unit so we don't ship a partial state.
--
--   S0.1 _speed_max_stake_for_offered: liability cap div explodes at offered>=0.99
--          → guard at offered >= 0.98. (separate function file)
--   S0.2 speed_execute_trade: aggregate cap SUMs lack NULL guards
--          → WHERE entry_offered_prob IS NOT NULL AND entry_offered_prob > 0.
--          (separate function file)
--   S0.3 admin withdrawal RPCs lack audit trail
--          → admin_action_log INSERT in each RPC. (admin_*_withdrawal* in this file)
--   S0.4 process_withdrawal lacks idempotency_key wiring
--          → add p_idempotency_key TEXT DEFAULT NULL with dedup lookup.
--          (process_withdrawal in this file)
--   S0.5 crypto address validation is length-only
--          → regex per network (TRC20 base58, ERC20 hex). (in process_withdrawal)
--   S0.6 health endpoints publicly leak system internals
--          → handled in API route code, not SQL. No DB change here.
--   S0.7 pre-mig-0033 $0-cashout orphans
--          → run-once audit query (scripts/audit-zero-cashout-orphans.mjs).
--          No DB change unless orphans found.
--
-- Acceptance:
--   • Property tests for S0.1, S0.2 pass
--   • Manual test: approve a withdrawal → admin_action_log gets a row
--   • Manual test: send same idempotency_key twice → second call returns existing
--   • Manual test: invalid TRC20 address rejected; valid one accepted
--
-- Sequencing:
--   schema.sql first (this file) → admin RPC bodies updated, withdrawals function updated.
--   functions/*.sql second → speed_execute_trade and _speed_max_stake_for_offered replaced.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- S0.4 + S0.5 — process_withdrawal: idempotency key + tighter address regex
-- ────────────────────────────────────────────────────────────────────────────
-- Adds new optional p_idempotency_key parameter (last position, DEFAULT NULL
-- → backward compatible). On second call with same key + same user, returns
-- existing withdrawal payload instead of debiting again.
--
-- Address regex changes:
--   TRC20: ^T[1-9A-HJ-NP-Za-km-z]{33}$ (Tron base58check, 34 chars total)
--   ERC20: ^0x[a-fA-F0-9]{40}$         (Ethereum hex, 42 chars total)
--   Ban "address": "0x0000...0000" burn-equivalents and similar low-entropy strings.

CREATE OR REPLACE FUNCTION public.process_withdrawal(
  p_amount NUMERIC,
  p_method TEXT,
  p_account_details JSONB,
  p_idempotency_key TEXT DEFAULT NULL
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
  v_existing_dup withdrawals%ROWTYPE;
  v_new_balance NUMERIC;
  v_min_withdrawal NUMERIC := 10;
  v_fee_rate NUMERIC;
  v_fee NUMERIC;
  v_net NUMERIC;
  v_addr TEXT;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- S0.4: idempotency check FIRST. If we've seen this key for this user,
  -- return the existing withdrawal without debiting again.
  IF p_idempotency_key IS NOT NULL AND TRIM(p_idempotency_key) <> '' THEN
    SELECT * INTO v_existing_dup
    FROM withdrawals
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'withdrawal_id', v_existing_dup.id,
        'amount', v_existing_dup.amount,
        'fee', v_existing_dup.fee_amount,
        'net', v_existing_dup.net_amount,
        'status', v_existing_dup.status,
        'message', 'Duplicate withdrawal — returning existing record'
      );
    END IF;
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

  IF p_method = 'whish' THEN
    IF (p_account_details->>'phone') IS NULL OR (p_account_details->>'phone') !~ '^[+]?[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone for whish withdrawal';
    END IF;
  ELSIF p_method = 'crypto' THEN
    IF (p_account_details->>'network') NOT IN ('TRC20', 'ERC20') THEN
      RAISE EXCEPTION 'Crypto network must be TRC20 or ERC20';
    END IF;
    v_addr := p_account_details->>'address';
    IF v_addr IS NULL OR v_addr = '' THEN
      RAISE EXCEPTION 'Crypto address required';
    END IF;
    -- S0.5: tight per-network regex. ERC20 = 0x + 40 hex; TRC20 = T + 33 base58.
    -- Defends against length-only validation that accepted random 30-char strings.
    IF p_account_details->>'network' = 'ERC20' THEN
      IF v_addr !~ '^0x[a-fA-F0-9]{40}$' THEN
        RAISE EXCEPTION 'Invalid ERC20 address format (expected 0x + 40 hex chars)';
      END IF;
      -- Reject burn-pattern "0x0000...0000" and "0x...dead" common typos.
      IF lower(v_addr) IN ('0x0000000000000000000000000000000000000000', '0x000000000000000000000000000000000000dead') THEN
        RAISE EXCEPTION 'Refusing burn / dead address';
      END IF;
    ELSIF p_account_details->>'network' = 'TRC20' THEN
      IF v_addr !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
        RAISE EXCEPTION 'Invalid TRC20 address format (expected T + 33 base58 chars)';
      END IF;
    END IF;
  ELSE
    IF (p_account_details->>'account') IS NULL OR length(p_account_details->>'account') < 8 THEN
      RAISE EXCEPTION 'Bank account / IBAN must be at least 8 characters';
    END IF;
  END IF;

  SELECT rate INTO v_fee_rate FROM fee_config WHERE fee_type = 'withdrawal_fee';
  v_fee_rate := COALESCE(v_fee_rate, 0);
  IF v_fee_rate < 0 OR v_fee_rate >= 1 THEN
    RAISE EXCEPTION 'Withdrawal fee rate out of bounds: %', v_fee_rate;
  END IF;

  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net := p_amount - v_fee;

  SELECT * INTO v_user FROM users u WHERE u.id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;
  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  UPDATE users
  SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  -- INSERT withdrawal with idempotency_key. Unique partial index on the column
  -- means a concurrent duplicate insert will throw; our up-front check catches
  -- the common case, the unique constraint catches the race.
  INSERT INTO withdrawals (user_id, amount, fee_amount, net_amount, method, account_details, status, idempotency_key)
  VALUES (v_user_id, p_amount, v_fee, v_net, p_method, p_account_details, 'pending', NULLIF(TRIM(COALESCE(p_idempotency_key, '')), ''))
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount, v_new_balance, v_withdrawal_id,
    'Withdrawal request via ' || p_method
  );

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'amount', p_amount,
    'fee', v_fee,
    'net', v_net,
    'new_balance', v_new_balance,
    'status', 'pending'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_withdrawal(NUMERIC, TEXT, JSONB, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_withdrawal(NUMERIC, TEXT, JSONB, TEXT) TO sooqadmin;

COMMENT ON FUNCTION public.process_withdrawal(NUMERIC, TEXT, JSONB, TEXT) IS
  '0038: adds optional p_idempotency_key (mig 0033 column, finally wired). Tightens crypto address validation to per-network regex. ERC20: 0x + 40 hex. TRC20: T + 33 base58. Rejects burn/dead addresses.';

-- Drop the old 3-arg overload to prevent ambiguity. New 4-arg signature with
-- DEFAULT NULL is backward-compatible for callers passing only 3 args.
DROP FUNCTION IF EXISTS public.process_withdrawal(NUMERIC, TEXT, JSONB);

-- ────────────────────────────────────────────────────────────────────────────
-- S0.3 — admin withdrawal RPCs: audit trail via admin_action_log INSERT
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.admin_approve_withdrawal(
  p_withdrawal_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_withdrawal withdrawals%ROWTYPE;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

  UPDATE withdrawals
  SET status = 'approved',
      reviewer_id = v_admin_id,
      reviewed_at = NOW(),
      notes = p_notes
  WHERE id = p_withdrawal_id;

  -- S0.3: audit trail. Never block the action on logging failure (defensive
  -- swallow), but normal path always writes. Keeps every admin approval traced.
  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'approve_withdrawal', p_withdrawal_id,
      jsonb_build_object(
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'method', v_withdrawal.method,
        'notes', p_notes
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status', 'approved',
    'withdrawal_id', p_withdrawal_id,
    'amount', v_withdrawal.amount
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reject_withdrawal(
  p_withdrawal_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_withdrawal withdrawals%ROWTYPE;
  v_new_balance NUMERIC;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

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

  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'reject_withdrawal', p_withdrawal_id,
      jsonb_build_object(
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'method', v_withdrawal.method,
        'refunded_balance', v_new_balance,
        'notes', p_notes
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status', 'rejected',
    'withdrawal_id', p_withdrawal_id,
    'refunded_amount', v_withdrawal.amount,
    'new_balance', v_new_balance
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_mark_withdrawal_sent_v2(
  p_withdrawal_id UUID,
  p_external_reference TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_withdrawal withdrawals%ROWTYPE;
  v_combined_notes TEXT;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_external_reference IS NULL OR TRIM(p_external_reference) = '' THEN
    RAISE EXCEPTION 'External reference required';
  END IF;

  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status::TEXT <> 'approved' THEN
    RAISE EXCEPTION 'Only approved withdrawals can be marked sent (current: %)', v_withdrawal.status;
  END IF;

  v_combined_notes := COALESCE(v_withdrawal.notes, '');
  IF v_combined_notes <> '' THEN
    v_combined_notes := v_combined_notes || E'\n';
  END IF;
  v_combined_notes := v_combined_notes || 'sent_ref:' || TRIM(p_external_reference);
  IF p_notes IS NOT NULL AND TRIM(p_notes) <> '' THEN
    v_combined_notes := v_combined_notes || E'\n' || TRIM(p_notes);
  END IF;

  UPDATE withdrawals
  SET status = 'sent',
      sent_at = NOW(),
      notes = v_combined_notes
  WHERE id = p_withdrawal_id;

  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'mark_withdrawal_sent', p_withdrawal_id,
      jsonb_build_object(
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'external_reference', TRIM(p_external_reference),
        'notes', p_notes
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'status', 'sent',
    'withdrawal_id', p_withdrawal_id,
    'external_reference', TRIM(p_external_reference)
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Comments documenting the audit-trail wiring (S0.3)
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON FUNCTION public.admin_approve_withdrawal(UUID, TEXT) IS
  '0038: writes admin_action_log row on approval (S0.3 audit trail).';

COMMENT ON FUNCTION public.admin_reject_withdrawal(UUID, TEXT) IS
  '0038: writes admin_action_log row on rejection (S0.3 audit trail).';

COMMENT ON FUNCTION public.admin_mark_withdrawal_sent_v2(UUID, TEXT, TEXT) IS
  '0038: writes admin_action_log row on mark-sent (S0.3 audit trail).';
