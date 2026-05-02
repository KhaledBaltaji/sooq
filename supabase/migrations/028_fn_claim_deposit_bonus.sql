-- 028_fn_claim_deposit_bonus.sql — $5 bonus for non-referred users, first deposit $20+
-- Uses auth.uid(). ONLY for organic (non-referred) users.

CREATE OR REPLACE FUNCTION claim_deposit_bonus()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_bonus_amount DECIMAL := 5.00;
  v_min_deposit DECIMAL := 20.00;
  v_wagering_multiplier DECIMAL := 2.0;
  v_first_deposit RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  -- Check: not already claimed
  IF v_user.deposit_bonus_claimed THEN
    RAISE EXCEPTION 'Bonus already claimed';
  END IF;

  -- Check: non-referred users ONLY (anti-farming per Codex review)
  IF v_user.referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'Deposit bonus is for non-referred users only';
  END IF;

  -- Check: has a confirmed deposit of $20+
  SELECT * INTO v_first_deposit
  FROM deposits
  WHERE user_id = v_user_id AND status = 'confirmed' AND amount >= v_min_deposit
  ORDER BY confirmed_at ASC LIMIT 1;

  IF v_first_deposit IS NULL THEN
    RAISE EXCEPTION 'Requires a confirmed deposit of $% or more', v_min_deposit;
  END IF;

  -- Credit bonus
  UPDATE users SET
    balance_usd = balance_usd + v_bonus_amount,
    deposit_bonus_claimed = TRUE,
    wagering_requirement = wagering_requirement + (v_bonus_amount * v_wagering_multiplier)
  WHERE id = v_user_id;

  -- Ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'bonus', v_bonus_amount,
    v_user.balance_usd + v_bonus_amount,
    v_first_deposit.id,
    'First deposit bonus ($5 free)'
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'bonus_amount', v_bonus_amount
  );
END;
$$;
