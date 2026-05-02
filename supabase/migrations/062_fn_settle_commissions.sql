-- 021c_fn_settle_commissions.sql — Multi-level commission settlement
-- Commission on NET EXPOSURE only. Walk referral_chain max 3 deep.
-- Agent level at time of resolution. Rates from fee_config table.

CREATE OR REPLACE FUNCTION settle_commissions(
  p_market_id UUID
)
RETURNS DECIMAL  -- total commissions paid
LANGUAGE plpgsql
AS $$
DECLARE
  v_bettor RECORD;
  v_net_exposure DECIMAL;
  v_yes_total DECIMAL;
  v_no_total DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_depth INTEGER;
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  -- For each unique bettor on this market
  FOR v_bettor IN
    SELECT DISTINCT b.user_id, u.referral_chain
    FROM bets b
    JOIN users u ON u.id = b.user_id
    WHERE b.market_id = p_market_id
      AND array_length(u.referral_chain, 1) > 0  -- has referrers
  LOOP
    -- Calculate net exposure = ABS(SUM(YES) - SUM(NO))
    SELECT COALESCE(SUM(CASE WHEN side = 'yes' THEN amount ELSE 0 END), 0),
           COALESCE(SUM(CASE WHEN side = 'no' THEN amount ELSE 0 END), 0)
    INTO v_yes_total, v_no_total
    FROM bets WHERE user_id = v_bettor.user_id AND market_id = p_market_id;

    v_net_exposure := ABS(v_yes_total - v_no_total);

    -- If net_exposure = 0 (hedged), skip — no commission for hedged bets
    IF v_net_exposure = 0 THEN
      CONTINUE;
    END IF;

    -- Walk referral chain (max 3 ancestors)
    FOR v_depth IN 1..LEAST(array_length(v_bettor.referral_chain, 1), 3) LOOP
      v_ancestor_id := v_bettor.referral_chain[v_depth];

      IF v_ancestor_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Read ancestor's current agent level
      SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
      IF v_ancestor IS NULL THEN
        CONTINUE;
      END IF;

      -- Look up commission rate from fee_config
      SELECT rate INTO v_rate
      FROM fee_config
      WHERE fee_type = 'commission'
        AND level = v_ancestor.agent_level
        AND depth = v_depth;

      IF v_rate IS NULL OR v_rate = 0 THEN
        CONTINUE;
      END IF;

      v_commission := v_net_exposure * v_rate;

      -- Insert commission record (credited immediately at resolution)
      INSERT INTO referral_commissions (
        referrer_id, bettor_id, market_id, depth,
        agent_level_at_time, net_exposure, commission_rate,
        commission_amount, status
      ) VALUES (
        v_ancestor_id, v_bettor.user_id, p_market_id, v_depth,
        v_ancestor.agent_level, v_net_exposure, v_rate,
        v_commission, 'credited'
      );

      -- Credit ancestor balance
      UPDATE users SET balance_usd = balance_usd + v_commission
      WHERE id = v_ancestor_id;

      -- Ledger entry
      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_ancestor_id, 'commission', v_commission,
        v_ancestor.balance_usd + v_commission,
        p_market_id,
        'Commission (Tier ' || v_depth || ') from market resolution'
      );

      v_total_commissions := v_total_commissions + v_commission;
    END LOOP;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;
