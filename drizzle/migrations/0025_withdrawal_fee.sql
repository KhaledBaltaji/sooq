-- 0025_withdrawal_fee.sql
--
-- Two changes in one forward-only migration (both safe to re-run):
--
-- 1. Withdrawal fee end-to-end. Until now the modal showed a "fee" line
--    that was purely cosmetic — the user was debited the gross amount
--    and the platform never recognized the fee anywhere. This adds
--    fee_amount + net_amount columns on `withdrawals`, makes
--    process_withdrawal compute the fee server-side from `fee_config`,
--    and surfaces `withdrawal_fees_collected` in the stats summary so
--    /admin/stats can show real revenue from withdrawals.
--
-- 2. Fix `column reference "id" is ambiguous` in get_admin_withdrawals.
--    The original RETURNS TABLE in mig 0015 declared `id UUID` as an
--    OUT param, which collides with `users.id` in the EXISTS admin gate
--    under PG17. Recreating with `users.id` qualified.
--
-- Locked-in decisions:
--   * Default withdrawal fee rate = 1.00% (matches DEFAULT_FEE_RATES.withdrawal
--     in src/lib/query/fees/queries.ts). Tunable via `fee_config` row.
--   * Fee is RECOGNIZED on send, not on approve. An approved-but-not-yet-sent
--     withdrawal can still be unwound manually via DB ops.
--   * `amount` stays as gross (what we hold from the user). `net_amount` is
--     what ops physically transfers. `fee_amount = amount - net_amount`.
--   * Pre-mig-0025 historical rows: fee_amount = 0, net_amount = NULL.
--     We do NOT retroactively assign fees to history.
--   * On reject: still refunds full `amount` (gross). The fee was never
--     realized, so refunding the whole hold is correct.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1) Schema — fee_amount, net_amount on withdrawals
-- ───────────────────────────────────────────────────────────────────────

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(18, 2) NOT NULL DEFAULT 0;

ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS net_amount NUMERIC(18, 2);

-- ───────────────────────────────────────────────────────────────────────
-- 2) Seed `withdrawal_fee` row in fee_config (default 1.0%)
-- ───────────────────────────────────────────────────────────────────────

INSERT INTO fee_config (fee_type, rate, description)
VALUES (
  'withdrawal_fee',
  0.01,
  '0025: withdrawal fee rate (fraction of gross). Charged at process time, recognized as platform revenue when status = sent.'
)
ON CONFLICT (fee_type) DO NOTHING;

-- ───────────────────────────────────────────────────────────────────────
-- 3) process_withdrawal — read fee from fee_config, populate fee/net cols
-- ───────────────────────────────────────────────────────────────────────

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
  v_fee_rate NUMERIC;
  v_fee NUMERIC;
  v_net NUMERIC;
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

  INSERT INTO withdrawals (user_id, amount, fee_amount, net_amount, method, account_details, status)
  VALUES (v_user_id, p_amount, v_fee, v_net, p_method, p_account_details, 'pending')
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

-- ───────────────────────────────────────────────────────────────────────
-- 4) get_admin_withdrawals — drop + recreate
--    (a) qualifies users.id in admin gate to fix PG17 ambiguity
--    (b) adds fee_amount + net_amount to RETURNS TABLE
--    Signature change forces DROP first.
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_admin_withdrawals(TEXT, INT, INT);

CREATE OR REPLACE FUNCTION get_admin_withdrawals(
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
  fee_amount NUMERIC,
  net_amount NUMERIC,
  method TEXT,
  account_details JSONB,
  status TEXT,
  reviewer_id UUID,
  reviewed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ
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
    w.id,
    w.user_id,
    u.email,
    u.display_name,
    u.avatar_url,
    u.balance_usd,
    w.amount,
    w.fee_amount,
    w.net_amount,
    w.method,
    w.account_details,
    w.status::TEXT,
    w.reviewer_id,
    w.reviewed_at,
    w.sent_at,
    w.notes,
    w.created_at
  FROM withdrawals w
  JOIN users u ON u.id = w.user_id
  WHERE p_status IS NULL OR w.status::TEXT = p_status
  ORDER BY w.created_at DESC
  LIMIT GREATEST(1, LEAST(200, p_limit))
  OFFSET GREATEST(0, p_offset);
END;
$$;

-- ───────────────────────────────────────────────────────────────────────
-- 5) get_stats_revenue_summary — add withdrawal_fees_collected
--    Drop + recreate (RETURNS TABLE shape change).
-- ───────────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS get_stats_revenue_summary(TIMESTAMPTZ, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION get_stats_revenue_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  gross_volume NUMERIC,
  total_payouts NUMERIC,
  platform_net NUMERIC,
  cashout_premium_total NUMERIC,
  withdrawal_fees_collected NUMERIC,
  open_cash_pool NUMERIC,
  markets_resolved INT,
  markets_voided INT,
  unique_traders INT
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
  WITH range_positions AS (
    SELECT p.*
    FROM speed_positions p
    WHERE (p_from IS NULL OR p.created_at >= p_from)
      AND (p_to   IS NULL OR p.created_at <= p_to)
  ),
  range_markets AS (
    SELECT m.*
    FROM speed_markets m
    WHERE (p_from IS NULL OR COALESCE(m.resolved_at, m.closes_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(m.resolved_at, m.closes_at) <= p_to)
  ),
  -- Fee is recognized at send time — only count rows where the actual
  -- transfer executed. Date filter uses sent_at if available, else
  -- created_at as a fallback for in-flight 'sent' rows missing sent_at.
  range_withdrawal_fees AS (
    SELECT COALESCE(SUM(w.fee_amount), 0)::NUMERIC AS total
    FROM withdrawals w
    WHERE w.status::TEXT = 'sent'
      AND (p_from IS NULL OR COALESCE(w.sent_at, w.created_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(w.sent_at, w.created_at) <= p_to)
  )
  SELECT
    COALESCE(SUM(p.stake), 0)::NUMERIC AS gross_volume,
    COALESCE(SUM(
      CASE
        WHEN p.status::TEXT IN ('won', 'cashed_out', 'refunded')
          THEN COALESCE(p.payout_amount, 0)
        ELSE 0
      END
    ), 0)::NUMERIC AS total_payouts,
    (
      COALESCE(SUM(p.stake), 0)
      - COALESCE(SUM(
          CASE
            WHEN p.status::TEXT IN ('won', 'cashed_out', 'refunded')
              THEN COALESCE(p.payout_amount, 0)
            ELSE 0
          END
        ), 0)
    )::NUMERIC AS platform_net,
    COALESCE(SUM(
      CASE
        WHEN p.status::TEXT = 'cashed_out'
          THEN p.stake - COALESCE(p.payout_amount, 0)
        ELSE 0
      END
    ), 0)::NUMERIC AS cashout_premium_total,
    (SELECT total FROM range_withdrawal_fees) AS withdrawal_fees_collected,
    COALESCE(SUM(
      CASE WHEN p.status::TEXT = 'open' THEN p.stake ELSE 0 END
    ), 0)::NUMERIC AS open_cash_pool,
    (SELECT COUNT(*)::INT FROM range_markets rm WHERE rm.status::TEXT = 'resolved') AS markets_resolved,
    (SELECT COUNT(*)::INT FROM range_markets rm WHERE rm.status::TEXT = 'voided') AS markets_voided,
    (SELECT COUNT(DISTINCT rp.user_id)::INT FROM range_positions rp) AS unique_traders
  FROM range_positions p;
END;
$$;

COMMIT;
