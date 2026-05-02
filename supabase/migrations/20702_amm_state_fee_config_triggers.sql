-- ============================================================
-- 207c: S2 Branch System — amm_state columns, fee_config seeds,
-- protected column triggers on branches
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Add retail tracking columns to amm_state
-- ============================================================

ALTER TABLE amm_state
  ADD COLUMN retail_net_cash   DECIMAL(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN retail_shares_yes DECIMAL(18,6) NOT NULL DEFAULT 0,
  ADD COLUMN retail_shares_no  DECIMAL(18,6) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. Seed fee_config with branch-related rates
-- ============================================================

INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('branch_default_markup_yes', 0.050000, 'Default branch YES markup: 5%'),
  ('branch_default_markup_no', 0.050000, 'Default branch NO markup: 5%'),
  ('branch_default_rate', 0.050000, 'Default SOOQ branch fee rate: 5% of gross buy volume'),
  ('branch_withdrawal_fee', 0.010000, 'Branch withdrawal fee: 1%'),
  ('canonical_price_impact_cap', 0.050000, 'Max price impact per trade: 5%'),
  ('retail_exposure_cap_multiplier', 2.000000, 'Retail exposure cap: 2x liquidity_param per market')
ON CONFLICT (fee_type, level, depth) DO NOTHING;

-- ============================================================
-- 3. Add nullable branch_id to platform_revenue for unified accounting
-- ============================================================

ALTER TABLE platform_revenue
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

-- ============================================================
-- 4. Protected column trigger for branches table
--
-- Prevents non-service_role from modifying financial columns.
-- Same pattern as migration 041 for users.
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_sensitive_branch_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow service_role calls
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to financial/status columns
  IF NEW.pool_balance      IS DISTINCT FROM OLD.pool_balance
  OR NEW.worst_case_total  IS DISTINCT FROM OLD.worst_case_total
  OR NEW.pending_payouts   IS DISTINCT FROM OLD.pending_payouts
  OR NEW.status            IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'Cannot modify protected branch columns';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_sensitive_branch_columns
  BEFORE UPDATE ON branches
  FOR EACH ROW
  EXECUTE FUNCTION prevent_sensitive_branch_updates();

COMMIT;
