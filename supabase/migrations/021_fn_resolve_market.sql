-- 021_fn_resolve_market.sql — Orchestrator: resolve market with decomposed sub-functions
-- Admin only. Calls calculate_payouts, distribute_payouts, settle_commissions, record_revenue.
-- Empty-side → auto-void.

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
  v_distribute_result JSONB;
  v_total_commissions DECIMAL;
  v_winning_bets INTEGER;
BEGIN
  -- Admin check
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  -- Check if winning side has bets (empty-side → void)
  SELECT COUNT(*) INTO v_winning_bets
  FROM bets WHERE market_id = p_market_id AND side = p_outcome;

  IF v_winning_bets = 0 THEN
    -- Auto-void: no winners means refund everyone
    PERFORM void_market(p_market_id);
    RETURN jsonb_build_object(
      'success', TRUE,
      'action', 'voided',
      'reason', 'No bets on winning side'
    );
  END IF;

  -- 1. Distribute payouts to winners
  v_distribute_result := distribute_payouts(p_market_id, p_outcome);

  -- 2. Settle commissions (multi-level, net-exposure cap)
  v_total_commissions := settle_commissions(p_market_id);

  -- 3. Record platform revenue
  PERFORM record_revenue(p_market_id, v_total_commissions);

  -- 4. Update market status
  UPDATE markets SET
    status = 'resolved',
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'winners_paid', (v_distribute_result->>'winners_paid')::INTEGER,
    'total_paid', (v_distribute_result->>'total_paid')::DECIMAL,
    'total_commissions', ROUND(v_total_commissions, 2)
  );
END;
$$;
