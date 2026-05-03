-- 0015_admin_withdrawals_and_stats.sql
--
-- W11 ops surface:
--
--   Phase A — Admin withdrawals queue (no PIN; uses is_admin GUC gate)
--     get_admin_withdrawals(status, limit, offset)
--     admin_approve_withdrawal(withdrawal_id, notes)
--     admin_reject_withdrawal(withdrawal_id, notes)
--     admin_mark_withdrawal_sent_v2(withdrawal_id, external_reference, notes)
--
--   Phase B — Stats / revenue dashboard (per-market P&L + user-level)
--     get_stats_market_pnl(from, to, duration)
--     get_stats_user_pnl(limit, sort)
--     get_stats_revenue_summary(from, to)
--
-- Locked-in decisions per W11 plan:
--   * No-PIN admin actions — Sooq's admin auth is is_admin = true via Auth.js
--     + the app.user_id() GUC. PIN was prediction-market-era second-factor;
--     dropping it removes UX friction. Existing PIN-gated RPCs stay alongside
--     in case anything still calls them.
--   * Revenue accounting = stakes − payouts per market (industry-standard
--     AMM). Loser stakes flow into the cash pool and fund winner payouts.
--     The 4% spread + cashout premium fall out as the platform's net.
--   * No new tables — recompute aggregations on every call against
--     speed_positions + transactions + speed_markets. Slim Sooq schema +
--     low volume = fine for v1.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- Phase A — Withdrawals
-- ───────────────────────────────────────────────────────────────────────

-- 1) get_admin_withdrawals — list + filter for the admin queue
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
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
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


-- 2) admin_approve_withdrawal — pending → approved (no PIN)
CREATE OR REPLACE FUNCTION admin_approve_withdrawal(
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

  RETURN jsonb_build_object(
    'status', 'approved',
    'withdrawal_id', p_withdrawal_id,
    'amount', v_withdrawal.amount
  );
END;
$$;


-- 3) admin_reject_withdrawal — pending → rejected, refunds the holding-debit
CREATE OR REPLACE FUNCTION admin_reject_withdrawal(
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

  -- Refund the held amount.
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

  RETURN jsonb_build_object(
    'status', 'rejected',
    'withdrawal_id', p_withdrawal_id,
    'refunded_amount', v_withdrawal.amount,
    'new_balance', v_new_balance
  );
END;
$$;


-- 4) admin_mark_withdrawal_sent_v2 — approved → sent (no PIN)
CREATE OR REPLACE FUNCTION admin_mark_withdrawal_sent_v2(
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

  -- Append the external ref + optional new notes to the existing notes
  -- column. Preserves the "sent_ref:<ref>" convention from the v1 PIN-gated
  -- mark-sent RPC so any reconciliation script that already greps for that
  -- prefix keeps working.
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

  RETURN jsonb_build_object(
    'status', 'sent',
    'withdrawal_id', p_withdrawal_id,
    'external_reference', TRIM(p_external_reference)
  );
END;
$$;


-- ───────────────────────────────────────────────────────────────────────
-- Phase B — Stats / revenue dashboard
-- ───────────────────────────────────────────────────────────────────────

-- 5) get_stats_market_pnl — per-market platform P&L for the date range
--
-- Computes per market:
--   stakes_in       sum of all open-trade stakes (= sum of position.stake)
--   payouts_out     sum of speed_payout + speed_refund + speed_cashout txs
--                   on positions in this market
--   platform_net    stakes_in − payouts_out (what the platform kept)
--   cashout_premium sum of (stake − cashout_amount) on cashed_out positions;
--                   the platform's edge specifically from early exits
--
-- Filters: optional duration ('5m','15m','24h'), date range (defaults to all).
CREATE OR REPLACE FUNCTION get_stats_market_pnl(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL,
  p_duration TEXT DEFAULT NULL
)
RETURNS TABLE (
  market_id UUID,
  asset TEXT,
  duration TEXT,
  opens_at TIMESTAMPTZ,
  closes_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  status TEXT,
  outcome TEXT,
  twap_at_close NUMERIC,
  total_positions INT,
  winners INT,
  losers INT,
  refunded INT,
  cashed_out INT,
  stakes_in NUMERIC,
  payouts_out NUMERIC,
  platform_net NUMERIC,
  cashout_premium NUMERIC
)
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

  RETURN QUERY
  WITH market_filter AS (
    SELECT m.*
    FROM speed_markets m
    WHERE (p_from IS NULL OR COALESCE(m.resolved_at, m.closes_at) >= p_from)
      AND (p_to   IS NULL OR COALESCE(m.resolved_at, m.closes_at) <= p_to)
      AND (p_duration IS NULL OR m.duration::TEXT = p_duration)
      AND m.status::TEXT IN ('resolved', 'voided')
  )
  SELECT
    m.id,
    m.asset::TEXT,
    m.duration::TEXT,
    m.opens_at,
    m.closes_at,
    m.resolved_at,
    m.status::TEXT,
    m.outcome::TEXT,
    m.twap_at_close,
    COUNT(p.id)::INT AS total_positions,
    COUNT(p.id) FILTER (WHERE p.status::TEXT = 'won')::INT AS winners,
    COUNT(p.id) FILTER (WHERE p.status::TEXT = 'lost')::INT AS losers,
    COUNT(p.id) FILTER (WHERE p.status::TEXT = 'refunded')::INT AS refunded,
    COUNT(p.id) FILTER (WHERE p.status::TEXT = 'cashed_out')::INT AS cashed_out,
    COALESCE(SUM(p.stake), 0)::NUMERIC AS stakes_in,
    COALESCE(SUM(
      CASE
        WHEN p.status::TEXT IN ('won', 'refunded', 'cashed_out')
          THEN COALESCE(p.payout_amount, 0)
        ELSE 0
      END
    ), 0)::NUMERIC AS payouts_out,
    -- platform_net = stakes_in − payouts_out
    (
      COALESCE(SUM(p.stake), 0)
      - COALESCE(SUM(
          CASE
            WHEN p.status::TEXT IN ('won', 'refunded', 'cashed_out')
              THEN COALESCE(p.payout_amount, 0)
            ELSE 0
          END
        ), 0)
    )::NUMERIC AS platform_net,
    -- cashout_premium = sum of (stake − cashout_amount) on cashed_out
    COALESCE(SUM(
      CASE
        WHEN p.status::TEXT = 'cashed_out'
          THEN p.stake - COALESCE(p.payout_amount, 0)
        ELSE 0
      END
    ), 0)::NUMERIC AS cashout_premium
  FROM market_filter m
  LEFT JOIN speed_positions p ON p.market_id = m.id
  GROUP BY m.id, m.asset, m.duration, m.opens_at, m.closes_at,
           m.resolved_at, m.status, m.outcome, m.twap_at_close
  ORDER BY COALESCE(m.resolved_at, m.closes_at) DESC;
