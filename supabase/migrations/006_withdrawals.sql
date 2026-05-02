-- 006_withdrawals.sql — Withdrawal tracking

CREATE TYPE withdrawal_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  amount DECIMAL(18,6) NOT NULL CHECK (amount > 0),
  fee DECIMAL(18,6) NOT NULL DEFAULT 0,
  net_amount DECIMAL(18,6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDT',
  destination TEXT NOT NULL,
  status withdrawal_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX idx_withdrawals_user_id ON withdrawals(user_id);
CREATE INDEX idx_withdrawals_status ON withdrawals(status);
