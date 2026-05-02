-- ============================================================================
-- 360_speed_admin_overview_monitoring.sql
--
-- Adds operational monitoring metrics to speed_admin_overview() so ops can
-- see at a glance whether the new pricing layers (mig 352-359) are healthy.
--
-- New metrics:
--   - rv_cache_freshness_seconds: how stale the realized-vol cache is right
--     now. Should stay below 90s (the freshness threshold). Above that means
--     the speed_rv_refresh() pg_cron job stalled and trades fall back to
--     static IV=0.6 (still safe, just less accurate).
--   - rv_cache_status: "fresh" | "stale" | "missing" — convenience flag for
--     dashboards.
--   - late_window_trades_today: count of trades placed in the last 30s of a
--     market window today. Surcharge engaging = users discovered late betting.
--     If 0% of total trades are late-window, surcharge isn't being exercised.
--     If >10%, it's doing real work.
--   - late_window_revenue_today: estimated extra revenue from surcharge, in $.
--   - kill_switches: status of each (master, RV, surcharge).
--
-- Caught nothing — these are defensive monitoring, not bug catches.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.speed_admin_overview()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
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

  -- Mig 360 monitoring fields
  v_rv_computed_at         TIMESTAMPTZ;
  v_rv_freshness_seconds   INTEGER;
  v_rv_cache_status        TEXT;
  v_late_window_trades     INTEGER;
  v_late_window_stake      DECIMAL;
  v_late_window_revenue    DECIMAL;
  v_use_realized_vol       DECIMAL;
  v_late_window_threshold  DECIMAL;
  v_late_window_surcharge  DECIMAL;
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
    COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0),
    COALESCE(SUM(amount), 0)
  INTO v_today_revenue, v_today_gross_stake
  FROM speed_trades
  WHERE kind = 'open'
    AND created_at >= date_trunc('day', NOW());

  SELECT COALESCE(-SUM(amount) FILTER (WHERE type IN ('winning_payout', 'cashout_out', 'refund')), 0)
  INTO v_today_payouts
  FROM speed_pool_ledger
  WHERE created_at >= date_trunc('day', NOW());

  SELECT COUNT(*) INTO v_open_markets FROM speed_markets WHERE status = 'open';
  SELECT COUNT(*) INTO v_open_positions FROM speed_positions WHERE status = 'open';

  -- ── Mig 360: RV cache freshness ────────────────────────────────────────
  SELECT computed_at INTO v_rv_computed_at
  FROM speed_realized_vol_cache WHERE asset = 'BTC' LIMIT 1;

  IF v_rv_computed_at IS NULL THEN
    v_rv_freshness_seconds := NULL;
    v_rv_cache_status := 'missing';
  ELSE
    v_rv_freshness_seconds := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_rv_computed_at)))::INTEGER;
    v_rv_cache_status := CASE
      WHEN v_rv_freshness_seconds < 90 THEN 'fresh'
      WHEN v_rv_freshness_seconds < 300 THEN 'stale'
      ELSE 'very_stale'
    END;
  END IF;

  -- ── Mig 360: late-window surcharge metrics ─────────────────────────────
  -- Count trades placed in the last 30s of any market today.
  SELECT
    COUNT(*),
    COALESCE(SUM(t.amount), 0),
    COALESCE(SUM(t.amount * 0.075), 0) -- 15% surcharge / 2 (offered_prob compression)
  INTO v_late_window_trades, v_late_window_stake, v_late_window_revenue
  FROM speed_trades t
  JOIN speed_markets m ON m.id = t.market_id
  WHERE t.kind = 'open'
    AND t.created_at >= date_trunc('day', NOW())
    AND (m.closes_at - t.created_at) < INTERVAL '30 seconds';

  -- ── Mig 360: kill switch states ────────────────────────────────────────
  SELECT rate INTO v_use_realized_vol
  FROM fee_config WHERE fee_type = 'speed_use_realized_vol' LIMIT 1;
  SELECT rate INTO v_late_window_threshold
  FROM fee_config WHERE fee_type = 'speed_late_window_threshold' LIMIT 1;
  SELECT rate INTO v_late_window_surcharge
  FROM fee_config WHERE fee_type = 'speed_late_window_surcharge' LIMIT 1;

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
    -- Mig 360: monitoring fields
    'monitoring', jsonb_build_object(
      'rv_cache', jsonb_build_object(
        'status', v_rv_cache_status,
        'freshness_seconds', v_rv_freshness_seconds,
        'computed_at', v_rv_computed_at,
        'threshold_seconds', 90
      ),
      'late_window_today', jsonb_build_object(
        'trade_count', v_late_window_trades,
        'gross_stake', v_late_window_stake,
        'estimated_extra_revenue', ROUND(v_late_window_revenue, 2),
        'pct_of_total_trades', CASE
          WHEN v_today_gross_stake > 0
          THEN ROUND((v_late_window_stake / v_today_gross_stake * 100)::numeric, 2)
          ELSE 0
        END
      ),
      'kill_switches', jsonb_build_object(
        'master_enabled', COALESCE(v_master_enabled, 0) = 1,
        'realized_vol_active', COALESCE(v_use_realized_vol, 1) = 1,
        'late_window_threshold_seconds', COALESCE(v_late_window_threshold, 30),
        'late_window_surcharge_active', COALESCE(v_late_window_surcharge, 0) > 0,
        'late_window_surcharge_value', COALESCE(v_late_window_surcharge, 0)
      )
    ),
    'snapshot_at', NOW()
  );
END;
$$;

COMMENT ON FUNCTION public.speed_admin_overview() IS
'Mig 360: speed-market admin dashboard payload. Adds monitoring section: rv_cache freshness, late_window_today metrics, kill_switches state. Used by /admin/speed-overview to surface operational health.';
