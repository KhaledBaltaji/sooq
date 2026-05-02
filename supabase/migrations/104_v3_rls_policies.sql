-- 104_v3_rls_policies.sql — V3 Migration: RLS policies for all new tables
-- Pattern from supabase/migrations/040_rls_policies.sql

BEGIN;

-- ============================================================
-- 1. amm_state — Public read, no direct inserts/updates (via RPCs)
-- ============================================================

ALTER TABLE amm_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read AMM state"
  ON amm_state FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage AMM state"
  ON amm_state FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 2. trades — Users read own + all for activity feed, no direct inserts
-- ============================================================

ALTER TABLE trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read trades"
  ON trades FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage trades"
  ON trades FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 3. positions — Users read own, no direct inserts/updates
-- ============================================================

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own positions"
  ON positions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage positions"
  ON positions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 4. price_alerts — Users CRUD own alerts
-- ============================================================

ALTER TABLE price_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own price alerts"
  ON price_alerts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own price alerts"
  ON price_alerts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own price alerts"
  ON price_alerts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own price alerts"
  ON price_alerts FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage price alerts"
  ON price_alerts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 5. copy_settings — Users CRUD own settings
-- ============================================================

ALTER TABLE copy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own copy settings"
  ON copy_settings FOR SELECT
  USING (auth.uid() = copier_id);

CREATE POLICY "Leaders can see who copies them"
  ON copy_settings FOR SELECT
  USING (auth.uid() = leader_id);

CREATE POLICY "Users can create own copy settings"
  ON copy_settings FOR INSERT
  WITH CHECK (auth.uid() = copier_id);

CREATE POLICY "Users can update own copy settings"
  ON copy_settings FOR UPDATE
  USING (auth.uid() = copier_id)
  WITH CHECK (auth.uid() = copier_id);

CREATE POLICY "Users can delete own copy settings"
  ON copy_settings FOR DELETE
  USING (auth.uid() = copier_id);

CREATE POLICY "Service role can manage copy settings"
  ON copy_settings FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 6. leader_stats — Public read (leaderboard), no direct writes
-- ============================================================

ALTER TABLE leader_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read leader stats"
  ON leader_stats FOR SELECT
  USING (true);

CREATE POLICY "Service role can manage leader stats"
  ON leader_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================
-- 7. user_locations — Users read/write own only
-- ============================================================

ALTER TABLE user_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own location"
  ON user_locations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own location"
  ON user_locations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own location"
  ON user_locations FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read all locations"
  ON user_locations FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = true)
  );

COMMIT;
