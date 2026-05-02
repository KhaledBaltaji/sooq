-- ============================================================================
-- 365_w3_strip_pass_2.sql
--
-- W3 strip pass 2 — Sooq rebuild plan (~/.claude/plans/oh-my-how-much-giggly-crystal.md)
--
-- Drops:
--   - General branch system: branches, branch_agents, branch_pools, branch_revenue,
--     branch_trades, branch_user_assignments, branch_market_config, branch_admin_overrides,
--     branch_pending_liabilities, agent_pending_microcredits, credit_chain_ledger
--   - Speed branch system: speed_branches, speed_pool_ledger (+ partitions)
--   - Commission system: referral_commissions, commission_clawback_deficit
--   - 60+ branch / commission / agent RPCs
--   - Branch/agent columns from `users`, `speed_positions`, `speed_trades`
--
-- NOT touched here (deferred to W4 cleanup phase):
--   - `speed_execute_trade`, `speed_execute_cashout`, `speed_resolve_market` retail-only
--     rewrites. After this migration applies, these RPCs reference dropped tables
--     and will ERROR on call until W4 replaces them.
--   - This matches the plan's documented "Speed broken mid-strip (W2 end → W3/W4 end)"
--     risk. Type-check still passes — function definitions exist as stale text in
--     old migrations, no compile-time refs in TS land.
--
-- Drops use IF EXISTS + CASCADE for idempotency. Functions are dropped first
-- (so their bodies don't block table drops on some configs) then tables, then columns.
-- ============================================================================

set check_function_bodies = off;

-- ============================================================================
-- SECTION 1 — Drop branch / commission / agent / reseller RPCs
-- ============================================================================

-- Internal helpers (prefix _)
DROP FUNCTION IF EXISTS public._branch_worst_case_market CASCADE;
DROP FUNCTION IF EXISTS public._credit_branch_commission CASCADE;
DROP FUNCTION IF EXISTS public._credit_branch_pl CASCADE;
DROP FUNCTION IF EXISTS public._credit_commission CASCADE;
DROP FUNCTION IF EXISTS public._credit_speed_commission CASCADE;
DROP FUNCTION IF EXISTS public._enforce_commission_branch_agent_rules CASCADE;
DROP FUNCTION IF EXISTS public._is_agent_activated CASCADE;
DROP FUNCTION IF EXISTS public._on_market_status_change_release_commissions CASCADE;
DROP FUNCTION IF EXISTS public._protect_branch_book_type CASCADE;
DROP FUNCTION IF EXISTS public._recompute_branch_worst_case CASCADE;
DROP FUNCTION IF EXISTS public._reject_reserved_branch_slug CASCADE;
DROP FUNCTION IF EXISTS public._release_escrowed_commissions CASCADE;
DROP FUNCTION IF EXISTS public._release_pending_commissions_for_market CASCADE;

-- Admin / management
DROP FUNCTION IF EXISTS public.admin_adjust_agent_balance CASCADE;
DROP FUNCTION IF EXISTS public.admin_adjust_branch_pool CASCADE;
DROP FUNCTION IF EXISTS public.admin_create_branch CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_branches CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_branch_status CASCADE;

-- Branch agent lifecycle
DROP FUNCTION IF EXISTS public.apply_branch_agent CASCADE;
DROP FUNCTION IF EXISTS public.approve_branch_agent CASCADE;
DROP FUNCTION IF EXISTS public.reject_branch_agent CASCADE;
DROP FUNCTION IF EXISTS public.update_branch_agent_deal CASCADE;
DROP FUNCTION IF EXISTS public.update_branch_config CASCADE;
DROP FUNCTION IF EXISTS public.is_branch_manager_of CASCADE;
DROP FUNCTION IF EXISTS public.preview_branch_agent_pl CASCADE;

-- Branch trading + ledger
DROP FUNCTION IF EXISTS public.execute_branch_trade CASCADE;
DROP FUNCTION IF EXISTS public.branch_credit_transfer CASCADE;
DROP FUNCTION IF EXISTS public.branch_settle_resolution CASCADE;
DROP FUNCTION IF EXISTS public.branch_solvency_check CASCADE;
DROP FUNCTION IF EXISTS public.branch_withdrawal CASCADE;
DROP FUNCTION IF EXISTS public.check_branch_velocity CASCADE;
DROP FUNCTION IF EXISTS public.record_branch_revenue CASCADE;

-- Dashboards / reads
DROP FUNCTION IF EXISTS public.branch_dashboard_stats CASCADE;
DROP FUNCTION IF EXISTS public.get_accounting_branches CASCADE;
DROP FUNCTION IF EXISTS public.get_accounting_commissions CASCADE;
DROP FUNCTION IF EXISTS public.get_branch_owner_summary CASCADE;
DROP FUNCTION IF EXISTS public.get_agent_commission_feed CASCADE;
DROP FUNCTION IF EXISTS public.get_agent_network_flat CASCADE;
DROP FUNCTION IF EXISTS public.get_agent_network_tree CASCADE;
DROP FUNCTION IF EXISTS public.get_agent_stats CASCADE;
DROP FUNCTION IF EXISTS public.get_agent_wallet_summary CASCADE;

-- Speed-side branch RPCs
DROP FUNCTION IF EXISTS public.speed_admin_enable_branch CASCADE;
DROP FUNCTION IF EXISTS public.speed_admin_freeze_branch CASCADE;
DROP FUNCTION IF EXISTS public.speed_admin_suspend_branch CASCADE;
DROP FUNCTION IF EXISTS public.speed_admin_unfreeze_branch CASCADE;
DROP FUNCTION IF EXISTS public.speed_admin_collateral_credit CASCADE;
DROP FUNCTION IF EXISTS public.speed_admin_collateral_withdraw CASCADE;
DROP FUNCTION IF EXISTS public.speed_branch_summary CASCADE;
DROP FUNCTION IF EXISTS public._speed_create_pool_partitions CASCADE;
DROP FUNCTION IF EXISTS public.prevent_speed_pool_ledger_mutation CASCADE;
DROP FUNCTION IF EXISTS public.prevent_branch_pools_mutation CASCADE;
DROP FUNCTION IF EXISTS public.prevent_sensitive_branch_updates CASCADE;

-- Commission walks
DROP FUNCTION IF EXISTS public.pay_speed_trade_commissions CASCADE;
DROP FUNCTION IF EXISTS public.pay_trade_commissions CASCADE;
DROP FUNCTION IF EXISTS public.settle_resolution_commissions CASCADE;

-- Agent state / level
DROP FUNCTION IF EXISTS public.handle_referral_signup CASCADE;
DROP FUNCTION IF EXISTS public.increment_referral_count CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_agent_balances CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_branch_solvency CASCADE;
DROP FUNCTION IF EXISTS public.sweep_agent_microcredits CASCADE;
DROP FUNCTION IF EXISTS public.toggle_agent_activation_override CASCADE;
DROP FUNCTION IF EXISTS public.transfer_agent_to_portfolio CASCADE;
DROP FUNCTION IF EXISTS public.update_agent_level CASCADE;

-- ============================================================================
-- SECTION 2 — Drop branch + commission tables (CASCADE removes FKs in survivors)
-- ============================================================================

-- Speed-side first (depends on branches)
DROP TABLE IF EXISTS public.speed_pool_ledger CASCADE;  -- partitions cascade
DROP TABLE IF EXISTS public.speed_branches CASCADE;

-- Commission tables
DROP TABLE IF EXISTS public.referral_commissions CASCADE;
DROP TABLE IF EXISTS public.commission_clawback_deficit CASCADE;

-- General branch system
DROP TABLE IF EXISTS public.branch_admin_overrides CASCADE;
DROP TABLE IF EXISTS public.branch_pending_liabilities CASCADE;
DROP TABLE IF EXISTS public.branch_user_assignments CASCADE;
DROP TABLE IF EXISTS public.branch_trades CASCADE;
DROP TABLE IF EXISTS public.branch_revenue CASCADE;
DROP TABLE IF EXISTS public.branch_market_config CASCADE;
DROP TABLE IF EXISTS public.branch_agents CASCADE;
DROP TABLE IF EXISTS public.branch_pools CASCADE;
DROP TABLE IF EXISTS public.branches CASCADE;

-- Microcredit + chain ledger
DROP TABLE IF EXISTS public.agent_pending_microcredits CASCADE;
DROP TABLE IF EXISTS public.credit_chain_ledger CASCADE;

-- ============================================================================
-- SECTION 3 — Drop branch / agent / commission columns from `users`
-- ============================================================================

ALTER TABLE public.users
  DROP COLUMN IF EXISTS signup_branch_id,
  DROP COLUMN IF EXISTS referral_chain,
  DROP COLUMN IF EXISTS referred_by,
  DROP COLUMN IF EXISTS direct_referral_count,
  DROP COLUMN IF EXISTS qualified_referral_count,
  DROP COLUMN IF EXISTS network_volume,
  DROP COLUMN IF EXISTS agent_level,
  DROP COLUMN IF EXISTS agent_balance_usd,
  DROP COLUMN IF EXISTS agent_activated,
  DROP COLUMN IF EXISTS agent_activation_override;

-- ============================================================================
-- SECTION 4 — Drop branch_id columns from speed tables
-- ============================================================================

ALTER TABLE public.speed_positions DROP COLUMN IF EXISTS branch_id;
ALTER TABLE public.speed_trades DROP COLUMN IF EXISTS branch_id;

-- ============================================================================
-- NOTE — Speed RPC retail-only rewrites are NOT in this migration.
-- They land in W4 cleanup as 366/367/368. After 365 applies, calling
-- speed_execute_trade / speed_execute_cashout / speed_resolve_market
-- will fail because their bodies still reference dropped tables.
-- This is the planned "speed broken mid-strip" window.
-- ============================================================================
