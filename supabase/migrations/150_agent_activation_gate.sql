-- 150_agent_activation_gate.sql — Agent activation gate: 10 qualified referrals required
-- Commissions are escrowed until agent has 10 referred users who each completed 1+ trade.
-- Admin can override per-user (non-inheritable). Override removal re-escrows future commissions.

-- NOTE: transaction_type enum extension must be outside the transaction block
ALTER TYPE transaction_type ADD VALUE IF NOT EXISTS 'commission_release';


BEGIN;

-- ============================================================
-- 1. Add activation columns to users
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_activated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS agent_activation_override BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS qualified_referral_count INTEGER NOT NULL DEFAULT 0;


-- ============================================================
-- 2. Helper: check if agent is activated
-- ============================================================

CREATE OR REPLACE FUNCTION _is_agent_activated(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_activated BOOLEAN;
  v_override BOOLEAN;
BEGIN
  SELECT agent_activated, agent_activation_override
  INTO v_activated, v_override
  FROM users WHERE id = p_user_id;

  RETURN COALESCE(v_activated OR v_override, FALSE);
END;
$$;


-- ============================================================
-- 3. Release escrowed commissions (does NOT set agent_activated)
-- ============================================================

CREATE OR REPLACE FUNCTION _release_escrowed_commissions(p_user_id UUID)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_escrowed DECIMAL := 0;
  v_new_balance DECIMAL;
BEGIN
  -- Sum all escrowed commissions
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_escrowed
  FROM referral_commissions
  WHERE referrer_id = p_user_id AND status = 'escrowed';

  IF v_total_escrowed <= 0 THEN
    RETURN 0;
  END IF;

  -- Flip all escrowed -> credited
  UPDATE referral_commissions SET status = 'credited'
  WHERE referrer_id = p_user_id AND status = 'escrowed';

  -- Credit agent wallet
  UPDATE users SET agent_balance_usd = agent_balance_usd + v_total_escrowed
  WHERE id = p_user_id
  RETURNING agent_balance_usd INTO v_new_balance;

  -- Ledger entry for the bulk release
  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES (
    p_user_id, 'commission_release', v_total_escrowed, v_new_balance,
    'Agent activated — $' || ROUND(v_total_escrowed, 2) || ' in escrowed commissions released'
  );

  RETURN v_total_escrowed;
END;
$$;


-- ============================================================
-- 4. Updated _credit_commission — escrow if not activated
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
  v_activated BOOLEAN;
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

  -- Check activation status
  v_activated := _is_agent_activated(p_ancestor_id);

  -- Insert commission record (escrowed if not activated)
  INSERT INTO referral_commissions (
    referrer_id, bettor_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type
  ) VALUES (
    p_ancestor_id, p_bettor_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission,
    CASE WHEN v_activated THEN 'credited'::commission_status ELSE 'escrowed'::commission_status END,
    p_revenue_type
  );

  -- Only credit balance + ledger if activated
  IF v_activated THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
    WHERE id = p_ancestor_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      p_ancestor_id, 'commission', v_commission,
      v_new_balance,
      COALESCE(p_trade_id, p_market_id),
      'Commission (Layer ' || p_layer || ', ' || p_revenue_type || ') — '
      || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 2) || ' platform revenue'
    );
  END IF;

  RETURN v_commission;
END;
$$;


-- ============================================================
-- 5. Updated pay_trade_commissions — first-trade detection
-- ============================================================

CREATE OR REPLACE FUNCTION pay_trade_commissions(
  p_trade_id UUID,
  p_user_id UUID,
  p_trade_amount DECIMAL
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade RECORD;
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
  v_new_level INTEGER;
  -- First-trade activation variables
  v_is_first_trade BOOLEAN;
  v_referrer_id UUID;
  v_new_qual_count INTEGER;
  v_referrer_activated BOOLEAN;
  v_referrer_override BOOLEAN;
BEGIN
  -- 1. Read trade record for fee columns
  SELECT explicit_fee, amm_spread_cost, cash_out_premium, market_id
  INTO v_trade
  FROM trades WHERE id = p_trade_id;

  IF v_trade IS NULL THEN
    RETURN 0;
  END IF;

  -- 2. Calculate total platform revenue from this trade
  v_platform_revenue := v_trade.explicit_fee + v_trade.amm_spread_cost + v_trade.cash_out_premium;

  IF v_platform_revenue <= 0 THEN
    RETURN 0;
  END IF;

  -- 3. First-trade detection: increment referrer's qualified_referral_count
  v_is_first_trade := NOT EXISTS (
    SELECT 1 FROM trades
    WHERE user_id = p_user_id AND id != p_trade_id
    LIMIT 1
  );

  IF v_is_first_trade THEN
    -- Get direct referrer
    SELECT referred_by INTO v_referrer_id FROM users WHERE id = p_user_id;

    IF v_referrer_id IS NOT NULL THEN
      UPDATE users
      SET qualified_referral_count = qualified_referral_count + 1
      WHERE id = v_referrer_id
      RETURNING qualified_referral_count, agent_activated, agent_activation_override
      INTO v_new_qual_count, v_referrer_activated, v_referrer_override;

      -- Check if referrer just hit the threshold (organic activation)
      IF NOT v_referrer_activated AND v_new_qual_count >= 10 THEN
        UPDATE users SET agent_activated = TRUE WHERE id = v_referrer_id;
        PERFORM _release_escrowed_commissions(v_referrer_id);
      END IF;
    END IF;
  END IF;

  -- 4. Read trader's referral chain
  SELECT referral_chain INTO v_chain
  FROM users WHERE id = p_user_id;

  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL OR array_length(v_chain, 1) = 0 THEN
    RETURN 0;
  END IF;

  -- 5. Single-pass loop: volume + tier + commission for each ancestor
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 3) LOOP
    v_ancestor_id := v_chain[v_layer];

    IF v_ancestor_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id;
    IF v_ancestor IS NULL THEN
      CONTINUE;
    END IF;

    -- a. Update network volume
    UPDATE users SET network_volume = network_volume + p_trade_amount
    WHERE id = v_ancestor_id;

    -- b. Inline tier advancement check (ratchet: only goes up)
    v_new_level := CASE
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 200000 THEN 4
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 50000  THEN 3
      WHEN (v_ancestor.network_volume + p_trade_amount) >= 10000  THEN 2
      ELSE 1
    END;

    IF v_new_level > v_ancestor.agent_level THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    -- c. Credit commission via shared helper (handles escrow/credit)
    v_commission := _credit_commission(
      v_ancestor_id, p_user_id, v_trade.market_id, p_trade_id,
      v_layer, v_ancestor.agent_level, v_platform_revenue,
      'ngr_commission', 'trade'
    );

    v_total_commissions := v_total_commissions + v_commission;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;


