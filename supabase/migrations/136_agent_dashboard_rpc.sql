-- 128_agent_dashboard_rpc.sql — Agent dashboard RPCs for NGR model
-- Three RPCs: get_agent_stats, get_agent_network_tree, get_agent_commission_feed

BEGIN;

-- ============================================================
-- Indexes for dashboard queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_rc_referrer_created
  ON referral_commissions(referrer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rc_referrer_bettor
  ON referral_commissions(referrer_id, bettor_id);

CREATE INDEX IF NOT EXISTS idx_users_referred_by
  ON users(referred_by);


-- ============================================================
-- 1. get_agent_stats — Overview numbers for the agent dashboard
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
  v_this_month DECIMAL := 0;
  v_network_size INTEGER := 0;
  v_next_tier_volume DECIMAL := 0;
  v_tier1_ids UUID[];
  v_tier2_ids UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_uid;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Commission totals
  SELECT
    COALESCE(SUM(CASE WHEN status = 'credited' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'escrowed' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'credited'
      AND created_at >= date_trunc('month', now()) THEN commission_amount ELSE 0 END), 0)
  INTO v_total_credited, v_total_pending, v_this_month
  FROM referral_commissions
  WHERE referrer_id = v_uid;

  -- Network size: count all 3 layers
  SELECT ARRAY_AGG(id) INTO v_tier1_ids
  FROM users WHERE referred_by = v_uid;

  IF v_tier1_ids IS NOT NULL THEN
    v_network_size := array_length(v_tier1_ids, 1);

    SELECT ARRAY_AGG(id) INTO v_tier2_ids
    FROM users WHERE referred_by = ANY(v_tier1_ids);

    IF v_tier2_ids IS NOT NULL THEN
      v_network_size := v_network_size + array_length(v_tier2_ids, 1);

      v_network_size := v_network_size + (
        SELECT COUNT(*)::INTEGER FROM users WHERE referred_by = ANY(v_tier2_ids)
      );
    END IF;
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
    'total_pending', v_total_pending,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume
  );
END;
$$;


