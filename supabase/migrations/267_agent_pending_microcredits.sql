-- 267_agent_pending_microcredits.sql — Sub-cent P/L accrual + monthly sweep
--
-- Eng review finding (action 9): _credit_branch_pl (mig 252) updates
-- cumulative_pl unconditionally but only INSERTs a referral_commissions row
-- when amount >= $0.01. Sub-cent P/L is silently dropped. Two problems:
--   (1) cumulative_pl ≠ SUM(referral_commissions) → audit dissonance
--   (2) Many tiny P/L events (low-rate agent on many markets) accumulate
--       into real dollars of silent loss.
--
-- Fix: introduce agent_pending_microcredits — a per-(agent_id, branch_id)
-- accumulator. Every sub-cent P/L adds to the running total. The new
-- sweep_agent_microcredits() function, invoked monthly, materializes any
-- accrual that has crossed the $0.01 threshold into a proper commission row
-- and zeroes the accrual.
--
-- Design:
-- - Table is per (agent_id, branch_id) — one running balance per "earning
--   stream" for that agent on that branch. Not per-market — the sub-cent
--   chunks cross markets.
-- - Sweep writes a referral_commissions row with source_type='branch_pl'
--   and description 'microcredit sweep' so audit paths can distinguish.
-- - The existing $0.01 floor in _credit_branch_pl stays — we just redirect
--   sub-cent amounts to the accumulator instead of dropping them.
-- - The sweep function is safe to call multiple times — it only acts on
--   accruals that have crossed $0.01.
--
-- Why not change _credit_branch_pl to always insert a row?
--   Would create dozens of sub-penny referral_commissions rows per agent
--   per day. Bloats the table and clutters audit. Accumulator approach
--   keeps the main table clean while preserving all value.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. The accumulator table
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS agent_pending_microcredits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES branch_agents(id) ON DELETE CASCADE,
  agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  accrued_amount DECIMAL(18,6) NOT NULL DEFAULT 0,
  last_accrual_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sweep_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One running accumulator per (agent_id, branch_id). Strict unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_microcredits_agent_branch_unique
  ON agent_pending_microcredits (agent_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_agent_microcredits_agent_user
  ON agent_pending_microcredits (agent_user_id);

CREATE INDEX IF NOT EXISTS idx_agent_microcredits_accrued
  ON agent_pending_microcredits (accrued_amount)
  WHERE accrued_amount >= 0.01;

-- RLS — only service role and the owning agent can read their accumulator.
ALTER TABLE agent_pending_microcredits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Agents read own microcredits" ON agent_pending_microcredits;
CREATE POLICY "Agents read own microcredits" ON agent_pending_microcredits
  FOR SELECT USING (agent_user_id = auth.uid());

DROP POLICY IF EXISTS "Admin reads all microcredits" ON agent_pending_microcredits;
CREATE POLICY "Admin reads all microcredits" ON agent_pending_microcredits
  FOR SELECT USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE));

COMMENT ON TABLE agent_pending_microcredits IS
  'Per-(agent_id, branch_id) accumulator for sub-cent P/L amounts that do not meet the $0.01 floor to create a commission row. Swept monthly by sweep_agent_microcredits() — any accumulator >= $0.01 is materialized as a proper referral_commissions row and zeroed. Prevents silent loss of micro-earnings.';

-- Microcredit sweep rows aggregate P/L across many markets — no single
-- market_id applies. Relax the NOT NULL so sweep inserts succeed.
ALTER TABLE referral_commissions
  ALTER COLUMN market_id DROP NOT NULL;

COMMENT ON COLUMN referral_commissions.market_id IS
  'Market the commission accrued on. NULL for branch_pl microcredit sweep rows which aggregate sub-cent P/L across multiple markets.';

