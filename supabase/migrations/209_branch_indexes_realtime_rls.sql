-- ============================================================
-- 209: S2 Branch System — Indexes, Realtime, RLS policies
--
-- Performance indexes on all branch FKs.
-- Add branch tables to Supabase Realtime publication.
-- RLS policies for all branch tables.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Additional indexes for branch queries
-- ============================================================

-- branch_id on existing tables (for filtering retail vs branch)
CREATE INDEX idx_trades_branch ON trades(branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX idx_positions_branch ON positions(branch_id) WHERE branch_id IS NOT NULL;

-- Composite index for solvency reconciliation cron (Eng Review #9)
-- Already created in 203: idx_branch_pools_branch_market

-- ============================================================
-- 2. Realtime publication (same pattern as 105, 188)
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE branches;
ALTER PUBLICATION supabase_realtime ADD TABLE branch_pools;

-- ============================================================
-- 3. RLS policies — branches
-- ============================================================

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branches"
  ON branches FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all branches"
  ON branches FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can read own branch"
  ON branches FOR SELECT
  USING (auth.uid() = manager_user_id);

-- ============================================================
-- 4. RLS policies — branch_pools
-- ============================================================

ALTER TABLE branch_pools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_pools"
  ON branch_pools FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all branch_pools"
  ON branch_pools FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can read own pool"
  ON branch_pools FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_pools.branch_id AND manager_user_id = auth.uid()
  ));

-- ============================================================
-- 5. RLS policies — branch_agents
-- ============================================================

ALTER TABLE branch_agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_agents"
  ON branch_agents FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all branch_agents"
  ON branch_agents FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can read own agents"
  ON branch_agents FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_agents.branch_id AND manager_user_id = auth.uid()
  ));

CREATE POLICY "Agents can read own record"
  ON branch_agents FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 6. RLS policies — branch_user_assignments
-- ============================================================

ALTER TABLE branch_user_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_user_assignments"
  ON branch_user_assignments FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all assignments"
  ON branch_user_assignments FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Users can read own assignment"
  ON branch_user_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Branch managers can read own assignments"
  ON branch_user_assignments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_user_assignments.branch_id AND manager_user_id = auth.uid()
  ));

-- ============================================================
-- 7. RLS policies — branch_trades (restricted — audit details)
-- ============================================================

ALTER TABLE branch_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_trades"
  ON branch_trades FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all branch_trades"
  ON branch_trades FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can read own branch trades"
  ON branch_trades FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_trades.branch_id AND manager_user_id = auth.uid()
  ));

-- Users can see their own branch trade records (but not markup details of other users)
CREATE POLICY "Users can read own branch trades"
  ON branch_trades FOR SELECT
  USING (auth.uid() = user_id);

-- ============================================================
-- 8. RLS policies — branch_market_config
-- ============================================================

ALTER TABLE branch_market_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_market_config"
  ON branch_market_config FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all branch_market_config"
  ON branch_market_config FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can manage own config"
  ON branch_market_config FOR ALL
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_market_config.branch_id AND manager_user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM branches WHERE id = branch_market_config.branch_id AND manager_user_id = auth.uid()
  ));

-- ============================================================
-- 9. RLS policies — branch_admin_overrides (admin-only)
-- ============================================================

ALTER TABLE branch_admin_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on branch_admin_overrides"
  ON branch_admin_overrides FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all overrides"
  ON branch_admin_overrides FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

-- ============================================================
-- 10. RLS policies — credit_chain_ledger
-- ============================================================

ALTER TABLE credit_chain_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on credit_chain_ledger"
  ON credit_chain_ledger FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admins can read all credit_chain entries"
  ON credit_chain_ledger FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Branch managers can read own chain"
  ON credit_chain_ledger FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM branches WHERE id = credit_chain_ledger.branch_id AND manager_user_id = auth.uid()
  ));

CREATE POLICY "Users can read own credit entries"
  ON credit_chain_ledger FOR SELECT
  USING (auth.uid() = issuer_id OR auth.uid() = recipient_id);

COMMIT;
