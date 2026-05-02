-- ============================================================
-- 222: Branch Dashboard Stats RPC
--
-- Returns aggregated stats for a branch in one round-trip.
-- Accessible by admin OR the branch's manager.
-- ============================================================

CREATE OR REPLACE FUNCTION branch_dashboard_stats(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_user_count INTEGER;
  v_active_agent_count INTEGER;
  v_trade_count INTEGER;
  v_total_volume DECIMAL;
  v_total_revenue DECIMAL;
  v_trades_last_24h INTEGER;
  v_total_markets INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify access: admin or branch manager
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF v_branch.manager_user_id != v_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Access denied: not admin or branch manager';
    END IF;
  END IF;

  -- User count
  SELECT COUNT(*) INTO v_user_count
  FROM branch_user_assignments WHERE branch_id = p_branch_id;

  -- Active agent count
  SELECT COUNT(*) INTO v_active_agent_count
  FROM branch_agents WHERE branch_id = p_branch_id AND is_active = TRUE;

  -- Trade count + volume from branch_trades
  SELECT COUNT(*), COALESCE(SUM(gross_amount), 0)
  INTO v_trade_count, v_total_volume
  FROM branch_trades WHERE branch_id = p_branch_id;

  -- Total revenue from branch_revenue
  SELECT COALESCE(SUM(total_revenue), 0) INTO v_total_revenue
  FROM branch_revenue WHERE branch_id = p_branch_id;

  -- Trades in last 24h
  SELECT COUNT(*) INTO v_trades_last_24h
  FROM branch_trades
  WHERE branch_id = p_branch_id AND created_at > NOW() - INTERVAL '24 hours';

  -- Active markets (enabled for this branch)
  SELECT COUNT(*) INTO v_total_markets
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND is_enabled = TRUE;

  RETURN jsonb_build_object(
    'user_count', v_user_count,
    'active_agent_count', v_active_agent_count,
    'trade_count', v_trade_count,
    'total_volume', ROUND(v_total_volume, 2),
    'total_revenue', ROUND(v_total_revenue, 2),
    'trades_last_24h', v_trades_last_24h,
    'active_markets', v_total_markets
  );
END;
$$;
