-- ============================================================
-- 232: Admin Accounting RPCs
--
-- 4 SECURITY DEFINER RPCs for the /admin/accounting page:
-- 1. get_accounting_pnl — Platform P&L (revenue - costs)
-- 2. get_accounting_amm — AMM profitability per market
-- 3. get_accounting_branches — Per-branch revenue + agent payouts
-- 4. get_accounting_commissions — Commission breakdown by status/layer/agent
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. get_accounting_pnl — Platform Profit & Loss
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_pnl(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'revenue', (
      SELECT row_to_json(r) FROM (
        SELECT
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE(SUM(dynamic_spread), 0) as dynamic_spread,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0) as trade_revenue,
          COALESCE((
            SELECT SUM(resolution_fee_revenue)
            FROM platform_revenue
            WHERE created_at BETWEEN p_start_date AND p_end_date
          ), 0) as resolution_fees,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((
                SELECT SUM(resolution_fee_revenue)
                FROM platform_revenue
                WHERE created_at BETWEEN p_start_date AND p_end_date
              ), 0) as gross_revenue
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) r
    ),
    'costs', (
      SELECT row_to_json(c) FROM (
        SELECT
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_escrowed,
          -- AMM losses: negative seed_pnl on markets resolved in this period
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_losses,
          -- AMM gains for reference
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl >= 0 THEN a.seed_pnl ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_gains,
          -- Net AMM P&L
          COALESCE((
            SELECT SUM(a.seed_pnl)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_net_pnl
        ) c
    ),
    'previous_period', (
      SELECT row_to_json(pp) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN v_prev_start AND p_start_date), 0) as gross_revenue,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN v_prev_start AND p_start_date
          ), 0) as amm_losses
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) pp
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          tr.date,
          tr.revenue,
          COALESCE(rc_agg.commissions, 0) as commissions,
          0 as amm_losses
        FROM (
          SELECT
            t.created_at::date as date,
            COALESCE(SUM(t.explicit_fee + t.amm_spread_cost + t.cash_out_premium + COALESCE(t.dynamic_spread, 0)), 0) as revenue
          FROM trades t
          WHERE t.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY t.created_at::date
        ) tr
        LEFT JOIN (
          SELECT rc.created_at::date as date, SUM(rc.commission_amount) as commissions
          FROM referral_commissions rc
          WHERE rc.status = 'credited' AND rc.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY rc.created_at::date
        ) rc_agg ON rc_agg.date = tr.date
      ) d
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. get_accounting_amm — AMM profitability per resolved market
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_amm(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'aggregates', (
      SELECT row_to_json(agg) FROM (
        SELECT
          COALESCE(SUM(a.seed_pnl), 0) as total_seed_pnl,
          COUNT(*) FILTER (WHERE a.seed_pnl >= 0) as markets_in_profit,
          COUNT(*) FILTER (WHERE a.seed_pnl < 0) as markets_in_loss,
          COALESCE(SUM(a.total_volume), 0) as total_volume,
          SUM(a.total_trades) as total_trades,
          COALESCE(SUM(CASE WHEN a.seed_pnl >= 0 THEN a.seed_pnl ELSE 0 END), 0) as total_gains,
          COALESCE(SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END), 0) as total_losses
        FROM amm_state a
        JOIN markets m ON m.id = a.market_id
        WHERE m.status = 'resolved'
          AND m.resolved_at BETWEEN p_start_date AND p_end_date
      ) agg
    ),
    'markets', (
      SELECT COALESCE(jsonb_agg(row_to_json(mk) ORDER BY mk.seed_pnl DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.market_id,
          m.question_en,
          m.outcome,
          m.resolved_at,
          a.seed_pnl,
          a.total_volume,
          a.total_trades,
          a.liquidity_param
        FROM amm_state a
        JOIN markets m ON m.id = a.market_id
        WHERE m.status = 'resolved'
          AND m.resolved_at BETWEEN p_start_date AND p_end_date
        ORDER BY a.seed_pnl DESC
      ) mk
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. get_accounting_branches — Per-branch revenue + agent payouts
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_branches(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(br.total_revenue), 0) as total_branch_revenue,
          COALESCE(SUM(br.markup_revenue), 0) as total_markup_revenue,
          COALESCE(SUM(br.explicit_fee_revenue), 0) as total_explicit_fee_revenue,
          COALESCE(SUM(br.exit_fee_revenue), 0) as total_exit_fee_revenue,
          COALESCE(SUM(br.resolution_fee_revenue), 0) as total_resolution_fee_revenue,
          COALESCE((
            SELECT SUM(ba.cumulative_pl)
            FROM branch_agents ba
            WHERE ba.is_active = true
          ), 0) as total_agent_payouts
        FROM branch_revenue br
        WHERE br.created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'branches', (
      SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.total_revenue DESC), '[]'::jsonb)
      FROM (
        SELECT
          br_agg.branch_id,
          bch.name as branch_name,
          bch.branch_code as branch_code,
          bch.status as branch_status,
          br_agg.markup_revenue,
          br_agg.explicit_fee_revenue,
          br_agg.exit_fee_revenue,
          br_agg.resolution_fee_revenue,
          br_agg.total_revenue,
          COALESCE(agent_agg.agent_payouts, 0) as agent_payouts,
          br_agg.total_revenue - COALESCE(agent_agg.agent_payouts, 0) as net_to_platform,
          COALESCE(agent_agg.agent_count, 0) as agent_count
        FROM (
          SELECT
            br.branch_id,
            SUM(br.markup_revenue) as markup_revenue,
            SUM(br.explicit_fee_revenue) as explicit_fee_revenue,
            SUM(br.exit_fee_revenue) as exit_fee_revenue,
            SUM(br.resolution_fee_revenue) as resolution_fee_revenue,
            SUM(br.total_revenue) as total_revenue
          FROM branch_revenue br
          WHERE br.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY br.branch_id
        ) br_agg
        JOIN branches bch ON bch.id = br_agg.branch_id
        LEFT JOIN (
          SELECT
            ba.branch_id,
            SUM(ba.cumulative_pl) as agent_payouts,
            COUNT(*) as agent_count
          FROM branch_agents ba
          WHERE ba.is_active = true
          GROUP BY ba.branch_id
        ) agent_agg ON agent_agg.branch_id = br_agg.branch_id
      ) b
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. get_accounting_commissions — Commission breakdown
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_accounting_commissions(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'by_status', (
      SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      FROM (
        SELECT
          status,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY status
      ) s
    ),
    'by_level', (
      SELECT COALESCE(jsonb_agg(row_to_json(l)), '[]'::jsonb)
      FROM (
        SELECT
          agent_level_at_time as level,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY agent_level_at_time
        ORDER BY agent_level_at_time
      ) l
    ),
    'by_revenue_type', (
      SELECT COALESCE(jsonb_agg(row_to_json(rt)), '[]'::jsonb)
      FROM (
        SELECT
          revenue_type,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY revenue_type
      ) rt
    ),
    'top_earners', (
      SELECT COALESCE(jsonb_agg(row_to_json(te)), '[]'::jsonb)
      FROM (
        SELECT
          rc.referrer_id,
          u.display_name,
          u.phone,
          u.agent_level,
          SUM(rc.commission_amount) FILTER (WHERE rc.layer = 1) as layer_1,
          SUM(rc.commission_amount) FILTER (WHERE rc.layer = 2) as layer_2,
          SUM(rc.commission_amount) as total
        FROM referral_commissions rc
        JOIN users u ON u.id = rc.referrer_id
        WHERE rc.status = 'credited' AND rc.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY rc.referrer_id, u.display_name, u.phone, u.agent_level
        ORDER BY total DESC
        LIMIT 50
      ) te
    )
  );
END;
$$;
