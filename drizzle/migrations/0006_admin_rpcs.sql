-- 0006_admin_rpcs.sql — admin operations: PIN management, balance adjust,
-- user freeze, role editor.
--
-- Adapted from prediction-market 152/035/242. Differences:
--   * auth.uid() → app.user_id() (Drizzle sets this via runAs).
--   * admin_config schema is slimmed: pin_hash text, pin_attempts int,
--     pin_locked_until timestamptz (no separate id col, PK is admin_user_id).
--   * No system_logs writes — admin tooling rebuild ships in W10.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════
-- 1. admin_set_pin (4-8 digit PIN, bcrypt-hashed via pgcrypto)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_set_pin(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;
  IF p_pin IS NULL OR length(p_pin) < 4 OR length(p_pin) > 8 THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;
  IF p_pin !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'PIN must contain digits only';
  END IF;

  INSERT INTO admin_config (admin_user_id, pin_hash, last_pin_set_at, updated_at)
  VALUES (v_admin_id, crypt(p_pin, gen_salt('bf')), NOW(), NOW())
  ON CONFLICT (admin_user_id) DO UPDATE
    SET pin_hash = crypt(p_pin, gen_salt('bf')),
        pin_attempts = 0,
        pin_locked_until = NULL,
        last_pin_set_at = NOW(),
        updated_at = NOW();

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 2. admin_has_pin — boolean probe
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_has_pin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM admin_config WHERE admin_user_id = v_admin_id AND pin_hash IS NOT NULL
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 3. admin_adjust_balance — manual credit/debit (PIN-gated)
-- ═══════════════════════════════════════════════════════════════════

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

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 4. toggle_user_freeze (admin only)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION toggle_user_freeze(p_user_id UUID, p_frozen BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  UPDATE users SET is_frozen = p_frozen, updated_at = NOW() WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object('user_id', p_user_id, 'is_frozen', p_frozen);
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 5. admin_set_admin_role — super-admin assigns / revokes admin status
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_set_admin_role(
  p_user_id UUID,
  p_is_admin BOOLEAN,
  p_allowed_views TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_caller   users%ROWTYPE;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_caller FROM users WHERE id = v_admin_id;
  IF NOT v_caller.is_admin THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;
  -- Super-admin gate: only super admins (admin_allowed_views IS NULL) can promote/demote.
  IF v_caller.admin_allowed_views IS NOT NULL THEN
    RAISE EXCEPTION 'Forbidden — only super admins can change admin roles';
  END IF;

  UPDATE users
  SET is_admin = p_is_admin,
      admin_allowed_views = CASE WHEN p_is_admin THEN p_allowed_views ELSE NULL END,
      updated_at = NOW()
  WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'is_admin', p_is_admin,
    'admin_allowed_views', p_allowed_views
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════════════
-- 6. admin_update_fee — update a fee_config rate (PIN-gated)
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_fee(
  p_fee_type TEXT,
  p_rate     NUMERIC,
  p_pin      TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_config   admin_config%ROWTYPE;
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

  INSERT INTO fee_config (fee_type, rate, updated_at, updated_by)
  VALUES (p_fee_type, p_rate, NOW(), v_admin_id)
  ON CONFLICT (fee_type) DO UPDATE
    SET rate = p_rate, updated_at = NOW(), updated_by = v_admin_id;

  RETURN jsonb_build_object('fee_type', p_fee_type, 'rate', p_rate);
END;
$$;

COMMIT;
