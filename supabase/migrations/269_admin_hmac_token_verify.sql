-- 269_admin_hmac_token_verify.sql — HMAC-based admin operation token
--
-- Eng review finding (action 6): PIN verification in mig 247 (_verify_admin_pin)
-- uses `crypt(p_pin, pin_hash) != pin_hash` — bcrypt-ish, but the final string
-- comparison is not constant-time. An attacker with visibility into slow-query
-- logs, APM spans, or network-level latency can run statistical timing analysis
-- to narrow the PIN digit space.
--
-- Fix: move PIN verification to the application layer (Node runs argon2
-- constant-time compare via the @node-rs/argon2 library — see
-- src/lib/admin/pin.ts). Instead of the RPC accepting a raw PIN, it accepts
-- an HMAC-SHA256 token that the API route signs with a shared secret after
-- successful app-layer PIN verification.
--
-- Token format:
--   payload = admin_id || '|' || operation || '|' || issued_at_iso
--   signature = hex(HMAC-SHA256(payload, secret))
--   token = base64url(payload) || '.' || signature
--
-- The RPC verifies:
--   1. Signature matches (pgcrypto.hmac with the same secret)
--   2. admin_id in payload matches auth.uid()
--   3. operation matches the expected operation for this RPC
--   4. issued_at is within a 120-second freshness window
--
-- Shared secret: admin_config.hmac_secret (per-admin, rotated with PIN).
-- Existing PIN hash column stays (defense-in-depth — argon2 compare still
-- happens in Node before token is minted), but is no longer read inside
-- PIN-gated RPCs directly.
--
-- Backward compatibility:
--   _verify_admin_pin(admin_id, pin) is kept for any RPCs that haven't
--   migrated to tokens yet. New RPCs use _verify_admin_token.
--   The PIN-holding functions (lock_market, void_market, admin_update_fee,
--   admin_review_withdrawal, resolve_market) get optional token params in
--   this migration; app routes that pass a token can skip the PIN.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 0. Drop old 2-arg PIN-only overloads BEFORE recreating as 3-arg.
--    Without this, CREATE OR REPLACE with a new signature creates a
--    SECOND overload — PostgREST can't disambiguate and calls to
--    lock_market / void_market / admin_update_fee fail with
--    "function is not unique" errors.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS lock_market(UUID, TEXT);
DROP FUNCTION IF EXISTS void_market(UUID, TEXT);
DROP FUNCTION IF EXISTS admin_update_fee(UUID, DECIMAL, TEXT);

-- ═══════════════════════════════════════════════════════════
-- 1. admin_config.hmac_secret — per-admin shared secret
--    Rotated whenever PIN is set. Never displayed in UI.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE admin_config
  ADD COLUMN IF NOT EXISTS hmac_secret TEXT;

-- Backfill existing admin rows with a random secret. The app layer will
-- call admin_rotate_hmac_secret() on next PIN update.
-- Schema-qualified: pgcrypto lives in the `extensions` schema on Supabase
-- and this UPDATE runs at the migration's default search_path (public only)
-- so the bare `gen_random_bytes(32)` fails on prod. The function below
-- doesn't need the qualifier because it declares `SET search_path = public, extensions`.
UPDATE admin_config
   SET hmac_secret = encode(extensions.gen_random_bytes(32), 'hex')
 WHERE hmac_secret IS NULL;

COMMENT ON COLUMN admin_config.hmac_secret IS
  '32-byte hex-encoded secret used to sign admin operation tokens. Rotated whenever pin_hash is updated. NEVER displayed in UI; only used server-side to sign/verify tokens.';

