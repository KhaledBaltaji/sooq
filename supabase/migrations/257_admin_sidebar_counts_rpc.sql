-- 257_admin_sidebar_counts_rpc.sql — get_admin_sidebar_counts() for admin nav badges
--
-- Returns pending counts across support, deposits, withdrawals so the admin
-- sidebar can show red-dot badges without the admin having to open each page.
-- Single round-trip; single SECURITY DEFINER function keyed on is_admin.
--
-- Consumers: src/hooks/use-admin-sidebar-counts.ts (new), AdminSidebar.

CREATE OR REPLACE FUNCTION get_admin_sidebar_counts()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_pending_deposits INTEGER;
  v_pending_withdrawals INTEGER;
  v_open_support_tickets INTEGER;
  v_needs_human_tickets INTEGER;
BEGIN
  -- Gate: only admins. Pattern matches existing RLS checks elsewhere.
  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM users
  WHERE id = auth.uid();

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_pending_deposits
  FROM deposits
  WHERE status IN ('pending', 'pending_review');

  SELECT COUNT(*) INTO v_pending_withdrawals
  FROM withdrawals
  WHERE status = 'pending';

  SELECT COUNT(*) INTO v_open_support_tickets
  FROM support_tickets
  WHERE status = 'open';

  SELECT COUNT(*) INTO v_needs_human_tickets
  FROM support_tickets
  WHERE status = 'open' AND needs_human = true;

  RETURN jsonb_build_object(
    'pending_deposits', v_pending_deposits,
    'pending_withdrawals', v_pending_withdrawals,
    'pending_finance', v_pending_deposits + v_pending_withdrawals,
    'open_support_tickets', v_open_support_tickets,
    'needs_human_tickets', v_needs_human_tickets
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_sidebar_counts() TO authenticated;

COMMENT ON FUNCTION get_admin_sidebar_counts() IS
  'Returns pending/open counts for admin sidebar badges. Admin-only. Called from the admin shell on mount and on Realtime events for deposits/withdrawals/support_tickets.';
