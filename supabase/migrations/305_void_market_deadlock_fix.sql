-- ============================================================================
-- 305_void_market_deadlock_fix.sql
--
-- Fixes a latent deadlock surface in `_void_market_internal`. The function
-- loops over `referral_commissions` and `positions`, locking each user row
-- via FOR UPDATE inside the loop without a stable order. If two voids run
-- concurrently and touch overlapping users, the per-row locks can be
-- acquired in different orders, deadlocking the two transactions.
--
-- Voids are rare today, but speed markets adds oracle-outage voids which
-- can fire in batches. Speed markets also adds a "hard kill" admin path
-- that voids many markets at once. This migration tightens the lock
-- ordering before that surface lands.
--
-- Approach: at function start, after locking the `markets` row, collect
-- the distinct set of user IDs we'll touch (commission referrers + retail
-- position holders + branch position holders) and lock them ALL in
-- deterministic UUID order (ascending). Same pattern execute_trade uses
-- when locking referral_chain ancestors. The existing per-row FOR UPDATE
-- inside each loop becomes a no-op (already locked) but stays for safety.
--
-- The function body below is a complete rewrite of mig 143's
-- `_void_market_internal`. Behavior is unchanged except for the new
-- pre-lock step.
--
-- Rollback: re-apply mig 143's body. The exact original function definition
-- is preserved in git history.
-- ============================================================================

