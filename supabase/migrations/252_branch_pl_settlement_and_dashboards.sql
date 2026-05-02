-- ═══════════════════════════════════════════════════════════════════
-- Migration 252: P/L Settlement + Approval Guardrails + Owner Payout
--                + Pending Liabilities View + Dashboard RPCs
--                (PR 3 of 3)
--
-- Plan reference: ~/.claude/plans/glittery-wiggling-lagoon.md
--   "PR 3 IMPLEMENTATION PLAN — Migration 252" section.
--
-- WHAT THIS DOES
--   1. Adds new branch_pools.type values: 'agent_pl_payout', 'owner_payout'.
--   2. Adds fee_config.max_pl_agent_rate_sum (default 0.80) — the rate cap
--      enforced by approve_branch_agent for P/L-type agents.
--   3. Adds index for fast pending-liabilities and solvency queries.
--   4. Creates `branch_pending_liabilities` view — aggregates credited-
--      but-unlocked branch commissions per (agent_user_id, branch_id).
--   5. Introduces `_credit_branch_pl` helper — mirrors PR 2's
--      `_credit_branch_commission` but for P/L payouts (source_type
--      'branch_pl', revenue_type 'resolution'). Handles positive AND
--      negative amounts: positive → credits wallet + inserts row;
--      negative → only debits cumulative_pl (no commission row).
--   6. Extends `branch_settle_resolution` to iterate P/L-type agents
--      per branch, compute per-referred-user pool P/L (with SOOQ fee
--      add-back), multiply by agent.rate, write commission + pool
--      ledger entries.
--   7. Tightens `approve_branch_agent` with 80% combined P/L rate cap.
--   8. Tightens `transfer_agent_to_portfolio` — blocks transfers when
--      user's aggregate cumulative_pl is negative.
--   9. Adds `preview_branch_agent_pl(branch_id, rate)` — projection
--      for approval modal.
--  10. Adds `get_branch_owner_summary(branch_id)` — branch dashboard
--      summary (pool health, pending liabilities, agents, monthly
--      payout preview).
--  11. Adds `transfer_branch_pool_to_owner_portfolio(branch_id, amount)`
--      — owner withdrawal RPC. Available =
--      pool_balance − worst_case_total − pending_liabilities.
--
-- WHY NOW
--   PR 1 established the monthly lock. PR 2 started paying commission-
--   type branch agents. PR 3 closes the loop: P/L-type agents earn at
--   resolution, dashboards surface the liabilities, and branch owners
--   can pull their profit. After PR 3, the full branch partnership
--   model works end-to-end.
--
-- P/L FORMULA (product-decided, see plan C)
--   For each P/L agent:
--     pool_contribution = SUM(pool flow from agent's referred users'
--                             trades + payouts + SOOQ fee add-back)
--     agent_pl_share    = pool_contribution × agent.rate
--   Positive → commission row + pool debit. Negative → cumulative_pl
--   debit only (carries forward until offset by future earnings).
--
-- SOOQ FEE ADD-BACK
--   Trade-level: the `sooq_branch_fee` entries are negative on the
--   pool (SOOQ's take). For P/L we add them back so agents don't
--   absorb the platform's fee.
--   Resolution-level: `resolution_fee_rate_snapshot × shares_held`
--   is the platform's cut that never left as payout. We add it back
--   when computing the agent's share of the branch's "gross" P/L.
--
-- SILENT-BREAK MITIGATIONS
--   • Rate cap only applies to NEW approvals. Existing approved
--     agents above the cap are grandfathered.
--   • P/L loop runs AFTER winner payouts and pool updates in
--     branch_settle_resolution — it sees the final pool state.
--   • cumulative_pl check in transfer_agent_to_portfolio sums
--     across ALL branch_agent rows the user has (even across
--     branches) — matches the "across full balance" plan decision.
--   • Owner withdrawal reserves worst_case AND pending_liabilities
--     BEFORE allowing withdrawal — can't starve agents.
-- ═══════════════════════════════════════════════════════════════════


-- ============================================================
-- 1. Config flag — 80% combined P/L rate cap
-- ============================================================

INSERT INTO fee_config (fee_type, rate, description)
SELECT 'max_pl_agent_rate_sum', 0.80,
       'Maximum combined rate across all P/L-type branch agents on a branch. Enforced by approve_branch_agent. Grandfathers existing agents above the cap.'
WHERE NOT EXISTS (
  SELECT 1 FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum'
);


-- ============================================================
-- 2. Extend branch_pools.type enum
-- ============================================================

ALTER TYPE branch_pool_entry_type ADD VALUE IF NOT EXISTS 'agent_pl_payout';
ALTER TYPE branch_pool_entry_type ADD VALUE IF NOT EXISTS 'owner_payout';


-- ============================================================
-- 3. Index for solvency + pending-liabilities queries
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_branch_pools_branch_type_ref
  ON branch_pools (branch_id, type, reference_id);


-- ============================================================
-- 4. View: branch_pending_liabilities
--    Aggregates credited-but-locked branch commissions per
--    (agent_user_id, branch_id). Used by get_branch_owner_summary
--    and the owner-withdrawal RPC.
-- ============================================================

CREATE OR REPLACE VIEW branch_pending_liabilities AS
SELECT
  referrer_id AS agent_user_id,
  branch_id,
  COALESCE(SUM(commission_amount), 0) AS pending_amount,
  MIN(unlock_at) AS next_unlock_at,
  COUNT(*) AS pending_count
FROM referral_commissions
WHERE status = 'credited'
  AND source_type IN ('branch_commission', 'branch_pl')
  AND branch_id IS NOT NULL
  AND unlock_at IS NOT NULL
  AND unlock_at > NOW()
GROUP BY referrer_id, branch_id;

COMMENT ON VIEW branch_pending_liabilities IS
'Live view of commissions owed to branch agents that have not yet unlocked. Summed per (agent_user_id, branch_id). Used by get_branch_owner_summary and transfer_branch_pool_to_owner_portfolio.';


-- ============================================================
-- 5. Helper: _credit_branch_pl
--    Sibling of _credit_branch_commission (from PR 2). Handles
--    positive (credit row + agent wallet) and negative (cumulative_pl
--    debit only) payouts. Positive only writes a commission row when
--    above the $0.01 floor.
-- ============================================================

CREATE OR REPLACE FUNCTION _credit_branch_pl(
  p_branch_id     UUID,
  p_agent_id      UUID,     -- branch_agents.id (for cumulative_pl update)
  p_agent_user_id UUID,     -- users.id of the agent
  p_market_id     UUID,
  p_amount        DECIMAL,  -- signed: positive = earn, negative = loss
  p_agent_rate    DECIMAL,  -- for reporting
  p_pool_contribution DECIMAL  -- for reporting (pre-rate amount)
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_hold_enabled DECIMAL;
  v_unlock_at    TIMESTAMPTZ;
  v_new_balance  DECIMAL;
BEGIN
  -- Always update cumulative_pl (positive or negative).
  UPDATE branch_agents
     SET cumulative_pl = cumulative_pl + p_amount
   WHERE id = p_agent_id;

  -- Only write commission row + wallet credit if positive above floor.
  IF p_amount < 0.01 THEN
    RETURN p_amount;
  END IF;

  SELECT rate INTO v_hold_enabled
    FROM fee_config
   WHERE fee_type = 'commission_hold_enabled'
   LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id,
    layer, agent_level_at_time,
    platform_revenue_amount, commission_rate, commission_amount,
    status, revenue_type,
    unlock_at, source_type, branch_id
  ) VALUES (
    p_agent_user_id, p_agent_user_id, p_market_id, NULL,
    1, 1,
    p_pool_contribution, p_agent_rate, p_amount,
    'credited'::commission_status, 'resolution',
    v_unlock_at, 'branch_pl'::commission_source_type, p_branch_id
  );

  UPDATE users
     SET agent_balance_usd = agent_balance_usd + p_amount
   WHERE id = p_agent_user_id
   RETURNING agent_balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_agent_user_id, 'commission', p_amount, v_new_balance,
    p_market_id,
    'Branch P/L — ' || ROUND(p_agent_rate * 100, 1) || '% of $'
      || ROUND(p_pool_contribution, 2) || ' pool contribution'
  );

  RETURN p_amount;
