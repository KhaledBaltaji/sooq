-- ============================================================================
-- 326_speed_admin_master_kill.sql
--
-- Master kill switches for speed markets — two PIN-gated admin RPCs.
--
-- - `speed_admin_master_kill_soft(p_pin)` — sets `speed_markets_enabled=0`
--   in fee_config. New trades and cashouts rejected. Existing positions
--   resolve normally at expiry. Use case: regulatory shutdown, planned
--   maintenance.
--
-- - `speed_admin_master_kill_hard(p_pin)` — soft kill PLUS voids all open
--   markets and refunds all stakes. Use case: oracle compromise, exchange
--   integrity event. SOOQ eats handle fees from voided bets.
--
-- - `speed_admin_master_revive(p_pin)` — sets `speed_markets_enabled=1`.
--   Doesn't unvoid hard-killed markets — those are gone.
-- ============================================================================

CREATE OR REPLACE FUNCTION speed_admin_master_kill_soft(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  UPDATE fee_config SET rate = 0
  WHERE fee_type = 'speed_markets_enabled';

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'MASTER KILL SOFT triggered by admin ' || v_admin_id,
    jsonb_build_object('event', 'master_kill_soft', 'admin_id', v_admin_id)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'kill_type', 'soft',
    'message', 'Speed markets disabled. New trades blocked. Open positions resolve normally.'
  );
END;
$$;


CREATE OR REPLACE FUNCTION speed_admin_master_kill_hard(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id      UUID;
  v_market        RECORD;
  v_voided_count  INTEGER := 0;
  v_pos           RECORD;
  v_new_balance   DECIMAL;
  v_new_pool_bal  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- 1. Soft kill first
  UPDATE fee_config SET rate = 0
  WHERE fee_type = 'speed_markets_enabled';

  -- 2. Loop over all open markets, void each (refund all positions)
  FOR v_market IN
    SELECT * FROM speed_markets WHERE status IN ('open', 'pending') FOR UPDATE
  LOOP
    -- Refund all open positions
    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = v_market.id AND status = 'open'
    LOOP
      -- Idempotency: skip if already settled
      IF EXISTS (SELECT 1 FROM speed_settlements WHERE position_id = v_pos.id) THEN
        CONTINUE;
      END IF;

      -- Refund stake to user
      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
        'Speed master-kill refund'
      );

      UPDATE speed_positions SET
        status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      -- Pool ledger refund entry
      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_bal FROM speed_branches
        WHERE branch_id = v_pos.branch_id FOR UPDATE;
        v_new_pool_bal := v_new_pool_bal - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, v_market.id, 'refund', -v_pos.stake, v_new_pool_bal, v_pos.id, 'Master-kill refund');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_bal WHERE branch_id = v_pos.branch_id;
      ELSE
        SELECT COALESCE(SUM(amount), 0) - v_pos.stake INTO v_new_pool_bal
        FROM speed_pool_ledger WHERE branch_id IS NULL;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, v_market.id, 'refund', -v_pos.stake, v_new_pool_bal, v_pos.id, 'Master-kill refund (main pool)');
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, v_market.id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);
    END LOOP;

    UPDATE speed_markets SET
      status = 'voided', voided_at = NOW(),
      void_reason = 'Master kill hard by admin ' || v_admin_id,
      updated_at = NOW()
    WHERE id = v_market.id;

    v_voided_count := v_voided_count + 1;
  END LOOP;

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'MASTER KILL HARD by admin ' || v_admin_id || ': voided ' || v_voided_count || ' markets',
    jsonb_build_object('event', 'master_kill_hard', 'admin_id', v_admin_id, 'markets_voided', v_voided_count)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'kill_type', 'hard',
    'markets_voided', v_voided_count,
    'message', 'All open markets voided, stakes refunded. Speed markets disabled.'
  );
END;
$$;


CREATE OR REPLACE FUNCTION speed_admin_master_revive(p_pin TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  UPDATE fee_config SET rate = 1
  WHERE fee_type = 'speed_markets_enabled';

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Speed markets revived by admin ' || v_admin_id,
    jsonb_build_object('event', 'master_revive', 'admin_id', v_admin_id)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Speed markets re-enabled. Voided markets remain voided.'
  );
END;
$$;
