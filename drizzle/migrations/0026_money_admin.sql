-- 0026_money_admin.sql
--
-- Unified money admin surface — backs the new /admin/money page.
--
--   1) get_admin_deposits(p_status, p_limit, p_offset)
--      Lists deposits with the user info needed for the queue.
--      Statuses: 'pending', 'verified', 'rejected', 'expired'.
--
--   2) admin_credit_deposit(p_user_id, p_amount, p_provider_ref, p_notes)
--      Manual Whish credit. Calls process_deposit's logic inline so
--      ledger writes happen the same way the webhook would. No PIN —
--      matches the no-PIN admin pattern from mig 0015.
--
--   3) admin_balance_adjust_v2(p_user_id, p_amount, p_reason)
--      No-PIN manual credit/debit. Same shape as admin_adjust_balance
--      (mig 0006) minus the PIN gate. Caps at $10,000 absolute, refuses
--      zero, and never goes negative.
--
--   4) get_admin_money_ledger(p_from, p_to, p_user_id, p_types, p_limit, p_offset)
--      The single source of truth for the History tab. Reads
--      `transactions` directly (filtered by money types) and joins to
--      users for display. The withdrawal/deposit row's existence is
--      derived from `reference_id` in the linked source tables.
--
-- Naming + qualification follow the same pattern as mig 0025: every
-- `WHERE id = ...` reference inside an EXISTS gate is qualified to
-- avoid the PG17 OUT-param ambiguity.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1) get_admin_deposits — feed for the Deposits tab
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_admin_deposits(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION get_admin_deposits(
  p_status TEXT DEFAULT NULL,
  p_limit  INT  DEFAULT 50,
  p_offset INT  DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT,
  user_avatar_url TEXT,
  user_balance_usd NUMERIC,
  amount NUMERIC,
  currency TEXT,
  provider TEXT,
  provider_ref TEXT,
  status TEXT,
  proof_url TEXT,
  created_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.user_id,
    u.email,
    u.display_name,
    u.avatar_url,
    u.balance_usd,
    d.amount,
    d.currency,
    d.provider,
    d.provider_ref,
    d.status::TEXT,
    d.proof_url,
    d.created_at,
    d.verified_at
  FROM deposits d
  JOIN users u ON u.id = d.user_id
  WHERE p_status IS NULL OR d.status::TEXT = p_status
  ORDER BY d.created_at DESC
  LIMIT GREATEST(1, LEAST(200, p_limit))
  OFFSET GREATEST(0, p_offset);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 2) admin_credit_deposit — manual Whish credit (no PIN)
--    Inserts a `verified` deposit row, credits balance, writes ledger
--    transaction. Idempotent on `provider_ref`.
-- ───────────────────────────────────────────────────────────────────────

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

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'amount', p_amount,
    'new_balance', v_new_balance,
    'status', 'verified'
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 3) admin_balance_adjust_v2 — no-PIN manual credit/debit
--    Identical accounting to mig 0006's admin_adjust_balance, minus PIN.
-- ───────────────────────────────────────────────────────────────────────

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

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text,
    'amount', p_amount
  );
END;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 4) get_admin_money_ledger — History tab (truth view)
--    Reads `transactions` directly with the money-related types,
--    joins users for display. Sorted newest first.
--    p_types is a TEXT[] for multi-filter; NULL/empty = all money types.
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_admin_money_ledger(TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT[], INT, INT);

CREATE OR REPLACE FUNCTION get_admin_money_ledger(
  p_from    TIMESTAMPTZ DEFAULT NULL,
  p_to      TIMESTAMPTZ DEFAULT NULL,
  p_user_id UUID DEFAULT NULL,
  p_types   TEXT[] DEFAULT NULL,
  p_limit   INT DEFAULT 100,
  p_offset  INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  user_email TEXT,
  user_display_name TEXT,
  type TEXT,
  amount NUMERIC,
  balance_after NUMERIC,
  description TEXT,
  reference_id UUID,
  performed_by UUID,
  performed_by_email TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_money_types TEXT[] := ARRAY['deposit','withdrawal','admin_credit','admin_debit'];
  v_apply_types TEXT[];
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  v_apply_types := CASE
    WHEN p_types IS NULL OR array_length(p_types, 1) IS NULL THEN v_money_types
    ELSE p_types
  END;

  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    u.email,
    u.display_name,
    t.type::TEXT,
    t.amount,
    t.balance_after,
    t.description,
    t.reference_id,
    t.performed_by,
    pu.email,
    t.created_at
  FROM transactions t
  JOIN users u ON u.id = t.user_id
  LEFT JOIN users pu ON pu.id = t.performed_by
  WHERE t.type::TEXT = ANY(v_apply_types)
    AND (p_user_id IS NULL OR t.user_id = p_user_id)
    AND (p_from IS NULL OR t.created_at >= p_from)
    AND (p_to   IS NULL OR t.created_at <= p_to)
  ORDER BY t.created_at DESC
  LIMIT GREATEST(1, LEAST(500, p_limit))
  OFFSET GREATEST(0, p_offset);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 5) admin_search_users — autocomplete for the Manual adjust tab
--    Matches email or display_name (case-insensitive prefix-ish).
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS admin_search_users(TEXT, INT);

CREATE OR REPLACE FUNCTION admin_search_users(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  balance_usd NUMERIC,
  is_frozen BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_q TEXT;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = v_admin_id AND u.is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  v_q := COALESCE(TRIM(p_query), '');
  IF length(v_q) < 2 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.email,
    u.display_name,
    u.avatar_url,
    u.balance_usd,
    u.is_frozen
  FROM users u
  WHERE u.email ILIKE '%' || v_q || '%'
     OR u.display_name ILIKE '%' || v_q || '%'
     OR u.phone ILIKE '%' || v_q || '%'
  ORDER BY
    CASE WHEN u.email ILIKE v_q || '%' THEN 0 ELSE 1 END,
    u.email
  LIMIT GREATEST(1, LEAST(50, p_limit));
END;
$$;

COMMIT;
