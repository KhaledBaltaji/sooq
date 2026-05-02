-- ============================================================================
-- 315_speed_rls_policies.sql
--
-- Row-Level Security policies for all speed_* tables. Uses the helper
-- functions is_admin() and is_branch_manager_of() from mig 306 to keep
-- policies short and DRY.
--
-- Policy access matrix:
--   Table                         Service  Admin   Branch mgr   User own   Public
--   speed_branches                ALL      SELECT  SELECT own   -          -
--   speed_markets                 ALL      ALL     -            -          SELECT
--   speed_positions               ALL      SELECT  SELECT own   SELECT     -
--   speed_trades                  ALL      SELECT  SELECT own   SELECT     -
--   speed_pool_ledger             ALL      SELECT  SELECT own   -          -
--   speed_settlements             ALL      SELECT  SELECT own   SELECT     -
--   speed_external_book_snapshots ALL      ALL     -            -          -  (admin only)
--   speed_oracle_ticks            ALL      SELECT  -            -          -  (admin only)
--   speed_oracle_latest           ALL      ALL     -            -          SELECT
--   speed_exposure_live           ALL      SELECT  SELECT own   -          -
--   speed_market_exposure_live    ALL      SELECT  -            -          -
-- ============================================================================

-- ── speed_branches ─────────────────────────────────────────────────────────
ALTER TABLE speed_branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_branches FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_branches FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_branches FOR SELECT
  USING (is_branch_manager_of(branch_id));

-- ── speed_markets ──────────────────────────────────────────────────────────
ALTER TABLE speed_markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_markets FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Public read" ON speed_markets FOR SELECT USING (true);
CREATE POLICY "Admin write" ON speed_markets FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ── speed_positions ────────────────────────────────────────────────────────
ALTER TABLE speed_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_positions FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_positions FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_positions FOR SELECT
  USING (branch_id IS NOT NULL AND is_branch_manager_of(branch_id));
CREATE POLICY "User read own" ON speed_positions FOR SELECT
  USING (auth.uid() = user_id);

-- ── speed_trades ───────────────────────────────────────────────────────────
ALTER TABLE speed_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_trades FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_trades FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_trades FOR SELECT
  USING (branch_id IS NOT NULL AND is_branch_manager_of(branch_id));
CREATE POLICY "User read own" ON speed_trades FOR SELECT
  USING (auth.uid() = user_id);

-- ── speed_pool_ledger ──────────────────────────────────────────────────────
ALTER TABLE speed_pool_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_pool_ledger FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_pool_ledger FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_pool_ledger FOR SELECT
  USING (branch_id IS NOT NULL AND is_branch_manager_of(branch_id));

-- ── speed_settlements ──────────────────────────────────────────────────────
ALTER TABLE speed_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_settlements FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_settlements FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_settlements FOR SELECT
  USING (branch_id IS NOT NULL AND is_branch_manager_of(branch_id));
CREATE POLICY "User read own" ON speed_settlements FOR SELECT
  USING (auth.uid() = user_id);

-- ── speed_external_book_snapshots (ADMIN ONLY) ─────────────────────────────
ALTER TABLE speed_external_book_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_external_book_snapshots FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin only" ON speed_external_book_snapshots FOR ALL
  USING (is_admin()) WITH CHECK (is_admin());

-- ── speed_oracle_ticks (ADMIN + service_role only) ─────────────────────────
ALTER TABLE speed_oracle_ticks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_oracle_ticks FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_oracle_ticks FOR SELECT USING (is_admin());

-- ── speed_oracle_latest (PUBLIC READ) ──────────────────────────────────────
ALTER TABLE speed_oracle_latest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_oracle_latest FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Public read" ON speed_oracle_latest FOR SELECT USING (true);

-- ── speed_exposure_live ────────────────────────────────────────────────────
ALTER TABLE speed_exposure_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_exposure_live FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_exposure_live FOR SELECT USING (is_admin());
CREATE POLICY "Branch manager read own" ON speed_exposure_live FOR SELECT
  USING (is_branch_manager_of(branch_id));

-- ── speed_market_exposure_live (admin-only — branch_breakdown is sensitive) ─
ALTER TABLE speed_market_exposure_live ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role all" ON speed_market_exposure_live FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Admin read" ON speed_market_exposure_live FOR SELECT USING (is_admin());
