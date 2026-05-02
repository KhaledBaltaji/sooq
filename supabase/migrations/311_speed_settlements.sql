-- ============================================================================
-- 311_speed_settlements.sql
--
-- Per-position settlement record. PRIMARY KEY position_id makes resolution
-- chunking idempotent: the resolve_market RPC can retry without double-paying.
--
-- One row per position when it transitions out of 'open' (won, lost,
-- cashed_out, refunded). The row records the outcome and final payout.
--
-- This is NOT the speed_pool_ledger — that records money movements.
-- speed_settlements records the EVENT of a position being settled, used
-- as an idempotency anchor for the resolution worker.
-- ============================================================================

CREATE TABLE speed_settlements (
  position_id     UUID PRIMARY KEY REFERENCES speed_positions(id) ON DELETE CASCADE,
  market_id       UUID NOT NULL REFERENCES speed_markets(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  branch_id       UUID REFERENCES branches(id) ON DELETE RESTRICT,
  outcome         speed_market_outcome NOT NULL,
  payout_amount   DECIMAL(18,2) NOT NULL,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_speed_settlements_market ON speed_settlements(market_id);
CREATE INDEX idx_speed_settlements_branch ON speed_settlements(branch_id) WHERE branch_id IS NOT NULL;

COMMENT ON TABLE speed_settlements IS
'Per-position settlement record. PK position_id makes the resolve worker idempotent on retry.';
