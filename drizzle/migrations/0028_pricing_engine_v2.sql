-- 0028_pricing_engine_v2.sql
--
-- Pricing engine v2: closes the late-window deep-tail exploit Rami farmed
-- in W11/W12 testing (88% win rate after 6 trades; +$279 in 3.5h on $1k
-- credit). Replaces three reinforcing bugs with cleaner mechanics:
--
--   1. The 0.99 saturation clamp on `offered_prob` (kept fair_prob and
--      offered_prob clamped to the same value, collapsing spread to zero
--      on near-decided trades — $1,325 of zero-spread handle in test data).
--      Replaced with a hard reject when fair_prob_side > 0.97 or < 0.03.
--      No "near-decided" trades, no degenerate spread.
--
--   2. The additive late-window surcharge (+0.10 / +0.15 absolute on
--      offered_prob) that got clipped by the 0.99 clamp at exactly the
--      moment it was supposed to defend. Replaced with multiplicative
--      spread escalation: last 60s → spread × 1.4; last 30s → spread ×
--      1.8; last 30s with |fair − 0.5| > 0.30 → reject; last 10s → reject.
--      Multiplicative scales naturally instead of saturating.
--
--   3. The cashout `decay × liq_discount` formula that produced sub-stake
--      cashouts when users were slightly winning (entry=0.80, mark=0.85,
--      decay=0.93 → cashout = $98.81 on $100 stake). Violates founder's
--      direction-matching invariant: "if chart is moving the user's way,
--      cashout must always be > stake".
--
--      Replaced with profit-based margin (option C, validated by Codex):
--        winning side  cashout = stake + fair_profit × (1 - margin_winning)
--        losing  side  cashout = stake + fair_profit × (1 + margin_losing)
--        equality      cashout = stake
--      where fair_profit = stake × (mark_prob/entry_offered_prob − 1).
--
--      This is direction-matching by construction: mark > entry ⇒ profit
--      positive ⇒ cashout > stake. Always. Margin amplifies the loss on
--      losers (extracts), discounts the profit on winners (also extracts),
--      and is symmetric in shape with asymmetric magnitude (CFD-style).
--
--      Eight new fee_config keys replace the old 10-key decay matrix +
--      3-tier liq discount. All admin-tunable.
--
-- Also addresses:
--   * Daily cap timezone bug (Codex finding): `CURRENT_DATE::TIMESTAMPTZ`
--     wraps wrong if DB session timezone isn't UTC. Replaced with
--     `(NOW() AT TIME ZONE 'UTC')::date`.
--   * `expected_iv` as a pricing input (Codex finding): the existing path
--     `v_iv_to_use := p_expected_iv` lets a client influence pricing
--     within drift tolerance. Server should NEVER price with client IV.
--     Removed; `p_expected_iv` is now stale-quote check ONLY.
--   * Cap defaults reset: 0027 raised `speed_stake_max_usd` to $1M and
--     `speed_cap_per_side_usd` to $1k. Both reset to admin-tunable sane
--     values keyed per duration.
--   * Cashout last-N reject tightened from 5s → 10s for symmetry with
--     entry-side last-10s reject.
--   * Cashout near-decided block: last 30s when |mark − 0.5| > 0.30
--     mirrors the entry-side defense.
--
-- Direction-matching invariant is enforced ALGEBRAICALLY by the formula
-- shape, not by a runtime check. A test in scripts/w12-cashout-direction.mjs
-- validates it across 10,000 random scenarios after this lands.
--
-- IV cache (`speed_volatility_cache` table + `_speed_get_iv()` helper)
-- comes in mig 0029. This migration still reads `fee_config.speed_iv_btc`
-- inline; the read shape doesn't change between 0028 and 0029, only the
-- function called.
--
-- Soft guards (per-user velocity, open-exposure monitor, daily handle
-- alert) come in mig 0031 alongside removing the daily wager cap.

BEGIN;

-- ============================================================================
-- 1) FEE_CONFIG — delete obsolete, insert new tunables
-- ============================================================================

-- Drop the 10-key cashout decay matrix (mig 0016 seeds). Profit-based
-- margin replaces it.
DELETE FROM public.fee_config WHERE fee_type LIKE 'speed_cashout_decay_%';

-- Drop the 3-tier liq discount (mig 0016). Profit-based margin folds the
-- liquidation premium into late_window_premium_winning/losing.
DELETE FROM public.fee_config WHERE fee_type LIKE 'speed_liq_discount_%';

-- Drop the additive late-window surcharge tiers (replaced by multiplicative
-- spread escalation; the helper speed_late_window_surcharge_pct is no
-- longer called from speed_execute_trade after this migration).
DELETE FROM public.fee_config WHERE fee_type IN (
  'speed_late_window_60s_pct',
  'speed_late_window_30s_pct'
);

