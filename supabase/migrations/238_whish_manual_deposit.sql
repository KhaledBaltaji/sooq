-- 238_whish_manual_deposit.sql — Whish Manual Deposit support
--
-- Adds manual deposit flow: user sends money to a Whish number, uploads receipt,
-- admin reviews and approves/rejects. No balance mutation until admin approval.

BEGIN;

-- ══════════════════════════════════════════════════════════════
-- 1. ALTER deposits table
-- ══════════════════════════════════════════════════════════════

-- Expand status CHECK to include pending_review and rejected
ALTER TABLE deposits DROP CONSTRAINT IF EXISTS deposits_status_check;
ALTER TABLE deposits ADD CONSTRAINT deposits_status_check
  CHECK (status IN ('pending', 'confirmed', 'failed', 'pending_review', 'rejected'));

-- New columns for manual deposit proof
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS proof_image_url TEXT;
ALTER TABLE deposits ADD COLUMN IF NOT EXISTS whish_number TEXT;

-- Make provider_ref nullable (manual deposits don't have external refs)
ALTER TABLE deposits ALTER COLUMN provider_ref DROP NOT NULL;

-- ══════════════════════════════════════════════════════════════
-- 2. Supabase Storage bucket for deposit proofs
-- ══════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'deposit-proofs',
  'deposit-proofs',
  false,
  5242880,  -- 5MB
  ARRAY['image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload to their own folder
CREATE POLICY "Users upload own deposit proofs"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'deposit-proofs'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Users can read their own proofs
CREATE POLICY "Users read own deposit proofs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'deposit-proofs'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Admins can read all proofs
CREATE POLICY "Admins read all deposit proofs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'deposit-proofs'
    AND EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND is_admin = TRUE)
  );

-- ══════════════════════════════════════════════════════════════
-- 3. submit_manual_deposit — user-facing RPC
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION submit_manual_deposit(
  p_amount DECIMAL,
  p_whish_number TEXT,
  p_proof_image_url TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_deposit_id UUID;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must be positive';
  END IF;

  IF p_whish_number IS NULL OR p_whish_number = '' THEN
    RAISE EXCEPTION 'Whish number is required';
  END IF;

  IF p_proof_image_url IS NULL OR p_proof_image_url = '' THEN
    RAISE EXCEPTION 'Proof image is required';
  END IF;

  -- Read deposit fee from config (same rate as auto deposits)
  SELECT rate INTO v_deposit_fee_rate
  FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

  v_fee := p_amount * COALESCE(v_deposit_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  INSERT INTO deposits (
    user_id, amount, fee, net_amount, currency,
    provider, status, whish_number, proof_image_url
  )
  VALUES (
    v_user_id, p_amount, v_fee, v_net_amount, 'USD',
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
      'amount', p_amount,
      'whish_number', p_whish_number
    )
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'status', 'pending_review'
  );
END;
$$;

-- ══════════════════════════════════════════════════════════════
-- 4. admin_review_deposit — admin approve/reject RPC
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_review_deposit(
  p_deposit_id UUID,
  p_action TEXT  -- 'approve' or 'reject'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deposit RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- Lock deposit row
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_deposit.status != 'pending_review' THEN
    RAISE EXCEPTION 'Deposit is not pending review (current: %)', v_deposit.status;
  END IF;

  IF p_action = 'approve' THEN
    -- Update deposit status
    UPDATE deposits
    SET status = 'confirmed', confirmed_at = NOW()
    WHERE id = p_deposit_id;

    -- Lock user row, credit balance
    UPDATE users
    SET balance_usd = balance_usd + v_deposit.net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_deposit.user_id, 'deposit', v_deposit.net_amount,
      v_new_balance, p_deposit_id,
      'Manual Whish deposit approved'
    );

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'net_amount', v_deposit.net_amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'net_amount', v_deposit.net_amount
    );
  ELSE
    -- Reject — no balance mutation needed
    UPDATE deposits
    SET status = 'rejected'
    WHERE id = p_deposit_id;

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_deposit.amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;

COMMIT;
