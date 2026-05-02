-- 265_verify_support_code_rpc.sql — Atomic OTP verification for AI support
--
-- Eng review finding (action 7): src/lib/ai/tools.ts verify_code tool does
-- read-modify-write across support_verification_codes + support_tickets with
-- NO lock:
--   1. SELECT the latest pending code (no lock)
--   2. UPDATE attempts = attempts + 1 (no FOR UPDATE — lost-update race)
--   3. On correct code: UPDATE verified_at AND UPDATE ticket.identity_verified_at
-- Concurrent AI calls (multiple browser tabs, retry, or runaway tool loop) can:
--   - Race attempts counter → bypass MAX_OTP_ATTEMPTS lockout
--   - Double-verify a ticket (2 tools both win on the correct code)
--   - Verify with a stale code that another tool already consumed
--
-- This RPC mirrors the cancel_withdrawal (mig 262) pattern: lock the code row
-- AND the ticket row inside a single transaction, compute the outcome, write
-- the updates, return structured result. Service-role only; identity check
-- enforced inside.
--
-- The tool layer is refactored in src/lib/ai/tools.ts to call this RPC via
-- supabase.rpc("verify_support_code", {...}) instead of direct .update() /
-- .select() chains.

CREATE OR REPLACE FUNCTION verify_support_code(
  p_ticket_id UUID,
  p_user_id UUID,
  p_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_record RECORD;
  v_ticket RECORD;
  v_max_attempts INT := 3;
  v_now TIMESTAMPTZ;
  v_remaining INT;
BEGIN
  v_now := NOW();

  -- Lock ticket row first — ensures only one verification path can flip
  -- identity_verified_at per ticket at a time.
  SELECT * INTO v_ticket
    FROM support_tickets
   WHERE id = p_ticket_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  -- Identity check: ticket must belong to the claimed user. The AI runner
  -- passes ctx.userId from the session; mismatches can't verify.
  IF v_ticket.user_id != p_user_id THEN
    RAISE EXCEPTION 'Ticket does not belong to user';
  END IF;

  -- Find latest pending code for this ticket, locked for update.
  -- ORDER BY created_at DESC matches the tool's current lookup order.
  SELECT * INTO v_record
    FROM support_verification_codes
   WHERE ticket_id = p_ticket_id
     AND verified_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_pending_code',
      'error', 'No pending verification code. Please request a new one.'
    );
  END IF;

  IF v_record.expires_at < v_now THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'expired',
      'error', 'Verification code has expired. Please request a new one.'
    );
  END IF;

  IF v_record.attempts >= v_max_attempts THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'too_many_attempts',
      'error', 'Too many failed attempts. Escalating to support team.'
    );
  END IF;

  -- Always increment attempts, whether correct or not. Under the lock,
  -- this is safe — no two callers see the same counter value.
  UPDATE support_verification_codes
     SET attempts = attempts + 1
   WHERE id = v_record.id;

  IF v_record.code != TRIM(p_code) THEN
    v_remaining := v_max_attempts - (v_record.attempts + 1);
    IF v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'too_many_attempts',
        'error', 'Too many failed attempts. Escalating to support team.',
        'remaining', 0
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'incorrect_code',
      'error', format('Incorrect code. %s attempt%s remaining.', v_remaining, CASE WHEN v_remaining = 1 THEN '' ELSE 's' END),
      'remaining', v_remaining
    );
  END IF;

  -- Correct code. Mark both rows in a single txn (locked).
  UPDATE support_verification_codes
     SET verified_at = v_now
   WHERE id = v_record.id;

  UPDATE support_tickets
     SET identity_verified_at = v_now
   WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'verified_at', v_now
  );
END;
$$;

COMMENT ON FUNCTION verify_support_code(UUID, UUID, TEXT) IS
  'Atomic OTP verification for AI support tool. Locks both support_verification_codes and support_tickets rows — eliminates the race condition in the previous direct-.update() flow. Service-role only.';

-- Service-role only. Called from src/lib/ai/tools.ts verify_code tool.
REVOKE EXECUTE ON FUNCTION verify_support_code(UUID, UUID, TEXT) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION verify_support_code(UUID, UUID, TEXT) TO service_role;
