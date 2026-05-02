-- ============================================================================
-- 303_users_balance_nonneg.sql
--
-- Adds DB-level CHECK constraints preventing negative balances on users.
-- balance_usd >= 0 and agent_balance_usd >= 0.
--
-- Today the existing RPC guards (execute_trade, process_withdrawal, etc.)
-- prevent balance from going below zero on the happy path. This adds a
-- belt-and-suspenders constraint so any race or RPC bug is caught at the
-- DB level, not silent corruption.
--
-- Pre-flight: aborts the migration if any existing user has negative balance.
-- Running this against a clean DB or a DB with no negative balances is safe.
--
-- Rollback: ALTER TABLE users
--   DROP CONSTRAINT users_balance_usd_nonneg,
--   DROP CONSTRAINT users_agent_balance_usd_nonneg;
-- ============================================================================

-- Pre-flight: balance_usd
DO $$
DECLARE
  v_offenders INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_offenders FROM users WHERE balance_usd < 0;
  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'Cannot add CHECK (balance_usd >= 0): % users have negative balance. Reconcile via admin_adjust_balance before applying.',
      v_offenders;
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_balance_usd_nonneg CHECK (balance_usd >= 0);

-- Pre-flight: agent_balance_usd
DO $$
DECLARE
  v_offenders INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_offenders FROM users WHERE agent_balance_usd < 0;
  IF v_offenders > 0 THEN
    RAISE EXCEPTION
      'Cannot add CHECK (agent_balance_usd >= 0): % users have negative agent balance.',
      v_offenders;
  END IF;
END $$;

ALTER TABLE users
  ADD CONSTRAINT users_agent_balance_usd_nonneg CHECK (agent_balance_usd >= 0);
