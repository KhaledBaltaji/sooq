-- 034_fn_void_market_internal.sql — Core void logic (no auth check)
-- Refunds all bets, claws back credited commissions, voids all commission records.
-- Called by void_market (after admin auth) and dead_market_check (service_role).

CREATE OR REPLACE FUNCTION _void_market_internal(p_market_id UUID)
RETURNS INTEGER  -- number of refunds issued
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_bet RECORD;
  v_user RECORD;
  v_comm RECORD;
  v_refunds INTEGER := 0;
BEGIN
  -- Lock market row to prevent concurrent bets/resolution during void
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- Claw back credited commissions before voiding
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    -- Lock the referrer row
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Debit the referrer's balance (clamp to 0 to prevent negative balances)
    UPDATE users SET balance_usd = GREATEST(balance_usd - v_comm.commission_amount, 0)
    WHERE id = v_comm.referrer_id;

    -- Negative ledger entry (record full amount for audit trail)
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      GREATEST(v_user.balance_usd - v_comm.commission_amount, 0),
      p_market_id,
      'Commission clawed back — market voided'
    );
  END LOOP;

  -- Void all commissions (escrowed and credited)
  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- Refund all bets
  FOR v_bet IN SELECT * FROM bets WHERE market_id = p_market_id LOOP
    SELECT * INTO v_user FROM users WHERE id = v_bet.user_id FOR UPDATE;

    UPDATE users SET balance_usd = balance_usd + v_bet.amount
    WHERE id = v_bet.user_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_bet.user_id, 'refund', v_bet.amount,
      v_user.balance_usd + v_bet.amount,
      v_bet.id,
      'Market voided — bet refunded'
    );

    v_refunds := v_refunds + 1;
  END LOOP;

  -- Update market status
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  RETURN v_refunds;
END;
$$;
