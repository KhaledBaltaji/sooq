-- 112_v3_fn_record_revenue.sql — V3 5-layer revenue tracking
-- Tracks explicit fees, AMM spread, resolution fee, dynamic spread, cash-out premium.

CREATE OR REPLACE FUNCTION record_revenue(
  p_market_id UUID,
  p_total_commissions DECIMAL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_explicit DECIMAL;
  v_total_amm_spread DECIMAL;
  v_total_cash_out DECIMAL;
  v_resolution_fee DECIMAL;
  v_dynamic_spread DECIMAL := 0;
  v_total_fees DECIMAL;
  v_net_revenue DECIMAL;
  v_total_volume DECIMAL;
  v_resolution_fee_rate DECIMAL;
  v_market RECORD;
BEGIN
  -- Sum fee columns from all trades on this market
  SELECT
    COALESCE(SUM(explicit_fee), 0),
    COALESCE(SUM(amm_spread_cost), 0),
    COALESCE(SUM(cash_out_premium), 0)
  INTO v_total_explicit, v_total_amm_spread, v_total_cash_out
  FROM trades WHERE market_id = p_market_id;

  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Resolution fee: from winning positions (shares_held * resolution_fee_rate)
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  IF v_market.outcome IS NOT NULL THEN
    SELECT COALESCE(SUM(shares_held * v_resolution_fee_rate), 0) INTO v_resolution_fee
    FROM positions
    WHERE market_id = p_market_id
      AND side = v_market.outcome
      AND shares_held > 0;
  ELSE
    v_resolution_fee := 0;
  END IF;

  -- Get total volume from AMM state
  SELECT COALESCE(total_volume, 0) INTO v_total_volume
  FROM amm_state WHERE market_id = p_market_id;

  -- Calculate totals
  v_total_fees := v_total_explicit + v_total_amm_spread + v_resolution_fee
                  + v_dynamic_spread + v_total_cash_out;
  v_net_revenue := v_total_fees - p_total_commissions;

  -- Insert revenue record with 5-layer breakdown
  INSERT INTO platform_revenue (
    market_id, total_pot, seed_amount, platform_fee,
    total_commissions, net_revenue,
    explicit_fee_revenue, amm_spread_revenue, resolution_fee_revenue,
    dynamic_spread_revenue, cash_out_premium_revenue
  ) VALUES (
    p_market_id,
    v_total_volume,
    0,  -- no seed amount in AMM model (AMM provides virtual liquidity)
    v_total_fees,
    p_total_commissions,
    v_net_revenue,
    v_total_explicit,
    v_total_amm_spread,
    v_resolution_fee,
    v_dynamic_spread,
    v_total_cash_out
  );
END;
$$;
