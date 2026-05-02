-- 156_void_and_referral_guards.sql — Two safety fixes:
-- 1. Lock commission rows before clawback in void to prevent race with _release_escrowed_commissions
-- 2. Circular referral guard in handle_referral_signup trigger

BEGIN;

-- ============================================================
-- 1. Updated _void_market_internal — lock commissions before clawback
-- ============================================================
-- Race window fix: without FOR UPDATE, a concurrent _release_escrowed_commissions
-- could credit escrowed commissions between the clawback loop and the status update,
-- resulting in credited commissions that never get clawed back.

CREATE OR REPLACE FUNCTION _void_market_internal(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_comm RECORD;
  v_user RECORD;
  v_refund_amount DECIMAL;
  v_refunds INTEGER := 0;
BEGIN
  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ======= 1. LOCK + CLAW BACK COMMISSIONS =======
  -- Lock ALL commission rows for this market first to prevent concurrent release
  PERFORM 1 FROM referral_commissions
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited')
  FOR UPDATE;

  -- Claw back credited commissions (escrowed ones were never credited to balance, no debit needed)
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Debit the referrer's agent balance (clamp to 0)
    UPDATE users SET agent_balance_usd = GREATEST(agent_balance_usd - v_comm.commission_amount, 0)
    WHERE id = v_comm.referrer_id
    RETURNING balance_usd INTO v_user.balance_usd;

    -- Negative ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_user.balance_usd,
      p_market_id,
      'Commission clawed back — market voided'
    );
  END LOOP;

  -- Void all commission records (both escrowed and credited)
  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ======= 2. REFUND ALL POSITIONS =======
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id AND shares_held > 0
    ORDER BY user_id  -- consistent lock order to prevent deadlocks
  LOOP
    SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

    v_refund_amount := v_pos.shares_held * v_pos.avg_entry_price;

    IF v_refund_amount > 0 THEN
      UPDATE users SET balance_usd = balance_usd + v_refund_amount
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_pos_user.balance_usd;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'refund', v_refund_amount,
        v_pos_user.balance_usd,
        p_market_id,
        'Market voided — position refunded (' || v_pos.side || ')'
      );

      v_refunds := v_refunds + 1;
    END IF;
  END LOOP;

  -- ======= 3. UPDATE MARKET STATUS =======
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunds_issued', v_refunds
  );
END;
$$;


-- ============================================================
-- 2. Updated handle_referral_signup — circular referral guard
-- ============================================================

CREATE OR REPLACE FUNCTION handle_referral_signup()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_chain UUID[];
  v_new_chain UUID[];
  v_referrer_referred_by UUID;
BEGIN
  -- Only fire when referred_by transitions from NULL to a value
  IF OLD.referred_by IS NOT NULL OR NEW.referred_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Read the referrer's referral_chain and referred_by
  SELECT referral_chain, referred_by INTO v_referrer_chain, v_referrer_referred_by
  FROM users WHERE id = NEW.referred_by;

  -- Circular referral guard: referrer must not be referred by this user
  IF v_referrer_referred_by = NEW.id THEN
    RAISE EXCEPTION 'Circular referral detected';
  END IF;

  -- Circular referral guard: this user must not appear in referrer's ancestor chain
  IF v_referrer_chain IS NOT NULL AND NEW.id = ANY(v_referrer_chain) THEN
    RAISE EXCEPTION 'Circular referral detected';
  END IF;

  -- Set bypass flag so the protect_sensitive_columns trigger allows our updates
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  -- Build new user's chain: [direct referrer, then up to 2 from referrer's chain], max 3
  v_new_chain := ARRAY[NEW.referred_by];
  IF v_referrer_chain IS NOT NULL AND array_length(v_referrer_chain, 1) > 0 THEN
    v_new_chain := v_new_chain || v_referrer_chain[1:LEAST(array_length(v_referrer_chain, 1), 2)];
  END IF;

  -- Update the new user's referral_chain
  UPDATE users SET referral_chain = v_new_chain WHERE id = NEW.id;

  -- Increment the referrer's direct_referral_count
  UPDATE users SET direct_referral_count = direct_referral_count + 1
  WHERE id = NEW.referred_by;

  -- Recalculate the referrer's agent level
  PERFORM update_agent_level(NEW.referred_by);

  -- Reset bypass flag
  PERFORM set_config('app.trigger_bypass', 'false', TRUE);

  RETURN NEW;
END;
$$;

COMMIT;
