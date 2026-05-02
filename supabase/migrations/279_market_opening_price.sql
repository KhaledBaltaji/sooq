-- 279_market_opening_price.sql — Admin-set opening price at market creation
--
-- Problem: every market today starts at 50/50. For markets where consensus
-- clearly favors one side, this overpays correct bettors and maxes operator
-- exposure at b × ln(2) ≈ 0.693b when consensus wins.
--
-- Fix: admin sets p = opening_price at creation (0.05 ≤ p ≤ 0.95). RPC pre-mints
-- seed shares so the AMM's initial price equals p. These seed shares are
-- operator inventory (not retail) — amm_state.retail_shares_yes/no stay at 0.
--
-- Worst-case math:
--   - Seed shares per side: q_yes = b × ln(p/(1-p)) if p ≥ 0.5; else q_no = b × ln((1-p)/p)
--   - If consensus wins: operator "pays itself" on seed shares → net 0 on seed
--   - If consensus loses: seed shares worthless, operator eats b × |ln(1-p)|
--   - Upside: when consensus wins, worst-case retail loss drops to b × |ln(p)|
--
-- Default: opening_price = 0.5 preserves current 50/50 behavior exactly.
-- Existing markets auto-backfill to 0.5 (NOT NULL DEFAULT). Their amm_state
-- rows already have q_yes = q_no = 0, so the invariant holds — no data backfill
-- needed for amm_state.
--
-- Out of scope (flagged as follow-ups):
--   - Editing opening_price after market creation (requires reverse-seeding accounting)
--   - get_amm_risk_snapshot including seed exposure (verify numbers on staging first)
--   - Demo market opening prices (demo RPC unchanged)

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Add column
-- ═══════════════════════════════════════════════════════════

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS opening_price DECIMAL(5,4) NOT NULL DEFAULT 0.5000
    CHECK (opening_price BETWEEN 0.05 AND 0.95);

COMMENT ON COLUMN markets.opening_price IS
  'Initial market price set at creation. AMM pre-mints shares to reach this price. Range 0.05-0.95 to prevent certainty markets. 0.5 = classic 50/50 behavior.';

-- ═══════════════════════════════════════════════════════════
-- 2. admin_create_market — accept p_opening_price, pre-mint seed shares
--    Re-defines from migration 245.
--
--    DROP legacy overloads first. Prior migrations (154, 241, 245) produced
--    two coexisting signatures (9-arg pre-image, 10-arg with image_url).
--    Adding a new trailing DEFAULT param creates a third overload, which makes
--    the function name ambiguous. Drop both old shapes explicitly before
--    creating the 11-arg one.
-- ═══════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS admin_create_market(
  text, text, text, text, text, text[], numeric, timestamptz, timestamptz
);
DROP FUNCTION IF EXISTS admin_create_market(
  text, text, text, text, text, text[], numeric, timestamptz, timestamptz, text
);

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
  p_image_url TEXT DEFAULT NULL,
  p_opening_price DECIMAL DEFAULT 0.5
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_q_yes DECIMAL;
  v_q_no DECIMAL;
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
  IF p_opening_price < 0.05 OR p_opening_price > 0.95 THEN
    RAISE EXCEPTION 'opening_price must be between 0.05 and 0.95 (got %)', p_opening_price;
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

  -- 5. Compute seed shares to reach opening_price.
  --    Only ONE side gets seeded (the other stays at 0) — the AMM price formula
  --    produces the target price from (q_yes, 0) or (0, q_no) directly.
  --    At p = 0.5 both sides stay 0 (no seeding, original 50/50 behavior).
  IF p_opening_price >= 0.5 THEN
    v_q_yes := v_b * ln(p_opening_price / (1 - p_opening_price));
    v_q_no  := 0;
  ELSE
    v_q_yes := 0;
    v_q_no  := v_b * ln((1 - p_opening_price) / p_opening_price);
  END IF;

  -- 6. Insert market with snapshot + opening_price
  INSERT INTO markets (
    question_en, question_ar, description_en, description_ar,
    category, keywords, amm_liquidity_param, opens_at, closes_at,
    created_by, status, image_url, resolution_fee_rate_snapshot, opening_price
  ) VALUES (
    p_question_en, p_question_ar, p_description_en, p_description_ar,
    p_category, p_keywords, v_b, p_opens_at, p_closes_at,
    v_admin_id, 'open', p_image_url, v_resolution_fee_rate, p_opening_price
  )
  RETURNING id INTO v_market_id;

  -- 7. Initialize AMM with pre-minted state.
  --    retail_shares_yes/no and retail_net_cash intentionally stay 0 —
  --    seed shares are operator inventory, not retail. AMM Risk Dashboard
  --    (migration 278) reads retail_* columns so seed shares don't leak
  --    into retail-exposure math.
  v_yes_price := lmsr_price(v_b, v_q_yes, v_q_no, 'yes');
  v_no_price  := lmsr_price(v_b, v_q_yes, v_q_no, 'no');

  INSERT INTO amm_state (
    market_id, liquidity_param, q_yes, q_no,
    current_yes_price, current_no_price,
    retail_shares_yes, retail_shares_no, retail_net_cash
  ) VALUES (
    v_market_id, v_b, v_q_yes, v_q_no,
    v_yes_price, v_no_price,
    0, 0, 0
  );

  -- 8. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_market', format('Market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'liquidity_param', v_b,
      'opening_price', p_opening_price,
      'seed_q_yes', v_q_yes,
      'seed_q_no', v_q_no,
      'resolution_fee_rate_snapshot', v_resolution_fee_rate
    ));

  RETURN jsonb_build_object(
    'market_id', v_market_id,
    'opening_price', p_opening_price,
    'seed_q_yes', v_q_yes,
    'seed_q_no', v_q_no
  );
END;
$$;

COMMENT ON FUNCTION admin_create_market IS
  'Creates a market + AMM state. Admin sets opening_price (0.05-0.95). Pre-mints seed shares so initial price matches. Seed shares are operator inventory (not retail).';

COMMIT;
