-- Migration 152: Admin config table, performed_by column, admin credit/debit RPCs
-- Part of admin panel enhancement (credit/debit with PIN protection + audit trail)

-- 1. New transaction types
ALTER TYPE transaction_type ADD VALUE 'admin_credit';
ALTER TYPE transaction_type ADD VALUE 'admin_debit';

-- 1b. Add performed_by column to transactions (nullable, only for admin actions)
ALTER TABLE transactions ADD COLUMN performed_by UUID REFERENCES users(id);

-- 2. Admin config table (stores hashed PIN)
CREATE TABLE admin_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES users(id) UNIQUE,
  pin_hash TEXT NOT NULL,
  failed_pin_attempts INTEGER DEFAULT 0,
  pin_locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS: only the admin themselves can read their config
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_config_self ON admin_config
  FOR ALL USING (auth.uid() = admin_user_id);

-- 3. admin_adjust_balance RPC
CREATE OR REPLACE FUNCTION admin_adjust_balance(
  p_user_id UUID,
  p_amount DECIMAL,
  p_description TEXT,
  p_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_user users%ROWTYPE;
  v_new_balance DECIMAL;
  v_tx_type transaction_type;
  v_tx_id UUID;
BEGIN
  -- 1. Verify caller is admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  -- 2. Get admin config + verify PIN
  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_admin_id FOR UPDATE;
  IF v_config IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured. Set up your PIN first.';
  END IF;

  -- Check lockout
  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;

  -- Verify PIN (using pgcrypto crypt/gen_salt)
  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    -- Increment failed attempts
    UPDATE admin_config SET
      failed_pin_attempts = failed_pin_attempts + 1,
      pin_locked_until = CASE
        WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Reset failed attempts on success
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = v_admin_id;

  -- 3. Validate amount
  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  IF ABS(p_amount) > 10000 THEN RAISE EXCEPTION 'Amount exceeds maximum ($10,000)'; END IF;

  -- 4. Determine transaction type
  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END;

  -- 5. Lock user row + validate
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'User account is frozen'; END IF;

  -- For debits, check sufficient balance
  IF p_amount < 0 AND v_user.balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient balance for debit';
  END IF;

  -- 6. Update balance + insert ledger entry
  v_new_balance := v_user.balance_usd + p_amount;
  UPDATE users SET balance_usd = v_new_balance WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_user_id, v_tx_type, p_amount, v_new_balance, p_description, v_admin_id)
  RETURNING id INTO v_tx_id;

  -- 7. Audit log to system_logs
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (
    'info',
    'admin/credit',
    CASE WHEN p_amount > 0
      THEN format('Admin credited $%s to user', p_amount)
      ELSE format('Admin debited $%s from user', ABS(p_amount))
    END,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'user_id', p_user_id,
      'amount', p_amount,
      'description', p_description,
      'transaction_id', v_tx_id,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text
  );
END;
$$;

-- 4. Admin set PIN RPC
CREATE OR REPLACE FUNCTION admin_set_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF length(p_pin) < 4 OR length(p_pin) > 8 THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;

  INSERT INTO admin_config (admin_user_id, pin_hash)
  VALUES (v_admin_id, crypt(p_pin, gen_salt('bf')))
  ON CONFLICT (admin_user_id)
  DO UPDATE SET pin_hash = crypt(p_pin, gen_salt('bf')), updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- 5. Helper: check if admin has PIN configured
CREATE OR REPLACE FUNCTION admin_has_pin()
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_config WHERE admin_user_id = auth.uid()
  );
END;
$$;
