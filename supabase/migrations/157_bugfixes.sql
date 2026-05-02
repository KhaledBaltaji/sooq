-- 157_bugfixes.sql — Fix void ledger bug + drop zombie function overloads
--
-- 1. _void_market_internal: RETURNING clause was capturing balance_usd instead of
--    agent_balance_usd after debiting the agent wallet, causing wrong balance_after
--    in clawback ledger entries.
-- 2. Drop zombie process_deposit 4-arg overload (references dropped V2 schema).
-- 3. Drop zombie settle_commissions (replaced by settle_resolution_commissions).
-- 4. Drop zombie record_revenue 2-arg overload (replaced by 1-arg version).

BEGIN;

-- ============================================================
-- 1. Fix _void_market_internal — correct RETURNING clause
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
    RETURNING agent_balance_usd INTO v_user.agent_balance_usd;

    -- Negative ledger entry (balance_after reflects agent wallet, not portfolio)
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_user.agent_balance_usd,
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

COMMIT;

-- ============================================================
-- 2. Drop zombie function overloads (outside transaction — DDL)
-- ============================================================

-- Old 4-arg process_deposit from migration 023 (references dropped V2 schema)
DROP FUNCTION IF EXISTS process_deposit(UUID, DECIMAL, TEXT, TEXT);

-- Old settle_commissions from migration 111 (replaced by settle_resolution_commissions in 131)
DROP FUNCTION IF EXISTS settle_commissions(UUID);

-- Old 2-arg record_revenue from migration 112 (replaced by 1-arg version in 135)
DROP FUNCTION IF EXISTS record_revenue(UUID, DECIMAL);
