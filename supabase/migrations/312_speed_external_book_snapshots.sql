-- ============================================================================
-- 312_speed_external_book_snapshots.sql
--
-- Daily snapshots of SOOQ's hedge book at Binance Futures (or any external
-- venue). Admin-only — these are SOOQ's internal accounting records.
-- Branches never see this data.
--
-- venue is plain TEXT (not enum) so future broker integrations don't need
-- a schema migration to add a new venue label.
-- ============================================================================

CREATE TABLE speed_external_book_snapshots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset                       speed_asset NOT NULL,
  venue                       TEXT NOT NULL DEFAULT 'binance_futures',

  snapshot_at                 TIMESTAMPTZ NOT NULL,

  net_position_qty            DECIMAL(18,8) NOT NULL DEFAULT 0,  -- + long, − short, in BTC/ETH
  avg_entry_price             DECIMAL(18,8),
  mark_price                  DECIMAL(18,8),

  unrealized_pnl_usd          DECIMAL(18,2),
  realized_pnl_since_last     DECIMAL(18,2),
  funding_paid_since_last     DECIMAL(18,2) DEFAULT 0,

  margin_balance_usd          DECIMAL(18,2),

  recorded_by                 UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes                       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_speed_book_snapshots_asset_at
  ON speed_external_book_snapshots(asset, snapshot_at DESC);

CREATE INDEX idx_speed_book_snapshots_venue_at
  ON speed_external_book_snapshots(venue, snapshot_at DESC);

COMMENT ON TABLE speed_external_book_snapshots IS
'SOOQ-only audit table. Daily snapshots of hedge book state at external venue. Admin-only RLS. Branches do NOT see this data.';
