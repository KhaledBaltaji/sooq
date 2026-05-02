-- 001_users.sql — Users table with referral chain and agent levels

CREATE TYPE agent_level AS ENUM ('1', '2', '3', '4');

CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone TEXT,
  display_name TEXT,
  avatar_url TEXT,
  balance_usd DECIMAL(18,6) NOT NULL DEFAULT 0,
  referral_code TEXT NOT NULL UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
  referred_by UUID REFERENCES users(id),
  referral_chain UUID[] DEFAULT '{}',  -- max 3 ancestor UUIDs [direct, indirect, deep]
  agent_level INTEGER NOT NULL DEFAULT 1 CHECK (agent_level BETWEEN 1 AND 4),
  direct_referral_count INTEGER NOT NULL DEFAULT 0,
  locale TEXT NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  wagering_requirement DECIMAL(18,6) NOT NULL DEFAULT 0,
  total_wagered DECIMAL(18,6) NOT NULL DEFAULT 0,
  deposit_bonus_claimed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_referral_code ON users(referral_code);
CREATE INDEX idx_users_referred_by ON users(referred_by);
CREATE INDEX idx_users_phone ON users(phone);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
