-- ============================================================================
-- Migration 0056 — extend _speed_get_iv to accept duration '1m'
-- ============================================================================
--
-- _speed_get_iv was authored in mig 0029 with the allowed-horizon set
-- ('5m','1h','15m','24h'). Mig 0046 added 1m markets infrastructure but
-- did not extend this helper, so any trade RPC call on a 1m market fails
-- with "No volatility horizon mapping for duration 1m" even though:
--   - speed_volatility_cache has BTC-1m and GOLD-1m rows
--   - fee_config.speed_iv_freshness_1m_secs is configured (15s)
--   - fee_config.speed_iv_btc fallback is positive (0.60)
--
-- Schema-only migration: no table changes. Function update lives in
-- functions/_speed_get_iv.sql.

SET search_path = public;

DO $$
BEGIN
  RAISE NOTICE 'Mig 0056: _speed_get_iv now accepts duration 1m. 1m markets can now price.';
END $$;
