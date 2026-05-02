-- ============================================================
-- 207a: S2 Branch System — Supporting tables
--
-- branch_market_config: per-branch per-market overrides
-- branch_admin_overrides: audit trail for admin overrides
-- credit_chain_ledger: append-only money flow trail
-- ============================================================

-- ============================================================
-- 1. branch_market_config — per-branch market toggles + caps
-- ============================================================

CREATE TABLE branch_market_config (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id               UUID NOT NULL REFERENCES branches(id),
  market_id               UUID NOT NULL REFERENCES markets(id),
  is_enabled              BOOLEAN NOT NULL DEFAULT true,
  cash_out_enabled        BOOLEAN,  -- NULL = inherit branch default
  position_cap_yes        DECIMAL(18,2),  -- NULL = inherit branch default
  position_cap_no         DECIMAL(18,2),  -- NULL = inherit branch default
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT branch_market_config_unique UNIQUE (branch_id, market_id)
);

CREATE INDEX idx_branch_market_config_branch ON branch_market_config(branch_id);

CREATE TRIGGER branch_market_config_updated_at
  BEFORE UPDATE ON branch_market_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2. branch_admin_overrides — audit trail (Section 20, 25, 36)
-- ============================================================

CREATE TYPE branch_override_type AS ENUM (
  'solvency_gate_loosened',
  'withdrawal_lock_bypassed',
  'status_change',
  'pool_adjustment',
  'config_change'
);

CREATE TABLE branch_admin_overrides (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id        UUID NOT NULL REFERENCES users(id),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  override_type   branch_override_type NOT NULL,
  note            TEXT NOT NULL,  -- Mandatory per Section 25, 36
  previous_value  JSONB,
  new_value       JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_branch_admin_overrides_branch ON branch_admin_overrides(branch_id);
CREATE INDEX idx_branch_admin_overrides_created ON branch_admin_overrides(created_at DESC);

-- Append-only
CREATE TRIGGER trg_branch_admin_overrides_no_update
  BEFORE UPDATE ON branch_admin_overrides
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();

CREATE TRIGGER trg_branch_admin_overrides_no_delete
  BEFORE DELETE ON branch_admin_overrides
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();

-- ============================================================
-- 3. credit_chain_ledger — downward-only money flow (Section 13)
-- ============================================================

CREATE TYPE credit_chain_role AS ENUM (
  'admin', 'branch_manager', 'agent', 'sub_agent', 'user'
);

CREATE TABLE credit_chain_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id       UUID NOT NULL REFERENCES branches(id),
  issuer_id       UUID NOT NULL REFERENCES users(id),
  recipient_id    UUID NOT NULL REFERENCES users(id),
  issuer_role     credit_chain_role NOT NULL,
  recipient_role  credit_chain_role NOT NULL,
  amount          DECIMAL(18,2) NOT NULL CHECK (amount > 0),
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_credit_chain_branch ON credit_chain_ledger(branch_id);
CREATE INDEX idx_credit_chain_issuer ON credit_chain_ledger(issuer_id);
CREATE INDEX idx_credit_chain_recipient ON credit_chain_ledger(recipient_id);
CREATE INDEX idx_credit_chain_created ON credit_chain_ledger(created_at DESC);

-- Append-only
CREATE TRIGGER trg_credit_chain_no_update
  BEFORE UPDATE ON credit_chain_ledger
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();

CREATE TRIGGER trg_credit_chain_no_delete
  BEFORE DELETE ON credit_chain_ledger
  FOR EACH ROW
  EXECUTE FUNCTION prevent_branch_pools_mutation();
