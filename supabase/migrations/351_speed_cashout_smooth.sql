-- ============================================================================
-- 351_speed_cashout_smooth.sql
--
-- Seam 1 of the speed-market pricing smoothness plan.
--
-- Problem
-- -------
-- speed_execute_cashout currently snaps to one of three "buckets" (high / mid
-- / low) keyed by `pct = secondsLeft / secondsTotal`:
--   * pct >= 0.6 → high
--   * pct >= 0.2 → mid
--   * pct <  0.2 → low
-- Each bucket has its own multiplier in fee_config (24 keys total —
-- 4 durations × 2 roles × 3 buckets). At the 0.6 and 0.2 boundaries the
-- multiplier jumps discontinuously, creating a visible cliff in the cashout
-- preview as time ticks down.
--
-- Fix
-- ---
-- Replace the bucket lookup with a continuous linear interpolation between
-- the existing `_high` and `_low` keys. The `_mid` keys become unused but
-- stay in fee_config so we don't rewrite history. Reuses the live config
-- values:
--   * pct = 1.0 (full time) → returns the `_high` rate (high-end multiplier)
--   * pct = 0.0 (no time)   → returns the `_low` rate (low-end multiplier)
--   * pct ∈ (0, 1)          → linear blend: low + (high - low) * pct
--
-- Reprices the *entire* cashout lifecycle, not just the boundaries. Concrete
-- example: 5m winner at pct=0.7 goes from today's bucket value 0.65 → linear
-- value 0.25 + (0.65 - 0.25) * 0.7 = 0.53 (-18%). PM aware. Simpler math.
--
-- This migration is independent of Seams 2–4 (which touch speed_execute_trade
-- only); shipping Seam 1 first is intentional (smaller blast radius).
--
-- Function classification
-- -----------------------
-- speed_cashout_multiplier is declared STABLE — NOT IMMUTABLE — because it
-- reads from the fee_config table. STABLE allows the planner to cache the
-- result within a single statement; IMMUTABLE would be unsafe because an
-- admin could update fee_config rates between calls.
--
-- Pre-flight assertion
-- --------------------
-- Before the helper goes live, verify all 8 (_high, _low) × 4 durations × 2
-- roles = 16 keys exist in fee_config. The bucket-based RPC was tolerant of
-- missing _mid; the new helper is not, so we fail loudly here rather than
-- raising at trade time.
--
-- Rollback
-- --------
-- A verbatim copy of the prior speed_execute_cashout body (from mig 345) is
-- preserved at the bottom of this file in a comment block. To roll back, copy
-- that body into a new migration and DROP FUNCTION speed_cashout_multiplier.
-- ============================================================================

-- ─── Part A: pre-flight assertion ──────────────────────────────────────────
-- Verifies every (duration, role) ∈ {5m,15m,1h,24h} × {winner,loser} has both
-- a `_high` and `_low` key in fee_config. RAISES if anything is missing.

DO $$
DECLARE
  v_missing INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_missing FROM (
    SELECT d, r FROM (VALUES ('5m'), ('15m'), ('1h'), ('24h')) AS du(d)
    CROSS JOIN (VALUES ('winner'), ('loser')) AS ro(r)
  ) pairs
  WHERE NOT EXISTS (
    SELECT 1 FROM fee_config WHERE fee_type = 'speed_cashout_' || d || '_' || r || '_high'
  ) OR NOT EXISTS (
    SELECT 1 FROM fee_config WHERE fee_type = 'speed_cashout_' || d || '_' || r || '_low'
  );
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Missing speed_cashout_*_high or _low keys: % (duration, role) pairs incomplete', v_missing;
  END IF;
END $$;

-- ─── Part B: speed_cashout_multiplier helper (STABLE) ──────────────────────
-- Linear interpolation between the configured _low and _high multipliers.
-- p_pct is clamped to [0, 1]; values outside the range are snapped, so the
-- caller doesn't have to pre-clamp v_seconds_left / v_seconds_total.

CREATE OR REPLACE FUNCTION speed_cashout_multiplier(
  p_duration speed_duration,
  p_role     TEXT,
  p_pct      DOUBLE PRECISION
) RETURNS DECIMAL
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_low  DECIMAL;
  v_high DECIMAL;
  v_pct  DOUBLE PRECISION;
