-- ============================================================================
-- 332_speed_pg_cron.sql
--
-- Schedule speed-markets crons directly in Postgres via pg_cron.
--
-- Why pg_cron, not Vercel cron:
--   Vercel cron jobs only run on the production deployment, not on Preview
--   deployments. staging.sooq.exchange is a Preview, so vercel.json's speed
--   cron entries silently never fire there. Discovered when /api/cron/
--   speed-resolve had to be manually triggered to clear ~40 min of stale
--   markets.
--
--   pg_cron runs inside Postgres on every environment where the migration
--   applies, eliminates the HTTP layer (no CRON_SECRET, no signed bearer),
--   and works identically on staging + production without env-specific config.
--
-- Idempotency:
--   speed_resolve_market         advisory-lock per market_id
--   speed_resolve_expired_markets wraps speed_resolve_market in error-handler
--   speed_roll_markets           skips when open future market exists
--   speed_extend_partitions      IF NOT EXISTS on partition creation
--   This migration                cron.unschedule on existing jobnames before
--                                 re-scheduling, so re-running is safe.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Drop any existing speed-markets cron jobs (safe re-run)
DO $$
DECLARE
  v_jobname TEXT;
BEGIN
  FOR v_jobname IN
    SELECT jobname FROM cron.job WHERE jobname LIKE 'speed-%'
  LOOP
    PERFORM cron.unschedule(v_jobname);
  END LOOP;
END $$;

-- Resolve expired markets every minute
SELECT cron.schedule(
  'speed-resolve',
  '* * * * *',
  $$ SELECT speed_resolve_expired_markets(); $$
);

-- Roll new markets every minute
SELECT cron.schedule(
  'speed-roll',
  '* * * * *',
  $$ SELECT speed_roll_markets(); $$
);

-- Extend partitions weekly (Sunday 00:00 UTC)
SELECT cron.schedule(
  'speed-partitions',
  '0 0 * * 0',
  $$ SELECT speed_extend_partitions(); $$
);

-- Confirmation
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM cron.job WHERE jobname LIKE 'speed-%';
  RAISE NOTICE 'speed-markets pg_cron jobs scheduled: %', v_count;
END $$;
