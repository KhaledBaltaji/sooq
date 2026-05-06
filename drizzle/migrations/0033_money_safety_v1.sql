-- 0033_money_safety_v1.sql
--
-- T1 — money safety v1. Defense-in-depth migration that adds three things
-- without rewriting any complex RPC bodies (cashout-IF guard is the only
-- function-body change, and it's a 2-line removal):
--
--   1. CHECK constraint `users_balance_nonneg` on users.balance_usd.
--      CLAUDE.md mentioned this constraint but no migration ever added it.
--      All money RPCs currently rely on runtime checks (`IF v_user.balance_usd
--      < p_stake THEN RAISE`); a future bug bypassing those checks could
--      silently push balance negative. The CHECK is belt-and-braces.
--      Added with NOT VALID so existing rows aren't validated (in case any
--      legacy negative balance exists). Future writes ARE validated.
--
--   2. New table `admin_action_log` for audit trail of admin RPC calls.
--      Currently every admin action is a one-way write — `withdrawals.reviewer_id`
--      records who approved a withdrawal but there's no per-RPC audit. The
--      table is created here; triggers wiring it up to specific RPCs ship in
--      a follow-up migration (each RPC needs its own trigger and that's a
--      separate review surface).
--
--   3. Column `withdrawals.idempotency_key TEXT` with UNIQUE constraint
--      (where not null). Lays the groundwork for hash-based dedup of
--      double-submitted withdrawal requests. The route layer will populate
--      it in a follow-up patch (process_withdrawal RPC is unchanged here).
--
--   4. RPC fix: `speed_execute_cashout` $0 cashout edge case.
--      Pre-fix: when v_cashout_amount = 0, the IF guard skips both the UPDATE
--      AND the transactions INSERT. Position closes, speed_trades row exists,
--      ledger has nothing → orphan trade row that w10-ledger-audit.mjs can't
--      see. CLAUDE.md rule "every balance write paired with transaction" is
--      technically not violated (no balance write either), but the speed_trades
--      row without a transaction breaks reconciliation queries.
--      Post-fix: UPDATE always runs (no-op when amount=0; balance_usd unchanged
--      but updated_at refreshes), INSERT always runs with amount=0 and
--      balance_after=current_balance. Atomic, paired, ledger-complete.
--
-- DEFERRED to follow-up migrations:
--   - speed_resolve_market settlement window `<` → `<=` (T1.2)
--   - speed_resolve_market post-loop completeness assertion (T1.3)
--   - mig 0031 soft-guard refactor for surviving INSERTs (T1.4)
--   - process_withdrawal idempotency_key parameter wiring (T1.5 server side)
--   - notifications.type CHECK constraint (T1.7) — needs full type inventory
--   - DROP FUNCTION admin_adjust_balance (T1.9) — still wired via
--     /api/admin/balance/route.ts; needs route migration first
--   - admin_action_log triggers (T1.10) — table created; triggers separate

BEGIN;

-- ============================================================================
-- 1) users.balance_usd CHECK constraint (T1.6)
-- ============================================================================

-- Add the constraint with NOT VALID so existing rows aren't immediately
-- validated. Postgres still enforces it on INSERTs and UPDATEs from this
-- point forward. Subsequent VALIDATE CONSTRAINT pass can run when ops is
-- confident the legacy data is clean.
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_balance_nonneg;
ALTER TABLE public.users
  ADD CONSTRAINT users_balance_nonneg
  CHECK (balance_usd >= 0)
  NOT VALID;

