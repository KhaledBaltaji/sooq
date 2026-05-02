-- 111_v3_fn_settle_commissions.sql — V3 multi-level commission settlement
-- Commission on EXPLICIT FEE only (not exposure). Walk referral_chain max 3 layers.
-- Rates from fee_config WHERE fee_type = 'v3_commission'.

CREATE OR REPLACE FUNCTION settle_commissions(
  p_market_id UUID
)
RETURNS DECIMAL  -- total commissions paid
LANGUAGE plpgsql
AS $$
DECLARE
  v_trader RECORD;
  v_total_fees DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  -- Idempotency guard: skip if already settled for this market
  IF EXISTS (SELECT 1 FROM referral_commissions WHERE market_id = p_market_id LIMIT 1) THEN
    RETURN 0;
  END IF;

  -- For each unique trader on this market who has referrers
  FOR v_trader IN
    SELECT DISTINCT t.user_id, u.referral_chain
    FROM trades t
    JOIN users u ON u.id = t.user_id
    WHERE t.market_id = p_market_id
      AND u.referral_chain IS NOT NULL
      AND array_length(u.referral_chain, 1) > 0
    ORDER BY t.user_id  -- consistent lock order to prevent deadlocks
  LOOP
    -- Sum total explicit fees from ALL trades (buys + sells) on this market
    SELECT COALESCE(SUM(explicit_fee), 0) INTO v_total_fees
    FROM trades WHERE user_id = v_trader.user_id AND market_id = p_market_id;

    IF v_total_fees = 0 THEN
      CONTINUE;
    END IF;

    -- Walk referral chain max 3 layers
    FOR v_layer IN 1..LEAST(array_length(v_trader.referral_chain, 1), 3) LOOP
      v_ancestor_id := v_trader.referral_chain[v_layer];

      IF v_ancestor_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Lock ancestor row and read agent level
      SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
      IF v_ancestor IS NULL THEN
        CONTINUE;
      END IF;

      -- Look up V3 commission rate from fee_config
      -- fee_config uses 'depth' column (not renamed), referral_commissions uses 'layer'
      SELECT rate INTO v_rate
      FROM fee_config
      WHERE fee_type = 'v3_commission'
        AND level = v_ancestor.agent_level
        AND depth = v_layer;

      IF v_rate IS NULL OR v_rate = 0 THEN
        CONTINUE;
      END IF;

      -- Commission = total explicit fees × rate (rate is % of the 0.5% fee)
      v_commission := v_total_fees * v_rate;

      -- Insert commission record
      INSERT INTO referral_commissions (
        referrer_id, bettor_id, market_id, layer,
        agent_level_at_time, explicit_fee_amount, commission_rate,
        commission_amount, status
      ) VALUES (
        v_ancestor_id, v_trader.user_id, p_market_id, v_layer,
        v_ancestor.agent_level, v_total_fees, v_rate,
        v_commission, 'credited'
      );

      -- Credit ancestor balance
      UPDATE users SET balance_usd = balance_usd + v_commission
      WHERE id = v_ancestor_id
      RETURNING balance_usd INTO v_ancestor.balance_usd;

      -- Ledger entry (balance_after from RETURNING, always fresh)
      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_ancestor_id, 'commission', v_commission,
        v_ancestor.balance_usd,
        p_market_id,
        'Commission (Layer ' || v_layer || ') from market resolution'
      );

      v_total_commissions := v_total_commissions + v_commission;
    END LOOP;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;
