-- ============================================================================
-- 318_speed_rpc_helpers.sql
--
-- Tier 1 prerequisites: enum extensions + math helper + commission walk.
--
-- Why a separate _credit_speed_commission:
-- The existing _credit_commission queries the `markets` table for status,
-- but speed markets live in `speed_markets`. Reusing it would either fail
-- or silently mis-credit. Speed gets its own helper with simpler status
-- logic: if activated → credited immediately, else → escrowed. Speed
-- markets resolve in minutes so "pending" state isn't useful here.
-- ============================================================================

-- ── ENUM extensions ────────────────────────────────────────────────────────

ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'speed_stake';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'speed_winning';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'speed_cashout';
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'speed_refund';

ALTER TYPE commission_source_type ADD VALUE IF NOT EXISTS 'referral_speed';
-- ============================================================================
-- 318b_speed_helpers_funcs.sql
--
-- Math + commission helpers. Separate transaction from the enum extensions
-- in 318a because Postgres requires `ALTER TYPE ADD VALUE` to commit before
-- the new value can be referenced by other DDL.
-- ============================================================================

-- ── Standard normal CDF (Abramowitz & Stegun 26.2.17, ~7.5e-8 accuracy) ────
-- Used by Black-Scholes binary pricing (P(OVER) = N(d2)).

CREATE OR REPLACE FUNCTION normal_cdf(x DOUBLE PRECISION)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  k DOUBLE PRECISION;
  phi DOUBLE PRECISION;
  approx DOUBLE PRECISION;
  abs_x DOUBLE PRECISION;
  a1 CONSTANT DOUBLE PRECISION := 0.319381530;
  a2 CONSTANT DOUBLE PRECISION := -0.356563782;
  a3 CONSTANT DOUBLE PRECISION := 1.781477937;
  a4 CONSTANT DOUBLE PRECISION := -1.821255978;
  a5 CONSTANT DOUBLE PRECISION := 1.330274429;
BEGIN
  abs_x := ABS(x);
  k := 1.0 / (1.0 + 0.2316419 * abs_x);
  phi := EXP(-(x * x) / 2.0) / SQRT(2.0 * pi());
  approx := 1.0 - phi * (a1 * k + a2 * k * k + a3 * k * k * k + a4 * k * k * k * k + a5 * k * k * k * k * k);
  IF x >= 0 THEN
    RETURN approx;
  ELSE
    RETURN 1.0 - approx;
  END IF;
END;
$$;

COMMENT ON FUNCTION normal_cdf(DOUBLE PRECISION) IS
'Standard normal cumulative distribution function. Abramowitz & Stegun polynomial approximation, ~7.5e-8 accuracy. Used by speed-market binary pricing.';

-- ── Speed-market binary fair probability ───────────────────────────────────
-- Returns P(spot > strike at T) — i.e., probability OVER wins.
-- Black-Scholes binary call: N(d2) where
--   d2 = (ln(S/K) + (r - σ²/2) * T) / (σ * √T)
-- We treat r=0. T in years. σ from fee_config.speed_iv_btc.

