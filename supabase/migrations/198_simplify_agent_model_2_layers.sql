-- 198_simplify_agent_model_2_layers.sql
-- Simplify agent commission model: 3 layers → 2 layers with boosted direct rates.
-- Also fixes void clawback balance_after bug (was using balance_usd instead of agent_balance_usd).
--
-- New rate table:
--   L1: Direct 30%, Indirect 5%  (was 20%/5%/2%)
--   L2: Direct 35%, Indirect 8%  (was 25%/8%/3%)
--   L3: Direct 40%, Indirect 10% (was 35%/10%/5%)
--   L4: Direct 50%, Indirect 12% (was 45%/15%/7%)

BEGIN;

-- ============================================================
-- 1. Update fee_config: remove depth=3, update rates
-- ============================================================

-- Remove Layer 3 (deep) commission rows
DELETE FROM fee_config WHERE fee_type = 'ngr_commission' AND depth = 3;
DELETE FROM fee_config WHERE fee_type = 'ngr_resolution_commission' AND depth = 3;

-- Update Layer 1 (direct) rates — boosted
UPDATE fee_config SET rate = 0.300000, description = 'Tier 1, Layer 1 (Direct): 30% of platform revenue'
  WHERE fee_type = 'ngr_commission' AND level = 1 AND depth = 1;
UPDATE fee_config SET rate = 0.350000, description = 'Tier 2, Layer 1 (Direct): 35% of platform revenue'
  WHERE fee_type = 'ngr_commission' AND level = 2 AND depth = 1;
UPDATE fee_config SET rate = 0.400000, description = 'Tier 3, Layer 1 (Direct): 40% of platform revenue'
  WHERE fee_type = 'ngr_commission' AND level = 3 AND depth = 1;
UPDATE fee_config SET rate = 0.500000, description = 'Tier 4, Layer 1 (Direct): 50% of platform revenue'
  WHERE fee_type = 'ngr_commission' AND level = 4 AND depth = 1;

-- Layer 2 (indirect) — L4 reduced from 15% to 12%, others unchanged
UPDATE fee_config SET rate = 0.120000, description = 'Tier 4, Layer 2 (Indirect): 12% of platform revenue'
  WHERE fee_type = 'ngr_commission' AND level = 4 AND depth = 2;

-- Same for resolution commission rates
UPDATE fee_config SET rate = 0.300000, description = 'Tier 1, Layer 1: 30% of resolution fee revenue'
  WHERE fee_type = 'ngr_resolution_commission' AND level = 1 AND depth = 1;
UPDATE fee_config SET rate = 0.350000, description = 'Tier 2, Layer 1: 35% of resolution fee revenue'
  WHERE fee_type = 'ngr_resolution_commission' AND level = 2 AND depth = 1;
UPDATE fee_config SET rate = 0.400000, description = 'Tier 3, Layer 1: 40% of resolution fee revenue'
  WHERE fee_type = 'ngr_resolution_commission' AND level = 3 AND depth = 1;
UPDATE fee_config SET rate = 0.500000, description = 'Tier 4, Layer 1: 50% of resolution fee revenue'
  WHERE fee_type = 'ngr_resolution_commission' AND level = 4 AND depth = 1;

UPDATE fee_config SET rate = 0.120000, description = 'Tier 4, Layer 2: 12% of resolution fee revenue'
  WHERE fee_type = 'ngr_resolution_commission' AND level = 4 AND depth = 2;

-- Validate: exactly 8 trade + 8 resolution commission rows
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_commission';
  IF v_count != 8 THEN
    RAISE EXCEPTION 'Expected 8 ngr_commission rows, found %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_resolution_commission';
  IF v_count != 8 THEN
    RAISE EXCEPTION 'Expected 8 ngr_resolution_commission rows, found %', v_count;
  END IF;

  -- No depth=3 rows should remain
  SELECT COUNT(*) INTO v_count FROM fee_config
    WHERE fee_type IN ('ngr_commission', 'ngr_resolution_commission') AND depth = 3;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'Found % depth=3 rows that should have been deleted', v_count;
  END IF;
END $$;


-- ============================================================
-- 2. Update pay_trade_commissions: max 2 layers (was 3)
-- ============================================================

