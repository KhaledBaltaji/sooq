-- 008_platform_revenue.sql — Per-market revenue record

CREATE TABLE platform_revenue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES markets(id) UNIQUE,
  total_pot DECIMAL(18,6) NOT NULL,
  seed_amount DECIMAL(18,6) NOT NULL,
  platform_fee DECIMAL(18,6) NOT NULL,
  total_commissions DECIMAL(18,6) NOT NULL DEFAULT 0,
  net_revenue DECIMAL(18,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pr_market ON platform_revenue(market_id);
