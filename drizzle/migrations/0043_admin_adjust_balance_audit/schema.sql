-- ============================================================================
-- Migration 0043 — Patch: admin_adjust_balance audit trail
-- ============================================================================
--
-- Pre-ship investigation found Sprint 0/0.5 audit trail (S0.15) only covered
-- admin_balance_adjust_v2 (no-PIN, mig 0026) and admin_credit_deposit. The
-- PIN-gated admin_adjust_balance (mig 0006) which `/api/admin/balance` actually
-- calls was missed. Manual credits/debits via that route still don't get
-- logged to admin_action_log → audit-trail incomplete.
--
-- Fix: CREATE OR REPLACE the 4-arg PIN-gated variant to mirror the v2 audit
-- pattern. Body byte-equal to mig 0006 plus EXCEPTION-wrapped admin_action_log
-- INSERT before the RETURN.
--
-- Idempotent.

SET search_path = public;

CREATE OR REPLACE FUNCTION admin_adjust_balance(
  p_user_id     UUID,
  p_amount      NUMERIC,
  p_description TEXT,
  p_pin         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id    UUID;
  v_config      admin_config%ROWTYPE;
  v_user        users%ROWTYPE;
  v_new_balance NUMERIC;
  v_tx_type     transaction_type;
  v_tx_id       UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
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

  IF p_amount = 0 THEN
    RAISE EXCEPTION 'Amount cannot be zero';
  END IF;
  IF ABS(p_amount) > 10000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum ($10,000)';
  END IF;

  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END;

  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'User account is frozen';
  END IF;
  IF p_amount < 0 AND v_user.balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient balance for debit';
  END IF;

  UPDATE users SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_user_id, v_tx_type, p_amount, v_new_balance, p_description, v_admin_id)
  RETURNING id INTO v_tx_id;

  -- 0043: audit trail. Defensive — never block credit on logging failure.
  -- Mirrors the pattern from mig 0038/0039 for the no-PIN variants.
  BEGIN
    INSERT INTO admin_action_log (admin_id, action, target_id, metadata)
    VALUES (
      v_admin_id, 'balance_adjust_pin_gated', p_user_id,
      jsonb_build_object(
        'transaction_id', v_tx_id,
        'amount', p_amount,
        'tx_type', v_tx_type::text,
        'new_balance', v_new_balance,
        'description', p_description
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text
  );
END;
$$;

COMMENT ON FUNCTION admin_adjust_balance(UUID, NUMERIC, TEXT, TEXT) IS
  '0043: writes admin_action_log row on balance adjust (PIN-gated variant). Pairs with 0039 audit on the no-PIN admin_balance_adjust_v2.';
