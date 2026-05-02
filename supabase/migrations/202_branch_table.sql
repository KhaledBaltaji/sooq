-- ============================================================
-- 202: S2 Branch System — branches table
--
-- Core entity for branch operators (bookmakers/agents).
-- Each branch has its own pool, markup config, and solvency tracking.
-- Status enum drives the branch lifecycle: active → payback → frozen → suspended.
-- ============================================================

-- Branch status lifecycle
CREATE TYPE branch_status AS ENUM ('active', 'payback', 'frozen', 'suspended');

-- Display mode for white-label routes
CREATE TYPE branch_display_mode AS ENUM ('trading', 'betting');

CREATE TABLE branches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code         TEXT NOT NULL,
  name                TEXT NOT NULL,
  status              branch_status NOT NULL DEFAULT 'active',
  manager_user_id     UUID NOT NULL REFERENCES users(id),

  -- Markup config (flat per-side, applied before LMSR execution)
  yes_markup_pct      DECIMAL(5,4) NOT NULL DEFAULT 0.0500,
  no_markup_pct       DECIMAL(5,4) NOT NULL DEFAULT 0.0500,

  -- Branch fee rate on gross buy volume (SOOQ's cut)
  branch_fee_rate     DECIMAL(8,6) NOT NULL DEFAULT 0.050000,

  -- Exit fee on cash-out (sell) proceeds
  exit_fee_pct        DECIMAL(5,4) NOT NULL DEFAULT 0.0050,

  -- Display mode for white-label routes
  display_mode        branch_display_mode NOT NULL DEFAULT 'betting',

  -- Cash-out toggle (branch-wide default, can be overridden per-market)
  cash_out_enabled    BOOLEAN NOT NULL DEFAULT true,

  -- Pool balance cache (source of truth is SUM(branch_pools))
  pool_balance        DECIMAL(18,2) NOT NULL DEFAULT 0
    CHECK (pool_balance >= 0),

  -- Solvency tracking (Section 23)
  worst_case_total    DECIMAL(18,2) NOT NULL DEFAULT 0
    CHECK (worst_case_total >= 0),
  pending_payouts     DECIMAL(18,2) NOT NULL DEFAULT 0
    CHECK (pending_payouts >= 0),

  -- Default position caps per user per side (nullable = no cap)
  default_position_cap_yes DECIMAL(18,2),
  default_position_cap_no  DECIMAL(18,2),

  -- Solvency override (admin can loosen gate temporarily)
  solvency_override_pct    DECIMAL(5,4),
  solvency_override_until  TIMESTAMPTZ,
  solvency_override_by     UUID REFERENCES users(id),

  -- Payback mode tracking
  payback_activated_at     TIMESTAMPTZ,
  payback_reason           TEXT,

  -- Suspension
  suspension_reason        TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT branches_code_unique UNIQUE (branch_code),
  CONSTRAINT branches_markup_valid CHECK (
    yes_markup_pct >= 0 AND yes_markup_pct <= 0.5000 AND
    no_markup_pct >= 0 AND no_markup_pct <= 0.5000
  ),
  CONSTRAINT branches_fee_rate_valid CHECK (
    branch_fee_rate >= 0 AND branch_fee_rate <= 0.200000
  )
);

CREATE INDEX idx_branches_manager ON branches(manager_user_id);
CREATE INDEX idx_branches_status ON branches(status);
CREATE INDEX idx_branches_code ON branches(branch_code);

-- Auto-update updated_at
CREATE TRIGGER branches_updated_at
  BEFORE UPDATE ON branches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
