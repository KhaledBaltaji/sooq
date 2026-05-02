-- 278_amm_risk_snapshot_rpc.sql — forward-looking AMM risk snapshot
--
-- Problem: /admin/amm, /admin/accounting (AMM tab), /admin/stats (Health tab)
-- all show backward-looking AMM state (realized seed P&L, revenue collected,
-- current prices). None of them answer the operator's real question:
-- "If every open market resolves against us tomorrow, what do we owe and
-- do we have the cash to cover it?"
--
-- This function returns that snapshot in a single round-trip:
--   - 1 aggregate row (section='aggregate', market_id IS NULL) — platform totals
--   - N per-market rows (section='per_market') — one per open/closed market
--
-- Design note on columns used:
--   - cash_in sourced from `amm_state.retail_net_cash` (NOT SUM of trades).
--   - shares_yes/no sourced from `amm_state.retail_shares_yes/retail_shares_no`
--     (NOT `q_yes/q_no`, which are mixed retail + branch).
--   These retail-only columns were added in migration 20702 and are maintained
--   correctly by `execute_trade`. They exclude branch trades (which settle via
--   branch_pools, not the retail AMM) and already account for fees (retail_net_cash
--   is incremented by net-of-fee buy amount and decremented by gross sell proceeds).
--   Computing these from `trades.total_cost` would silently mix branch flow and
--   fee amounts that never reached the retail AMM.
--
-- Caller gating: matches the `/admin/amm` page gate
-- (is_admin AND (admin_allowed_views IS NULL OR 'amm' = ANY(admin_allowed_views)))
-- so sub-admins with the `amm` view can call this RPC cleanly without getting
-- a mystery permission error.

CREATE OR REPLACE FUNCTION get_amm_risk_snapshot()
RETURNS TABLE (
  section              TEXT,
  market_id            UUID,
  market_name          TEXT,
  market_status        market_status,
  liquidity_param      DECIMAL(18,6),
  q_yes                DECIMAL(18,6),
  q_no                 DECIMAL(18,6),
  imbalance            DECIMAL(10,6),
  cash_in              DECIMAL(18,2),
  worst_case_payout    DECIMAL(18,2),
  net_exposure         DECIMAL(18,2),
  theoretical_max_loss DECIMAL(18,2),
  is_red_flag          BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_fee_rate NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
      AND u.is_admin = TRUE
      AND (u.admin_allowed_views IS NULL OR 'amm' = ANY(u.admin_allowed_views))
  ) THEN
    RAISE EXCEPTION 'Not authorized: admin with amm view required';
  END IF;

  v_fee_rate := COALESCE(
    (SELECT fc.rate FROM fee_config fc WHERE fc.fee_type = 'resolution_fee' LIMIT 1),
    0.01
  );

  RETURN QUERY
  WITH per_market AS (
    SELECT
      'per_market'::TEXT AS section,
      m.id AS market_id,
      m.question_en AS market_name,
      m.status AS market_status,
      a.liquidity_param,
      a.retail_shares_yes AS q_yes,
      a.retail_shares_no  AS q_no,
      CASE
        WHEN (a.retail_shares_yes + a.retail_shares_no) = 0 THEN 0::DECIMAL(10,6)
        ELSE ROUND((ABS(a.retail_shares_yes - a.retail_shares_no) / (a.retail_shares_yes + a.retail_shares_no))::NUMERIC, 6)::DECIMAL(10,6)
      END AS imbalance,
      a.retail_net_cash::DECIMAL(18,2) AS cash_in,
      (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate))::DECIMAL(18,2) AS worst_case_payout,
      (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate) - a.retail_net_cash)::DECIMAL(18,2) AS net_exposure,
      (a.liquidity_param * LN(2))::DECIMAL(18,2) AS theoretical_max_loss,
      (
        (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate) - a.retail_net_cash) > 500
        OR (
          CASE WHEN (a.retail_shares_yes + a.retail_shares_no) = 0 THEN 0
               ELSE ABS(a.retail_shares_yes - a.retail_shares_no) / (a.retail_shares_yes + a.retail_shares_no) END
        ) > 0.8
      ) AS is_red_flag,
      1::INT AS _sort_key
    FROM amm_state a INNER JOIN markets m ON m.id = a.market_id
    WHERE m.status IN ('open', 'closed')
  ),
  aggregate_row AS (
    SELECT
      'aggregate'::TEXT AS section,
      NULL::UUID        AS market_id,
      NULL::TEXT        AS market_name,
      NULL::market_status AS market_status,
      NULL::DECIMAL(18,6) AS liquidity_param,
      COALESCE(SUM(pm.q_yes), 0)::DECIMAL(18,6) AS q_yes,
      COALESCE(SUM(pm.q_no),  0)::DECIMAL(18,6) AS q_no,
      0::DECIMAL(10,6) AS imbalance,
      COALESCE(SUM(pm.cash_in),           0)::DECIMAL(18,2) AS cash_in,
      COALESCE(SUM(pm.worst_case_payout), 0)::DECIMAL(18,2) AS worst_case_payout,
      COALESCE(SUM(pm.net_exposure),      0)::DECIMAL(18,2) AS net_exposure,
      COALESCE(SUM(pm.theoretical_max_loss), 0)::DECIMAL(18,2) AS theoretical_max_loss,
      (COALESCE(SUM(pm.net_exposure), 0) > 0) AS is_red_flag,
      0::INT AS _sort_key
    FROM per_market pm
  ),
  combined AS (
    SELECT * FROM aggregate_row
    UNION ALL
    SELECT * FROM per_market
  )
  SELECT
    c.section, c.market_id, c.market_name, c.market_status, c.liquidity_param,
    c.q_yes, c.q_no, c.imbalance, c.cash_in, c.worst_case_payout,
    c.net_exposure, c.theoretical_max_loss, c.is_red_flag
  FROM combined c
  ORDER BY c._sort_key, c.net_exposure DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_amm_risk_snapshot() TO authenticated;

COMMENT ON FUNCTION get_amm_risk_snapshot() IS
  'Admin-only (via admin_allowed_views amm gate) forward-looking risk snapshot for the retail LMSR AMM. Returns 1 aggregate row + N per-market rows. cash_in from amm_state.retail_net_cash; shares from amm_state.retail_shares_yes/no. Excludes branch trades and fees already routed to platform_revenue. Red-flag thresholds: net_exposure > $500 OR imbalance > 0.8.';
