-- Migration 153: Platform stats helper function for admin stats dashboard
-- Returns daily aggregates + previous period for trend calculation

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
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'cash_out')), 0) as volume,
               COUNT(*) FILTER (WHERE type IN ('trade', 'cash_out')) as trades,
               COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposits,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as withdrawals,
               COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'cash_out', 'bet')) as active_users
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
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'cash_out')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'cash_out')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'cash_out', 'bet')) as unique_traders
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t)
      FROM (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as total_deposits,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as total_withdrawals,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'cash_out')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'cash_out')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'cash_out', 'bet')) as unique_traders
        FROM transactions
        WHERE created_at BETWEEN
          p_start_date - (p_end_date - p_start_date)
          AND p_start_date
      ) t
    )
  );
END;
$$;
