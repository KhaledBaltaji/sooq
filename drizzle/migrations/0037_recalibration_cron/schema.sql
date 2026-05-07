-- ============================================================================
-- Migration 0037 — Auto-recalibration cron (Item 3 of Phase 2.5 cleanup)
-- ============================================================================
--
-- Schedules nightly _speed_recalibrate_matrix() runs via pg_cron, plus a
-- diff view for the dual-run safety gate.
--
-- Default cron status is 'shadow' — versions written but not used by pricing.
-- Admin reviews dual-run diff for ≥7 nights, then runs
--   SELECT _speed_promote_matrix_version(id)
-- to promote.
--
-- pg_cron is already enabled in this RDS instance (used by speed_roll_markets
-- and speed_resolve_expired_markets per CLAUDE.md). We just add a new schedule.

SET search_path = public;

-- ── 1. Nightly recalibration cron jobs ────────────────────────────────
-- One job per (asset, duration) pair. Currently only BTC 5m (1h has too few
-- markets per the audit). Add 1h job once we have ≥200 resolved 1h markets.
--
-- Schedule format: minute hour day-of-month month day-of-week
--   0 3 * * *  → 03:00 UTC every day. Low traffic, before US market open.
--
-- Idempotent: cron.schedule() upserts by jobname; re-applying this migration
-- updates the schedule cleanly.

DO $$
BEGIN
  -- Try to schedule via pg_cron. If pg_cron isn't installed, log and skip.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('speed_recalibrate_matrix_btc_5m')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'speed_recalibrate_matrix_btc_5m');
  ELSE
    RAISE NOTICE 'pg_cron extension not installed; skipping schedule. Install via CREATE EXTENSION pg_cron.';
  END IF;
END $$;

-- Conditional schedule (only if pg_cron is present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'speed_recalibrate_matrix_btc_5m',
      '0 3 * * *',  -- 03:00 UTC daily
      $cron$SELECT public._speed_recalibrate_matrix('BTC', '5m', 14, 'shadow');$cron$
    );
    RAISE NOTICE 'Scheduled speed_recalibrate_matrix_btc_5m at 03:00 UTC daily (status=shadow)';
  END IF;
END $$;

-- ── 2. Dual-run diff view (shadow vs active) ──────────────────────────
-- Gives admins a one-query view of how the latest shadow matrix differs
-- from the currently-active matrix. Used during the ≥7-night observation
-- window before promoting a shadow version.
--
-- Diff is computed cell-by-cell:
--   shadow.p_over_final - active.p_over_final
-- Aggregations (max abs diff, count above 0.001, etc.) at the bottom.

CREATE OR REPLACE VIEW speed_pricing_matrix_dual_run_diff AS
WITH shadow_v AS (
  SELECT id, asset, duration FROM speed_pricing_matrix_versions
   WHERE status = 'shadow'
   ORDER BY computed_at DESC LIMIT 1
),
active_v AS (
  SELECT id, asset, duration FROM speed_pricing_matrix_versions
   WHERE status = 'active'
   ORDER BY computed_at DESC LIMIT 1
)
SELECT
  s.asset,
  s.duration,
  s.dist_bucket,
  s.time_bucket,
  s.qualifies     AS shadow_qualifies,
  a.qualifies     AS active_qualifies,
  s.n_eff         AS shadow_n_eff,
  a.n_eff         AS active_n_eff,
  ROUND(s.p_over_final::numeric, 6) AS shadow_p_over,
  ROUND(a.p_over_final::numeric, 6) AS active_p_over,
  ROUND((s.p_over_final - a.p_over_final)::numeric, 6) AS diff,
  ROUND(ABS(s.p_over_final - a.p_over_final)::numeric, 6) AS abs_diff
FROM speed_pricing_matrix s
JOIN shadow_v sv ON sv.id = s.version_id AND sv.asset = s.asset AND sv.duration = s.duration
JOIN active_v av ON av.asset = s.asset AND av.duration = s.duration
LEFT JOIN speed_pricing_matrix a
  ON a.version_id = av.id
 AND a.asset = s.asset AND a.duration = s.duration
 AND a.dist_bucket = s.dist_bucket AND a.time_bucket = s.time_bucket;

COMMENT ON VIEW speed_pricing_matrix_dual_run_diff IS
  '0037: cell-by-cell diff between latest shadow and active matrix versions. Used during the ≥7-night observation window before promoting a shadow version. abs_diff > 0.001 indicates real divergence; investigate before promotion.';

-- ── 3. Summary of dual-run drift (one row per asset/duration) ─────────
-- Quick "should we promote" snapshot: max diff, mean diff, count of cells
-- exceeding 0.001 tolerance.

CREATE OR REPLACE VIEW speed_pricing_matrix_dual_run_summary AS
SELECT
  asset,
  duration,
  COUNT(*)::int                                                                  AS total_cells_compared,
  COUNT(*) FILTER (WHERE abs_diff > 0.001)::int                                  AS cells_diverging,
  ROUND(MAX(abs_diff)::numeric, 6)                                               AS max_abs_diff,
  ROUND(AVG(abs_diff)::numeric, 6)                                               AS avg_abs_diff,
  COUNT(*) FILTER (WHERE shadow_qualifies <> active_qualifies)::int              AS qualification_differs
FROM speed_pricing_matrix_dual_run_diff
GROUP BY asset, duration;

COMMENT ON VIEW speed_pricing_matrix_dual_run_summary IS
  '0037: one-line summary of shadow-vs-active drift per (asset, duration). Promote when max_abs_diff stays below 0.001 across ≥7 consecutive nightly recalibrations AND qualification_differs is zero.';
