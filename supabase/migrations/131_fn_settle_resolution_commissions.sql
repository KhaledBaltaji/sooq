-- 124_fn_settle_resolution_commissions.sql — Resolution-only commission settlement
-- Replaces settle_commissions(). Only pays commission on the 1% resolution fee.
-- Trade-time commissions are already paid per-trade by pay_trade_commissions().

CREATE OR REPLACE FUNCTION settle_resolution_commissions(
  p_market_id UUID
)
RETURNS DECIMAL  -- total resolution commissions paid
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

    -- Walk referral chain
    FOR v_layer IN 1..LEAST(array_length(v_pos.referral_chain, 1), 3) LOOP
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
