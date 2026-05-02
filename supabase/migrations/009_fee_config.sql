-- 009_fee_config.sql — All fees from config table, NEVER hardcoded

CREATE TABLE fee_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fee_type TEXT NOT NULL,  -- 'platform_fee', 'deposit_fee', 'withdrawal_fee', 'commission'
  level INTEGER,           -- for commission: 1-4 agent level
  depth INTEGER,           -- for commission: 1-3 tier depth
  rate DECIMAL(8,6) NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(fee_type, level, depth)
);

-- Platform fees
INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('platform_fee', 0.07, 'Platform fee: 7% of total pot'),
  ('deposit_fee', 0.0, 'Deposit fee: 0%'),
  ('withdrawal_fee', 0.01, 'Withdrawal fee: 1%');

-- Commission rates: 4 levels × 3 depths = 12 rows (from commission-model.md)
INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('commission', 1, 1, 0.0175, 'L1 Tier 1 (direct): 1.75%'),
  ('commission', 1, 2, 0.0005, 'L1 Tier 2 (indirect): 0.05%'),
  ('commission', 1, 3, 0.0001, 'L1 Tier 3 (deep): 0.01%'),
  ('commission', 2, 1, 0.0210, 'L2 Tier 1 (direct): 2.10%'),
  ('commission', 2, 2, 0.0010, 'L2 Tier 2 (indirect): 0.10%'),
  ('commission', 2, 3, 0.0002, 'L2 Tier 3 (deep): 0.02%'),
  ('commission', 3, 1, 0.0245, 'L3 Tier 1 (direct): 2.45%'),
  ('commission', 3, 2, 0.0015, 'L3 Tier 2 (indirect): 0.15%'),
  ('commission', 3, 3, 0.0003, 'L3 Tier 3 (deep): 0.03%'),
  ('commission', 4, 1, 0.0280, 'L4 Tier 1 (direct): 2.80%'),
  ('commission', 4, 2, 0.0020, 'L4 Tier 2 (indirect): 0.20%'),
  ('commission', 4, 3, 0.0005, 'L4 Tier 3 (deep): 0.05%');

CREATE TRIGGER fee_config_updated_at
  BEFORE UPDATE ON fee_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
