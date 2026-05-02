-- ============================================================
-- 204: S2 Branch System — branch_agents table
--
-- Branch agents are SEPARATE from V1 referral agents.
-- Two types: P/L (share of net profit/loss) and commission (flat % of buy volume).
-- Supports sub-agent hierarchy via parent_agent_id.
-- ============================================================

CREATE TYPE branch_agent_type AS ENUM ('pl', 'commission');

CREATE TABLE branch_agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id         UUID NOT NULL REFERENCES branches(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  parent_agent_id   UUID REFERENCES branch_agents(id),
  agent_type        branch_agent_type NOT NULL,
  rate              DECIMAL(8,6) NOT NULL CHECK (rate > 0 AND rate <= 1.000000),
  deposit_required  DECIMAL(18,2) NOT NULL DEFAULT 0,
  deposit_held      DECIMAL(18,2) NOT NULL DEFAULT 0 CHECK (deposit_held >= 0),
  cumulative_pl     DECIMAL(18,2) NOT NULL DEFAULT 0,
  referral_code     TEXT,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT branch_agents_unique_user_branch UNIQUE (user_id, branch_id),
  CONSTRAINT branch_agents_referral_code_unique UNIQUE (referral_code)
);

CREATE INDEX idx_branch_agents_branch ON branch_agents(branch_id);
CREATE INDEX idx_branch_agents_user ON branch_agents(user_id);
CREATE INDEX idx_branch_agents_parent ON branch_agents(parent_agent_id);

CREATE TRIGGER branch_agents_updated_at
  BEFORE UPDATE ON branch_agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
