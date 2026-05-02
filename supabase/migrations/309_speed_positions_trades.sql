-- ============================================================================
-- 309_speed_positions_trades.sql
--
-- speed_positions: one row per OPEN position. Multi-position stacking is
-- ALLOWED (no UNIQUE on user+market). Users can tap-tap-tap multiple bets
-- on the same market on the same side; each row has its own entry odds and
-- time. Per-side cap enforcement happens at trade-time RPC by SUMming open
-- positions per (user, market, side).
--
-- speed_trades: per-trade audit log. Partitioned by created_at (daily).
-- Cash-cow volume justifies partitioning from day 1.
-- branch_id can be NULL (retail and commission-branch users) or set
-- (reseller-branch users — variance routes to that branch's pool).
-- ============================================================================

-- ── speed_positions ────────────────────────────────────────────────────────

CREATE TABLE speed_positions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  market_id           UUID NOT NULL REFERENCES speed_markets(id) ON DELETE RESTRICT,
  branch_id           UUID REFERENCES branches(id) ON DELETE RESTRICT,
  -- branch_id is NULL for retail and commission-branch users (variance to SOOQ main)
  -- branch_id is set to reseller_branch_id for reseller-branch users

  side                TEXT NOT NULL CHECK (side IN ('over', 'under')),
  stake               DECIMAL(18,2) NOT NULL CHECK (stake > 0),

  entry_price         DECIMAL(18,8) NOT NULL,         -- spot price at open
  entry_fair_prob     DECIMAL(8,6) NOT NULL,          -- fair probability at open
  entry_offered_prob  DECIMAL(8,6) NOT NULL,          -- offered prob (after spread)

  status              speed_position_status NOT NULL DEFAULT 'open',
  payout_amount       DECIMAL(18,2),                  -- credited at close (cashout, won, refund)
  closed_at           TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO UNIQUE constraint on (user_id, market_id) — multi-position stacking allowed
);

CREATE INDEX idx_speed_positions_market_open
  ON speed_positions(market_id) WHERE status = 'open';
CREATE INDEX idx_speed_positions_branch_market_open
  ON speed_positions(branch_id, market_id) WHERE status = 'open';
CREATE INDEX idx_speed_positions_user_recent
  ON speed_positions(user_id, created_at DESC);

-- Per-side cap pre-trade lookup (the most-frequent index)
CREATE INDEX idx_speed_positions_user_market_side_open
  ON speed_positions(user_id, market_id, side) WHERE status = 'open';

COMMENT ON TABLE speed_positions IS
'User position rows. Multi-position stacking allowed (no UNIQUE). Cashout is per-position. branch_id NULL for retail / commission-branch users (variance to SOOQ main). Set for reseller-branch users.';

-- ── speed_trades (PARTITIONED daily) ───────────────────────────────────────

CREATE TABLE speed_trades (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  position_id         UUID NOT NULL REFERENCES speed_positions(id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  market_id           UUID NOT NULL REFERENCES speed_markets(id) ON DELETE RESTRICT,
  branch_id           UUID REFERENCES branches(id) ON DELETE RESTRICT,

  kind                speed_trade_kind NOT NULL,
  amount              DECIMAL(18,2) NOT NULL,         -- stake (open) or cashout payout

  spot_price          DECIMAL(18,8) NOT NULL,
  fair_prob           DECIMAL(8,6) NOT NULL,
  offered_prob        DECIMAL(8,6) NOT NULL,

  handle_fee          DECIMAL(18,2) NOT NULL DEFAULT 0,
  cashout_multiplier  DECIMAL(5,4),                   -- only on kind='cashout'

  idempotency_key     TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_speed_trades_market_created ON speed_trades(market_id, created_at);
CREATE INDEX idx_speed_trades_branch_created ON speed_trades(branch_id, created_at);
CREATE INDEX idx_speed_trades_user_created ON speed_trades(user_id, created_at DESC);

-- Idempotency lookup: lookup-only index, NOT a UNIQUE constraint.
-- Partitioned tables can't have UNIQUE without the partition key.
-- The speed_execute_trade RPC enforces idempotency by SELECT-checking this
-- index before inserting (with FOR UPDATE on the matching row if found).
CREATE INDEX idx_speed_trades_idempotency
  ON speed_trades(branch_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── Partition extender helper ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _speed_create_trade_partitions(p_target_date DATE)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_partition_name TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  v_start := p_target_date::TIMESTAMPTZ;
  v_end := (p_target_date + INTERVAL '1 day')::TIMESTAMPTZ;
  v_partition_name := 'speed_trades_' || to_char(p_target_date, 'YYYYMMDD');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF speed_trades FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start, v_end
  );
END;
$$;

-- Initial partitions: today + next 7 days (8 total)
DO $$
DECLARE i INTEGER;
BEGIN
  FOR i IN 0..7 LOOP
    PERFORM _speed_create_trade_partitions((CURRENT_DATE + i)::DATE);
  END LOOP;
END $$;

COMMENT ON FUNCTION _speed_create_trade_partitions(DATE) IS
'Creates the speed_trades partition for the given date if missing. Called by maintenance cron daily and by tests.';
