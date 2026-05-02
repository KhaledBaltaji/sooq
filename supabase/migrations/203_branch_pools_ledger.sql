-- ============================================================
-- 203: S2 Branch System — branch_pools append-only ledger
--
-- Every branch pool balance change is recorded here.
-- pool_balance on branches is a cache; this is the source of truth.
-- Append-only: no UPDATE or DELETE allowed.
-- ============================================================

CREATE TYPE branch_pool_entry_type AS ENUM (
  'credit',           -- admin/agent credits pool
  'trade_buy',        -- user buy: net canonical amount after markup
  'trade_sell',       -- user sell: pool pays out proceeds
  'exit_fee',         -- exit fee retained by pool on sell
  'resolution_payout',-- winner payout at resolution
  'resolution_fee',   -- SOOQ branch fee deducted at resolution
  'void_refund',      -- void market refund
  'withdrawal',       -- branch operator withdrawal
  'withdrawal_fee',   -- 1% withdrawal fee retained
  'payback_sweep',    -- sweep from inflow during payback mode
  'adjustment'        -- admin manual adjustment
);

CREATE TABLE branch_pools (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  market_id       UUID REFERENCES markets(id),
  type            branch_pool_entry_type NOT NULL,
  amount          DECIMAL(18,2) NOT NULL,
  balance_after   DECIMAL(18,2) NOT NULL,
  reference_id    UUID,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branch_pools_branch ON branch_pools(branch_id);
CREATE INDEX idx_branch_pools_branch_market ON branch_pools(branch_id, market_id);
CREATE INDEX idx_branch_pools_created ON branch_pools(created_at DESC);

-- Append-only: prevent updates and deletes
CREATE OR REPLACE FUNCTION prevent_branch_pools_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'branch_pools is append-only: % not allowed', TG_OP;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_branch_pools_no_update
  BEFORE UPDATE ON branch_pools
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();

CREATE TRIGGER trg_branch_pools_no_delete
  BEFORE DELETE ON branch_pools
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();
