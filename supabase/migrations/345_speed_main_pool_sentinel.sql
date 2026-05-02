-- ============================================================================
-- 345_speed_main_pool_sentinel.sql
--
-- Architecture revamp: fix main-pool accounting drift under concurrency.
--
-- Problem:
--   speed_execute_trade, speed_execute_cashout, and speed_resolve_market all
--   compute the "main pool" (branch_id IS NULL) running balance by summing the
--   entire speed_pool_ledger every call. There is no row to lock — two
--   concurrent retail trades both read the same SUM and both insert ledger
--   rows with the same balance_after, breaking the audit trail. (The total
--   still adds up, but the per-row balance_after column drifts.) Performance
--   is also poor: full table scan on every retail trade.
--
--   Reseller branches do this correctly because each branch has its own row
--   in speed_branches and the RPCs SELECT FOR UPDATE that row.
--
-- Fix:
--   Introduce speed_main_pool_state — a single-row table holding the running
--   balance of the main pool. The three RPCs now SELECT FOR UPDATE that row
--   (Postgres serializes concurrent writers automatically), eliminating the
--   race and the full-table-scan in one move.
--
--   Historical ledger rows keep branch_id IS NULL semantics; only the
--   computation method changes. Old balance_after values are not rewritten
--   (speed_pool_ledger has a BEFORE UPDATE/DELETE append-only trigger that
--   blocks rewrites). New rows from this migration onward have correct
--   balance_after values.
--
-- Bonus: TWAP window upper-bound fixed from `ts <= closes_at` to
--   `ts < closes_at`. Half-open windows are the standard convention for
--   time-series TWAP and align with the trade-gate which rejects at
--   `NOW() >= closes_at`. Folded into this migration since we're rewriting
--   speed_resolve_market anyway.
--
-- Affected functions (CREATE OR REPLACE; bodies replaced wholesale):
--   - speed_execute_trade        (was mig 340)
--   - speed_execute_cashout      (was mig 320)
--   - speed_resolve_market       (was mig 330)
-- ============================================================================

-- ─── 1. Singleton state table for the main pool ────────────────────────────
-- Single row enforced by PRIMARY KEY DEFAULT 1 + CHECK (id = 1). FOR UPDATE
-- on this row serializes all main-pool balance reads/writes the same way the
-- per-branch FOR UPDATE on speed_branches does for reseller pools.

CREATE TABLE IF NOT EXISTS speed_main_pool_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  speed_pool_balance DECIMAL NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE speed_main_pool_state IS
'Singleton: running balance of the SOOQ main pool (used by retail and commission-branch flows). Locked FOR UPDATE during every trade/cashout/resolve to prevent concurrent balance_after drift. The audit trail is speed_pool_ledger WHERE branch_id IS NULL; this table is the live cache.';

-- Seed initial balance from historical ledger SUM (idempotent — only inserts
-- if no row exists yet). On a fresh staging this matches whatever has been
-- written so far; on prod (when this lands) it captures the live balance.

INSERT INTO speed_main_pool_state (id, speed_pool_balance, updated_at)
SELECT 1, COALESCE(SUM(amount), 0), NOW()
FROM speed_pool_ledger
WHERE branch_id IS NULL
ON CONFLICT (id) DO NOTHING;

-- RLS: admin/service-role write only; service-role read for RPCs (RPCs are
-- SECURITY DEFINER so they bypass RLS, but explicit policies make the table
-- safe to expose if we ever add an admin dashboard query).
ALTER TABLE speed_main_pool_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access on speed_main_pool_state" ON speed_main_pool_state;
CREATE POLICY "Admin full access on speed_main_pool_state"
  ON speed_main_pool_state
  FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- ─── 2. CREATE OR REPLACE speed_execute_trade ──────────────────────────────
