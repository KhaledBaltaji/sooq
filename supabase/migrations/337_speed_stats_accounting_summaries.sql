-- ============================================================================
-- 337_speed_stats_accounting_summaries.sql
--
-- Workstreams O + P — bake speed-market data into platform-wide stats and
-- accounting reads.
--
-- Strategy: rather than rewrite the existing get_stats_*  and get_accounting_*
-- RPCs (each is 50-100+ lines and battle-tested), add NEW dedicated speed-side
-- helper RPCs the dashboard pages call alongside. Frontend merges both halves
-- for display. Cleaner separation, easier to audit, no risk to existing
-- prediction accounting.
--
-- Two helpers:
--   get_speed_stats_summary(p_start, p_end) — for /admin/stats/*
--   get_speed_accounting_summary(p_start, p_end) — for /admin/accounting/*
--
-- Both compute revenue from speed_trades directly (handle_fee + spread
-- component), payouts from speed_pool_ledger, branch P&L per branch_id.
-- ============================================================================

-- ─── Stats helper ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_speed_stats_summary(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  RETURN jsonb_build_object(
    'period_start', p_start_date,
    'period_end',   p_end_date,
    'revenue', (
      SELECT jsonb_build_object(
        'handle_fees',     COALESCE(SUM(handle_fee), 0),
        'spread_revenue',  COALESCE(SUM(amount * (offered_prob - fair_prob)), 0),
        'gross_revenue',   COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0),
        'gross_stake',     COALESCE(SUM(amount), 0),
        'effective_edge_pct', CASE
          WHEN COALESCE(SUM(amount), 0) > 0
          THEN ROUND((SUM(handle_fee + (amount * (offered_prob - fair_prob))) / SUM(amount) * 100)::numeric, 2)
          ELSE 0
        END,
        'trade_count', COUNT(*)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN p_start_date AND p_end_date
    ),
    'trading', (
      SELECT jsonb_build_object(
        'open_trades',     COALESCE(COUNT(*) FILTER (WHERE kind = 'open'), 0),
        'cashout_trades',  COALESCE(COUNT(*) FILTER (WHERE kind = 'cashout'), 0),
        'unique_traders',  COUNT(DISTINCT user_id),
        'total_volume',    COALESCE(SUM(amount), 0)
      )
      FROM speed_trades
      WHERE created_at BETWEEN p_start_date AND p_end_date
    ),
    'finance', (
      SELECT jsonb_build_object(
        'main_pool_balance', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger WHERE branch_id IS NULL
        ), 0),
        'branch_pools_total', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger WHERE branch_id IS NOT NULL
        ), 0),
        'gross_payouts', COALESCE((
          SELECT -SUM(amount) FROM speed_pool_ledger
          WHERE type IN ('winning_payout', 'cashout_out', 'refund')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'gross_stakes_in', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger
          WHERE type = 'stake_in'
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0)
      )
    ),
    'markets', (
      SELECT jsonb_build_object(
        'open_markets',      COUNT(*) FILTER (WHERE status = 'open'),
        'resolved_markets',  COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at BETWEEN p_start_date AND p_end_date),
        'voided_markets',    COUNT(*) FILTER (WHERE status = 'voided' AND voided_at BETWEEN p_start_date AND p_end_date)
      )
      FROM speed_markets
    )
  );
END;
$$;

COMMENT ON FUNCTION get_speed_stats_summary(TIMESTAMPTZ, TIMESTAMPTZ) IS
'Speed-market analog of get_stats_revenue/trading/finance/markets, returned in one call. Frontend /admin/stats/* pages merge with the prediction-side RPC for combined view.';

-- ─── Accounting helper ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_speed_accounting_summary(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'period_start', p_start_date,
    'period_end',   p_end_date,
    'revenue', (
      SELECT jsonb_build_object(
        'handle_fees',     COALESCE(SUM(handle_fee), 0),
        'spread_revenue',  COALESCE(SUM(amount * (offered_prob - fair_prob)), 0),
        'gross_revenue',   COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN p_start_date AND p_end_date
    ),
    'costs', (
      SELECT jsonb_build_object(
        'speed_payouts', COALESCE((
          SELECT -SUM(amount) FROM speed_pool_ledger
          WHERE type IN ('winning_payout', 'cashout_out', 'refund')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'speed_commissions_paid', COALESCE((
          SELECT SUM(commission_amount) FROM referral_commissions
          WHERE status = 'credited'
            AND source_type IN ('speed_trade', 'speed_resolution')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'branch_fee_share_paid', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger
          WHERE type = 'fee_share_in'
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0)
      )
    ),
    'previous_period_revenue', (
      SELECT jsonb_build_object(
        'gross_revenue', COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN v_prev_start AND p_start_date
    ),
    'per_branch', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'branch_id', t.branch_id,
        'branch_name', COALESCE(t.branch_name, 'SOOQ Main'),
        'gross_revenue', t.gross_revenue,
        'gross_stake', t.gross_stake,
        'pool_p_and_l', t.pool_p_and_l
      ) ORDER BY t.gross_revenue DESC), '[]'::jsonb)
      FROM (
        SELECT
          t.branch_id,
          b.name AS branch_name,
          SUM(t.handle_fee + (t.amount * (t.offered_prob - t.fair_prob))) AS gross_revenue,
          SUM(t.amount) AS gross_stake,
          COALESCE((
            SELECT SUM(amount) FROM speed_pool_ledger l
            WHERE l.branch_id IS NOT DISTINCT FROM t.branch_id
              AND l.created_at BETWEEN p_start_date AND p_end_date
          ), 0) AS pool_p_and_l
        FROM speed_trades t
        LEFT JOIN branches b ON b.id = t.branch_id
        WHERE t.kind = 'open'
          AND t.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY t.branch_id, b.name
      ) t
    )
  );
END;
$$;

COMMENT ON FUNCTION get_speed_accounting_summary(TIMESTAMPTZ, TIMESTAMPTZ) IS
'Speed-market accounting summary for /admin/accounting. Per-branch P&L, period-over-period delta, costs breakdown. Frontend merges with get_accounting_pnl for combined view.';
