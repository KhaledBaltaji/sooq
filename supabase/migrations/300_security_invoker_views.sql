-- ============================================================
-- 300: Security advisor fix — security_invoker on legacy views
--
-- Supabase security linter flagged three views (ERROR-level
-- `security_definer_view`) that run with the view-owner's
-- permissions (postgres) instead of the caller's:
--   • retail_trades                (mig 208)
--   • retail_positions             (mig 208)
--   • branch_pending_liabilities   (mig 252)
--
-- Fix: flip each to security_invoker = true so direct client
-- queries go through the underlying table's RLS. Server-side
-- SECURITY DEFINER RPCs that query these views (record_revenue,
-- branch_settle_resolution, get_branch_owner_summary, etc.)
-- continue to run as postgres — their behavior is unchanged.
--
-- Why this is safe:
--   trades RLS              — public SELECT
--   positions RLS           — auth.uid() = user_id (own-only)
--   referral_commissions RLS — own-or-admin
-- All three RLS policies match the view's intent; nothing a
-- legitimate client needs to read becomes inaccessible.
-- ============================================================

ALTER VIEW public.retail_trades              SET (security_invoker = true);
ALTER VIEW public.retail_positions           SET (security_invoker = true);
ALTER VIEW public.branch_pending_liabilities SET (security_invoker = true);
