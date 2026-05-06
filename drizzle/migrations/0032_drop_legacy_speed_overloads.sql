-- 0032_drop_legacy_speed_overloads.sql
--
-- Drop the legacy 5-arg speed_execute_trade and 3-arg speed_execute_cashout
-- overloads that were left in pg_proc after migrations 0028→0031.
--
-- Background:
--   - Mig 0027 (speed_stake_caps_tunable) created speed_execute_trade with
--     5 args (uuid, text, numeric, text, decimal — `expected_iv` was already
--     in scope as a stale-quote-only check from earlier work).
--   - Mig 0016 (speed_casino_mode) created speed_execute_cashout with 3 args
--     (uuid, text, decimal).
--   - Mig 0028→0031 added the parity-checking + soft-guard parameters,
--     producing 9-arg speed_execute_trade and 7-arg speed_execute_cashout.
--   - Postgres CREATE OR REPLACE FUNCTION matches by full parameter
--     signature, so the original 5-arg / 3-arg versions remained alongside
--     the new ones. Both were live overloads.
--   - The /api/speed/{trade,cashout} routes call the new 9-arg / 7-arg
--     signatures (which include the soft guards from 0031). Any code path
--     that hit the legacy 5-arg / 3-arg overloads would silently bypass
--     velocity, open-exposure, and daily-handle alerting.
--
-- This migration drops the legacy overloads. RDS staging already had this
-- applied via scripts/apply-pricing-v2-cleanup.mjs on 2026-05-05; this
-- file captures the same DROP for fresh deploys (where 0027 + 0016 + 0028→0031
-- replay would otherwise leave both overloads alive).
--
-- Idempotent: DROP FUNCTION IF EXISTS — re-running on staging is a no-op.

BEGIN;

DROP FUNCTION IF EXISTS public.speed_execute_trade(
  uuid,
  text,
  numeric,
  text,
  decimal
);

DROP FUNCTION IF EXISTS public.speed_execute_cashout(
  uuid,
  text,
  decimal
);

-- Sanity assertion: post-DROP, exactly one overload of each must remain
-- (the 9-arg trade and 7-arg cashout from mig 0030/0031). If the DB is
-- in an unexpected state, fail loud rather than ship inconsistent.
DO $$
DECLARE
  v_trade_count    INTEGER;
  v_cashout_count  INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_trade_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'speed_execute_trade';

  SELECT COUNT(*) INTO v_cashout_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'speed_execute_cashout';

  IF v_trade_count <> 1 THEN
    RAISE EXCEPTION 'speed_execute_trade overload count = %, expected 1 after legacy drop', v_trade_count;
  END IF;
  IF v_cashout_count <> 1 THEN
    RAISE EXCEPTION 'speed_execute_cashout overload count = %, expected 1 after legacy drop', v_cashout_count;
  END IF;
END $$;

COMMIT;
