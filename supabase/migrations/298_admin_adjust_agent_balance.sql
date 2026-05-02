-- ============================================================
-- 298: Commission Branch Phase C — admin_adjust_agent_balance RPC
--
-- Admin can credit or debit a user's agent_balance_usd (commission wallet)
-- for bug recovery, disputes, or comp'ed commissions.
--
-- admin_adjust_balance (mig 152) only touches users.balance_usd (the trading
-- wallet). Until now, admin had no safe path to adjust the commission
-- wallet — only raw SQL. This RPC closes that gap.
--
-- Mirrors admin_adjust_balance's pattern:
--   - Caller must be admin (auth.uid() + is_admin check)
--   - PIN required + lockout logic (shared admin_config table)
--   - Frozen user rejected
--   - Debit rejected if would overdraw
--   - Amount bounded at $10,000 (same cap as balance_usd)
--   - Transaction ledger entry (type='admin_credit' or 'admin_debit')
--   - system_logs audit row
--
-- NOTE: we reuse the existing 'admin_credit' / 'admin_debit' transaction
-- types but write to agent_balance_usd. The transaction's balance_after
-- reflects the agent_balance_usd, not balance_usd. Readers should cross-
-- reference the description field to distinguish wallet.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION admin_adjust_agent_balance(
  p_user_id UUID,
  p_amount NUMERIC,
  p_description TEXT,
  p_pin TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_user users%ROWTYPE;
  v_new_agent_balance DECIMAL;
  v_tx_type transaction_type;
  v_tx_id UUID;
BEGIN
  -- 1. Verify caller is admin
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  -- 2. PIN check + lockout (same pattern as admin_adjust_balance)
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

  -- 3. Validate amount
  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  IF ABS(p_amount) > 10000 THEN RAISE EXCEPTION 'Amount exceeds maximum ($10,000)'; END IF;

  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  -- 4. Transaction type
  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END;

  -- 5. Lock user + validate
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'User account is frozen'; END IF;

  -- For debits, don't overdraw the commission wallet
  IF p_amount < 0 AND v_user.agent_balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient agent balance for debit (current $%, debit $%)',
      ROUND(v_user.agent_balance_usd, 2), ROUND(ABS(p_amount), 2);
  END IF;

  -- 6. Update agent_balance_usd + ledger. The trigger_bypass flag lets us
  -- write to a protected column (agent_balance_usd) while running in
  -- SECURITY DEFINER context.
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_new_agent_balance := v_user.agent_balance_usd + p_amount;
  UPDATE users SET agent_balance_usd = v_new_agent_balance WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (
    p_user_id, v_tx_type, p_amount, v_new_agent_balance,
    'AGENT WALLET: ' || p_description,
    v_admin_id
  )
  RETURNING id INTO v_tx_id;

  -- 7. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (
    'info',
    'admin/agent_wallet_adjust',
    CASE WHEN p_amount > 0
      THEN format('Admin credited $%s to agent wallet', p_amount)
      ELSE format('Admin debited $%s from agent wallet', ABS(p_amount))
    END,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'user_id', p_user_id,
      'amount', p_amount,
      'new_agent_balance', v_new_agent_balance,
      'description', p_description,
      'transaction_id', v_tx_id
    )
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'amount', p_amount,
    'new_agent_balance', ROUND(v_new_agent_balance, 2),
    'user_id', p_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_adjust_agent_balance(UUID, NUMERIC, TEXT, TEXT) TO authenticated;

COMMIT;
