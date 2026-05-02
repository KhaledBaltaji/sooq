-- test_ngr_commissions.sql — SQL assertion tests for NGR commission model
-- Run via: psql -f supabase/tests/test_ngr_commissions.sql
-- All assertions use DO blocks that RAISE EXCEPTION on failure.

-- ============================================================
-- SETUP: Create test users with 3-layer referral chain
-- A (Tier 4 agent) ← B (referred by A) ← C (referred by B) ← D (referred by C, the trader)
-- ============================================================

BEGIN;

-- Bypass auth for test
SET LOCAL app.trigger_bypass = 'true';

-- Clean up any previous test data
DELETE FROM referral_commissions WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_NGR_%');
DELETE FROM trades WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_NGR_%');
DELETE FROM positions WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_NGR_%');
DELETE FROM amm_state WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_NGR_%');
DELETE FROM platform_revenue WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_NGR_%');
DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE display_name LIKE 'test_ngr_%');
DELETE FROM users WHERE display_name LIKE 'test_ngr_%';
DELETE FROM markets WHERE question_en LIKE 'TEST_NGR_%';

-- Create test users
INSERT INTO users (id, display_name, balance_usd, referral_code, agent_level, direct_referral_count, network_volume)
VALUES
  ('a0000000-0000-0000-0000-000000000001', 'test_ngr_a', 10000, 'TEST_A', 4, 200, 250000),
  ('a0000000-0000-0000-0000-000000000002', 'test_ngr_b', 10000, 'TEST_B', 1, 5, 0),
  ('a0000000-0000-0000-0000-000000000003', 'test_ngr_c', 10000, 'TEST_C', 1, 1, 0),
  ('a0000000-0000-0000-0000-000000000004', 'test_ngr_d', 10000, 'TEST_D', 1, 0, 0);

