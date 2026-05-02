-- 021b_fn_distribute_payouts.sql — Credit each winner + ledger entries

CREATE OR REPLACE FUNCTION distribute_payouts(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_payout RECORD;
  v_user RECORD;
  v_winners_paid INTEGER := 0;
  v_total_paid DECIMAL := 0;
BEGIN
  FOR v_payout IN SELECT * FROM calculate_payouts(p_market_id, p_outcome) LOOP
    -- Lock user row
    SELECT * INTO v_user FROM users WHERE id = v_payout.user_id FOR UPDATE;

    -- Credit winner
    UPDATE users SET balance_usd = balance_usd + v_payout.payout_amount
    WHERE id = v_payout.user_id;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_payout.user_id, 'win', v_payout.payout_amount,
      v_user.balance_usd + v_payout.payout_amount,
      p_market_id,
      'Won bet on market'
    );

    v_winners_paid := v_winners_paid + 1;
    v_total_paid := v_total_paid + v_payout.payout_amount;
  END LOOP;

  RETURN jsonb_build_object(
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2)
  );
END;
$$;
