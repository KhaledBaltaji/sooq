-- Migration 154: Admin audit logging, fee update RPC, atomic market create/update
-- Part of admin panel hardening (Phase 2)

-- ============================================================
-- 1. Add audit logging to resolve_market
-- ============================================================

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
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

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

    -- Audit: auto-void
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


-- ============================================================
-- 2. Add audit logging to lock_market
-- ============================================================

CREATE OR REPLACE FUNCTION lock_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
BEGIN
  v_user_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open (status: %)', v_market.status;
  END IF;

  UPDATE markets SET status = 'closed' WHERE id = p_market_id;

  -- Audit: market locked
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/lock', 'Market locked',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN jsonb_build_object('success', TRUE, 'market_id', p_market_id, 'new_status', 'closed');
END;
$$;


-- ============================================================
-- 3. Add audit logging to void_market
-- ============================================================

CREATE OR REPLACE FUNCTION void_market(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  v_result := _void_market_internal(p_market_id);

  -- Audit: market voided
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/void', 'Market voided',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN v_result;
END;
$$;


-- ============================================================
-- 4. admin_update_fee: PIN-protected fee update with audit trail
-- ============================================================

CREATE OR REPLACE FUNCTION admin_update_fee(
  p_fee_id UUID,
  p_new_rate DECIMAL,
  p_pin TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_old_rate DECIMAL;
  v_fee_type TEXT;
  v_fee_desc TEXT;
BEGIN
  -- 1. Verify caller is admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  -- 2. Get admin config + verify PIN
  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = v_admin_id FOR UPDATE;
  IF v_config IS NULL THEN
    RAISE EXCEPTION 'Admin PIN not configured. Set up your PIN first.';
  END IF;

  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;

  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    UPDATE admin_config SET
      failed_pin_attempts = failed_pin_attempts + 1,
      pin_locked_until = CASE
        WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = v_admin_id;

  -- 3. Get current fee info
  SELECT rate, fee_type, description INTO v_old_rate, v_fee_type, v_fee_desc
  FROM fee_config WHERE id = p_fee_id;

  IF v_fee_type IS NULL THEN
    RAISE EXCEPTION 'Fee config not found';
  END IF;

  -- 4. Validate rate bounds
  IF p_new_rate < 0 THEN
    RAISE EXCEPTION 'Rate cannot be negative';
  END IF;

  -- 5. Update fee
  UPDATE fee_config SET rate = p_new_rate WHERE id = p_fee_id;

  -- 6. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/fee', format('Fee updated: %s (%s → %s)', v_fee_type, v_old_rate, p_new_rate),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'fee_id', p_fee_id,
      'fee_type', v_fee_type,
      'old_rate', v_old_rate,
      'new_rate', p_new_rate,
      'description', v_fee_desc
    ));

  RETURN jsonb_build_object(
    'success', true,
    'fee_type', v_fee_type,
    'old_rate', v_old_rate,
    'new_rate', p_new_rate
  );
END;
$$;


-- ============================================================
-- 5. admin_create_market: Atomic market creation + AMM init
-- ============================================================

CREATE OR REPLACE FUNCTION admin_create_market(
  p_question_en TEXT,
  p_question_ar TEXT,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'politics',
  p_keywords TEXT[] DEFAULT '{}',
  p_liquidity_param DECIMAL DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT now(),
  p_closes_at TIMESTAMPTZ DEFAULT now() + interval '7 days'
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- 1. Verify admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 2. Validate inputs
  IF p_question_en IS NULL OR length(trim(p_question_en)) = 0 THEN
    RAISE EXCEPTION 'English question is required';
  END IF;
  IF p_question_ar IS NULL OR length(trim(p_question_ar)) = 0 THEN
    RAISE EXCEPTION 'Arabic question is required';
  END IF;
  IF p_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;

  -- 3. Determine liquidity parameter
  IF p_liquidity_param IS NULL THEN
    SELECT rate INTO v_b FROM fee_config WHERE fee_type = 'amm_default_b' LIMIT 1;
    v_b := COALESCE(v_b, 1000);
  ELSE
    v_b := p_liquidity_param;
  END IF;

  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- 4. Insert market
  INSERT INTO markets (question_en, question_ar, description_en, description_ar,
                       category, keywords, amm_liquidity_param, opens_at, closes_at,
                       created_by, status)
  VALUES (p_question_en, p_question_ar, p_description_en, p_description_ar,
          p_category, p_keywords, v_b, p_opens_at, p_closes_at,
          v_admin_id, 'open')
  RETURNING id INTO v_market_id;

  -- 5. Initialize AMM (inline, same logic as initialize_amm)
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price := lmsr_price(v_b, 0, 0, 'no');

  INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price)
  VALUES (v_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- 6. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_market', format('Market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'category', p_category,
      'liquidity_param', v_b,
      'opens_at', p_opens_at,
      'closes_at', p_closes_at
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', v_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;


-- ============================================================
-- 6. admin_update_market: Edit market details (non-resolved/voided)
-- ============================================================

CREATE OR REPLACE FUNCTION admin_update_market(
  p_market_id UUID,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_closes_at TIMESTAMPTZ DEFAULT NULL,
  p_keywords TEXT[] DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market RECORD;
BEGIN
  -- 1. Verify admin
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- 2. Validate market
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status IN ('resolved', 'voided') THEN
    RAISE EXCEPTION 'Cannot edit a % market', v_market.status;
  END IF;

  -- 3. Validate closes_at if provided
  IF p_closes_at IS NOT NULL AND p_closes_at <= v_market.opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;

  -- 4. Update only provided fields
  UPDATE markets SET
    description_en = COALESCE(p_description_en, description_en),
    description_ar = COALESCE(p_description_ar, description_ar),
    closes_at = COALESCE(p_closes_at, closes_at),
    keywords = COALESCE(p_keywords, keywords)
  WHERE id = p_market_id;

  -- 5. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/update_market', format('Market updated: %s', left(v_market.question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', p_market_id,
      'updated_fields', jsonb_build_object(
        'description_en', p_description_en IS NOT NULL,
        'description_ar', p_description_ar IS NOT NULL,
        'closes_at', p_closes_at IS NOT NULL,
        'keywords', p_keywords IS NOT NULL
      )
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', p_market_id
  );
END;
$$;
