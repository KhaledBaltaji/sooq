-- 301_strip_support_and_telegram.sql — Remove ticket system, Telegram bot, AI agent.
--
-- Replaced in the app by a static "Contact Support" WhatsApp deep link
-- (NEXT_PUBLIC_SUPPORT_WHATSAPP). The Help Center (help_collections,
-- help_articles) is preserved — only the ticket / chat / Telegram paths go.
--
-- Sequence:
--   1. Remove verify_support_code RPC (mig 265 — references the support
--      ticket + verification-codes tables).
--   2. Replace get_admin_sidebar_counts (mig 257) with a slimmer body that
--      no longer reads the support ticket table. Keeps the contract for
--      pending_deposits / pending_withdrawals / pending_finance.
--   3. Detach tables from the realtime publication (idempotent guard so
--      the migration re-runs cleanly on a fresh staging DB where the
--      publication may not include them).
--   4. Remove the four tables themselves with CASCADE so any leftover
--      foreign keys, triggers, RLS policies, indexes, or grants tied to
--      them get cleaned up in the same statement. All four use IF EXISTS
--      so the migration is idempotent.
--
-- Rollback strategy: none. The plan is to rebuild the support system later
-- as a separate effort. If a rollback is ever needed, restore from the
-- pre-301 schema snapshot in supabase/schema.sql under git history.

-- ── 1. verify_support_code RPC ────────────────────────────────────────────
DROP FUNCTION IF EXISTS verify_support_code(uuid, uuid, text);

-- ── 2. get_admin_sidebar_counts: drop support keys from returned JSONB ────
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
BEGIN
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

  RETURN jsonb_build_object(
    'pending_deposits', v_pending_deposits,
    'pending_withdrawals', v_pending_withdrawals,
    'pending_finance', v_pending_deposits + v_pending_withdrawals
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_admin_sidebar_counts() TO authenticated;

COMMENT ON FUNCTION get_admin_sidebar_counts() IS
  'Returns pending counts for admin sidebar badges. Admin-only. Called from the admin shell on mount and on Realtime events for deposits/withdrawals. (Migration 301: dropped support_tickets keys when ticket system was removed.)';

-- ── 3. Detach the soon-to-be-removed tables from supabase_realtime ───────
-- Wrap in DO blocks so a missing publication entry doesn't abort the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'support_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE support_messages; -- IF EXISTS guarded above
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'support_tickets'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE support_tickets; -- IF EXISTS guarded above
  END IF;
END $$;

-- ── 4. Remove the four tables (CASCADE handles FK fan-out) ───────────────
DROP TABLE IF EXISTS support_messages CASCADE;
DROP TABLE IF EXISTS support_verification_codes CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS telegram_users CASCADE;