-- ============================================================
-- 2. get_agent_network_tree — 3-level referral tree with revenue
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_network_tree()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_node RECORD;
  v_child RECORD;
  v_grandchild RECORD;
  v_children JSONB;
  v_grandchildren JSONB;
  v_comm RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Build tree: Layer 1 (direct referrals)
  FOR v_node IN
    SELECT u.id, u.display_name, u.phone, u.agent_level,
           u.direct_referral_count, u.network_volume
    FROM users u
    WHERE u.referred_by = v_uid
    ORDER BY u.created_at DESC
    LIMIT 100
  LOOP
    -- Aggregate commissions this agent earned from this node
    SELECT COALESCE(SUM(commission_amount), 0) AS commission_earned,
           COALESCE(SUM(platform_revenue_amount), 0) AS revenue_generated,
           COUNT(*) AS trade_count
    INTO v_comm
    FROM referral_commissions
    WHERE referrer_id = v_uid AND bettor_id = v_node.id AND status = 'credited';

    -- Layer 2 children of this node
    v_children := '[]'::JSONB;
    FOR v_child IN
      SELECT u.id, u.display_name, u.phone, u.agent_level,
             u.direct_referral_count, u.network_volume
      FROM users u
      WHERE u.referred_by = v_node.id
      ORDER BY u.created_at DESC
      LIMIT 50
    LOOP
      SELECT COALESCE(SUM(commission_amount), 0) AS commission_earned,
             COALESCE(SUM(platform_revenue_amount), 0) AS revenue_generated,
             COUNT(*) AS trade_count
      INTO v_comm
      FROM referral_commissions
      WHERE referrer_id = v_uid AND bettor_id = v_child.id AND status = 'credited';

      -- Layer 3 grandchildren
      v_grandchildren := '[]'::JSONB;
      FOR v_grandchild IN
        SELECT u.id, u.display_name, u.phone, u.agent_level,
               u.direct_referral_count, u.network_volume
        FROM users u
        WHERE u.referred_by = v_child.id
        ORDER BY u.created_at DESC
        LIMIT 20
      LOOP
        DECLARE
          v_gc_comm RECORD;
        BEGIN
          SELECT COALESCE(SUM(commission_amount), 0) AS commission_earned,
                 COALESCE(SUM(platform_revenue_amount), 0) AS revenue_generated,
                 COUNT(*) AS trade_count
          INTO v_gc_comm
          FROM referral_commissions
          WHERE referrer_id = v_uid AND bettor_id = v_grandchild.id AND status = 'credited';

          v_grandchildren := v_grandchildren || jsonb_build_object(
            'id', v_grandchild.id,
            'display_name', COALESCE(
              split_part(v_grandchild.display_name, ' ', 1) || ' ' ||
              LEFT(split_part(v_grandchild.display_name, ' ', 2), 1) || '.',
              v_grandchild.phone
            ),
            'layer', 3,
            'agent_level', v_grandchild.agent_level,
            'referral_count', v_grandchild.direct_referral_count,
            'commission_earned', v_gc_comm.commission_earned,
            'revenue_generated', v_gc_comm.revenue_generated,
            'trade_count', v_gc_comm.trade_count,
            'children', '[]'::JSONB
          );
        END;
      END LOOP;

      v_children := v_children || jsonb_build_object(
        'id', v_child.id,
        'display_name', COALESCE(
          split_part(v_child.display_name, ' ', 1) || ' ' ||
          LEFT(split_part(v_child.display_name, ' ', 2), 1) || '.',
          v_child.phone
        ),
        'layer', 2,
        'agent_level', v_child.agent_level,
        'referral_count', v_child.direct_referral_count,
        'commission_earned', v_comm.commission_earned,
        'revenue_generated', v_comm.revenue_generated,
        'trade_count', v_comm.trade_count,
        'children', v_grandchildren
      );
    END LOOP;

    -- Re-read L1 commission (v_comm was overwritten in L2 loop)
    SELECT COALESCE(SUM(commission_amount), 0) AS commission_earned,
           COALESCE(SUM(platform_revenue_amount), 0) AS revenue_generated,
           COUNT(*) AS trade_count
    INTO v_comm
    FROM referral_commissions
    WHERE referrer_id = v_uid AND bettor_id = v_node.id AND status = 'credited';

    v_result := v_result || jsonb_build_object(
      'id', v_node.id,
      'display_name', COALESCE(
        split_part(v_node.display_name, ' ', 1) || ' ' ||
        LEFT(split_part(v_node.display_name, ' ', 2), 1) || '.',
        v_node.phone
      ),
      'layer', 1,
      'agent_level', v_node.agent_level,
      'referral_count', v_node.direct_referral_count,
      'commission_earned', v_comm.commission_earned,
      'revenue_generated', v_comm.revenue_generated,
      'trade_count', v_comm.trade_count,
      'children', v_children
    );
  END LOOP;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 3. get_agent_commission_feed — Paginated commission activity
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_commission_feed(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_layer_filter INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_row IN
    SELECT
      rc.id,
      COALESCE(
        split_part(u.display_name, ' ', 1) || ' ' ||
        LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
        u.phone
      ) AS bettor_name,
      m.question_en AS market_question,
      t.side AS trade_side,
      t.total_cost AS trade_amount,
      rc.platform_revenue_amount AS platform_revenue,
      rc.commission_amount,
      rc.layer,
      rc.revenue_type,
      rc.created_at
    FROM referral_commissions rc
    JOIN users u ON u.id = rc.bettor_id
    JOIN markets m ON m.id = rc.market_id
    LEFT JOIN trades t ON t.id = rc.trade_id
    WHERE rc.referrer_id = v_uid
      AND rc.status = 'credited'
      AND (p_layer_filter IS NULL OR rc.layer = p_layer_filter)
    ORDER BY rc.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  LOOP
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'bettor_name', v_row.bettor_name,
      'market_question', v_row.market_question,
      'trade_side', v_row.trade_side,
      'trade_amount', v_row.trade_amount,
      'platform_revenue', v_row.platform_revenue,
      'commission_amount', v_row.commission_amount,
      'layer', v_row.layer,
      'revenue_type', v_row.revenue_type,
      'created_at', v_row.created_at
    );
  END LOOP;

  RETURN v_result;
END;
$$;

COMMIT;