-- Reset stake/cap defaults that 0027 set to "effectively no cap".
-- Per-duration per-trade ceiling + per-side cap. Admin-tunable from the
-- /admin/fees rework in week 6. Operator can lift them for VIP users
-- via per-user override (planned for v2; not in this migration).
UPDATE public.fee_config
   SET rate = 25,
       description = '0028: per-bet maximum stake in USD for 5m markets. Admin-tunable.',
       updated_at = NOW()
 WHERE fee_type = 'speed_stake_max_usd';

UPDATE public.fee_config
   SET rate = 200,
       description = '0028: per-user, per-market, per-side stake cap in USD. The headline ops knob for stake limits. Admin-tunable.',
       updated_at = NOW()
 WHERE fee_type = 'speed_cap_per_side_usd';

-- Insert new pricing engine v2 tunables.
INSERT INTO public.fee_config (fee_type, rate, description) VALUES
  -- Per-duration per-trade ceiling (5m vs 1h users behave differently —
  -- 1h users tend to size up, 5m users churn small bets fast).
  ('speed_stake_max_5m_usd', 25,
    '0028: per-bet maximum stake in USD for 5m markets. Reads first; falls back to speed_stake_max_usd.'),
  ('speed_stake_max_1h_usd', 50,
    '0028: per-bet maximum stake in USD for 1h markets. Reads first; falls back to speed_stake_max_usd.'),

  -- Hard reject thresholds (replace the 0.99 clamp).
  ('speed_fair_prob_reject_high', 0.97,
    '0028: reject entry if fair_prob_side > this value. Replaces the 0.99 saturation clamp. No near-decided bets.'),
  ('speed_fair_prob_reject_low', 0.03,
    '0028: reject entry if fair_prob_side < this value. Mirror of speed_fair_prob_reject_high.'),
  ('speed_late_30s_imbalance_reject', 0.30,
    '0028: in last 30s, reject entry if |fair_prob_side − 0.5| > this value. Closes Ramis last-30s pattern-matching exploit.'),

  -- Multiplicative spread escalation (replaces additive late-window surcharge).
  ('speed_late_60s_spread_mult', 1.40,
    '0028: spread multiplier in last 60s of market. base_spread × this = effective spread.'),
  ('speed_late_30s_spread_mult', 1.80,
    '0028: spread multiplier in last 30s of market. Stacks above the 60s tier.'),

  -- Cashout — profit-based margin (option C, founder direction-matching invariant).
  -- Winning side margin (extract a small slice of the user profit).
  ('speed_cashout_winning_base_5m', 0.025,
    '0028: cashout winning-side base margin for 5m. Applied as: cashout = stake + profit × (1 - margin). CFD-style invisible spread on close.'),
  ('speed_cashout_winning_base_1h', 0.030,
    '0028: cashout winning-side base margin for 1h.'),
  ('speed_cashout_saturation_coef', 0.20,
    '0028: extra margin coefficient on saturation (|mark − 0.5| − 0.35), applied to winning side only. Charges more when user locks in a near-certain win.'),
  ('speed_cashout_late_window_winning_coef', 0.015,
    '0028: extra margin coefficient on late-window (last 60s linear ramp), applied to winning side. Small bump.'),

  -- Losing side margin (extract a slice of the loss recovery — desperate users pay more).
  ('speed_cashout_losing_base_5m', 0.080,
    '0028: cashout losing-side base margin for 5m. Applied as: cashout = stake + profit × (1 + margin). Profit is negative on losing side, so margin AMPLIFIES the loss. CFD-style slippage on stops.'),
  ('speed_cashout_losing_base_1h', 0.090,
    '0028: cashout losing-side base margin for 1h.'),
  ('speed_cashout_desperation_coef', 0.40,
    '0028: extra margin coefficient on desperation (max(0, 0.50 − mark) × this), applied to losing side only. Charges more when the user is closer to total loss.'),
  ('speed_cashout_late_window_losing_coef', 0.05,
    '0028: extra margin coefficient on late-window, applied to losing side. Bigger ramp than winning side — losers in the late window pay more for the option to bail.'),

  -- Cashout near-decided block (mirror of entry-side defense).
  ('speed_cashout_late_30s_imbalance_reject', 0.30,
    '0028: in last 30s, reject cashout if |mark_prob − 0.5| > this value. Closes the late-window cashout arbitrage path.'),
  ('speed_cashout_late_reject_s', 10,
    '0028: seconds before close at which cashouts are rejected entirely. Tightened from 5s (mig 0022) for symmetry with entry-side.')
ON CONFLICT (fee_type) DO UPDATE
  SET rate = EXCLUDED.rate,
      description = EXCLUDED.description,
      updated_at = NOW();

