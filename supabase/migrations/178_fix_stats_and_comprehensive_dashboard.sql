-- ============================================================
-- 178: Fix get_platform_stats (cash_out → close_position) +
--      6 new comprehensive stats RPCs for admin dashboard
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- 1. FIX: get_platform_stats — replace 'cash_out' with 'close_position'
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_platform_stats(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'daily_volume', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', created_at)::date as date,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as volume,
               COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as trades,
               COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposits,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as withdrawals,
               COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as active_users
        FROM transactions
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY date_trunc('day', created_at)::date
        ORDER BY date
      ) d
    ),
    'totals', (
      SELECT row_to_json(t)
      FROM (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as total_deposits,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as total_withdrawals,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as unique_traders
        FROM transactions
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t)
      FROM (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as total_deposits,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as total_withdrawals,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as unique_traders
        FROM transactions
        WHERE created_at BETWEEN
          p_start_date - (p_end_date - p_start_date)
          AND p_start_date
      ) t
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 2. NEW: get_stats_users — User growth, activity, retention
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_users(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE created_at BETWEEN p_start_date AND p_end_date) as new_users,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN p_start_date AND p_end_date) as active_traders,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '1 day') as dau,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '7 days') as wau,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '30 days') as mau,
          ROUND(
            CASE WHEN (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date) = 0
            THEN 0
            ELSE (
              SELECT COUNT(DISTINCT t1.user_id)::numeric * 100 /
                     NULLIF((SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date), 0)
              FROM trades t1
              WHERE t1.created_at BETWEEN p_start_date AND p_end_date
                AND t1.user_id IN (SELECT DISTINCT user_id FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date)
            )
            END, 1
          ) as retention_rate
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users WHERE created_at BETWEEN v_prev_start AND p_start_date) as new_users,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date) as active_traders
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          gs::date as date,
          COALESCE((SELECT COUNT(*) FROM users WHERE created_at::date = gs::date), 0) as new_users,
          COALESCE((SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at::date = gs::date), 0) as active_users
        FROM generate_series(p_start_date::date, p_end_date::date, '1 day'::interval) gs
      ) d
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 3. NEW: get_stats_revenue — Revenue breakdown, commissions
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_revenue(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as net_revenue,
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN p_start_date AND p_end_date), 0) as resolution_fees,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as commissions_paid,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as escrowed_commissions,
          CASE WHEN COUNT(*) = 0 THEN 0
               ELSE ROUND(SUM(explicit_fee + amm_spread_cost + cash_out_premium) / COUNT(*), 2)
          END as revenue_per_trade
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as net_revenue
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          created_at::date as date,
          COALESCE(SUM(explicit_fee), 0) as explicit,
          COALESCE(SUM(amm_spread_cost), 0) as spread,
          COALESCE(SUM(cash_out_premium), 0) as cash_out,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium), 0) as total
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY created_at::date
        ORDER BY date
      ) d
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. NEW: get_stats_trading — Volume, trade breakdown, positions
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_trading(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trade_count,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(SUM(total_cost) / COUNT(*), 2) END as avg_trade_size,
          COUNT(*) FILTER (WHERE direction = 'buy') as buy_count,
          COUNT(*) FILTER (WHERE direction = 'sell') as sell_count,
          COALESCE(SUM(total_cost) FILTER (WHERE direction = 'buy'), 0) as buy_volume,
          COALESCE(SUM(total_cost) FILTER (WHERE direction = 'sell'), 0) as sell_volume,
          COUNT(DISTINCT user_id) as unique_traders,
          COALESCE((SELECT SUM(shares_held) FROM positions WHERE shares_held > 0), 0) as total_shares_outstanding,
          COUNT(*) FILTER (WHERE is_copy_trade = true) as copy_trade_count
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trade_count,
          COUNT(DISTINCT user_id) as unique_traders
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          created_at::date as date,
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trades,
          COUNT(*) FILTER (WHERE direction = 'buy') as buys,
          COUNT(*) FILTER (WHERE direction = 'sell') as sells
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY created_at::date
        ORDER BY date
      ) d
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. NEW: get_stats_markets — Market activity, categories, top markets
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_markets(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) as total_markets,
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'voided') as voided,
          COUNT(*) FILTER (WHERE created_at BETWEEN p_start_date AND p_end_date) as created_in_period,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(AVG(trade_count), 1) END as avg_trades_per_market,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(AVG(unique_traders), 1) END as avg_traders_per_market
        FROM markets
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) FILTER (WHERE created_at BETWEEN v_prev_start AND p_start_date) as created_in_period
        FROM markets
      ) t
    ),
    'top_markets', (
      SELECT COALESCE(jsonb_agg(row_to_json(tm)), '[]'::jsonb)
      FROM (
        SELECT m.id as market_id, m.question_en as question,
               a.total_volume as volume, a.total_trades as trades
        FROM markets m
        JOIN amm_state a ON a.market_id = m.id
        WHERE m.status IN ('open', 'closed', 'resolved')
        ORDER BY a.total_volume DESC
        LIMIT 5
      ) tm
    ),
    'categories', (
      SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(m.category, 'uncategorized') as category,
          COUNT(*) as count,
          COALESCE(SUM(a.total_volume), 0) as volume
        FROM markets m
        LEFT JOIN amm_state a ON a.market_id = m.id
        GROUP BY m.category
        ORDER BY volume DESC
      ) c
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. NEW: get_stats_finance — Deposits, withdrawals, net flow
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_finance(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as total_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as total_withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as net_flow,
          (SELECT COUNT(*) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date) as deposit_count,
          (SELECT COUNT(*) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date) as withdrawal_count,
          COALESCE((SELECT ROUND(AVG(amount), 2) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as avg_deposit,
          COALESCE((SELECT ROUND(AVG(amount), 2) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as avg_withdrawal,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'pending'), 0) as pending_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'pending'), 0) as pending_withdrawals,
          ROUND(
            CASE WHEN (SELECT COUNT(*) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date) = 0 THEN 0
            ELSE (
              SELECT COUNT(DISTINCT d.user_id)::numeric * 100 /
                     NULLIF((SELECT COUNT(DISTINCT user_id) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0)
              FROM deposits d
              WHERE d.status = 'confirmed' AND d.created_at BETWEEN p_start_date AND p_end_date
                AND d.user_id IN (SELECT DISTINCT user_id FROM trades WHERE created_at BETWEEN p_start_date AND p_end_date)
            )
            END, 1
          ) as deposit_to_trade_pct
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as total_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as total_withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN v_prev_start AND p_start_date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as net_flow
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          gs::date as date,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at::date = gs::date), 0) as deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at::date = gs::date), 0) as withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at::date = gs::date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at::date = gs::date), 0) as net_flow
        FROM generate_series(p_start_date::date, p_end_date::date, '1 day'::interval) gs
      ) d
    )
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. NEW: get_stats_health — AMM, system, support, agents, engagement
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION get_stats_health(
  p_start_date TIMESTAMPTZ DEFAULT now() - interval '30 days',
  p_end_date TIMESTAMPTZ DEFAULT now()
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'amm', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(seed_pnl), 0) as total_seed_pnl,
          COUNT(*) FILTER (WHERE seed_pnl < 0) as markets_negative_pnl,
          COALESCE(SUM(liquidity_param), 0) as total_liquidity
        FROM amm_state
      ) t
    ),
    'system', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) FILTER (WHERE severity = 'error') as error_count,
          COUNT(*) FILTER (WHERE severity = 'critical') as critical_count
        FROM system_logs
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'support', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT COUNT(*) FROM support_tickets WHERE status = 'open'), 0) as open_tickets,
          COALESCE((SELECT COUNT(*) FROM support_tickets WHERE status IN ('resolved', 'closed') AND updated_at BETWEEN p_start_date AND p_end_date), 0) as resolved_in_period
      ) t
    ),
    'agents', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0) as total_agents,
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0 AND created_at BETWEEN p_start_date AND p_end_date) as new_agents,
          jsonb_build_object(
            'L1', (SELECT COUNT(*) FROM users WHERE agent_level = 1 AND direct_referral_count > 0),
            'L2', (SELECT COUNT(*) FROM users WHERE agent_level = 2),
            'L3', (SELECT COUNT(*) FROM users WHERE agent_level = 3),
            'L4', (SELECT COUNT(*) FROM users WHERE agent_level = 4)
          ) as level_distribution,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as commissions_credited,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as commissions_escrowed
      ) t
    ),
    'engagement', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT COUNT(*) FROM market_comments WHERE created_at BETWEEN p_start_date AND p_end_date), 0) as comments_in_period,
          COALESCE((SELECT COUNT(*) FROM copy_settings WHERE is_active = true), 0) as active_copy_trades
      ) t
    )
  );
END;
$$;