-- Set referral chain: D→C→B→A
UPDATE users SET referred_by = 'a0000000-0000-0000-0000-000000000001',
  referral_chain = ARRAY['a0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'a0000000-0000-0000-0000-000000000002';

UPDATE users SET referred_by = 'a0000000-0000-0000-0000-000000000002',
  referral_chain = ARRAY['a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'a0000000-0000-0000-0000-000000000003';

UPDATE users SET referred_by = 'a0000000-0000-0000-0000-000000000003',
  referral_chain = ARRAY['a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'a0000000-0000-0000-0000-000000000004';

-- Create admin user for market creation
INSERT INTO users (id, display_name, balance_usd, referral_code, is_admin)
VALUES ('a0000000-0000-0000-0000-000000000099', 'test_ngr_admin', 0, 'TEST_ADMIN', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Create test market
INSERT INTO markets (id, question_en, question_ar, category, status, opens_at, closes_at, created_by)
VALUES (
  'b0000000-0000-0000-0000-000000000001',
  'TEST_NGR_market_1', 'TEST_NGR_market_1_ar', 'test', 'open',
  NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days',
  'a0000000-0000-0000-0000-000000000099'
);

-- Initialize AMM
INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price, total_volume, total_trades)
VALUES ('b0000000-0000-0000-0000-000000000001', 1000, 0, 0, 0.50, 0.50, 0, 0);


-- ============================================================
-- TEST 1: fee_config has all 24 NGR rows
-- ============================================================
DO $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_commission';
  IF v_count != 12 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected 12 ngr_commission rows, got %', v_count;
  END IF;

  SELECT COUNT(*) INTO v_count FROM fee_config WHERE fee_type = 'ngr_resolution_commission';
  IF v_count != 12 THEN
    RAISE EXCEPTION 'TEST 1 FAILED: Expected 12 ngr_resolution_commission rows, got %', v_count;
  END IF;

  RAISE NOTICE 'TEST 1 PASSED: All 24 fee_config rows present';
END $$;


-- ============================================================
-- TEST 2: pay_trade_commissions creates 3 commission rows for a buy
-- ============================================================
DO $$
DECLARE
  v_trade_id UUID := gen_random_uuid();
  v_total DECIMAL;
  v_count INTEGER;
  v_platform_rev DECIMAL;
  v_c_commission DECIMAL;
  v_b_commission DECIMAL;
  v_a_commission DECIMAL;
  v_c_rate DECIMAL;
  v_b_rate DECIMAL;
  v_a_rate DECIMAL;
BEGIN
  -- Simulate a trade by D: insert trade row with fees
  INSERT INTO trades (id, user_id, market_id, side, direction, shares, price_per_share, total_cost,
    explicit_fee, amm_spread_cost, cash_out_premium)
  VALUES (v_trade_id, 'a0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000001', 'yes', 'buy',
    100, 0.50, 50, 0.25, 1.50, 0);

  -- Call pay_trade_commissions
  v_total := pay_trade_commissions(v_trade_id, 'a0000000-0000-0000-0000-000000000004', 50);

  -- platform_revenue = explicit_fee + amm_spread_cost + cash_out_premium = 0.25 + 1.50 + 0 = 1.75
  v_platform_rev := 1.75;

  -- Check 3 commission rows created
  SELECT COUNT(*) INTO v_count FROM referral_commissions
    WHERE trade_id = v_trade_id AND revenue_type = 'trade';
  IF v_count != 3 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: Expected 3 commission rows, got %', v_count;
  END IF;

  -- Check commission amounts match rates
  -- C is L1 (layer 1), agent_level=1 → rate 0.20 (20%)
  -- B is L2 (layer 2), agent_level=1 → rate 0.05 (5%)
  -- A is L3 (layer 3), agent_level=4 → rate 0.07 (7%)  [A's own tier matters]
  SELECT commission_amount, commission_rate INTO v_c_commission, v_c_rate
    FROM referral_commissions WHERE trade_id = v_trade_id AND layer = 1;
  SELECT commission_amount, commission_rate INTO v_b_commission, v_b_rate
    FROM referral_commissions WHERE trade_id = v_trade_id AND layer = 2;
  SELECT commission_amount, commission_rate INTO v_a_commission, v_a_rate
    FROM referral_commissions WHERE trade_id = v_trade_id AND layer = 3;

  -- Verify rates from fee_config
  IF v_c_rate != 0.20 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: C (L1, T1) rate expected 0.20, got %', v_c_rate;
  END IF;
  IF v_b_rate != 0.05 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: B (L2, T1) rate expected 0.05, got %', v_b_rate;
  END IF;
  IF v_a_rate != 0.07 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: A (L3, T4) rate expected 0.07, got %', v_a_rate;
  END IF;

  -- Verify commission amounts = platform_revenue × rate
  IF ABS(v_c_commission - v_platform_rev * 0.20) > 0.01 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: C commission expected %, got %', v_platform_rev * 0.20, v_c_commission;
  END IF;
  IF ABS(v_b_commission - v_platform_rev * 0.05) > 0.01 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: B commission expected %, got %', v_platform_rev * 0.05, v_b_commission;
  END IF;
  IF ABS(v_a_commission - v_platform_rev * 0.07) > 0.01 THEN
    RAISE EXCEPTION 'TEST 2 FAILED: A commission expected %, got %', v_platform_rev * 0.07, v_a_commission;
  END IF;

  RAISE NOTICE 'TEST 2 PASSED: 3 commission rows with correct rates and amounts';
END $$;


-- ============================================================
-- TEST 3: Ancestor balances credited correctly
-- ============================================================
DO $$
DECLARE
  v_c_balance DECIMAL;
  v_b_balance DECIMAL;
  v_a_balance DECIMAL;
BEGIN
  SELECT balance_usd INTO v_c_balance FROM users WHERE id = 'a0000000-0000-0000-0000-000000000003';
  SELECT balance_usd INTO v_b_balance FROM users WHERE id = 'a0000000-0000-0000-0000-000000000002';
  SELECT balance_usd INTO v_a_balance FROM users WHERE id = 'a0000000-0000-0000-0000-000000000001';

  -- C started at 10000, got L1 commission: 1.75 * 0.20 = 0.35
  IF ABS(v_c_balance - 10000.35) > 0.01 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: C balance expected ~10000.35, got %', v_c_balance;
  END IF;

  -- B started at 10000, got L2 commission: 1.75 * 0.05 = 0.0875
  IF ABS(v_b_balance - 10000.09) > 0.02 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: B balance expected ~10000.09, got %', v_b_balance;
  END IF;

  -- A started at 10000, got L3 commission: 1.75 * 0.07 = 0.1225
  IF ABS(v_a_balance - 10000.12) > 0.02 THEN
    RAISE EXCEPTION 'TEST 3 FAILED: A balance expected ~10000.12, got %', v_a_balance;
  END IF;

  RAISE NOTICE 'TEST 3 PASSED: Ancestor balances credited correctly';
END $$;


-- ============================================================
-- TEST 4: network_volume incremented for all ancestors
-- ============================================================
DO $$
DECLARE
  v_c_vol DECIMAL;
  v_b_vol DECIMAL;
  v_a_vol DECIMAL;
BEGIN
  SELECT network_volume INTO v_c_vol FROM users WHERE id = 'a0000000-0000-0000-0000-000000000003';
  SELECT network_volume INTO v_b_vol FROM users WHERE id = 'a0000000-0000-0000-0000-000000000002';
  SELECT network_volume INTO v_a_vol FROM users WHERE id = 'a0000000-0000-0000-0000-000000000001';

  -- Trade amount was 50, each ancestor should have +50 network_volume
  IF v_c_vol != 50 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: C network_volume expected 50, got %', v_c_vol;
  END IF;
  IF v_b_vol != 50 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: B network_volume expected 50, got %', v_b_vol;
  END IF;
  -- A started at 250000
  IF v_a_vol != 250050 THEN
    RAISE EXCEPTION 'TEST 4 FAILED: A network_volume expected 250050, got %', v_a_vol;
  END IF;

  RAISE NOTICE 'TEST 4 PASSED: network_volume incremented for all ancestors';
END $$;


-- ============================================================
-- TEST 5: Trader with no referrers produces 0 commission rows
-- ============================================================
DO $$
DECLARE
  v_trade_id UUID := gen_random_uuid();
  v_total DECIMAL;
  v_count INTEGER;
BEGIN
  -- Create a user with no referral chain
  INSERT INTO users (id, display_name, balance_usd, referral_code)
  VALUES ('a0000000-0000-0000-0000-000000000005', 'test_ngr_solo', 10000, 'TEST_SOLO')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO trades (id, user_id, market_id, side, direction, shares, price_per_share, total_cost,
    explicit_fee, amm_spread_cost, cash_out_premium)
  VALUES (v_trade_id, 'a0000000-0000-0000-0000-000000000005',
    'b0000000-0000-0000-0000-000000000001', 'yes', 'buy',
    50, 0.50, 25, 0.125, 0.75, 0);

  v_total := pay_trade_commissions(v_trade_id, 'a0000000-0000-0000-0000-000000000005', 25);

  IF v_total != 0 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Expected 0 total commissions for no-referrer trader, got %', v_total;
  END IF;

  SELECT COUNT(*) INTO v_count FROM referral_commissions WHERE trade_id = v_trade_id;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 5 FAILED: Expected 0 commission rows, got %', v_count;
  END IF;

  RAISE NOTICE 'TEST 5 PASSED: No commissions for trader with no referrers';
END $$;


-- ============================================================
-- TEST 6: Dust threshold — tiny trade produces no commission if < $0.01
-- ============================================================
DO $$
DECLARE
  v_trade_id UUID := gen_random_uuid();
  v_total DECIMAL;
  v_count INTEGER;
BEGIN
  -- Trade with very small fees: platform_revenue = 0.001 + 0.002 + 0 = 0.003
  -- L1 commission at 20% = 0.0006 → below $0.01 dust threshold
  INSERT INTO trades (id, user_id, market_id, side, direction, shares, price_per_share, total_cost,
    explicit_fee, amm_spread_cost, cash_out_premium)
  VALUES (v_trade_id, 'a0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000001', 'yes', 'buy',
    0.1, 0.50, 0.05, 0.001, 0.002, 0);

  v_total := pay_trade_commissions(v_trade_id, 'a0000000-0000-0000-0000-000000000004', 0.05);

  -- All commissions should be skipped (dust)
  SELECT COUNT(*) INTO v_count FROM referral_commissions WHERE trade_id = v_trade_id;
  IF v_count != 0 THEN
    RAISE EXCEPTION 'TEST 6 FAILED: Expected 0 dust commission rows, got % (total: %)', v_count, v_total;
  END IF;

  RAISE NOTICE 'TEST 6 PASSED: Dust threshold correctly skips sub-penny commissions';
END $$;


-- ============================================================
-- TEST 7: Tier advancement via volume (B hits $10K → Tier 2)
-- ============================================================
DO $$
DECLARE
  v_trade_id UUID := gen_random_uuid();
  v_total DECIMAL;
  v_b_level INTEGER;
  v_b_vol DECIMAL;
BEGIN
  -- Set B's volume just below threshold
  UPDATE users SET network_volume = 9960 WHERE id = 'a0000000-0000-0000-0000-000000000002';

  -- D trades $100 → B gets +100 network_volume → 10060 → should advance to Tier 2
  INSERT INTO trades (id, user_id, market_id, side, direction, shares, price_per_share, total_cost,
    explicit_fee, amm_spread_cost, cash_out_premium)
  VALUES (v_trade_id, 'a0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000001', 'yes', 'buy',
    200, 0.50, 100, 0.50, 3.00, 0);

  v_total := pay_trade_commissions(v_trade_id, 'a0000000-0000-0000-0000-000000000004', 100);

  SELECT agent_level, network_volume INTO v_b_level, v_b_vol FROM users WHERE id = 'a0000000-0000-0000-0000-000000000002';

  IF v_b_level < 2 THEN
    RAISE EXCEPTION 'TEST 7 FAILED: B should be Tier 2 (vol=%), got level %', v_b_vol, v_b_level;
  END IF;

  RAISE NOTICE 'TEST 7 PASSED: B advanced to Tier % at volume %', v_b_level, v_b_vol;
END $$;


-- ============================================================
-- TEST 8: Ratchet rule — tier never goes down
-- ============================================================
DO $$
DECLARE
  v_b_level INTEGER;
BEGIN
  -- Manually set B's volume below T2 threshold (shouldn't happen in practice)
  UPDATE users SET network_volume = 5000 WHERE id = 'a0000000-0000-0000-0000-000000000002';

  -- Call update_agent_level
  PERFORM update_agent_level('a0000000-0000-0000-0000-000000000002');

  SELECT agent_level INTO v_b_level FROM users WHERE id = 'a0000000-0000-0000-0000-000000000002';

  -- Should still be Tier 2 (ratchet)
  IF v_b_level < 2 THEN
    RAISE EXCEPTION 'TEST 8 FAILED: Ratchet broken — B dropped to level %', v_b_level;
  END IF;

  RAISE NOTICE 'TEST 8 PASSED: Ratchet holds — B still Tier %', v_b_level;
END $$;


-- ============================================================
-- TEST 9: Sell trade also generates commissions
-- ============================================================
DO $$
DECLARE
  v_trade_id UUID := gen_random_uuid();
  v_total DECIMAL;
  v_count INTEGER;
BEGIN
  -- Insert a sell trade for D
  INSERT INTO trades (id, user_id, market_id, side, direction, shares, price_per_share, total_cost,
    explicit_fee, amm_spread_cost, cash_out_premium)
  VALUES (v_trade_id, 'a0000000-0000-0000-0000-000000000004',
    'b0000000-0000-0000-0000-000000000001', 'yes', 'sell',
    50, 0.48, 24, 0.12, 0.72, 0.12);

  v_total := pay_trade_commissions(v_trade_id, 'a0000000-0000-0000-0000-000000000004', 24);

  SELECT COUNT(*) INTO v_count FROM referral_commissions
    WHERE trade_id = v_trade_id AND revenue_type = 'trade';
  IF v_count != 3 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Sell trade expected 3 commission rows, got %', v_count;
  END IF;

  -- platform_revenue = 0.12 + 0.72 + 0.12 = 0.96
  -- Total should be > 0
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'TEST 9 FAILED: Sell trade commissions should be > 0, got %', v_total;
  END IF;

  RAISE NOTICE 'TEST 9 PASSED: Sell trade generated % in commissions across 3 layers', v_total;
END $$;


-- ============================================================
-- TEST 10: revenue_type correctly tagged
-- ============================================================
DO $$
DECLARE
  v_trade_count INTEGER;
  v_resolution_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_trade_count FROM referral_commissions
    WHERE market_id = 'b0000000-0000-0000-0000-000000000001' AND revenue_type = 'trade';

  -- No resolution commissions yet (market not resolved)
  SELECT COUNT(*) INTO v_resolution_count FROM referral_commissions
    WHERE market_id = 'b0000000-0000-0000-0000-000000000001' AND revenue_type = 'resolution';

  IF v_trade_count = 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Expected trade commissions, got 0';
  END IF;
  IF v_resolution_count != 0 THEN
    RAISE EXCEPTION 'TEST 10 FAILED: Expected 0 resolution commissions before resolve, got %', v_resolution_count;
  END IF;

  RAISE NOTICE 'TEST 10 PASSED: % trade commissions, 0 resolution commissions (pre-resolve)', v_trade_count;
END $$;


-- ============================================================
-- TEST 11: _credit_commission returns 0 for missing fee_config rate
-- ============================================================
DO $$
DECLARE
  v_result DECIMAL;
BEGIN
  -- Call with a fee_type that doesn't exist
  v_result := _credit_commission(
    'a0000000-0000-0000-0000-000000000003',  -- ancestor
    'a0000000-0000-0000-0000-000000000004',  -- bettor
    'b0000000-0000-0000-0000-000000000001',  -- market
    gen_random_uuid(),                        -- trade
    1,                                         -- layer
    1,                                         -- agent_level
    100.00,                                    -- platform_revenue
    'nonexistent_fee_type',                   -- fee_type (doesn't exist)
    'trade'                                    -- revenue_type
  );

  IF v_result != 0 THEN
    RAISE EXCEPTION 'TEST 11 FAILED: Expected 0 for missing fee_config, got %', v_result;
  END IF;

  RAISE NOTICE 'TEST 11 PASSED: Missing fee_config returns 0 (graceful skip)';
END $$;


-- ============================================================
-- CLEANUP
-- ============================================================
ROLLBACK;

-- All tests ran inside a transaction that was rolled back — no test data persisted.
-- If all NOTICEs printed "PASSED", the NGR commission model is working correctly.
