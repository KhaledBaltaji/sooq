-- 245_snapshot_resolution_fee.sql — Freeze resolution_fee rate at market creation
--
-- Phase 1 audit fix (P1-02): every resolution-time function reads `fee_config`
-- live for the resolution_fee rate. If admin changes the rate between trade
-- placement and resolution, every winner gets a different payout than they
-- expected. This is a money-loss bug.
--
-- Fix: snapshot the rate on the market row at create time. All read paths
-- (resolve_market, branch_settle_resolution, settle_resolution_commissions,
-- record_revenue) prefer the snapshot, fall back to live fee_config if NULL
-- (back-compat for markets created before this migration is applied — they
-- get backfilled below).
--
-- Future fee changes apply only to markets created AFTER the change.
-- Snapshotting at create-time (vs lock-time) is the more conservative choice:
-- the rate users see when they trade is the rate they get paid.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Add column (nullable so back-compat fallback works)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS resolution_fee_rate_snapshot DECIMAL(8,6);

COMMENT ON COLUMN markets.resolution_fee_rate_snapshot IS
  'Resolution fee rate frozen at market creation. NULL means use live fee_config (back-compat).';

-- ═══════════════════════════════════════════════════════════
-- 2. Backfill existing markets with current fee_config value
--    Use the canonical row (lowest id wins ties — see migration 246 dedupe).
-- ═══════════════════════════════════════════════════════════

UPDATE markets m
SET resolution_fee_rate_snapshot = (
  SELECT rate FROM fee_config
  WHERE fee_type = 'resolution_fee'
  ORDER BY id LIMIT 1
)
WHERE m.resolution_fee_rate_snapshot IS NULL
  AND m.status IN ('draft', 'open', 'closed');
-- Resolved/voided markets: leave NULL since rates are already settled.
-- They'll keep falling back to live fee_config in any retroactive query.