CREATE OR REPLACE FUNCTION public._void_market_internal(p_market_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_market RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_comm RECORD;
  v_user RECORD;
  v_refund_amount DECIMAL;
  v_refunds INTEGER := 0;
  v_actual_clawback DECIMAL;
  v_clawback_deficit DECIMAL;
  v_total_clawback_deficit DECIMAL := 0;
  v_clawback_deficit_count INTEGER := 0;
  v_new_agent_balance DECIMAL;
  v_branch_id UUID;
  v_branch_rec RECORD;
  v_branch_total_refund DECIMAL;
  v_branch_refunds INTEGER;
  v_deficit DECIMAL;
  v_new_pool_balance DECIMAL;
  v_new_worst_case DECIMAL;
  v_cash_in DECIMAL;
  v_cash_out_sells DECIMAL;
  v_total_refunds DECIMAL := 0;
  v_seed_pnl DECIMAL;
  v_affected_users UUID[];
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ═══ 0. PRE-LOCK ALL TOUCHED USERS IN DETERMINISTIC UUID ORDER ═══
  -- Collect every user we'll touch (commission referrers + position holders
  -- across retail and branches), then lock them all in ascending UUID order.
  -- Prevents deadlock between concurrent voids that share users.
  SELECT ARRAY(
    SELECT DISTINCT user_id FROM (
      SELECT referrer_id AS user_id
        FROM referral_commissions
       WHERE market_id = p_market_id
         AND status IN ('escrowed', 'credited')
      UNION
      SELECT user_id
        FROM positions
       WHERE market_id = p_market_id AND shares_held > 0
    ) u
    WHERE user_id IS NOT NULL
    ORDER BY user_id
  ) INTO v_affected_users;

  IF v_affected_users IS NOT NULL AND array_length(v_affected_users, 1) > 0 THEN
    PERFORM 1
      FROM users
     WHERE id = ANY(v_affected_users)
     ORDER BY id
     FOR UPDATE;
  END IF;

  -- ═══ 1. CLAW BACK COMMISSIONS — track deficits ═══
  PERFORM 1 FROM referral_commissions
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited')
  FOR UPDATE;

  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Compute actual debit possible (clamped to current agent_balance_usd)
    v_actual_clawback := LEAST(v_user.agent_balance_usd, v_comm.commission_amount);
    v_clawback_deficit := v_comm.commission_amount - v_actual_clawback;

    UPDATE users SET agent_balance_usd = agent_balance_usd - v_actual_clawback
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_new_agent_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_actual_clawback,
      v_new_agent_balance,
      p_market_id,
      CASE WHEN v_clawback_deficit > 0
        THEN 'Commission partially clawed back ($' || ROUND(v_actual_clawback, 2)
             || ' of $' || ROUND(v_comm.commission_amount, 2)
             || ', deficit $' || ROUND(v_clawback_deficit, 2) || ') — market voided'
        ELSE 'Commission clawed back — market voided'
      END
    );

    -- Track the deficit (platform loss)
    IF v_clawback_deficit > 0 THEN
      INSERT INTO commission_clawback_deficit
        (referrer_id, market_id, commission_id, expected_clawback, actual_clawback, deficit, reason)
      VALUES
        (v_comm.referrer_id, p_market_id, v_comm.id,
         v_comm.commission_amount, v_actual_clawback, v_clawback_deficit,
         'agent_balance_insufficient');

      v_total_clawback_deficit := v_total_clawback_deficit + v_clawback_deficit;
      v_clawback_deficit_count := v_clawback_deficit_count + 1;
    END IF;
  END LOOP;

  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ═══ 2. REFUND RETAIL POSITIONS ═══
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND shares_held > 0
      AND branch_id IS NULL
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
        v_pos_user.balance_usd, p_market_id,
        'Market voided — position refunded (' || v_pos.side || ')'
      );

      v_refunds := v_refunds + 1;
      v_total_refunds := v_total_refunds + v_refund_amount;
    END IF;
  END LOOP;

  -- ═══ 3. REFUND BRANCH POSITIONS — honest ledger ═══
  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_refund := 0;
    v_branch_refunds := 0;

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
        UPDATE users SET balance_usd = balance_usd + v_refund_amount
        WHERE id = v_pos.user_id
        RETURNING balance_usd INTO v_pos_user.balance_usd;

        INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
        VALUES (
          v_pos.user_id, 'refund', v_refund_amount,
          v_pos_user.balance_usd, p_market_id,
          'Market voided — branch position refunded (' || v_pos.side || ')'
        );

        v_branch_total_refund := v_branch_total_refund + v_refund_amount;
        v_branch_refunds := v_branch_refunds + 1;
        v_refunds := v_refunds + 1;
      END IF;
    END LOOP;

    IF v_branch_total_refund > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_refund - v_branch_rec.pool_balance);
      v_new_pool_balance := v_branch_rec.pool_balance - v_branch_total_refund;

      UPDATE branches SET
        pool_balance = v_new_pool_balance,
        pending_payouts = CASE WHEN v_deficit > 0
                              THEN pending_payouts + v_deficit
                              ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'void_refund', -v_branch_total_refund,
              v_new_pool_balance, p_market_id);

      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Void refund shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0
        );
      END IF;

      v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
      UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;
    END IF;

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/void', format('Branch %s void refunds for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'refunds', v_branch_refunds,
        'total_refunded', ROUND(v_branch_total_refund, 2),
        'deficit', ROUND(v_deficit, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id)
      ));
  END LOOP;

  -- ═══ 4. SET seed_pnl ON amm_state ═══
  -- For voided markets: seed_pnl = retail_buys - retail_sells - retail_refunds
  -- Fees collected stay with SOOQ regardless (not refunded).
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'sell';

  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_refunds;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  -- ═══ 5. UPDATE MARKET STATUS ═══
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  -- ═══ 6. SUMMARY LOG (only if clawback deficit happened) ═══
  IF v_total_clawback_deficit > 0 THEN
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('warn', 'admin/void',
      format('Market voided with clawback deficit: $%s across %s commissions',
             ROUND(v_total_clawback_deficit, 2), v_clawback_deficit_count),
      jsonb_build_object(
        'market_id', p_market_id,
        'total_deficit', ROUND(v_total_clawback_deficit, 2),
        'commissions_with_deficit', v_clawback_deficit_count
      ));
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunds_issued', v_refunds,
    'seed_pnl', ROUND(v_seed_pnl, 2),
    'clawback_deficit_total', ROUND(v_total_clawback_deficit, 2),
    'clawback_deficit_count', v_clawback_deficit_count
  );
END;
$function$;
