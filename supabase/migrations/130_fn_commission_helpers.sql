-- 123_fn_commission_helpers.sql — NGR commission helpers
-- _credit_commission: DRY helper for crediting a single commission (used by trade + resolution paths)
-- pay_trade_commissions: Per-trade commission + volume tracking (single-pass loop)

-- ============================================================
-- _credit_commission: Credit one commission to one ancestor
-- ============================================================
-- Returns the commission amount credited (0 if skipped).
-- Caller is responsible for locking the ancestor row beforehand.

CREATE OR REPLACE FUNCTION _credit_commission(
  p_ancestor_id UUID,
  p_bettor_id UUID,
  p_market_id UUID,
  p_trade_id UUID,        -- NULL for resolution commissions
  p_layer INTEGER,
  p_agent_level INTEGER,
  p_platform_revenue DECIMAL,
  p_fee_type TEXT,         -- 'ngr_commission' or 'ngr_resolution_commission'
  p_revenue_type TEXT      -- 'trade' or 'resolution'
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  -- Look up rate from fee_config
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = p_fee_type
    AND level = p_agent_level
    AND depth = p_layer;

  -- Skip if no rate configured or rate is zero
  IF v_rate IS NULL OR v_rate = 0 THEN
    RETURN 0;
  END IF;

  -- Calculate commission
  v_commission := p_platform_revenue * v_rate;

  -- Dust threshold: skip sub-penny commissions
  IF v_commission < 0.01 THEN
    RETURN 0;
  END IF;

  -- Insert commission record
  INSERT INTO referral_commissions (
    referrer_id, bettor_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type
  ) VALUES (
    p_ancestor_id, p_bettor_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission, 'credited', p_revenue_type
  );

  -- Credit ancestor balance
  UPDATE users SET balance_usd = balance_usd + v_commission
  WHERE id = p_ancestor_id
  RETURNING balance_usd INTO v_new_balance;

  -- Ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_ancestor_id, 'commission', v_commission,
    v_new_balance,
    COALESCE(p_trade_id, p_market_id),
    'Commission (Layer ' || p_layer || ', ' || p_revenue_type || ') — '
    || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 2) || ' platform revenue'
  );

  RETURN v_commission;
END;
$$;


-- ============================================================
-- pay_trade_commissions: Real-time commission on each trade
-- ============================================================
-- Called from execute_trade() after trade INSERT.
-- Single-pass loop: updates network_volume, checks tier advancement, credits commission.
-- Ancestors must already be locked (deterministic ordering in execute_trade).

CREATE OR REPLACE FUNCTION pay_trade_commissions(
  p_trade_id UUID,
  p_user_id UUID,
  p_trade_amount DECIMAL  -- total trade amount (for volume tracking)
)
RETURNS DECIMAL  -- total commissions paid
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

  -- 3. Read trader's referral chain
  SELECT referral_chain INTO v_chain
  FROM users WHERE id = p_user_id;

  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL OR array_length(v_chain, 1) = 0 THEN
    RETURN 0;  -- No referrers, nothing to pay
  END IF;

  -- 4. Single-pass loop: volume + tier + commission for each ancestor
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 3) LOOP
    v_ancestor_id := v_chain[v_layer];

    IF v_ancestor_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Ancestor already locked by execute_trade (deterministic UUID ordering)
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
      -- Use the new level for commission calculation
      v_ancestor.agent_level := v_new_level;
    END IF;

    -- c. Credit commission via shared helper
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
