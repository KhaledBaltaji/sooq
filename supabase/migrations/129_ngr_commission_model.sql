-- 122_ngr_commission_model.sql — NGR-based commission model
-- Agents earn % of TOTAL platform revenue (not just explicit fee).
-- Tiers based on network volume, not signup count.
-- Commission settled per-trade in real-time.

BEGIN;

-- ============================================================
-- 1. users — Add network volume tracking for tier advancement
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS network_volume DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 2. referral_commissions — Rename column + add revenue type
-- ============================================================

-- Rename to reflect new commission basis (total platform revenue, not just explicit fee)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'referral_commissions' AND column_name = 'explicit_fee_amount') THEN
    ALTER TABLE referral_commissions RENAME COLUMN explicit_fee_amount TO platform_revenue_amount;
  END IF;
END $$;

-- Distinguish trade-time vs resolution-time commissions
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS revenue_type TEXT NOT NULL DEFAULT 'trade';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.check_constraints WHERE constraint_name = 'chk_revenue_type') THEN
    ALTER TABLE referral_commissions ADD CONSTRAINT chk_revenue_type CHECK (revenue_type IN ('trade', 'resolution'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rc_revenue_type ON referral_commissions(revenue_type);

-- ============================================================
-- 3. fee_config — Replace v3_commission with NGR commission rates
-- ============================================================

-- Delete old fee-based commission rates
DELETE FROM fee_config WHERE fee_type = 'v3_commission';
DELETE FROM fee_config WHERE fee_type IN ('ngr_commission', 'ngr_resolution_commission');

-- NGR Trade Commission: % of total platform revenue per trade
-- All layers now scale with agent tier (L2/L3 no longer flat)

-- Layer 1 (Direct)
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_commission', 1, 1, 0.200000, 'Tier 1, Layer 1 (Direct): 20% of platform revenue'),
  ('ngr_commission', 2, 1, 0.250000, 'Tier 2, Layer 1 (Direct): 25% of platform revenue'),
  ('ngr_commission', 3, 1, 0.350000, 'Tier 3, Layer 1 (Direct): 35% of platform revenue'),
  ('ngr_commission', 4, 1, 0.450000, 'Tier 4, Layer 1 (Direct): 45% of platform revenue');

-- Layer 2 (Indirect) — scales with tier
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_commission', 1, 2, 0.050000, 'Tier 1, Layer 2 (Indirect): 5% of platform revenue'),
  ('ngr_commission', 2, 2, 0.080000, 'Tier 2, Layer 2 (Indirect): 8% of platform revenue'),
  ('ngr_commission', 3, 2, 0.100000, 'Tier 3, Layer 2 (Indirect): 10% of platform revenue'),
  ('ngr_commission', 4, 2, 0.150000, 'Tier 4, Layer 2 (Indirect): 15% of platform revenue');

-- Layer 3 (Deep) — scales with tier
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_commission', 1, 3, 0.020000, 'Tier 1, Layer 3 (Deep): 2% of platform revenue'),
  ('ngr_commission', 2, 3, 0.030000, 'Tier 2, Layer 3 (Deep): 3% of platform revenue'),
  ('ngr_commission', 3, 3, 0.050000, 'Tier 3, Layer 3 (Deep): 5% of platform revenue'),
  ('ngr_commission', 4, 3, 0.070000, 'Tier 4, Layer 3 (Deep): 7% of platform revenue');

-- NGR Resolution Commission: same rates, applied to resolution fee revenue
-- (resolution fee only known at market resolution, settled separately)

-- Layer 1 (Direct)
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_resolution_commission', 1, 1, 0.200000, 'Tier 1, Layer 1: 20% of resolution fee revenue'),
  ('ngr_resolution_commission', 2, 1, 0.250000, 'Tier 2, Layer 1: 25% of resolution fee revenue'),
  ('ngr_resolution_commission', 3, 1, 0.350000, 'Tier 3, Layer 1: 35% of resolution fee revenue'),
  ('ngr_resolution_commission', 4, 1, 0.450000, 'Tier 4, Layer 1: 45% of resolution fee revenue');

-- Layer 2 (Indirect)
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_resolution_commission', 1, 2, 0.050000, 'Tier 1, Layer 2: 5% of resolution fee revenue'),
  ('ngr_resolution_commission', 2, 2, 0.080000, 'Tier 2, Layer 2: 8% of resolution fee revenue'),
  ('ngr_resolution_commission', 3, 2, 0.100000, 'Tier 3, Layer 2: 10% of resolution fee revenue'),
  ('ngr_resolution_commission', 4, 2, 0.150000, 'Tier 4, Layer 2: 15% of resolution fee revenue');

-- Layer 3 (Deep)
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('ngr_resolution_commission', 1, 3, 0.020000, 'Tier 1, Layer 3: 2% of resolution fee revenue'),
  ('ngr_resolution_commission', 2, 3, 0.030000, 'Tier 2, Layer 3: 3% of resolution fee revenue'),
  ('ngr_resolution_commission', 3, 3, 0.050000, 'Tier 3, Layer 3: 5% of resolution fee revenue'),
  ('ngr_resolution_commission', 4, 3, 0.070000, 'Tier 4, Layer 3: 7% of resolution fee revenue');

-- ============================================================
-- 4. Validation: Ensure all 24 NGR commission rows exist
-- ============================================================

DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_commission';
  IF v_count != 12 THEN
    RAISE EXCEPTION 'Expected 12 ngr_commission rows, found %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_resolution_commission';
  IF v_count != 12 THEN
    RAISE EXCEPTION 'Expected 12 ngr_resolution_commission rows, found %', v_count;
  END IF;
END $$;

COMMIT;
