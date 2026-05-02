-- 247_lock_void_pin_and_fee_bounds.sql — PIN gate on lock/void + per-fee bounds
--
-- Phase 1 audit fixes:
--   P1-04 — lock_market and void_market are equally destructive as resolve_market
--           but have no PIN. resolve_market (migration 220) requires PIN +
--           confirmation modal. Lock/void take one click.
--   P1-05 — admin_update_fee (migration 154) only checks rate >= 0. A typo can
--           set explicit_fee = 0.99 (99% per trade), silently breaking every
--           subsequent trade. Add per-fee-type bounds.
--
-- Approach:
-- 1. Extract a shared `_verify_admin_pin(admin_id, pin)` helper to avoid
--    duplicating the PIN block across 3 RPCs (current pattern in resolve_market
--    and admin_update_fee is copy-paste).
-- 2. Re-define lock_market and void_market to require PIN.
-- 3. Re-define admin_update_fee with per-fee-type bounds matrix.
-- 4. Frontend changes (src/components/admin/market-actions.tsx + new
--    LockVoidDialog component) ship in the same PR.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. _verify_admin_pin — shared PIN check helper
--    Returns void on success; raises exception on failure.
--    Encapsulates: locked-out check, hash compare, lockout-on-N-fails, reset-on-success.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _verify_admin_pin(
  p_admin_id UUID,
  p_pin TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_config admin_config%ROWTYPE;
BEGIN
  IF p_pin IS NULL OR p_pin = '' THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = p_admin_id FOR UPDATE;
  IF v_config IS NULL OR v_config.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured. Set your PIN first.';
  END IF;

  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'PIN locked due to too many failed attempts. Try again later.';
  END IF;

  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1,
      pin_locked_until = CASE
        WHEN COALESCE(failed_pin_attempts, 0) + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
        ELSE pin_locked_until
      END
    WHERE admin_user_id = p_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Reset on success
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = p_admin_id;
END;
$$;

COMMENT ON FUNCTION _verify_admin_pin(UUID, TEXT) IS
  'Shared PIN verification for destructive admin RPCs. Locks for 15min after 5 failed attempts.';

-- ═══════════════════════════════════════════════════════════
-- 2. lock_market — add PIN parameter
--    Re-defines from migration 154. Audit log preserved.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lock_market(
  p_market_id UUID,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- PIN required for destructive action
  PERFORM _verify_admin_pin(v_user_id, p_pin);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open (status: %)', v_market.status;
  END IF;

  UPDATE markets SET status = 'closed' WHERE id = p_market_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/lock', 'Market locked',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN jsonb_build_object('success', TRUE, 'market_id', p_market_id, 'new_status', 'closed');
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. void_market — add PIN parameter
--    Re-defines from migration 154. _void_market_internal (migration 221)
--    unchanged — it's the internal helper called by both manual void and
--    auto-void from resolve_market.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION void_market(
  p_market_id UUID,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- PIN required for destructive action
  PERFORM _verify_admin_pin(v_user_id, p_pin);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  v_result := _void_market_internal(p_market_id);

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/void', 'Market voided',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN v_result;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. admin_update_fee — per-fee-type bounds + reuse PIN helper
--    Re-defines from migration 154.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_fee(
  p_fee_id UUID,
  p_new_rate DECIMAL,
  p_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_admin_id UUID;
  v_old_rate DECIMAL;
  v_fee_type TEXT;
  v_fee_desc TEXT;
  v_min_rate DECIMAL;
  v_max_rate DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);

  SELECT rate, fee_type, description INTO v_old_rate, v_fee_type, v_fee_desc
  FROM fee_config WHERE id = p_fee_id;

  IF v_fee_type IS NULL THEN
    RAISE EXCEPTION 'Fee config not found';
  END IF;

  -- Per-fee-type bounds matrix
  -- Mistakes here = silent money loss across every subsequent trade.
  -- Bounds are intentionally generous to allow legitimate tuning, but
  -- catch typos like 0.99 instead of 0.099.
  CASE v_fee_type
    WHEN 'explicit_fee'              THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'resolution_fee'            THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'cash_out_premium'          THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'dynamic_spread_threshold'  THEN v_min_rate := 0.5;   v_max_rate := 1.0;
    WHEN 'dynamic_spread_multiplier' THEN v_min_rate := 0;     v_max_rate := 5.0;
    WHEN 'amm_default_b'             THEN v_min_rate := 100;   v_max_rate := 100000;
    WHEN 'amm_max_trade_pct'         THEN v_min_rate := 0;     v_max_rate := 1.0;
    WHEN 'min_trade_amount'          THEN v_min_rate := 0;     v_max_rate := 1000;
    WHEN 'deposit_fee'               THEN v_min_rate := 0;     v_max_rate := 0.10;
    WHEN 'withdrawal_fee'            THEN v_min_rate := 0;     v_max_rate := 0.10;
    WHEN 'ngr_commission'            THEN v_min_rate := 0;     v_max_rate := 0.60;
    WHEN 'ngr_resolution_commission' THEN v_min_rate := 0;     v_max_rate := 0.60;
    WHEN 'canonical_price_impact_cap' THEN v_min_rate := 0;    v_max_rate := 1.0;
    ELSE
      -- Unknown fee_type — fall back to conservative bounds + warn
      v_min_rate := 0; v_max_rate := 1.0;
      INSERT INTO system_logs (severity, source, message, context)
      VALUES ('warn', 'admin/fee',
        format('admin_update_fee: unknown fee_type %s — using default bounds [0, 1]', v_fee_type),
        jsonb_build_object('admin_id', v_admin_id, 'fee_id', p_fee_id, 'fee_type', v_fee_type));
  END CASE;

  IF p_new_rate < v_min_rate OR p_new_rate > v_max_rate THEN
    -- Audit the rejection
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('warn', 'admin/fee',
      format('Fee update rejected: %s rate %s out of bounds [%s, %s]',
             v_fee_type, p_new_rate, v_min_rate, v_max_rate),
      jsonb_build_object(
        'admin_id', v_admin_id,
        'fee_id', p_fee_id,
        'fee_type', v_fee_type,
        'attempted_rate', p_new_rate,
        'min_allowed', v_min_rate,
        'max_allowed', v_max_rate
      ));
    RAISE EXCEPTION 'Rate % out of bounds for %: must be between % and %',
      p_new_rate, v_fee_type, v_min_rate, v_max_rate;
  END IF;

  UPDATE fee_config SET rate = p_new_rate WHERE id = p_fee_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/fee', format('Fee updated: %s (%s -> %s)', v_fee_type, v_old_rate, p_new_rate),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'fee_id', p_fee_id,
      'fee_type', v_fee_type,
      'old_rate', v_old_rate,
      'new_rate', p_new_rate,
      'description', v_fee_desc
    ));

  RETURN jsonb_build_object(
    'success', true,
    'fee_type', v_fee_type,
    'old_rate', v_old_rate,
    'new_rate', p_new_rate
  );
END;
$$;

COMMIT;
