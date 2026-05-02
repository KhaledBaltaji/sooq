-- ============================================================================
-- 367_w6_auth_guc.sql
--
-- W6 — Auth.js + Postgres GUC pattern.
--
-- Why: post-AWS migration we leave Supabase Auth behind. Each Next.js API
-- route runs `SELECT set_config('app.user_id', $userId, true)` on its
-- pg/Drizzle connection (the second arg `true` makes the setting
-- transaction-local — auto-clears on commit). RPCs that previously called
-- `auth.uid()` switch to `app.user_id()`.
--
-- This migration creates the helper. A subsequent migration sed-replaces
-- `auth.uid()` with `app.user_id()` across all surviving RPC bodies.
-- ============================================================================

set check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION app.user_id() IS
  'Returns the current request user_id from the app.user_id GUC. ' ||
  'Set by the application layer per-connection via set_config. ' ||
  'Replaces Supabase auth.uid() post-W6.';

-- Permit anyone to call it (it just reads a session-local GUC).
GRANT USAGE ON SCHEMA app TO PUBLIC;
GRANT EXECUTE ON FUNCTION app.user_id() TO PUBLIC;
