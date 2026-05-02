-- 005_deposits.sql — Deposit tracking

CREATE TABLE deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(18,6) NOT NULL CHECK (amount > 0),
  fee DECIMAL(18,6) NOT NULL DEFAULT 0,
  net_amount DECIMAL(18,6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  threepay_ref TEXT NOT NULL UNIQUE,  -- idempotency key
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX idx_deposits_user_id ON deposits(user_id);
CREATE INDEX idx_deposits_threepay_ref ON deposits(threepay_ref);
CREATE INDEX idx_deposits_status ON deposits(status);
