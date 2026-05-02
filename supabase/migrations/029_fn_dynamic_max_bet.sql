-- 029_fn_dynamic_max_bet.sql — Calculate dynamic max bet for a market side

CREATE OR REPLACE FUNCTION dynamic_max_bet(
  p_market_id UUID,
  p_side bet_side
)
RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_market RECORD;
  v_side_pool DECIMAL;
  v_pool_pct DECIMAL := 0.20;
  v_floor DECIMAL := 100;
BEGIN
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  IF p_side = 'yes' THEN
    v_side_pool := v_market.pool_yes;
  ELSE
    v_side_pool := v_market.pool_no;
  END IF;

  RETURN GREATEST(v_side_pool * v_pool_pct, v_floor);
END;
$$;
