-- 264_submit_manual_deposit_idempotency.sql — Unique partial index + ON CONFLICT
--
-- Eng review finding (action 5): submit_manual_deposit (migration 244) does
-- SELECT-then-INSERT for the duplicate check with no FOR UPDATE lock and no
-- unique partial index. Concurrent Whish submissions race: both pass the
-- existence check, both INSERT, admin must dedup manually.
--
-- Fix:
-- 1. CREATE UNIQUE INDEX CONCURRENTLY on (user_id, provider) WHERE status =
--    'pending_review'. Only one pending_review deposit per user+provider.
-- 2. Redefine submit_manual_deposit to INSERT first, catch unique_violation,
--    fetch existing row, return its ID with already_pending=true.
-- 3. Also tighten IDEMPOTENT semantics: if a user submits a duplicate while
--    another row is already pending_review, they get back the same deposit_id
--    they'd get on a successful fresh call. The client UI can treat it the
--    same way.
--
-- Pre-flight: clean up any existing duplicate pending_review rows (keep oldest).
-- Unique index creation will fail otherwise.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Pre-flight dedupe — keep oldest pending_review row per (user_id, provider)
--    Deposits table has no admin_notes/processed_at columns, so we just
--    status-flip duplicates to 'rejected' (the status enum accepts it).
-- ═══════════════════════════════════════════════════════════

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, provider
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM deposits
  WHERE status = 'pending_review'
)
UPDATE deposits
   SET status = 'rejected'
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- 2. Unique partial index — ONE pending_review per (user_id, provider)
--    CONCURRENTLY cannot run inside a transaction block, so this is
--    outside the BEGIN/COMMIT above.
-- ═══════════════════════════════════════════════════════════

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_deposits_one_pending_per_user_provider
  ON deposits (user_id, provider)
  WHERE status = 'pending_review';

COMMENT ON INDEX idx_deposits_one_pending_per_user_provider IS
  'Enforces at most one pending_review deposit per (user_id, provider). Prevents race-condition duplicates from submit_manual_deposit.';

-- ═══════════════════════════════════════════════════════════
-- 3. Redefine submit_manual_deposit with ON CONFLICT semantics
-- ═══════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION submit_manual_deposit(
  p_amount DECIMAL,
  p_whish_number TEXT DEFAULT NULL,
  p_proof_image_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_deposit_id UUID;
  v_existing_pending UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must not be negative';
  END IF;

  -- Try the insert. The unique partial index will raise unique_violation if a
  -- pending_review row already exists for this (user_id, provider).
  BEGIN
    INSERT INTO deposits (
      user_id, amount, fee, net_amount, currency,
      provider, status, whish_number, proof_image_url
    )
    VALUES (
      v_user_id, p_amount, 0, 0, 'USD',
      'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
    )
    RETURNING id INTO v_deposit_id;

    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual Whish deposit submitted',
      jsonb_build_object(
        'deposit_id', v_deposit_id,
        'user_id', v_user_id,
        'has_proof', p_proof_image_url IS NOT NULL
      )
    );

    RETURN jsonb_build_object(
      'deposit_id', v_deposit_id,
      'status', 'pending_review',
      'already_pending', false
    );
  EXCEPTION
    WHEN unique_violation THEN
      -- A concurrent submission beat us. Return the existing row so the
      -- client renders the same pending state regardless of which request won.
      SELECT id INTO v_existing_pending
        FROM deposits
       WHERE user_id = v_user_id
         AND provider = 'whish_manual'
         AND status = 'pending_review'
       LIMIT 1;

      IF v_existing_pending IS NULL THEN
        -- Extremely rare: index raised unique_violation but the pending row
        -- just got resolved by an admin before our SELECT landed. Retry once.
        INSERT INTO deposits (
          user_id, amount, fee, net_amount, currency,
          provider, status, whish_number, proof_image_url
        )
        VALUES (
          v_user_id, p_amount, 0, 0, 'USD',
          'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
        )
        RETURNING id INTO v_deposit_id;

        RETURN jsonb_build_object(
          'deposit_id', v_deposit_id,
          'status', 'pending_review',
          'already_pending', false
        );
      END IF;

      PERFORM log_system_event(
        'info',
        'deposit/manual',
        'Manual Whish deposit duplicate submission (idempotent return)',
        jsonb_build_object(
          'existing_deposit_id', v_existing_pending,
          'user_id', v_user_id
        )
      );

      RETURN jsonb_build_object(
        'deposit_id', v_existing_pending,
        'status', 'pending_review',
        'already_pending', true
      );
  END;
END;
$$;

COMMIT;
