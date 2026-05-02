-- 266_pool_underflow_auto_deficit.sql — Auto-track branch pool underflow as deficit
--
-- Eng review finding (action 8): migration 248 removed the pool_balance >= 0
-- CHECK constraint (honest-ledger design accepts negative pool_balance when
-- platform owes branch money). But there's no operational wrapper:
--   - If pool_balance goes negative during settlement, NO commission_clawback_deficit
--     row is created.
--   - Cron check-errors already reads commission_clawback_deficit for Slack alerts,
--     so the alert pipeline exists but never fires for this class of underflow.
--   - get_branch_owner_summary shows $0 withdrawable with no explanation.
--
-- Fix: an AFTER UPDATE trigger on branches that fires when pool_balance
-- transitions from non-negative to negative (or stays negative and gets more
-- negative). Inserts a commission_clawback_deficit row with reason='pool_underflow'.
-- The existing cron check-errors path picks it up → Slack alert → admin reconciles.
--
-- Branch owner dashboard UI separately renders "Awaiting reconciliation: $X"
-- when pool_balance < 0 (the UI change is in src/app/branch/dashboard/pool/page.tsx,
-- not in this migration).
--
-- Idempotency: the trigger only fires when balance crosses / worsens past zero.
-- A row stuck at -$50 doesn't keep emitting deficit rows on every unrelated update.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Extend commission_clawback_deficit.reason to include pool_underflow
--    (it's TEXT, no enum, so just documentation + code uses the new value).
-- ═══════════════════════════════════════════════════════════

COMMENT ON COLUMN commission_clawback_deficit.reason IS
  'Reason for deficit. Known values: agent_balance_insufficient (void clawback couldn''t fully debit because agent already withdrew), pool_underflow (branch pool_balance went negative — platform owes branch money).';

-- ═══════════════════════════════════════════════════════════
-- 2. Extend the table to support branch-level deficit rows (no user/market)
--    Some pool_underflow entries aren't tied to a specific commission.
-- ═══════════════════════════════════════════════════════════

-- referrer_id, market_id, expected_clawback, actual_clawback, deficit are
-- currently NOT NULL. For pool_underflow entries we need to relax those.

ALTER TABLE commission_clawback_deficit
  ALTER COLUMN referrer_id DROP NOT NULL,
  ALTER COLUMN market_id DROP NOT NULL,
  ALTER COLUMN expected_clawback DROP NOT NULL,
  ALTER COLUMN actual_clawback DROP NOT NULL;

-- deficit must stay NOT NULL — it's the headline amount.
-- Add branch_id for pool_underflow rows.
ALTER TABLE commission_clawback_deficit
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

CREATE INDEX IF NOT EXISTS idx_clawback_deficit_branch ON commission_clawback_deficit(branch_id);

-- ═══════════════════════════════════════════════════════════
-- 3. The trigger function
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _track_pool_underflow()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_underflow DECIMAL;
BEGIN
  -- Only interested when pool_balance is negative AND it just got worse
  -- (or transitioned from non-negative to negative).
  IF NEW.pool_balance >= 0 THEN
    RETURN NEW;
  END IF;

  -- Compute the delta of the underflow.
  -- Case A: OLD.pool_balance was >= 0, now NEW is < 0 → underflow = |NEW.pool_balance|
  -- Case B: OLD was < 0 and NEW got worse → underflow = OLD - NEW (positive number)
  -- Case C: OLD was < 0 and NEW is same or better → do nothing
  IF OLD.pool_balance >= 0 THEN
    v_underflow := ABS(NEW.pool_balance);
  ELSIF NEW.pool_balance < OLD.pool_balance THEN
    v_underflow := OLD.pool_balance - NEW.pool_balance;
  ELSE
    RETURN NEW;
  END IF;

  -- Only log meaningful underflows (above a $0.01 floor).
  IF v_underflow < 0.01 THEN
    RETURN NEW;
  END IF;

  INSERT INTO commission_clawback_deficit (
    branch_id, deficit, reason
  ) VALUES (
    NEW.id, ROUND(v_underflow, 2), 'pool_underflow'
  );

  -- Also log for the admin dashboard. log_system_event is the canonical
  -- path for structured alerts that check-errors cron picks up.
  PERFORM log_system_event(
    'warn'::log_severity,
    'branch/pool_underflow',
    format('Branch %s pool_balance went negative: $%s (was $%s, now $%s)',
           NEW.name,
           ROUND(v_underflow, 2),
           ROUND(OLD.pool_balance, 2),
           ROUND(NEW.pool_balance, 2)),
    jsonb_build_object(
      'branch_id', NEW.id,
      'branch_name', NEW.name,
      'old_pool_balance', OLD.pool_balance,
      'new_pool_balance', NEW.pool_balance,
      'underflow_amount', v_underflow
    )
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION _track_pool_underflow() IS
  'AFTER UPDATE trigger on branches — when pool_balance goes negative (or worsens past negative), records a commission_clawback_deficit row + system_log. Fires on real underflow events only, not on unrelated updates.';

DROP TRIGGER IF EXISTS trg_branches_pool_underflow ON branches;

CREATE TRIGGER trg_branches_pool_underflow
  AFTER UPDATE OF pool_balance ON branches
  FOR EACH ROW
  WHEN (NEW.pool_balance IS DISTINCT FROM OLD.pool_balance)
  EXECUTE FUNCTION _track_pool_underflow();

COMMIT;
