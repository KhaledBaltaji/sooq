-- ============================================================================
-- 331_speed_admin_overview_rpc.sql
--
-- Read-only aggregations for the admin operations dashboard.
--
-- Three RPCs:
--   speed_admin_overview()     — top-level snapshot: master kill state,
--                                per-asset open exposure, per-branch
--                                pool balances, today's revenue/loss totals.
--   speed_branch_summary(b)    — single-branch view used by the branch
--                                operator dashboard: three trackers
--                                (User Book P/L, Fee Revenue, Collateral)
--                                + recent activity counts.
--   speed_market_exposure(m)   — per-market drill-down for the ops table.
--
-- All admin-only via implicit role check (the calling page already verifies
-- is_admin and checks RLS — these RPCs SELECT from speed_* tables which
-- have admin-only RLS for non-public tables).
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id        UUID;
  v_master_enabled  DECIMAL;
  v_per_asset       JSONB;
  v_per_branch      JSONB;
  v_per_duration    JSONB;
  v_main_pool       DECIMAL;
  v_today_revenue   DECIMAL;
  v_today_payouts   DECIMAL;
  v_open_markets    INTEGER;
  v_open_positions  INTEGER;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;

  SELECT jsonb_agg(jsonb_build_object(
    'asset', t.asset,
    'open_position_count', t.open_position_count,
    'open_over_stake', t.open_over_stake,
    'open_under_stake', t.open_under_stake,
    'net_stake', t.net_stake
  )) INTO v_per_asset
  FROM (
    SELECT
      m.asset,
      COUNT(p.id) AS open_position_count,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS open_over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS open_under_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0)
        - COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS net_stake
    FROM speed_markets m
    LEFT JOIN speed_positions p ON p.market_id = m.id AND p.status = 'open'
    WHERE m.status = 'open'
    GROUP BY m.asset
  ) t;

  SELECT jsonb_agg(jsonb_build_object(
    'branch_id', sb.branch_id,
    'branch_name', b.name,
    'branch_code', b.branch_code,
    'speed_status', sb.speed_status,
    'pool_balance', sb.speed_pool_balance,
    'fee_share_pct', sb.fee_share_pct
  ) ORDER BY sb.speed_pool_balance DESC) INTO v_per_branch
  FROM speed_branches sb
  JOIN branches b ON b.id = sb.branch_id;

  SELECT jsonb_agg(jsonb_build_object(
    'duration', t.duration,
    'open_markets', t.open_markets,
    'open_position_count', t.open_position_count,
    'open_over_stake', t.open_over_stake,
    'open_under_stake', t.open_under_stake
  )) INTO v_per_duration
  FROM (
    SELECT
      m.duration,
      COUNT(DISTINCT m.id) AS open_markets,
      COUNT(p.id) AS open_position_count,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS open_over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS open_under_stake
    FROM speed_markets m
    LEFT JOIN speed_positions p ON p.market_id = m.id AND p.status = 'open'
    WHERE m.status = 'open'
    GROUP BY m.duration
  ) t;

  SELECT COALESCE(SUM(amount), 0) INTO v_main_pool
  FROM speed_pool_ledger
  WHERE branch_id IS NULL;

  SELECT
    COALESCE(SUM(amount) FILTER (WHERE type = 'fee_share_in'), 0),
    COALESCE(-SUM(amount) FILTER (WHERE type IN ('winning_payout', 'cashout_out', 'refund')), 0)
  INTO v_today_revenue, v_today_payouts
  FROM speed_pool_ledger
  WHERE created_at >= date_trunc('day', NOW());

  SELECT COUNT(*) INTO v_open_markets FROM speed_markets WHERE status = 'open';
  SELECT COUNT(*) INTO v_open_positions FROM speed_positions WHERE status = 'open';

  RETURN jsonb_build_object(
    'master_enabled', COALESCE(v_master_enabled, 0) = 1,
    'per_asset', COALESCE(v_per_asset, '[]'::jsonb),
    'per_branch', COALESCE(v_per_branch, '[]'::jsonb),
    'per_duration', COALESCE(v_per_duration, '[]'::jsonb),
    'main_pool_balance', v_main_pool,
    'today_revenue', v_today_revenue,
    'today_payouts', v_today_payouts,
    'open_markets', v_open_markets,
    'open_positions', v_open_positions,
    'snapshot_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_overview() IS
'Admin-only overview snapshot for /admin/speed operations dashboard. Aggregates per-asset, per-branch, per-duration exposure + today revenue/payouts.';


CREATE OR REPLACE FUNCTION speed_branch_summary(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id      UUID;
  v_branch         RECORD;
  v_speed          RECORD;
  v_user_pl        DECIMAL;
  v_fee_revenue    DECIMAL;
  v_collateral     DECIMAL;
  v_open_count     INTEGER;
  v_today_volume   DECIMAL;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Branch operator OR admin can read
  IF v_branch.manager_user_id <> v_caller_id
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_caller_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_speed FROM speed_branches WHERE branch_id = p_branch_id;
  IF v_speed IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', FALSE,
      'branch_id', p_branch_id
    );
  END IF;

  -- Three trackers — computed live from ledger, not cached.
  -- User Book P/L: stake_in (winning_payout + cashout_out + refund)
  SELECT COALESCE(SUM(amount), 0) INTO v_user_pl
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type IN ('stake_in', 'winning_payout', 'cashout_out', 'refund');

  -- Fee Revenue: sum of fee_share_in
  SELECT COALESCE(SUM(amount), 0) INTO v_fee_revenue
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type = 'fee_share_in';

  -- Collateral: collateral_credit + collateral_withdraw
  SELECT COALESCE(SUM(amount), 0) INTO v_collateral
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type IN ('collateral_credit', 'collateral_withdraw');

  SELECT COUNT(*) INTO v_open_count
  FROM speed_positions
  WHERE branch_id = p_branch_id AND status = 'open';

  SELECT COALESCE(SUM(stake), 0) INTO v_today_volume
  FROM speed_positions
  WHERE branch_id = p_branch_id
    AND created_at >= date_trunc('day', NOW());

  RETURN jsonb_build_object(
    'enabled', TRUE,
    'branch_id', p_branch_id,
    'speed_status', v_speed.speed_status,
    'pool_balance', v_speed.speed_pool_balance,
    'fee_share_pct', v_speed.fee_share_pct,
    'stake_min', v_speed.stake_min,
    'stake_max', v_speed.stake_max,
    'stake_caps_per_side', v_speed.stake_caps_per_side,
    'trackers', jsonb_build_object(
      'user_book_pl', v_user_pl,
      'fee_revenue', v_fee_revenue,
      'collateral', v_collateral
    ),
    'open_position_count', v_open_count,
    'today_volume', v_today_volume,
    'snapshot_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION speed_branch_summary(UUID) IS
'Branch operator + admin dashboard data: three trackers (User Book P/L, Fee Revenue, Collateral) + pool params + open count + daily volume.';


CREATE OR REPLACE FUNCTION speed_market_exposure(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id   UUID;
  v_market     RECORD;
  v_breakdown  JSONB;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'branch_id', t.branch_id,
    'branch_name', t.branch_name,
    'over_stake', t.over_stake,
    'under_stake', t.under_stake,
    'position_count', t.position_count
  )) INTO v_breakdown
  FROM (
    SELECT
      p.branch_id,
      COALESCE(b.name, 'SOOQ Main') AS branch_name,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS under_stake,
      COUNT(p.id) AS position_count
    FROM speed_positions p
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.market_id = p_market_id AND p.status = 'open'
    GROUP BY p.branch_id, b.name
  ) t;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'asset', v_market.asset,
    'duration', v_market.duration,
    'strike_price', v_market.strike_price,
    'closes_at', v_market.closes_at,
    'status', v_market.status,
    'breakdown', COALESCE(v_breakdown, '[]'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION speed_market_exposure(UUID) IS
'Admin-only per-market drill-down: per-branch over/under exposure for a single open market.';
