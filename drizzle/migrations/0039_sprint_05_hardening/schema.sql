-- ============================================================================
-- Migration 0039 — Sprint 0.5 P1 hardening
-- ============================================================================
--
-- P1 silent-break fixes that follow Sprint 0 (mig 0038). Each fix below is
-- independent; bundled atomically so we don't ship a partial state.
--
--   S0.9  speed_resolve_market: NOW() < closes_at  →  NOW() <= closes_at
--          (microsecond-window correctness fix). [function file]
--   S0.10 _speed_pricing_apply: float-tolerance compare against soft-block
--          threshold so quote/execute don't disagree at 0.9499999 vs 0.9500001.
--          [function file]
--   S0.11 speed_execute_cashout: invariant checks on RAW cashout (pre-round)
--          so thin winning margins don't spuriously raise INSUFFICIENT_PROFIT.
--          Also S0.13 — drop "mark > bsm" qualifier on parity skip; matrix_used
--          alone is sufficient. [function file]
--   S0.12 _speed_get_iv: asset-aware fallback (try speed_iv_<asset> first),
--          NULL/zero fallback raises IV_MISSING. [function file]
--   S0.15 admin_credit_deposit + admin_balance_adjust_v2: write admin_action_log
--          row on each call. Pairs with mig 0038's withdrawal-side audit. [this file]
--
-- Sequencing: schema.sql first (admin balance audit), then functions/*.sql.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- S0.15 — admin_credit_deposit: audit trail
-- ────────────────────────────────────────────────────────────────────────────
-- Identical to mig 0026 body plus one extra step: admin_action_log INSERT.
-- Wrapped in EXCEPTION block so a logging failure cannot block a legitimate
-- admin credit (defensive, mirroring the withdrawal-side pattern).

CREATE OR REPLACE FUNCTION admin_credit_deposit(
  p_user_id UUID,
  p_amount NUMERIC,
  p_provider_ref TEXT,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_existing UUID;
  v_deposit_id UUID;
  v_new_balance NUMERIC;
  v_target users%ROWTYPE;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;
  IF p_amount > 10000 THEN
    RAISE EXCEPTION 'Manual credit amount exceeds maximum ($10,000)';
  END IF;
  IF p_provider_ref IS NULL OR length(TRIM(p_provider_ref)) < 3 THEN
    RAISE EXCEPTION 'Provider reference required (min 3 chars)';
  END IF;

  SELECT d.id INTO v_existing FROM deposits d WHERE d.provider_ref = TRIM(p_provider_ref);
  IF v_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Provider reference already used: %', p_provider_ref;
  END IF;

  SELECT * INTO v_target FROM users u WHERE u.id = p_user_id FOR UPDATE;
  IF v_target IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_target.is_frozen THEN
    RAISE EXCEPTION 'Target account is frozen';
  END IF;

  INSERT INTO deposits (user_id, provider, provider_ref, amount, currency, status, verified_at, raw_payload)
  VALUES (
    p_user_id, 'whish', TRIM(p_provider_ref), p_amount, 'USD', 'verified', NOW(),
    jsonb_build_object('admin_credit', TRUE, 'admin_id', v_admin_id, 'notes', p_notes)
  )
  RETURNING id INTO v_deposit_id;

  UPDATE users
  SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
  VALUES (
    p_user_id, 'deposit', p_amount, v_new_balance, v_deposit_id,
    COALESCE('Admin Whish credit · ref ' || TRIM(p_provider_ref), 'Admin Whish credit'),
    v_admin_id
  );

  -- S0.15: audit trail. Defensive — never block credit on logging failure.
  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'credit_deposit', p_user_id,
      jsonb_build_object(
        'deposit_id', v_deposit_id,
        'amount', p_amount,
        'provider_ref', TRIM(p_provider_ref),
        'new_balance', v_new_balance,
        'notes', p_notes
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'new_balance', v_new_balance,
    'status', 'verified'
  );
END;
$$;

COMMENT ON FUNCTION admin_credit_deposit(UUID, NUMERIC, TEXT, TEXT) IS
  '0039 (S0.15): writes admin_action_log row on credit (audit trail).';

-- ────────────────────────────────────────────────────────────────────────────
-- S0.15 — admin_balance_adjust_v2: audit trail
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_balance_adjust_v2(
  p_user_id UUID,
  p_amount  NUMERIC,
  p_reason  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id    UUID;
  v_user        users%ROWTYPE;
  v_new_balance NUMERIC;
  v_tx_type     transaction_type;
  v_tx_id       UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_amount IS NULL OR p_amount = 0 THEN
    RAISE EXCEPTION 'Amount cannot be zero';
  END IF;
  IF ABS(p_amount) > 10000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum ($10,000)';
  END IF;
  IF p_reason IS NULL OR length(TRIM(p_reason)) < 3 THEN
    RAISE EXCEPTION 'Reason required (min 3 chars)';
  END IF;

  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit'::transaction_type
                    ELSE 'admin_debit'::transaction_type END;

  SELECT * INTO v_user FROM users u WHERE u.id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Target account is frozen';
  END IF;
  IF p_amount < 0 AND v_user.balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient balance for debit (have %, need %)', v_user.balance_usd, ABS(p_amount);
  END IF;

  UPDATE users
  SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_user_id, v_tx_type, p_amount, v_new_balance, TRIM(p_reason), v_admin_id)
  RETURNING id INTO v_tx_id;

  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'balance_adjust', p_user_id,
      jsonb_build_object(
        'transaction_id', v_tx_id,
        'amount', p_amount,
        'tx_type', v_tx_type::text,
        'new_balance', v_new_balance,
        'reason', TRIM(p_reason)
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text,
    'amount', p_amount
  );
END;
$$;

COMMENT ON FUNCTION admin_balance_adjust_v2(UUID, NUMERIC, TEXT) IS
  '0039 (S0.15): writes admin_action_log row on balance adjust (audit trail).';
