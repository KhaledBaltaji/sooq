-- 035_fn_toggle_user_freeze.sql — Admin toggles user freeze status
-- Needed because RLS restricts UPDATE to own row, and is_frozen is a protected column.

CREATE OR REPLACE FUNCTION toggle_user_freeze(p_user_id UUID, p_frozen BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE users SET is_frozen = p_frozen WHERE id = p_user_id;

  RETURN jsonb_build_object('success', TRUE, 'frozen', p_frozen);
END;
$$;
