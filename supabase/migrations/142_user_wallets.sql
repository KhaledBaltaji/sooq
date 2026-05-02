-- User wallets: stores 3pay wallet addresses per user
CREATE TABLE IF NOT EXISTS user_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) UNIQUE,
  provider TEXT NOT NULL DEFAULT '3pay',
  provider_user_id TEXT,
  wallet_address_trc20 TEXT,
  wallet_address_erc20 TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reverse lookup: find user by deposit wallet address (webhook processing)
CREATE INDEX IF NOT EXISTS idx_user_wallets_trc20
  ON user_wallets(wallet_address_trc20) WHERE wallet_address_trc20 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_wallets_erc20
  ON user_wallets(wallet_address_erc20) WHERE wallet_address_erc20 IS NOT NULL;

-- RLS: users can read their own wallet
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own wallet"
  ON user_wallets FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can insert/update (wallet generation via API route)
CREATE POLICY "Service role full access on user_wallets"
  ON user_wallets FOR ALL
  USING (auth.role() = 'service_role');
