-- 116_v3_fn_update_agent_level.sql — V3 agent level thresholds
-- Tier 1: 0-9 refs, Tier 2: 10-49, Tier 3: 50-199, Tier 4: 200+
-- Ratchet: level only goes up.

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

  -- V3 thresholds (updated from V2: was 50→4, 25→3)
  v_new_level := CASE
    WHEN v_user.direct_referral_count >= 200 THEN 4  -- Tier 4
    WHEN v_user.direct_referral_count >= 50  THEN 3  -- Tier 3
    WHEN v_user.direct_referral_count >= 10  THEN 2  -- Tier 2
    ELSE 1                                            -- Tier 1
  END;

  -- Ratchet: only go up
  IF v_new_level > v_user.agent_level THEN
    UPDATE users SET agent_level = v_new_level WHERE id = p_user_id;
  END IF;

  RETURN GREATEST(v_new_level, v_user.agent_level);
END;
$$;
