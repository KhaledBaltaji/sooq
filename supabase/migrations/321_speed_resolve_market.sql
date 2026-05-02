-- ============================================================================
-- 321_speed_resolve_market.sql
--
-- Resolves an expired speed market.
--
-- Flow:
--   0. Advisory lock prevents two cron invocations from overlapping.
--   1. Lock the market row, validate it's at/past closes_at and 'open'.
--   2. Compute TWAP from speed_oracle_ticks where ts in [closes_at - 30s, closes_at].
--      If 0 ticks: void the market (refund all stakes).
--   3. Determine outcome from TWAP vs strike.
--   4. Update speed_markets: status='resolving' → status='resolved' + outcome + twap fields.
--   5. For each open position on this market: settle.
--      Winners: payout = stake / entry_offered_prob, credited to balance.
--      Losers: no payout.
--      at_strike: both sides lose (no refund).
--   6. Pool ledger updates per branch (or NULL pool).
--
-- Idempotency: per-position via speed_settlements UNIQUE PRIMARY KEY (position_id).
-- Cron-overlap: pg_try_advisory_lock at function start.
-- ============================================================================

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
  v_branch_total    DECIMAL;
  v_branch_id       UUID;
  v_speed_branch    RECORD;
  v_voided          BOOLEAN := FALSE;
  v_void_reason     TEXT;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Cron-overlap protection ────────────────────────────────────────────
  -- Hash on the market_id so different markets can resolve concurrently,
  -- but two invocations on the SAME market serialize.
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

  -- Mark as resolving
  UPDATE speed_markets SET status = 'resolving', updated_at = NOW()
  WHERE id = p_market_id AND status = 'open';

  -- ── Compute TWAP from oracle ticks (last 30s window) ───────────────────
  v_window_start := v_market.closes_at - INTERVAL '30 seconds';
  v_window_end := v_market.closes_at;

  SELECT
    AVG(price)::DECIMAL,
    COUNT(*)
  INTO v_twap, v_tick_count
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset
    AND ts >= v_window_start
    AND ts <= v_window_end;

  IF v_tick_count IS NULL OR v_tick_count = 0 THEN
    -- No data: void the market.
    v_voided := TRUE;
    v_void_reason := 'No oracle ticks available in TWAP window';
  END IF;

  -- ── If voiding: refund all open positions and stop ─────────────────────
  IF v_voided THEN
    -- Loop open positions, refund stake, mark refunded
    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = p_market_id AND status = 'open'
    LOOP
      -- Idempotency
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;

      -- Credit user the full stake back
      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
        'Speed market voided — full refund'
      );

      -- Update position
      UPDATE speed_positions SET
        status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      -- Pool ledger entry (refund)
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
        SELECT COALESCE(SUM(amount), 0) - v_pos.stake INTO v_new_pool_balance
        FROM speed_pool_ledger WHERE branch_id IS NULL;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          NULL, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id,
          'Refund from main pool (market voided)'
        );
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);
    END LOOP;

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

  -- ── Determine outcome from TWAP ────────────────────────────────────────
  IF v_twap > v_market.strike_price THEN
    v_outcome := 'over';
  ELSIF v_twap < v_market.strike_price THEN
    v_outcome := 'under';
  ELSE
    v_outcome := 'at_strike';
  END IF;

  -- ── Settle all open positions ──────────────────────────────────────────
  FOR v_pos IN
    SELECT * FROM speed_positions
    WHERE market_id = p_market_id AND status = 'open'
    ORDER BY user_id      -- deterministic lock order
  LOOP
    SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
    IF FOUND THEN CONTINUE; END IF;     -- already settled (idempotent retry)

    IF v_outcome = 'at_strike' THEN
      -- Both sides lose. No payout.
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET
        status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;
    ELSIF v_pos.side::TEXT = v_outcome::TEXT THEN
      -- Winner
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

      -- Pool ledger: winning_payout debit
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
        SELECT COALESCE(SUM(amount), 0) - v_payout INTO v_new_pool_balance
        FROM speed_pool_ledger WHERE branch_id IS NULL;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (
          NULL, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout from main pool (' || v_outcome::TEXT || ')'
        );
      END IF;
    ELSE
      -- Loser
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET
        status = 'lost', payout_amount = 0, closed_at = NOW()
      WHERE id = v_pos.id;
    END IF;

    -- Idempotency record
    INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, v_outcome, v_payout);
  END LOOP;

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
'Resolves an expired speed market. Computes TWAP, determines outcome, settles all open positions, updates pool ledgers. Idempotent via speed_settlements UNIQUE position_id. Advisory lock prevents cron overlap.';
