-- ============================================================
-- 221: Make _void_market_internal branch-aware
--
-- Changes:
-- 1. Commission clawback: unchanged (retail commissions only — branch has none yet)
-- 2. Retail refunds: filter to branch_id IS NULL
-- 3. Branch refunds: new loop — refund users, debit branch pool, payback if insufficient
-- 4. Recompute branch worst_case_total after voiding
-- ============================================================

CREATE OR REPLACE FUNCTION _void_market_internal(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_comm RECORD;
  v_user RECORD;
  v_refund_amount DECIMAL;
  v_refunds INTEGER := 0;
  v_new_agent_balance DECIMAL;
  -- Branch void variables
  v_branch_id UUID;
  v_branch_rec RECORD;
  v_branch_total_refund DECIMAL;
  v_branch_refunds INTEGER;
  v_deficit DECIMAL;
  v_new_worst_case DECIMAL;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ======= 1. LOCK + CLAW BACK COMMISSIONS (retail only — branch has no commissions yet) =======
  PERFORM 1 FROM referral_commissions
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited')
  FOR UPDATE;

  -- Claw back credited commissions
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    UPDATE users SET agent_balance_usd = GREATEST(agent_balance_usd - v_comm.commission_amount, 0)
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_new_agent_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_new_agent_balance,
      p_market_id,
      'Commission clawed back — market voided'
    );
  END LOOP;

  -- Void all commission records
  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ======= 2. REFUND RETAIL POSITIONS (branch_id IS NULL) =======
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND shares_held > 0
      AND branch_id IS NULL  -- *** RETAIL ONLY ***
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

  -- ======= 3. REFUND BRANCH POSITIONS =======
  -- For each branch with positions on this market
  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    -- Lock branch
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_refund := 0;
    v_branch_refunds := 0;

    -- Refund each branch user at WAC
    FOR v_pos IN
      SELECT * FROM positions
      WHERE market_id = p_market_id
        AND branch_id = v_branch_id
        AND shares_held > 0
      ORDER BY user_id
    LOOP
      SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

      v_refund_amount := v_pos.shares_held * v_pos.avg_entry_price;

      IF v_refund_amount > 0 THEN
        -- Users always get refunded
        UPDATE users SET balance_usd = balance_usd + v_refund_amount
        WHERE id = v_pos.user_id
        RETURNING balance_usd INTO v_pos_user.balance_usd;

        INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
        VALUES (
          v_pos.user_id, 'refund', v_refund_amount,
          v_pos_user.balance_usd,
          p_market_id,
          'Market voided — branch position refunded (' || v_pos.side || ')'
        );

        v_branch_total_refund := v_branch_total_refund + v_refund_amount;
        v_branch_refunds := v_branch_refunds + 1;
        v_refunds := v_refunds + 1;
      END IF;
    END LOOP;

    -- Debit branch pool for refunds (respect pool_balance >= 0 CHECK)
    IF v_branch_total_refund > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_refund - v_branch_rec.pool_balance);

      UPDATE branches SET
        pool_balance = GREATEST(0, pool_balance - v_branch_total_refund),
        pending_payouts = CASE WHEN v_deficit > 0 THEN pending_payouts + v_deficit ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      -- Pool ledger entry
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'void_refund', -v_branch_total_refund,
              GREATEST(0, v_branch_rec.pool_balance - v_branch_total_refund), p_market_id);

      -- Activate payback if there's a deficit and branch is active
      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Void refund shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0  -- deficit already added to pending_payouts above
        );
      END IF;

      -- Recompute worst_case_total (positions on this market are now zero)
      v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
      UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;
    END IF;

    -- Log per-branch void
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/void', format('Branch %s void refunds for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'refunds', v_branch_refunds,
        'total_refunded', ROUND(v_branch_total_refund, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id)
      ));
  END LOOP;

  -- ======= 4. UPDATE MARKET STATUS =======
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunds_issued', v_refunds
  );
END;
$$;
