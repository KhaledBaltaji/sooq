-- 0008_speed_oracle_ticks_unique.sql
--
-- The speed-oracle worker (services/speed-oracle/) uses ON CONFLICT DO
-- NOTHING to dedupe re-deliveries of the same closed kline. PostgreSQL
-- requires a UNIQUE constraint matching the conflict target. Add one
-- on (asset, ts, source) — the natural identity of a kline tick.
--
-- The existing index `speed_oracle_ticks_asset_ts_idx` (created by the
-- 0001 migration via Drizzle) is non-unique and won't satisfy the
-- conflict target. Adding this unique index is additive — query plans
-- still use the older composite index for time-range scans.

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS speed_oracle_ticks_dedupe
  ON speed_oracle_ticks (asset, ts, source);

COMMIT;
