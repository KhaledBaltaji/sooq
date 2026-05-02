-- 263_branch_settle_resolution_idempotency.sql — FOR UPDATE on market + idempotency guard
--
-- Eng review finding (action 3): branch_settle_resolution (migration 252) reads
-- markets with bare SELECT and has no idempotency guard. Two concurrent
-- settlements on the same market (resolve_market retry, panic-click, split-brain)
-- both see the same pool_state, both loop over P/L agents, both credit. Net
-- effect: agents double-paid from a single real pool swing.
--
-- Fix:
-- 1. Add markets.branch_settled_at TIMESTAMPTZ (NULL until first successful run).
-- 2. Redefine branch_settle_resolution to:
--    - SELECT markets FOR UPDATE (serializes concurrent calls on the same market)
--    - Return early if branch_settled_at IS NOT NULL (idempotent)
--    - Set branch_settled_at = NOW() after the settlement loop completes
--
-- Notes:
-- - The FOR UPDATE is on the market row, so concurrent calls block the second
--   one until the first commits. The second then sees branch_settled_at set and
--   returns the prior result.
-- - We store the return JSONB in branch_settlement_result so retries get the
--   same payload back.
-- - _void_market_internal unchanged — voiding a market sets status='voided'
--   which is a separate terminal state. Voided markets never call
--   branch_settle_resolution.
-- - The new column is NULL for all existing (pre-migration) markets — they're
--   already resolved and won't re-enter this path, but if they do (admin
--   replay), the first call wins and subsequent calls return {already_settled: true}.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Add idempotency columns to markets
-- ═══════════════════════════════════════════════════════════

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS branch_settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS branch_settlement_result JSONB;

COMMENT ON COLUMN markets.branch_settled_at IS
  'Timestamp when branch_settle_resolution completed for this market. NULL until first successful run. Used as idempotency key.';

COMMENT ON COLUMN markets.branch_settlement_result IS
  'Cached JSONB result from branch_settle_resolution — returned on idempotent retries.';

