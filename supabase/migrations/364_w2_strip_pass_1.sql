-- ============================================================================
-- 364_w2_strip_pass_1.sql
--
-- W2 strip pass 1 — Sooq rebuild plan (~/.claude/plans/oh-my-how-much-giggly-crystal.md)
--
-- Drops:
--   - Stale features: news, copy trading, market comments, leaderboard, price alerts
--   - Demo mode (3-table sandbox: demo_*, plus 10 demo_* RPCs)
--   - Prelaunch voting + waitlist (3 tables, 1 RPC)
--   - LMSR core (markets, amm_state, trades, positions, retail_*, platform_revenue, ~16 RPCs)
--   - Admin tooling (system_logs, stats RPCs, reconcile_* RPCs, log_system_event)
--   - Deposit bonus + organic-only gate (claim_deposit_bonus)
--   - LMSR-only columns from `users` table
--
-- Branches + commission (general + speed_branches) are NOT touched here —
-- they get the dedicated W3 surgery pass since `execute_speed_trade` needs
-- the routing logic rewritten before its branch refs can be cleanly removed.
--
-- All drops use IF EXISTS + CASCADE for idempotency. Utility cleanup
-- functions (cleanup_test_data, staging_full_reset) reference half the
-- schema so they're dropped first; W4 will add slimmer replacements.
-- ============================================================================

set check_function_bodies = off;

-- ============================================================================
-- SECTION 0 — Drop utility functions whose bodies reference half the schema
-- ============================================================================
DROP FUNCTION IF EXISTS public.cleanup_test_data() CASCADE;
DROP FUNCTION IF EXISTS public.staging_full_reset() CASCADE;

-- ============================================================================
-- SECTION 1 — Stale features (no UI / abandoned)
-- ============================================================================

-- News pipeline (already dropped in mig 342, defensive)
DROP TABLE IF EXISTS public.news_articles CASCADE;
DROP FUNCTION IF EXISTS public.search_news_for_market CASCADE;

-- Copy trading
DROP TABLE IF EXISTS public.copy_settings CASCADE;

-- Market comments + reactions
DROP TABLE IF EXISTS public.comment_likes CASCADE;
DROP TABLE IF EXISTS public.market_comments CASCADE;

-- Leaderboard backend (no frontend)
DROP TABLE IF EXISTS public.leader_stats CASCADE;
DROP VIEW IF EXISTS public.leaderboard_view CASCADE;

-- Price alerts
DROP TABLE IF EXISTS public.price_alerts CASCADE;

-- ============================================================================
-- SECTION 2 — Demo mode
-- ============================================================================

DROP TABLE IF EXISTS public.demo_trades CASCADE;
DROP TABLE IF EXISTS public.demo_positions CASCADE;
DROP TABLE IF EXISTS public.demo_amm_state CASCADE;
DROP TABLE IF EXISTS public.demo_market_scheduled_outcomes CASCADE;
DROP TABLE IF EXISTS public.demo_transactions CASCADE;
DROP TABLE IF EXISTS public.demo_markets CASCADE;

DROP FUNCTION IF EXISTS public.toggle_demo_mode CASCADE;
DROP FUNCTION IF EXISTS public.demo_reset_balance CASCADE;
DROP FUNCTION IF EXISTS public.demo_execute_trade CASCADE;
DROP FUNCTION IF EXISTS public.initialize_demo_amm CASCADE;
DROP FUNCTION IF EXISTS public.admin_create_demo_market CASCADE;
DROP FUNCTION IF EXISTS public.admin_resolve_demo_market CASCADE;
DROP FUNCTION IF EXISTS public.demo_get_price_history CASCADE;
DROP FUNCTION IF EXISTS public.get_demo_conversion_stats CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_demo_markets_with_outcomes CASCADE;
DROP FUNCTION IF EXISTS public.demo_seed_initial_price CASCADE;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS demo_first_enabled_at,
  DROP COLUMN IF EXISTS demo_first_trade_at,
  DROP COLUMN IF EXISTS demo_balance_usd,
  DROP COLUMN IF EXISTS first_real_deposit_after_demo_at,
  DROP COLUMN IF EXISTS demo_mode;

