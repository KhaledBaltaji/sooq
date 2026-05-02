-- ============================================================================
-- 319_speed_execute_trade.sql
--
-- The "place a speed bet" RPC. Three-flow dispatch based on user's signup
-- branch and that branch's book_type:
--   - Retail user (no signup_branch) OR commission-branch user:
--     speed_position.branch_id = NULL, variance to SOOQ main pool,
--     commission walk runs.
--   - Reseller-branch user (with active speed_branches row):
--     speed_position.branch_id = reseller_id, variance to that pool,
--     fee_share_in posted, NO commission walk (reseller pays sub-agents
--     manually or via Flow B/C — those Flows are Part 3).
--
-- Pre-checks (in order, lightest first):
--   1. auth.uid() and not frozen
--   2. master kill switch (fee_config.speed_markets_enabled)
--   3. market is open + not past closes_at
--   4. oracle is fresh (< 2s stale)
--   5. determine routing → if reseller branch, branch must be active
--   6. branch operator betting on own branch → reject
--   7. stake within branch min/max (if reseller flow) OR within reasonable
--      defaults (retail fallback)
--   8. per-side cap not exceeded (sum existing open positions on this side)
--   9. user balance >= stake
--
-- Atomic write block (all in one tx):
--   - INSERT speed_positions
--   - INSERT speed_trades (kind='open')
--   - INSERT speed_pool_ledger (stake_in to NULL or reseller_id)
--   - If reseller: INSERT speed_pool_ledger (fee_share_in)
--                  UPDATE speed_branches.speed_pool_balance
--   - UPDATE users.balance_usd -= stake
--   - INSERT transactions (type='speed_stake')
--   - If retail/commission flow: PERFORM pay_speed_trade_commissions
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_execute_trade(
  p_market_id        UUID,
  p_side             TEXT,                 -- 'over' | 'under'
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

  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_seconds_left      DOUBLE PRECISION;

  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_for_duration  DECIMAL;

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

  -- Allow protected-column update on users.balance_usd (existing pattern)
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
    -- Retail flow: variance to NULL pool
    v_is_reseller_flow := FALSE;
    v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE;
      v_routing_branch_id := NULL;
    ELSE
      -- Branch operator betting on own branch → reject
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;

      -- Reseller branch with active speed enrollment → reseller flow
      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches
        WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE;
          v_routing_branch_id := v_signup_branch_id;
        ELSE
          -- Reseller branch not opted into speed → reject (their users can't bet)
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        -- Commission branch (or any other) → variance to NULL, walk runs
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
    -- Per-side cap from JSONB
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    -- Retail / commission-branch fallback: hardcoded caps for v1
    -- TODO Part 3.5: lock platform-default caps via fee_config
    IF p_stake < 1.00 OR p_stake > 25.00 THEN
      RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake;
    END IF;
    v_cap_for_duration := 200.00;
  END IF;

  -- ── Per-side cap: sum existing open positions on this side ─────────────
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
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_iv := COALESCE(v_iv, 0.60);

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

  v_offered_prob := v_fair_prob_side + v_spread_pct / 2.0;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
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
    -- Reseller pool absorbs the stake
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side
    );

    -- 3a. fee_share_in for reseller branch
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

    -- 4. UPDATE speed_branches.speed_pool_balance
    UPDATE speed_branches
    SET speed_pool_balance = v_new_pool_balance,
        updated_at = NOW()
    WHERE branch_id = v_routing_branch_id;
  ELSE
    -- Retail / commission flow: variance to SOOQ main pool (branch_id NULL)
    -- Compute new "main pool" balance by reading current SUM
    SELECT COALESCE(SUM(amount), 0) + p_stake INTO v_new_pool_balance
    FROM speed_pool_ledger WHERE branch_id IS NULL;

    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side
    );
  END IF;

  -- 5. UPDATE users.balance_usd (CHECK >= 0 will fire if anything went wrong)
  -- NOTE: total_wagered is intentionally NOT bumped on speed bets. Per
  -- locked design: bonus-wagering tracks prediction-market action only.
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
'Place a speed bet. Three-flow dispatch: retail / commission-branch / reseller-branch. Atomic write of position + trade + pool ledger + balance debit + commission walk (retail/commission only).';
