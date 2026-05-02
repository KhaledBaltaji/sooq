-- Migration 262: Add cancel_withdrawal RPC with proper locking.
--
-- Replaces the unsafe direct service-role mutations previously done in
-- src/lib/ai/tools.ts cancel_pending_withdrawal handler. The old code:
--   1. SELECTed the withdrawal row (no lock)
--   2. UPDATEd withdrawal status with optimistic-only check (.eq("status", "pending"))
--   3. SELECTed user balance (no lock)
--   4. UPDATEd user balance with new value
--   5. INSERTed transaction ledger entry
-- This sequence has a read-modify-write window between steps 3 and 4 that
-- could double-credit a user under concurrent execution — combined with
-- the AI tool runner having no iteration cap (fixed in src/lib/ai/agent.ts),
-- a runaway tool loop could exploit the window.
--
-- The new RPC takes both row-level locks atomically inside a single
-- transaction, mirroring the locking pattern from withdrawal_reject
-- (migration 026) and process_withdrawal (migration 024 / 190).
--
-- The RPC is service-role only because the AI agent calls it on behalf
-- of a user via service-role client — auth.uid() is not set in that
-- context, so identity is passed explicitly as p_user_id and verified
-- against the withdrawal's user_id before any mutation.

CREATE OR REPLACE FUNCTION cancel_withdrawal(
  p_withdrawal_id UUID,
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_withdrawal RECORD;
  v_user RECORD;
  v_new_balance DECIMAL(18,6);
  v_txn_id UUID;
BEGIN
  -- Lock withdrawal row first. Lock order matches process_withdrawal /
  -- withdrawal_reject (withdrawal → user) to avoid deadlocks with admin
  -- review paths running concurrently.
  SELECT * INTO v_withdrawal
  FROM withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  -- Identity check: a user can only cancel their own withdrawal.
  IF v_withdrawal.user_id != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: withdrawal does not belong to user';
  END IF;

  -- Status check: only 'pending' withdrawals can be cancelled. If the row
  -- has already been approved or rejected by an admin, the cancellation
  -- attempt fails cleanly without double-mutating state.
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot cancel — withdrawal status is %', v_withdrawal.status;
  END IF;

  -- Lock user row.
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;

  v_new_balance := v_user.balance_usd + v_withdrawal.amount;

  -- Mark withdrawal rejected with audit-friendly note.
  UPDATE withdrawals
  SET status = 'rejected',
      admin_notes = 'Cancelled by user via support AI',
      processed_at = NOW()
  WHERE id = p_withdrawal_id;

  -- Refund user balance.
  UPDATE users SET balance_usd = v_new_balance WHERE id = p_user_id;

  -- Append-only ledger entry. Mirrors the refund pattern from
  -- withdrawal_reject (migration 026) so the ledger stays balanced.
  INSERT INTO transactions (
    user_id, type, amount, balance_after, reference_id, description
  )
  VALUES (
    p_user_id, 'refund', v_withdrawal.amount, v_new_balance, p_withdrawal_id,
    'Withdrawal cancelled by user via support AI'
  )
  RETURNING id INTO v_txn_id;

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'refunded_amount', v_withdrawal.amount,
    'new_balance', v_new_balance,
    'transaction_id', v_txn_id
  );
END;
$$;

-- Service-role only. Called from src/lib/ai/tools.ts cancel_pending_withdrawal.
REVOKE EXECUTE ON FUNCTION cancel_withdrawal(UUID, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION cancel_withdrawal(UUID, UUID) TO service_role;
