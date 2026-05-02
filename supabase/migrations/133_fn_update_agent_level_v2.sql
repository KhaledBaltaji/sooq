-- 125b_fn_update_agent_level_v2.sql — Volume-based tier advancement
-- Replaces signup-count thresholds (migration 116) with network volume thresholds.
-- Tier 1: $0, Tier 2: $10K, Tier 3: $50K, Tier 4: $200K cumulative network volume.
-- Ratchet: level only goes up, never down.
-- Note: pay_trade_commissions() also does inline tier checks for real-time advancement.
-- This function is still called by handle_referral_signup trigger for initial level check.

CREATE OR REPLACE FUNCTION update_agent_level(p_user_id UUID)
RETURNS INTEGER  -- new level
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_new_level INTEGER;
BEGIN
  -- Auth check: allow service_role, admins, and internal trigger calls
  IF auth.uid() IS NOT NULL
    AND current_setting('app.trigger_bypass', TRUE) IS DISTINCT FROM 'true'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  THEN
    RAISE EXCEPTION 'update_agent_level: unauthorized — admin or service_role only';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Volume-based thresholds (replaces direct_referral_count thresholds)
  v_new_level := CASE
    WHEN v_user.network_volume >= 200000 THEN 4  -- Tier 4: $200K+
    WHEN v_user.network_volume >= 50000  THEN 3  -- Tier 3: $50K+
    WHEN v_user.network_volume >= 10000  THEN 2  -- Tier 2: $10K+
    ELSE 1                                        -- Tier 1: default
  END;

  -- Ratchet: only go up
  IF v_new_level > v_user.agent_level THEN
    UPDATE users SET agent_level = v_new_level WHERE id = p_user_id;
  END IF;

  RETURN GREATEST(v_new_level, v_user.agent_level);
END;
$$;
