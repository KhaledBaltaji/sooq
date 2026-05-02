-- ============================================================
-- 260_drop_branch_owner_withdraw.sql
--
-- Remove branch-owner self-withdrawal from the branch pool.
-- Product rule: only admins move money in/out of a branch pool.
-- Admin-side path remains: admin_adjust_branch_pool (migration 217)
-- with PIN + audit via branch_admin_overrides.
--
-- Historical branch_pools.owner_payout ledger rows are preserved;
-- this migration only removes the function that writes new ones.
-- ============================================================

REVOKE EXECUTE ON FUNCTION transfer_branch_pool_to_owner_portfolio(UUID, DECIMAL) FROM authenticated;
DROP FUNCTION IF EXISTS transfer_branch_pool_to_owner_portfolio(UUID, DECIMAL);
