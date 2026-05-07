-- ============================================================================
-- Migration 0036 — Pricing telemetry (Item 7 of Phase 2.5 backend cleanup)
-- ============================================================================
--
-- Adds production telemetry on every pricing helper call so we can answer
-- questions like:
--   - How often does the matrix qualify vs fall back to BSM?
--   - When matrix qualifies, what's the distribution of corrections?
--   - How often does the asymmetric push-up actually engage?
--   - How often does soft-block fire?
--   - How often does the neighbor-aware fallback get used?
--
-- Implementation choice: log inside `_speed_pricing_apply` directly. Wrapped
-- in a BEGIN/EXCEPTION WHEN OTHERS THEN NULL block so a failing telemetry
-- write CAN NEVER block a real trade. This is the same pattern used for
-- `speed_user_alerts` (mig 0031).
--
-- We don't link telemetry to a specific trade_id — `_speed_pricing_apply` is
-- called BEFORE the trade row is inserted. Analytics correlate events to
-- trades post-hoc using (market_id, occurred_at, side). This is a deliberate
-- simplification: if we later need exact trade_id linkage, we can extend the
-- helper signature without breaking anything.

SET search_path = public;

-- ── Table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS speed_pricing_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asset           TEXT NOT NULL,
  duration        speed_duration NOT NULL,
  side            speed_side NOT NULL,
  mode            TEXT NOT NULL CHECK (mode IN ('entry', 'cashout')),
  market_id       UUID,
  -- Pricing inputs
  dist_pct        DOUBLE PRECISION NOT NULL,
  secs_left       DOUBLE PRECISION NOT NULL,
  bsm_prob        DOUBLE PRECISION NOT NULL,
  -- Pricing outputs
  matrix_prob_raw DOUBLE PRECISION,        -- NULL when matrix didn't qualify
  mark_prob       DOUBLE PRECISION NOT NULL,
  offered_prob    DOUBLE PRECISION NOT NULL,
  -- Path indicators
  matrix_used     BOOLEAN NOT NULL,        -- true = either direct cell or neighbor used
  matrix_version  INTEGER,
  neighbor_used   BOOLEAN NOT NULL DEFAULT FALSE,  -- true when neighbor-aware fallback engaged
  soft_blocked    BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS speed_pricing_events_recent_idx
  ON speed_pricing_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS speed_pricing_events_market_idx
  ON speed_pricing_events (market_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS speed_pricing_events_state_idx
  ON speed_pricing_events (asset, duration, mode, occurred_at DESC);

COMMENT ON TABLE speed_pricing_events IS
  '0036: insert-only pricing telemetry. One row per _speed_pricing_apply call. Analytics use this to monitor matrix engagement, asymmetric push-up frequency, soft-block firing, and matrix-vs-BSM correction distributions. Writes are wrapped in EXCEPTION WHEN OTHERS to ensure a failing telemetry insert NEVER blocks a real trade.';

COMMENT ON COLUMN speed_pricing_events.matrix_prob_raw IS
  'The raw matrix-derived probability for the side (BEFORE asymmetric only-push-up max). NULL when the cell did not qualify. When matrix_used is true and this is non-NULL, mark_prob = max(matrix_prob_raw, bsm_prob). When matrix_used is true and this is NULL, the neighbor-aware fallback was engaged.';

COMMENT ON COLUMN speed_pricing_events.neighbor_used IS
  'true when the current (dist_bucket, time_bucket) cell did not qualify but a closer-to-strike qualifying neighbor was used to maintain monotonicity.';

COMMENT ON COLUMN speed_pricing_events.mode IS
  'entry — called from speed_execute_trade pricing path (offered_prob = mark_prob + spread/2). cashout — called from speed_execute_cashout (offered_prob = mark_prob, no spread).';

-- ── Daily summary view ─────────────────────────────────────────────────
-- Cheap aggregation for /admin/stats — doesn't need to be a materialized view
-- at our current trade volume (<2K events/day). Refresh by query.

CREATE OR REPLACE VIEW speed_pricing_event_summary_daily AS
SELECT
  DATE_TRUNC('day', occurred_at AT TIME ZONE 'UTC')::date AS day,
  asset,
  duration,
  mode,
  COUNT(*)::int                                              AS total_events,
  COUNT(*) FILTER (WHERE matrix_used)::int                   AS matrix_engaged,
  COUNT(*) FILTER (WHERE soft_blocked)::int                  AS soft_blocked_count,
  COUNT(*) FILTER (WHERE neighbor_used)::int                 AS neighbor_used_count,
  ROUND(AVG(matrix_prob_raw - bsm_prob) FILTER (WHERE matrix_used AND matrix_prob_raw IS NOT NULL)::NUMERIC, 4) AS avg_correction,
  ROUND(MIN(matrix_prob_raw - bsm_prob) FILTER (WHERE matrix_used AND matrix_prob_raw IS NOT NULL)::NUMERIC, 4) AS min_correction,
  ROUND(MAX(matrix_prob_raw - bsm_prob) FILTER (WHERE matrix_used AND matrix_prob_raw IS NOT NULL)::NUMERIC, 4) AS max_correction
FROM speed_pricing_events
GROUP BY 1, 2, 3, 4
ORDER BY day DESC, asset, duration, mode;

COMMENT ON VIEW speed_pricing_event_summary_daily IS
  '0036: daily rollup of pricing telemetry. matrix_engaged shows how often the matrix path activated. avg_correction/min/max show the distribution of (matrix - BSM) on engagement. soft_blocked_count and neighbor_used_count surface defensive-path usage.';