END;
$$;

REVOKE ALL ON FUNCTION _credit_branch_pl(UUID, UUID, UUID, UUID, DECIMAL, DECIMAL, DECIMAL) FROM PUBLIC;


-- ============================================================
-- 6. Extend branch_settle_resolution with P/L loop
--    Baseline: migration 248. P/L loop added AFTER winner payout +
--    pool update + worst_case recompute + revenue record.
-- ============================================================

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

  -- ───── PR 3 NEW: P/L settlement vars ─────
  v_pl_agent RECORD;
  v_trade_impact DECIMAL;
  v_sooq_addback_trades DECIMAL;
  v_resolution_impact DECIMAL;
  v_sooq_addback_resolution DECIMAL;
  v_pool_contribution DECIMAL;
  v_agent_pl DECIMAL;
  v_new_pool DECIMAL;
  v_pl_agents_settled INTEGER := 0;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
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

    -- ═══ Winner payouts (unchanged from migration 248) ═══
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

    -- ═══ PR 3 NEW: P/L agent settlement loop ═══
    -- Skipped while branch is in payback — agents wait until recovery.
    IF v_branch_rec.status != 'payback' THEN
      FOR v_pl_agent IN
        SELECT id, user_id, rate
        FROM branch_agents
        WHERE branch_id = v_branch_id
          AND agent_type = 'pl'
          AND is_active
      LOOP
        -- Trade-level pool impact from this agent's referred users.
        -- branch_trades.agent_id records the referring agent per trade.
        SELECT COALESCE(SUM(bp.amount), 0) INTO v_trade_impact
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type IN ('trade_buy', 'trade_sell', 'exit_fee');

        -- Add back SOOQ's cut on those trades (we exclude platform fees from P/L).
        SELECT COALESCE(-SUM(bp.amount), 0) INTO v_sooq_addback_trades
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type = 'sooq_branch_fee';

        -- Resolution payout impact (pool lost winner payouts on referred users).
        -- Trace user → branch_user_assignments → agent.
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

        -- Add back SOOQ resolution fee on those positions.
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

        -- If any activity (positive or negative), record the P/L accrual.
        IF ABS(v_agent_pl) >= 0.01 THEN
          -- Pool debit for positive payouts only. Negative accruals stay
          -- on cumulative_pl (no pool movement — pool already reflected
          -- the trade flows via trade_buy/sell/resolution_payout entries).
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

      -- Recompute worst case after P/L payouts (pool balance may have shifted).
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

  RETURN jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback,
    'pl_agents_settled', v_pl_agents_settled
  );
