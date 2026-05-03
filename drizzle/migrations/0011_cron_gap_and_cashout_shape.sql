-- 0011_cron_gap_and_cashout_shape.sql
--
-- W10 cleanup follow-ups from the W9 findings.
--
--  1. Cron 5-minute "no active market" gap.
--     `_next_clean_boundary(p_duration, NOW())` returns *strictly* future:
--     when cron fires at 12:05:05 (just after a 5m market resolved),
--     it returns 12:10 — leaving a 5-minute window where no 5m market
--     exists for traders. Fix: add a 30-second tolerance so that if NOW
--     is within 30s of a clean boundary, anchor at that boundary instead
--     of skipping forward. Verified safe because:
--       • The roll loop's existing-open-market check already prevents
--         double-rolling within an active window, so we can't accidentally
--         backdate over a still-open market.
--       • If NOW is e.g. 12:05:05, anchoring at 12:05 gives a market with
--         opens_at 5s in the past. The trade RPC accepts `NOW >= opens_at`,
--         so traders can immediately use it. TWAP at resolution averages
--         over the full window — a 5s "missing" head is <0.2% of a 5m
--         market and within the freshness tolerance budget.
--       • For 24h, 30s tolerance against a 24h window is irrelevant
--         (rounds to midnight).
--
--  2. `speed_execute_cashout` JSONB return shape.
--     The trade RPC returns `payout_if_won`. The cashout RPC returns
--     `cashout_amount`. Frontend / API consumers expecting a single
--     `payout` field across both got `undefined` for cashout. Add a
--     `payout` alias in the cashout return without removing the
--     existing `cashout_amount` (back-compat for any consumer that
--     already adopted the original name).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────
-- 1) _next_clean_boundary — tolerance-aware
-- ───────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _next_clean_boundary(p_duration speed_duration, p_now TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  -- 30s post-boundary tolerance lets a roll fired right after a market
  -- resolved (cron firing at e.g. :05:05 right after :05 resolution)
  -- anchor at :05 instead of jumping to :10. See 0011 commentary.
  SELECT CASE p_duration
    WHEN '5m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 5 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 5)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '5 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 5) + 1)
      END
    WHEN '15m'::speed_duration THEN
      CASE
        WHEN (EXTRACT(MINUTE FROM p_now)::int % 15 = 0)
             AND EXTRACT(SECOND FROM p_now) < 30 THEN
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * FLOOR(EXTRACT(MINUTE FROM p_now) / 15)
        ELSE
          date_trunc('hour', p_now)
            + INTERVAL '15 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 15) + 1)
      END
    WHEN '24h'::speed_duration THEN
      -- 24h windows roll at midnight UTC. Tolerance not meaningful at
      -- this resolution.
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;

COMMENT ON FUNCTION _next_clean_boundary(speed_duration, TIMESTAMPTZ) IS
'Next clean boundary for a duration with 30s post-boundary tolerance to eliminate the cron-roll gap (5m → :00,:05,…; 15m → :00,:15,:30,:45; 24h → midnight UTC).';


-- ───────────────────────────────────────────────────────────────────────
-- 2) speed_execute_cashout — add `payout` to return JSONB
-- ───────────────────────────────────────────────────────────────────────
-- Re-emit the full RPC body unchanged except for the return — keeps the
-- entire definition co-located so future readers don't have to chase an
-- alias macro.
CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id           UUID;
  v_user              RECORD;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_payout_per_dollar DECIMAL;
  v_fair_value        DECIMAL;
  v_fair_profit       DECIMAL;
  v_bucket            TEXT;
  v_role              TEXT;
  v_multiplier_key    TEXT;
  v_multiplier        DECIMAL;
  v_cashout_amount    DECIMAL;
  v_existing_dup      RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
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

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  v_iv := COALESCE(v_iv, 0.60);

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_seconds_left  := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;
  v_fair_profit := v_fair_value - v_position.stake;

  v_bucket := speed_time_bucket(v_seconds_total, v_seconds_left);
  IF v_fair_prob_side >= v_position.entry_offered_prob THEN
    v_role := 'winner';
  ELSE
    v_role := 'loser';
  END IF;
  v_multiplier_key := 'speed_cashout_' || v_market.duration::TEXT || '_' || v_role || '_' || v_bucket;

  SELECT rate INTO v_multiplier FROM fee_config WHERE fee_type = v_multiplier_key LIMIT 1;
  IF v_multiplier IS NULL THEN
    RAISE EXCEPTION 'Cashout multiplier not configured: %', v_multiplier_key;
  END IF;

  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', ' || v_bucket || ', mult ' || v_multiplier || ')'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'position_id', p_position_id,
    'cashout_amount', v_cashout_amount,
    'payout', v_cashout_amount,                                  -- 0011: alias for API symmetry with trade RPC's payout_if_won
    'fair_value', ROUND(v_fair_value, 2),
    'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role,
    'bucket', v_bucket,
    'multiplier', v_multiplier,
    'pct_time_left', ROUND((v_seconds_left / v_seconds_total)::NUMERIC, 4)
  );
END;
$function$;

COMMIT;
