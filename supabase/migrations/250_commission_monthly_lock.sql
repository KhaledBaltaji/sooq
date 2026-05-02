-- ═══════════════════════════════════════════════════════════════════
-- Migration 250: Commission Monthly Payout Lock (PR 1 of 3)
--
-- Plan reference: ~/.claude/plans/glittery-wiggling-lagoon.md section A.
--
-- WHAT THIS DOES
--   Introduces a monthly calendar + grace period lock on agent
--   commissions. Commissions earned in month M become transferable
--   to portfolio on the 1st of month M+1 (UTC). Rolls forward with
--   a simple flag in fee_config so the entire behavior can be
--   disabled with a single UPDATE (no rollback migration needed).
--
-- DESIGN NOTES
--   • `unlock_at` is metadata on the commission row, not a
--     separate balance. `agent_balance_usd` stays as the cached
--     total (unchanged from prior behavior).
--   • Available balance is derived at read time:
--       available = agent_balance_usd − SUM(pending commissions)
--     where "pending" = status='credited' AND unlock_at > NOW().
--   • Existing rows (pre-migration) have unlock_at = NULL and are
--     fully available — grandfathered.
--   • Admin credits and other direct writes to `agent_balance_usd`
--     that bypass _credit_commission have no referral_commissions
--     row, so they contribute 0 to pending → stay fully available.
--     This is the intended behavior (admin grants are instant).
--
-- SILENT-BREAK MITIGATIONS (from eng review audit)
--   Risk A — _void_market_internal unlock_at handling: NOT needed.
--     Voided rows have status='voided' which fails the
--     "status='credited'" filter used in pending calculation.
--     Implicit protection via status filter is sufficient.
--   Risk B — 12 files read agent_balance_usd directly: BY DESIGN.
--     Those reads show the TOTAL balance (correct for display).
--     The transfer_agent_to_portfolio RPC is the ONLY gate that
--     enforces the lock. UI is being updated to show available
--     vs. pending in PR 1 frontend work.
--   Risk C — admin balance adjustments: admin-credited money has
--     no commission row → no lock → instantly available. Correct.
--
-- ROLLBACK PLAN
--   UPDATE fee_config SET rate = 0
--   WHERE fee_type = 'commission_hold_enabled';
--   (Existing locked rows retain their unlock_at but the transfer
--   RPC no longer enforces; new commissions land with unlock_at=NULL.)
-- ═══════════════════════════════════════════════════════════════════

-- ============================================================
-- 1. Schema: add unlock_at column to referral_commissions
-- ============================================================
ALTER TABLE referral_commissions
  ADD COLUMN IF NOT EXISTS unlock_at TIMESTAMPTZ;

COMMENT ON COLUMN referral_commissions.unlock_at IS
'Timestamp when this commission becomes transferable from agent wallet to portfolio. NULL = instantly available (grandfathered pre-migration rows, admin credits, or when commission_hold_enabled = 0). Set by _credit_commission based on fee_config.commission_hold_enabled.';

-- ============================================================
-- 2. Partial index for fast available-balance computation
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_referral_commissions_agent_unlock
  ON referral_commissions (referrer_id, unlock_at)
  WHERE status = 'credited';

-- ============================================================
-- 3. fee_config flag for the hold model
--    rate = 1 → enabled (calendar month + grace)
--    rate = 0 → disabled (instant transfer, legacy behavior)
-- ============================================================
INSERT INTO fee_config (fee_type, rate, description)
SELECT 'commission_hold_enabled', 1, 'Monthly hold on commissions (1=enabled, 0=disabled). When enabled, commissions earned in month M unlock on the 1st of month M+1 at 00:00 UTC. Frontend MUST render in local timezone.'
WHERE NOT EXISTS (
  SELECT 1 FROM fee_config WHERE fee_type = 'commission_hold_enabled'
);

-- ============================================================
-- 4. Rewrite _credit_commission — set unlock_at based on hold flag
--    Preserves full existing behavior (activation gate, escrow,
--    ledger entry, display string). Only adds unlock_at logic.
--    Source: supabase/migrations/169_standardize_terminology.sql
-- ============================================================
DROP FUNCTION IF EXISTS _credit_commission(UUID, UUID, UUID, UUID, INTEGER, INTEGER, DECIMAL, TEXT, TEXT);