BEGIN
  IF p_role NOT IN ('winner', 'loser') THEN
    RAISE EXCEPTION 'Invalid role: % (expected winner | loser)', p_role;
  END IF;

  v_pct := GREATEST(0, LEAST(1, p_pct));

  SELECT rate INTO v_low
  FROM fee_config
  WHERE fee_type = 'speed_cashout_' || p_duration::TEXT || '_' || p_role || '_low'
  LIMIT 1;

  SELECT rate INTO v_high
  FROM fee_config
  WHERE fee_type = 'speed_cashout_' || p_duration::TEXT || '_' || p_role || '_high'
  LIMIT 1;

  IF v_low IS NULL OR v_high IS NULL THEN
    RAISE EXCEPTION 'Cashout endpoints not configured for (%, %)', p_duration, p_role;
  END IF;

  RETURN (v_low + (v_high - v_low) * v_pct)::DECIMAL;
END;
$$;

COMMENT ON FUNCTION speed_cashout_multiplier(speed_duration, TEXT, DOUBLE PRECISION) IS
'Continuous cashout multiplier — linear interpolation between fee_config speed_cashout_<dur>_<role>_low and _high. Replaces the bucket-based lookup (high/mid/low) that produced visible discontinuities at pct=0.6 and pct=0.2. STABLE, not IMMUTABLE — reads fee_config.';

-- ─── Part C: patch speed_execute_cashout to use the new helper ─────────────
-- Body identical to mig 345 except the bucket lookup block is replaced with
-- a single call to speed_cashout_multiplier. The asymmetric winner/loser
-- formula and all locking semantics are unchanged.

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
    -- Mig 345: lock the main pool sentinel instead of summing the ledger.
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

  -- ── Determine role + continuous multiplier (mig 351) ───────────────────
  IF v_fair_prob_side >= v_position.entry_offered_prob THEN
    v_role := 'winner';
  ELSE
    v_role := 'loser';
  END IF;

  -- pct = fraction of duration remaining (clamped to [0, 1] inside the helper).
  -- Guard against divide-by-zero on degenerate v_seconds_total.
  IF v_seconds_total > 0 THEN
    v_pct := v_seconds_left / v_seconds_total;
  ELSE
    v_pct := 0;
  END IF;

  v_multiplier := speed_cashout_multiplier(v_market.duration, v_role, v_pct);

  -- ── Cashout formula (unchanged) ────────────────────────────────────────
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
    -- Mig 345: balance from sentinel, race-free.
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
      'Speed cashout (' || v_role || ', mult ' || v_multiplier || ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2),
    'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role,
    'multiplier', v_multiplier,
    'pct_time_left', ROUND(v_pct::NUMERIC, 4)
  );
END;
$$;

COMMENT ON FUNCTION speed_execute_cashout(UUID, TEXT) IS
'Cash out a single open speed position. Asymmetric multiplier from fee_config × role × continuous time interpolation (mig 351). Mig 345: main-pool balance read/written via FOR UPDATE on speed_main_pool_state singleton.';

-- ============================================================================
-- ROLLBACK REFERENCE — verbatim prior speed_execute_cashout body (from mig 345)
-- ============================================================================
-- If you need to revert this migration, copy the body below into a new
-- migration as CREATE OR REPLACE FUNCTION speed_execute_cashout(...). The
-- bucket-based pricing snippet (DECLARE v_bucket / v_multiplier_key, the
-- speed_time_bucket() call, and the bucket-keyed fee_config lookup) is
-- preserved exactly as it ran on staging immediately before mig 351.
--
-- Body to restore (between the CREATE OR REPLACE FUNCTION header and the
-- terminating $$;):
--
--   ...identical to mig 351 above through "Compute current pricing" plus...
--
--   -- ── Determine bucket + role + multiplier ──────────────────────────────
--   v_bucket := speed_time_bucket(v_seconds_total, v_seconds_left);
--   IF v_fair_prob_side >= v_position.entry_offered_prob THEN
--     v_role := 'winner';
--   ELSE
--     v_role := 'loser';
--   END IF;
--   v_multiplier_key := 'speed_cashout_' || v_market.duration::TEXT || '_' || v_role || '_' || v_bucket;
--
--   SELECT rate INTO v_multiplier FROM fee_config WHERE fee_type = v_multiplier_key LIMIT 1;
--   IF v_multiplier IS NULL THEN
--     RAISE EXCEPTION 'Cashout multiplier not configured: %', v_multiplier_key;
--   END IF;
--
--   ...identical to mig 351 through cashout formula, with one description
--   string difference in the transactions INSERT:
--      'Speed cashout (' || v_role || ', ' || v_bucket || ', mult ' || v_multiplier || ')'
--   and one extra return field:
--      'bucket', v_bucket,
--
-- The full mig 345 file is at supabase/migrations/345_speed_main_pool_sentinel.sql
-- lines 459–681. To roll back, restore that exact body and DROP FUNCTION
-- speed_cashout_multiplier(speed_duration, TEXT, DOUBLE PRECISION).
-- ============================================================================
