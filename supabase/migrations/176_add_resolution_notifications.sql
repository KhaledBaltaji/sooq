-- 176_add_resolution_notifications.sql
-- P0 fixes:
-- 1. resolve_market now creates notifications for ALL position holders
--    (winners AND losers). Previously, no notifications were sent.
-- 2. resolve_market now requires admin PIN verification (same as fee updates
--    and balance adjustments). This is a destructive, irreversible action.

CREATE OR REPLACE FUNCTION resolve_market(
  p_market_id UUID,
  p_outcome bet_side,
  p_pin TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_config RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout DECIMAL;
  v_fee_amount DECIMAL;
  v_total_paid DECIMAL := 0;
  v_winners_paid INTEGER := 0;
  v_total_commissions DECIMAL;
  v_cash_in DECIMAL;
  v_cash_out_sells DECIMAL;
  v_seed_pnl DECIMAL;
  v_winning_positions INTEGER;
  v_question TEXT;
  v_outcome_upper TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Bypass protected columns trigger (SECURITY DEFINER context)
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- PIN verification (required for this destructive action)
  IF p_pin IS NULL OR p_pin = '' THEN
    RAISE EXCEPTION 'Admin PIN required to resolve a market';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_user_id;
  IF v_config IS NULL OR v_config.pin_hash IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured. Set your PIN first.';
  END IF;

  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > NOW() THEN
    RAISE EXCEPTION 'PIN locked due to too many failed attempts. Try again later.';
  END IF;

  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      failed_pin_attempts = COALESCE(failed_pin_attempts, 0) + 1,
      pin_locked_until = CASE
        WHEN COALESCE(failed_pin_attempts, 0) + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
        ELSE pin_locked_until
      END
    WHERE admin_user_id = v_user_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Reset failed attempts on success
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = v_user_id;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;

  SELECT COUNT(*) INTO v_winning_positions
  FROM positions WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0;

  IF v_winning_positions = 0 THEN
    PERFORM _void_market_internal(p_market_id);

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'admin/resolve', format('Market auto-voided (no %s positions)', p_outcome),
      jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'outcome', p_outcome::text, 'action', 'auto_void'));

    RETURN jsonb_build_object(
      'success', TRUE,
      'action', 'voided',
      'reason', 'No positions on winning side'
    );
  END IF;

  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Truncate question for notification text
  v_question := LEFT(COALESCE(v_market.question_en, ''), 60);
  v_outcome_upper := UPPER(p_outcome::text);

  -- ======= PAY WINNERS =======
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND side = p_outcome
      AND shares_held > 0
    ORDER BY user_id
  LOOP
    SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

    v_payout := v_pos.shares_held * (1.0 - v_resolution_fee_rate);
    v_fee_amount := v_pos.shares_held * v_resolution_fee_rate;

    UPDATE users SET balance_usd = balance_usd + v_payout
    WHERE id = v_pos.user_id
    RETURNING balance_usd INTO v_pos_user.balance_usd;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_pos.user_id, 'resolution_payout', v_payout,
            v_pos_user.balance_usd, p_market_id,
            'Won: ' || ROUND(v_pos.shares_held, 2) || ' shares × $' || ROUND(1.0 - v_resolution_fee_rate, 2)
            || ' (1% resolution fee applied)');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  UPDATE markets SET
    status = 'resolved',
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  v_total_commissions := settle_resolution_commissions(p_market_id);

  PERFORM record_revenue(p_market_id);

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM trades WHERE market_id = p_market_id AND direction = 'sell';

  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_paid;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  UPDATE leader_stats SET
    winning_trades = winning_trades + 1,
    accuracy_pct = CASE WHEN total_trades > 0
      THEN ROUND((winning_trades + 1)::DECIMAL / total_trades * 100, 2) ELSE 0 END
  WHERE user_id IN (
    SELECT DISTINCT user_id FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0
  );

  -- ======= NOTIFY ALL POSITION HOLDERS (winners + losers) =======
  -- Winners
  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
  SELECT
    p.user_id,
    'resolution_win',
    'You won! Market resolved ' || v_outcome_upper,
    v_outcome_upper || ' تم حل السوق — ربحت',
    'Market "' || v_question || '" resolved ' || v_outcome_upper
      || '. You won $' || ROUND(p.shares_held * (1.0 - v_resolution_fee_rate), 2) || '.',
    'السوق "' || v_question || '" تم حله ' || v_outcome_upper
      || '. ربحت $' || ROUND(p.shares_held * (1.0 - v_resolution_fee_rate), 2) || '.',
    p_market_id
  FROM positions p
  WHERE p.market_id = p_market_id AND p.side = p_outcome AND p.shares_held > 0;

  -- Losers
  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
  SELECT
    p.user_id,
    'resolution_loss',
    'Market resolved ' || v_outcome_upper,
    v_outcome_upper || ' تم حل السوق',
    'Market "' || v_question || '" resolved ' || v_outcome_upper
      || '. Your ' || UPPER(p.side::text) || ' position expired.',
    'السوق "' || v_question || '" تم حله ' || v_outcome_upper
      || '. مركزك على ' || UPPER(p.side::text) || ' انتهى.',
    p_market_id
  FROM positions p
  WHERE p.market_id = p_market_id AND p.side != p_outcome AND p.shares_held > 0;

  -- Audit: market resolved
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/resolve', format('Market resolved: %s', p_outcome),
    jsonb_build_object(
      'admin_id', v_user_id,
      'market_id', p_market_id,
      'outcome', p_outcome::text,
      'winners_paid', v_winners_paid,
      'total_paid', ROUND(v_total_paid, 2),
      'total_commissions', ROUND(v_total_commissions, 2),
      'seed_pnl', ROUND(v_seed_pnl, 2)
    ));

  RETURN jsonb_build_object(
    'success', TRUE,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2),
    'total_commissions', ROUND(v_total_commissions, 2),
    'seed_pnl', ROUND(v_seed_pnl, 2)
  );

EXCEPTION WHEN OTHERS THEN
  PERFORM log_system_event(
    'critical'::log_severity,
    'pg/resolve_market',
    SQLERRM,
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome', p_outcome,
      'admin_id', v_user_id,
      'sqlstate', SQLSTATE
    )
  );
  RAISE;
END;
$$;
