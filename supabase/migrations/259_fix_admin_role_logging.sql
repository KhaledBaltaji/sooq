-- 259_fix_admin_role_logging.sql — Fix admin_set_admin_role log_system_event call
--
-- Migration 242 called log_system_event with only 3 positional args where the
-- 3rd was JSONB. The actual signature (migration 137) is:
--   log_system_event(p_severity log_severity, p_source TEXT, p_message TEXT, p_context JSONB)
-- Postgres could not resolve the overload and raised:
--   "function log_system_event(log_severity, unknown, jsonb) does not exist"
-- This aborted the whole RPC, so super admins could not change admin roles on prod.
--
-- Fix: insert a TEXT message between p_source and the JSONB context. Function body
-- is otherwise byte-identical to migration 242.

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

  -- Log the action (TEXT message + JSONB context — 4 args, matching log_system_event signature)
  PERFORM log_system_event(
    'warn'::log_severity,
    'admin/role_change',
    'Admin role changed',
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
