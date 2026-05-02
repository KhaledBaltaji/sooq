-- 003_bets.sql — Bets table
-- NO same_side constraint per CEO review — users CAN bet both YES and NO on same market

CREATE TABLE bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  side bet_side NOT NULL,
  amount DECIMAL(18,6) NOT NULL CHECK (amount > 0),
  payout_ratio DECIMAL(18,6) NOT NULL CHECK (payout_ratio > 0),
  potential_payout DECIMAL(18,6) NOT NULL CHECK (potential_payout > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  -- NO same_side constraint per CEO review: users CAN bet both YES and NO
);

CREATE INDEX idx_bets_user_id ON bets(user_id);
CREATE INDEX idx_bets_market_id ON bets(market_id);
CREATE INDEX idx_bets_user_market ON bets(user_id, market_id);
CREATE INDEX idx_bets_market_side ON bets(market_id, side);
