-- ============================================================================
-- 355_speed_single_tick_settlement.sql
--
-- Replace 30-second TWAP averaging in speed_resolve_market with single-tick
-- settlement at exactly closes_at, with a 2-second fallback window.
--
-- Why:
--   The 30-second TWAP makes settlement disagree with the live chart users
--   were watching. Concrete data: 6.6% of resolved 5-minute markets in the
--   last 24 hours would have flipped outcome under single-tick, with average
--   $209 disagreement between TWAP and close-tick. Users complain that a bet
--   that was "clearly above the line" lost because the average dragged below.
--
--   Single-tick settles at the exact closing price. The user sees the chart,
--   sees the price at exactly 5:00, knows immediately whether they won or
--   lost. Matches the mental model of every binary-options product.
--
-- Settlement algorithm:
--   1. Try to read a tick at exactly closes_at (or the most recent tick
--      within `closes_at - 2 seconds`).
--   2. If no tick within the 2s fallback window → void the market (refund).
--   3. The 2s fallback matches `speed_oracle_stale_seconds` for consistency.
--
-- Column rename:
--   `speed_markets.twap_settlement_price` → `settlement_price`. The old name
--   was misleading (it's no longer a TWAP). All consuming code is updated in
--   the same commit. The `twap_window_*` columns stay (now describe the
--   fallback window: typically [closes_at - 1 tick, closes_at), tick_count=1).
--
-- Eng review issue 4B (rename) and 2A (2-second fallback) and 10A (index
-- verified — pg_oracle_ticks has (asset, ts) covering index from mig 311).
-- ============================================================================

-- ── 1. Column rename (idempotent — safe on re-run) ──────────────────────────
-- Wrapped in DO block so `supabase db push` is safe even if column was already
-- renamed via a hot-patch that didn't record in schema_migrations.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'speed_markets'
      AND column_name = 'twap_settlement_price'
  ) THEN
    ALTER TABLE speed_markets RENAME COLUMN twap_settlement_price TO settlement_price;
  END IF;
END $$;

COMMENT ON COLUMN speed_markets.settlement_price IS
'Mig 355: settlement price at market close. Single oracle tick at closes_at, or most recent tick within 2 seconds before close. Replaces the prior 30s TWAP. NULL until resolution.';

-- ── 2. Update speed_resolve_market with single-tick settlement ──────────────