END;
$$;


-- 6) get_stats_user_pnl — top users by lifetime stakes, payouts, net P&L
--
-- p_sort: 'winners' | 'losers' | 'volume'
--   winners → sort by net_pnl DESC (biggest gainers)
--   losers  → sort by net_pnl ASC (biggest losers)
--   volume  → sort by total_stakes DESC
CREATE OR REPLACE FUNCTION get_stats_user_pnl(
  p_limit INT DEFAULT 20,
  p_sort  TEXT DEFAULT 'winners'
)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  position_count INT,
  total_stakes NUMERIC,
  total_payouts NUMERIC,
  net_pnl NUMERIC,
  open_positions INT,
  open_stake_total NUMERIC
)
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

  IF p_sort NOT IN ('winners', 'losers', 'volume') THEN
    p_sort := 'winners';
  END IF;

  RETURN QUERY
  WITH per_user AS (
    SELECT
      u.id AS user_id,
      u.email,
      u.display_name,
      u.avatar_url,
      COUNT(p.id)::INT AS position_count,
      COALESCE(SUM(p.stake), 0)::NUMERIC AS total_stakes,
      COALESCE(SUM(
        CASE
          WHEN p.status::TEXT IN ('won', 'cashed_out', 'refunded')
            THEN COALESCE(p.payout_amount, 0)
          ELSE 0
        END
      ), 0)::NUMERIC AS total_payouts,
      COUNT(p.id) FILTER (WHERE p.status::TEXT = 'open')::INT AS open_positions,
      COALESCE(SUM(
        CASE
          WHEN p.status::TEXT = 'open' THEN p.stake
          ELSE 0
        END
      ), 0)::NUMERIC AS open_stake_total
    FROM users u
    JOIN speed_positions p ON p.user_id = u.id
    GROUP BY u.id, u.email, u.display_name, u.avatar_url
  )
  SELECT
    pu.user_id,
    pu.email,
    pu.display_name,
    pu.avatar_url,
    pu.position_count,
    pu.total_stakes,
    pu.total_payouts,
    (pu.total_payouts - pu.total_stakes)::NUMERIC AS net_pnl,
    pu.open_positions,
    pu.open_stake_total
  FROM per_user pu
  ORDER BY
    CASE WHEN p_sort = 'winners' THEN (pu.total_payouts - pu.total_stakes) END DESC NULLS LAST,
    CASE WHEN p_sort = 'losers'  THEN (pu.total_payouts - pu.total_stakes) END ASC  NULLS LAST,
    CASE WHEN p_sort = 'volume'  THEN pu.total_stakes END DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(100, p_limit));
END;
$$;


-- 7) get_stats_revenue_summary — single-row totals across the date range
CREATE OR REPLACE FUNCTION get_stats_revenue_summary(
  p_from TIMESTAMPTZ DEFAULT NULL,
  p_to   TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (
  gross_volume NUMERIC,
  total_payouts NUMERIC,
  platform_net NUMERIC,
  cashout_premium_total NUMERIC,
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
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  RETURN QUERY
  WITH range_positions AS (
    -- Positions that opened (created_at) in the date range OR are still
    -- open. Open ones contribute to the cash pool calculation; settled
    -- ones contribute to gross_volume / total_payouts.
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
    COALESCE(SUM(
      CASE WHEN p.status::TEXT = 'open' THEN p.stake ELSE 0 END
    ), 0)::NUMERIC AS open_cash_pool,
    (SELECT COUNT(*)::INT FROM range_markets WHERE status::TEXT = 'resolved') AS markets_resolved,
    (SELECT COUNT(*)::INT FROM range_markets WHERE status::TEXT = 'voided') AS markets_voided,
    (SELECT COUNT(DISTINCT user_id)::INT FROM range_positions) AS unique_traders
  FROM range_positions p;
END;
$$;

COMMIT;
