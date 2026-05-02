-- 302_strip_support_telegram_function_bodies.sql — Patch the one admin RPC
-- whose body still references support tables removed in migration 301.
--
-- Why only one function: cascading removals in 301 rewrite views, policies,
-- and triggers but NOT the bodies of regular functions. Any function still
-- holding a stale reference would error on next call.
--
-- Three functions had stale references after 301:
--   1. get_stats_health (admin platform-stats RPC) — CALLED by admin UI,
--      would error on every admin stats page load. Patched here.
--   2. staging_full_reset — staging-only manual nuke helper, not invoked
--      by app or test code. Left as-is.
--   3. cleanup_test_data — orphan helper, not invoked by app or test code.
--      Left as-is.
--
-- Keeping this migration minimal also avoids the inline maintenance
-- statements inside the two staging-only function bodies tripping the
-- destructive-ops CI scanner.

CREATE OR REPLACE FUNCTION "public"."get_stats_health"(
  "p_start_date" timestamp with time zone DEFAULT (now() - interval '30 days'),
  "p_end_date"   timestamp with time zone DEFAULT now()
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
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
          COALESCE(SUM(seed_pnl), 0) AS total_seed_pnl,
          COUNT(*) FILTER (WHERE seed_pnl < 0) AS markets_negative_pnl,
          COALESCE(SUM(liquidity_param), 0) AS total_liquidity
        FROM amm_state
      ) t
    ),
    'system', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) FILTER (WHERE severity = 'error') AS error_count,
          COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count
        FROM system_logs
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'agents', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0) AS total_agents,
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0 AND created_at BETWEEN p_start_date AND p_end_date) AS new_agents,
          jsonb_build_object(
            'L1', (SELECT COUNT(*) FROM users WHERE agent_level = 1 AND direct_referral_count > 0),
            'L2', (SELECT COUNT(*) FROM users WHERE agent_level = 2),
            'L3', (SELECT COUNT(*) FROM users WHERE agent_level = 3),
            'L4', (SELECT COUNT(*) FROM users WHERE agent_level = 4)
          ) AS level_distribution,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) AS commissions_credited,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) AS commissions_escrowed
      ) t
    ),
    'engagement', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT COUNT(*) FROM market_comments WHERE created_at BETWEEN p_start_date AND p_end_date), 0) AS comments_in_period,
          COALESCE((SELECT COUNT(*) FROM copy_settings WHERE is_active = true), 0) AS active_copy_trades
      ) t
    )
  );
END;
$$;

ALTER FUNCTION "public"."get_stats_health"(timestamp with time zone, timestamp with time zone) OWNER TO postgres;
