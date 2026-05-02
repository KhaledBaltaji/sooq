-- 107_v3_fn_lmsr_math.sql — LMSR math helpers (pure functions, no table access)
-- Log-sum-exp trick for numerical stability. Hard cap at q > 50*b.

-- ============================================================
-- lmsr_cost: C(q) = b * ln(e^(q_yes/b) + e^(q_no/b))
-- Stable form: b * (max_q/b + ln(1 + e^(-|q_yes - q_no|/b)))
-- ============================================================

CREATE OR REPLACE FUNCTION lmsr_cost(
  p_b DECIMAL,
  p_q_yes DECIMAL,
  p_q_no DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_max_q DECIMAL;
  v_diff DECIMAL;
BEGIN
  -- Hard cap: prevent overflow
  IF ABS(p_q_yes) > 50 * p_b OR ABS(p_q_no) > 50 * p_b THEN
    RAISE EXCEPTION 'LMSR overflow: q values exceed 50*b (q_yes=%, q_no=%, b=%)',
      ROUND(p_q_yes, 2), ROUND(p_q_no, 2), ROUND(p_b, 2);
  END IF;

  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;

  -- Log-sum-exp trick: ln(e^a + e^b) = max(a,b) + ln(1 + e^(-|a-b|))
  v_max_q := GREATEST(p_q_yes, p_q_no);
  v_diff := ABS(p_q_yes - p_q_no);

  RETURN p_b * (v_max_q / p_b + LN(1.0 + EXP(-v_diff / p_b)));
END;
$$;


-- ============================================================
-- lmsr_price: P(side) = 1 / (1 + e^((q_other - q_side)/b))
-- Numerically stable sigmoid form
-- ============================================================

CREATE OR REPLACE FUNCTION lmsr_price(
  p_b DECIMAL,
  p_q_yes DECIMAL,
  p_q_no DECIMAL,
  p_side TEXT
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_diff DECIMAL;
  v_exp_val DECIMAL;
BEGIN
  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;

  -- diff = (q_side - q_other) / b
  IF p_side = 'yes' THEN
    v_diff := (p_q_yes - p_q_no) / p_b;
  ELSIF p_side = 'no' THEN
    v_diff := (p_q_no - p_q_yes) / p_b;
  ELSE
    RAISE EXCEPTION 'LMSR: side must be yes or no';
  END IF;

  -- Stable sigmoid: avoid overflow in EXP
  -- If diff >= 0: 1 / (1 + e^(-diff))
  -- If diff < 0: e^(diff) / (1 + e^(diff))
  IF v_diff >= 0 THEN
    RETURN 1.0 / (1.0 + EXP(-v_diff));
  ELSE
    v_exp_val := EXP(v_diff);
    RETURN v_exp_val / (1.0 + v_exp_val);
  END IF;
END;
$$;


-- ============================================================
-- lmsr_shares_for_cost: inverse of cost function
-- Given a dollar amount to spend, how many shares on p_side?
-- Closed-form, computed in log space for stability.
-- ============================================================

CREATE OR REPLACE FUNCTION lmsr_shares_for_cost(
  p_b DECIMAL,
  p_q_yes DECIMAL,
  p_q_no DECIMAL,
  p_side TEXT,
  p_cost DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_q_side DECIMAL;
  v_q_other DECIMAL;
  v_cost_over_b DECIMAL;
  v_side_over_b DECIMAL;
  v_other_over_b DECIMAL;
  v_max_q_over_b DECIMAL;
  v_ln_sum_exp DECIMAL;
  v_A DECIMAL;
  v_B DECIMAL;
  v_ln_inner DECIMAL;
  v_shares DECIMAL;
BEGIN
  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'LMSR: cost must be positive';
  END IF;

  IF p_side = 'yes' THEN
    v_q_side := p_q_yes;
    v_q_other := p_q_no;
  ELSIF p_side = 'no' THEN
    v_q_side := p_q_no;
    v_q_other := p_q_yes;
  ELSE
    RAISE EXCEPTION 'LMSR: side must be yes or no';
  END IF;

  -- Closed-form inverse:
  -- new_cost - old_cost = p_cost
  -- shares = b * ln(e^(cost/b) * (e^(q_side/b) + e^(q_other/b)) - e^(q_other/b)) - q_side
  --
  -- In log space:
  -- ln(sum_exp) = max(q_side, q_other)/b + ln(1 + e^(-|q_side - q_other|/b))
  -- A = cost/b + ln(sum_exp)
  -- B = q_other/b
  -- ln(inner) = A + ln(1 - e^(B - A))  [valid when A > B]
  -- shares = b * ln(inner) - q_side

  v_cost_over_b := p_cost / p_b;
  v_side_over_b := v_q_side / p_b;
  v_other_over_b := v_q_other / p_b;

  v_max_q_over_b := GREATEST(v_side_over_b, v_other_over_b);
  v_ln_sum_exp := v_max_q_over_b + LN(1.0 + EXP(-ABS(v_side_over_b - v_other_over_b)));

  v_A := v_cost_over_b + v_ln_sum_exp;
  v_B := v_other_over_b;

  IF v_A <= v_B THEN
    RAISE EXCEPTION 'LMSR: cost too small to purchase any shares';
  END IF;

  v_ln_inner := v_A + LN(1.0 - EXP(v_B - v_A));
  v_shares := p_b * v_ln_inner - v_q_side;

  IF v_shares <= 0 THEN
    RAISE EXCEPTION 'LMSR: computed shares <= 0 (cost may be too small)';
  END IF;

  -- Safety: check the new q wouldn't overflow
  IF (v_q_side + v_shares) > 50 * p_b THEN
    RAISE EXCEPTION 'LMSR: trade would exceed q limit (50*b)';
  END IF;

  RETURN v_shares;
END;
$$;