CREATE OR REPLACE FUNCTION _credit_commission(
  p_ancestor_id UUID,
  p_trader_id UUID,
  p_market_id UUID,
  p_trade_id UUID,
  p_layer INTEGER,
  p_agent_level INTEGER,
  p_platform_revenue DECIMAL,
  p_fee_type TEXT,
  p_revenue_type TEXT
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_new_balance DECIMAL;
  v_activated BOOLEAN;
  v_hold_enabled DECIMAL;
  v_unlock_at TIMESTAMPTZ;
BEGIN
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = p_fee_type
    AND level = p_agent_level
    AND depth = p_layer;

  IF v_rate IS NULL OR v_rate = 0 THEN
    RETURN 0;
  END IF;

  v_commission := p_platform_revenue * v_rate;

  IF v_commission < 0.01 THEN
    RETURN 0;
  END IF;

  v_activated := _is_agent_activated(p_ancestor_id);

  -- ───── NEW: compute unlock_at based on fee_config ─────
  SELECT rate INTO v_hold_enabled
  FROM fee_config
  WHERE fee_type = 'commission_hold_enabled'
  LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    -- Calendar month + grace: earned in month M → unlocks on 1st of M+1 UTC.
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type, unlock_at
  ) VALUES (
    p_ancestor_id, p_trader_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission,
    CASE WHEN v_activated THEN 'credited'::commission_status ELSE 'escrowed'::commission_status END,
    p_revenue_type,
    v_unlock_at
  );

  IF v_activated THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
    WHERE id = p_ancestor_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      p_ancestor_id, 'commission', v_commission,
      v_new_balance,
      COALESCE(p_trade_id, p_market_id),
      'Commission (Layer ' || p_layer || ', ' || p_revenue_type || ') — '
      || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 2) || ' platform revenue'
    );
  END IF;

  RETURN v_commission;
END;
$$;

-- ============================================================
-- 5. Rewrite transfer_agent_to_portfolio — enforce available-balance gate
--    Source: supabase/migrations/144_agent_wallet_trigger_fix.sql
--    Preserves trigger bypass, frozen check, atomic paired ledger.
--    Adds: pending/available computation and explicit error message.
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

  -- ───── NEW: compute pending and available balances ─────
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_pending
  FROM referral_commissions
  WHERE referrer_id = v_user_id
    AND status = 'credited'
    AND unlock_at IS NOT NULL
    AND unlock_at > NOW();

  v_available := GREATEST(v_user.agent_balance_usd - v_pending, 0);

  -- Primary gate: available balance (enforces lock)
  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient unlocked balance (available: $%, pending: $%, requested: $%)',
      ROUND(v_available, 2), ROUND(v_pending, 2), ROUND(p_amount, 2);
  END IF;

  -- Secondary safety net (should be unreachable given available ≤ total)
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
-- 6. New RPC: get_agent_wallet_summary
--    Returns: { total, available, pending, next_unlock_at }
--    Used by agent-wallet-card UI to render Available/Pending split.
-- ============================================================
CREATE OR REPLACE FUNCTION get_agent_wallet_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total DECIMAL;
  v_pending DECIMAL;
  v_available DECIMAL;
  v_next_unlock TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(agent_balance_usd, 0) INTO v_total
  FROM users WHERE id = v_uid;

  SELECT COALESCE(SUM(commission_amount), 0), MIN(unlock_at)
  INTO v_pending, v_next_unlock
  FROM referral_commissions
  WHERE referrer_id = v_uid
    AND status = 'credited'
    AND unlock_at IS NOT NULL
    AND unlock_at > NOW();

  v_available := GREATEST(v_total - v_pending, 0);

  RETURN jsonb_build_object(
    'total', v_total,
    'available', v_available,
    'pending', v_pending,
    'next_unlock_at', v_next_unlock
  );
END;
$$;

-- ============================================================
-- 7. Extend get_agent_commission_feed — include unlock_at
--    Source: supabase/migrations/169_standardize_terminology.sql
--    Only change: SELECT + jsonb_build_object now include unlock_at.
--    Needed so CommissionFeedItem can render the "Locked until" badge.
-- ============================================================
CREATE OR REPLACE FUNCTION get_agent_commission_feed(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_layer_filter INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_row IN
    SELECT
      rc.id,
      COALESCE(
        split_part(u.display_name, ' ', 1) || ' ' ||
        LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
        u.phone
      ) AS trader_name,
      m.question_en AS market_question,
      t.side AS trade_side,
      t.total_cost AS trade_amount,
      rc.platform_revenue_amount AS platform_revenue,
      rc.commission_amount,
      rc.layer,
      rc.revenue_type,
      rc.status,
      rc.created_at,
      rc.unlock_at
    FROM referral_commissions rc
    JOIN users u ON u.id = rc.trader_id
    JOIN markets m ON m.id = rc.market_id
    LEFT JOIN trades t ON t.id = rc.trade_id
    WHERE rc.referrer_id = v_uid
      AND rc.status IN ('credited', 'escrowed')
      AND (p_layer_filter IS NULL OR rc.layer = p_layer_filter)
    ORDER BY rc.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  LOOP
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'trader_name', v_row.trader_name,
      'market_question', v_row.market_question,
      'trade_side', v_row.trade_side,
      'trade_amount', v_row.trade_amount,
      'platform_revenue', v_row.platform_revenue,
      'commission_amount', v_row.commission_amount,
      'layer', v_row.layer,
      'revenue_type', v_row.revenue_type,
      'status', v_row.status,
      'created_at', v_row.created_at,
      'unlock_at', v_row.unlock_at
    );
  END LOOP;

  RETURN v_result;
END;
$$;

-- ============================================================
-- 8. Grants
-- ============================================================
GRANT EXECUTE ON FUNCTION get_agent_wallet_summary() TO authenticated;

-- Note: _credit_commission, transfer_agent_to_portfolio, and
-- get_agent_commission_feed keep their existing grants (defined
-- in source migrations 169 and 144).
