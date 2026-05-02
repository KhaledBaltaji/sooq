-- 033_fn_handle_referral_signup.sql — Populate referral_chain and direct_referral_count
-- Fires AFTER UPDATE on users when referred_by changes from NULL to non-NULL.

CREATE OR REPLACE FUNCTION handle_referral_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_chain UUID[];
  v_new_chain UUID[];
BEGIN
  -- Only fire when referred_by transitions from NULL to a value
  IF OLD.referred_by IS NOT NULL OR NEW.referred_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Set bypass flag so the protect_sensitive_columns trigger allows our updates
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  -- Read the referrer's referral_chain
  SELECT referral_chain INTO v_referrer_chain
  FROM users WHERE id = NEW.referred_by;

  -- Build new user's chain: [direct referrer, then up to 2 from referrer's chain], max 3
  v_new_chain := ARRAY[NEW.referred_by];
  IF v_referrer_chain IS NOT NULL AND array_length(v_referrer_chain, 1) > 0 THEN
    v_new_chain := v_new_chain || v_referrer_chain[1:LEAST(array_length(v_referrer_chain, 1), 2)];
  END IF;

  -- Update the new user's referral_chain
  UPDATE users SET referral_chain = v_new_chain WHERE id = NEW.id;

  -- Increment the referrer's direct_referral_count
  UPDATE users SET direct_referral_count = direct_referral_count + 1
  WHERE id = NEW.referred_by;

  -- Recalculate the referrer's agent level
  PERFORM update_agent_level(NEW.referred_by);

  -- Reset bypass flag to prevent any subsequent operations in this transaction
  -- from bypassing the sensitive column protection
  PERFORM set_config('app.trigger_bypass', 'false', TRUE);

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_referral_signup
  AFTER UPDATE ON users
  FOR EACH ROW
  WHEN (OLD.referred_by IS NULL AND NEW.referred_by IS NOT NULL)
  EXECUTE FUNCTION handle_referral_signup();