-- ============================================================================
-- 2) admin_action_log table (T1.10 partial — table only, triggers later)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_action_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES public.users(id),
  action      TEXT NOT NULL,            -- 'approve_withdrawal', 'balance_adjust', 'set_admin_role', etc.
  target_id   UUID,                     -- e.g. user_id being modified, withdrawal_id being approved
  metadata    JSONB,                    -- before/after values, notes, IP, etc.
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_action_log_admin_idx
  ON public.admin_action_log (admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_action_log_action_idx
  ON public.admin_action_log (action, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_action_log_target_idx
  ON public.admin_action_log (target_id, created_at DESC) WHERE target_id IS NOT NULL;

COMMENT ON TABLE public.admin_action_log IS
  'Audit trail of admin RPC invocations. Triggers wiring specific RPCs into this table land in a follow-up migration. Until then, table is empty. Designed to be append-only; do not allow UPDATE/DELETE.';

-- ============================================================================
-- 3) withdrawals.idempotency_key column (T1.5 partial — column only)
-- ============================================================================

-- Add nullable TEXT column with a partial UNIQUE index (postgres allows
-- multiple NULLs to coexist, so this only enforces uniqueness on supplied
-- keys). Route layer will start populating this in a follow-up patch where
-- it derives the key from a hash of (user_id, amount, method, account_details,
-- minute-bucketed timestamp) so accidental double-submits collide cleanly.
ALTER TABLE public.withdrawals
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_idempotency_key_unique
  ON public.withdrawals (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.withdrawals.idempotency_key IS
  'Optional hash of (user_id, amount, method, account_details, minute-bucketed timestamp). Populated by /api/withdrawal/process route. A duplicate submission within the same minute reuses the same key and fails the UNIQUE constraint, returning a friendly "already submitted" error instead of double-debiting their balance.';

-- ============================================================================
-- 4) speed_execute_cashout — $0 cashout always writes a transactions row (T1.1)
-- ============================================================================
--
-- Identical body to mig 0030 except the `IF v_cashout_amount > 0 THEN ... END IF;`
-- guard around the UPDATE + INSERT is removed. The UPDATE is a no-op when
-- amount is 0 (balance_usd unchanged, updated_at refreshes); the INSERT writes
-- a transactions row with amount=0 and balance_after=current_balance.
--
-- Direction-matching invariant from mig 0028 still holds. All parity check
-- params from mig 0030 still wired. Only the post-trade ledger write changes.

CREATE OR REPLACE FUNCTION public.speed_execute_cashout(
  p_position_id                  UUID,
  p_idempotency_key              TEXT    DEFAULT NULL,
  p_expected_iv                  DECIMAL DEFAULT NULL,
  p_expected_spot                DECIMAL DEFAULT NULL,
  p_expected_seconds_left_bucket INTEGER DEFAULT NULL,
  p_expected_mark_prob           DECIMAL DEFAULT NULL,
  p_expected_cashout_amount      NUMERIC DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id            UUID;
  v_position           RECORD;
  v_market             RECORD;
  v_market_id          UUID;
  v_oracle             RECORD;

  v_kill_switch        DECIMAL;
  v_oracle_stale_secs  DECIMAL;
  v_iv                 DECIMAL;
  v_drift_tolerance    DECIMAL;
  v_seconds_total      DOUBLE PRECISION;
  v_seconds_left       DOUBLE PRECISION;
  v_seconds_left_bucket INTEGER;
  v_pct                DOUBLE PRECISION;
  v_late_reject_s      DECIMAL;
  v_late_30s_imbalance DECIMAL;

  v_fair_prob_over     DECIMAL;
  v_mark_prob          DECIMAL;
  v_is_winning         BOOLEAN;
  v_fair_profit        NUMERIC;
  v_margin             DOUBLE PRECISION;
  v_cashout_amount     NUMERIC;

  v_parity_prob_tol    DECIMAL;
  v_parity_spot_tol    DECIMAL;
  v_parity_cashout_tol DECIMAL;

  v_existing_dup       RECORD;
  v_trade_id           UUID;
  v_new_balance        DECIMAL;
BEGIN
  v_user_id := app.user_id();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT rate INTO v_kill_switch FROM fee_config WHERE fee_type = 'speed_cashout_enabled' LIMIT 1;
  IF COALESCE(v_kill_switch, 1) <= 0 THEN
    RAISE EXCEPTION 'Cashout temporarily disabled — please try again shortly';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup
    FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id
    LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'idempotent', TRUE,
        'trade_id', v_existing_dup.id,
        'message', 'Duplicate cashout — returning existing trade_id'
      );
    END IF;
  END IF;

  SELECT market_id INTO v_market_id
  FROM speed_positions WHERE id = p_position_id;
  IF v_market_id IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('speed_resolve_' || v_market_id::TEXT));

  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN
    RAISE EXCEPTION 'Position not found';
  END IF;
  IF v_position.user_id <> v_user_id THEN
    RAISE EXCEPTION 'Not authorised for this position';
  END IF;
  IF v_position.status <> 'open' THEN
    RAISE EXCEPTION 'Position is not open (status: %)', v_position.status;
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN
    RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status;
  END IF;
  IF NOW() >= v_market.closes_at THEN
    RAISE EXCEPTION 'Market has closed; cannot cash out';
  END IF;
  IF v_market.duration::TEXT NOT IN ('5m','1h') THEN
    RAISE EXCEPTION 'Duration % is no longer supported', v_market.duration;
  END IF;

  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  SELECT rate INTO v_late_reject_s FROM fee_config WHERE fee_type = 'speed_cashout_late_reject_s';
  v_late_reject_s := COALESCE(v_late_reject_s, 10);
  IF v_seconds_left < v_late_reject_s THEN
    RAISE EXCEPTION 'Market closing — no cashouts in last %s seconds', v_late_reject_s;
  END IF;

  v_seconds_left_bucket := _speed_seconds_left_bucket(v_seconds_left);
  IF p_expected_seconds_left_bucket IS NOT NULL
     AND v_seconds_left_bucket <> p_expected_seconds_left_bucket THEN
    RAISE EXCEPTION 'PARITY_DRIFT [seconds_left_bucket]: expected=% actual=%',
      p_expected_seconds_left_bucket, v_seconds_left_bucket
      USING HINT = 'Cashout window changed — refresh quote';
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN
    RAISE EXCEPTION 'Oracle price unavailable';
  END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;

  SELECT rate INTO v_parity_spot_tol FROM fee_config WHERE fee_type = 'speed_parity_spot_drift_pct';
  v_parity_spot_tol := COALESCE(v_parity_spot_tol, 0.001);
  PERFORM _speed_assert_parity('spot_price', p_expected_spot, v_oracle.price, v_parity_spot_tol);

  v_iv := _speed_get_iv(v_market.asset, v_market.duration);

  IF p_expected_iv IS NOT NULL THEN
    SELECT rate INTO v_drift_tolerance FROM fee_config WHERE fee_type = 'speed_iv_drift_tolerance_pct';
    v_drift_tolerance := COALESCE(v_drift_tolerance, 0.10);
    IF v_iv = 0 OR ABS(v_iv - p_expected_iv) / v_iv > v_drift_tolerance THEN
      RAISE EXCEPTION 'IV_DRIFT: server_iv=% client_iv=% — please retry', v_iv, p_expected_iv;
    END IF;
  END IF;

  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_pct := CASE WHEN v_seconds_total > 0 THEN v_seconds_left / v_seconds_total ELSE 0 END;

  v_fair_prob_over := speed_fair_prob_over(
    v_oracle.price, v_market.strike_price, v_seconds_left, v_iv
  );
  IF v_position.side = 'over' THEN
    v_mark_prob := v_fair_prob_over;
  ELSE
    v_mark_prob := 1.0 - v_fair_prob_over;
  END IF;

  SELECT rate INTO v_parity_prob_tol FROM fee_config WHERE fee_type = 'speed_parity_prob_drift_pct';
  v_parity_prob_tol := COALESCE(v_parity_prob_tol, 0.02);
  PERFORM _speed_assert_parity('mark_prob', p_expected_mark_prob, v_mark_prob, v_parity_prob_tol);

  IF v_seconds_left < 30 THEN
    SELECT rate INTO v_late_30s_imbalance FROM fee_config WHERE fee_type = 'speed_cashout_late_30s_imbalance_reject';
    v_late_30s_imbalance := COALESCE(v_late_30s_imbalance, 0.30);
    IF ABS(v_mark_prob::DOUBLE PRECISION - 0.5) > v_late_30s_imbalance::DOUBLE PRECISION THEN
      RAISE EXCEPTION 'Cashout rejected: too late and too one-sided (mark=%, secs_left=%)',
        ROUND(v_mark_prob, 4), ROUND(v_seconds_left::NUMERIC, 1)
        USING HINT = 'Hold to expiry — cashout window is closed';
    END IF;
  END IF;

  v_is_winning := v_mark_prob > v_position.entry_offered_prob;
  v_fair_profit := v_position.stake
                 * (v_mark_prob / v_position.entry_offered_prob - 1.0);

  v_margin := _speed_cashout_margin(
    v_market.duration, v_is_winning, v_mark_prob, v_seconds_left
  );

  IF v_is_winning THEN
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 - v_margin);
  ELSE
    v_cashout_amount := v_position.stake + v_fair_profit * (1.0 + v_margin);
  END IF;

  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;

  -- 0028 fix (Codex review): direction-matching after cents rounding.
  IF v_is_winning AND ROUND(v_cashout_amount, 2) <= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_PROFIT: profit too small to lock in cleanly (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Wait for the chart to move further or hold to expiry';
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND ROUND(v_cashout_amount, 2) >= v_position.stake THEN
    RAISE EXCEPTION 'INSUFFICIENT_LOSS: rounded cashout would not register a loss (cashout=$% stake=$%)',
      ROUND(v_cashout_amount, 4), v_position.stake
      USING HINT = 'Hold to expiry — there is no meaningful loss to cut';
  END IF;

  v_cashout_amount := ROUND(v_cashout_amount, 2);

  -- 0030: cashout_amount parity check (final number the user agreed to take).
  SELECT rate INTO v_parity_cashout_tol FROM fee_config WHERE fee_type = 'speed_parity_cashout_drift_pct';
  v_parity_cashout_tol := COALESCE(v_parity_cashout_tol, 0.02);
  PERFORM _speed_assert_parity('cashout_amount', p_expected_cashout_amount, v_cashout_amount, v_parity_cashout_tol);

  IF v_is_winning AND v_cashout_amount <= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: winning cashout=$% <= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;
  IF NOT v_is_winning AND v_mark_prob < v_position.entry_offered_prob
     AND v_cashout_amount >= v_position.stake THEN
    RAISE EXCEPTION 'INVARIANT VIOLATION: losing cashout=$% >= stake=$% (mark=%, entry=%)',
      v_cashout_amount, v_position.stake, v_mark_prob, v_position.entry_offered_prob;
  END IF;

  UPDATE speed_positions SET
    status = 'cashed_out',
    payout_amount = v_cashout_amount,
    closed_at = NOW()
  WHERE id = p_position_id;

  INSERT INTO speed_trades (
    position_id, user_id, market_id, kind, amount,
    spot_price, fair_prob, offered_prob, cashout_multiplier,
    iv_used, idempotency_key
  ) VALUES (
    p_position_id, v_user_id, v_market.id, 'cashout', v_cashout_amount,
    v_oracle.price, v_mark_prob, v_position.entry_offered_prob, v_margin::DECIMAL,
    v_iv, p_idempotency_key
  )
  RETURNING id INTO v_trade_id;

  -- 0033 (T1.1): always pair the speed_trades row with a transactions row,
  -- even when v_cashout_amount = 0. The UPDATE is a no-op for balance_usd
  -- when amount is 0 but refreshes updated_at. The INSERT records the trade
  -- in the ledger so reconciliation queries can pair every speed_trades row
  -- with a transaction row.
  UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
  WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
    'Speed cashout (margin ' || ROUND(v_margin::NUMERIC, 4) || ', ' ||
    CASE WHEN v_is_winning THEN 'winning' ELSE 'losing' END ||
    ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')'
  );

  PERFORM _speed_update_daily_ngr(0, 0, v_cashout_amount, 0);

  RETURN jsonb_build_object(
    'success', TRUE,
    'trade_id', v_trade_id,
    'position_id', p_position_id,
    'cashout_amount', v_cashout_amount,
    'mark_prob', ROUND(v_mark_prob, 6),
    'is_winning', v_is_winning,
    'margin_applied', ROUND(v_margin::NUMERIC, 6),
    'fair_profit', ROUND(v_fair_profit, 4),
    'iv_used', ROUND(v_iv, 6),
    'pct_time_left', ROUND(v_pct::NUMERIC, 4),
    'seconds_left_bucket', v_seconds_left_bucket
  );
