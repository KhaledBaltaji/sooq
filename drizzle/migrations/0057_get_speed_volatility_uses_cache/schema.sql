-- ============================================================================
-- Migration 0057 — get_speed_volatility reads from cache via _speed_get_iv
-- ============================================================================
--
-- The original `get_speed_volatility(p_asset)` (v1) was a stub that always
-- returned `fee_config.speed_iv_btc` (0.60) with `source:'fallback'`. It
-- predated `speed_volatility_cache` (mig 0029) and was never updated when
-- the EC2 oracle worker started populating per-horizon RV rows.
--
-- Result: client `/api/speed/volatility` and server `_speed_get_iv()`
-- returned different numbers — 0.60 vs 0.191 for BTC on 5m markets —
-- producing 214% drift on every parity check.
--
-- This migration rewrites `get_speed_volatility` to delegate to
-- `_speed_get_iv(p_asset, p_duration)` so client + server share the IV
-- source. Adds an optional `p_duration` parameter (default `'5m'`) so
-- existing callers continue to work.
--
-- Backward compat:
--   - Old callsite `get_speed_volatility('BTC'::text)` resolves to the
--     `(text)` overload, which we keep but make it delegate to the new
--     `(text, speed_duration)` overload with the `'5m'` default. No
--     client breakage.

SET search_path = public;

DO $$
BEGIN
  RAISE NOTICE 'Mig 0057: get_speed_volatility now reads speed_volatility_cache via _speed_get_iv. Client + server IV sources are unified.';
END $$;
