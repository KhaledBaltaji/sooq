-- 0024_admin_stats_grouped.sql
--
-- Admin /stats was rendering one row per market — with 5m markets rolling
-- every 5 minutes that became hundreds of mostly-empty rows (a 24h Today
-- window has 288 BTC·5m rows, most with $0 stakes/$0 payouts). The page
-- needs to aggregate by (asset, duration) by default and let the admin
-- drill into individual markets, then into individual trades.
--
-- Two new SECURITY DEFINER RPCs, same admin gate as get_stats_market_pnl
-- (mig 0015): only callers whose `app.user_id` GUC maps to a row with
-- users.is_admin = TRUE can execute.
--
--   1. get_stats_market_pnl_grouped(p_from, p_to, p_duration)
--      — collapses get_stats_market_pnl rows by (asset, duration).
--      — returns markets_total / markets_resolved / markets_voided counts
--        plus summed stakes_in / payouts_out / platform_net / cashout_premium.
--      — `last_resolved_at` for sort.
--
--   2. get_stats_market_trades(p_asset, p_duration, p_market_id, p_from, p_to, p_limit)
--      — drilldown into a single bucket OR a single market.
--      — when p_market_id IS NOT NULL: returns every trade for that market
--        regardless of date range (admin is inspecting one market's history).
--      — when p_market_id IS NULL: filters by asset+duration+date range,
--        capped at p_limit (default 500, hard ceiling 1000).
--      — joins speed_trades → speed_positions → speed_markets → users
--        and returns enough columns to render an inspector row per trade.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1) get_stats_market_pnl_grouped — aggregate by (asset, duration)
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_stats_market_pnl_grouped(
  p_from     TIMESTAMPTZ DEFAULT NULL,
  p_to       TIMESTAMPTZ DEFAULT NULL,
  p_duration TEXT        DEFAULT NULL
)
RETURNS TABLE (
  asset             TEXT,
  duration          TEXT,
  markets_total     INT,
  markets_resolved  INT,
  markets_voided    INT,
  total_positions   INT,
  winners           INT,
  losers            INT,
  refunded          INT,
  cashed_out        INT,
  stakes_in         NUMERIC,
  payouts_out       NUMERIC,
  platform_net      NUMERIC,
  cashout_premium   NUMERIC,
  last_resolved_at  TIMESTAMPTZ
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
    SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE
  ) THEN
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
  ),
  per_market AS (
    SELECT
      m.asset::TEXT          AS asset,
      m.duration::TEXT       AS duration,
      m.id                   AS market_id,
      m.status::TEXT         AS status,
      COALESCE(m.resolved_at, m.closes_at) AS at,
      COUNT(p.id)::INT                                                 AS total_positions,
      COUNT(p.id) FILTER (WHERE p.status::TEXT = 'won')::INT           AS winners,
      COUNT(p.id) FILTER (WHERE p.status::TEXT = 'lost')::INT          AS losers,
      COUNT(p.id) FILTER (WHERE p.status::TEXT = 'refunded')::INT      AS refunded,
      COUNT(p.id) FILTER (WHERE p.status::TEXT = 'cashed_out')::INT    AS cashed_out,
      COALESCE(SUM(p.stake), 0)::NUMERIC                               AS stakes_in,
      COALESCE(SUM(
        CASE WHEN p.status::TEXT IN ('won', 'refunded', 'cashed_out')
             THEN COALESCE(p.payout_amount, 0)
             ELSE 0
        END
      ), 0)::NUMERIC                                                   AS payouts_out,
      COALESCE(SUM(
        CASE WHEN p.status::TEXT = 'cashed_out'
             THEN p.stake - COALESCE(p.payout_amount, 0)
             ELSE 0
        END
      ), 0)::NUMERIC                                                   AS cashout_premium
    FROM market_filter m
    LEFT JOIN speed_positions p ON p.market_id = m.id
    GROUP BY m.id, m.asset, m.duration, m.status, m.resolved_at, m.closes_at
  )
  SELECT
    pm.asset,
    pm.duration,
    COUNT(*)::INT                                            AS markets_total,
    COUNT(*) FILTER (WHERE pm.status = 'resolved')::INT      AS markets_resolved,
    COUNT(*) FILTER (WHERE pm.status = 'voided')::INT        AS markets_voided,
    COALESCE(SUM(pm.total_positions), 0)::INT                AS total_positions,
    COALESCE(SUM(pm.winners), 0)::INT                        AS winners,
    COALESCE(SUM(pm.losers), 0)::INT                         AS losers,
    COALESCE(SUM(pm.refunded), 0)::INT                       AS refunded,
    COALESCE(SUM(pm.cashed_out), 0)::INT                     AS cashed_out,
    COALESCE(SUM(pm.stakes_in), 0)::NUMERIC                  AS stakes_in,
    COALESCE(SUM(pm.payouts_out), 0)::NUMERIC                AS payouts_out,
    (COALESCE(SUM(pm.stakes_in), 0)
     - COALESCE(SUM(pm.payouts_out), 0))::NUMERIC            AS platform_net,
    COALESCE(SUM(pm.cashout_premium), 0)::NUMERIC            AS cashout_premium,
    MAX(pm.at)                                               AS last_resolved_at
  FROM per_market pm
  GROUP BY pm.asset, pm.duration
  ORDER BY MAX(pm.at) DESC NULLS LAST;
