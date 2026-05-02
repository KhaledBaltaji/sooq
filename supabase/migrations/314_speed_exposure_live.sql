-- ============================================================================
-- 314_speed_exposure_live.sql
--
-- Two denormalized exposure caches refreshed by triggers on speed_positions:
--
-- 1. speed_exposure_live — per (branch, asset). Used by the operations
--    panel (per-branch row) and branch dashboard.
-- 2. speed_market_exposure_live — per (market). Used by the operations
--    panel for per-market drilldown.
--
-- Trigger logic deferred to Part 3 (it depends on speed_branches.speed_pool_balance
-- math which is RPC-level). These tables exist as schema-only structures here.
-- ============================================================================

CREATE TABLE speed_exposure_live (
  branch_id               UUID NOT NULL REFERENCES branches(id) ON DELETE RESTRICT,
  asset                   speed_asset NOT NULL,
  open_over_notional      DECIMAL(18,2) NOT NULL DEFAULT 0,
  open_under_notional     DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_notional            DECIMAL(18,2) NOT NULL DEFAULT 0,    -- over - under (signed)
  open_position_count     INTEGER NOT NULL DEFAULT 0,
  utilization_pct         DECIMAL(8,4) NOT NULL DEFAULT 0,     -- net_notional / speed_pool_balance
  last_updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, asset)
);

CREATE TABLE speed_market_exposure_live (
  market_id                 UUID PRIMARY KEY REFERENCES speed_markets(id) ON DELETE CASCADE,
  asset                     speed_asset NOT NULL,
  net_notional              DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_qty                   DECIMAL(18,8) NOT NULL DEFAULT 0,
  open_position_count       INTEGER NOT NULL DEFAULT 0,
  branch_breakdown          JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Format: [{"branch_id": "uuid|null", "net_notional": 12345.67, "count": 47}, ...]
  -- "uuid" for reseller branches, "null" string for SOOQ main pool aggregate.
  last_updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_speed_market_exposure_asset
  ON speed_market_exposure_live(asset);

COMMENT ON TABLE speed_exposure_live IS
'Per (branch, asset) exposure cache. Updated by trigger on speed_positions in Part 3 RPC migration.';
COMMENT ON TABLE speed_market_exposure_live IS
'Per (market) exposure cache. Powers the operations dashboard per-market drilldown.';
