-- ============================================================================
-- Migration 0054 — Schedule matrix recalibration crons per (asset, duration)
-- ============================================================================
--
-- Closes a critical gap left over from Sprint 3 (BTC-1m, mig 0046) and
-- Sprint 4 (gold, mig 0048): the matrix recalibration cron was only
-- scheduled for BTC-5m in mig 0037. As a result, BTC-1m / GOLD-5m / GOLD-1m
-- markets accumulate trade data but never get a nightly memory-brain update.
-- They run on pure BSM (math brain) forever, exposing the platform to
-- exactly the kind of structural mispricing the matrix was built to fix.
--
-- This migration adds three cron schedules so all four production markets
-- get nightly recalibration:
--   - BTC-5m: already scheduled at 03:00 UTC (mig 0037, untouched)
--   - BTC-1m: schedule at 03:15 UTC
--   - GOLD-5m: schedule at 03:30 UTC
--   - GOLD-1m: schedule at 03:45 UTC
--
-- All run in 'shadow' status per the original safety gate. Promotion to
-- 'active' requires ≥7 consecutive nightly diffs within 0.001 tolerance
-- (see speed_pricing_matrix_dual_run_summary).
--
-- The schedule is staggered (15-min gaps) to spread DB load across the
-- low-traffic 03:00-04:00 UTC hour. Each run touches ~14 days of data and
-- takes 30-90 seconds depending on volume.
--
-- Idempotent: cron.schedule() upserts by jobname.

SET search_path = public;

-- Conditional schedules (only if pg_cron is present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- BTC-1m: shadow nightly at 03:15 UTC
    PERFORM cron.schedule(
      'speed_recalibrate_matrix_btc_1m',
      '15 3 * * *',
      $cron$SELECT public._speed_recalibrate_matrix('BTC', '1m', 14, 'shadow');$cron$
    );
    RAISE NOTICE 'Scheduled speed_recalibrate_matrix_btc_1m at 03:15 UTC daily (status=shadow)';

    -- GOLD-5m: shadow nightly at 03:30 UTC
    -- Note: gold has lower volume than BTC. Calibration window stays at 14
    -- days; if cells take longer to qualify, adjust window via
    -- speed_market_config.matrix_calibration_window_days.
    PERFORM cron.schedule(
      'speed_recalibrate_matrix_gold_5m',
      '30 3 * * *',
      $cron$SELECT public._speed_recalibrate_matrix('GOLD', '5m', 14, 'shadow');$cron$
    );
    RAISE NOTICE 'Scheduled speed_recalibrate_matrix_gold_5m at 03:30 UTC daily (status=shadow)';

    -- GOLD-1m: shadow nightly at 03:45 UTC
    PERFORM cron.schedule(
      'speed_recalibrate_matrix_gold_1m',
      '45 3 * * *',
      $cron$SELECT public._speed_recalibrate_matrix('GOLD', '1m', 14, 'shadow');$cron$
    );
    RAISE NOTICE 'Scheduled speed_recalibrate_matrix_gold_1m at 03:45 UTC daily (status=shadow)';

  ELSE
    RAISE NOTICE 'pg_cron extension not installed; skipping schedule.';
  END IF;
END $$;

-- ── Sanity assertion: confirm all 4 recalibration jobs are scheduled ──
DO $$
DECLARE
  v_count int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT count(*) INTO v_count
    FROM cron.job
    WHERE jobname IN (
      'speed_recalibrate_matrix_btc_5m',
      'speed_recalibrate_matrix_btc_1m',
      'speed_recalibrate_matrix_gold_5m',
      'speed_recalibrate_matrix_gold_1m'
    ) AND active = TRUE;

    IF v_count <> 4 THEN
      RAISE EXCEPTION 'Expected 4 active recalibration crons after mig 0054; found %', v_count;
    END IF;
    RAISE NOTICE 'mig 0054 OK: 4/4 recalibration crons active';
  END IF;
END $$;