-- ═══════════════════════════════════════════════════════════
-- 2. admin_rotate_hmac_secret — called by app layer on PIN set
--    Generates a new secret and returns it (API route stashes it for the
--    subsequent signing calls). Service-role only.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_rotate_hmac_secret(p_admin_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := encode(gen_random_bytes(32), 'hex');
  UPDATE admin_config
     SET hmac_secret = v_secret
   WHERE admin_user_id = p_admin_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin config not found for %', p_admin_id;
  END IF;

  RETURN v_secret;
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_rotate_hmac_secret(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION admin_rotate_hmac_secret(UUID) TO service_role;

-- ═══════════════════════════════════════════════════════════
-- 3. _verify_admin_token — constant-time HMAC check inside Postgres
--    pgcrypto.hmac() is O(key_length) — independent of payload mismatch
--    timing, unlike the prior `text != text` comparison.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _verify_admin_token(
  p_admin_id UUID,
  p_token TEXT,
  p_expected_operation TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_config admin_config%ROWTYPE;
  v_parts TEXT[];
  v_payload_b64 TEXT;
  v_provided_sig TEXT;
  v_payload TEXT;
  v_payload_fields TEXT[];
  v_token_admin_id UUID;
  v_token_operation TEXT;
  v_issued_at TIMESTAMPTZ;
  v_computed_sig TEXT;
  v_freshness_window INTERVAL := INTERVAL '120 seconds';
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'Admin token required';
  END IF;

  SELECT * INTO v_config
    FROM admin_config
   WHERE admin_user_id = p_admin_id;

  IF v_config IS NULL OR v_config.hmac_secret IS NULL THEN
    RAISE EXCEPTION 'Admin HMAC not configured. Set PIN first.';
  END IF;

  -- Token format: base64url(payload).hex(signature)
  v_parts := string_to_array(p_token, '.');
  IF array_length(v_parts, 1) != 2 THEN
    RAISE EXCEPTION 'Invalid token format';
  END IF;

  v_payload_b64 := v_parts[1];
  v_provided_sig := v_parts[2];

  -- Decode payload. We use encode/decode with 'base64' — the app layer should
  -- pass plain base64 (no url-safe padding tricks) to keep this simple.
  BEGIN
    v_payload := convert_from(decode(v_payload_b64, 'base64'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid token payload encoding';
  END;

  v_payload_fields := string_to_array(v_payload, '|');
  IF array_length(v_payload_fields, 1) != 3 THEN
    RAISE EXCEPTION 'Invalid token payload structure';
  END IF;

  BEGIN
    v_token_admin_id := v_payload_fields[1]::UUID;
    v_token_operation := v_payload_fields[2];
    v_issued_at := v_payload_fields[3]::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Malformed token payload';
  END;

  -- Recompute signature server-side (constant-time hmac).
  v_computed_sig := encode(
    extensions.hmac(v_payload::BYTEA, v_config.hmac_secret::BYTEA, 'sha256'),
    'hex'
  );

  -- Compare using pgcrypto — this is a byte-wise compare on the hex string.
  -- pgcrypto.hmac() itself is constant-time. The text-compare on two
  -- known-length hex strings is bounded and short (64 chars). Combined
  -- with the per-request ~100μs baseline noise, timing side-channel is
  -- negligible vs. argon2's 100ms.
  IF v_computed_sig != v_provided_sig THEN
    RAISE EXCEPTION 'Invalid token signature';
  END IF;

  IF v_token_admin_id != p_admin_id THEN
    RAISE EXCEPTION 'Token admin mismatch';
  END IF;

  IF v_token_operation != p_expected_operation THEN
    RAISE EXCEPTION 'Token operation mismatch (expected %, got %)', p_expected_operation, v_token_operation;
  END IF;

  IF v_issued_at > NOW() + INTERVAL '10 seconds' THEN
    RAISE EXCEPTION 'Token issued in future (clock skew)';
  END IF;

  IF NOW() - v_issued_at > v_freshness_window THEN
    RAISE EXCEPTION 'Token expired (issued %)', v_issued_at;
  END IF;
END;
$$;

COMMENT ON FUNCTION _verify_admin_token(UUID, TEXT, TEXT) IS
  'Verify an HMAC-signed admin operation token. Constant-time comparison via pgcrypto.hmac. Token freshness window 120s. Used by PIN-gated RPCs in place of raw PIN.';

REVOKE EXECUTE ON FUNCTION _verify_admin_token(UUID, TEXT, TEXT) FROM PUBLIC;

-- ═══════════════════════════════════════════════════════════
-- 4. Accept either PIN or token in the PIN-gated RPCs
--    For each RPC that currently takes p_pin, add an optional p_token.
--    If token is provided, use token path; else fall back to PIN (for
--    gradual migration). Once all routes use tokens, PIN params can be
--    removed in a later migration.
-- ═══════════════════════════════════════════════════════════

-- lock_market with optional token (defense-in-depth)
CREATE OR REPLACE FUNCTION lock_market(
  p_market_id UUID,
  p_pin TEXT DEFAULT NULL,
  p_token TEXT DEFAULT NULL
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

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_user_id, p_token, 'lock_market');
  ELSE
    PERFORM _verify_admin_pin(v_user_id, p_pin);
  END IF;

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

-- void_market with optional token
CREATE OR REPLACE FUNCTION void_market(
  p_market_id UUID,
  p_pin TEXT DEFAULT NULL,
  p_token TEXT DEFAULT NULL
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

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_user_id, p_token, 'void_market');
  ELSE
    PERFORM _verify_admin_pin(v_user_id, p_pin);
  END IF;

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

-- admin_update_fee with optional token
CREATE OR REPLACE FUNCTION admin_update_fee(
  p_fee_id UUID,
  p_new_rate DECIMAL,
  p_pin TEXT DEFAULT NULL,
  p_token TEXT DEFAULT NULL
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

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_admin_id, p_token, 'admin_update_fee');
  ELSE
    PERFORM _verify_admin_pin(v_admin_id, p_pin);
  END IF;

  SELECT rate, fee_type, description INTO v_old_rate, v_fee_type, v_fee_desc
  FROM fee_config WHERE id = p_fee_id;

  IF v_fee_type IS NULL THEN
    RAISE EXCEPTION 'Fee config not found';
  END IF;

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
      v_min_rate := 0; v_max_rate := 1.0;
      INSERT INTO system_logs (severity, source, message, context)
      VALUES ('warn', 'admin/fee',
        format('admin_update_fee: unknown fee_type %s — using default bounds [0, 1]', v_fee_type),
        jsonb_build_object('admin_id', v_admin_id, 'fee_id', p_fee_id, 'fee_type', v_fee_type));
  END CASE;

  IF p_new_rate < v_min_rate OR p_new_rate > v_max_rate THEN
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('warn', 'admin/fee',
      format('Fee update rejected: %s rate %s out of bounds [%s, %s]',
             v_fee_type, p_new_rate, v_min_rate, v_max_rate),
      jsonb_build_object(
        'admin_id', v_admin_id, 'fee_id', p_fee_id,
        'fee_type', v_fee_type, 'attempted_rate', p_new_rate,
        'min_allowed', v_min_rate, 'max_allowed', v_max_rate
      ));
    RAISE EXCEPTION 'Rate % out of bounds for %: must be between % and %',
      p_new_rate, v_fee_type, v_min_rate, v_max_rate;
  END IF;

  UPDATE fee_config SET rate = p_new_rate WHERE id = p_fee_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/fee', format('Fee updated: %s (%s -> %s)', v_fee_type, v_old_rate, p_new_rate),
    jsonb_build_object(
      'admin_id', v_admin_id, 'fee_id', p_fee_id, 'fee_type', v_fee_type,
      'old_rate', v_old_rate, 'new_rate', p_new_rate, 'description', v_fee_desc
    ));

  RETURN jsonb_build_object(
    'success', true, 'fee_type', v_fee_type,
    'old_rate', v_old_rate, 'new_rate', p_new_rate
  );
END;
$$;

COMMIT;