-- ============================================================================
-- 2) HELPERS — UTC date math (Codex review: timezone consistency)
-- ============================================================================
--
-- The pre-0028 code used `CURRENT_DATE` for NGR circuit breaker and the
-- broken `((NOW() AT TIME ZONE 'UTC')::date)::TIMESTAMPTZ` cast for the
-- daily wager cap. Both depend on the DB session timezone; in any
-- non-UTC session, "today" wraps at the wrong moment.
--
-- These two helpers produce UTC-invariant date and midnight values
-- regardless of session timezone. Used in:
--   * speed_execute_trade        — daily wager cap, NGR circuit breaker
--   * speed_execute_cashout      — (none; cashout doesn't read daily caps)
--   * _speed_update_daily_ngr    — UPSERT key (redefined below)
--   * speed_user_alerts inserts  — alert_date column

CREATE OR REPLACE FUNCTION public._speed_utc_today()
RETURNS DATE
LANGUAGE SQL STABLE
AS $$ SELECT (NOW() AT TIME ZONE 'UTC')::date $$;

CREATE OR REPLACE FUNCTION public._speed_utc_midnight()
RETURNS TIMESTAMPTZ
LANGUAGE SQL STABLE
AS $$ SELECT ((NOW() AT TIME ZONE 'UTC')::date)::TIMESTAMP AT TIME ZONE 'UTC' $$;

COMMENT ON FUNCTION public._speed_utc_today() IS
  '0028: UTC-invariant "today" date. Replaces CURRENT_DATE / session-tz casts everywhere a daily window is computed.';
COMMENT ON FUNCTION public._speed_utc_midnight() IS
  '0028: UTC-invariant midnight TIMESTAMPTZ. Replaces ((NOW() AT TIME ZONE UTC)::date)::TIMESTAMPTZ which was casting a UTC date back to the session timezone.';

GRANT EXECUTE ON FUNCTION public._speed_utc_today() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public._speed_utc_midnight() TO PUBLIC;

-- Redefine _speed_update_daily_ngr (originally mig 0016) to use the UTC
-- helper for the ngr_date key. The function reads CURRENT_DATE in its
-- INSERT/UPDATE; replacing with _speed_utc_today() ensures NGR writer
-- and circuit-breaker reader both wrap at the same moment regardless of
-- session timezone.

CREATE OR REPLACE FUNCTION public._speed_update_daily_ngr(
  p_stake_in    DECIMAL DEFAULT 0,
  p_payout_out  DECIMAL DEFAULT 0,
  p_cashout_out DECIMAL DEFAULT 0,
  p_refund_out  DECIMAL DEFAULT 0
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_floor          DECIMAL;
  v_new_ngr        DECIMAL;
  v_existing_trip  TIMESTAMPTZ;
  v_today          DATE := _speed_utc_today();
BEGIN
  INSERT INTO speed_daily_ngr (
    ngr_date, stake_in, payout_out, cashout_out, refund_out, updated_at
  ) VALUES (
    v_today,
    COALESCE(p_stake_in, 0),
    COALESCE(p_payout_out, 0),
    COALESCE(p_cashout_out, 0),
    COALESCE(p_refund_out, 0),
    NOW()
  )
  ON CONFLICT (ngr_date) DO UPDATE
    SET stake_in    = speed_daily_ngr.stake_in    + EXCLUDED.stake_in,
        payout_out  = speed_daily_ngr.payout_out  + EXCLUDED.payout_out,
        cashout_out = speed_daily_ngr.cashout_out + EXCLUDED.cashout_out,
        refund_out  = speed_daily_ngr.refund_out  + EXCLUDED.refund_out,
        updated_at  = NOW();

  SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_daily_ngr_floor';
  v_floor := COALESCE(v_floor, -500);

  SELECT ngr, circuit_tripped_at INTO v_new_ngr, v_existing_trip
  FROM speed_daily_ngr WHERE ngr_date = v_today;

  IF v_existing_trip IS NULL AND v_new_ngr < v_floor THEN
    UPDATE speed_daily_ngr
       SET circuit_tripped_at = NOW()
     WHERE ngr_date = v_today;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._speed_update_daily_ngr(DECIMAL, DECIMAL, DECIMAL, DECIMAL) IS
  '0028: same body as 0016 except ngr_date key uses _speed_utc_today() instead of CURRENT_DATE. UTC-invariant.';

GRANT EXECUTE ON FUNCTION public._speed_update_daily_ngr(DECIMAL, DECIMAL, DECIMAL, DECIMAL) TO PUBLIC;

-- ============================================================================
-- 2b) HELPER — compute per-trade max from per-duration override
-- ============================================================================

CREATE OR REPLACE FUNCTION public._speed_get_stake_max(
  p_duration public.speed_duration
) RETURNS DECIMAL
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_per_dur  DECIMAL;
  v_default  DECIMAL;
BEGIN
  SELECT rate INTO v_per_dur
  FROM fee_config
  WHERE fee_type = 'speed_stake_max_' || p_duration::TEXT || '_usd';

  IF v_per_dur IS NOT NULL THEN
    RETURN v_per_dur;
  END IF;

  SELECT rate INTO v_default
  FROM fee_config
  WHERE fee_type = 'speed_stake_max_usd';

  RETURN COALESCE(v_default, 25);
END;
$$;

COMMENT ON FUNCTION public._speed_get_stake_max(public.speed_duration) IS
  '0028: per-duration per-trade max lookup with fallback to speed_stake_max_usd.';

GRANT EXECUTE ON FUNCTION public._speed_get_stake_max(public.speed_duration) TO PUBLIC;

-- ============================================================================
-- 3) HELPER — profit-based cashout margin (option C)
-- ============================================================================
--
-- Computes the margin to apply to fair_profit. Direction is determined
-- by the caller's `p_is_winning` flag (mark > entry vs mark < entry).
-- Returns a margin in [0, 1) that the caller multiplies into the formula:
--
--   winning:  cashout = stake + profit × (1 - margin)
--   losing:   cashout = stake + profit × (1 + margin)   -- profit is negative
--
-- The formula GUARANTEES the founder direction-matching invariant by
-- construction. This helper just produces the magnitude; sign handling is
-- in speed_execute_cashout.