END;
$$;

COMMENT ON FUNCTION public.get_stats_market_pnl_grouped(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) IS
  '0024: Admin /stats default per-bucket aggregation (asset, duration). Replaces the per-market scatter as the default view; per-market detail still available via get_stats_market_pnl.';

REVOKE ALL ON FUNCTION public.get_stats_market_pnl_grouped(TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC;


-- ───────────────────────────────────────────────────────────────────────
-- 2) get_stats_market_trades — drilldown trade list
-- ───────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_stats_market_trades(
  p_asset     TEXT        DEFAULT NULL,
  p_duration  TEXT        DEFAULT NULL,
  p_market_id UUID        DEFAULT NULL,
  p_from      TIMESTAMPTZ DEFAULT NULL,
  p_to        TIMESTAMPTZ DEFAULT NULL,
  p_limit     INT         DEFAULT 500
)
RETURNS TABLE (
  trade_id            UUID,
  kind                TEXT,
  amount              NUMERIC,
  created_at          TIMESTAMPTZ,
  market_id           UUID,
  market_asset        TEXT,
  market_duration     TEXT,
  market_opens_at     TIMESTAMPTZ,
  market_closes_at    TIMESTAMPTZ,
  market_status       TEXT,
  market_outcome      TEXT,
  position_id         UUID,
  position_side       TEXT,
  position_stake      NUMERIC,
  entry_offered_prob  NUMERIC,
  payout_amount       NUMERIC,
  position_status     TEXT,
  user_id             UUID,
  user_email          TEXT,
  user_display_name   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_admin_id UUID;
  v_limit    INT;
BEGIN
  v_admin_id := app.user_id();
  IF v_admin_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE
  ) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);

  RETURN QUERY
  SELECT
    t.id                    AS trade_id,
    t.kind::TEXT            AS kind,
    t.amount::NUMERIC       AS amount,
    t.created_at            AS created_at,
    m.id                    AS market_id,
    m.asset::TEXT           AS market_asset,
    m.duration::TEXT        AS market_duration,
    m.opens_at              AS market_opens_at,
    m.closes_at             AS market_closes_at,
    m.status::TEXT          AS market_status,
    m.outcome::TEXT         AS market_outcome,
    p.id                    AS position_id,
    p.side::TEXT            AS position_side,
    p.stake::NUMERIC        AS position_stake,
    p.entry_offered_prob::NUMERIC AS entry_offered_prob,
    p.payout_amount::NUMERIC      AS payout_amount,
    p.status::TEXT          AS position_status,
    u.id                    AS user_id,
    u.email                 AS user_email,
    u.display_name          AS user_display_name
  FROM speed_trades t
  JOIN speed_positions p ON p.id = t.position_id
  JOIN speed_markets   m ON m.id = t.market_id
  JOIN users           u ON u.id = t.user_id
  WHERE
    -- Single-market drilldown ignores asset/duration/date filters.
    (p_market_id IS NOT NULL AND t.market_id = p_market_id)
    OR (
      p_market_id IS NULL
      AND (p_asset    IS NULL OR m.asset::TEXT    = p_asset)
      AND (p_duration IS NULL OR m.duration::TEXT = p_duration)
      AND (p_from     IS NULL OR t.created_at >= p_from)
      AND (p_to       IS NULL OR t.created_at <= p_to)
    )
  ORDER BY t.created_at DESC
  LIMIT v_limit;
END;
$$;

COMMENT ON FUNCTION public.get_stats_market_trades(TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) IS
  '0024: Admin drilldown into trade history. Pass p_market_id for single-market history (date range ignored), or p_asset+p_duration for bucket history within p_from/p_to window.';

REVOKE ALL ON FUNCTION public.get_stats_market_trades(TEXT, TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INT) FROM PUBLIC;

COMMIT;