-- ═══════════════════════════════════════════════════════════
-- 2. Accrue helper — called from _credit_branch_pl for sub-cent amounts
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _accrue_microcredit(
  p_agent_id UUID,
  p_agent_user_id UUID,
  p_branch_id UUID,
  p_amount DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_amount = 0 THEN RETURN; END IF;

  INSERT INTO agent_pending_microcredits (
    agent_id, agent_user_id, branch_id, accrued_amount, last_accrual_at, updated_at
  ) VALUES (
    p_agent_id, p_agent_user_id, p_branch_id, p_amount, NOW(), NOW()
  )
  ON CONFLICT (agent_id, branch_id) DO UPDATE SET
    accrued_amount = agent_pending_microcredits.accrued_amount + EXCLUDED.accrued_amount,
    last_accrual_at = NOW(),
    updated_at = NOW();
END;
$$;

COMMENT ON FUNCTION _accrue_microcredit(UUID, UUID, UUID, DECIMAL) IS
  'Adds a sub-cent P/L amount to the agent''s accumulator. Called from _credit_branch_pl when |amount| < $0.01.';

-- ═══════════════════════════════════════════════════════════
-- 3. Redefine _credit_branch_pl — route sub-cent amounts to accumulator
--    Body is identical to migration 252 except the dropped amounts now
--    accrue instead of disappearing.
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION _credit_branch_pl(
  p_branch_id     UUID,
  p_agent_id      UUID,
  p_agent_user_id UUID,
  p_market_id     UUID,
  p_amount        DECIMAL,
  p_agent_rate    DECIMAL,
  p_pool_contribution DECIMAL
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

  -- Sub-cent amounts: accrue instead of drop.
  IF p_amount != 0 AND ABS(p_amount) < 0.01 THEN
    PERFORM _accrue_microcredit(p_agent_id, p_agent_user_id, p_branch_id, p_amount);
    RETURN p_amount;
  END IF;

  -- Negative at-or-above cent: only cumulative_pl (caller already updated).
  IF p_amount < 0 THEN
    RETURN p_amount;
  END IF;

  -- p_amount is >= 0.01 — full commission row path (original behavior).
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

-- ═══════════════════════════════════════════════════════════
-- 4. Sweep function — materialize accumulators >= $0.01
--    Called by the monthly cron (same cadence as the commission unlock).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sweep_agent_microcredits()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_swept_count INT := 0;
  v_swept_total DECIMAL := 0;
  v_new_balance DECIMAL;
  v_hold_enabled DECIMAL;
  v_unlock_at TIMESTAMPTZ;
BEGIN
  SELECT rate INTO v_hold_enabled
    FROM fee_config
   WHERE fee_type = 'commission_hold_enabled'
   LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  FOR v_row IN
    SELECT *
      FROM agent_pending_microcredits
     WHERE accrued_amount >= 0.01
     FOR UPDATE
  LOOP
    -- Insert a proper commission row for the swept amount.
    INSERT INTO referral_commissions (
      referrer_id, trader_id, market_id, trade_id,
      layer, agent_level_at_time,
      platform_revenue_amount, commission_rate, commission_amount,
      status, revenue_type,
      unlock_at, source_type, branch_id
    ) VALUES (
      v_row.agent_user_id, v_row.agent_user_id, NULL, NULL,
      1, 1,
      v_row.accrued_amount, 0, ROUND(v_row.accrued_amount, 2),
      'credited'::commission_status, 'resolution',
      v_unlock_at, 'branch_pl'::commission_source_type, v_row.branch_id
    );

    -- Credit the agent wallet (mirrors _credit_branch_pl behavior for >= $0.01).
    UPDATE users
       SET agent_balance_usd = agent_balance_usd + ROUND(v_row.accrued_amount, 2)
     WHERE id = v_row.agent_user_id
     RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, description)
    VALUES (
      v_row.agent_user_id, 'commission', ROUND(v_row.accrued_amount, 2), v_new_balance,
      'Branch P/L microcredit sweep — ' || ROUND(v_row.accrued_amount, 4) || ' accrued'
    );

    -- Zero the accumulator (keep the row for history — it's cheap).
    UPDATE agent_pending_microcredits
       SET accrued_amount = v_row.accrued_amount - ROUND(v_row.accrued_amount, 2),
           last_sweep_at = NOW(),
           updated_at = NOW()
     WHERE id = v_row.id;

    v_swept_count := v_swept_count + 1;
    v_swept_total := v_swept_total + ROUND(v_row.accrued_amount, 2);
  END LOOP;

  IF v_swept_count > 0 THEN
    PERFORM log_system_event(
      'info'::log_severity,
      'commission/microcredit_sweep',
      format('Swept %s microcredit accumulators totaling $%s', v_swept_count, ROUND(v_swept_total, 2)),
      jsonb_build_object('swept_count', v_swept_count, 'swept_total', v_swept_total)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'swept_count', v_swept_count,
    'swept_total', ROUND(v_swept_total, 2)
  );
END;
$$;

COMMENT ON FUNCTION sweep_agent_microcredits() IS
  'Monthly sweep of sub-cent P/L accruals. Any agent_pending_microcredits row with accrued_amount >= $0.01 gets materialized as a referral_commissions row + agent_balance credit + transaction ledger entry. Call from the same monthly cron that unlocks commissions.';

REVOKE EXECUTE ON FUNCTION sweep_agent_microcredits() FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION sweep_agent_microcredits() TO service_role;

COMMIT;