-- ═══════════════════════════════════════════════════════════
-- 3. admin_create_market — populate snapshot at insert
--    Re-defines from migration 241 (image_url param preserved).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_create_market(
  p_question_en TEXT,
  p_question_ar TEXT,
  p_description_en TEXT DEFAULT NULL,
  p_description_ar TEXT DEFAULT NULL,
  p_category TEXT DEFAULT 'politics',
  p_keywords TEXT[] DEFAULT '{}',
  p_liquidity_param DECIMAL DEFAULT NULL,
  p_opens_at TIMESTAMPTZ DEFAULT now(),
  p_closes_at TIMESTAMPTZ DEFAULT now() + interval '7 days',
  p_image_url TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
  v_resolution_fee_rate DECIMAL;
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
    SELECT rate INTO v_b FROM fee_config WHERE fee_type = 'amm_default_b' ORDER BY id LIMIT 1;
    v_b := COALESCE(v_b, 1000);
  ELSE
    v_b := p_liquidity_param;
  END IF;

  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- 4. Snapshot resolution_fee rate (frozen for the market's life)
  SELECT rate INTO v_resolution_fee_rate
  FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- 5. Insert market with snapshot
  INSERT INTO markets (question_en, question_ar, description_en, description_ar,
                       category, keywords, amm_liquidity_param, opens_at, closes_at,
                       created_by, status, image_url, resolution_fee_rate_snapshot)
  VALUES (p_question_en, p_question_ar, p_description_en, p_description_ar,
          p_category, p_keywords, v_b, p_opens_at, p_closes_at,
          v_admin_id, 'open', p_image_url, v_resolution_fee_rate)
  RETURNING id INTO v_market_id;

  -- 6. Initialize AMM
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price := lmsr_price(v_b, 0, 0, 'no');

  INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price)
  VALUES (v_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- 7. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_market', format('Market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'category', p_category,
      'liquidity_param', v_b,
      'opens_at', p_opens_at,
      'closes_at', p_closes_at,
      'image_url', p_image_url IS NOT NULL,
      'resolution_fee_rate_snapshot', v_resolution_fee_rate
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', v_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6),
    'resolution_fee_rate', v_resolution_fee_rate
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 4. resolve_market — read snapshot, fall back to live
--    Re-defines from migration 220 (PIN gate preserved, branch-aware preserved).
-- ═══════════════════════════════════════════════════════════

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
  v_branch_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- PIN verification
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

  -- Use snapshot if present, else fall back to live config (back-compat)
  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  v_question := LEFT(COALESCE(v_market.question_en, ''), 60);
  v_outcome_upper := UPPER(p_outcome::text);

  -- Pay retail winners (branch_id IS NULL)
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND side = p_outcome
      AND shares_held > 0
      AND branch_id IS NULL
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
            'Won: ' || ROUND(v_pos.shares_held, 2) || ' shares x $' || ROUND(1.0 - v_resolution_fee_rate, 4)
            || ' (' || ROUND(v_resolution_fee_rate * 100, 2) || '% resolution fee applied)');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  -- Settle branch positions (uses snapshot via market row read internally)
  v_branch_result := branch_settle_resolution(p_market_id, p_outcome);

  -- Update market status
  UPDATE markets SET
    status = 'resolved',
    outcome = p_outcome,
    resolved_at = NOW()
  WHERE id = p_market_id;

  -- Retail commissions (uses snapshot)
  v_total_commissions := settle_resolution_commissions(p_market_id);

  -- Retail revenue (uses snapshot)
  PERFORM record_revenue(p_market_id);

  -- Seed P&L (retail only)
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'sell';

  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_paid;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  -- Leader stats (retail only)
  UPDATE leader_stats SET
    winning_trades = winning_trades + 1,
    accuracy_pct = CASE WHEN total_trades > 0
      THEN ROUND((winning_trades + 1)::DECIMAL / total_trades * 100, 2) ELSE 0 END
  WHERE user_id IN (
    SELECT DISTINCT user_id FROM positions
    WHERE market_id = p_market_id AND side = p_outcome AND shares_held > 0
      AND branch_id IS NULL
  );

  -- Notify retail position holders
  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
  SELECT
    p.user_id, 'resolution_win',
    'You won! Market resolved ' || v_outcome_upper,
    v_outcome_upper || ' تم حل السوق — ربحت',
    'Market "' || v_question || '" resolved ' || v_outcome_upper
      || '. You won $' || ROUND(p.shares_held * (1.0 - v_resolution_fee_rate), 2) || '.',
    'السوق "' || v_question || '" تم حله ' || v_outcome_upper
      || '. ربحت $' || ROUND(p.shares_held * (1.0 - v_resolution_fee_rate), 2) || '.',
    p_market_id
  FROM positions p
  WHERE p.market_id = p_market_id AND p.side = p_outcome AND p.shares_held > 0
    AND p.branch_id IS NULL;

  INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
  SELECT
    p.user_id, 'resolution_loss',
    'Market resolved ' || v_outcome_upper,
    v_outcome_upper || ' تم حل السوق',
    'Market "' || v_question || '" resolved ' || v_outcome_upper
      || '. Your ' || UPPER(p.side::text) || ' position expired.',
    'السوق "' || v_question || '" تم حله ' || v_outcome_upper
      || '. مركزك على ' || UPPER(p.side::text) || ' انتهى.',
    p_market_id
  FROM positions p
  WHERE p.market_id = p_market_id AND p.side != p_outcome AND p.shares_held > 0
    AND p.branch_id IS NULL;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/resolve', format('Market resolved: %s', p_outcome),
    jsonb_build_object(
      'admin_id', v_user_id,
      'market_id', p_market_id,
      'outcome', p_outcome::text,
      'winners_paid', v_winners_paid,
      'total_paid', ROUND(v_total_paid, 2),
      'total_commissions', ROUND(v_total_commissions, 2),
      'seed_pnl', ROUND(v_seed_pnl, 2),
      'resolution_fee_rate_applied', v_resolution_fee_rate,
      'branch_settlement', v_branch_result
    ));

  RETURN jsonb_build_object(
    'success', TRUE,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2),
    'total_commissions', ROUND(v_total_commissions, 2),
    'seed_pnl', ROUND(v_seed_pnl, 2),
    'resolution_fee_rate_applied', v_resolution_fee_rate,
    'branch_settlement', v_branch_result
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

