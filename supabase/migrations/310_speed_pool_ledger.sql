-- ============================================================================
-- 310_speed_pool_ledger.sql
--
-- Append-only ledger for speed-market money flows. Partitioned daily.
-- Source of truth for branch pool balances and SOOQ main pool balance.
--
-- branch_id NULL = SOOQ main pool (retail + commission-branch user variance).
-- branch_id set = reseller branch's pool (variance + fee_share posts here).
--
-- Three trackers shown to branch operators are computed views over this:
--   User Book P&L = SUM(stake_in + winning_payout + cashout_out + refund)
--   Fee Revenue   = SUM(fee_share_in)
--   Collateral    = SUM(collateral_credit + collateral_withdraw + admin_withdrawal_discretionary + fee_withdrawal_self)
--
-- Append-only enforced via BEFORE UPDATE/DELETE trigger.
-- ============================================================================

CREATE TABLE speed_pool_ledger (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  branch_id       UUID REFERENCES branches(id) ON DELETE RESTRICT,
  -- NULL = SOOQ main pool (retail + commission-branch user activity)
  market_id       UUID REFERENCES speed_markets(id) ON DELETE RESTRICT,
  type            speed_pool_entry_type NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  balance_after   DECIMAL(18,2) NOT NULL,
  reference_id    UUID,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

-- Indexes on the parent (propagated to partitions)
CREATE INDEX idx_speed_pool_branch_created
  ON speed_pool_ledger(branch_id, created_at DESC);
CREATE INDEX idx_speed_pool_branch_market_created
  ON speed_pool_ledger(branch_id, market_id, created_at DESC);
CREATE INDEX idx_speed_pool_branch_type_created
  ON speed_pool_ledger(branch_id, type, created_at DESC);
-- The third index supports the three-tracker dashboard queries.

-- ── Append-only enforcement ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION prevent_speed_pool_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'speed_pool_ledger is append-only: % not allowed', TG_OP;
END;
$$;

CREATE TRIGGER trg_speed_pool_ledger_no_update
  BEFORE UPDATE ON speed_pool_ledger
  FOR EACH ROW
  EXECUTE FUNCTION prevent_speed_pool_ledger_mutation();

CREATE TRIGGER trg_speed_pool_ledger_no_delete
  BEFORE DELETE ON speed_pool_ledger
  FOR EACH ROW
  EXECUTE FUNCTION prevent_speed_pool_ledger_mutation();

-- ── Partition extender helper + initial 8 days ─────────────────────────────

CREATE OR REPLACE FUNCTION _speed_create_pool_partitions(p_target_date DATE)
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
  v_partition_name := 'speed_pool_ledger_' || to_char(p_target_date, 'YYYYMMDD');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF speed_pool_ledger FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start, v_end
  );
END;
$$;

DO $$ DECLARE i INTEGER;
BEGIN
  FOR i IN 0..7 LOOP
    PERFORM _speed_create_pool_partitions((CURRENT_DATE + i)::DATE);
  END LOOP;
END $$;

COMMENT ON TABLE speed_pool_ledger IS
'Append-only ledger for speed-market money flows. branch_id NULL = SOOQ main pool. Partitioned daily.';
COMMENT ON FUNCTION _speed_create_pool_partitions(DATE) IS
'Creates the speed_pool_ledger partition for the given date if missing. Called by maintenance cron daily and by tests.';
