-- 0022_cashout_kill_switch.sql
--
-- Operational kill switch for speed_execute_cashout. Lets ops halt cashout
-- quoting during oracle instability, settlement lag, pool stress, or
-- detected bot activity, without taking the whole product down.
--
-- The flag lives in `fee_config` so flipping it is a single SQL UPDATE —
-- no admin UI, no migration, no code deploy. Recovery during an incident
-- can't depend on something that needs a build.
--
-- Operational use:
--   -- Halt all cashouts:
--   UPDATE fee_config SET rate = 0 WHERE fee_type = 'speed_cashout_enabled';
--   -- Resume:
--   UPDATE fee_config SET rate = 1 WHERE fee_type = 'speed_cashout_enabled';
--
-- The `/api/health/audit` endpoint reports the flag state so monitoring
-- can confirm cashout is up.
--
-- All cashout math from mig 0016 § 5 stays untouched. The only change is
-- the kill-switch check inserted right after auth.

BEGIN;

-- 1) Add the flag (default 1 = enabled).
INSERT INTO fee_config (fee_type, rate, description) VALUES
  ('speed_cashout_enabled', 1.00,
    '0022: kill switch. 1 = cashouts allowed, 0 = halted. Flip via UPDATE during incidents.')
ON CONFLICT (fee_type) DO UPDATE
  SET description = EXCLUDED.description, updated_at = NOW();

-- 2) Recreate speed_execute_cashout with the kill-switch check at the top.
--    Body is identical to mig 0016 § 5 except for the new IF block at L24-30.

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
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_market_id         UUID;
  v_oracle            RECORD;

  v_kill_switch       DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_drift_tolerance   DECIMAL;
  v_iv_to_use         DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_pct               DOUBLE PRECISION;

  v_fair_prob_over    DECIMAL;
  v_mark_prob         DECIMAL;
  v_decay             DECIMAL;
  v_liq               DECIMAL;
  v_cashout_amount    DECIMAL;

  v_existing_dup      RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 0022: kill switch. Defaults to 1 (enabled) if the row is missing.
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

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  IF v_seconds_left < 5 THEN
    RAISE EXCEPTION 'Market closing — no cashouts in last 5 seconds';
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

  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  v_iv := COALESCE(v_iv, 0.60);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
    v_iv_to_use := p_expected_iv;
  ELSE
    v_iv_to_use := v_iv;
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_pct := CASE WHEN v_seconds_total > 0 THEN v_seconds_left / v_seconds_total ELSE 0 END;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv_to_use
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
  END IF;

  v_decay := speed_cashout_multiplier(v_market.duration, v_pct);
  v_liq   := speed_liq_discount(v_seconds_left);

  v_cashout_amount := v_position.stake
                    * (v_mark_prob / v_position.entry_offered_prob)
                    * v_decay
                    * v_liq;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier,
    iv_used, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_mark_prob, v_position.entry_offered_prob, v_decay,
    v_iv_to_use, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id
    RETURNING balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (decay ' || v_decay || ', liq ' || v_liq ||
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
    'decay', ROUND(v_decay, 4),
    'liq_discount', ROUND(v_liq, 4),
    'iv_used', ROUND(v_iv_to_use, 6),
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) IS
  '0022: same body as mig 0016 § 5 plus a kill-switch check (fee_config.speed_cashout_enabled) at the top. Flip the row to 0 to halt cashouts during incidents.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL) TO PUBLIC;

COMMIT;
