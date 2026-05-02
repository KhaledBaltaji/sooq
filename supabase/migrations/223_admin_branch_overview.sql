-- ============================================================
-- 223: Admin Branch Overview RPC
--
-- Returns one row per branch with computed stats for the admin list page.
-- Admin-only. Replaces a view approach (views bypass RLS in Postgres).
-- ============================================================

CREATE OR REPLACE FUNCTION admin_list_branches()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_agg(row_to_json(t)::jsonb) INTO v_result
  FROM (
    SELECT
      b.id,
      b.name,
      b.branch_code,
      b.status,
      b.pool_balance,
      b.worst_case_total,
      b.pending_payouts,
      b.yes_markup_pct,
      b.no_markup_pct,
      b.branch_fee_rate,
      b.display_mode,
      b.cash_out_enabled,
      b.payback_activated_at,
      b.created_at,
      b.updated_at,
      u.display_name AS manager_name,
      u.phone AS manager_phone,
      b.manager_user_id,
      (SELECT COUNT(*) FROM branch_user_assignments bua WHERE bua.branch_id = b.id) AS user_count,
      (SELECT COUNT(*) FROM branch_agents ba WHERE ba.branch_id = b.id AND ba.is_active = TRUE) AS active_agent_count,
      (SELECT COUNT(*) FROM branch_trades bt WHERE bt.branch_id = b.id) AS trade_count,
      (SELECT COALESCE(SUM(bt.gross_amount), 0) FROM branch_trades bt WHERE bt.branch_id = b.id) AS total_volume,
      (SELECT COALESCE(SUM(br.total_revenue), 0) FROM branch_revenue br WHERE br.branch_id = b.id) AS total_revenue,
      CASE
        WHEN b.pool_balance > 0 AND b.worst_case_total > 0
        THEN ROUND((b.worst_case_total / b.pool_balance) * 100, 1)
        ELSE 0
      END AS utilization_pct
    FROM branches b
    JOIN users u ON u.id = b.manager_user_id
    ORDER BY b.created_at DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;
