-- 0031_schema_sync_caps_softguards.sql
--
-- Final migration in the pricing engine v2 series. Three things:
--
--   1. Soft guards replacing the daily wager cap (founder choice: "no
--      maximum trade limit daily"). The hard cap is dropped; in its
--      place are three softer defenses that don't restrict normal users
--      but do stop bots and exploit farmers:
--        a. Per-user velocity limiter — max bets/minute. Real human
--           gamblers max ~8/min on a 5m product; bots run 50+/min.
--        b. Per-user open-exposure monitor — max liability across all
--           open positions, as % of pool. Caps blast radius if a user
--           finds an exploit before we patch.
--        c. Per-user daily-handle alert — telemetry only, no enforcement.
--           Logs admin notification when crossed; founder can intervene
--           manually.
--
--   2. Column comment update on speed_trades.cashout_multiplier — that
--      slot now stores the applied margin (mig 0028 profit-based
--      formula) instead of the old decay multiplier. Drizzle schema.ts
--      sync happens in TypeScript (see commit alongside this migration).
--
--   3. Drop the per-user daily wager cap row from fee_config (replaced
--      by velocity + exposure + alert).

BEGIN;

-- ============================================================================
-- 1) Drop the per-user daily wager cap (founder choice)
-- ============================================================================
--
-- Mig 0028 left the read-and-skip-when-zero pattern in speed_execute_trade
-- so removing the row safely degrades to "no cap" behavior. This DELETE
-- closes the loop: the row is gone, the read returns NULL, the IF block
-- is bypassed.

DELETE FROM public.fee_config WHERE fee_type = 'speed_max_user_daily_wager';

-- ============================================================================
-- 2) Insert soft guard fee_config keys
-- ============================================================================

INSERT INTO public.fee_config (fee_type, rate, description) VALUES
  ('speed_per_user_velocity_max', 30,
    '0031: max bets per user per minute. Hard reject above. Real humans on 5m markets max ~8/min; bots run 50+/min. Tune up for VIP traders post-launch.'),
  ('speed_per_user_open_exposure_pct', 0.15,
    '0031: per-user max open-position liability as fraction of pool collateral. SUM(stake / entry_offered_prob) across all open positions for one user must stay below this. Caps blast radius from any single user.'),
  ('speed_per_user_daily_handle_alert', 5000,
    '0031: per-user daily handle threshold for admin alert. Telemetry only — no enforcement. Logged when crossed; founder intervenes manually if pattern looks suspicious.')
ON CONFLICT (fee_type) DO UPDATE
  SET description = EXCLUDED.description,
      updated_at = NOW();

-- ============================================================================
-- 3) Update column comment on speed_trades.cashout_multiplier
-- ============================================================================
--
-- Slot was the decay multiplier (mig 0010 / 0016). Mig 0028 changed
-- semantics: now stores the applied margin (option C profit-based).
-- Schema.ts in TS layer keeps the column name `cashoutMultiplier` for
-- backwards-compat with existing dashboards/queries; comment clarifies
-- the new meaning.

COMMENT ON COLUMN public.speed_trades.cashout_multiplier IS
  '0028+: applied cashout margin (profit-based, option C). Reading: for kind=cashout, this is the m in cashout = stake + profit*(1-m) for winning side or stake + profit*(1+m) for losing side. Pre-0028 trades stored the decay multiplier; semantics differ. Use trade created_at to disambiguate.';

-- ============================================================================
-- 4) speed_execute_trade — add velocity + open-exposure soft guards
-- ============================================================================
--
-- Body diff vs mig 0030:
--   * Add velocity check: SELECT COUNT(*) FROM speed_trades WHERE
--     user_id = v_user_id AND kind = 'open' AND created_at > NOW() -
--     INTERVAL '1 minute'. Reject if >= max.
--   * Add open-exposure check: SUM(stake / entry_offered_prob) across
--     user's open positions + new payout_if_won must stay below
--     pool * speed_per_user_open_exposure_pct.
--   * Add daily-handle telemetry: if SUM(stake) for user today > alert
--     threshold AND not yet alerted today, INSERT into a new alert log
--     table. (Alert table created below.)

CREATE TABLE IF NOT EXISTS public.speed_user_alerts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  alert_type   TEXT NOT NULL,
  alert_date   DATE NOT NULL,
  threshold    DECIMAL(18,2),
  observed     DECIMAL(18,2),
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT speed_user_alerts_type_chk
    CHECK (alert_type IN ('daily_handle','velocity_breach','open_exposure_breach'))
);

