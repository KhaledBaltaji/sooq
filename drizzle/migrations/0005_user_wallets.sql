-- 0005_user_wallets.sql — crypto deposit address cache.
--
-- Re-introduces user_wallets (was stripped along with the rest of the
-- branch/agent system in W3). Slimmed to the single use case it actually
-- serves now: caching the 3pay-issued TRC20 + ERC20 addresses so we don't
-- round-trip 3pay on every "show me my deposit address" page render.

BEGIN;

CREATE TABLE IF NOT EXISTS user_wallets (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL DEFAULT '3pay',
  provider_user_id     TEXT,
  wallet_address_trc20 TEXT,
  wallet_address_erc20 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_wallets_trc20_idx ON user_wallets (wallet_address_trc20)
  WHERE wallet_address_trc20 IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_wallets_erc20_idx ON user_wallets (wallet_address_erc20)
  WHERE wallet_address_erc20 IS NOT NULL;

COMMIT;
