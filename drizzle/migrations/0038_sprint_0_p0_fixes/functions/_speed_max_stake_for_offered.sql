-- S0.1: Cap the liability formula at offered_prob >= 0.98.
--
-- BUG (pre-0038): formula `liability_cap × p / (1 - p)` returns 99×liability_cap
-- when p=0.99, completely bypassing stake_max. A shark entering a near-saturated
-- outcome could place 99× the intended max stake.
--
-- FIX: at p >= 0.98, by_liability := v_trade_max (already-capped baseline).
-- Below 0.98 the formula is well-behaved (cap_pool * 0.98/0.02 = 49×, but in
-- practice gated by v_trade_max via LEAST() and by per-ticket payout cap).

CREATE OR REPLACE FUNCTION public._speed_max_stake_for_offered(
  p_duration speed_duration,
  p_offered_prob double precision
)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_trade_max     DECIMAL;
  v_payout_cap    DECIMAL;
  v_liability_cap DECIMAL;
  v_pool          DECIMAL;
  v_max_side_pct  DECIMAL;
  v_by_payout     DECIMAL;
  v_by_liability  DECIMAL;
  v_result        DECIMAL;
BEGIN
  v_trade_max := _speed_get_stake_max(p_duration);

  IF p_duration::TEXT = '5m' THEN
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_5m' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 2500);
  ELSE
    SELECT rate INTO v_payout_cap FROM fee_config WHERE fee_type = 'speed_entry_max_payout_usd_1h' LIMIT 1;
    v_payout_cap := COALESCE(v_payout_cap, 5000);
  END IF;

  SELECT rate INTO v_pool FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd' LIMIT 1;
  SELECT rate INTO v_max_side_pct FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_pool := COALESCE(v_pool, 10000);
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);
  v_liability_cap := v_pool * v_max_side_pct;

  -- max_stake_by_payout: stake / p <= payout_cap → stake <= payout_cap × p
  v_by_payout := v_payout_cap * p_offered_prob;

  -- max_stake_by_liability: liability_per_ticket = stake × (1-p)/p; constrain to <= liability_cap
  -- → stake <= liability_cap × p / (1-p)
  --
  -- S0.1 fix: at offered_prob >= 0.98 the (1-p) divisor explodes the formula
  -- (e.g. p=0.99 → 99×liability_cap → completely defeats stake_max). Clamp
  -- the by_liability bound to v_trade_max in that regime; LEAST() below
  -- still applies all caps. Below 0.98 the formula remains as-is.
  IF p_offered_prob >= 0.98 THEN
    v_by_liability := v_trade_max;
  ELSE
    v_by_liability := v_liability_cap * p_offered_prob / (1.0 - p_offered_prob);
  END IF;

  v_result := LEAST(v_trade_max, v_by_payout, v_by_liability);
  IF v_result < 1 THEN v_result := 1; END IF;
  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public._speed_max_stake_for_offered(speed_duration, double precision) IS
  '0038 (S0.1): liability cap clamp at offered_prob >= 0.98 to prevent 99x stake_max bypass at near-saturated outcomes. Original formula intact below 0.98.';

GRANT EXECUTE ON FUNCTION public._speed_max_stake_for_offered(speed_duration, double precision) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_max_stake_for_offered(speed_duration, double precision) TO sooqadmin;
