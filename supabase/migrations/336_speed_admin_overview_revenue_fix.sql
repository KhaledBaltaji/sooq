-- ============================================================================
-- 336_speed_admin_overview_revenue_fix.sql
--
-- Workstream N — fix /admin/speed "Today Revenue: $0.00" widget.
--
-- Problem: mig 331's speed_admin_overview computed today_revenue from
-- speed_pool_ledger filtered to type='fee_share_in'. That ledger entry is
-- only written when a RESELLER branch routes the trade. For retail flows
-- (every speed trade today on staging — branch_id IS NULL on speed_positions),
-- the fee_share_in row is never written, so the widget showed $0 even though
-- the platform earned 1% handle fee + ~2% spread on every trade.
--
-- Fix: compute today_revenue directly from speed_trades, summing the two
-- revenue components per trade:
--   - handle_fee (already stored as a column — literal $ taken from stake)
--   - spread_revenue = amount × (offered_prob - fair_prob)
--     (the platform's expected edge from pricing the side above its fair prob)
--
-- speed_trades stores amount, fair_prob, offered_prob, and handle_fee per
-- row, so this is a pure-read computation — no schema changes, no new
-- INSERT path. Works for retail AND reseller flows uniformly.
--
-- Also adds today_gross_stake to the output for richer dashboards
-- (effective edge % = today_revenue / today_gross_stake).
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_overview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id          UUID;
  v_master_enabled    DECIMAL;
  v_per_asset         JSONB;
  v_per_branch        JSONB;
  v_per_duration      JSONB;
  v_main_pool         DECIMAL;
  v_today_revenue     DECIMAL;
  v_today_payouts     DECIMAL;
  v_today_gross_stake DECIMAL;
  v_open_markets      INTEGER;
  v_open_positions    INTEGER;
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

  -- Main pool: SOOQ's slice (branch_id IS NULL on the ledger)
  SELECT COALESCE(SUM(amount), 0) INTO v_main_pool
  FROM speed_pool_ledger
  WHERE branch_id IS NULL;

  -- Today's revenue: handle_fee + spread component, per-trade, summed.
  -- This captures retail AND reseller flows uniformly — both write speed_trades
  -- rows with the same shape. (Previous query filtered to fee_share_in which
  -- only fired for reseller branches, missing all retail revenue.)
  SELECT
    COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0),
    COALESCE(SUM(amount), 0)
  INTO v_today_revenue, v_today_gross_stake
  FROM speed_trades
  WHERE kind = 'open'
    AND created_at >= date_trunc('day', NOW());

  -- Today's payouts: from the pool ledger (already correct in prior version)
  SELECT COALESCE(-SUM(amount) FILTER (WHERE type IN ('winning_payout', 'cashout_out', 'refund')), 0)
  INTO v_today_payouts
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
    'today_gross_stake', v_today_gross_stake,
    'today_effective_edge_pct', CASE
      WHEN v_today_gross_stake > 0 THEN ROUND((v_today_revenue / v_today_gross_stake * 100)::numeric, 2)
      ELSE 0
    END,
    'open_markets', v_open_markets,
    'open_positions', v_open_positions,
    'snapshot_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION speed_admin_overview() IS
'Admin-only overview for /admin/speed. today_revenue = handle_fee + (stake × (offered - fair)) per trade, summed. Captures retail + reseller flows uniformly.';