CREATE OR REPLACE FUNCTION pay_trade_commissions(
  p_trade_id UUID,
  p_user_id UUID,
  p_trade_amount DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade RECORD;
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
  v_new_level INTEGER;
  -- First-trade activation variables
  v_is_first_trade BOOLEAN;
  v_referrer_id UUID;
  v_new_qual_count INTEGER;
  v_referrer_activated BOOLEAN;
  v_referrer_override BOOLEAN;
BEGIN
  -- 1. Read trade record for fee columns
  SELECT explicit_fee, amm_spread_cost, cash_out_premium, market_id
  INTO v_trade
  FROM trades WHERE id = p_trade_id;

  IF v_trade IS NULL THEN
    RETURN 0;
  END IF;

  -- 2. Calculate total platform revenue from this trade
  v_platform_revenue := v_trade.explicit_fee + v_trade.amm_spread_cost + v_trade.cash_out_premium;

  IF v_platform_revenue <= 0 THEN
    RETURN 0;
  END IF;

  -- 3. First-trade detection: increment referrer's qualified_referral_count
  v_is_first_trade := NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = p_user_id AND id != p_trade_id
    LIMIT 1
  );

  IF v_is_first_trade THEN
    -- Get direct referrer
    SELECT referred_by INTO v_referrer_id FROM users WHERE id = p_user_id;

    IF v_referrer_id IS NOT NULL THEN
      UPDATE users
      SET qualified_referral_count = qualified_referral_count + 1
      WHERE id = v_referrer_id
      RETURNING qualified_referral_count, agent_activated, agent_activation_override
      INTO v_new_qual_count, v_referrer_activated, v_referrer_override;

      -- Check if referrer just hit the threshold (organic activation)
      IF NOT v_referrer_activated AND v_new_qual_count >= 5 THEN
        UPDATE users SET agent_activated = TRUE WHERE id = v_referrer_id;
        PERFORM _release_escrowed_commissions(v_referrer_id);
      END IF;
    END IF;
  END IF;

  -- 4. Read trader's referral chain
  SELECT referral_chain INTO v_chain
  FROM users WHERE id = p_user_id;

  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL OR array_length(v_chain, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- 5. Single-pass loop: volume + tier + commission for each ancestor (max 2 layers)
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 2) LOOP
    v_ancestor_id := v_chain[v_layer];

    IF v_ancestor_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id;
    IF v_ancestor IS NULL THEN
      CONTINUE;
    END IF;

    -- a. Update network volume
    UPDATE users SET network_volume = network_volume + p_trade_amount
    WHERE id = v_ancestor_id;

    -- b. Inline tier advancement check (ratchet: only goes up)
    v_new_level := CASE
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 200000 THEN 4
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 50000  THEN 3
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 10000  THEN 2
      ELSE 1
    END;

    IF v_new_level > v_ancestor.agent_level THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    -- c. Credit commission via shared helper (handles escrow/credit)
    v_commission := _credit_commission(
      v_ancestor_id, p_user_id, v_trade.market_id, p_trade_id,
      v_layer, v_ancestor.agent_level, v_platform_revenue,
      'ngr_commission', 'trade'
    );

    v_total_commissions := v_total_commissions + v_commission;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;


-- ============================================================
-- 3. Update settle_resolution_commissions: max 2 layers (was 3)
-- ============================================================

CREATE OR REPLACE FUNCTION settle_resolution_commissions(
  p_market_id UUID
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_market RECORD;
  v_resolution_fee_rate DECIMAL;
  v_pos RECORD;
  v_chain UUID[];
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_resolution_revenue DECIMAL;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  -- Idempotency: skip if resolution commissions already exist for this market
  IF EXISTS (
    SELECT 1 FROM referral_commissions
    WHERE market_id = p_market_id AND revenue_type = 'resolution'
    LIMIT 1
  ) THEN
    RETURN 0;
  END IF;

  -- Read market outcome
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL OR v_market.outcome IS NULL THEN
    RETURN 0;
  END IF;

  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate
  FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- For each winner with a referral chain
  FOR v_pos IN
    SELECT p.user_id, p.shares_held, u.referral_chain
    FROM positions p
    JOIN users u ON u.id = p.user_id
    WHERE p.market_id = p_market_id
      AND p.side = v_market.outcome
      AND p.shares_held > 0
      AND u.referral_chain IS NOT NULL
      AND array_length(u.referral_chain, 1) > 0
    ORDER BY p.user_id  -- consistent lock order
  LOOP
    -- Resolution revenue = what the platform earned from this winner's resolution fee
    v_resolution_revenue := v_pos.shares_held * v_resolution_fee_rate;

    IF v_resolution_revenue <= 0 THEN
      CONTINUE;
    END IF;

    -- Walk referral chain (max 2 layers)
    FOR v_layer IN 1..LEAST(array_length(v_pos.referral_chain, 1), 2) LOOP
      v_ancestor_id := v_pos.referral_chain[v_layer];

      IF v_ancestor_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Lock and read ancestor
      SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
      IF v_ancestor IS NULL THEN
        CONTINUE;
      END IF;

      -- Credit resolution commission via shared helper
      v_commission := _credit_commission(
        v_ancestor_id, v_pos.user_id, p_market_id, NULL,
        v_layer, v_ancestor.agent_level, v_resolution_revenue,
        'ngr_resolution_commission', 'resolution'
      );

      v_total_commissions := v_total_commissions + v_commission;
    END LOOP;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;


-- ============================================================
-- 4. Fix _void_market_internal: RETURNING agent_balance_usd (was balance_usd)
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
  v_new_agent_balance DECIMAL;
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
    RETURNING agent_balance_usd INTO v_new_agent_balance;

    -- Negative ledger entry (now correctly records agent_balance_usd)
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_new_agent_balance,
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
-- 5. Update get_agent_stats: activation_threshold display
-- ============================================================
-- (No changes needed — already returns threshold=5, network size still counts 3 levels)


COMMIT;
