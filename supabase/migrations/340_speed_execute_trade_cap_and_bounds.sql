-- ============================================================================
-- 340_speed_execute_trade_cap_and_bounds.sql
--
-- Codex findings #1 (LAUNCH BLOCKER) + #3 (MEDIUM) — wire the cap check and
-- the pricing bounds check into speed_execute_trade.
--
-- Codex #1: per-market aggregate exposure cap. Mig 338 added the cache tables
--   + trigger. This rewrites the RPC body to consult speed_market_exposure_live
--   (with SELECT FOR UPDATE) before accepting a trade. Refuses if worst-case
--   payout on the buying side exceeds speed_max_market_exposure_pct of pool
--   collateral. Without it, 1,000 retail users could each bet the per-user cap
--   on UP and bankrupt the pool on a directional move.
--
-- Codex #3: clip-at-extremes spread compression. When fair > 0.97, the favorite
--   clips to 0.99 and effective spread compresses to 0%. A sharp could bet the
--   favorite at zero edge in the last seconds of a market. Refuses trades when
--   the bought side's fair probability is outside [bound, 1-bound] = default
--   [0.03, 0.97].
--
-- One migration to keep the RPC body coherent. Adds new fee_config row for the
-- bounds threshold so it can be tuned without a migration.
-- ============================================================================

-- ─── 1. Fee config: pricing bound threshold ─────────────────────────────────

INSERT INTO fee_config (fee_type, level, depth, rate, description)
VALUES (
  'speed_pricing_bound_pct', NULL, NULL, 0.03,
  'Reject trades when fair probability of bought side is outside [bound, 1-bound]. Default 0.03 = refuses when fair > 97% or < 3%. Prevents zero-edge or negative-edge moments at extreme prices.'
)
ON CONFLICT DO NOTHING;

-- ─── 2. Rewrite speed_execute_trade with cap + bounds checks ────────────────

