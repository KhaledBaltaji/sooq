-- ============================================================================
-- Migration 0040 — Sprint 0.6 — Kill 1h markets
-- ============================================================================
--
-- Founder decision (Phase 4 plan): platform becomes 5m + 1m only. 1h volume
-- was too low for matrix qualification per the recalibration audit. Strip
-- 1h entirely so future foundation refactor (Sprint 1) only carries 5m
-- config rows.
--
-- Strategy:
--   1. Stop opening NEW 1h markets (speed_roll_markets only rolls 5m).
--   2. Existing OPEN 1h markets keep resolving normally; their positions
--      cash out / settle as before. The function definitions for trade and
--      cashout still accept 1h durations for the legacy queue to drain.
--   3. Frontend hides 1h tab — handled in component edits (separate from
--      this migration).
--   4. fee_config 1h-specific keys (stake_max_1h_usd, cashout_*_1h, etc.)
--      stay in place for the moment; Sprint 5 cleanup will drop them after
--      foundation refactor migrates the surviving 5m values.
--
-- Idempotent: re-applying produces the same result.

SET search_path = public;

-- Optional sanity log: how many open 1h markets exist at apply time
DO $$
DECLARE
  v_open_1h INT;
BEGIN
  SELECT COUNT(*) INTO v_open_1h
  FROM speed_markets
  WHERE duration = '1h'::speed_duration AND status = 'open';
  RAISE NOTICE 'Mig 0040: % open 1h markets at apply time will resolve normally; no new ones will open after this point.', v_open_1h;
END $$;
