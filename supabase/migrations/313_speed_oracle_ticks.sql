-- ============================================================================
-- 313_speed_oracle_ticks.sql
--
-- Two oracle tables:
-- 1. speed_oracle_ticks — rolling 5-min history of price ticks. Used for
--    TWAP computation at market expiry. Aggressively pruned by maintenance
--    cron (Part 3) — anything older than 5 minutes deleted.
-- 2. speed_oracle_latest — single row per asset, last-write-wins. Fast
--    read path for price display + staleness check.
--
-- Both fed by the Binance WebSocket service (deferred to Part 3).
--
-- Stale-check policy: client/RPC computes (NOW() - received_at) and
-- compares against fee_config.speed_oracle_stale_seconds (2). No is_stale
-- column to keep stale-vs-not in single source of truth (the timestamp).
-- ============================================================================

-- ── Rolling tick history (TWAP source) ──────────────────────────────────────

CREATE TABLE speed_oracle_ticks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset           speed_asset NOT NULL,
  source          TEXT NOT NULL DEFAULT 'binance',
  price           DECIMAL(18,8) NOT NULL CHECK (price > 0),
  ts              TIMESTAMPTZ NOT NULL,           -- exchange-reported timestamp
  received_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_speed_oracle_asset_ts ON speed_oracle_ticks(asset, ts DESC);

-- Catch obvious dupes from WS reconnects/replays
CREATE UNIQUE INDEX idx_speed_oracle_ticks_dedupe
  ON speed_oracle_ticks(asset, ts, source);

-- ── Latest tick cache (fast read path) ─────────────────────────────────────

CREATE TABLE speed_oracle_latest (
  asset           speed_asset PRIMARY KEY,
  source          TEXT NOT NULL DEFAULT 'binance',
  price           DECIMAL(18,8) NOT NULL CHECK (price > 0),
  ts              TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE speed_oracle_ticks IS
'Rolling 5-min history of Binance ticks. Source for TWAP at market expiry. Pruned aggressively by maintenance cron.';
COMMENT ON TABLE speed_oracle_latest IS
'Last-write-wins cache, one row per asset. Public-read RLS so user app can display live prices without hitting auth.';
