-- 143_agent_wallet.sql — Separate agent wallet for commission earnings
-- Commissions now credit to agent_balance_usd (not balance_usd).
-- Users transfer from Agent Wallet → Portfolio to trade or withdraw.

BEGIN;

-- ============================================================
-- 1. Add agent_balance_usd column
-- ============================================================
-- No retroactive data migration: existing credited commissions stay in balance_usd.

ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_balance_usd NUMERIC(12,2) NOT NULL DEFAULT 0.00;


-- ============================================================
-- 2. Update _credit_commission to credit agent_balance_usd
-- ============================================================

CREATE OR REPLACE FUNCTION _credit_commission(
  p_ancestor_id UUID,
  p_bettor_id UUID,
  p_market_id UUID,
  p_trade_id UUID,
  p_layer INTEGER,
  p_agent_level INTEGER,
  p_platform_revenue DECIMAL,
  p_fee_type TEXT,
  p_revenue_type TEXT
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  -- Look up rate from fee_config
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = p_fee_type
    AND level = p_agent_level
    AND depth = p_layer;

  -- Skip if no rate configured or rate is zero
  IF v_rate IS NULL OR v_rate = 0 THEN
    RETURN 0;
  END IF;

  -- Calculate commission
  v_commission := p_platform_revenue * v_rate;

  -- Dust threshold: skip sub-penny commissions
  IF v_commission < 0.01 THEN
    RETURN 0;
  END IF;

  -- Insert commission record
  INSERT INTO referral_commissions (
    referrer_id, bettor_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type
  ) VALUES (
    p_ancestor_id, p_bettor_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission, 'credited', p_revenue_type
  );

  -- Credit ancestor AGENT WALLET (not portfolio balance)
  UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
  WHERE id = p_ancestor_id
  RETURNING agent_balance_usd INTO v_new_balance;

  -- Ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_ancestor_id, 'commission', v_commission,
    v_new_balance,
    COALESCE(p_trade_id, p_market_id),
    'Commission (Layer ' || p_layer || ', ' || p_revenue_type || ') — '
    || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 2) || ' platform revenue'
  );

  RETURN v_commission;
END;
$$;


-- ============================================================
-- 3. Update void market clawback to debit agent_balance_usd
-- ============================================================

CREATE OR REPLACE FUNCTION _void_market_internal(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_comm RECORD;
  v_user RECORD;
  v_refund_amount DECIMAL;
  v_refunds INTEGER := 0;
BEGIN
  -- Lock market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ======= 1. CLAW BACK CREDITED COMMISSIONS (from agent wallet) =======
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Debit the referrer's AGENT WALLET (clamp to 0 if already transferred out)
    UPDATE users SET agent_balance_usd = GREATEST(agent_balance_usd - v_comm.commission_amount, 0)
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_user.agent_balance_usd;

    -- Negative ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_comm.commission_amount,
      v_user.agent_balance_usd,
      p_market_id,
      'Commission clawed back — market voided'
    );
  END LOOP;

  -- Void all commission records
  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ======= 2. REFUND ALL POSITIONS =======
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id AND shares_held > 0
    ORDER BY user_id
  LOOP
    SELECT * INTO v_pos_user FROM users WHERE id = v_pos.user_id FOR UPDATE;

    v_refund_amount := v_pos.shares_held * v_pos.avg_entry_price;

    IF v_refund_amount > 0 THEN
      UPDATE users SET balance_usd = balance_usd + v_refund_amount
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_pos_user.balance_usd;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'refund', v_refund_amount,
        v_pos_user.balance_usd,
        p_market_id,
        'Market voided — position refunded (' || v_pos.side || ')'
      );

      v_refunds := v_refunds + 1;
    END IF;
  END LOOP;

  -- ======= 3. UPDATE MARKET STATUS =======
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunds_issued', v_refunds
  );
END;
$$;


-- ============================================================
-- 4. New RPC: transfer_agent_to_portfolio
-- ============================================================

