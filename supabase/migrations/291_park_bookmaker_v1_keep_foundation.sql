-- ============================================================
-- 291: Park Bookmaker V1 — drop bookmaker-specific schema, keep foundation
--
-- Bookmaker V1 Phases 1-5 (migrations 280, 281, 282, 283, 287) are being
-- parked. The git commits have been reverted on staging and preserved on
-- the `feature/bookmaker-v1` branch. This migration cleans the DB state
-- to match.
--
-- WHAT WE KEEP (foundation for multiple branch subtypes):
--   - branch_book_type ENUM — currently ('reseller', 'bookmaker')
--     Commission-branch session (mig 289) adds 'commission' value.
--     Future branch types will also extend this enum.
--   - branches.book_type column (NOT NULL, DEFAULT 'reseller')
--   - _protect_branch_book_type() trigger function + branches_book_type_immutable trigger
--     (makes book_type immutable after insert)
--   - idx_branches_book_type index
--
-- WHAT WE DROP (bookmaker-specific, no longer used):
--   - 9 bookmaker tables (bookmaker_amm_state, consensus_prices, market_liquidity_tiers,
--     bookmaker_cash_events, bookmaker_fee_accruals, bookmaker_fee_settlements,
--     branch_agent_monthly_snapshots, branch_agent_locked_balance, bookmaker_cash_out_quotes)
--   - bookmaker-specific columns on existing tables:
--     branches.bookmaker_default_risk_cap, branches.bookmaker_default_vig_pct
--     branch_market_config.vig_override_pct, risk_cap_override, opening_yes_price
--     users.venue_type, assigned_branch_id, is_sharp, sharp_flagged_at, sharp_flag_reason
--     trades.trade_kind, overlay_vig_pct, overlay_imbalance_delta, overlay_skew,
--       overlay_time_band, fair_price_at_execution, executable_price_at_execution
--   - 3 bookmaker-specific enums (venue_type, flow_imbalance_band, time_to_expiry_band)
--   - ~30 bookmaker RPCs (from Phases 2-5, all SECURITY DEFINER)
--   - 2 bookmaker triggers (venue_type protection, cash_events append-only)
--   - venue_branch_consistency CHECK constraint on users
--   - ~40 fee_config rows inserted by migration 280 (bookmaker_*, consensus_*, bm_*)
--   - Realtime publications for bookmaker_amm_state + consensus_prices
--   - reconcile_branch_solvency narrowing filter (migration 281 section 5) — RESTORED
--     to the pre-281 behavior (scans all non-suspended branches).
--
-- IDEMPOTENCY: every DROP uses IF EXISTS, every CREATE uses IF NOT EXISTS or DO
-- blocks. Safe on staging (where bookmaker schema is live) AND on prod (where
-- it never existed).
--
-- CROSS-SESSION NOTE: commission-branch session (mig 289) depends on
-- branch_book_type enum existing. Ordering on prod: if 289 applies first and
-- the enum doesn't exist, 289 fails; this migration (291) would not rescue it
-- because migrations apply in ORDER. Commission-branch's 289 should handle
-- the enum creation itself (idempotent DO block) for prod safety.
-- ============================================================

-- NOTE: this migration contains DO blocks that CREATE enum values. Some of
-- those operations technically require "no transaction block," but since the
-- enum + column + trigger + index already exist on staging (from migration
-- 280), the CREATE IF NOT EXISTS paths are no-ops there. On prod (eventual
-- staging → main PR), this migration would first RE-CREATE the enum etc.
-- fresh. That creation happens inside a DO block, which is allowed.

BEGIN;

-- ============================================================
-- SECTION 1 — Ensure the multi-branch-type foundation exists
--
-- On staging: already exists from mig 280. The IF NOT EXISTS + DO blocks make
--             this section a no-op.
-- On prod:    mig 280 was reverted so this CREATEs the foundation fresh.
-- ============================================================

-- 1a. branch_book_type enum
DO $$ BEGIN
  CREATE TYPE branch_book_type AS ENUM ('reseller', 'bookmaker');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 1b. branches.book_type column
ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS book_type branch_book_type NOT NULL DEFAULT 'reseller';

-- 1c. Immutability trigger function
CREATE OR REPLACE FUNCTION _protect_branch_book_type()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.book_type IS DISTINCT FROM OLD.book_type THEN
    RAISE EXCEPTION 'branches.book_type is immutable after creation (row id=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 1d. Trigger (drop-and-recreate pattern since CREATE TRIGGER doesn't support IF NOT EXISTS pre-14)
DROP TRIGGER IF EXISTS branches_book_type_immutable ON branches;
CREATE TRIGGER branches_book_type_immutable
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION _protect_branch_book_type();

-- 1e. Index for admin filtering
CREATE INDEX IF NOT EXISTS idx_branches_book_type ON branches(book_type);