CREATE OR REPLACE FUNCTION public._speed_cashout_margin(
  p_duration       public.speed_duration,
  p_is_winning     BOOLEAN,
  p_mark_prob      DECIMAL,
  p_seconds_left   DOUBLE PRECISION
) RETURNS DOUBLE PRECISION
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_dur                TEXT;
  v_base               DECIMAL;
  v_saturation_coef    DECIMAL;
  v_desperation_coef   DECIMAL;
  v_late_coef          DECIMAL;
  v_saturation         DOUBLE PRECISION;
  v_desperation        DOUBLE PRECISION;
  v_late_premium       DOUBLE PRECISION;
  v_margin             DOUBLE PRECISION;
BEGIN
  IF p_duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Cashout margin not configured for duration %', p_duration;
  END IF;
  v_dur := p_duration::TEXT;

  IF p_is_winning THEN
    -- Winning side: base + saturation premium + late-window premium.
    SELECT rate INTO v_base
    FROM fee_config
    WHERE fee_type = 'speed_cashout_winning_base_' || v_dur;
    v_base := COALESCE(v_base, CASE v_dur WHEN '5m' THEN 0.025 ELSE 0.030 END);

    SELECT rate INTO v_saturation_coef
    FROM fee_config
    WHERE fee_type = 'speed_cashout_saturation_coef';
    v_saturation_coef := COALESCE(v_saturation_coef, 0.20);

    SELECT rate INTO v_late_coef
    FROM fee_config
    WHERE fee_type = 'speed_cashout_late_window_winning_coef';
    v_late_coef := COALESCE(v_late_coef, 0.015);

    -- saturation = max(0, |mark − 0.5| − 0.35) × coef
    v_saturation := GREATEST(0.0, ABS(p_mark_prob::DOUBLE PRECISION - 0.5) - 0.35)
                    * v_saturation_coef::DOUBLE PRECISION;

    -- late_window = max(0, 60 − seconds_left)/60 × coef
    v_late_premium := GREATEST(0.0, (60.0 - p_seconds_left) / 60.0)
                      * v_late_coef::DOUBLE PRECISION;

    v_margin := v_base::DOUBLE PRECISION + v_saturation + v_late_premium;
  ELSE
    -- Losing side: base + desperation premium + late-window premium.
    SELECT rate INTO v_base
    FROM fee_config
    WHERE fee_type = 'speed_cashout_losing_base_' || v_dur;
    v_base := COALESCE(v_base, CASE v_dur WHEN '5m' THEN 0.080 ELSE 0.090 END);

    SELECT rate INTO v_desperation_coef
    FROM fee_config
    WHERE fee_type = 'speed_cashout_desperation_coef';
    v_desperation_coef := COALESCE(v_desperation_coef, 0.40);

    SELECT rate INTO v_late_coef
    FROM fee_config
    WHERE fee_type = 'speed_cashout_late_window_losing_coef';
    v_late_coef := COALESCE(v_late_coef, 0.05);

    -- desperation = max(0, 0.50 − mark) × coef
    v_desperation := GREATEST(0.0, 0.50 - p_mark_prob::DOUBLE PRECISION)
                     * v_desperation_coef::DOUBLE PRECISION;

    v_late_premium := GREATEST(0.0, (60.0 - p_seconds_left) / 60.0)
                      * v_late_coef::DOUBLE PRECISION;

    v_margin := v_base::DOUBLE PRECISION + v_desperation + v_late_premium;
  END IF;

  -- Sanity ceiling: 50% margin on either side. Should never hit at sane
  -- coefficient values; defensive cap so a misconfigured fee_config row
  -- can't push margin into 100%+ range.
  IF v_margin > 0.50 THEN
    v_margin := 0.50;
  END IF;
  IF v_margin < 0 THEN
    v_margin := 0;
  END IF;

  RETURN v_margin;
