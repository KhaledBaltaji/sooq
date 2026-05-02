-- 199_flat_network_rpc.sql — Replace nested JSONB tree assembly with flat queries
-- The old get_agent_network_tree used O(n²) jsonb_array_elements scans to build a nested tree.
-- This replaces it with get_agent_network_flat: 2 flat user queries + 1 commission query.
-- Tree assembly moves to the client (O(n) via Map lookups).
-- Also drops L3 (commission model is 2 layers since migration 198).

BEGIN;

-- ============================================================
-- 1. New RPC: get_agent_network_flat — flat data, no tree assembly
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_network_flat()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_l1_users JSONB;
  v_l1_ids UUID[];
  v_l2_users JSONB;
  v_commissions JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Layer 1: direct referrals (limit 200)
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'display_name', COALESCE(
          split_part(u.display_name, ' ', 1) || ' ' ||
          LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
          u.phone
        ),
        'agent_level', u.agent_level,
        'referral_count', u.direct_referral_count,
        'referred_by', u.referred_by
      ) ORDER BY u.created_at DESC
    ), '[]'::JSONB),
    COALESCE(ARRAY_AGG(u.id), '{}')
  INTO v_l1_users, v_l1_ids
  FROM (
    SELECT * FROM users WHERE referred_by = v_uid ORDER BY created_at DESC LIMIT 200
  ) u;

  -- Layer 2: referrals of L1
  IF array_length(v_l1_ids, 1) > 0 THEN
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'display_name', COALESCE(
            split_part(u.display_name, ' ', 1) || ' ' ||
            LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
            u.phone
          ),
          'agent_level', u.agent_level,
          'referral_count', u.direct_referral_count,
          'referred_by', u.referred_by
        )
      ), '[]'::JSONB)
    INTO v_l2_users
    FROM users u
    WHERE u.referred_by = ANY(v_l1_ids);
  ELSE
    v_l2_users := '[]'::JSONB;
  END IF;

  -- Commissions: one grouped query for all bettors
  SELECT COALESCE(jsonb_object_agg(
    rc.bettor_id::TEXT,
    jsonb_build_object(
      'commission_earned', rc.total_commission,
      'revenue_generated', rc.total_revenue,
      'trade_count', rc.cnt
    )
  ), '{}'::JSONB)
  INTO v_commissions
  FROM (
    SELECT
      bettor_id,
      SUM(commission_amount) AS total_commission,
      SUM(platform_revenue_amount) AS total_revenue,
      COUNT(*) AS cnt
    FROM referral_commissions
    WHERE referrer_id = v_uid AND status = 'credited'
    GROUP BY bettor_id
  ) rc;

  RETURN jsonb_build_object(
    'l1_users', v_l1_users,
    'l2_users', v_l2_users,
    'commissions', v_commissions
  );
END;
$$;


-- ============================================================
-- 2. Update get_agent_stats: count only 2 layers for network_size
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user RECORD;
  v_total_credited DECIMAL := 0;
  v_total_pending DECIMAL := 0;
  v_total_escrowed DECIMAL := 0;
  v_this_month DECIMAL := 0;
  v_network_size INTEGER := 0;
  v_next_tier_volume DECIMAL := 0;
  v_tier1_ids UUID[];
  v_activation_threshold INTEGER := 5;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_uid;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Commission totals (single query)
  SELECT
    COALESCE(SUM(CASE WHEN status = 'credited' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'escrowed' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'credited'
      AND created_at >= date_trunc('month', now()) THEN commission_amount ELSE 0 END), 0)
  INTO v_total_credited, v_total_escrowed, v_this_month
  FROM referral_commissions
  WHERE referrer_id = v_uid;

  -- Network size: 2 layers only (L3 removed — commission model is 2 layers)
  SELECT ARRAY_AGG(id) INTO v_tier1_ids
  FROM users WHERE referred_by = v_uid;

  IF v_tier1_ids IS NOT NULL THEN
    v_network_size := array_length(v_tier1_ids, 1);

    v_network_size := v_network_size + (
      SELECT COUNT(*)::INTEGER FROM users WHERE referred_by = ANY(v_tier1_ids)
    );
  END IF;

  -- Next tier volume
  v_next_tier_volume := CASE
    WHEN v_user.agent_level >= 4 THEN 0
    WHEN v_user.agent_level = 3 THEN 200000 - v_user.network_volume
    WHEN v_user.agent_level = 2 THEN 50000 - v_user.network_volume
    ELSE 10000 - v_user.network_volume
  END;
  IF v_next_tier_volume < 0 THEN v_next_tier_volume := 0; END IF;

  RETURN jsonb_build_object(
    'total_credited', v_total_credited,
    'total_pending', v_total_escrowed,
    'total_escrowed', v_total_escrowed,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume,
    'agent_balance_usd', v_user.agent_balance_usd,
    'agent_activated', (v_user.agent_activated OR v_user.agent_activation_override),
    'qualified_referral_count', v_user.qualified_referral_count,
    'activation_threshold', v_activation_threshold
  );
END;
$$;

COMMIT;
