-- 0009_speed_trade_enum_fix.sql
--
-- W9 fixes for speed_execute_trade caught by scripts/w9-trade-suite.mjs:
--
--  1. The `side` column in speed_positions is the `speed_side` enum; the
--     RPC parameter `p_side` is text. Two sites in speed_execute_trade
--     forgot the cast:
--       a) `AND side = p_side` in the per-side cap query — PG refuses
--          with "operator does not exist: speed_side = text"
--       b) `INSERT INTO speed_positions (..., side, ...) VALUES (..., p_side, ...)` —
--          PG refuses with "column \"side\" is of type speed_side but
--          expression is of type text"
--     Latent since W3; nobody noticed because zero trades had been placed
--     end-to-end on RDS yet (`SELECT count(*) FROM speed_positions` = 0
--     at 2026-05-03 12:00 UTC).
--     Fix: cast the parameter — `p_side::speed_side` at both sites.
--     Keeps the index on (user_id, market_id, side, status) usable.
--
--  2. The trade RPC reads `speed_handle_fee_pct` and `speed_spread_pct`
--     from `fee_config` (with COALESCE 0.01 / 0.04 fallback). The 0004
--     seed only added `speed_markets_enabled` + `speed_oracle_stale_seconds`,
--     and 0007 added `speed_iv_btc`. Add the two missing rows so the values
--     are explicit and visible to admin SELECTs — matches the COALESCE
--     fallback so behavior is unchanged. Per the master plan's locked
--     decision, fee values are hardcoded at the function level for v1; the
--     fee_config rows mirror the hardcodes to keep the read path honest.

BEGIN;

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id uuid,
  p_side text,
  p_stake numeric,
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
  v_market            RECORD;
  v_oracle            RECORD;

  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;

  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_seconds_left      DOUBLE PRECISION;

  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_per_side      DECIMAL := 200.00;     -- hardcoded retail cap
  v_stake_min         DECIMAL := 1.00;
  v_stake_max         DECIMAL := 25.00;

  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_side NOT IN ('over', 'under') THEN
    RAISE EXCEPTION 'Side must be over or under';
  END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN
    RAISE EXCEPTION 'Stake must be positive';
  END IF;

  -- Idempotency
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

  -- Master kill switch
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  -- Lock user
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- Lock market
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

  -- Oracle freshness
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  -- Stake range (retail hardcoded)
  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)',
      p_stake, v_stake_min, v_stake_max;
  END IF;

  -- Per-side cap. The `side` column is `speed_side` enum; cast the text
  -- parameter so PG can compare against the enum (bug fix in 0009).
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side::speed_side
    AND status = 'open';
  IF v_current_side_sum + p_stake > v_cap_per_side THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_per_side - v_current_side_sum);
  END IF;

  -- Balance check
  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Pricing
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct     FROM fee_config WHERE fee_type = 'speed_spread_pct'     LIMIT 1;
  SELECT rate INTO v_iv             FROM fee_config WHERE fee_type = 'speed_iv_btc'         LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct     := COALESCE(v_spread_pct, 0.04);
  v_iv             := COALESCE(v_iv, 0.60);

  v_handle_fee := p_stake * v_handle_fee_pct;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  v_offered_prob := v_fair_prob_side + v_spread_pct / 2.0;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- Atomic write block. Cast p_side to speed_side enum (bug fix in 0009).
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
    spot_price, fair_prob, offered_prob, handle_fee, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key
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
    'handle_fee', ROUND(v_handle_fee, 4)
  );
END;
$function$;

-- Seed the missing fee_config rows. Values mirror the COALESCE fallbacks
-- in the RPC body so admin reads return the exact effective rate.
INSERT INTO fee_config (fee_type, rate, description)
VALUES
  ('speed_handle_fee_pct', 0.01, 'Per-stake handle fee (1%) charged at trade open. Mirror of the hardcoded fallback in speed_execute_trade.'),
  ('speed_spread_pct', 0.04, 'AMM spread (4%) added to the fair Black-Scholes prob. Mirror of the hardcoded fallback in speed_execute_trade.')
ON CONFLICT (fee_type) DO NOTHING;

COMMIT;