-- ============================================================
-- 6. Admin RPC: toggle agent activation override
-- ============================================================

CREATE OR REPLACE FUNCTION toggle_agent_activation_override(
  p_user_id UUID,
  p_override BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_admin_id UUID;
  v_released DECIMAL := 0;
  v_user RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Update override flag
  UPDATE users SET agent_activation_override = p_override WHERE id = p_user_id;

  -- If enabling override, release escrowed commissions (but don't set agent_activated)
  IF p_override THEN
    SELECT agent_activated INTO v_user FROM users WHERE id = p_user_id;
    IF NOT v_user.agent_activated THEN
      v_released := _release_escrowed_commissions(p_user_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'override', p_override,
    'released', v_released
  );
END;
$$;


-- ============================================================
-- 7. Updated get_agent_stats — activation fields
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
  v_total_escrowed DECIMAL := 0;
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
  INTO v_total_credited, v_total_escrowed, v_this_month
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
    'total_pending', v_total_escrowed,
    'total_escrowed', v_total_escrowed,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume,
    'agent_activated', (v_user.agent_activated OR v_user.agent_activation_override),
    'qualified_referral_count', v_user.qualified_referral_count,
    'activation_threshold', 10
  );
END;
$$;


-- ============================================================
-- 8. Updated get_agent_commission_feed — include escrowed items
-- ============================================================

CREATE OR REPLACE FUNCTION get_agent_commission_feed(
  p_limit INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0,
  p_layer_filter INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_row RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  FOR v_row IN
    SELECT
      rc.id,
      COALESCE(
        split_part(u.display_name, ' ', 1) || ' ' ||
        LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
        u.phone
      ) AS bettor_name,
      m.question_en AS market_question,
      t.side AS trade_side,
      t.total_cost AS trade_amount,
      rc.platform_revenue_amount AS platform_revenue,
      rc.commission_amount,
      rc.layer,
      rc.revenue_type,
      rc.status,
      rc.created_at
    FROM referral_commissions rc
    JOIN users u ON u.id = rc.bettor_id
    JOIN markets m ON m.id = rc.market_id
    LEFT JOIN trades t ON t.id = rc.trade_id
    WHERE rc.referrer_id = v_uid
      AND rc.status IN ('credited', 'escrowed')
      AND (p_layer_filter IS NULL OR rc.layer = p_layer_filter)
    ORDER BY rc.created_at DESC
    LIMIT p_limit
    OFFSET p_offset
  LOOP
    v_result := v_result || jsonb_build_object(
      'id', v_row.id,
      'bettor_name', v_row.bettor_name,
      'market_question', v_row.market_question,
      'trade_side', v_row.trade_side,
      'trade_amount', v_row.trade_amount,
      'platform_revenue', v_row.platform_revenue,
      'commission_amount', v_row.commission_amount,
      'layer', v_row.layer,
      'revenue_type', v_row.revenue_type,
      'status', v_row.status,
      'created_at', v_row.created_at
    );
  END LOOP;

  RETURN v_result;
END;
$$;


-- ============================================================
-- 9. Updated reconcile_agent_balances — include commission_release
-- ============================================================

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
    AND t.type IN ('commission', 'commission_release', 'agent_transfer_out')
  GROUP BY u.id, u.agent_balance_usd
  HAVING ABS(u.agent_balance_usd - COALESCE(SUM(t.amount), 0)) > 0.001;
END;
$$;


-- ============================================================
-- 10. Grandfathering: backfill existing users
-- ============================================================

-- Mark all users who have any credited commissions as activated
UPDATE users SET agent_activated = TRUE
WHERE id IN (
  SELECT DISTINCT referrer_id FROM referral_commissions WHERE status = 'credited'
);

-- Backfill qualified_referral_count for all users
UPDATE users u SET qualified_referral_count = sub.cnt
FROM (
  SELECT u2.referred_by AS referrer_id, COUNT(DISTINCT u2.id) AS cnt
  FROM users u2
  WHERE u2.referred_by IS NOT NULL
    AND EXISTS (SELECT 1 FROM trades t WHERE t.user_id = u2.id LIMIT 1)
  GROUP BY u2.referred_by
) sub
WHERE u.id = sub.referrer_id;


-- ============================================================
-- 11. Index for first-trade check performance
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_trades_user_id ON trades(user_id);

COMMIT;
