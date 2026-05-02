-- 004_transactions.sql — Append-only ledger
-- Source of truth for all balance mutations. balance_usd on users is a cache.

CREATE TYPE transaction_type AS ENUM (
  'bet', 'win', 'deposit', 'withdrawal', 'commission', 'bonus', 'refund', 'seed'
);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  type transaction_type NOT NULL,
  amount DECIMAL(18,6) NOT NULL,  -- positive = credit, negative = debit
  balance_after DECIMAL(18,6) NOT NULL,
  reference_id UUID,  -- bet_id, market_id, deposit_id, etc.
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- No UPDATE or DELETE allowed — append only
CREATE INDEX idx_transactions_user_id ON transactions(user_id);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_reference ON transactions(reference_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_transactions_user_type ON transactions(user_id, type);