CREATE OR REPLACE FUNCTION transfer_agent_to_portfolio(p_amount NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_new_agent_balance NUMERIC;
  v_new_portfolio_balance NUMERIC;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  -- Lock user row
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  IF v_user.agent_balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient agent wallet balance';
  END IF;

  -- Atomically debit agent wallet, credit portfolio
  UPDATE users
  SET agent_balance_usd = agent_balance_usd - p_amount,
      balance_usd = balance_usd + p_amount
  WHERE id = v_user_id
  RETURNING agent_balance_usd, balance_usd
  INTO v_new_agent_balance, v_new_portfolio_balance;

  -- Paired ledger entries
  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_user_id, 'agent_transfer_out', -p_amount, v_new_agent_balance,
     'Transfer from Agent Wallet to Portfolio'),
    (v_user_id, 'agent_transfer_in', p_amount, v_new_portfolio_balance,
     'Transfer from Agent Wallet to Portfolio');

  RETURN jsonb_build_object(
    'agent_balance_usd', v_new_agent_balance,
    'balance_usd', v_new_portfolio_balance
  );
END;
$$;


-- ============================================================
-- 5. Update get_agent_stats to include agent_balance_usd
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user RECORD;
  v_total_credited DECIMAL := 0;
  v_total_pending DECIMAL := 0;
  v_this_month DECIMAL := 0;
  v_network_size INTEGER := 0;
  v_next_tier_volume DECIMAL := 0;
  v_tier1_ids UUID[];
  v_tier2_ids UUID[];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_uid;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Commission totals
  SELECT
    COALESCE(SUM(CASE WHEN status = 'credited' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'escrowed' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'credited'
      AND created_at >= date_trunc('month', now()) THEN commission_amount ELSE 0 END), 0)
  INTO v_total_credited, v_total_pending, v_this_month
  FROM referral_commissions
  WHERE referrer_id = v_uid;

  -- Network size: count all 3 layers
  SELECT ARRAY_AGG(id) INTO v_tier1_ids
  FROM users WHERE referred_by = v_uid;

  IF v_tier1_ids IS NOT NULL THEN
    v_network_size := array_length(v_tier1_ids, 1);

    SELECT ARRAY_AGG(id) INTO v_tier2_ids
    FROM users WHERE referred_by = ANY(v_tier1_ids);

    IF v_tier2_ids IS NOT NULL THEN
      v_network_size := v_network_size + array_length(v_tier2_ids, 1);

      v_network_size := v_network_size + (
        SELECT COUNT(*)::INTEGER FROM users WHERE referred_by = ANY(v_tier2_ids)
      );
    END IF;
  END IF;

  -- Next tier volume
  v_next_tier_volume := CASE
    WHEN v_user.agent_level >= 4 THEN 0
    WHEN v_user.agent_level = 3 THEN 200000 - v_user.network_volume
    WHEN v_user.agent_level = 2 THEN 50000 - v_user.network_volume
    ELSE 10000 - v_user.network_volume
  END;
  IF v_next_tier_volume < 0 THEN v_next_tier_volume := 0; END IF;

  RETURN jsonb_build_object(
    'agent_balance_usd', v_user.agent_balance_usd,
    'total_credited', v_total_credited,
    'total_pending', v_total_pending,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume
  );
END;
$$;


-- ============================================================
-- 6. Update reconcile_balances to handle both balances
-- ============================================================

CREATE OR REPLACE FUNCTION reconcile_balances()
RETURNS TABLE(
  user_id UUID,
  cached_balance DECIMAL,
  ledger_balance DECIMAL,
  difference DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  -- Portfolio balance reconciliation (excludes commission and agent_transfer_out)
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.balance_usd AS cached_balance,
    COALESCE(SUM(t.amount), 0) AS ledger_balance,
    u.balance_usd - COALESCE(SUM(t.amount), 0) AS difference
  FROM users u
  LEFT JOIN transactions t ON t.user_id = u.id
    AND t.type NOT IN ('commission', 'agent_transfer_out')
  GROUP BY u.id, u.balance_usd
  HAVING ABS(u.balance_usd - COALESCE(SUM(t.amount), 0)) > 0.001;
END;
$$;

-- Agent wallet reconciliation
CREATE OR REPLACE FUNCTION reconcile_agent_balances()
RETURNS TABLE(
  user_id UUID,
  cached_balance DECIMAL,
  ledger_balance DECIMAL,
  difference DECIMAL
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id AS user_id,
    u.agent_balance_usd AS cached_balance,
    COALESCE(SUM(t.amount), 0) AS ledger_balance,
    u.agent_balance_usd - COALESCE(SUM(t.amount), 0) AS difference
  FROM users u
  LEFT JOIN transactions t ON t.user_id = u.id
    AND t.type IN ('commission', 'agent_transfer_out')
  GROUP BY u.id, u.agent_balance_usd
  HAVING ABS(u.agent_balance_usd - COALESCE(SUM(t.amount), 0)) > 0.001;
END;
$$;

COMMIT;