END;
$$;

COMMENT ON FUNCTION public._speed_cashout_margin(public.speed_duration, BOOLEAN, DECIMAL, DOUBLE PRECISION) IS
  '0028: profit-based cashout margin (option C). Direction-matching invariant is enforced by the FORMULA shape in speed_execute_cashout, not here. This just produces the magnitude.';

GRANT EXECUTE ON FUNCTION public._speed_cashout_margin(public.speed_duration, BOOLEAN, DECIMAL, DOUBLE PRECISION) TO PUBLIC;

-- ============================================================================
-- 4) speed_execute_trade — pricing engine v2
-- ============================================================================
--
-- Body diff vs 0027 (the canonical predecessor):
--   * Add hard reject when fair_prob_side > 0.97 or < 0.03 (drops 0.99 clamp)
--   * Add hard reject in last 30s when |fair_prob_side − 0.5| > 0.30
--   * Replace `speed_late_window_surcharge_pct` (additive) with
--     multiplicative spread escalation (1.4× / 1.8×)
--   * Remove `v_iv_to_use := p_expected_iv` branch (server always uses
--     server IV; client expected_iv is stale-quote check ONLY)
--   * Per-duration stake max via `_speed_get_stake_max`
--   * Daily cap timezone fix: `(NOW() AT TIME ZONE 'UTC')::date`

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id       UUID,
  p_side            TEXT,
  p_stake           NUMERIC,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_user               RECORD;
  v_market             RECORD;
  v_oracle             RECORD;
  v_existing_dup       RECORD;

  v_master_enabled     DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_spread_pct         DECIMAL;
  v_extreme_coeff      DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_late_reject_s      DECIMAL;

  v_fair_reject_high   DECIMAL;
  v_fair_reject_low    DECIMAL;
  v_late_30s_imbalance DECIMAL;
  v_late_60s_mult      DECIMAL;
  v_late_30s_mult      DECIMAL;

  v_pool_collateral    DECIMAL;
  v_max_side_pct       DECIMAL;
  v_max_cluster_pct    DECIMAL;
  v_max_user_daily     DECIMAL;
  v_circuit_tripped    TIMESTAMPTZ;

  v_stake_min          DECIMAL := 1.00;
  v_stake_max          DECIMAL;
  v_cap_per_side       DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_fair_prob_side     DECIMAL;
  v_distance           DOUBLE PRECISION;
  v_overage            DOUBLE PRECISION;
  v_widened_spread     DOUBLE PRECISION;
  v_spread_mult        DOUBLE PRECISION;
  v_offered_prob       DECIMAL;

  v_seconds_left       DOUBLE PRECISION;
  v_payout_if_won      DECIMAL;

  v_user_market_sum    DECIMAL;
  v_user_daily_sum     DECIMAL;
  v_side_payout_sum    DECIMAL;
  v_cluster_payout_sum DECIMAL;
  v_strike_lo          DECIMAL;
  v_strike_hi          DECIMAL;

  v_position_id        UUID;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_side NOT IN ('over','under') THEN
    RAISE EXCEPTION 'Side must be over or under';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Stake must be positive';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Speed market not found';
  END IF;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Speed market has closed';
  END IF;
  IF NOW() < v_market.opens_at THEN
    RAISE EXCEPTION 'Speed market has not opened yet';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;
  IF v_market.strike_price IS NULL THEN
    RAISE EXCEPTION 'Speed market strike not yet finalized';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  -- 0028: per-duration per-trade ceiling (replaces 0027's $1M default).
  v_stake_max := _speed_get_stake_max(v_market.duration);
  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)', p_stake, v_stake_min, v_stake_max;
  END IF;

  -- Per-user-per-market-per-side cap (unchanged shape; default $200 from 0028).
  SELECT rate INTO v_cap_per_side FROM fee_config WHERE fee_type = 'speed_cap_per_side_usd' LIMIT 1;
  v_cap_per_side := COALESCE(v_cap_per_side, 200);
  SELECT COALESCE(SUM(stake), 0) INTO v_user_market_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';
  IF v_user_market_sum + p_stake > v_cap_per_side THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_per_side - v_user_market_sum);
  END IF;

  -- 0028: per-user daily wager cap with TIMEZONE FIX.
  -- Read-and-skip if 0 (founder may disable in mig 0031). Old behavior:
  -- CURRENT_DATE::TIMESTAMPTZ depends on session timezone; if not UTC,
  -- "daily" wraps wrong. New behavior: explicit UTC date math.
  SELECT rate INTO v_max_user_daily FROM fee_config WHERE fee_type = 'speed_max_user_daily_wager';
  IF v_max_user_daily IS NOT NULL AND v_max_user_daily > 0 THEN
    SELECT COALESCE(SUM(stake), 0) INTO v_user_daily_sum
    FROM speed_positions
    WHERE user_id = v_user_id
      AND created_at >= _speed_utc_midnight()
      AND status IN ('open','won','lost','cashed_out','refunded');
    IF v_user_daily_sum + p_stake > v_max_user_daily THEN
      RAISE EXCEPTION 'Daily wager limit reached: $% of $% used today (UTC)',
        v_user_daily_sum, v_max_user_daily;
    END IF;
  END IF;

  -- Daily NGR circuit breaker (UTC-invariant per mig 0028 helpers; reader
  -- and writer (_speed_update_daily_ngr) both call _speed_utc_today()).
  SELECT circuit_tripped_at INTO v_circuit_tripped
  FROM speed_daily_ngr WHERE ngr_date = _speed_utc_today();
  IF v_circuit_tripped IS NOT NULL THEN
    RAISE EXCEPTION 'Daily limit reached, try again tomorrow';
  END IF;

  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── PRICING (v2) ─────────────────────────────────────────────────────
  SELECT rate INTO v_spread_pct    FROM fee_config WHERE fee_type = 'speed_spread_pct';
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff';
  SELECT rate INTO v_iv            FROM fee_config WHERE fee_type = 'speed_iv_btc';
  v_spread_pct    := COALESCE(v_spread_pct, 0.05);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_iv            := COALESCE(v_iv, 0.60);

  -- 0028: client expected_iv is now ONLY a stale-quote check. Server
  -- ALWAYS prices with server IV. Removes the prior dangerous path where
  -- v_iv_to_use := p_expected_iv let client influence pricing within
  -- drift tolerance.
  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
  END IF;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- 0028: hard reject on near-decided states (replaces 0.99 clamp).
  SELECT rate INTO v_fair_reject_high FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_high';
  SELECT rate INTO v_fair_reject_low  FROM fee_config WHERE fee_type = 'speed_fair_prob_reject_low';
  v_fair_reject_high := COALESCE(v_fair_reject_high, 0.97);
  v_fair_reject_low  := COALESCE(v_fair_reject_low,  0.03);
  IF v_fair_prob_side > v_fair_reject_high THEN
    RAISE EXCEPTION 'Trade rejected: outcome too close to certain (fair_prob=%)', ROUND(v_fair_prob_side, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;
  IF v_fair_prob_side < v_fair_reject_low THEN
    RAISE EXCEPTION 'Trade rejected: side too unlikely (fair_prob=%)', ROUND(v_fair_prob_side, 4)
      USING HINT = 'Pick the other side';
  END IF;

  -- 0028: in last 30s, reject deep-tail bets (Ramis pattern). Closes the
  -- visual pattern-matching exploit even when fair_prob is below 0.97 due
  -- to mispricing.
  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Trade rejected: too late and too one-sided (fair_prob=%, secs_left=%)',
        ROUND(v_fair_prob_side, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Place this bet earlier in the market';
    END IF;
  END IF;

  -- 0028: spread layering — base + Seam 3 quadratic widening + multiplicative late-window.
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

  -- 0028: multiplicative late-window escalation (replaces additive surcharge).
  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_mult FROM fee_config WHERE fee_type = 'speed_late_30s_spread_mult';
    v_spread_mult := COALESCE(v_late_30s_mult, 1.80);
  ELSIF v_seconds_left < 60 THEN
    SELECT rate INTO v_late_60s_mult FROM fee_config WHERE fee_type = 'speed_late_60s_spread_mult';
    v_spread_mult := COALESCE(v_late_60s_mult, 1.40);
  ELSE
    v_spread_mult := 1.0;
  END IF;
  v_widened_spread := v_widened_spread * v_spread_mult;

  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;

  -- 0028 (Codex review fix): no silent 0.99 ceiling. The earlier draft
  -- left `IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99` as a
  -- "sanity floor", but that re-introduced the spread-collapse bug — at
  -- fair=0.96 with last-30s mult 1.8x, offered would compute to ~1.005
  -- and clamp to 0.99, capturing only 2.1% house edge instead of the
  -- intended 4.5%. Hard reject instead. The user must wait for the
  -- market to move or pick the other side.
  IF v_offered_prob < 0.01 THEN v_offered_prob := 0.01; END IF;
  IF v_offered_prob > 0.99 THEN
    RAISE EXCEPTION 'Trade rejected: pricing saturated (offered_prob=% would exceed 0.99 cap)', ROUND(v_offered_prob, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;

  -- Per-side market exposure cap.
  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);

  v_payout_if_won := p_stake / v_offered_prob;

  SELECT COALESCE(SUM(stake / entry_offered_prob), 0) INTO v_side_payout_sum
  FROM speed_positions
  WHERE market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';

  IF v_side_payout_sum + v_payout_if_won > v_max_side_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
      USING HINT = format('payout liability $%.2f vs cap $%.2f (%.0f%% of $%.0f pool)',
        v_side_payout_sum + v_payout_if_won,
        v_max_side_pct * v_pool_collateral,
        v_max_side_pct * 100, v_pool_collateral);
  END IF;

  -- Same-strike cluster cap.
  SELECT rate INTO v_max_cluster_pct FROM fee_config WHERE fee_type = 'speed_max_strike_cluster_pct';
  v_max_cluster_pct := COALESCE(v_max_cluster_pct, 0.30);

  v_strike_lo := v_market.strike_price * 0.995;
  v_strike_hi := v_market.strike_price * 1.005;

  SELECT COALESCE(SUM(p.stake / p.entry_offered_prob), 0) INTO v_cluster_payout_sum
  FROM speed_positions p
  JOIN speed_markets m ON m.id = p.market_id
  WHERE p.status = 'open'
    AND p.side = p_side::speed_side
    AND m.status = 'open'
    AND m.asset = v_market.asset
    AND m.strike_price BETWEEN v_strike_lo AND v_strike_hi;

  IF v_cluster_payout_sum + v_payout_if_won > v_max_cluster_pct * v_pool_collateral THEN
    RAISE EXCEPTION 'Strike cluster exposure cap reached on % side', p_side
      USING HINT = format('cluster liability $%.2f vs cap $%.2f',
        v_cluster_payout_sum + v_payout_if_won, v_max_cluster_pct * v_pool_collateral);
  END IF;

  -- ── ATOMIC WRITES ────────────────────────────────────────────────────
  INSERT INTO speed_positions (
    user_id, market_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, p_side::speed_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, iv_used, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, NULL, v_iv, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  UPDATE users SET
    balance_usd = balance_usd - p_stake,
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'position_id', v_position_id,
    'trade_id', v_trade_id,
    'side', p_side,
    'stake', ROUND(p_stake, 2),
    'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8),
    'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6),
    'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'iv_used', ROUND(v_iv, 6),
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL) IS
  '0028: pricing engine v2. Drops 0.99 clamp (replaced with hard rejects on fair_prob > 0.97 / < 0.03 + last-30s deep-tail block). Multiplicative late-window spread escalation. Server-only IV pricing (client expected_iv is stale-quote check ONLY). Daily cap timezone fix. Per-duration stake max.';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL) TO PUBLIC;

-- ============================================================================
-- 5) speed_execute_cashout — pricing engine v2 (profit-based margin)
-- ============================================================================
--
-- Body diff vs 0022 (the canonical predecessor):
--   * Replace `decay × liq_discount` cashout formula with profit-based
--     option C. Direction-matching invariant satisfied algebraically.
--   * Tighten last-N reject from 5s → 10s for symmetry with entry-side.
--   * Add last-30s near-decided reject (mirror of entry-side defense).
--   * Remove `v_iv_to_use := p_expected_iv` branch (server-only IV).
--   * Track applied margin in speed_trades for forensic / calibration.

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id     UUID,
  p_idempotency_key TEXT    DEFAULT NULL,
  p_expected_iv     DECIMAL DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_position           RECORD;
  v_market             RECORD;
  v_market_id          UUID;
  v_oracle             RECORD;

  v_kill_switch        DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_seconds_total      DOUBLE PRECISION;
  v_seconds_left       DOUBLE PRECISION;
  v_pct                DOUBLE PRECISION;
  v_late_reject_s      DECIMAL;
  v_late_30s_imbalance DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_mark_prob          DECIMAL;
  v_is_winning         BOOLEAN;
  v_fair_profit        NUMERIC;
  v_margin             DOUBLE PRECISION;
  v_cashout_amount     NUMERIC;

  v_existing_dup       RECORD;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 0022: kill switch.
  SELECT rate INTO v_kill_switch FROM fee_config WHERE fee_type = 'speed_cashout_enabled' LIMIT 1;
  IF COALESCE(v_kill_switch, 1) <= 0 THEN
    RAISE EXCEPTION 'Cashout temporarily disabled — please try again shortly';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate cashout — returning existing trade_id'
      );
    END IF;
  END IF;

  SELECT market_id INTO v_market_id
  FROM speed_positions WHERE id = p_position_id;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('speed_resolve_' || v_market_id::TEXT));

  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not authorised for this position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;

  -- 0028: tighten last-N reject from 5s (mig 0022) to 10s for symmetry
  -- with entry-side. fee_config-tunable via speed_cashout_late_reject_s.
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no cashouts in last %s seconds', v_late_reject_s;
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  -- 0028: server-only IV pricing. Client expected_iv is stale-quote check ONLY.
  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  v_iv := COALESCE(v_iv, 0.60);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_pct := CASE WHEN v_seconds_total > 0 THEN v_seconds_left / v_seconds_total ELSE 0 END;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
  END IF;

  -- 0028: last-30s near-decided reject (mirror of entry-side defense).
  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_mark_prob::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Cashout rejected: too late and too one-sided (mark=%, secs_left=%)',
        ROUND(v_mark_prob, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Hold to expiry — cashout window is closed';
    END IF;
  END IF;

  -- 0028: profit-based cashout (option C). Direction-matching invariant
  -- is enforced algebraically by the formula shape:
  --   winning (mark > entry) ⇒ profit > 0 ⇒ cashout = stake + profit*(1-m) > stake
  --   losing  (mark < entry) ⇒ profit < 0 ⇒ cashout = stake + profit*(1+m) < stake
  --   equality                                cashout = stake
  v_is_winning := v_mark_prob > v_position.entry_offered_prob;
  v_fair_profit := v_position.stake
                 * (v_mark_prob / v_position.entry_offered_prob - 1.0);

  v_margin := _speed_cashout_margin(
    v_market.duration, v_is_winning, v_mark_prob, v_seconds_left
  );

  IF v_is_winning THEN
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 - v_margin);
  ELSE
    -- Losing side: fair_profit is negative, (1 + margin) > 1, so the
    -- product is more negative ⇒ smaller cashout. Direction-matching ✓.
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 + v_margin);
  END IF;

  -- Floor at $0 (defensive — at margin=0.5 and mark→0, formula could go
  -- negative).
  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;

  -- 0028 (Codex review fix): direction-matching after cents rounding.
  -- Tiny-edge case: stake=$100, entry=0.80, mark=0.800010, margin=2.5%
  -- → raw cashout ~$100.0012, rounds to $100.00 == stake. Founder rule
  -- says > stake when winning. Rather than pad to stake+$0.01 (creates
  -- churn EV per Codex), reject the cashout. User waits for the chart
  -- to move further or holds to expiry.
  IF v_is_winning AND ROUND(v_cashout_amount, 2) <= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_PROFIT: profit too small to lock in cleanly (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Wait for the chart to move further or hold to expiry';
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND ROUND(v_cashout_amount, 2) >= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_LOSS: rounded cashout would not register a loss (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Hold to expiry — there is no meaningful loss to cut';
  END IF;

  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- Defensive double-check (uses strict <= / >= per Codex review).
  -- Should NEVER fire after the INSUFFICIENT_PROFIT/LOSS guards above.
  -- If it does, the formula or rounding is broken — fail loudly.
  IF v_is_winning AND v_cashout_amount <= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: winning cashout=$% <= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND v_cashout_amount >= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: losing cashout=$% >= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  -- speed_trades.cashout_multiplier slot now stores the applied margin
  -- (was previously the decay multiplier). Documented in column comment
  -- update via mig 0031.
  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier,
    iv_used, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_mark_prob, v_position.entry_offered_prob, v_margin::DECIMAL,
    v_iv, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (margin ' || ROUND(v_margin::NUMERIC, 4) || ', ' ||
      CASE WHEN v_is_winning THEN 'winning' ELSE 'losing' END ||
      ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
    );
  END IF;

  PERFORM _speed_update_daily_ngr(0, 0, v_cashout_amount, 0);

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'position_id', p_position_id,
    'cashout_amount', v_cashout_amount,
    'mark_prob', ROUND(v_mark_prob, 6),
    'is_winning', v_is_winning,
    'margin_applied', ROUND(v_margin::NUMERIC, 6),
    'fair_profit', ROUND(v_fair_profit, 4),
    'iv_used', ROUND(v_iv, 6),
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) IS
  '0028: pricing engine v2 cashout. Profit-based margin (option C) — direction-matching invariant: mark>entry⇒cashout>stake, mark<entry⇒cashout<stake, always. Last-10s reject (tightened from 5s). Last-30s near-decided reject. Server-only IV pricing.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) TO PUBLIC;

COMMIT;
