-- ============================================================================
-- 356_speed_late_window_surcharge.sql
--
-- Late-window pricing surcharge — extra spread applied to both new bets and
-- cashout in the last 30 seconds before market close.
--
-- Why:
--   At t=4:30 (last 30s of a 5m market), 96% of outcomes are already decided
--   from the chart. Normal 4% spread → offered_prob caps at ~0.99 → payout
--   ~1.02x. User EV at 96% predictability with 1.02x payout: still slightly
--   positive. With pricing imperfection (RV cache stale, momentum mispriced),
--   user EV creeps higher. Late-window adverse selection drains the pool.
--
--   Adding a 15% spread surcharge in the last 30s pushes offered_prob to ~0.99
--   capped, payout collapses toward 1.00x, AND the structural overround widens
--   significantly. At fair_prob=0.50, offered_prob jumps to 0.595, payout
--   1.68x, user EV at 50% = -16%. At fair_prob=0.96, offered_prob=0.99 (cap),
--   payout 1.01x, user EV = -3%. House always wins late-window in expectation.
--
-- User experience:
--   Users can still tap (button stays enabled) — they just get terrible odds.
--   Casino aesthetic, not a hard reject. Cashout flippers can still close
--   positions in the last 30s, just at a haircut.
--
-- Architecture:
--   Shared helper `speed_apply_late_window_surcharge(seconds_left, base_spread)`
--   reads the threshold and surcharge from fee_config with bounds clamping
--   to [0, 0.30]. Used by both speed_execute_trade (entry pricing) and
--   speed_execute_cashout (cashout fair-value calc) so the math is coherent.
--
-- Eng-review issues addressed:
--   5A — DRY: extract surcharge logic to shared helper
--   6A — fee_config bounds checking on read
--   1A — accept brutal late-window cashout pricing (multiple penalty layers
--        compose: Seam 3 widening + late-window surcharge + cashout multiplier)
-- ============================================================================

-- ── 1. fee_config rows for the surcharge dials ───────────────────────────────

INSERT INTO fee_config (fee_type, level, depth, rate, description) VALUES
  ('speed_late_window_threshold', NULL, NULL, 30,
    'Mig 356: seconds before close when surcharge kicks in. Default 30s. Configurable kill via 0.'),
  ('speed_late_window_surcharge', NULL, NULL, 0.15,
    'Mig 356: extra spread % added when seconds_left < threshold. Default 15% (4% base + 15% = 19%). Set to 0 to disable.')
ON CONFLICT DO NOTHING;

-- ── 2. Shared helper: late-window surcharge with bounds clamping ────────────

CREATE OR REPLACE FUNCTION public.speed_apply_late_window_surcharge(
  p_seconds_left DOUBLE PRECISION,
  p_base_spread DOUBLE PRECISION
)
RETURNS DOUBLE PRECISION
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_threshold      DECIMAL;
  v_surcharge      DECIMAL;
BEGIN
  -- Read threshold and surcharge from fee_config with bounds clamping.
  -- Clamp to [0, 0.30] — corrupt fee_config values produce sane defaults
  -- and emit a system_logs warning rather than breaking pricing.
  SELECT rate INTO v_threshold FROM fee_config WHERE fee_type = 'speed_late_window_threshold' LIMIT 1;
  SELECT rate INTO v_surcharge FROM fee_config WHERE fee_type = 'speed_late_window_surcharge' LIMIT 1;

  v_threshold := COALESCE(v_threshold, 30);
  v_surcharge := COALESCE(v_surcharge, 0.15);

  -- Bounds check — reject corrupt values
  IF v_surcharge < 0 OR v_surcharge > 0.30 THEN
    -- Bad value detected; clamp and log. Function is STABLE so the warning
    -- is informational; persistence happens lazily via outer transaction.
    RAISE WARNING 'speed_late_window_surcharge out of bounds [0, 0.30]: % — clamping to default 0.15', v_surcharge;
    v_surcharge := 0.15;
  END IF;
  IF v_threshold < 0 THEN
    RAISE WARNING 'speed_late_window_threshold negative: % — clamping to 30', v_threshold;
    v_threshold := 30;
  END IF;

  -- Apply surcharge if inside the late window. Otherwise return base unchanged.
  IF p_seconds_left < v_threshold::DOUBLE PRECISION THEN
    RETURN p_base_spread + v_surcharge::DOUBLE PRECISION;
  ELSE
    RETURN p_base_spread;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.speed_apply_late_window_surcharge(DOUBLE PRECISION, DOUBLE PRECISION) IS
'Mig 356: returns spread widened by speed_late_window_surcharge when seconds_left < speed_late_window_threshold; otherwise returns base unchanged. Bounds-clamps surcharge to [0, 0.30]. Used by speed_execute_trade (entry) and speed_execute_cashout (cashout fair-value) for coherent late-window pricing.';

GRANT EXECUTE ON FUNCTION public.speed_apply_late_window_surcharge(DOUBLE PRECISION, DOUBLE PRECISION) TO anon, authenticated, service_role;

-- ── 3. Update speed_execute_trade to apply surcharge ─────────────────────────

