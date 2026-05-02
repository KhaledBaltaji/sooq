-- 021a_fn_calculate_payouts.sql — Calculate payout amounts for market resolution
-- Called by resolve_market. Returns TABLE of (user_id, payout_amount).

CREATE OR REPLACE FUNCTION calculate_payouts(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS TABLE(user_id UUID, payout_amount DECIMAL)
LANGUAGE plpgsql
AS $$
DECLARE
  v_market RECORD;
  v_total_pool DECIMAL;
  v_seed_total DECIMAL;
  v_platform_fee_rate DECIMAL;
  v_available_pot DECIMAL;
  v_sum_locked_payouts DECIMAL;
  v_scaling_factor DECIMAL;
BEGIN
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  v_total_pool := v_market.pool_yes + v_market.pool_no;
  v_seed_total := v_market.seed_amount_yes + v_market.seed_amount_no;

  -- Read platform fee from fee_config (NEVER hardcoded)
  SELECT rate INTO v_platform_fee_rate
  FROM fee_config WHERE fee_type = 'platform_fee' LIMIT 1;

  -- available_pot = (total - seeds) × (1 - fee)
  v_available_pot := (v_total_pool - v_seed_total) * (1 - v_platform_fee_rate);
  -- Add back the winning side's seed (seeds don't get fee'd, they return to platform)

  -- Sum of all locked payouts for winners
  SELECT COALESCE(SUM(b.potential_payout), 0) INTO v_sum_locked_payouts
  FROM bets b WHERE b.market_id = p_market_id AND b.side = p_outcome;

  -- Scaling factor: if locked payouts exceed available pot, scale down
  IF v_sum_locked_payouts > 0 AND v_sum_locked_payouts > v_available_pot THEN
    v_scaling_factor := v_available_pot / v_sum_locked_payouts;
  ELSE
    v_scaling_factor := 1.0;
  END IF;

  -- Ensure scaling never exceeds 1.0
  v_scaling_factor := LEAST(v_scaling_factor, 1.0);

  RETURN QUERY
  SELECT
    b.user_id,
    ROUND(b.potential_payout * v_scaling_factor, 6) AS payout_amount
  FROM bets b
  WHERE b.market_id = p_market_id
    AND b.side = p_outcome;
END;
$$;