CREATE UNIQUE INDEX IF NOT EXISTS speed_user_alerts_daily_handle_unique
  ON public.speed_user_alerts (user_id, alert_type, alert_date)
  WHERE alert_type = 'daily_handle';

CREATE INDEX IF NOT EXISTS speed_user_alerts_recent_idx
  ON public.speed_user_alerts (created_at DESC);

COMMENT ON TABLE public.speed_user_alerts IS
  '0031: per-user behavioral alerts. daily_handle is one row/user/day (unique constraint); velocity_breach and open_exposure_breach are append-only audit log. Read by /admin/fees alert feed tile.';

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id                    UUID,
  p_side                         TEXT,
  p_stake                        NUMERIC,
  p_idempotency_key              TEXT    DEFAULT NULL,
  p_expected_iv                  DECIMAL DEFAULT NULL,
  p_expected_spot                DECIMAL DEFAULT NULL,
  p_expected_seconds_left_bucket INTEGER DEFAULT NULL,
  p_expected_fair_prob           DECIMAL DEFAULT NULL,
  p_expected_offered_prob        DECIMAL DEFAULT NULL
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

  v_velocity_max       DECIMAL;
  v_velocity_count     INTEGER;
  v_user_exposure_pct  DECIMAL;
  v_user_exposure_sum  DECIMAL;
  v_daily_alert_thresh DECIMAL;
  v_user_today_handle  DECIMAL;

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
  v_seconds_left_bucket INTEGER;
  v_payout_if_won      DECIMAL;

  v_user_market_sum    DECIMAL;
  v_user_daily_sum     DECIMAL;
  v_side_payout_sum    DECIMAL;
  v_cluster_payout_sum DECIMAL;
  v_strike_lo          DECIMAL;
  v_strike_hi          DECIMAL;

  v_parity_prob_tol    DECIMAL;
  v_parity_spot_tol    DECIMAL;

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

  -- 0031: per-user velocity limiter (replaces the daily wager cap as
  -- the bot defense). Reject if user has placed >= max bets in last
  -- 60s. Real human gamblers max ~8/min on 5m markets.
  SELECT rate INTO v_velocity_max FROM fee_config WHERE fee_type = 'speed_per_user_velocity_max';
  v_velocity_max := COALESCE(v_velocity_max, 30);
  SELECT COUNT(*) INTO v_velocity_count
  FROM speed_trades
  WHERE user_id = v_user_id
    AND kind = 'open'
    AND created_at > NOW() - INTERVAL '1 minute';
  IF v_velocity_count >= v_velocity_max THEN
    -- Codex review: the prior draft had `INSERT INTO speed_user_alerts ...`
    -- here, but the RAISE EXCEPTION below aborts the transaction, so the
    -- INSERT rolled back and never persisted. Velocity-breach telemetry
    -- needs an out-of-transaction logging path (separate connection,
    -- pg_notify, or autonomous transaction). Deferred to a follow-up
    -- migration. For now, the breach surfaces in user-visible error logs
    -- (Sentry catches the RAISE) but no row in speed_user_alerts.
    RAISE EXCEPTION 'Slow down — too many bets per minute (% of % allowed)', v_velocity_count, v_velocity_max
      USING HINT = 'Wait a moment and try again';
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

  SELECT rate INTO v_parity_spot_tol FROM fee_config WHERE fee_type = 'speed_parity_spot_drift_pct';
  v_parity_spot_tol := COALESCE(v_parity_spot_tol, 0.001);
  PERFORM _speed_assert_parity('spot_price', p_expected_spot, v_oracle.price, v_parity_spot_tol);

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_late_window_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no new bets in last %s seconds', v_late_reject_s;
  END IF;

  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND v_seconds_left_bucket <> p_expected_seconds_left_bucket THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Market regime changed between quote and execute — refresh quote';
  END IF;

  v_stake_max := _speed_get_stake_max(v_market.duration);
  IF p_stake < v_stake_min OR p_stake > v_stake_max THEN
    RAISE EXCEPTION 'Stake $% outside allowed range ($% - $%)', p_stake, v_stake_min, v_stake_max;
  END IF;

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

  -- 0031: per-user daily wager cap REMOVED. The read-and-skip pattern
  -- from mig 0028/0029/0030 is unchanged — fee_config no longer has the
  -- row, so the read returns NULL, the cap check is bypassed.
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

  SELECT circuit_tripped_at INTO v_circuit_tripped
  FROM speed_daily_ngr WHERE ngr_date = _speed_utc_today();
  IF v_circuit_tripped IS NOT NULL THEN
    RAISE EXCEPTION 'Daily limit reached, try again tomorrow';
  END IF;

  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── PRICING ─────────────────────────────────────────────────────────
  SELECT rate INTO v_spread_pct    FROM fee_config WHERE fee_type = 'speed_spread_pct';
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff';
  v_spread_pct    := COALESCE(v_spread_pct, 0.05);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);

  v_iv := _speed_get_iv(v_market.asset, v_market.duration);

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

  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('fair_prob', p_expected_fair_prob, v_fair_prob_side, v_parity_prob_tol);

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

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Trade rejected: too late and too one-sided (fair_prob=%, secs_left=%)',
        ROUND(v_fair_prob_side, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Place this bet earlier in the market';
    END IF;
  END IF;

  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION
                    + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;

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
  IF v_offered_prob < 0.01 THEN v_offered_prob := 0.01; END IF;
  IF v_offered_prob > 0.99 THEN
    RAISE EXCEPTION 'Trade rejected: pricing saturated (offered_prob=% would exceed 0.99 cap)', ROUND(v_offered_prob, 4)
      USING HINT = 'Wait for the market to move or try the other side';
  END IF;

  PERFORM _speed_assert_parity('offered_prob', p_expected_offered_prob, v_offered_prob, v_parity_prob_tol);

  SELECT rate INTO v_pool_collateral FROM fee_config WHERE fee_type = 'speed_pool_collateral_usd';
  v_pool_collateral := COALESCE(v_pool_collateral, 10000);
  SELECT rate INTO v_max_side_pct  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct';
  v_max_side_pct := COALESCE(v_max_side_pct, 0.25);

  v_payout_if_won := p_stake / v_offered_prob;

  -- 0031: per-user open-exposure soft guard. Sum of liability across
  -- ALL of this user's open positions (any market, any side) must stay
  -- below pool * speed_per_user_open_exposure_pct.
  SELECT rate INTO v_user_exposure_pct FROM fee_config WHERE fee_type = 'speed_per_user_open_exposure_pct';
  v_user_exposure_pct := COALESCE(v_user_exposure_pct, 0.15);
  SELECT COALESCE(SUM(stake / entry_offered_prob), 0) INTO v_user_exposure_sum
  FROM speed_positions
  WHERE user_id = v_user_id AND status = 'open';
  IF v_user_exposure_sum + v_payout_if_won > v_user_exposure_pct * v_pool_collateral THEN
    -- See velocity_breach comment above: INSERT here would roll back when
    -- the RAISE aborts the transaction. Deferred to follow-up migration.
    RAISE EXCEPTION 'Per-user open-exposure cap reached: $%.2f vs $%.2f cap (% of $% pool)',
      v_user_exposure_sum + v_payout_if_won,
      v_user_exposure_pct * v_pool_collateral,
      v_user_exposure_pct * 100, v_pool_collateral
      USING HINT = 'Wait for some open positions to settle';
  END IF;

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

  -- 0031: daily-handle telemetry alert (no enforcement). Once-per-day
  -- per-user; unique constraint + ON CONFLICT DO NOTHING dedupes.
  SELECT rate INTO v_daily_alert_thresh FROM fee_config WHERE fee_type = 'speed_per_user_daily_handle_alert';
  v_daily_alert_thresh := COALESCE(v_daily_alert_thresh, 5000);
  IF v_daily_alert_thresh > 0 THEN
    SELECT COALESCE(SUM(stake), 0) INTO v_user_today_handle
    FROM speed_positions
    WHERE user_id = v_user_id
      AND created_at >= _speed_utc_midnight()
      AND status IN ('open','won','lost','cashed_out','refunded');
    IF v_user_today_handle >= v_daily_alert_thresh THEN
      INSERT INTO speed_user_alerts (user_id, alert_type, alert_date, threshold, observed, metadata)
      VALUES (v_user_id, 'daily_handle', _speed_utc_today(),
              v_daily_alert_thresh, v_user_today_handle,
              jsonb_build_object('triggered_on_trade', v_trade_id))
      ON CONFLICT (user_id, alert_type, alert_date) WHERE alert_type = 'daily_handle' DO NOTHING;
    END IF;
  END IF;

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
    'spread_mult', ROUND(v_spread_mult::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) IS
  '0031: pricing engine v2 final. Adds per-user velocity limiter + open-exposure soft guard + daily-handle telemetry. Daily wager cap dropped (founder choice).';

GRANT EXECUTE ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, DECIMAL) TO PUBLIC;

COMMIT;
