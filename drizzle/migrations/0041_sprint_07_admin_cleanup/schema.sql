-- ============================================================================
-- Migration 0041 — Sprint 0.7 — Admin panel cleanup
-- ============================================================================
--
-- Founder decision (Phase 4 plan): aggressive cleanup of dead config left over
-- from stripped features (LMSR, branches, commission, demo, prelaunch). Smaller
-- surface = fewer footguns + cleaner foundation refactor in Sprint 1.
--
-- What this migration does:
--   1. Drops three IV freshness fee_config keys for inactive horizons
--      (15m, 24h, ewma). Zero references in src/ or drizzle/functions/.
--      Mig 0029 seeded them speculatively; they never got wired.
--
-- What this migration does NOT do (deferred to Sprint 1 / Sprint 5):
--   - speed_stake_max_usd: legacy single-bet cap; still used as fallback
--     by _speed_get_stake_max. Sprint 1 foundation refactor migrates the
--     surviving values into speed_market_config and removes this key.
--   - speed_stake_max_1h_usd, speed_cashout_*_1h, speed_entry_max_payout_usd_1h:
--     1h markets are killed (mig 0040) but legacy 1h positions still resolve;
--     the keys stay until the queue drains. Sprint 5 cleanup drops them.
--   - speed_daily_ngr_floor: still referenced by _speed_update_daily_ngr;
--     value already aligned with hard_stop tier so no behavior change.
--
-- Idempotent: ON CONFLICT DO NOTHING isn't relevant since this is DELETE,
-- but the DELETE is a no-op if the key isn't there.

SET search_path = public;

-- ── Drop dead IV freshness keys (0 references in code) ─────────────────────
DELETE FROM fee_config WHERE fee_type = 'speed_iv_freshness_15m_secs';
DELETE FROM fee_config WHERE fee_type = 'speed_iv_freshness_24h_secs';
DELETE FROM fee_config WHERE fee_type = 'speed_iv_freshness_ewma_secs';

DO $$ BEGIN
  RAISE NOTICE 'Mig 0041: dropped 3 dead IV freshness fee_config keys (15m, 24h, ewma).';
END $$;
