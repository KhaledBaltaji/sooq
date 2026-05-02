-- 007_referrals.sql — Referral commission tracking

CREATE TYPE commission_status AS ENUM ('escrowed', 'credited', 'voided');

CREATE TABLE referral_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  bettor_id UUID NOT NULL REFERENCES users(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  depth INTEGER NOT NULL CHECK (depth BETWEEN 1 AND 3),
  agent_level_at_time INTEGER NOT NULL CHECK (agent_level_at_time BETWEEN 1 AND 4),
  net_exposure DECIMAL(18,6) NOT NULL,
  commission_rate DECIMAL(5,4) NOT NULL,
  commission_amount DECIMAL(18,6) NOT NULL,
  status commission_status NOT NULL DEFAULT 'escrowed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rc_referrer ON referral_commissions(referrer_id);
CREATE INDEX idx_rc_bettor ON referral_commissions(bettor_id);
CREATE INDEX idx_rc_market ON referral_commissions(market_id);
CREATE INDEX idx_rc_status ON referral_commissions(status);
