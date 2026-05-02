-- 248_branch_pool_repair_and_idempotency.sql — Honest ledger + idempotency + clawback tracking
--
-- Phase 1 audit fixes:
--   P1-06 — `branch_settle_resolution` and `_void_market_internal` use
--           `pool_balance = GREATEST(0, pool_balance - paid)` clamping. Writing
--           ledger entry with `amount = -$600` while clamping balance_after to
--           $0 breaks the append-only invariant: SUM(amount) != latest balance_after.
--           Then `reconcile_branch_solvency` "auto-fixes" via the same clamp,
--           silently swallowing the deficit. Audit found 508 unack reconciliation
--           errors over 7 days from this loop.
--
--   P1-07 — `record_revenue` does straight INSERT into `platform_revenue` with
--           no UNIQUE constraint on market_id. Any re-resolve (manual recovery,
--           replay) double-counts revenue.
--
--   P1-08 — Commission clawback in `_void_market_internal` uses
--           `GREATEST(agent_balance - amount, 0)` — silently absorbs the deficit
--           when an agent already withdrew. No record. Track it in a new table
--           so the platform's real loss is visible.
--
--   P1-09 — `_void_market_internal` doesn't update `amm_state.seed_pnl`. Voided
--           markets show stale seed_pnl on dashboards.
--
-- Per user decisions (2026-04-17):
--   - Drop the `pool_balance >= 0` CHECK constraint (P1-06 option A)
--   - Track clawback deficits in a new table, log only — don't debit balance_usd
--     for the shortfall (P1-08 default)

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Drop the pool_balance >= 0 CHECK constraint
--    Pool can legitimately go negative when a resolution payout exceeds the
--    pool. The ledger SUM is the source of truth; the cache must mirror it.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_pool_balance_check;

-- ═══════════════════════════════════════════════════════════
-- 2. commission_clawback_deficit — track silent clamp losses
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS commission_clawback_deficit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id),
  market_id UUID NOT NULL REFERENCES markets(id),
  commission_id UUID REFERENCES referral_commissions(id),
  expected_clawback DECIMAL(18,2) NOT NULL,
  actual_clawback DECIMAL(18,2) NOT NULL,
  deficit DECIMAL(18,2) NOT NULL,
  reason TEXT NOT NULL DEFAULT 'agent_balance_insufficient',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clawback_deficit_referrer ON commission_clawback_deficit(referrer_id);
CREATE INDEX IF NOT EXISTS idx_clawback_deficit_market ON commission_clawback_deficit(market_id);

ALTER TABLE commission_clawback_deficit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read clawback deficit" ON commission_clawback_deficit;
CREATE POLICY "Admin can read clawback deficit" ON commission_clawback_deficit
  FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

COMMENT ON TABLE commission_clawback_deficit IS
  'Records the gap when commission clawback could not fully recover the credited amount (agent withdrew before void). Platform loss; not auto-recovered from balance_usd.';

-- ═══════════════════════════════════════════════════════════
-- 3. platform_revenue UNIQUE on market_id + ON CONFLICT in record_revenue
-- ═══════════════════════════════════════════════════════════

-- Pre-flight: dedupe any existing duplicate platform_revenue rows (keep oldest)
DELETE FROM platform_revenue
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY market_id ORDER BY created_at, id) AS rn
    FROM platform_revenue
  ) ranked
  WHERE ranked.rn > 1
);

-- Add UNIQUE
ALTER TABLE platform_revenue
  ADD CONSTRAINT platform_revenue_market_unique UNIQUE (market_id);