-- ═══════════════════════════════════════════════════════════
-- 5. branch_settle_resolution — read snapshot
--    Re-defines from migration 219 (deficit-clamping pattern unchanged here;
--    that gets fixed in migration 248 alongside the platform_revenue work).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION branch_settle_resolution(
  p_market_id UUID,
  p_outcome bet_side
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market RECORD;
  v_branch_rec RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_resolution_fee_rate DECIMAL;
  v_payout DECIMAL;
  v_fee_amount DECIMAL;
  v_branch_total_paid DECIMAL;
  v_branch_fees DECIMAL;
  v_branch_winners INTEGER;
  v_deficit DECIMAL;
  v_new_worst_case DECIMAL;
  v_branches_settled INTEGER := 0;
  v_total_branch_payouts DECIMAL := 0;
  v_branches_in_payback INTEGER := 0;
  v_branch_id UUID;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Read market for snapshot
  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  -- Use snapshot if present, else fall back
  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_paid := 0;
    v_branch_fees := 0;
    v_branch_winners := 0;

    FOR v_pos IN
      SELECT * FROM positions
      WHERE market_id = p_market_id
        AND branch_id = v_branch_id
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
              'Won (branch): ' || ROUND(v_pos.shares_held, 2) || ' shares x $'
              || ROUND(1.0 - v_resolution_fee_rate, 4));

      v_branch_total_paid := v_branch_total_paid + v_payout;
      v_branch_fees := v_branch_fees + v_fee_amount;
      v_branch_winners := v_branch_winners + 1;
    END LOOP;

    IF v_branch_total_paid > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_paid - v_branch_rec.pool_balance);

      UPDATE branches SET
        pool_balance = GREATEST(0, pool_balance - v_branch_total_paid),
        pending_payouts = CASE WHEN v_deficit > 0 THEN pending_payouts + v_deficit ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'resolution_payout', -v_branch_total_paid,
              GREATEST(0, v_branch_rec.pool_balance - v_branch_total_paid), p_market_id);

      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Resolution shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0
        );
        v_branches_in_payback := v_branches_in_payback + 1;
      END IF;
    END IF;

    v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
    UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;

    PERFORM record_branch_revenue(p_market_id, v_branch_id, p_outcome, v_branch_fees);

    v_branches_settled := v_branches_settled + 1;
    v_total_branch_payouts := v_total_branch_payouts + v_branch_total_paid;

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/resolution', format('Branch %s settled for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'winners', v_branch_winners,
        'total_paid', ROUND(v_branch_total_paid, 2),
        'resolution_fees', ROUND(v_branch_fees, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id),
        'resolution_fee_rate_applied', v_resolution_fee_rate
      ));
  END LOOP;

  RETURN jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback
  );
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 6. settle_resolution_commissions — read snapshot
--    Re-defines from migration 220 (retail-only filter preserved).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION settle_resolution_commissions(
  p_market_id UUID
)
RETURNS DECIMAL
LANGUAGE plpgsql
AS $$
DECLARE
  v_market RECORD;
  v_resolution_fee_rate DECIMAL;
  v_pos RECORD;
  v_chain UUID[];
  v_ancestor_id UUID;
  v_ancestor RECORD;
  v_layer INTEGER;
  v_resolution_revenue DECIMAL;
  v_commission DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM referral_commissions
    WHERE market_id = p_market_id AND revenue_type = 'resolution'
    LIMIT 1
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL OR v_market.outcome IS NULL THEN
    RETURN 0;
  END IF;

  -- Use snapshot if present, else fall back
  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  FOR v_pos IN
    SELECT p.user_id, p.shares_held, u.referral_chain
    FROM positions p
    JOIN users u ON u.id = p.user_id
    WHERE p.market_id = p_market_id
      AND p.side = v_market.outcome
      AND p.shares_held > 0
      AND p.branch_id IS NULL
      AND u.referral_chain IS NOT NULL
      AND array_length(u.referral_chain, 1) > 0
    ORDER BY p.user_id
  LOOP
    v_resolution_revenue := v_pos.shares_held * v_resolution_fee_rate;

    IF v_resolution_revenue <= 0 THEN
      CONTINUE;
    END IF;

    FOR v_layer IN 1..LEAST(array_length(v_pos.referral_chain, 1), 2) LOOP
      v_ancestor_id := v_pos.referral_chain[v_layer];

      IF v_ancestor_id IS NULL THEN
        CONTINUE;
      END IF;

      SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
      IF v_ancestor IS NULL THEN
        CONTINUE;
      END IF;

      v_commission := _credit_commission(
        v_ancestor_id, v_pos.user_id, p_market_id, NULL,
        v_layer, v_ancestor.agent_level, v_resolution_revenue,
        'ngr_resolution_commission', 'resolution'
      );

      v_total_commissions := v_total_commissions + v_commission;
    END LOOP;
  END LOOP;

  RETURN v_total_commissions;
