-- 041_protect_sensitive_columns.sql — Prevent non-service_role from mutating sensitive user columns
-- NOTE: referred_by is NOT protected here because users set it once during referral signup
-- (NULL→value transition). The handle_referral_signup AFTER trigger (033) then populates
-- referral_chain, direct_referral_count, and agent_level via SECURITY DEFINER RPCs.
-- The WHEN clause on that trigger ensures referred_by can only transition NULL→non-NULL once.

CREATE OR REPLACE FUNCTION prevent_sensitive_user_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when called via service_role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions (they set a local flag)
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive columns for regular users
  -- NOTE: referred_by is intentionally NOT listed — users can set it once via referral signup
  IF NEW.balance_usd        IS DISTINCT FROM OLD.balance_usd
  OR NEW.is_admin           IS DISTINCT FROM OLD.is_admin
  OR NEW.is_frozen          IS DISTINCT FROM OLD.is_frozen
  OR NEW.agent_level        IS DISTINCT FROM OLD.agent_level
  OR NEW.direct_referral_count IS DISTINCT FROM OLD.direct_referral_count
  OR NEW.wagering_requirement  IS DISTINCT FROM OLD.wagering_requirement
  OR NEW.total_wagered      IS DISTINCT FROM OLD.total_wagered
  OR NEW.deposit_bonus_claimed IS DISTINCT FROM OLD.deposit_bonus_claimed
  OR NEW.referral_chain     IS DISTINCT FROM OLD.referral_chain
  OR NEW.referral_code      IS DISTINCT FROM OLD.referral_code
  THEN
    RAISE EXCEPTION 'Cannot modify protected columns';
  END IF;

  -- Extra guard: referred_by can only go from NULL to non-NULL (one-time set)
  IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Cannot modify referred_by after initial set';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_sensitive_user_columns
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION prevent_sensitive_user_updates();