-- Re-define record_revenue with ON CONFLICT DO UPDATE
CREATE OR REPLACE FUNCTION record_revenue(
  p_market_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_explicit DECIMAL;
  v_total_amm_spread DECIMAL;
  v_total_cash_out DECIMAL;
  v_resolution_fee DECIMAL;
  v_dynamic_spread DECIMAL;
  v_total_fees DECIMAL;
  v_total_commissions DECIMAL;
  v_net_revenue DECIMAL;
  v_total_volume DECIMAL;
  v_resolution_fee_rate DECIMAL;
  v_market RECORD;
BEGIN
  SELECT
    COALESCE(SUM(explicit_fee), 0),
    COALESCE(SUM(amm_spread_cost), 0),
    COALESCE(SUM(cash_out_premium), 0),
    COALESCE(SUM(dynamic_spread), 0)
  INTO v_total_explicit, v_total_amm_spread, v_total_cash_out, v_dynamic_spread
  FROM retail_trades WHERE market_id = p_market_id;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  -- Snapshot read (set in migration 245)
  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  IF v_market.outcome IS NOT NULL THEN
    SELECT COALESCE(SUM(shares_held * v_resolution_fee_rate), 0) INTO v_resolution_fee
    FROM retail_positions
    WHERE market_id = p_market_id
      AND side = v_market.outcome
      AND shares_held > 0;
  ELSE
    v_resolution_fee := 0;
  END IF;

  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_commissions
  FROM referral_commissions
  WHERE market_id = p_market_id AND status = 'credited';

  SELECT COALESCE(total_volume, 0) INTO v_total_volume
  FROM amm_state WHERE market_id = p_market_id;

  v_total_fees := v_total_explicit + v_total_amm_spread + v_resolution_fee
                  + v_dynamic_spread + v_total_cash_out;
  v_net_revenue := v_total_fees - v_total_commissions;

  -- Idempotent: re-running record_revenue overwrites (recomputes from immutable trade/position sources)
  INSERT INTO platform_revenue (
    market_id, total_pot, seed_amount, platform_fee,
    total_commissions, net_revenue,
    explicit_fee_revenue, amm_spread_revenue, resolution_fee_revenue,
    dynamic_spread_revenue, cash_out_premium_revenue
  ) VALUES (
    p_market_id, v_total_volume, 0, v_total_fees,
    v_total_commissions, v_net_revenue,
    v_total_explicit, v_total_amm_spread, v_resolution_fee,
    v_dynamic_spread, v_total_cash_out
  )
  ON CONFLICT (market_id) DO UPDATE SET
    total_pot = EXCLUDED.total_pot,
    platform_fee = EXCLUDED.platform_fee,
    total_commissions = EXCLUDED.total_commissions,
    net_revenue = EXCLUDED.net_revenue,
    explicit_fee_revenue = EXCLUDED.explicit_fee_revenue,
    amm_spread_revenue = EXCLUDED.amm_spread_revenue,
    resolution_fee_revenue = EXCLUDED.resolution_fee_revenue,
    dynamic_spread_revenue = EXCLUDED.dynamic_spread_revenue,
    cash_out_premium_revenue = EXCLUDED.cash_out_premium_revenue;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. branch_settle_resolution — honest ledger (no clamping)
--    Re-defines from migration 245 (snapshot read preserved).
--    Pool can now go negative; pending_payouts still tracks operational debt.
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
      -- HONEST balance_after — no clamping. Pool can go negative.
      v_new_pool_balance := v_branch_rec.pool_balance - v_branch_total_paid;

      UPDATE branches SET
        pool_balance = v_new_pool_balance,
        pending_payouts = CASE WHEN v_deficit > 0
                              THEN pending_payouts + v_deficit
                              ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      -- Honest ledger entry: amount = full payout, balance_after = real pool position
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
        'resolution_fee_rate_applied', v_resolution_fee_rate
      ));
  END LOOP;

  RETURN jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 5. _void_market_internal — honest ledger, deficit tracking, seed_pnl set
--    Re-defines from migration 221.
-- ═══════════════════════════════════════════════════════════

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
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
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
  -- This represents SOOQ's operational P&L on the trades that happened.
  -- Fees collected stay with SOOQ regardless (not refunded).
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'sell';

  -- Use only retail refunds (branch refunds came from branch pool)
  -- Recompute v_total_refunds for retail only — already accumulated above
  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_refunds;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  -- ═══ 5. UPDATE MARKET STATUS ═══
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  -- ═══ 6. SUMMARY LOG (only if clawback deficit happened — important signal) ═══
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
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. reconcile_branch_solvency — stop clamping, surface true ledger sum
--    Re-defines from migration 219.
--    The auto-fix now sets pool_balance to the actual ledger sum
--    (not GREATEST(0, sum)). Negative balances are visible, not hidden.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION reconcile_branch_solvency()
RETURNS TABLE (
  branch_id UUID,
  branch_name TEXT,
  cached_worst_case DECIMAL,
  computed_worst_case DECIMAL,
  difference DECIMAL,
  cached_pool_balance DECIMAL,
  ledger_pool_balance DECIMAL,
  pool_difference DECIMAL
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_branch RECORD;
  v_computed DECIMAL;
  v_ledger_balance DECIMAL;
  v_diff DECIMAL;
  v_pool_diff DECIMAL;
BEGIN
  FOR v_branch IN SELECT * FROM branches WHERE status NOT IN ('suspended') LOOP
    v_computed := _recompute_branch_worst_case(v_branch.id);
    v_diff := v_branch.worst_case_total - v_computed;

    SELECT COALESCE(SUM(amount), 0) INTO v_ledger_balance
    FROM branch_pools WHERE branch_pools.branch_id = v_branch.id;
    v_pool_diff := v_branch.pool_balance - v_ledger_balance;

    IF ABS(v_diff) > 0.01 OR ABS(v_pool_diff) > 0.01 THEN
      PERFORM log_system_event(
        'warn'::log_severity,
        'branch_solvency_reconciliation',
        'Branch ' || v_branch.name || ' solvency mismatch — auto-corrected to ledger truth',
        jsonb_build_object(
          'branch_id', v_branch.id,
          'cached_worst_case', v_branch.worst_case_total,
          'computed_worst_case', v_computed,
          'wc_difference', v_diff,
          'cached_pool', v_branch.pool_balance,
          'ledger_pool', v_ledger_balance,
          'pool_difference', v_pool_diff
        )
      );

      -- Auto-fix: set cache to actual ledger sum (NO clamping to 0)
      PERFORM set_config('app.trigger_bypass', 'true', true);
      UPDATE branches SET
        worst_case_total = v_computed,
        pool_balance = v_ledger_balance
      WHERE id = v_branch.id;
    END IF;

    branch_id := v_branch.id;
    branch_name := v_branch.name;
    cached_worst_case := v_branch.worst_case_total;
    computed_worst_case := v_computed;
    difference := v_diff;
    cached_pool_balance := v_branch.pool_balance;
    ledger_pool_balance := v_ledger_balance;
    pool_difference := v_pool_diff;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMIT;
