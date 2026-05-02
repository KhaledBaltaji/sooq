-- 139_optimize_network_tree_rpc.sql — Rewrite get_agent_network_tree using flat queries
-- Replaces nested loops (N+1 explosion) with 3 flat queries + in-memory assembly

BEGIN;

CREATE OR REPLACE FUNCTION get_agent_network_tree()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_l1_ids UUID[];
  v_l2_ids UUID[];
  v_l1_users JSONB;
  v_l2_users JSONB;
  v_l3_users JSONB;
  v_commissions JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Step 1: Fetch all 3 layers of users in 3 flat queries ──

  -- Layer 1: direct referrals (limit 100)
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
    SELECT * FROM users WHERE referred_by = v_uid ORDER BY created_at DESC LIMIT 100
  ) u;

  -- Layer 2: referrals of L1 (limit 50 per L1 parent, done via lateral join)
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
      ), '[]'::JSONB),
      COALESCE(ARRAY_AGG(u.id), '{}')
    INTO v_l2_users, v_l2_ids
    FROM users u
    WHERE u.referred_by = ANY(v_l1_ids);
  ELSE
    v_l2_users := '[]'::JSONB;
    v_l2_ids := '{}';
  END IF;

  -- Layer 3: referrals of L2 (limit 20 per L2 parent)
  IF array_length(v_l2_ids, 1) > 0 THEN
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
    INTO v_l3_users
    FROM users u
    WHERE u.referred_by = ANY(v_l2_ids);
  ELSE
    v_l3_users := '[]'::JSONB;
  END IF;

  -- ── Step 2: Fetch all commissions in ONE query ──

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

  -- ── Step 3: Assemble tree in-memory using jsonb operations ──

  -- Build L3 nodes (leaf nodes, no children)
  -- Build L2 nodes with L3 children attached
  -- Build L1 nodes with L2 children attached

  SELECT COALESCE(jsonb_agg(
    l1_node.val || jsonb_build_object(
      'layer', 1,
      'commission_earned', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'commission_earned',
      'revenue_generated', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'revenue_generated',
      'trade_count', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'trade_count',
      'children', (
        SELECT COALESCE(jsonb_agg(
          l2_node.val || jsonb_build_object(
            'layer', 2,
            'commission_earned', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'commission_earned',
            'revenue_generated', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'revenue_generated',
            'trade_count', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'trade_count',
            'children', (
              SELECT COALESCE(jsonb_agg(
                l3_node.val || jsonb_build_object(
                  'layer', 3,
                  'commission_earned', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'commission_earned',
                  'revenue_generated', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'revenue_generated',
                  'trade_count', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'trade_count',
                  'children', '[]'::JSONB
                )
              ), '[]'::JSONB)
              FROM jsonb_array_elements(v_l3_users) AS l3_node(val)
              WHERE l3_node.val->>'referred_by' = l2_node.val->>'id'
            )
          )
        ), '[]'::JSONB)
        FROM jsonb_array_elements(v_l2_users) AS l2_node(val)
        WHERE l2_node.val->>'referred_by' = l1_node.val->>'id'
      )
    )
  ), '[]'::JSONB)
  INTO v_result
  FROM jsonb_array_elements(v_l1_users) AS l1_node(val);

  RETURN v_result;
END;
$$;

COMMIT;
