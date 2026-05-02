-- 249_drop_old_lock_void_overloads.sql — Drop legacy 1-arg signatures
--
-- Migration 247 added `p_pin TEXT DEFAULT NULL` to lock_market and void_market
-- via CREATE OR REPLACE. Because PostgreSQL treats different signatures as
-- different functions, the OLD 1-arg versions still exist alongside the new
-- 2-arg versions. PostgREST then raises:
--   "Could not choose the best candidate function between:
--      void_market(p_market_id), void_market(p_market_id, p_pin)"
-- when callers pass only p_market_id.
--
-- This migration drops the legacy signatures so PostgREST and SQL callers
-- always resolve to the PIN-protected version.
--
-- Note: 1-arg callers will now fail at runtime with "Admin PIN required" —
-- exactly the desired behavior. The frontend was already updated to send PIN.

BEGIN;

DROP FUNCTION IF EXISTS public.lock_market(UUID);
DROP FUNCTION IF EXISTS public.void_market(UUID);

COMMIT;