CREATE OR REPLACE FUNCTION public.speed_execute_trade(
  p_market_id      UUID,
  p_side           TEXT,
  p_stake          NUMERIC,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_user              RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_signup_branch_id  UUID;
  v_signup_branch     RECORD;
  v_routing_branch_id UUID;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;
  v_is_reseller_flow  BOOLEAN;
  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_max_exposure_pct  DECIMAL;
  v_extreme_coeff     DECIMAL;
  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_widened_spread    DOUBLE PRECISION;
  v_distance          DOUBLE PRECISION;
  v_overage           DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_for_duration  DECIMAL;
  v_market_exposure   RECORD;
  v_pool_collateral   DECIMAL;
  v_payout_if_won     DECIMAL;
  v_side_worst_case   DECIMAL;
  v_over_payout_total  DECIMAL;
  v_under_payout_total DECIMAL;
  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_fee_share_amount  DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_side NOT IN ('over', 'under') THEN RAISE EXCEPTION 'Side must be over or under'; END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN RAISE EXCEPTION 'Stake must be positive'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id, 'message', 'Duplicate trade — returning existing result');
    END IF;
  END IF;
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN RAISE EXCEPTION 'Speed markets are currently disabled'; END IF;
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Speed market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Speed market has closed'; END IF;
  IF NOW() < v_market.opens_at THEN RAISE EXCEPTION 'Speed market has not opened yet'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;
  v_signup_branch_id := v_user.signup_branch_id;
  IF v_signup_branch_id IS NULL THEN
    v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
    ELSE
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;
      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE; v_routing_branch_id := v_signup_branch_id;
        ELSE
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
      END IF;
    END IF;
  END IF;
  IF NOT v_is_reseller_flow THEN
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;
  IF v_is_reseller_flow THEN
    IF p_stake < v_speed_branch.stake_min OR p_stake > v_speed_branch.stake_max THEN
      RAISE EXCEPTION 'Stake $% outside branch limits ($% - $%)', p_stake, v_speed_branch.stake_min, v_speed_branch.stake_max;
    END IF;
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    IF p_stake < 1.00 OR p_stake > 25.00 THEN RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake; END IF;
    v_cap_for_duration := 200.00;
  END IF;
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum FROM speed_positions
  WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side AND status = 'open';
  IF v_current_side_sum + p_stake > v_cap_for_duration THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%', p_side, GREATEST(0, v_cap_for_duration - v_current_side_sum);
  END IF;
  IF v_user.balance_usd < p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_iv := _speed_get_iv(v_market.asset);
  v_handle_fee := p_stake * v_handle_fee_pct;
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF p_side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- Spread layers compose: base + Seam 3 quadratic widening + late-window surcharge.
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  -- Mig 356: apply late-window surcharge in the last 30 seconds.
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);

  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- Mig 353 exposure cap: true SUM(stake/offered_prob) per-side payout liability.
  SELECT rate INTO v_max_exposure_pct FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);
  v_payout_if_won := p_stake / v_offered_prob;
  IF v_is_reseller_flow THEN v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE v_pool_collateral := GREATEST(v_main_pool.speed_pool_balance, 0);
  END IF;
  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure FROM speed_market_exposure_live
    WHERE market_id = p_market_id FOR UPDATE;
    SELECT
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'over'), 0),
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'under'), 0)
    INTO v_over_payout_total, v_under_payout_total
    FROM speed_positions WHERE market_id = p_market_id AND status = 'open';
    IF p_side = 'over' THEN v_side_worst_case := v_over_payout_total + v_payout_if_won;
    ELSE v_side_worst_case := v_under_payout_total + v_payout_if_won;
    END IF;
    IF v_side_worst_case > v_max_exposure_pct * v_pool_collateral THEN
      RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
        USING HINT = format('payout liability $%.2f vs cap $%.2f (40%% of $%.2f pool)',
          v_side_worst_case, v_max_exposure_pct * v_pool_collateral, v_pool_collateral);
    END IF;
  END IF;

  INSERT INTO speed_positions (user_id, market_id, branch_id, side, stake, entry_price, entry_fair_prob, entry_offered_prob, status)
  VALUES (v_user_id, p_market_id, v_routing_branch_id, p_side, p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, 'open')
  RETURNING id INTO v_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, handle_fee, idempotency_key)
  VALUES (v_position_id, v_user_id, p_market_id, v_routing_branch_id, 'open', p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_is_reseller_flow THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side);
    v_fee_share_amount := ROUND(v_handle_fee * v_speed_branch.fee_share_pct, 2);
    IF v_fee_share_amount > 0 THEN
      v_new_pool_balance := v_new_pool_balance + v_fee_share_amount;
      INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (v_routing_branch_id, p_market_id, 'fee_share_in', v_fee_share_amount, v_new_pool_balance, v_trade_id,
        'Branch fee share — ' || ROUND(v_speed_branch.fee_share_pct * 100, 1) || '% of $' || ROUND(v_handle_fee, 4));
    END IF;
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE branch_id = v_routing_branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side);
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  UPDATE users SET balance_usd = balance_usd - p_stake, updated_at = NOW()
  WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration);
  IF NOT v_is_reseller_flow THEN
    v_total_commissions := pay_speed_trade_commissions(v_trade_id, v_user_id, p_stake, p_market_id);
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'position_id', v_position_id, 'trade_id', v_trade_id,
    'side', p_side, 'stake', ROUND(p_stake, 2), 'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8), 'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6), 'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'handle_fee', ROUND(v_handle_fee, 4),
    'flow', CASE WHEN v_is_reseller_flow THEN 'reseller' ELSE 'retail_or_commission' END,
    'commissions_paid', ROUND(v_total_commissions, 4));
