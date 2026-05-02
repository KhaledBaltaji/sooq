-- 144_agent_wallet_trigger_fix.sql
-- 1. Add agent_balance_usd to protected columns trigger
-- 2. Add trigger_bypass to transfer_agent_to_portfolio and _void_market_internal

BEGIN;

-- ============================================================
-- 1. Update protected columns trigger to include agent_balance_usd
-- ============================================================

CREATE OR REPLACE FUNCTION prevent_sensitive_user_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when called via service_role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions (they set a local flag)
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive columns for regular users
  IF NEW.balance_usd        IS DISTINCT FROM OLD.balance_usd
  OR NEW.agent_balance_usd  IS DISTINCT FROM OLD.agent_balance_usd
  OR NEW.is_admin           IS DISTINCT FROM OLD.is_admin
  OR NEW.is_frozen          IS DISTINCT FROM OLD.is_frozen
  OR NEW.agent_level        IS DISTINCT FROM OLD.agent_level
  OR NEW.direct_referral_count IS DISTINCT FROM OLD.direct_referral_count
  OR NEW.wagering_requirement  IS DISTINCT FROM OLD.wagering_requirement
  OR NEW.total_wagered      IS DISTINCT FROM OLD.total_wagered
  OR NEW.deposit_bonus_claimed IS DISTINCT FROM OLD.deposit_bonus_claimed
  OR NEW.referral_chain     IS DISTINCT FROM OLD.referral_chain
  OR NEW.referral_code      IS DISTINCT FROM OLD.referral_code
  THEN
    RAISE EXCEPTION 'Cannot modify protected columns';
  END IF;

  -- Extra guard: referred_by can only go from NULL to non-NULL (one-time set)
  IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Cannot modify referred_by after initial set';
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 2. Update transfer_agent_to_portfolio with trigger bypass
-- ============================================================

CREATE OR REPLACE FUNCTION transfer_agent_to_portfolio(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_new_agent_balance NUMERIC;
  v_new_portfolio_balance NUMERIC;
BEGIN
  -- Bypass protected columns trigger
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Lock user row
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  IF v_user.agent_balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient agent wallet balance';
  END IF;

  -- Atomically debit agent wallet, credit portfolio
  UPDATE users
  SET agent_balance_usd = agent_balance_usd - p_amount,
      balance_usd = balance_usd + p_amount
  WHERE id = v_user_id
  RETURNING agent_balance_usd, balance_usd
  INTO v_new_agent_balance, v_new_portfolio_balance;

  -- Paired ledger entries
  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_user_id, 'agent_transfer_out', -p_amount, v_new_agent_balance,
     'Transfer from Agent Wallet to Portfolio'),
    (v_user_id, 'agent_transfer_in', p_amount, v_new_portfolio_balance,
     'Transfer from Agent Wallet to Portfolio');

  RETURN jsonb_build_object(
    'agent_balance_usd', v_new_agent_balance,
    'balance_usd', v_new_portfolio_balance
  );
END;
$$;


-- ============================================================
-- 3. Update _void_market_internal with trigger bypass
-- ============================================================

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
  -- Bypass protected columns trigger
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ======= 1. CLAW BACK CREDITED COMMISSIONS (from agent wallet) =======
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Debit the referrer's AGENT WALLET (clamp to 0 if already transferred out)
    UPDATE users SET agent_balance_usd = GREATEST(agent_balance_usd - v_comm.commission_amount, 0)
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_user.agent_balance_usd;

    -- Negative ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_user.agent_balance_usd,
      p_market_id,
      'Commission clawed back — market voided'
    );
  END LOOP;

  -- Void all commission records
  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ======= 2. REFUND ALL POSITIONS =======
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id AND shares_held > 0
    ORDER BY user_id
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

COMMIT;
