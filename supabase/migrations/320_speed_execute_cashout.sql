-- ============================================================================
-- 320_speed_execute_cashout.sql
--
-- Cash out a single open position early (before market expiry).
--
-- Per-position cashout — caller passes a single position_id. UI is
-- expected to call this in a loop for "Cash Out All" behavior.
--
-- Asymmetric multiplier formula:
--   bucket = high (>60% time left) | mid (20-60%) | low (<20%)
--   role = winner if current_fair_prob_side >= entry_offered_prob, else loser
--   multiplier = fee_config['speed_cashout_<duration>_<role>_<bucket>']
--   For winner:  cashout = stake + (fair_value - stake) × multiplier
--   For loser:   cashout = fair_value × multiplier
--   where fair_value = current_fair_prob_side × (stake / entry_offered_prob)
--
-- Rejects if:
--   - Position not found / not yours / not 'open'
--   - Market not 'open' (cashout disabled during 'resolving'/'resolved'/'voided')
--   - Oracle stale
--   - Branch frozen (for reseller-flow positions)
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_execute_cashout(
  p_position_id     UUID,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_speed_branch      RECORD;

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

  v_existing_trade    RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_new_pool_balance  DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Idempotency check ──────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result'
      );
    END IF;
  END IF;

  -- ── Lock position + ownership check ───────────────────────────────────
  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not your position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  -- ── Lock market + status ──────────────────────────────────────────────
  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;

  -- ── Oracle freshness ───────────────────────────────────────────────────
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  -- ── Lock reseller speed_branches row (for pool balance update) ────────
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches
    WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN
      RAISE EXCEPTION 'Speed branch row missing for this position';
    END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  END IF;

  -- ── Compute current pricing ────────────────────────────────────────────
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

  -- Fair value of their position right now
  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;
  v_fair_profit := v_fair_value - v_position.stake;

  -- ── Determine bucket + role + look up multiplier ──────────────────────
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

  -- ── Cashout formula ────────────────────────────────────────────────────
  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;

  -- Floor at zero (no negative payout)
  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- ── ATOMIC WRITE BLOCK ─────────────────────────────────────────────────

  -- 1. Update position
  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  -- 2. INSERT speed_trades (cashout)
  INSERT INTO speed_trades (
    position_id, user_id, market_id, branch_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- 3. INSERT speed_pool_ledger (cashout_out)
  IF v_position.branch_id IS NOT NULL THEN
    -- Reseller pool pays
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id
    );
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    -- SOOQ main pool pays
    SELECT COALESCE(SUM(amount), 0) - v_cashout_amount INTO v_new_pool_balance
    FROM speed_pool_ledger WHERE branch_id IS NULL;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)'
    );
  END IF;

  -- 4. Credit user balance
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
    'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2),
    'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role,
    'bucket', v_bucket,
    'multiplier', v_multiplier,
    'pct_time_left', ROUND((v_seconds_left / v_seconds_total)::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION speed_execute_cashout(UUID, TEXT) IS
'Cash out a single open speed position. Asymmetric multiplier from fee_config based on duration × time-bucket × role. Atomic: position update + trade insert + pool ledger + balance credit.';
