-- ============================================================
-- 224: Fix admin_branch_overview — replace VIEW with SECURITY DEFINER function
--
-- Migration 223 was applied as a VIEW, which bypasses RLS.
-- This drops the view and creates a SECURITY DEFINER function
-- with explicit admin auth checks instead.
-- ============================================================

-- Drop the insecure view
DROP VIEW IF EXISTS admin_branch_overview;

-- The function is already created by the rewritten 223 migration file.
-- This migration exists solely to drop the view from staging where
-- the original 223 was applied as a VIEW before the local rewrite.
--
-- For fresh databases (e.g., after db reset), 223 creates the function
-- directly and this migration is a harmless no-op (view doesn't exist).