END;
$$;

COMMENT ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) IS
  '0033: same body as 0030 with the IF v_cashout_amount > 0 guard removed around the post-trade UPDATE + INSERT. $0 cashouts now produce a paired transactions row (amount=0, balance_after unchanged) so the ledger stays consistent with speed_trades.';

GRANT EXECUTE ON FUNCTION public.speed_execute_cashout(UUID, TEXT, DECIMAL, DECIMAL, INTEGER, DECIMAL, NUMERIC) TO PUBLIC;

-- ============================================================================
-- Sanity assertions (post-DDL)
-- ============================================================================

DO $$
DECLARE
  v_constraint_count INTEGER;
  v_table_count      INTEGER;
  v_column_count     INTEGER;
  v_overload_count   INTEGER;
BEGIN
  -- T1.6: balance_usd CHECK present
  SELECT COUNT(*) INTO v_constraint_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE c.conname = 'users_balance_nonneg' AND t.relname = 'users';
  IF v_constraint_count <> 1 THEN
    RAISE EXCEPTION '0033: users_balance_nonneg constraint not installed (count=%)', v_constraint_count;
  END IF;

  -- T1.10: admin_action_log table present
  SELECT COUNT(*) INTO v_table_count
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_name = 'admin_action_log';
  IF v_table_count <> 1 THEN
    RAISE EXCEPTION '0033: admin_action_log table not created';
  END IF;

  -- T1.5: withdrawals.idempotency_key column present
  SELECT COUNT(*) INTO v_column_count
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'withdrawals' AND column_name = 'idempotency_key';
  IF v_column_count <> 1 THEN
    RAISE EXCEPTION '0033: withdrawals.idempotency_key column not added';
  END IF;

  -- T1.1: speed_execute_cashout still has exactly one overload (mig 0032 cleanup)
  SELECT COUNT(*) INTO v_overload_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'speed_execute_cashout';
  IF v_overload_count <> 1 THEN
    RAISE EXCEPTION '0033: speed_execute_cashout overload count = %, expected 1 (mig 0032 should have left exactly one 7-arg version)', v_overload_count;
  END IF;
END $$;

COMMIT;