-- Body is identical to mig 340 except: the two SUM-based main-pool reads
-- (collateral check + balance_after compute) now use the sentinel row.

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
  v_main_pool         RECORD;
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

  -- ── Lock the main-pool sentinel for retail/commission flow ─────────────
  -- Mig 345 fix: replaces the old SUM-based balance reads. Locking the
  -- single sentinel row serializes concurrent retail trades exactly the way
  -- speed_branches.FOR UPDATE serializes per-branch trades.
  IF NOT v_is_reseller_flow THEN
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN
      RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
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

  -- ── Per-user per-side cap ──────────────────────────────────────────────
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

  -- Pricing bounds (codex #3): refuse trades when fair on bought side is
  -- outside [bound, 1-bound]. Prevents zero-edge fills near boundaries.
  IF v_fair_prob_side > (1.0 - v_pricing_bound) OR v_fair_prob_side < v_pricing_bound THEN
    RAISE EXCEPTION 'Market too imbalanced for safe pricing on % side', p_side
      USING HINT = 'Try the other side or wait for a less extreme moment.';
  END IF;

  v_offered_prob := v_fair_prob_side + v_spread_pct / 2.0;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;

  -- ── Per-market aggregate exposure cap (codex #1) ────────────────────────
  -- Pool collateral now read from the sentinel for retail flow (was SUM).
  SELECT rate INTO v_max_exposure_pct
  FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);

  v_payout_if_won := p_stake / v_offered_prob;

  IF v_is_reseller_flow THEN
    v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE
    v_pool_collateral := GREATEST(v_main_pool.speed_pool_balance, 0);
  END IF;

  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure
    FROM speed_market_exposure_live
    WHERE market_id = p_market_id
    FOR UPDATE;

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
    -- Main pool: balance from sentinel (locked at top of function, race-free).
    v_new_pool_balance := v_main_pool.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (
      branch_id, market_id, type, amount, balance_after, reference_id, description
    ) VALUES (
      NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side
    );
    UPDATE speed_main_pool_state
    SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE id = 1;
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
'Place a speed bet. Three-flow dispatch (retail / commission-branch / reseller-branch). Mig 345: main-pool balance now read/written via FOR UPDATE on speed_main_pool_state singleton (was: SUM over speed_pool_ledger). Kills concurrent balance_after drift and full-table-scan per trade. Reseller flow unchanged (already locks speed_branches FOR UPDATE).';

-- ─── 3. CREATE OR REPLACE speed_execute_cashout ────────────────────────────

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
  v_main_pool         RECORD;

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

  -- ── Lock the right pool row (reseller branch OR main sentinel) ─────────
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches
    WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN
      RAISE EXCEPTION 'Speed branch row missing for this position';
    END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  ELSE
    -- Mig 345 fix: lock the main pool sentinel instead of summing the ledger.
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN
      RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
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

  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;
  v_fair_profit := v_fair_value - v_position.stake;

  -- ── Determine bucket + role + multiplier ──────────────────────────────
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

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- ── ATOMIC WRITE BLOCK ─────────────────────────────────────────────────

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, branch_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- Pool ledger entry: cashout_out
  IF v_position.branch_id IS NOT NULL THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id
    );
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    -- Mig 345 fix: balance from sentinel, race-free.
    v_new_pool_balance := v_main_pool.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (
      NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)'
    );
    UPDATE speed_main_pool_state
    SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE id = 1;
  END IF;

  -- Credit user balance
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
'Cash out a single open speed position. Asymmetric multiplier from fee_config × time-bucket × role. Mig 345: main-pool balance read/written via FOR UPDATE on speed_main_pool_state singleton (was: SUM over speed_pool_ledger).';

-- ─── 4. CREATE OR REPLACE speed_resolve_market ─────────────────────────────
-- Replaces mig 330 body. Two changes:
--   1. Main-pool balance: FOR UPDATE on speed_main_pool_state (race-free).
--   2. TWAP window upper bound: `<` instead of `<=` (half-open convention).

