-- 109_v3_fn_get_amm_price.sql — Read-only AMM price functions
-- No state mutation. Used for UI display and sell previews.

-- ============================================================
-- get_amm_price: Returns current prices + stats for a market
-- ============================================================

CREATE OR REPLACE FUNCTION get_amm_price(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_amm RECORD;
BEGIN
  SELECT current_yes_price, current_no_price, total_volume, total_trades
  INTO v_amm
  FROM amm_state WHERE market_id = p_market_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMM not found for market %', p_market_id;
  END IF;

  RETURN jsonb_build_object(
    'yes_price', v_amm.current_yes_price,
    'no_price', v_amm.current_no_price,
    'volume', v_amm.total_volume,
    'trades', v_amm.total_trades
  );
END;
$$;


-- ============================================================
-- get_cash_out_value: Preview sell proceeds (no state mutation)
-- Returns gross proceeds, fees, and net proceeds for selling shares
-- ============================================================

CREATE OR REPLACE FUNCTION get_cash_out_value(
  p_market_id UUID,
  p_side TEXT,
  p_shares DECIMAL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  v_amm RECORD;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_gross_proceeds DECIMAL;
  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_explicit_fee DECIMAL;
  v_cash_out_premium DECIMAL;
  v_net_proceeds DECIMAL;
  v_price_per_share DECIMAL;
BEGIN
  IF p_shares <= 0 THEN
    RAISE EXCEPTION 'Shares must be positive';
  END IF;

  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Side must be yes or no';
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMM not found for market %', p_market_id;
  END IF;

  -- Validate shares don't exceed current q
  IF p_side = 'yes' AND p_shares > v_amm.q_yes THEN
    RAISE EXCEPTION 'Cannot sell more shares than exist in the AMM';
  END IF;
  IF p_side = 'no' AND p_shares > v_amm.q_no THEN
    RAISE EXCEPTION 'Cannot sell more shares than exist in the AMM';
  END IF;

  -- Calculate LMSR sell proceeds: cost(old_q) - cost(new_q)
  v_old_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes, v_amm.q_no);

  IF p_side = 'yes' THEN
    v_new_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes - p_shares, v_amm.q_no);
  ELSE
    v_new_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes, v_amm.q_no - p_shares);
  END IF;

  v_gross_proceeds := v_old_cost - v_new_cost;

  -- Read fee rates from fee_config
  SELECT rate INTO v_explicit_fee_rate FROM fee_config WHERE fee_type = 'explicit_fee' LIMIT 1;
  SELECT rate INTO v_cash_out_rate FROM fee_config WHERE fee_type = 'cash_out_premium' LIMIT 1;

  v_explicit_fee := v_gross_proceeds * COALESCE(v_explicit_fee_rate, 0.005);
  v_cash_out_premium := v_gross_proceeds * COALESCE(v_cash_out_rate, 0.005);
  v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;
  v_price_per_share := v_gross_proceeds / p_shares;

  RETURN jsonb_build_object(
    'gross_proceeds', ROUND(v_gross_proceeds, 6),
    'explicit_fee', ROUND(v_explicit_fee, 6),
    'cash_out_premium', ROUND(v_cash_out_premium, 6),
    'net_proceeds', ROUND(v_net_proceeds, 6),
    'price_per_share', ROUND(v_price_per_share, 6)
  );
END;
$$;
