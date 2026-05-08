-- ============================================================================
-- Migration 0046 — Sprint 3 — 1-minute markets
-- ============================================================================
--
-- Activates 1m markets per founder Phase 4 plan. Pairs with mig 0045 which
-- adds '1m' to speed_duration enum (must commit first; PG can't use new
-- enum values in same transaction).
--
-- Anti-shark structural: 60 seconds of BTC is noise, not trend. The kill
-- zone exists in 5m/1h because matrix bucket cells with N_eff < 100 fall
-- back to BSM. With 1m markets the chart can't be "read" the same way.
--
-- Cold-start launch tax (founder decision, lock-in for first 30 days):
--   - spread_pct = 0.08 (8% — slot-machine territory; drops once matrix qualifies)
--   - soft_block_threshold = 0.85 (vs 0.95 on 5m; 1m saturates faster)
--   - last_n_reject_secs = 3 (vs 10 on 5m)
--   - cashout_reject_secs = 3
--   - stake_max_usd = 25 (start small; raise after matrix populates)
--   - payout_max_usd = 250 (10x stake — shorter cycle = more variance)
--   - per_side_pool_pct = 0.10 (smaller fraction; resolutions 4× more frequent)
--
-- IV: oracle worker doesn't yet compute 1m horizon. Seed initial cache
-- row using BTC 5m IV as proxy. Recalibration cron will overwrite with
-- actual 1m realized vol once worker is updated. Asset-aware fallback
-- in _speed_get_iv (mig 0039) handles the cache-miss case.
--
-- 1h is killed (mig 0040) but legacy 1h positions still resolve. trade
-- and cashout RPCs accept 1h for that drain.

SET search_path = public;

-- ────────────────────────────────────────────────────────────────────────────
-- 1) BTC-1m row in speed_market_config (launch tax values)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO speed_market_config (
  asset, duration,
  stake_min_usd, stake_max_usd, payout_max_usd, cap_per_side_usd,
  per_side_pool_pct, per_user_open_exposure_pct, velocity_max_per_min, daily_handle_alert_usd,
  spread_pct, soft_block_threshold, soft_block_unlock,
  late_window_60s_secs, late_window_30s_secs, late_window_60s_mult, late_window_30s_mult,
  last_n_reject_secs, near_decided_dist,
  cashout_winning_base, cashout_losing_base,
  cashout_saturation_coef, cashout_desperation_coef,
  cashout_late_winning_coef, cashout_late_losing_coef,
  cashout_reject_secs, cashout_late_30s_imbalance, cashout_cap_edge_threshold,
  matrix_min_n_eff, matrix_ci_max_width, matrix_prior_n, matrix_calibration_window_days,
  enabled, notes
)
VALUES (
  'BTC', '1m'::speed_duration,
  -- Stake bounds (small to start; ramp once matrix qualifies)
  1, 25, 250, 100,
  -- Risk caps (smaller fraction — 4× resolution frequency)
  0.10, 0.10, 30, 5000,
  -- Pricing — LAUNCH TAX (8% spread + 0.85 soft-block for first 30 days)
  0.08, 0.85, 0.84,
  -- Late-window — tightened for 60s market lifetime
  30, 15, 1.20, 1.40,
  3, 0.30,
  -- Cashout
  0.025, 0.08,
  0.20, 0.40,
  0.015, 0.05,
  3, 0.30, 0.985,
  -- Matrix calibration (same as 5m; matrix qualifies after enough data)
  100, 0.12, 50, 14,
  -- Operational
  TRUE,
  'Sprint 3 launch tax: 8% spread, 0.85 soft-block for first 30d. Drops to 0.05/0.95 once matrix qualifies.'
)
ON CONFLICT (asset, duration) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) Allow '1m' in speed_volatility_cache.horizon CHECK constraint
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE speed_volatility_cache DROP CONSTRAINT IF EXISTS speed_volatility_cache_horizon_chk;
ALTER TABLE speed_volatility_cache ADD CONSTRAINT speed_volatility_cache_horizon_chk
  CHECK (horizon = ANY (ARRAY['1m'::text, '5m'::text, '15m'::text, '1h'::text, '24h'::text, 'ewma'::text]));

-- ────────────────────────────────────────────────────────────────────────────
-- 3) IV cache seed for BTC-1m (uses 5m IV as proxy until oracle worker updates)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO speed_volatility_cache (asset, horizon, sigma_annualized, computed_at)
SELECT
  'BTC',
  '1m',
  COALESCE(
    (SELECT sigma_annualized FROM speed_volatility_cache WHERE asset='BTC' AND horizon='5m'),
    (SELECT rate FROM fee_config WHERE fee_type='speed_iv_btc' LIMIT 1),
    0.6
  ),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM speed_volatility_cache WHERE asset='BTC' AND horizon='1m'
);

-- ────────────────────────────────────────────────────────────────────────────
-- 3) IV freshness key for 1m horizon (15s — tighter than 5m's 30s)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_iv_freshness_1m_secs', 15,
   '0046 Sprint 3: max age (seconds) of 1m IV cache row before treated as stale. Tighter than 5m (30s) because 1m market lifetime = 60s.'),
  ('speed_1m_markets_enabled', 0,
   '0046 Sprint 3: flag-gated 1m market rolling. Default 0 (only 5m rolls) until Sprint 1 Phase 2 refactors helpers to read per-market spread/soft-block/reject_secs from speed_market_config. Flip to 1 once Phase 2 lands so 1m markets get the 8% launch-tax spread and 0.85 soft-block configured in speed_market_config.')
ON CONFLICT (fee_type) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 4) _next_clean_boundary — add 1m case
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _next_clean_boundary(p_duration speed_duration, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  -- 30s post-boundary tolerance lets a roll fired right after a market
  -- resolved anchor at the previous boundary instead of jumping ahead.
  -- 1m markets use a TIGHTER tolerance (5s) because 30s is half the
  -- entire market.
  SELECT CASE p_duration
    WHEN '1m'::speed_duration THEN
      CASE
        WHEN EXTRACT(SECOND FROM p_now) < 5 THEN
          date_trunc('minute', p_now)
        ELSE
          date_trunc('minute', p_now) + INTERVAL '1 minute'
      END
    WHEN '5m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 5 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 5)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 5) + 1)
      END
    WHEN '1h'::speed_duration THEN
      CASE
        WHEN EXTRACT(MINUTE FROM p_now) = 0
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
        ELSE
          date_trunc('hour', p_now) + INTERVAL '1 hour'
      END
    -- Historical enum values still reachable (15m, 24h) — preserved for
    -- any stale callsite that might pass them.
    WHEN '15m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 15 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 15)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 15) + 1)
      END
    WHEN '24h'::speed_duration THEN
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;

COMMENT ON FUNCTION _next_clean_boundary(speed_duration, TIMESTAMPTZ) IS
  '0046 Sprint 3: adds 1m boundary (next minute mark, 5s tolerance). 1m markets need tight tolerance because 30s would be half their life.';

DO $$
BEGIN
  RAISE NOTICE 'Mig 0046 Sprint 3: BTC-1m market_config seeded with launch-tax values; 1m IV cache row seeded; _next_clean_boundary updated.';
END $$;