CREATE OR REPLACE FUNCTION public.speed_resolve_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_acquired   BOOLEAN;
  v_market          RECORD;
  v_settlement_price DECIMAL;
  v_settlement_tick_ts TIMESTAMPTZ;
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

  -- Cron-overlap protection
  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('skipped', TRUE,
      'reason', 'Another invocation is already resolving this market');
  END IF;

  -- Lock + validate market
  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status NOT IN ('open', 'resolving') THEN
    RETURN jsonb_build_object('skipped', TRUE, 'status', v_market.status,
      'reason', 'Market not in resolvable state');
  END IF;
  IF NOW() < v_market.closes_at THEN RAISE EXCEPTION 'Market has not closed yet'; END IF;

  UPDATE speed_markets SET status = 'resolving', updated_at = NOW()
  WHERE id = p_market_id AND status = 'open';

  -- ── Single-tick settlement (mig 355 replaces 30s TWAP) ─────────────────
  -- Read the most recent tick at or just before closes_at, within the
  -- 2-second fallback window. If none → void.
  v_window_start := v_market.closes_at - INTERVAL '2 seconds';
  v_window_end   := v_market.closes_at;

  -- Half-open boundary: ts < closes_at (matches trade-gate symmetry where
  -- trades are rejected at NOW() >= closes_at). A tick written at exactly
  -- closes_at is excluded — settlement uses the most recent tick BEFORE close.
  SELECT price, ts INTO v_settlement_price, v_settlement_tick_ts
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset
    AND ts >= v_window_start
    AND ts < v_window_end
  ORDER BY ts DESC
  LIMIT 1;

  IF v_settlement_price IS NULL THEN
    v_voided := TRUE;
    v_void_reason := 'No oracle tick available within 2s of closes_at';
  END IF;

  -- ── Void path: refund all + notify ─────────────────────────────────────
  IF v_voided THEN
    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = p_market_id AND status = 'open'
    LOOP
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;

      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
        'Speed market voided — full refund');

      UPDATE speed_positions SET status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance
        FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id,
          'Refund (market voided)');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing'; END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id,
          'Refund from main pool (market voided)');
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_voided',
        'Speed market voided', 'تم إلغاء السوق السريع',
        'Your ' || v_market.asset || ' ' || v_market.duration || ' bet was voided. $' || ROUND(v_pos.stake, 2) || ' refunded.',
        'تم إلغاء رهانك ' || v_market.asset || ' ' || v_market.duration || '. تم إعادة $' || ROUND(v_pos.stake, 2) || '.',
        v_pos.id);
    END LOOP;

    IF v_main_pool_locked THEN
      UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
    END IF;

    UPDATE speed_markets SET
      status = 'voided', voided_at = NOW(),
      void_reason = v_void_reason, updated_at = NOW()
    WHERE id = p_market_id;

    RETURN jsonb_build_object('success', TRUE, 'voided', TRUE, 'reason', v_void_reason,
      'positions_refunded', (SELECT COUNT(*) FROM speed_settlements WHERE market_id = p_market_id));
  END IF;

  -- ── Determine outcome from single tick ─────────────────────────────────
  IF v_settlement_price > v_market.strike_price THEN
    v_outcome := 'over';
  ELSIF v_settlement_price < v_market.strike_price THEN
    v_outcome := 'under';
  ELSE
    v_outcome := 'at_strike';
  END IF;

  -- ── Settle all open positions ──────────────────────────────────────────
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
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW() WHERE id = v_pos.id;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_at_strike',
        'Closed exactly at strike', 'أُغلق عند السعر بالضبط',
        v_market.asset || ' ' || v_market.duration || ' closed at strike. Both sides lose.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق عند السعر المرجعي. كلا الجانبين يخسر.',
        v_pos.id);
    ELSIF v_pos.side::TEXT = v_outcome::TEXT THEN
      v_payout := ROUND(v_pos.stake / v_pos.entry_offered_prob, 2);
      v_winners := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;

      UPDATE speed_positions SET status = 'won', payout_amount = v_payout, closed_at = NOW() WHERE id = v_pos.id;

      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_winning', v_payout, v_new_balance, v_pos.id,
        'Speed win on ' || v_outcome::TEXT);

      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance
        FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout (' || v_outcome::TEXT || ')');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing'; END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout from main pool (' || v_outcome::TEXT || ')');
      END IF;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_won',
        'You won! +$' || ROUND(v_payout, 2),
        'لقد ربحت! +$' || ROUND(v_payout, 2),
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_settlement_price, 2) || '. Payout $' || ROUND(v_payout, 2) || '.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_settlement_price, 2) || '. العائد $' || ROUND(v_payout, 2) || '.',
        v_pos.id);
    ELSE
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW() WHERE id = v_pos.id;

      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_lost',
        'Speed bet settled', 'انتهى الرهان السريع',
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_settlement_price, 2) || '. Better luck next round.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_settlement_price, 2) || '. حظاً أوفر المرة القادمة.',
        v_pos.id);
    END IF;

    INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, v_outcome, v_payout);
  END LOOP;

  IF v_main_pool_locked THEN
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;

  -- Mark market resolved with single-tick settlement_price.
  -- twap_window_* columns repurposed to describe the lookup window for audit:
  --   twap_window_start = closes_at - 2s (fallback window opens)
  --   twap_window_end   = settlement_tick_ts (the actual tick used)
  --   twap_tick_count   = 1 (we used 1 tick)
  UPDATE speed_markets SET
    status = 'resolved',
    outcome = v_outcome,
    settlement_price = v_settlement_price,
    twap_window_start = v_window_start,
    twap_window_end = v_settlement_tick_ts,
    twap_tick_count = 1,
    resolved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE, 'voided', FALSE,
    'outcome', v_outcome::TEXT,
    'settlement_price', ROUND(v_settlement_price, 8),
    'settlement_tick_ts', v_settlement_tick_ts,
    'winners', v_winners, 'losers', v_losers,
    'total_paid', ROUND(v_total_paid, 2)
  );
END;
$$;

COMMENT ON FUNCTION public.speed_resolve_market(UUID) IS
'Resolve an expired speed market. Mig 355: switches from 30s TWAP averaging to single-tick settlement at closes_at (2s fallback window). Renames twap_settlement_price column to settlement_price. Mig 345 main-pool sentinel locking preserved. Voids on no-tick.';
