-- ============================================================================
-- Migration 0060 — _speed_cashout_margin: numeric → double precision for p_mark_prob
-- ============================================================================
--
-- Confirmed bug on staging (2026-05-12):
--   /api/speed/quote (cashout-quote branch) intermittently 400s with
--   "function _speed_cashout_margin(text, speed_duration, boolean, double
--    precision, double precision) does not exist."
--
-- Root cause: the function (mig 0051 Phase 2C) was declared with
--   p_mark_prob numeric
-- but the quote endpoint joins on `_speed_pricing_apply` which returns
--   mark_prob double precision
-- and PG does not implicitly cast double precision → numeric (would be lossy).
-- PG's strict overload resolution then reports "function does not exist."
--
-- Why this is the right shape: every sibling pricing helper uses
-- `double precision` for probability args (_speed_max_stake_for_offered,
-- _speed_pricing_apply). _speed_cashout_margin was the lone mixed-type
-- outlier. Changing to double precision aligns the entire pricing surface.
--
-- Safe for the other caller (speed_execute_cashout): it declares
-- v_mark_prob DECIMAL and passes it positional. PG implicitly casts
-- numeric → double precision (lossless within IEEE 754 range), so the
-- in-RPC path keeps working without code change.
--
-- See plan: ~/.claude/plans/in-our-model-there-swirling-popcorn.md Phase 0.5

SET search_path = public;

-- Sanity: confirm the old 5-arg numeric signature exists before we replace.
DO $$
DECLARE
  v_count int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_speed_cashout_margin'
     AND pg_get_function_arguments(p.oid)
         = 'p_asset text, p_duration speed_duration, p_is_winning boolean, p_mark_prob numeric, p_seconds_left double precision';
  IF v_count = 0 THEN
    RAISE NOTICE 'Mig 0060: prior (numeric) signature not found — either already migrated or fresh DB. Continuing.';
  END IF;
END $$;

-- Function body lives in functions/_speed_cashout_margin.sql (run after this).
