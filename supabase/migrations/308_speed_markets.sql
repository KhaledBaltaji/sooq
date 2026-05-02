-- ============================================================================
-- 308_speed_markets.sql
--
-- Speed market entity. Continuously rolling per (asset, duration). Strike
-- is set at opens_at from the live oracle price. TWAP-resolved at expiry.
--
-- Design notes:
-- - No `lock_at` column (per Round 7 lock — no hard lock window). Pricing
--   math + cashout multipliers naturally discourage last-second action.
-- - At-strike outcome: both sides LOSE. No refund. Enum value 'at_strike'.
-- - twap_required CHECK forces the resolve flow to either compute a TWAP
--   from at least one tick OR void the market. No silent zero-data resolve.
-- ============================================================================

CREATE TABLE speed_markets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset                    speed_asset NOT NULL,
  duration                 speed_duration NOT NULL,
  strike_price             DECIMAL(18,8) NOT NULL CHECK (strike_price > 0),

  opens_at                 TIMESTAMPTZ NOT NULL,
  closes_at                TIMESTAMPTZ NOT NULL,

  status                   speed_market_status NOT NULL DEFAULT 'pending',
  outcome                  speed_market_outcome,

  -- TWAP fields (filled at resolution from speed_oracle_ticks)
  twap_settlement_price    DECIMAL(18,8),
  twap_window_start        TIMESTAMPTZ,
  twap_window_end          TIMESTAMPTZ,
  twap_tick_count          INTEGER,

  resolved_at              TIMESTAMPTZ,
  voided_at                TIMESTAMPTZ,
  void_reason              TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT speed_market_window CHECK (opens_at < closes_at),
  CONSTRAINT speed_market_resolved_has_outcome
    CHECK (status <> 'resolved' OR outcome IS NOT NULL),
  CONSTRAINT speed_market_twap_required
    CHECK (status <> 'resolved' OR twap_tick_count > 0)
);

CREATE INDEX idx_speed_markets_open ON speed_markets(asset, closes_at)
  WHERE status = 'open';

CREATE INDEX idx_speed_markets_resolving ON speed_markets(closes_at)
  WHERE status IN ('open', 'resolving');

CREATE INDEX idx_speed_markets_asset_status ON speed_markets(asset, status);

COMMENT ON TABLE speed_markets IS
'Speed-market entity. Continuously rolling per (asset, duration). Resolves automatically at expiry via TWAP from speed_oracle_ticks.';
COMMENT ON CONSTRAINT speed_market_twap_required ON speed_markets IS
'Schema-level guarantee that no market can be marked resolved without at least one TWAP tick. Forces resolve RPC to either gather data or void.';
