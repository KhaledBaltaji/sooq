-- 242_admin_roles.sql — Lightweight admin RBAC: super admins vs sub-admins with per-page views
-- NULL or empty array = super admin (sees everything)
-- Non-empty array = sub-admin restricted to listed views

-- 1. Add column
ALTER TABLE users ADD COLUMN admin_allowed_views TEXT[];

-- 2. Protect the new column from direct mutation by regular users
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
  OR NEW.admin_allowed_views IS DISTINCT FROM OLD.admin_allowed_views
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

-- 3. RPC: super admin sets another user's admin role
CREATE OR REPLACE FUNCTION admin_set_admin_role(
  p_user_id UUID,
  p_is_admin BOOLEAN,
  p_allowed_views TEXT[] DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID;
  v_caller RECORD;
  v_target RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be a super admin (is_admin + no view restrictions)
  SELECT * INTO v_caller FROM users WHERE id = v_caller_id;
  IF NOT FOUND OR NOT v_caller.is_admin THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_caller.admin_allowed_views IS NOT NULL AND array_length(v_caller.admin_allowed_views, 1) > 0 THEN
    RAISE EXCEPTION 'Only super admins can manage admin roles';
  END IF;

  -- Cannot modify own role
  IF p_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot modify your own admin role';
  END IF;

  -- Target user must exist
  SELECT * INTO v_target FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Bypass protected columns trigger
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_is_admin THEN
    UPDATE users SET
      is_admin = TRUE,
      admin_allowed_views = p_allowed_views,
      updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE users SET
      is_admin = FALSE,
      admin_allowed_views = NULL,
      updated_at = NOW()
    WHERE id = p_user_id;
  END IF;

  -- Log the action
  PERFORM log_system_event(
    'warn'::log_severity,
    'admin/role_change',
    jsonb_build_object(
      'caller_id', v_caller_id,
      'target_id', p_user_id,
      'is_admin', p_is_admin,
      'allowed_views', p_allowed_views
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_admin', p_is_admin,
    'admin_allowed_views', p_allowed_views
  );
END;
$$;