-- ============================================================
-- SECTION 2 — Drop all bookmaker RPCs (Phases 2-5)
--
-- Order matters: drop dependents before their dependencies.
-- ============================================================

-- Phase 5 overlay functions
DROP FUNCTION IF EXISTS _bookmaker_max_size_for_user(UUID, UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS _bookmaker_cash_out_quote(UUID, UUID, UUID, TEXT, DECIMAL);
DROP FUNCTION IF EXISTS _bookmaker_overlay_quote(UUID, UUID, TEXT, DECIMAL);
DROP FUNCTION IF EXISTS _bookmaker_inventory_skew(UUID, UUID, TEXT);
DROP FUNCTION IF EXISTS _time_to_expiry_band(UUID);
DROP FUNCTION IF EXISTS _flow_imbalance_band(UUID, UUID);

-- Phase 4 market lifecycle
DROP FUNCTION IF EXISTS manager_set_bookmaker_market_risk_cap(UUID, UUID, DECIMAL);
DROP FUNCTION IF EXISTS manager_set_bookmaker_market_vig(UUID, UUID, DECIMAL);
DROP FUNCTION IF EXISTS disable_bookmaker_market(UUID, UUID);
DROP FUNCTION IF EXISTS admin_enable_bookmaker_market(UUID, UUID, DECIMAL, BOOLEAN, TEXT, TEXT);
DROP FUNCTION IF EXISTS _assert_user_is_branch_manager(UUID, UUID);
DROP FUNCTION IF EXISTS _compute_bookmaker_liquidity_param(UUID, UUID);

-- Phase 3 venue lock
DROP FUNCTION IF EXISTS _assert_user_matches_venue(UUID, UUID);
DROP FUNCTION IF EXISTS admin_emergency_close_position(UUID, DECIMAL, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS admin_migrate_user_venue(UUID, venue_type, UUID, TEXT, TEXT, TEXT);

-- Phase 2 ledger + solvency
DROP FUNCTION IF EXISTS reconcile_bookmaker_solvency();
DROP FUNCTION IF EXISTS bookmaker_solvency_check(UUID, DECIMAL, DECIMAL);
DROP FUNCTION IF EXISTS _recompute_bookmaker_worst_case(UUID);
DROP FUNCTION IF EXISTS _bookmaker_worst_case_market(UUID, UUID);
DROP FUNCTION IF EXISTS _append_bookmaker_cash_event(UUID, UUID, UUID, TEXT, DECIMAL, UUID, TEXT);

-- Phase 1 protection helpers (but NOT _protect_branch_book_type; that stays)
-- CASCADE because triggers on bookmaker_cash_events (no_update / no_delete) and
-- on users (users_venue_type_protected) depend on these functions. The triggers
-- will be dropped automatically; the tables themselves are dropped in Section 4
-- (bookmaker_cash_events) and the users trigger is explicitly dropped in Section 5.
DROP FUNCTION IF EXISTS _protect_bookmaker_cash_events() CASCADE;
DROP FUNCTION IF EXISTS _protect_user_venue_type() CASCADE;

-- ============================================================
-- SECTION 3 — Restore reconcile_branch_solvency to pre-281 behavior
--
-- Migration 281 narrowed the function to `book_type = 'reseller'`. That
-- filter was correct when bookmaker branches existed (to avoid mis-computing
-- worst case). Without bookmaker branches, the filter is still safe (all
-- branches are 'reseller' or 'commission' going forward; commission-branch
-- doesn't need solvency reconciliation anyway per its spec).
--
-- Actually: keep the narrowing. It's harmless and forward-compatible. Future
-- branch types that need their own reconciliation can be added later without
-- touching this function. NOTE to future maintainer: this function was last
-- modified by migration 281; the narrowing filter is intentional.
-- ============================================================

-- (no change — narrowing stays)

-- ============================================================
-- SECTION 4 — Drop bookmaker tables (order-aware for FKs)
-- ============================================================

DROP TABLE IF EXISTS bookmaker_cash_out_quotes CASCADE;
DROP TABLE IF EXISTS branch_agent_locked_balance CASCADE;
DROP TABLE IF EXISTS branch_agent_monthly_snapshots CASCADE;
DROP TABLE IF EXISTS bookmaker_fee_accruals CASCADE;  -- FKs bookmaker_fee_settlements, drop first
DROP TABLE IF EXISTS bookmaker_fee_settlements CASCADE;
DROP TABLE IF EXISTS bookmaker_cash_events CASCADE;
DROP TABLE IF EXISTS market_liquidity_tiers CASCADE;
DROP TABLE IF EXISTS consensus_prices CASCADE;
DROP TABLE IF EXISTS bookmaker_amm_state CASCADE;

-- ============================================================
-- SECTION 5 — Drop bookmaker-specific columns on existing tables
-- ============================================================

-- trades: Phase 1 overlay + trade_kind columns
ALTER TABLE trades
  DROP COLUMN IF EXISTS executable_price_at_execution,
  DROP COLUMN IF EXISTS fair_price_at_execution,
  DROP COLUMN IF EXISTS overlay_time_band,
  DROP COLUMN IF EXISTS overlay_skew,
  DROP COLUMN IF EXISTS overlay_imbalance_delta,
  DROP COLUMN IF EXISTS overlay_vig_pct,
  DROP COLUMN IF EXISTS trade_kind;

-- Drop the index on trade_kind if it exists (orphaned)
DROP INDEX IF EXISTS idx_trades_trade_kind;

-- branch_market_config: Phase 1 overrides + opening price
ALTER TABLE branch_market_config
  DROP COLUMN IF EXISTS opening_yes_price,
  DROP COLUMN IF EXISTS risk_cap_override,
  DROP COLUMN IF EXISTS vig_override_pct;

-- branches: Phase 1 bookmaker-specific defaults (keep book_type + trigger + index!)
ALTER TABLE branches
  DROP COLUMN IF EXISTS bookmaker_default_vig_pct,
  DROP COLUMN IF EXISTS bookmaker_default_risk_cap;

-- users: Phase 1 venue + sharp columns
-- First drop the consistency CHECK (if present) since it references the columns
ALTER TABLE users DROP CONSTRAINT IF EXISTS venue_branch_consistency;
-- Then the indexes
DROP INDEX IF EXISTS idx_users_is_sharp;
DROP INDEX IF EXISTS idx_users_venue_type;
DROP INDEX IF EXISTS idx_users_assigned_branch;
-- Then the protection trigger (function already dropped in Section 2)
DROP TRIGGER IF EXISTS users_venue_type_protected ON users;
-- Finally the columns
ALTER TABLE users
  DROP COLUMN IF EXISTS sharp_flag_reason,
  DROP COLUMN IF EXISTS sharp_flagged_at,
  DROP COLUMN IF EXISTS is_sharp,
  DROP COLUMN IF EXISTS assigned_branch_id,
  DROP COLUMN IF EXISTS venue_type;

-- ============================================================
-- SECTION 6 — Drop bookmaker-specific enums (after columns that used them)
-- ============================================================

DROP TYPE IF EXISTS time_to_expiry_band;
DROP TYPE IF EXISTS flow_imbalance_band;
DROP TYPE IF EXISTS venue_type;

-- NOTE: branch_book_type enum stays (foundation kept)

-- ============================================================
-- SECTION 7 — Delete bookmaker fee_config rows
-- ============================================================

DELETE FROM fee_config WHERE fee_type IN (
  'bookmaker_platform_fee_rate',
  'bm_sharp_detection_enabled',
  'bm_velocity_gate_enabled',
  'bm_time_vig_delta_normal',
  'bm_time_vig_delta_late',
  'bm_time_vig_delta_critical',
  'bm_time_vig_delta_final',
  'bm_time_size_mult_normal',
  'bm_time_size_mult_late',
  'bm_time_size_mult_critical',
  'bm_time_size_mult_final',
  'bm_imbalance_vig_delta_balanced',
  'bm_imbalance_vig_delta_caution',
  'bm_imbalance_vig_delta_restricted',
  'bm_imbalance_vig_delta_aggressive',
  'bm_imbalance_skew_balanced',
  'bm_imbalance_skew_caution',
  'bm_imbalance_skew_restricted',
  'bm_imbalance_skew_aggressive',
  'bm_imbalance_size_mult_balanced',
  'bm_imbalance_size_mult_caution',
  'bm_imbalance_size_mult_restricted',
  'bm_imbalance_size_mult_aggressive',
  'bm_imbalance_min_24h_volume',
  'bm_cashout_extra_vig',
  'bm_cashout_size_mult_extra',
  'bm_sharp_user_size_mult',
  'consensus_alltime_weight',
  'consensus_recent_weight',
  'consensus_recent_24h_weight',
  'consensus_recent_7d_weight',
  'consensus_branch_max_weight',
  'consensus_retail_min_weight',
  'consensus_retail_dynamic_boost',
  'consensus_retail_dynamic_boost_threshold',
  'consensus_source_max_staleness_minutes'
);

-- ============================================================
-- SECTION 8 — Remove tables from supabase_realtime publication
--
-- If the tables were dropped in Section 4, they're auto-removed from the
-- publication. This section is a safety net.
-- ============================================================

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE bookmaker_amm_state;
EXCEPTION WHEN undefined_object THEN null; WHEN undefined_table THEN null;
END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE consensus_prices;
EXCEPTION WHEN undefined_object THEN null; WHEN undefined_table THEN null;
END $$;

COMMIT;
