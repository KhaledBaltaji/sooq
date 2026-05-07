-- ============================================================================
-- _speed_jeffreys_ci_width — Jeffreys binomial credible interval width
-- ============================================================================
--
-- Mig 0037: PL/pgSQL port of the JS jeffreysCI() in
-- scripts/recalibrate-pricing-matrix.mjs.
--
-- Returns the WIDTH (high - low) of an approximate 95% Jeffreys credible
-- interval for a binomial proportion. Used to decide whether a matrix cell
-- has enough certainty to qualify (width <= speed_pricing_matrix_ci_max_width).
--
-- The exact Jeffreys interval uses Beta(wins+0.5, losses+0.5) quantiles. We
-- use a normal approximation: mean ± 1.96 * sqrt(var) where var = a*b/((a+b)^2 * (a+b+1)).
-- Same approximation as the JS version, so shadow-vs-active diff comparisons
-- are apples-to-apples.

CREATE OR REPLACE FUNCTION public._speed_jeffreys_ci_width(
  p_wins integer,
  p_n    integer
) RETURNS double precision
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_k     double precision;
  v_m     double precision;
  v_total double precision;
  v_mean  double precision;
  v_var   double precision;
  v_sd    double precision;
  v_lo    double precision;
  v_hi    double precision;
  v_z     double precision := 1.96;  -- 95% CI
BEGIN
  IF p_n IS NULL OR p_n <= 0 OR p_wins IS NULL OR p_wins < 0 THEN
    RETURN 1.0;  -- maximally wide; signals "no information"
  END IF;
  IF p_wins > p_n THEN
    RETURN 1.0;  -- defensive
  END IF;

  v_k := p_wins::double precision + 0.5;
  v_m := (p_n - p_wins)::double precision + 0.5;
  v_total := v_k + v_m;
  v_mean := v_k / v_total;
  v_var  := (v_k * v_m) / (v_total * v_total * (v_total + 1.0));
  v_sd   := sqrt(v_var);
  v_lo   := GREATEST(0.0, v_mean - v_z * v_sd);
  v_hi   := LEAST(1.0, v_mean + v_z * v_sd);
  RETURN v_hi - v_lo;
END;
$$;

COMMENT ON FUNCTION public._speed_jeffreys_ci_width(integer, integer) IS
  '0037: width of approximate 95% Jeffreys credible interval for a binomial proportion (wins out of n). Used by _speed_recalibrate_matrix to decide cell qualification. Wider intervals shrink hard toward BSM. Mirrors the JS jeffreysCI() in scripts/recalibrate-pricing-matrix.mjs for shadow-vs-active diff parity.';

GRANT EXECUTE ON FUNCTION public._speed_jeffreys_ci_width(integer, integer) TO PUBLIC;