END;
$$;


-- ============================================================
-- 7. Tighten approve_branch_agent — 80% combined P/L rate cap
--    Baseline: migration 231. Only adds the cap check.
-- ============================================================

CREATE OR REPLACE FUNCTION approve_branch_agent(
  p_agent_id UUID,
  p_agent_type TEXT,
  p_rate DECIMAL,
  p_deposit_required DECIMAL DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
  v_branch RECORD;
  v_existing_pl_sum DECIMAL;
  v_cap DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id, b.id as bid
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_agent.status != 'pending' THEN
    RAISE EXCEPTION 'Agent is not in pending status';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- ───── PR 3 NEW: 80% combined P/L rate cap ─────
  IF p_agent_type = 'pl' THEN
    SELECT COALESCE(SUM(rate), 0) INTO v_existing_pl_sum
    FROM branch_agents
    WHERE branch_id = v_agent.branch_id
      AND agent_type = 'pl'
      AND status = 'approved'
      AND id != p_agent_id;

    SELECT rate INTO v_cap
    FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum' LIMIT 1;
    v_cap := COALESCE(v_cap, 0.80);

    IF (v_existing_pl_sum + p_rate) > v_cap THEN
      RAISE EXCEPTION 'Combined P/L rate would exceed % cap (existing %, proposed %, sum %)',
        ROUND(v_cap * 100, 1),
        ROUND(v_existing_pl_sum * 100, 1),
        ROUND(p_rate * 100, 1),
        ROUND((v_existing_pl_sum + p_rate) * 100, 1);
    END IF;
  END IF;

  UPDATE branch_agents
  SET status = 'approved',
      agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0),
      is_active = true,
      approved_at = now(),
      approved_by = v_caller
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'status', 'approved',
    'agent_type', p_agent_type,
    'rate', p_rate
  );
