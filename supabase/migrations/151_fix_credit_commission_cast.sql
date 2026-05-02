-- 151_fix_credit_commission_cast.sql — Fix enum cast in _credit_commission
-- The CASE expression needs explicit ::commission_status cast

CREATE OR REPLACE FUNCTION _credit_commission(
  p_ancestor_id UUID,
  p_bettor_id UUID,
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

  INSERT INTO referral_commissions (
    referrer_id, bettor_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type
  ) VALUES (
    p_ancestor_id, p_bettor_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission,
    CASE WHEN v_activated THEN 'credited'::commission_status ELSE 'escrowed'::commission_status END,
    p_revenue_type
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