-- ═══════════════════════════════════════════════════════════
-- 2. Redefine branch_settle_resolution with FOR UPDATE + idempotency
--    Body identical to migration 252 except the framing around the market lock.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION branch_settle_resolution(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_branch_rec RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout DECIMAL;
  v_fee_amount DECIMAL;
  v_branch_total_paid DECIMAL;
  v_branch_fees DECIMAL;
  v_branch_winners INTEGER;
  v_deficit DECIMAL;
  v_new_pool_balance DECIMAL;
  v_new_worst_case DECIMAL;
  v_branches_settled INTEGER := 0;
  v_total_branch_payouts DECIMAL := 0;
  v_branches_in_payback INTEGER := 0;
  v_branch_id UUID;
  v_pl_agent RECORD;
  v_trade_impact DECIMAL;
  v_sooq_addback_trades DECIMAL;
  v_resolution_impact DECIMAL;
  v_sooq_addback_resolution DECIMAL;
  v_pool_contribution DECIMAL;
  v_agent_pl DECIMAL;
  v_new_pool DECIMAL;
  v_pl_agents_settled INTEGER := 0;
  v_result JSONB;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ═══ IDEMPOTENCY GUARD — lock the market row first ═══
  -- FOR UPDATE serializes concurrent calls on the same market.
  -- The second caller blocks here until the first commits, then sees
  -- branch_settled_at IS NOT NULL and returns the cached result.
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  IF v_market.branch_settled_at IS NOT NULL THEN
    -- Already settled. Return cached result so callers see the same payload.
    RETURN COALESCE(
      v_market.branch_settlement_result,
      jsonb_build_object('already_settled', true, 'settled_at', v_market.branch_settled_at)
    );
  END IF;

  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_paid := 0;
    v_branch_fees := 0;
    v_branch_winners := 0;

    FOR v_pos IN
      SELECT * FROM positions
      WHERE market_id = p_market_id
        AND branch_id = v_branch_id
        AND side = p_outcome
        AND shares_held > 0
      ORDER BY user_id
    LOOP
      SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

      v_payout := v_pos.shares_held * (1.0 - v_resolution_fee_rate);
      v_fee_amount := v_pos.shares_held * v_resolution_fee_rate;

      UPDATE users SET balance_usd = balance_usd + v_payout
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_pos_user.balance_usd;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'resolution_payout', v_payout,
              v_pos_user.balance_usd, p_market_id,
              'Won (branch): ' || ROUND(v_pos.shares_held, 2) || ' shares x $'
              || ROUND(1.0 - v_resolution_fee_rate, 4));

      v_branch_total_paid := v_branch_total_paid + v_payout;
      v_branch_fees := v_branch_fees + v_fee_amount;
      v_branch_winners := v_branch_winners + 1;
    END LOOP;

    IF v_branch_total_paid > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_paid - v_branch_rec.pool_balance);
      v_new_pool_balance := v_branch_rec.pool_balance - v_branch_total_paid;

      UPDATE branches SET
        pool_balance = v_new_pool_balance,
        pending_payouts = CASE WHEN v_deficit > 0
                              THEN pending_payouts + v_deficit
                              ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'resolution_payout', -v_branch_total_paid,
              v_new_pool_balance, p_market_id);

      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Resolution shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0
        );
        v_branches_in_payback := v_branches_in_payback + 1;
      END IF;
    END IF;

    v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
    UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;

    PERFORM record_branch_revenue(p_market_id, v_branch_id, p_outcome, v_branch_fees);

    -- P/L agent settlement loop (migration 252)
    IF v_branch_rec.status != 'payback' THEN
      FOR v_pl_agent IN
        SELECT id, user_id, rate
        FROM branch_agents
        WHERE branch_id = v_branch_id
          AND agent_type = 'pl'
          AND is_active
      LOOP
        SELECT COALESCE(SUM(bp.amount), 0) INTO v_trade_impact
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type IN ('trade_buy', 'trade_sell', 'exit_fee');

        SELECT COALESCE(-SUM(bp.amount), 0) INTO v_sooq_addback_trades
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type = 'sooq_branch_fee';

        SELECT COALESCE(-SUM(p.shares_held * (1.0 - v_resolution_fee_rate)), 0)
          INTO v_resolution_impact
        FROM positions p
        JOIN branch_user_assignments a ON a.user_id = p.user_id
          AND a.branch_id = v_branch_id
        WHERE p.market_id = p_market_id
          AND p.branch_id = v_branch_id
          AND p.side = p_outcome
          AND p.shares_held > 0
          AND a.agent_id = v_pl_agent.id;

        SELECT COALESCE(SUM(p.shares_held * v_resolution_fee_rate), 0)
          INTO v_sooq_addback_resolution
        FROM positions p
        JOIN branch_user_assignments a ON a.user_id = p.user_id
          AND a.branch_id = v_branch_id
        WHERE p.market_id = p_market_id
          AND p.branch_id = v_branch_id
          AND p.side = p_outcome
          AND p.shares_held > 0
          AND a.agent_id = v_pl_agent.id;

        v_pool_contribution := v_trade_impact + v_sooq_addback_trades
                             + v_resolution_impact + v_sooq_addback_resolution;
        v_agent_pl := ROUND(v_pool_contribution * v_pl_agent.rate, 2);

        IF ABS(v_agent_pl) >= 0.01 THEN
          IF v_agent_pl > 0 THEN
            UPDATE branches
               SET pool_balance = pool_balance - v_agent_pl
             WHERE id = v_branch_id
             RETURNING pool_balance INTO v_new_pool;

            INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
            VALUES (v_branch_id, p_market_id, 'agent_pl_payout',
                    -v_agent_pl, v_new_pool, p_market_id,
                    'P/L payout — ' || ROUND(v_pl_agent.rate * 100, 1) || '% of $'
                      || ROUND(v_pool_contribution, 2) || ' pool contribution');
          END IF;

          PERFORM _credit_branch_pl(
            v_branch_id,
            v_pl_agent.id,
            v_pl_agent.user_id,
            p_market_id,
            v_agent_pl,
            v_pl_agent.rate,
            v_pool_contribution
          );

          v_pl_agents_settled := v_pl_agents_settled + 1;
        END IF;
      END LOOP;

      v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
      UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;
    END IF;

    v_branches_settled := v_branches_settled + 1;
    v_total_branch_payouts := v_total_branch_payouts + v_branch_total_paid;

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/resolution', format('Branch %s settled for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'winners', v_branch_winners,
        'total_paid', ROUND(v_branch_total_paid, 2),
        'deficit', ROUND(v_deficit, 2),
        'resolution_fees', ROUND(v_branch_fees, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id),
        'resolution_fee_rate_applied', v_resolution_fee_rate,
        'pl_agents_settled', v_pl_agents_settled
      ));
  END LOOP;

  v_result := jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback,
    'pl_agents_settled', v_pl_agents_settled
  );

  -- ═══ MARK IDEMPOTENT — cache the result ═══
  UPDATE markets
     SET branch_settled_at = NOW(),
         branch_settlement_result = v_result
   WHERE id = p_market_id;

  RETURN v_result;
END;
$$;

COMMIT;
