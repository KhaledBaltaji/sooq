-- ============================================================================
-- 304_transactions_append_only.sql
--
-- Enforces append-only invariant on the `transactions` ledger via BEFORE
-- UPDATE/DELETE triggers. Today the comment in mig 004 claims append-only
-- but no DB-level enforcement exists; this migration closes that gap.
--
-- Pre-apply audit: grepped for `UPDATE transactions` / `DELETE FROM transactions`
-- across migrations and src/. Two historical one-time backfill migrations
-- (174, 299) match. Neither is a runtime hot path. Production app code
-- under src/app/api and src/lib has zero matches. Safe to apply.
--
-- Service role can opt into a one-statement bypass for emergency corrections
-- by setting the local GUC `app.transactions_bypass = 'true'` BEFORE the
-- mutation. Bypass writes a `system_logs` row tagged `transactions/bypass`
-- with severity `warn` and the full row payload (old + new) for audit.
--
-- Rollback:
--   DROP TRIGGER trg_transactions_no_update ON transactions;
--   DROP TRIGGER trg_transactions_no_delete ON transactions;
--   DROP FUNCTION prevent_transactions_mutation();
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_transactions_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_bypass TEXT;
BEGIN
  -- Service role can opt into a per-statement bypass via session GUC.
  BEGIN
    v_bypass := current_setting('app.transactions_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;

  IF v_bypass = 'true' AND auth.role() = 'service_role' THEN
    -- Bypass allowed — must be intentional and is audited.
    INSERT INTO system_logs (severity, source, message, context)
    VALUES (
      'warn'::log_severity,
      'transactions/bypass',
      format('Append-only bypass: %s on transactions', TG_OP),
      jsonb_build_object(
        'op', TG_OP,
        'old', to_jsonb(OLD),
        'new', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
      )
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'transactions is append-only: % not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_transactions_no_update ON transactions;
CREATE TRIGGER trg_transactions_no_update
  BEFORE UPDATE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_transactions_mutation();

DROP TRIGGER IF EXISTS trg_transactions_no_delete ON transactions;
CREATE TRIGGER trg_transactions_no_delete
  BEFORE DELETE ON transactions
  FOR EACH ROW
  EXECUTE FUNCTION prevent_transactions_mutation();

COMMENT ON FUNCTION prevent_transactions_mutation() IS
'Append-only enforcement for transactions ledger. service_role can bypass via SET LOCAL app.transactions_bypass = ''true''; the bypass is logged to system_logs with severity warn.';
