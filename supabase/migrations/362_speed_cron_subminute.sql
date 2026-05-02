-- ============================================================================
-- 362_speed_cron_subminute.sql
--
-- Reduce speed-resolve and speed-roll pg_cron schedules from once-per-minute
-- to every 5 seconds. pg_cron 1.4+ supports sub-minute scheduling via the
-- "[N] seconds" syntax; staging is on 1.6.4.
--
-- Why: a 5m speed market closing at 20:40:00 currently waits up to 60s for
-- the next minute-boundary cron tick before resolving — perceived as ~60s
-- of "is this broken?" silence after the timer hits 0. Same lag applies to
-- finalizing the next pending market (which is what makes the new "Live"
-- pill appear). With 5s cadence:
--   - resolve latency: 0-60s → 0-5s (avg ~2.5s)
--   - new-market visibility: 0-60s → 0-5s
--
-- Load impact: speed_resolve_expired_markets and speed_roll_markets each
-- run in ~50ms when there's no work. 12x more frequent invocation × ~50ms
-- = ~600ms/minute of extra DB activity. Negligible.
--
-- speed-rv-refresh stays at 1/min — RV cache freshness threshold is 90s
-- (mig 354), so refreshing every 60s is well within tolerance.
-- speed-partitions stays at weekly.
-- ============================================================================

-- Tear down old schedules and reschedule. cron.unschedule is idempotent.
SELECT cron.unschedule('speed-resolve');
SELECT cron.unschedule('speed-roll');

SELECT cron.schedule(
  'speed-resolve',
  '5 seconds',
  $$SELECT speed_resolve_expired_markets();$$
);

SELECT cron.schedule(
  'speed-roll',
  '5 seconds',
  $$SELECT speed_roll_markets();$$
);

-- Verify the new schedules are in place. RAISE NOTICE so the apply log
-- shows the active state without needing a follow-up SELECT.
DO $$
DECLARE
  v_resolve TEXT;
  v_roll    TEXT;
BEGIN
  SELECT schedule INTO v_resolve FROM cron.job WHERE jobname = 'speed-resolve';
  SELECT schedule INTO v_roll    FROM cron.job WHERE jobname = 'speed-roll';
  RAISE NOTICE 'Mig 362: speed-resolve = %, speed-roll = %', v_resolve, v_roll;
END;
$$;
