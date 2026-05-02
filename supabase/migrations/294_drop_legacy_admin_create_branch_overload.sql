-- ============================================================
-- 294: Commission Branch — Phase 2 hotfix: drop legacy admin_create_branch overload
--
-- Context: mig 293 added a new 6-argument version of admin_create_branch
-- (with p_book_type TEXT DEFAULT 'reseller' as the new trailing arg). Since
-- Postgres treats functions with different parameter lists as distinct
-- overloads, the old 5-arg version from mig 217 remained in place alongside
-- the new 6-arg version.
--
-- PostgREST rejects calls that could match multiple overloads with:
--   PGRST203: Could not choose the best candidate function between
--   public.admin_create_branch(p_name, p_code, p_manager_user_id, p_config, p_pin),
--   public.admin_create_branch(p_name, p_code, p_manager_user_id, p_config, p_pin, p_book_type)
--
-- Fix: drop the legacy 5-arg overload. The 6-arg version handles all existing
-- callers because p_book_type defaults to 'reseller' (preserving mig 217's
-- behavior for unchanged callers).
--
-- Caught by src/tests/db/branch-lifecycle.test.ts on the pre-push hook after
-- mig 293 was applied to staging.
-- ============================================================

BEGIN;

DROP FUNCTION IF EXISTS admin_create_branch(
  p_name TEXT,
  p_code TEXT,
  p_manager_user_id UUID,
  p_config JSONB,
  p_pin TEXT
);

COMMIT;
