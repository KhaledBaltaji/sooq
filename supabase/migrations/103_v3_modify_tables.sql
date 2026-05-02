-- 103_v3_modify_tables.sql — V3 Migration: Modify existing tables for AMM model

BEGIN;

-- ============================================================
-- 1. markets — Add AMM liquidity parameter
-- ============================================================

ALTER TABLE markets ADD COLUMN IF NOT EXISTS amm_liquidity_param DECIMAL(18,6) DEFAULT 1000;

-- ============================================================
-- 2. deposits — Rename threepay_ref → provider_ref, add provider column
-- ============================================================

-- Rename the column
ALTER TABLE deposits RENAME COLUMN threepay_ref TO provider_ref;

-- Add provider column (3pay or whish)
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT '3pay';

-- ============================================================
-- 3. referral_commissions — Replace V2 columns with V3 columns
-- ============================================================

-- Drop V2 column (net_exposure no longer used — V3 commissions are fee-based, not exposure-based)
ALTER TABLE referral_commissions DROP COLUMN IF EXISTS net_exposure;

-- Rename depth → layer for V3 clarity
ALTER TABLE referral_commissions RENAME COLUMN depth TO layer;

-- Add V3 columns
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS trade_id UUID REFERENCES trades(id);
ALTER TABLE referral_commissions ADD COLUMN IF NOT EXISTS explicit_fee_amount DECIMAL(18,6) NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_referral_commissions_trade ON referral_commissions(trade_id);

-- ============================================================
-- 4. platform_revenue — Add V3 5-layer revenue breakdown
-- ============================================================

ALTER TABLE platform_revenue ADD COLUMN IF NOT EXISTS explicit_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_revenue ADD COLUMN IF NOT EXISTS amm_spread_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_revenue ADD COLUMN IF NOT EXISTS resolution_fee_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_revenue ADD COLUMN IF NOT EXISTS dynamic_spread_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE platform_revenue ADD COLUMN IF NOT EXISTS cash_out_premium_revenue DECIMAL(18,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 5. fee_config — Widen rate column for AMM params, replace V2 entries
-- ============================================================

-- Widen rate column: DECIMAL(8,6) max=99.999999, too small for amm_default_b=1000
ALTER TABLE fee_config ALTER COLUMN rate TYPE DECIMAL(18,6);

-- Rename deposit index to match column rename
ALTER INDEX IF EXISTS idx_deposits_threepay_ref RENAME TO idx_deposits_provider_ref;

-- Add index on deposits.provider for multi-provider queries
CREATE INDEX IF NOT EXISTS idx_deposits_provider ON deposits(provider);

-- Delete all V2 fee config entries
DELETE FROM fee_config;

-- V3 Core Fees
INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('explicit_fee',      0.005000, 'V3: 0.5% explicit trading fee on every buy and sell'),
  ('resolution_fee',    0.010000, 'V3: 1% resolution fee — winning shares pay $0.99 not $1.00'),
  ('cash_out_premium',  0.005000, 'V3: 0.5% cash-out premium on sells'),
  ('deposit_fee',       0.000000, 'No deposit fee'),
  ('withdrawal_fee',    0.010000, '1% withdrawal fee');

-- V3 AMM Parameters
INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('amm_default_b',     1000.000000, 'Default liquidity parameter b for new markets'),
  ('amm_max_trade_pct', 0.050000,    'Max trade size as % of liquidity_param (5%)'),
  ('dynamic_spread_threshold', 0.650000, 'Imbalance threshold for dynamic spread widening (65/35)'),
  ('dynamic_spread_multiplier', 1.500000, 'Spread multiplier when imbalance exceeds threshold');

-- V3 Commission Rates: 4 tiers × 3 layers
-- Layer 1 (direct referrer) — varies by tier
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('v3_commission', 1, 1, 0.200000, 'Tier 1 (0-9 refs), Layer 1: 20% of explicit fee'),
  ('v3_commission', 2, 1, 0.250000, 'Tier 2 (10-49 refs), Layer 1: 25% of explicit fee'),
  ('v3_commission', 3, 1, 0.300000, 'Tier 3 (50-199 refs), Layer 1: 30% of explicit fee'),
  ('v3_commission', 4, 1, 0.350000, 'Tier 4 (200+ refs), Layer 1: 35% of explicit fee');

-- Layer 2 (indirect referrer) — flat 10% across all tiers
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('v3_commission', 1, 2, 0.100000, 'Tier 1, Layer 2: 10% of explicit fee'),
  ('v3_commission', 2, 2, 0.100000, 'Tier 2, Layer 2: 10% of explicit fee'),
  ('v3_commission', 3, 2, 0.100000, 'Tier 3, Layer 2: 10% of explicit fee'),
  ('v3_commission', 4, 2, 0.100000, 'Tier 4, Layer 2: 10% of explicit fee');

-- Layer 3 (deep referrer) — flat 5% across all tiers
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('v3_commission', 1, 3, 0.050000, 'Tier 1, Layer 3: 5% of explicit fee'),
  ('v3_commission', 2, 3, 0.050000, 'Tier 2, Layer 3: 5% of explicit fee'),
  ('v3_commission', 3, 3, 0.050000, 'Tier 3, Layer 3: 5% of explicit fee'),
  ('v3_commission', 4, 3, 0.050000, 'Tier 4, Layer 3: 5% of explicit fee');

COMMIT;
