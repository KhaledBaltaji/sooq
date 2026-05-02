-- 032_fn_update_agent_level.sql — Recalculate agent level based on direct referral count
-- Called on new user signup via referral code. Ratchet: level only goes up.

CREATE OR REPLACE FUNCTION update_agent_level(p_user_id UUID)
RETURNS INTEGER  -- new level
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_new_level INTEGER;
BEGIN
  -- Auth check: allow service_role, admins, and internal trigger calls (via bypass flag)
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

  -- Calculate level based on direct referral count
  v_new_level := CASE
    WHEN v_user.direct_referral_count >= 50 THEN 4
    WHEN v_user.direct_referral_count >= 25 THEN 3
    WHEN v_user.direct_referral_count >= 10 THEN 2
    ELSE 1
  END;

  -- Ratchet: only go up
  IF v_new_level > v_user.agent_level THEN
    UPDATE users SET agent_level = v_new_level WHERE id = p_user_id;
  END IF;

  RETURN GREATEST(v_new_level, v_user.agent_level);
END;
$$;