END;
$$;

-- ═══════════════════════════════════════════════════════════
-- 7. record_revenue — read snapshot
--    Re-defines from migration 220 (retail-only views preserved).
-- ═══════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION record_revenue(
  p_market_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_total_explicit DECIMAL;
  v_total_amm_spread DECIMAL;
  v_total_cash_out DECIMAL;
  v_resolution_fee DECIMAL;
  v_dynamic_spread DECIMAL;
  v_total_fees DECIMAL;
  v_total_commissions DECIMAL;
  v_net_revenue DECIMAL;
  v_total_volume DECIMAL;
  v_resolution_fee_rate DECIMAL;
  v_market RECORD;
BEGIN
  SELECT
    COALESCE(SUM(explicit_fee), 0),
    COALESCE(SUM(amm_spread_cost), 0),
    COALESCE(SUM(cash_out_premium), 0),
    COALESCE(SUM(dynamic_spread), 0)
  INTO v_total_explicit, v_total_amm_spread, v_total_cash_out, v_dynamic_spread
  FROM retail_trades WHERE market_id = p_market_id;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;

  -- Use snapshot if present, else fall back
  v_resolution_fee_rate := v_market.resolution_fee_rate_snapshot;
  IF v_resolution_fee_rate IS NULL THEN
    SELECT rate INTO v_resolution_fee_rate
    FROM fee_config WHERE fee_type = 'resolution_fee' ORDER BY id LIMIT 1;
    v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);
  END IF;

  IF v_market.outcome IS NOT NULL THEN
    SELECT COALESCE(SUM(shares_held * v_resolution_fee_rate), 0) INTO v_resolution_fee
    FROM retail_positions
    WHERE market_id = p_market_id
      AND side = v_market.outcome
      AND shares_held > 0;
  ELSE
    v_resolution_fee := 0;
  END IF;

  SELECT COALESCE(SUM(commission_amount), 0) INTO v_total_commissions
  FROM referral_commissions
  WHERE market_id = p_market_id AND status = 'credited';

  SELECT COALESCE(total_volume, 0) INTO v_total_volume
  FROM amm_state WHERE market_id = p_market_id;

  v_total_fees := v_total_explicit + v_total_amm_spread + v_resolution_fee
                  + v_dynamic_spread + v_total_cash_out;
  v_net_revenue := v_total_fees - v_total_commissions;

  -- ON CONFLICT requires the UNIQUE added in migration 248 — until then INSERT
  -- runs unguarded. Migration 248 retrofits ON CONFLICT.
  INSERT INTO platform_revenue (
    market_id, total_pot, seed_amount, platform_fee,
    total_commissions, net_revenue,
    explicit_fee_revenue, amm_spread_revenue, resolution_fee_revenue,
    dynamic_spread_revenue, cash_out_premium_revenue
  ) VALUES (
    p_market_id,
    v_total_volume,
    0,
    v_total_fees,
    v_total_commissions,
    v_net_revenue,
    v_total_explicit,
    v_total_amm_spread,
    v_resolution_fee,
    v_dynamic_spread,
    v_total_cash_out
  );
END;
$$;

COMMIT;