END;
$$;


-- ============================================================
-- 8. Tighten transfer_agent_to_portfolio — block on negative P/L
--    Baseline: migration 250 (PR 1). Adds cumulative_pl aggregate check.
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
  v_pending NUMERIC;
  v_available NUMERIC;
  v_pl_aggregate DECIMAL;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- PR 3 NEW: block transfer if user has negative aggregate cumulative_pl
  -- across all their branch_agent rows. The "P/L debt" must be covered
  -- by future earnings before they can withdraw anything.
  SELECT COALESCE(SUM(cumulative_pl), 0) INTO v_pl_aggregate
  FROM branch_agents
  WHERE user_id = v_user_id;

  IF v_pl_aggregate < 0 THEN
    RAISE EXCEPTION 'P/L debt outstanding ($%) — cover via future earnings before withdrawing',
      ROUND(-v_pl_aggregate, 2);
  END IF;

  -- PR 1: compute pending (locked) and available balances
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_pending
  FROM referral_commissions
  WHERE referrer_id = v_user_id
    AND status = 'credited'
    AND unlock_at IS NOT NULL
    AND unlock_at > NOW();

  v_available := GREATEST(v_user.agent_balance_usd - v_pending, 0);

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient unlocked balance (available: $%, pending: $%, requested: $%)',
      ROUND(v_available, 2), ROUND(v_pending, 2), ROUND(p_amount, 2);
  END IF;

  IF v_user.agent_balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient agent wallet balance';
  END IF;

  UPDATE users
  SET agent_balance_usd = agent_balance_usd - p_amount,
      balance_usd = balance_usd + p_amount
  WHERE id = v_user_id
  RETURNING agent_balance_usd, balance_usd
  INTO v_new_agent_balance, v_new_portfolio_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_user_id, 'agent_transfer_out', -p_amount, v_new_agent_balance,
     'Transfer from Agent Wallet to Portfolio'),
    (v_user_id, 'agent_transfer_in', p_amount, v_new_portfolio_balance,
     'Transfer from Agent Wallet to Portfolio');

  RETURN jsonb_build_object(
    'agent_balance_usd', v_new_agent_balance,
    'balance_usd', v_new_portfolio_balance,
    'available', GREATEST(v_new_agent_balance - v_pending, 0),
    'pending', v_pending
  );
END;
$$;


-- ============================================================
-- 9. New RPC: preview_branch_agent_pl
--    Estimates what a P/L agent would have earned at the proposed
--    rate, based on the last 30 days of the branch's resolved pool
--    flow. Used by approval modal preview pane.
-- ============================================================