CREATE OR REPLACE FUNCTION speed_resolve_market(
  p_market_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_acquired   BOOLEAN;
  v_market          RECORD;
  v_twap            DECIMAL;
  v_tick_count      INTEGER;
  v_window_start    TIMESTAMPTZ;
  v_window_end      TIMESTAMPTZ;
  v_outcome         speed_market_outcome;
  v_pos             RECORD;
  v_payout          DECIMAL;
  v_winners         INTEGER := 0;
  v_losers          INTEGER := 0;
  v_total_paid      DECIMAL := 0;
  v_existing        RECORD;
  v_new_balance     DECIMAL;
  v_new_pool_balance DECIMAL;
  v_main_pool       RECORD;
  v_main_pool_locked BOOLEAN := FALSE;
  v_voided          BOOLEAN := FALSE;
  v_void_reason     TEXT;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Cron-overlap protection ────────────────────────────────────────────
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object(
      'skipped', TRUE,
      'reason', 'Another invocation is already resolving this market'
    );
  END IF;

  -- ── Lock + validate market ─────────────────────────────────────────────
  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'resolving') THEN
    RETURN jsonb_build_object(
      'skipped', TRUE,
      'status', v_market.status,
      'reason', 'Market not in resolvable state'
    );
  END IF;
  IF NOW() < v_market.closes_at THEN
    RAISE EXCEPTION 'Market has not closed yet';
  END IF;

  UPDATE speed_markets SET status = 'resolving', updated_at = NOW()
  WHERE id = p_market_id AND status = 'open';

  -- ── Compute TWAP from oracle ticks ──────────────────────────────────────
  -- Mig 345: half-open window [closes_at - 30s, closes_at). Excludes a tick
  -- written at exactly closes_at, matching the trade-gate `NOW() >= closes_at`.
  v_window_start := v_market.closes_at - INTERVAL '30 seconds';
  v_window_end := v_market.closes_at;

  SELECT AVG(price)::DECIMAL, COUNT(*)
  INTO v_twap, v_tick_count
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset
    AND ts >= v_window_start
    AND ts < v_window_end;

  IF v_tick_count IS NULL OR v_tick_count = 0 THEN
    v_voided := TRUE;
    v_void_reason := 'No oracle ticks available in TWAP window';
  END IF;

  -- ── Helper: lock main pool sentinel on first retail position seen ──────
  -- (Lazy: only lock if there's at least one branch_id IS NULL position so
  -- branch-only resolutions don't touch the main pool row.)

  -- ── Void path: refund all + notify ──────────────────────────────────────
  IF v_voided THEN
    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = p_market_id AND status = 'open'
    LOOP
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;

      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
        'Speed market voided — full refund'
      );

      UPDATE speed_positions SET
        status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance
        FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          v_pos.branch_id, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id,
          'Refund (market voided)'
        );
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        -- Mig 345: lock + read sentinel once, update incrementally per refund.
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN
            RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
          END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          NULL, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id,
          'Refund from main pool (market voided)'
        );
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (
        v_pos.user_id, 'speed_market_voided',
        'Speed market voided',
        'تم إلغاء السوق السريع',
        'Your ' || v_market.asset || ' ' || v_market.duration || ' bet was voided. $' || ROUND(v_pos.stake, 2) || ' refunded.',
        'تم إلغاء رهانك ' || v_market.asset || ' ' || v_market.duration || '. تم إعادة $' || ROUND(v_pos.stake, 2) || '.',
        v_pos.id
      );
    END LOOP;

    -- Persist final main-pool balance once after the loop (single UPDATE).
    IF v_main_pool_locked THEN
      UPDATE speed_main_pool_state
      SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
      WHERE id = 1;
    END IF;

    UPDATE speed_markets SET
      status = 'voided', voided_at = NOW(),
      void_reason = v_void_reason, updated_at = NOW()
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'success', TRUE,
      'voided', TRUE,
      'reason', v_void_reason,
      'positions_refunded', (SELECT COUNT(*) FROM speed_settlements WHERE market_id = p_market_id)
    );
  END IF;

  -- ── Determine outcome ───────────────────────────────────────────────────
  IF v_twap > v_market.strike_price THEN
    v_outcome := 'over';
  ELSIF v_twap < v_market.strike_price THEN
    v_outcome := 'under';
  ELSE
    v_outcome := 'at_strike';
  END IF;

  -- ── Settle all open positions ───────────────────────────────────────────
  FOR v_pos IN
    SELECT * FROM speed_positions
    WHERE market_id = p_market_id AND status = 'open'
    ORDER BY user_id
  LOOP
    SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
    IF FOUND THEN CONTINUE; END IF;

    IF v_outcome = 'at_strike' THEN
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET
        status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (
        v_pos.user_id, 'speed_market_at_strike',
        'Closed exactly at strike',
        'أُغلق عند السعر بالضبط',
        v_market.asset || ' ' || v_market.duration || ' closed at strike. Both sides lose.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق عند السعر المرجعي. كلا الجانبين يخسر.',
        v_pos.id
      );
    ELSIF v_pos.side::TEXT = v_outcome::TEXT THEN
      v_payout := ROUND(v_pos.stake / v_pos.entry_offered_prob, 2);
      v_winners := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;

      UPDATE speed_positions SET
        status = 'won', payout_amount = v_payout, closed_at = NOW()
      WHERE id = v_pos.id;

      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'speed_winning', v_payout, v_new_balance, v_pos.id,
        'Speed win on ' || v_outcome::TEXT
      );

      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance
        FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          v_pos.branch_id, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout (' || v_outcome::TEXT || ')'
        );
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        -- Mig 345: lazy lock of main-pool sentinel; subsequent payouts
        -- continue from the in-memory v_new_pool_balance.
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN
            RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init';
          END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          NULL, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout from main pool (' || v_outcome::TEXT || ')'
        );
      END IF;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (
        v_pos.user_id, 'speed_market_won',
        'You won! +$' || ROUND(v_payout, 2),
        'لقد ربحت! +$' || ROUND(v_payout, 2),
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_twap, 2) || '. Payout $' || ROUND(v_payout, 2) || '.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_twap, 2) || '. العائد $' || ROUND(v_payout, 2) || '.',
        v_pos.id
      );
    ELSE
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET
        status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (
        v_pos.user_id, 'speed_market_lost',
        'Speed bet settled',
        'انتهى الرهان السريع',
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_twap, 2) || '. Better luck next round.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_twap, 2) || '. حظاً أوفر المرة القادمة.',
        v_pos.id
      );
    END IF;

    INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, v_outcome, v_payout);
  END LOOP;

  -- Persist final main-pool balance once after the loop.
  IF v_main_pool_locked THEN
    UPDATE speed_main_pool_state
    SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE id = 1;
  END IF;

  -- ── Mark market as resolved ────────────────────────────────────────────
  UPDATE speed_markets SET
    status = 'resolved',
    outcome = v_outcome,
    twap_settlement_price = v_twap,
    twap_window_start = v_window_start,
    twap_window_end = v_window_end,
    twap_tick_count = v_tick_count,
    resolved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'voided', FALSE,
    'outcome', v_outcome::TEXT,
    'twap_settlement_price', ROUND(v_twap, 8),
    'twap_tick_count', v_tick_count,
    'winners', v_winners,
    'losers', v_losers,
    'total_paid', ROUND(v_total_paid, 2)
  );
END;
$$;

COMMENT ON FUNCTION speed_resolve_market(UUID) IS
'Resolves an expired speed market. Computes TWAP, determines outcome, settles positions, updates pool ledgers, emits notifications. Mig 345: main-pool balance via FOR UPDATE on speed_main_pool_state singleton (was: SUM over speed_pool_ledger). Plus TWAP window upper bound `<=` → `<` (half-open convention, aligns with trade-gate). Idempotent via speed_settlements UNIQUE position_id; advisory lock prevents cron overlap.';
