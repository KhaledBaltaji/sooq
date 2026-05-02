-- ============================================================
-- 206: S2 Branch System — branch_trades audit table
--
-- Every branch trade writes to both `trades` (canonical) and
-- `branch_trades` (branch-specific audit trail). This table stores
-- the markup extraction, quote shown to user, and idempotency key.
-- Append-only.
-- ============================================================

CREATE TABLE branch_trades (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id                        UUID NOT NULL REFERENCES trades(id),
  branch_id                       UUID NOT NULL REFERENCES branches(id),
  agent_id                        UUID REFERENCES branch_agents(id),
  user_id                         UUID NOT NULL REFERENCES users(id),
  market_id                       UUID NOT NULL REFERENCES markets(id),

  -- Gross vs net split (Section 5)
  gross_amount                    DECIMAL(18,2) NOT NULL,
  branch_markup                   DECIMAL(18,2) NOT NULL CHECK (branch_markup >= 0),
  net_canonical_amount            DECIMAL(18,2) NOT NULL,

  -- Quote shown to branch user (price or odds depending on display mode)
  branch_quote_shown              DECIMAL(10,6),

  -- Canonical prices pre/post trade (for audit trail)
  canonical_pre_yes_price         DECIMAL(10,6) NOT NULL,
  canonical_pre_no_price          DECIMAL(10,6) NOT NULL,
  canonical_post_yes_price        DECIMAL(10,6) NOT NULL,
  canonical_post_no_price         DECIMAL(10,6) NOT NULL,

  -- Execution outcome
  shares_issued                   DECIMAL(18,6) NOT NULL CHECK (shares_issued > 0),

  -- Idempotency (Section 5)
  idempotency_key                 TEXT NOT NULL,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT branch_trades_idempotency UNIQUE (branch_id, idempotency_key)
);

CREATE INDEX idx_branch_trades_branch ON branch_trades(branch_id);
CREATE INDEX idx_branch_trades_branch_market ON branch_trades(branch_id, market_id);
CREATE INDEX idx_branch_trades_trade ON branch_trades(trade_id);
CREATE INDEX idx_branch_trades_user ON branch_trades(user_id);

-- Append-only: prevent updates and deletes
CREATE TRIGGER trg_branch_trades_no_update
  BEFORE UPDATE ON branch_trades
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();

CREATE TRIGGER trg_branch_trades_no_delete
  BEFORE DELETE ON branch_trades
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();
