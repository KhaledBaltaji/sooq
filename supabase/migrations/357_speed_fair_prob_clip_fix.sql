-- ============================================================================
-- 357_speed_fair_prob_clip_fix.sql
--
-- Cashout invariant fix discovered by speed-cashout-invariant.test.ts:
--   At extreme moneyness (e.g., spot $500 above strike on 5m, 4 sigma move),
--   fair_prob_over clips to 0.999 (Seam 2 widened range from mig 352) but
--   offered_prob caps at 0.99. This violates the math invariant offered > fair,
--   so fair_value > stake at cashout time → immediate round-trip returns
--   stake + small profit (~$0.15 on $25). Real arbitrage on top of the
--   intended house edge.
--
-- Fix: revert speed_fair_prob_over clip from [0.001, 0.999] back to [0.01, 0.99]
--   (matches mig 318 original behavior). The Seam 3 quadratic spread widening
--   still does the user-visible work at the edge — Seam 2's clip widening was
--   a small UX win that introduced a real economic bug.
--
-- Caught by src/tests/db/speed-cashout-invariant.test.ts (eng-review 8A).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.speed_fair_prob_over(
  p_spot DECIMAL,
  p_strike DECIMAL,
  p_seconds_left DOUBLE PRECISION,
  p_iv DECIMAL
) RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_seconds_left DOUBLE PRECISION;
  v_years_left   DOUBLE PRECISION;
  v_sigma_sqrt_t DOUBLE PRECISION;
  v_d2           DOUBLE PRECISION;
  v_iv_dbl       DOUBLE PRECISION;
  v_fair         DOUBLE PRECISION;
BEGIN
  v_seconds_left := GREATEST(p_seconds_left, 1.0);
  v_years_left := v_seconds_left / (365.0 * 24.0 * 3600.0);
  v_iv_dbl := p_iv::DOUBLE PRECISION;
  v_sigma_sqrt_t := v_iv_dbl * SQRT(v_years_left);

  IF v_sigma_sqrt_t = 0 THEN
    RETURN CASE WHEN p_spot > p_strike THEN 0.99 ELSE 0.01 END;
  END IF;

  v_d2 := (LN(p_spot::DOUBLE PRECISION / p_strike::DOUBLE PRECISION)
           - (v_iv_dbl * v_iv_dbl * v_years_left) / 2.0) / v_sigma_sqrt_t;
  v_fair := normal_cdf(v_d2);

  -- Mig 357: tightened clip from Seam 2's [0.001, 0.999] to [0.01, 0.99]
  -- to ensure fair < offered (cap 0.99) at extremes.
  RETURN GREATEST(0.01, LEAST(0.99, v_fair))::DECIMAL;
END;
$$;

COMMENT ON FUNCTION public.speed_fair_prob_over(DECIMAL, DECIMAL, DOUBLE PRECISION, DECIMAL) IS
'Mig 318 + Mig 357: Black-Scholes binary fair probability clipped to [0.01, 0.99] (mig 357 reverts mig 352 Seam 2 widening because fair > offered_cap created round-trip arbitrage at extreme moneyness — caught by speed-cashout-invariant.test.ts).';
