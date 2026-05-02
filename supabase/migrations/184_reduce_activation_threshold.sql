-- 184_reduce_activation_threshold.sql — Lower agent activation gate from 10 to 5 qualified referrals

-- Re-create pay_trade_commissions with threshold = 5
CREATE OR REPLACE FUNCTION pay_trade_commissions(
  p_trade_id UUID,
  p_user_id UUID,
  p_trade_amount DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade RECORD;
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
  v_new_level INTEGER;
  -- First-trade activation variables
  v_is_first_trade BOOLEAN;
  v_referrer_id UUID;
  v_new_qual_count INTEGER;
  v_referrer_activated BOOLEAN;
  v_referrer_override BOOLEAN;
BEGIN
  -- 1. Read trade record for fee columns
  SELECT explicit_fee, amm_spread_cost, cash_out_premium, market_id
  INTO v_trade
  FROM trades WHERE id = p_trade_id;

  IF v_trade IS NULL THEN
    RETURN 0;
  END IF;

  -- 2. Calculate total platform revenue from this trade
  v_platform_revenue := v_trade.explicit_fee + v_trade.amm_spread_cost + v_trade.cash_out_premium;

  IF v_platform_revenue <= 0 THEN
    RETURN 0;
  END IF;

  -- 3. First-trade detection: increment referrer's qualified_referral_count
  v_is_first_trade := NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = p_user_id AND id != p_trade_id
    LIMIT 1
  );

  IF v_is_first_trade THEN
    -- Get direct referrer
    SELECT referred_by INTO v_referrer_id FROM users WHERE id = p_user_id;

    IF v_referrer_id IS NOT NULL THEN
      UPDATE users
      SET qualified_referral_count = qualified_referral_count + 1
      WHERE id = v_referrer_id
      RETURNING qualified_referral_count, agent_activated, agent_activation_override
      INTO v_new_qual_count, v_referrer_activated, v_referrer_override;

      -- Check if referrer just hit the threshold (organic activation)
      IF NOT v_referrer_activated AND v_new_qual_count >= 5 THEN
        UPDATE users SET agent_activated = TRUE WHERE id = v_referrer_id;
        PERFORM _release_escrowed_commissions(v_referrer_id);
      END IF;
    END IF;
  END IF;

  -- 4. Read trader's referral chain
  SELECT referral_chain INTO v_chain
  FROM users WHERE id = p_user_id;

  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL OR array_length(v_chain, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- 5. Single-pass loop: volume + tier + commission for each ancestor
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 3) LOOP
    v_ancestor_id := v_chain[v_layer];

    IF v_ancestor_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id;
    IF v_ancestor IS NULL THEN
      CONTINUE;
    END IF;

    -- a. Update network volume
    UPDATE users SET network_volume = network_volume + p_trade_amount
    WHERE id = v_ancestor_id;

    -- b. Inline tier advancement check (ratchet: only goes up)
    v_new_level := CASE
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 200000 THEN 4
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 50000  THEN 3
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 10000  THEN 2
      ELSE 1
    END;

    IF v_new_level > v_ancestor.agent_level THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    -- c. Credit commission via shared helper (handles escrow/credit)
    v_commission := _credit_commission(
      v_ancestor_id, p_user_id, v_trade.market_id, p_trade_id,
      v_layer, v_ancestor.agent_level, v_platform_revenue,
      'ngr_commission', 'trade'
    );

    v_total_commissions := v_total_commissions + v_commission;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;


-- Re-create get_agent_stats with activation_threshold = 5
CREATE OR REPLACE FUNCTION get_agent_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user RECORD;
  v_total_credited DECIMAL := 0;
  v_total_escrowed DECIMAL := 0;
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
  INTO v_total_credited, v_total_escrowed, v_this_month
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
    'agent_balance_usd', v_user.agent_balance_usd,
    'total_credited', v_total_credited,
    'total_pending', v_total_escrowed,
    'total_escrowed', v_total_escrowed,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume,
    'agent_activated', (v_user.agent_activated OR v_user.agent_activation_override),
    'qualified_referral_count', v_user.qualified_referral_count,
    'activation_threshold', 5
  );
END;
$$;
