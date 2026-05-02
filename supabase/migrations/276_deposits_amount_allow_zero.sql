-- 276_deposits_amount_allow_zero.sql — Allow amount=0 on manual deposit submission
--
-- Migration 005 created deposits with CHECK (amount > 0). Migration 240 then
-- changed the Whish manual flow so users submit with p_amount=0 (admin sets
-- real amount on approval) and relaxed the RPC-level validation. But the
-- table CHECK was never touched, so every user submission raises
-- check_violation inside submit_manual_deposit, rolls back, and surfaces as
-- a silent toast error with no deposits row and nothing in the admin panel.
--
-- Fix: relax the CHECK to `amount >= 0`. The approval gate in
-- admin_review_deposit (migration 240:107-109) already blocks confirmation
-- with amount <= 0, so no money can be credited at zero. The automated
-- deposit paths (process_deposit migrations 190, 271) all enforce
-- `p_amount <= 0 → RAISE` at function entry, so the 3pay/whish webhook
-- paths remain positive-amount by contract.
--
-- The unnamed constraint from migration 005 is synthesized by Postgres as
-- `deposits_amount_check`. We DROP IF EXISTS to be idempotent, then ADD
-- with an explicit name for future auditability.

BEGIN;

ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_amount_check;

ALTER TABLE deposits
  ADD CONSTRAINT deposits_amount_check
  CHECK (amount >= 0);

COMMENT ON CONSTRAINT deposits_amount_check ON deposits IS
  'Amount >= 0. Zero allowed for manual deposits in pending_review; admin_review_deposit enforces > 0 at approval time before crediting balance.';

COMMIT;