CREATE OR REPLACE FUNCTION speed_fair_prob_over(
  p_spot          DECIMAL,
  p_strike        DECIMAL,
  p_seconds_left  DOUBLE PRECISION,
  p_iv            DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_T   DOUBLE PRECISION;
  v_sig DOUBLE PRECISION;
  v_d2  DOUBLE PRECISION;
  v_p   DOUBLE PRECISION;
BEGIN
  IF p_seconds_left <= 0 THEN
    -- At or past expiry. Resolve based on direction.
    IF p_spot > p_strike THEN RETURN 0.99;
    ELSIF p_spot < p_strike THEN RETURN 0.01;
    ELSE RETURN 0.5; END IF;
  END IF;
  v_T := p_seconds_left / (365.0 * 24.0 * 60.0 * 60.0);   -- years
  v_sig := p_iv::DOUBLE PRECISION;
  IF v_sig <= 0 THEN v_sig := 0.6; END IF;
  v_d2 := (LN(p_spot::DOUBLE PRECISION / p_strike::DOUBLE PRECISION)
           + (0.0 - v_sig * v_sig / 2.0) * v_T)
          / (v_sig * SQRT(v_T));
  v_p := normal_cdf(v_d2);
  -- Clip to [0.01, 0.99] so payout multipliers don't explode at boundaries.
  IF v_p < 0.01 THEN v_p := 0.01;
  ELSIF v_p > 0.99 THEN v_p := 0.99;
  END IF;
  RETURN v_p::DECIMAL;
END;
$$;

COMMENT ON FUNCTION speed_fair_prob_over(DECIMAL, DECIMAL, DOUBLE PRECISION, DECIMAL) IS
'Black-Scholes fair probability that spot > strike at expiry. Inputs: spot, strike, seconds-to-expiry, implied vol. Output clipped to [0.01, 0.99].';

-- ── Cashout-bucket helper ──────────────────────────────────────────────────
-- Maps percent-of-time-remaining to a string bucket: 'high', 'mid', 'low'.

CREATE OR REPLACE FUNCTION speed_time_bucket(
  p_seconds_total DOUBLE PRECISION,
  p_seconds_left  DOUBLE PRECISION
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE v_pct DOUBLE PRECISION;
BEGIN
  IF p_seconds_total <= 0 THEN RETURN 'low'; END IF;
  v_pct := p_seconds_left / p_seconds_total;
  IF v_pct >= 0.6 THEN RETURN 'high';
  ELSIF v_pct >= 0.2 THEN RETURN 'mid';
  ELSE RETURN 'low';
  END IF;
END;
$$;

-- ── Credit a single speed commission row ───────────────────────────────────
-- Speed-specific because the prediction _credit_commission queries the
-- markets table for status; speed markets live in speed_markets.
-- Simpler status logic for speed:
--   - Not activated → escrowed (released later by _release_escrowed_commissions)
--   - Activated → credited immediately + balance updated

CREATE OR REPLACE FUNCTION _credit_speed_commission(
  p_ancestor_id UUID,
  p_trader_id   UUID,
  p_market_id   UUID,
  p_trade_id    UUID,
  p_layer       INTEGER,
  p_agent_level INTEGER,
  p_platform_revenue DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rate         DECIMAL;
  v_commission   DECIMAL;
  v_activated    BOOLEAN;
  v_status       commission_status;
  v_should_credit BOOLEAN;
  v_new_balance  DECIMAL;
BEGIN
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = 'speed_ngr_commission'
    AND level = p_agent_level
    AND depth = p_layer;

  IF v_rate IS NULL OR v_rate = 0 THEN RETURN 0; END IF;

  v_commission := p_platform_revenue * v_rate;
  IF v_commission < 0.01 THEN RETURN 0; END IF;

  v_activated := _is_agent_activated(p_ancestor_id);

  IF NOT v_activated THEN
    v_status := 'escrowed';
    v_should_credit := FALSE;
  ELSE
    v_status := 'credited';
    v_should_credit := TRUE;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type, source_type, branch_id
  ) VALUES (
    p_ancestor_id, p_trader_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission, v_status, 'speed_trade', 'referral_speed', NULL
  );

  IF v_should_credit THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
    WHERE id = p_ancestor_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      p_ancestor_id, 'commission', v_commission, v_new_balance,
      p_trade_id,
      'Speed commission (Layer ' || p_layer || ') — ' || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 4)
    );
  END IF;

  RETURN v_commission;
END;
$$;

-- ── Pay speed trade commissions (walks user.referral_chain, 2 layers) ──────

CREATE OR REPLACE FUNCTION pay_speed_trade_commissions(
  p_trade_id UUID,
  p_user_id  UUID,
  p_stake    DECIMAL,
  p_market_id UUID
)
RETURNS DECIMAL
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_layer INTEGER;
  v_ancestor RECORD;
  v_commission DECIMAL;
  v_total DECIMAL := 0;
  v_handle_fee_pct DECIMAL;
  v_spread_pct DECIMAL;
  v_new_level INTEGER;
BEGIN
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct';
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct';
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);

  -- Platform revenue per trade = handle_fee + half-spread × stake
  v_platform_revenue := p_stake * (v_handle_fee_pct + v_spread_pct / 2.0);

  IF v_platform_revenue <= 0 THEN RETURN 0; END IF;

  SELECT referral_chain INTO v_chain FROM users WHERE id = p_user_id;
  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL THEN RETURN 0; END IF;

  -- Walk 2 layers (capped)
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 2) LOOP
    v_ancestor_id := v_chain[v_layer];
    IF v_ancestor_id IS NULL THEN CONTINUE; END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
    IF v_ancestor IS NULL THEN CONTINUE; END IF;

    -- Update network volume + ratchet tier
    UPDATE users SET network_volume = COALESCE(network_volume, 0) + p_stake
    WHERE id = v_ancestor_id;

    v_new_level := CASE
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 200000 THEN 4
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 50000  THEN 3
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 10000  THEN 2
      ELSE 1
    END;
    IF v_new_level > COALESCE(v_ancestor.agent_level, 1) THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    v_commission := _credit_speed_commission(
      v_ancestor_id, p_user_id, p_market_id, p_trade_id,
      v_layer, COALESCE(v_ancestor.agent_level, 1), v_platform_revenue
    );
    v_total := v_total + v_commission;
  END LOOP;

  RETURN v_total;
END;
$$;

COMMENT ON FUNCTION pay_speed_trade_commissions(UUID, UUID, DECIMAL, UUID) IS
'Walks user.referral_chain (2 layers) and credits speed commissions. Basis = stake × (handle_fee_pct + spread_pct/2). Activation gate via _credit_speed_commission. Should ONLY be called for retail and commission-branch users (not reseller — reseller branches handle their own sub-agent payouts via Flows B/C in Part 3).';
