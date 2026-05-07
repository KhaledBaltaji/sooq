-- ============================================================================
-- _speed_isotonic_pav — Pool-Adjacent-Violators isotonic regression
-- ============================================================================
--
-- Mig 0037: PL/pgSQL port of the JS isotonicRegression() in
-- scripts/recalibrate-pricing-matrix.mjs.
--
-- Forces a sequence of values to be monotone non-decreasing using the
-- Pool-Adjacent-Violators (PAV) algorithm. Weighted L2-best monotone fit.
-- Walk left-to-right; whenever the current block's mean exceeds the next
-- block's mean (a "violation"), pool the two blocks (weighted average
-- becomes the new mean) and back up one step to re-check the pooled
-- block against its left neighbor. O(n) amortized.
--
-- Used per-time-bucket on the matrix to enforce: p_over[d_idx+1] >= p_over[d_idx].
--
-- Inputs:
--   p_values  — numeric values (one per cell, in d_bucket order)
--   p_weights — n_eff per cell (used for weighted averaging)
-- Output:
--   double precision[] of the same length as p_values, monotone non-decreasing.
--
-- Returns NULL on bad inputs (mismatched lengths, NULLs in arrays).
-- IMMUTABLE — pure function, no side effects.

CREATE OR REPLACE FUNCTION public._speed_isotonic_pav(
  p_values  double precision[],
  p_weights double precision[]
) RETURNS double precision[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_n               INTEGER;
  v_means           double precision[];
  v_wsums           double precision[];
  v_starts          INTEGER[];
  v_ends            INTEGER[];
  v_n_blocks        INTEGER;
  v_i               INTEGER;
  v_pooled_mean     double precision;
  v_pooled_wsum     double precision;
  v_result          double precision[];
  v_j               INTEGER;
  v_w               double precision;
BEGIN
  IF p_values IS NULL OR p_weights IS NULL THEN
    RETURN NULL;
  END IF;
  v_n := array_length(p_values, 1);
  IF v_n IS NULL OR v_n <> array_length(p_weights, 1) THEN
    RETURN NULL;
  END IF;
  IF v_n = 0 THEN
    RETURN ARRAY[]::double precision[];
  END IF;

  -- Initialize one block per element. Skip nulls — those become unfilled
  -- gaps in the output (caller decides how to handle missing cells).
  v_means  := ARRAY[]::double precision[];
  v_wsums  := ARRAY[]::double precision[];
  v_starts := ARRAY[]::integer[];
  v_ends   := ARRAY[]::integer[];

  FOR i IN 1..v_n LOOP
    IF p_values[i] IS NOT NULL THEN
      v_w := COALESCE(p_weights[i], 1.0);
      IF v_w <= 0 THEN v_w := 1.0; END IF;  -- defensive: zero/negative weight breaks PAV math
      v_means  := array_append(v_means,  p_values[i]);
      v_wsums  := array_append(v_wsums,  v_w);
      v_starts := array_append(v_starts, i);
      v_ends   := array_append(v_ends,   i);
    END IF;
  END LOOP;
  v_n_blocks := COALESCE(array_length(v_means, 1), 0);

  -- PAV: walk left to right, pool when current block mean > next block mean.
  v_i := 1;
  WHILE v_i < v_n_blocks LOOP
    IF v_means[v_i] <= v_means[v_i + 1] THEN
      v_i := v_i + 1;
      CONTINUE;
    END IF;
    -- Violation: pool blocks v_i and v_i+1 into a single weighted block.
    v_pooled_wsum := v_wsums[v_i] + v_wsums[v_i + 1];
    v_pooled_mean := (v_means[v_i] * v_wsums[v_i] + v_means[v_i + 1] * v_wsums[v_i + 1])
                     / v_pooled_wsum;

    v_means[v_i]  := v_pooled_mean;
    v_wsums[v_i]  := v_pooled_wsum;
    v_ends[v_i]   := v_ends[v_i + 1];

    -- Remove block v_i + 1 from each parallel array.
    -- PostgreSQL arrays are 1-indexed; slicing semantics preserve order.
    v_means  := v_means[1:v_i]  || v_means[v_i + 2:v_n_blocks];
    v_wsums  := v_wsums[1:v_i]  || v_wsums[v_i + 2:v_n_blocks];
    v_starts := v_starts[1:v_i] || v_starts[v_i + 2:v_n_blocks];
    v_ends   := v_ends[1:v_i]   || v_ends[v_i + 2:v_n_blocks];
    v_n_blocks := v_n_blocks - 1;

    -- Back up one block to re-check the pooled block against its left neighbor.
    IF v_i > 1 THEN
      v_i := v_i - 1;
    END IF;
  END LOOP;

  -- Expand pooled blocks back to the original index space.
  -- Cells that were NULL in input stay NULL (callers can treat as "not extracted").
  v_result := ARRAY[]::double precision[];
  FOR i IN 1..v_n LOOP
    v_result := array_append(v_result, NULL);
  END LOOP;

  FOR i IN 1..v_n_blocks LOOP
    FOR v_j IN v_starts[i]..v_ends[i] LOOP
      v_result[v_j] := v_means[i];
    END LOOP;
  END LOOP;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public._speed_isotonic_pav(double precision[], double precision[]) IS
  '0037: Pool-Adjacent-Violators isotonic regression for PL/pgSQL. Returns the weighted L2-best monotone non-decreasing approximation of p_values with weights p_weights. Used by _speed_recalibrate_matrix to enforce the matrix monotonicity invariant per time bucket. NULL inputs yield NULL output; per-cell NULLs are passed through to the result.';

GRANT EXECUTE ON FUNCTION public._speed_isotonic_pav(double precision[], double precision[]) TO PUBLIC;
