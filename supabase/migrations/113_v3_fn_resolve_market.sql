-- 113_v3_fn_resolve_market.sql — V3 market resolution
-- Admin only. Credits winning positions, settles commissions, records revenue.
-- Winning shares pay $0.99 (1% resolution fee). Losing shares pay $0.

CREATE OR REPLACE FUNCTION resolve_market(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
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
BEGIN
  -- ======= ADMIN CHECK =======
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- ======= LOCK MARKET + AMM =======
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;

  -- ======= CHECK FOR WINNING POSITIONS (empty → auto-void) =======
  SELECT COUNT(*) INTO v_winning_positions
  FROM positions WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0;

  IF v_winning_positions = 0 THEN
    -- No winning positions → void the market
    PERFORM _void_market_internal(p_market_id);
    RETURN jsonb_build_object(
      'success', TRUE,
      'action', 'voided',
      'reason', 'No positions on winning side'
    );
  END IF;

  -- ======= READ RESOLUTION FEE RATE =======
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- ======= PAY WINNING POSITIONS =======
  -- Each winning share pays $1.00 * (1 - resolution_fee) = $0.99
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND side = p_outcome
      AND shares_held > 0
    ORDER BY user_id  -- consistent lock order to prevent deadlocks
  LOOP
    -- Lock user row
    SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

    v_payout := v_pos.shares_held * (1.0 - v_resolution_fee_rate);
    v_fee_amount := v_pos.shares_held * v_resolution_fee_rate;

    -- Credit winner
    UPDATE users SET balance_usd = balance_usd + v_payout
    WHERE id = v_pos.user_id
    RETURNING balance_usd INTO v_pos_user.balance_usd;

    -- Ledger: resolution payout (net of 1% resolution fee; balance_after from RETURNING)
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_pos.user_id, 'resolution_payout', v_payout,
            v_pos_user.balance_usd, p_market_id,
            'Won: ' || ROUND(v_pos.shares_held, 2) || ' shares × $' || ROUND(1.0 - v_resolution_fee_rate, 2)
            || ' (1% resolution fee applied)');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  -- Losing positions get $0 — no action needed

  -- ======= UPDATE MARKET STATUS (before commission settlement) =======
  UPDATE markets SET
    status = 'resolved',
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  -- ======= SETTLE COMMISSIONS =======
  v_total_commissions := settle_commissions(p_market_id);

  -- ======= RECORD REVENUE =======
  PERFORM record_revenue(p_market_id, v_total_commissions);

  -- ======= SEED P&L =======
  -- Total cash collected by AMM from buys
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM trades WHERE market_id = p_market_id AND direction = 'buy';

  -- Total cash paid out by AMM on sells (net proceeds to users)
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM trades WHERE market_id = p_market_id AND direction = 'sell';

  -- Seed P&L = cash_in - cash_out_from_sells - resolution_payouts
  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_paid;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  -- ======= UPDATE LEADER STATS ACCURACY =======
  -- Users with winning-side positions get a "winning trade" credit
  UPDATE leader_stats SET
    winning_trades = winning_trades + 1,
    accuracy_pct = CASE WHEN total_trades > 0
      THEN ROUND((winning_trades + 1)::DECIMAL / total_trades * 100, 2) ELSE 0 END
  WHERE user_id IN (
    SELECT DISTINCT user_id FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2),
    'total_commissions', ROUND(v_total_commissions, 2),
    'seed_pnl', ROUND(v_seed_pnl, 2)
  );
END;
$$;