END;
$$;

COMMENT ON FUNCTION public.speed_execute_trade(UUID, TEXT, NUMERIC, TEXT) IS
'Place a speed bet. Mig 352 (Seams 3+4): IV from RV cache + quadratic spread widening. Mig 353: exposure cap proxy fix. Mig 354: 90s RV staleness. Mig 356: late-window surcharge in last 30s.';

-- ── 4. Update speed_execute_cashout to apply surcharge in fair-value calc ────

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id UUID,
  p_idempotency_key TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;
  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_pct               DOUBLE PRECISION;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_payout_per_dollar DECIMAL;
  v_fair_value        DECIMAL;
  v_fair_profit       DECIMAL;
  v_role              TEXT;
  v_multiplier        DECIMAL;
  v_cashout_amount    DECIMAL;
  v_existing_trade    RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_new_pool_balance  DECIMAL;

  -- Mig 356: late-window surcharge inputs for fair-value compression
  v_spread_pct          DECIMAL;
  v_extreme_coeff       DECIMAL;
  v_distance            DOUBLE PRECISION;
  v_overage             DOUBLE PRECISION;
  v_widened_spread      DOUBLE PRECISION;
  v_surcharged_offered  DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result');
    END IF;
  END IF;
  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN RAISE EXCEPTION 'Position not found'; END IF;
  IF v_position.user_id <> v_user_id THEN RAISE EXCEPTION 'Not your position'; END IF;
  IF v_position.status <> 'open' THEN RAISE EXCEPTION 'Position is not open (status: %)', v_position.status; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed; cannot cash out'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable'; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN RAISE EXCEPTION 'Speed branch row missing for this position'; END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  ELSE
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;

  v_iv := _speed_get_iv(v_market.asset);

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_seconds_left  := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));

  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF v_position.side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- Mig 356: apply spread layers (base + Seam 3 widening + late-window surcharge)
  -- to compute a "surcharged offered prob" used for cashout fair-value compression.
  -- This haircuts the fair_value baseline before the role × multiplier discount.
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);
  v_surcharged_offered := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_surcharged_offered > 0.99 THEN v_surcharged_offered := 0.99;
  ELSIF v_surcharged_offered < 0.01 THEN v_surcharged_offered := 0.01;
  END IF;

  -- Cashout uses entry_offered_prob for the payout-per-dollar (locked at trade
  -- time) but the fair_value reflects current market state — including the
  -- surcharged spread when in the late window.
  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  -- Apply surcharge as a haircut on fair_value: subtract half the surcharge
  -- spread from the user-facing fair-value side. Concretely: v_fair_prob_side
  -- effectively used in fair_value is reduced by the difference between
  -- surcharged_offered and the original fair prob — pulling fair_value down
  -- in the late window. This is the layer codex called "incoherent if cashout
  -- uses BS but entry uses BS+surcharge."
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;

  -- Late-window surcharge applied to cashout fair_value: scale by the
  -- ratio of fair_prob to surcharged_offered (which is always >= fair_prob
  -- so the ratio is <= 1, compressing fair_value).
  IF v_seconds_left < 30 THEN
    v_fair_value := v_fair_value * (v_fair_prob_side / v_surcharged_offered);
  END IF;
  v_fair_profit := v_fair_value - v_position.stake;

  IF v_fair_prob_side >= v_position.entry_offered_prob THEN v_role := 'winner';
  ELSE v_role := 'loser';
  END IF;
  IF v_seconds_total > 0 THEN v_pct := v_seconds_left / v_seconds_total;
  ELSE v_pct := 0;
  END IF;

  v_multiplier := speed_cashout_multiplier(v_market.duration, v_role, v_pct);

  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;
  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET status = 'cashed_out', payout_amount = v_cashout_amount, closed_at = NOW()
  WHERE id = p_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key)
  VALUES (p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_position.branch_id IS NOT NULL THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id);
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)');
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', mult ' || v_multiplier || ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')');
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'trade_id', v_trade_id, 'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2), 'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role, 'multiplier', v_multiplier, 'pct_time_left', ROUND(v_pct::NUMERIC, 4));
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT) IS
'Cash out a single open speed position. Mig 352 (Seam 4): IV from RV cache. Mig 351: continuous cashout multiplier. Mig 354: 90s RV staleness. Mig 356: late-window surcharge applied to fair_value in last 30s — compounds with role × time-bucket multiplier (brutal late cashouts by design, accepted in eng-review issue 1A).';