-- ============================================================================
-- SECTION 3 — Prelaunch voting + waitlist
-- ============================================================================

DROP TABLE IF EXISTS public.prelaunch_votes CASCADE;
DROP TABLE IF EXISTS public.prelaunch_questions CASCADE;
DROP TABLE IF EXISTS public.prelaunch_waitlist CASCADE;
DROP FUNCTION IF EXISTS public.record_prelaunch_vote CASCADE;

-- ============================================================================
-- SECTION 4 — LMSR core (markets, amm_state, trades, positions, RPCs)
-- ============================================================================

-- LMSR RPCs (drop functions before tables they reference)
DROP FUNCTION IF EXISTS public.execute_trade CASCADE;
DROP FUNCTION IF EXISTS public.resolve_market CASCADE;
DROP FUNCTION IF EXISTS public.lock_market CASCADE;
DROP FUNCTION IF EXISTS public.void_market CASCADE;
DROP FUNCTION IF EXISTS public._void_market_internal CASCADE;
DROP FUNCTION IF EXISTS public.lmsr_cost CASCADE;
DROP FUNCTION IF EXISTS public.lmsr_price CASCADE;
DROP FUNCTION IF EXISTS public.lmsr_shares_for_cost CASCADE;
DROP FUNCTION IF EXISTS public.initialize_amm CASCADE;
DROP FUNCTION IF EXISTS public.get_amm_price CASCADE;
DROP FUNCTION IF EXISTS public.get_amm_risk_snapshot CASCADE;
DROP FUNCTION IF EXISTS public.get_cash_out_value CASCADE;
DROP FUNCTION IF EXISTS public.admin_create_market CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_market CASCADE;
DROP FUNCTION IF EXISTS public.update_homepage_ranks CASCADE;
DROP FUNCTION IF EXISTS public.get_price_history CASCADE;

-- LMSR + branch hybrid tables (retail_* — populated by execute_branch_trade)
DROP TABLE IF EXISTS public.retail_trades CASCADE;
DROP TABLE IF EXISTS public.retail_positions CASCADE;

-- LMSR core tables
DROP TABLE IF EXISTS public.trades CASCADE;
DROP TABLE IF EXISTS public.positions CASCADE;
DROP TABLE IF EXISTS public.amm_state CASCADE;
DROP TABLE IF EXISTS public.markets CASCADE;
DROP TABLE IF EXISTS public.platform_revenue CASCADE;

-- ============================================================================
-- SECTION 5 — Deposit bonus (per decision: strip, re-add growth tools later)
-- ============================================================================

DROP FUNCTION IF EXISTS public.claim_deposit_bonus CASCADE;

ALTER TABLE public.users
  DROP COLUMN IF EXISTS deposit_bonus_claimed,
  DROP COLUMN IF EXISTS wagering_requirement,
  DROP COLUMN IF EXISTS total_wagered;

-- ============================================================================
-- SECTION 6 — Admin tooling (system_logs, stats RPCs, reconcile, log helpers)
-- ============================================================================

DROP TABLE IF EXISTS public.system_logs CASCADE;
DROP FUNCTION IF EXISTS public.log_system_event CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_balances CASCADE;
DROP FUNCTION IF EXISTS public.reconcile_agent_balances CASCADE;
-- reconcile_branch_solvency stays for W3 (branch land)

DROP FUNCTION IF EXISTS public.get_platform_stats CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_users CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_trading CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_markets CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_finance CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_revenue CASCADE;
DROP FUNCTION IF EXISTS public.get_stats_health CASCADE;

-- ============================================================================
-- SECTION 7 — Help articles (admin help section, per plan: drop)
-- ============================================================================

DROP TABLE IF EXISTS public.help_articles CASCADE;
DROP TABLE IF EXISTS public.help_collections CASCADE;
