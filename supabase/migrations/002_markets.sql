-- 002_markets.sql — Markets table

CREATE TYPE market_status AS ENUM ('draft', 'open', 'closed', 'resolved', 'voided');
CREATE TYPE bet_side AS ENUM ('yes', 'no');

CREATE TABLE markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question_en TEXT NOT NULL,
  question_ar TEXT NOT NULL,
  description_en TEXT,
  description_ar TEXT,
  category TEXT NOT NULL DEFAULT 'politics',
  status market_status NOT NULL DEFAULT 'draft',
  outcome bet_side,
  pool_yes DECIMAL(18,6) NOT NULL DEFAULT 0,
  pool_no DECIMAL(18,6) NOT NULL DEFAULT 0,
  seed_amount_yes DECIMAL(18,6) NOT NULL CHECK (seed_amount_yes > 0),
  seed_amount_no DECIMAL(18,6) NOT NULL CHECK (seed_amount_no > 0),
  bet_count INTEGER NOT NULL DEFAULT 0,
  unique_bettors INTEGER NOT NULL DEFAULT 0,
  opens_at TIMESTAMPTZ NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT closes_after_opens CHECK (closes_at > opens_at)
);

CREATE INDEX idx_markets_status ON markets(status);
CREATE INDEX idx_markets_closes_at ON markets(closes_at);
CREATE INDEX idx_markets_category ON markets(category);

CREATE TRIGGER markets_updated_at
  BEFORE UPDATE ON markets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