CREATE OR REPLACE FUNCTION preview_branch_agent_pl(
  p_branch_id UUID,
  p_rate DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_net_pool_flow DECIMAL;
  v_projected_payout DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate';
  END IF;

  -- Net pool flow over last 30 days, excluding owner/agent payouts
  -- (we're projecting gross before this agent takes their cut).
  SELECT COALESCE(SUM(amount), 0) INTO v_net_pool_flow
  FROM branch_pools
  WHERE branch_id = p_branch_id
    AND created_at >= NOW() - INTERVAL '30 days'
    AND type IN ('trade_buy', 'trade_sell', 'exit_fee',
                 'resolution_payout', 'void_refund',
                 'withdrawal', 'withdrawal_fee');

  v_projected_payout := ROUND(GREATEST(0, v_net_pool_flow) * p_rate, 2);

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'proposed_rate', p_rate,
    'last_30d_net_pool_flow', ROUND(v_net_pool_flow, 2),
    'projected_monthly_payout', v_projected_payout,
    'basis', 'Projection based on last 30 days of branch pool activity. Actual P/L depends on which users are referred by this agent and their trading outcomes.'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION preview_branch_agent_pl(UUID, DECIMAL) TO authenticated;


-- ============================================================
-- 10. New RPC: get_branch_owner_summary
--     Dashboard-facing aggregate of pool health + agent liabilities.
-- ============================================================

CREATE OR REPLACE FUNCTION get_branch_owner_summary(p_branch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_pending_total DECIMAL;
  v_next_unlock TIMESTAMPTZ;
  v_effective DECIMAL;
  v_solvency_status TEXT;
  v_agents JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  -- Sum pending liabilities across all agents on this branch
  SELECT COALESCE(SUM(pending_amount), 0), MIN(next_unlock_at)
  INTO v_pending_total, v_next_unlock
  FROM branch_pending_liabilities
  WHERE branch_id = p_branch_id;

  v_effective := v_branch.pool_balance - v_branch.worst_case_total - v_pending_total;

  v_solvency_status := CASE
    WHEN v_branch.status = 'payback' THEN 'payback_mode'
    WHEN v_effective < 0 THEN 'warning'
    WHEN v_branch.pool_balance < v_branch.worst_case_total THEN 'warning'
    ELSE 'healthy'
  END;

  -- Agent list with pending liabilities
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ba.id,
    'user_id', ba.user_id,
    'display_name', u.display_name,
    'agent_type', ba.agent_type,
    'rate', ba.rate,
    'status', ba.status,
    'is_active', ba.is_active,
    'cumulative_pl', ba.cumulative_pl,
    'pending_liability', COALESCE(bpl.pending_amount, 0),
    'next_unlock_at', bpl.next_unlock_at
  )), '[]'::jsonb) INTO v_agents
  FROM branch_agents ba
  JOIN users u ON u.id = ba.user_id
  LEFT JOIN branch_pending_liabilities bpl
    ON bpl.agent_user_id = ba.user_id AND bpl.branch_id = ba.branch_id
  WHERE ba.branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'pool_balance', v_branch.pool_balance,
    'worst_case_total', v_branch.worst_case_total,
    'pending_payouts', v_branch.pending_payouts,
    'pending_liabilities', v_pending_total,
    'effective_pool', v_effective,
    'solvency_status', v_solvency_status,
    'next_unlock_at', v_next_unlock,
    'agents', v_agents
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_branch_owner_summary(UUID) TO authenticated;


-- ============================================================
-- 11. New RPC: transfer_branch_pool_to_owner_portfolio
--     Owner withdrawal with solvency + liability reservation gates.
--     Available = pool_balance − worst_case_total − pending_liabilities.
-- ============================================================

CREATE OR REPLACE FUNCTION transfer_branch_pool_to_owner_portfolio(
  p_branch_id UUID,
  p_amount DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_pending DECIMAL;
  v_available DECIMAL;
  v_new_pool DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_branch.status = 'payback' THEN
    RAISE EXCEPTION 'Branch in payback mode — owner withdrawals paused';
  END IF;

  SELECT COALESCE(SUM(pending_amount), 0) INTO v_pending
  FROM branch_pending_liabilities
  WHERE branch_id = p_branch_id;

  v_available := v_branch.pool_balance - v_branch.worst_case_total - v_pending;

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient available pool (available $%, pool $%, worst_case $%, pending $%, requested $%)',
      ROUND(v_available, 2), ROUND(v_branch.pool_balance, 2),
      ROUND(v_branch.worst_case_total, 2), ROUND(v_pending, 2),
      ROUND(p_amount, 2);
  END IF;

  UPDATE branches
     SET pool_balance = pool_balance - p_amount,
         updated_at = NOW()
   WHERE id = p_branch_id
   RETURNING pool_balance INTO v_new_pool;

  INSERT INTO branch_pools (branch_id, type, amount, balance_after, reference_id, description)
  VALUES (p_branch_id, 'owner_payout', -p_amount, v_new_pool, NULL,
          'Branch owner withdrawal to portfolio');

  UPDATE users
     SET balance_usd = balance_usd + p_amount,
         updated_at = NOW()
   WHERE id = v_caller
   RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES (v_caller, 'branch_owner_payout', p_amount, v_new_balance,
          'Branch pool withdrawal ($' || ROUND(p_amount, 2) || ')');

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'amount', p_amount,
    'new_pool_balance', v_new_pool,
    'new_owner_balance', v_new_balance,
    'available_after', ROUND(v_available - p_amount, 2)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION transfer_branch_pool_to_owner_portfolio(UUID, DECIMAL) TO authenticated;
