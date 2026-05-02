-- 244_manual_deposit_dedup.sql — Prevent duplicate manual deposit submissions
--
-- Users can spam the Whish manual deposit form, creating multiple pending_review
-- records for the same transfer. Admin must manually detect and reject dupes.
-- Fix: reject submission if user already has a pending_review manual deposit.

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

  -- Amount can be 0 (admin sets real amount on approval)
  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must not be negative';
  END IF;

  -- Duplicate guard: block if user already has a pending_review manual deposit
  SELECT id INTO v_existing_pending
  FROM deposits
  WHERE user_id = v_user_id
    AND provider = 'whish_manual'
    AND status = 'pending_review'
  LIMIT 1;

  IF v_existing_pending IS NOT NULL THEN
    RAISE EXCEPTION 'You already have a pending deposit under review. Please wait for it to be processed.';
  END IF;

  INSERT INTO deposits (
    user_id, amount, fee, net_amount, currency,
    provider, status, whish_number, proof_image_url
  )
  VALUES (
    v_user_id, p_amount, 0, 0, 'USD',
    'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
  )
  RETURNING id INTO v_deposit_id;

  -- Log the event
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
    'status', 'pending_review'
  );
END;
$$;
