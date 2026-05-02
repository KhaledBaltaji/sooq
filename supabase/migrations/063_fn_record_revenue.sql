-- 021d_fn_record_revenue.sql — Record platform revenue for a market

CREATE OR REPLACE FUNCTION record_revenue(
  p_market_id UUID,
  p_total_commissions DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_market RECORD;
  v_total_pot DECIMAL;
  v_seed_total DECIMAL;
  v_platform_fee_rate DECIMAL;
  v_platform_fee DECIMAL;
  v_net_revenue DECIMAL;
BEGIN
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  v_total_pot := v_market.pool_yes + v_market.pool_no;
  v_seed_total := v_market.seed_amount_yes + v_market.seed_amount_no;

  SELECT rate INTO v_platform_fee_rate
  FROM fee_config WHERE fee_type = 'platform_fee' LIMIT 1;

  v_platform_fee := (v_total_pot - v_seed_total) * v_platform_fee_rate;
  v_net_revenue := v_platform_fee - p_total_commissions;

  INSERT INTO platform_revenue (market_id, total_pot, seed_amount, platform_fee, total_commissions, net_revenue)
  VALUES (p_market_id, v_total_pot, v_seed_total, v_platform_fee, p_total_commissions, v_net_revenue);
END;
$$;
