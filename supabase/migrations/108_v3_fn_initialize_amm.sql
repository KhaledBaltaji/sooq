-- 108_v3_fn_initialize_amm.sql — Initialize AMM state for a market
-- Called when admin creates a market. Inserts amm_state row.

CREATE OR REPLACE FUNCTION initialize_amm(
  p_market_id UUID,
  p_liquidity_param DECIMAL DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_b DECIMAL;
  v_market RECORD;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- Admin/service-role check
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Admin access required';
    END IF;
  END IF;

  -- Read default b from fee_config if not provided
  IF p_liquidity_param IS NULL THEN
    SELECT rate INTO v_b FROM fee_config WHERE fee_type = 'amm_default_b' LIMIT 1;
    IF v_b IS NULL THEN
      v_b := 1000;  -- fallback default
    END IF;
  ELSE
    v_b := p_liquidity_param;
  END IF;

  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- Validate market exists
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  -- Check no AMM already exists
  IF EXISTS (SELECT 1 FROM amm_state WHERE market_id = p_market_id) THEN
    RAISE EXCEPTION 'AMM already initialized for this market';
  END IF;

  -- Calculate initial prices (both 0.50 at q_yes=0, q_no=0)
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price := lmsr_price(v_b, 0, 0, 'no');

  -- Insert AMM state
  INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price)
  VALUES (p_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- Store on markets table for quick access
  UPDATE markets SET amm_liquidity_param = v_b WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;
