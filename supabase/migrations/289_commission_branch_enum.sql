-- ============================================================
-- 289: Commission Branch — Phase 1: ENUM value
--
-- Adds 'commission' to branch_book_type alongside 'reseller' and 'bookmaker'.
--
-- A commission branch is a branded wrapper around an agent's referral network:
--   - no pool / no solvency / no pricing overrides
--   - users trade retail; commissions flow through the existing
--     referral_chain via pay_trade_commissions
--   - branch owner gets /b/[branch_code]/* URL + /branch/dashboard subset
--   - sub-agents via branch_agents table (commission type only, zero deposit)
--
-- Design doc: docs/designs/commission-branch.md
-- Plan: /Users/khaledbaltaji/.claude/plans/wtf-ru-doing-dont-recursive-thompson.md
--
-- Phase 1 (this file) ships the enum value ONLY, inert at launch:
--   - No RPC accepts 'commission' as book_type yet.
--   - No CHECK constraints reference the new value yet.
--   - _protect_branch_book_type trigger (created in mig 291) makes book_type
--     immutable after insert, so Phase 2's CHECK constraints can't be
--     bypassed by mutating book_type post-create.
--
-- Phase 2 (mig 293) adds:
--   - users.signup_branch_id column (FK with ON DELETE RESTRICT)
--   - branches_commission_no_capital CHECK
--   - branches_commission_no_payback CHECK
--   - branches_commission_slug_format CHECK (3-20 lowercase alphanum+hyphen)
--   - _reserved_slugs() helper + trigger
--   - branch_agents trigger (commission type + zero deposit enforcement)
--   - admin_create_branch RPC extension (p_book_type, p_slug)
--   - branch_dashboard_stats RPC extension (book_type dispatch)
--
-- IDEMPOTENCY + ORDERING:
-- Supabase applies migrations in filename order. On STAGING, mig 280 already
-- created `branch_book_type` with values ('reseller', 'bookmaker'); this
-- migration's ALTER TYPE adds 'commission' successfully.
--
-- On fresh PROD, mig 280 was never applied (reverted upstream), and mig 291
-- (which recreates the foundation) hasn't run yet when 289 fires because
-- 289 < 291 by filename. Without a guard, ALTER TYPE would fail because
-- the enum doesn't exist.
--
-- Fix: a DO block with EXCEPTION WHEN duplicate_object creates the enum
-- with all three values if it doesn't exist. If it exists (staging), the
-- CREATE throws duplicate_object and is silently caught. The follow-up
-- ALTER TYPE ADD VALUE IF NOT EXISTS is then a no-op (value already present
-- from the CREATE) or adds the value cleanly (if enum had only two values).
--
-- Note: ALTER TYPE ... ADD VALUE cannot be used inside a transaction that
-- references the new value, so this migration is unwrapped (no BEGIN/COMMIT).
-- The DO block runs as its own sub-transaction and does not reference the
-- 'commission' value from within, so it's safe.
-- ============================================================

DO $$ BEGIN
  -- Creates the enum on fresh prod (where mig 280 was reverted and 291
  -- hasn't run yet). No-op on staging where the enum already exists from
  -- mig 280, or on any DB where 291 or an earlier invocation of this
  -- migration already created it.
  CREATE TYPE branch_book_type AS ENUM ('reseller', 'bookmaker', 'commission');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Guarantees 'commission' exists on the enum whether we just created it
-- with three values, or the enum pre-existed with only two. Idempotent on
-- re-runs (IF NOT EXISTS).
ALTER TYPE branch_book_type ADD VALUE IF NOT EXISTS 'commission';