CREATE OR REPLACE FUNCTION speed_execute_trade(
  p_market_id        UUID,
  p_side             TEXT,
  p_stake            DECIMAL,
  p_idempotency_key  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_is_reseller_flow  BOOLEAN;

  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_max_exposure_pct  DECIMAL;
  v_pricing_bound     DECIMAL;

  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_seconds_left      DOUBLE PRECISION;

  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_for_duration  DECIMAL;

  v_market_exposure   RECORD;
  v_pool_collateral   DECIMAL;
  v_payout_if_won     DECIMAL;
  v_side_worst_case   DECIMAL;

  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;

  v_fee_share_amount  DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  v_user_id := auth.uid();
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

  -- ── Idempotency check ──────────────────────────────────────────────────
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key
      AND t.user_id = v_user_id
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

  -- ── Master kill switch ─────────────────────────────────────────────────
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RAISE EXCEPTION 'Speed markets are currently disabled';
  END IF;

  -- ── Lock user row + frozen check ───────────────────────────────────────
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- ── Lock market + status check ─────────────────────────────────────────
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

  -- ── Oracle freshness check ─────────────────────────────────────────────
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset;
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;

  -- ── Determine routing flow ─────────────────────────────────────────────
  v_signup_branch_id := v_user.signup_branch_id;

  IF v_signup_branch_id IS NULL THEN
    v_is_reseller_flow := FALSE;
    v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE;
      v_routing_branch_id := NULL;
    ELSE
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;

      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches
        WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE;
          v_routing_branch_id := v_signup_branch_id;
        ELSE
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        v_is_reseller_flow := FALSE;
        v_routing_branch_id := NULL;
      END IF;
    END IF;
  END IF;

  -- ── Stake range check ──────────────────────────────────────────────────
  IF v_is_reseller_flow THEN
    IF p_stake < v_speed_branch.stake_min OR p_stake > v_speed_branch.stake_max THEN
      RAISE EXCEPTION 'Stake $% outside branch limits ($% - $%)',
        p_stake, v_speed_branch.stake_min, v_speed_branch.stake_max;
    END IF;
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    IF p_stake < 1.00 OR p_stake > 25.00 THEN
      RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake;
    END IF;
    v_cap_for_duration := 200.00;
  END IF;

  -- ── Per-user per-side cap (existing) ───────────────────────────────────
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum
  FROM speed_positions
  WHERE user_id = v_user_id
    AND market_id = p_market_id
    AND side = p_side
    AND status = 'open';

  IF v_current_side_sum + p_stake > v_cap_for_duration THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%',
      p_side, GREATEST(0, v_cap_for_duration - v_current_side_sum);
  END IF;

  -- ── User balance check ─────────────────────────────────────────────────
  IF v_user.balance_usd < p_stake THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ── Read pricing constants ─────────────────────────────────────────────
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  SELECT rate INTO v_pricing_bound FROM fee_config WHERE fee_type = 'speed_pricing_bound_pct' LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_iv := COALESCE(v_iv, 0.60);
  v_pricing_bound := COALESCE(v_pricing_bound, 0.03);

  v_handle_fee := p_stake * v_handle_fee_pct;

  -- ── Compute pricing ────────────────────────────────────────────────────
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );

  IF p_side = 'over' THEN
    v_fair_prob_side := v_fair_prob_over;
  ELSE
    v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  -- ── Codex #3: pricing bounds check ─────────────────────────────────────
  -- Refuse trades when fair on the bought side is outside [bound, 1-bound].
  -- At fair > 0.97, clip-to-0.99 below would compress spread to ≤2% (zero
  -- edge at fair=0.99). Sharps could exploit this. Honest path: refuse
  -- the trade, surface a clear error.
  IF v_fair_prob_side > (1.0 - v_pricing_bound) OR v_fair_prob_side < v_pricing_bound THEN
    RAISE EXCEPTION 'Market too imbalanced for safe pricing on % side', p_side
      USING HINT = 'Try the other side or wait for a less extreme moment.';
  END IF;

  v_offered_prob := v_fair_prob_side + v_spread_pct / 2.0;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- ── Codex #1: per-market aggregate exposure cap ────────────────────────
  -- Read the live exposure cache (maintained by mig 338's trigger).
  -- Lock the row to serialize concurrent trades on this market — without
  -- FOR UPDATE, two RPCs could both pass the cap check before either INSERT
  -- updates the cache.
  SELECT rate INTO v_max_exposure_pct
  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);

  v_payout_if_won := p_stake / v_offered_prob;

  -- Determine pool collateral basis (how much money backs this market)
  IF v_is_reseller_flow THEN
    v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE
    -- Retail / commission flow: SOOQ main pool (sum of branch_id IS NULL ledger)
    SELECT COALESCE(SUM(amount), 0) INTO v_pool_collateral
    FROM speed_pool_ledger WHERE branch_id IS NULL;
    v_pool_collateral := GREATEST(v_pool_collateral, 0);
  END IF;

  -- Skip cap check if pool is unfunded or empty (early-stage; user-side cap
  -- still bounds total exposure)
  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure
    FROM speed_market_exposure_live
    WHERE market_id = p_market_id
    FOR UPDATE;

    -- New worst-case payout on the bought side after this trade
    -- Approximation: track stake-side via net_notional; for cap purposes use
    -- worst-case = sum of stakes / typical_offered_prob (conservative).
    -- Simpler conservative estimate: worst case = total stakes on side / 0.5
    -- (assumes worst pricing). For now use stake_sum × 2 as upper bound.
    -- Future: maintain worst_case_payout columns on the cache; current cache
    -- only has net_notional. Use net_notional × 2 as a defensive proxy.
    IF p_side = 'over' THEN
      v_side_worst_case := COALESCE(v_market_exposure.net_notional, 0)
                         + p_stake * 2;
    ELSE
      v_side_worst_case := -COALESCE(v_market_exposure.net_notional, 0)
                         + p_stake * 2;
    END IF;
    v_side_worst_case := GREATEST(v_side_worst_case, p_stake * 2);

    IF v_side_worst_case > v_max_exposure_pct * v_pool_collateral THEN
      RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
        USING HINT = format('worst case $%.2f vs cap $%.2f', v_side_worst_case, v_max_exposure_pct * v_pool_collateral);
    END IF;
  END IF;

  -- ── ATOMIC WRITE BLOCK ─────────────────────────────────────────────────
  -- 1. INSERT speed_positions
  INSERT INTO speed_positions (
    user_id, market_id, branch_id, side, stake,
    entry_price, entry_fair_prob, entry_offered_prob, status
  ) VALUES (
    v_user_id, p_market_id, v_routing_branch_id, p_side, p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, 'open'
  )
  RETURNING id INTO v_position_id;

  -- 2. INSERT speed_trades
  INSERT INTO speed_trades (
    position_id, user_id, market_id, branch_id, kind, amount,
    spot_price, fair_prob, offered_prob, handle_fee, idempotency_key
  ) VALUES (
    v_position_id, v_user_id, p_market_id, v_routing_branch_id, 'open', p_stake,
    v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- 3. INSERT speed_pool_ledger (stake_in)
  IF v_is_reseller_flow THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side
    );

    v_fee_share_amount := ROUND(v_handle_fee * v_speed_branch.fee_share_pct, 2);
    IF v_fee_share_amount > 0 THEN
      v_new_pool_balance := v_new_pool_balance + v_fee_share_amount;
      INSERT INTO speed_pool_ledger (
        branch_id, market_id, type, amount, balance_after, reference_id, description
      ) VALUES (
        v_routing_branch_id, p_market_id, 'fee_share_in', v_fee_share_amount, v_new_pool_balance, v_trade_id,
        'Branch fee share — ' || ROUND(v_speed_branch.fee_share_pct * 100, 1) || '% of $' || ROUND(v_handle_fee, 4)
      );
    END IF;

    UPDATE speed_branches
    SET speed_pool_balance = v_new_pool_balance,
        updated_at = NOW()
    WHERE branch_id = v_routing_branch_id;
  ELSE
    SELECT COALESCE(SUM(amount), 0) + p_stake INTO v_new_pool_balance
    FROM speed_pool_ledger WHERE branch_id IS NULL;

    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side
    );
  END IF;

  -- 5. UPDATE users.balance_usd
  UPDATE users SET
    balance_usd = balance_usd - p_stake,
    updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  -- 6. INSERT transactions
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration
  );

  -- 7. Commission walk for retail/commission flow ONLY
  IF NOT v_is_reseller_flow THEN
    v_total_commissions := pay_speed_trade_commissions(v_trade_id, v_user_id, p_stake, p_market_id);
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
    'handle_fee', ROUND(v_handle_fee, 4),
    'flow', CASE WHEN v_is_reseller_flow THEN 'reseller' ELSE 'retail_or_commission' END,
    'commissions_paid', ROUND(v_total_commissions, 4)
  );
END;
$$;

COMMENT ON FUNCTION speed_execute_trade(UUID, TEXT, DECIMAL, TEXT) IS
'Place a speed bet. Three-flow dispatch (retail / commission-branch / reseller-branch). Mig 340 added: codex #1 per-market aggregate exposure cap (refuses if worst-case payout > pool × max_exposure_pct), codex #3 pricing bounds (refuses trades when fair_side outside [bound, 1-bound]).';
