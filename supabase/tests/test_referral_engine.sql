-- test_referral_engine.sql — Extended referral engine tests
-- Covers: settle_resolution_commissions idempotency, handle_referral_signup trigger,
-- dashboard RPCs (get_agent_stats, get_agent_network_tree, get_agent_commission_feed)
-- Run via: psql -f supabase/tests/test_referral_engine.sql

BEGIN;

SET LOCAL app.trigger_bypass = 'true';

-- ============================================================
-- SETUP: Create test users with 3-layer referral chain
-- R (Tier 4 agent) ← S (referred by R) ← T (referred by S) ← U (trader)
-- ============================================================

DELETE FROM referral_commissions WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_REF_%');
DELETE FROM trades WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_REF_%');
DELETE FROM positions WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_REF_%');
DELETE FROM amm_state WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_REF_%');
DELETE FROM platform_revenue WHERE market_id IN (SELECT id FROM markets WHERE question_en LIKE 'TEST_REF_%');
DELETE FROM transactions WHERE user_id IN (SELECT id FROM users WHERE display_name LIKE 'test_ref_%');
DELETE FROM users WHERE display_name LIKE 'test_ref_%';
DELETE FROM markets WHERE question_en LIKE 'TEST_REF_%';

-- Create test users
INSERT INTO users (id, display_name, phone, balance_usd, referral_code, agent_level, direct_referral_count, network_volume)
VALUES
  ('c0000000-0000-0000-0000-000000000001', 'test_ref_r', '+96170000001', 10000, 'REF_R', 4, 200, 250000),
  ('c0000000-0000-0000-0000-000000000002', 'test_ref_s', '+96170000002', 10000, 'REF_S', 1, 5, 0),
  ('c0000000-0000-0000-0000-000000000003', 'test_ref_t', '+96170000003', 10000, 'REF_T', 1, 1, 0),
  ('c0000000-0000-0000-0000-000000000004', 'test_ref_u', '+96170000004', 10000, 'REF_U', 1, 0, 0);

-- Set referral chain: U→T→S→R
UPDATE users SET referred_by = 'c0000000-0000-0000-0000-000000000001',
  referral_chain = ARRAY['c0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'c0000000-0000-0000-0000-000000000002';

UPDATE users SET referred_by = 'c0000000-0000-0000-0000-000000000002',
  referral_chain = ARRAY['c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'c0000000-0000-0000-0000-000000000003';

UPDATE users SET referred_by = 'c0000000-0000-0000-0000-000000000003',
  referral_chain = ARRAY['c0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001']::UUID[]
  WHERE id = 'c0000000-0000-0000-0000-000000000004';

-- Create admin for market creation
INSERT INTO users (id, display_name, balance_usd, referral_code, is_admin)
VALUES ('c0000000-0000-0000-0000-000000000099', 'test_ref_admin', 0, 'REF_ADMIN', TRUE)
ON CONFLICT (id) DO NOTHING;

-- Create test market (resolved YES)
INSERT INTO markets (id, question_en, question_ar, category, status, outcome, opens_at, closes_at, resolved_at, created_by)
VALUES (
  'd0000000-0000-0000-0000-000000000001',
  'TEST_REF_market_resolved', 'TEST_REF_market_resolved_ar', 'test', 'resolved', 'yes',
  NOW() - INTERVAL '7 days', NOW() - INTERVAL '1 day', NOW(),
  'c0000000-0000-0000-0000-000000000099'
);

-- Create AMM state
INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price, total_volume, total_trades)
VALUES ('d0000000-0000-0000-0000-000000000001', 1000, 100, 50, 0.62, 0.38, 5000, 50);

-- U holds 200 winning YES shares
INSERT INTO positions (user_id, market_id, side, shares_held, avg_price, total_invested, realized_pnl)
VALUES ('c0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001', 'yes', 200, 0.50, 100, 0);


-- ============================================================
-- TEST 12: settle_resolution_commissions creates correct rows
-- ============================================================
DO $$
DECLARE
  v_total DECIMAL;
  v_count INTEGER;
  v_resolution_fee_rate DECIMAL;
  v_expected_revenue DECIMAL;
BEGIN
  -- Read resolution fee rate
  SELECT rate INTO v_resolution_fee_rate FROM fee_config WHERE fee_type = 'resolution_fee' LIMIT 1;
  v_resolution_fee_rate := COALESCE(v_resolution_fee_rate, 0.01);

  -- Expected resolution revenue = 200 shares * 0.01 = 2.00
  v_expected_revenue := 200 * v_resolution_fee_rate;

  v_total := settle_resolution_commissions('d0000000-0000-0000-0000-000000000001');

  -- Should create 3 commission rows (one per layer)
  SELECT COUNT(*) INTO v_count FROM referral_commissions
    WHERE market_id = 'd0000000-0000-0000-0000-000000000001' AND revenue_type = 'resolution';

  IF v_count != 3 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Expected 3 resolution commission rows, got %', v_count;
  END IF;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'TEST 12 FAILED: Total resolution commissions should be > 0, got %', v_total;
  END IF;

  RAISE NOTICE 'TEST 12 PASSED: settle_resolution_commissions created % rows, total=$%', v_count, v_total;
END $$;


-- ============================================================
-- TEST 13: settle_resolution_commissions is idempotent
-- ============================================================
DO $$
DECLARE
  v_total DECIMAL;
  v_count_before INTEGER;
  v_count_after INTEGER;
BEGIN
  -- Count existing resolution commissions
  SELECT COUNT(*) INTO v_count_before FROM referral_commissions
    WHERE market_id = 'd0000000-0000-0000-0000-000000000001' AND revenue_type = 'resolution';

  -- Call again — should return 0 and not create new rows
  v_total := settle_resolution_commissions('d0000000-0000-0000-0000-000000000001');

  SELECT COUNT(*) INTO v_count_after FROM referral_commissions
    WHERE market_id = 'd0000000-0000-0000-0000-000000000001' AND revenue_type = 'resolution';

  IF v_total != 0 THEN
    RAISE EXCEPTION 'TEST 13 FAILED: Idempotent call should return 0, got %', v_total;
  END IF;

  IF v_count_after != v_count_before THEN
    RAISE EXCEPTION 'TEST 13 FAILED: Row count changed from % to % on idempotent call', v_count_before, v_count_after;
  END IF;

  RAISE NOTICE 'TEST 13 PASSED: Idempotent call returned 0, row count unchanged at %', v_count_after;
END $$;


-- ============================================================
-- TEST 14: settle_resolution_commissions returns 0 for unresolved market
-- ============================================================
DO $$
DECLARE
  v_total DECIMAL;
BEGIN
  -- Create an unresolved market
  INSERT INTO markets (id, question_en, question_ar, category, status, opens_at, closes_at, created_by)
  VALUES (
    'd0000000-0000-0000-0000-000000000002',
    'TEST_REF_market_open', 'TEST_REF_market_open_ar', 'test', 'open',
    NOW() - INTERVAL '1 day', NOW() + INTERVAL '7 days',
    'c0000000-0000-0000-0000-000000000099'
  );

  v_total := settle_resolution_commissions('d0000000-0000-0000-0000-000000000002');

  IF v_total != 0 THEN
    RAISE EXCEPTION 'TEST 14 FAILED: Unresolved market should return 0, got %', v_total;
  END IF;

  RAISE NOTICE 'TEST 14 PASSED: Unresolved market returns 0';
END $$;


-- ============================================================
-- TEST 15: handle_referral_signup trigger builds chain correctly
-- ============================================================
DO $$
DECLARE
  v_new_chain UUID[];
  v_referrer_count INTEGER;
BEGIN
  -- Disable trigger bypass to test actual trigger behavior
  SET LOCAL app.trigger_bypass = 'false';

  -- Create a new user with no referrer
  INSERT INTO users (id, display_name, phone, balance_usd, referral_code)
  VALUES ('c0000000-0000-0000-0000-000000000010', 'test_ref_new', '+96170000010', 0, 'REF_NEW');

  -- Set referred_by → should fire handle_referral_signup trigger
  UPDATE users SET referred_by = 'c0000000-0000-0000-0000-000000000003'  -- T (who has chain [T's parent S, S's parent R])
    WHERE id = 'c0000000-0000-0000-0000-000000000010';

  -- Check referral_chain was built
  SELECT referral_chain INTO v_new_chain FROM users WHERE id = 'c0000000-0000-0000-0000-000000000010';

  IF v_new_chain IS NULL OR array_length(v_new_chain, 1) = 0 THEN
    RAISE EXCEPTION 'TEST 15 FAILED: referral_chain should be non-empty, got NULL or empty';
  END IF;

  -- Chain should be [T, S, R] — the direct referrer + referrer's chain (max 3)
  IF v_new_chain[1] != 'c0000000-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'TEST 15 FAILED: chain[1] should be T, got %', v_new_chain[1];
  END IF;

  IF array_length(v_new_chain, 1) < 2 OR v_new_chain[2] != 'c0000000-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'TEST 15 FAILED: chain[2] should be S, got %', v_new_chain[2];
  END IF;

  IF array_length(v_new_chain, 1) < 3 OR v_new_chain[3] != 'c0000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'TEST 15 FAILED: chain[3] should be R, got %', v_new_chain[3];
  END IF;

  -- Check T's direct_referral_count was incremented (was 1, now should be 2)
  SELECT direct_referral_count INTO v_referrer_count FROM users WHERE id = 'c0000000-0000-0000-0000-000000000003';
  IF v_referrer_count != 2 THEN
    RAISE EXCEPTION 'TEST 15 FAILED: T direct_referral_count should be 2, got %', v_referrer_count;
  END IF;

  SET LOCAL app.trigger_bypass = 'true';

  RAISE NOTICE 'TEST 15 PASSED: Trigger built chain [T, S, R] and incremented count to %', v_referrer_count;
END $$;


-- ============================================================
-- TEST 16: handle_referral_signup trigger does not re-fire on second update
-- ============================================================
DO $$
DECLARE
  v_chain UUID[];
BEGIN
  SET LOCAL app.trigger_bypass = 'false';

  -- Try to change referred_by (already set) — trigger WHEN clause should prevent re-fire
  -- since OLD.referred_by IS NULL AND NEW.referred_by IS NOT NULL won't match
  UPDATE users SET display_name = 'test_ref_new_renamed' WHERE id = 'c0000000-0000-0000-0000-000000000010';

  SELECT referral_chain INTO v_chain FROM users WHERE id = 'c0000000-0000-0000-0000-000000000010';

  -- Chain should still be intact
  IF array_length(v_chain, 1) != 3 THEN
    RAISE EXCEPTION 'TEST 16 FAILED: Chain length should still be 3, got %', array_length(v_chain, 1);
  END IF;

  SET LOCAL app.trigger_bypass = 'true';

  RAISE NOTICE 'TEST 16 PASSED: Non-referral updates do not re-fire trigger';
END $$;


-- ============================================================
-- TEST 17: Chain truncated to max 3 ancestors for deep nesting
-- ============================================================
DO $$
DECLARE
  v_chain UUID[];
BEGIN
  SET LOCAL app.trigger_bypass = 'false';

  -- Create user referred by U (who already has 3-level chain [T, S, R])
  -- New user's chain should be [U, T, S] — truncated to 3, R dropped
  INSERT INTO users (id, display_name, phone, balance_usd, referral_code)
  VALUES ('c0000000-0000-0000-0000-000000000011', 'test_ref_deep', '+96170000011', 0, 'REF_DEEP');

  UPDATE users SET referred_by = 'c0000000-0000-0000-0000-000000000004'  -- U
    WHERE id = 'c0000000-0000-0000-0000-000000000011';

  SELECT referral_chain INTO v_chain FROM users WHERE id = 'c0000000-0000-0000-0000-000000000011';

  IF array_length(v_chain, 1) != 3 THEN
    RAISE EXCEPTION 'TEST 17 FAILED: Chain should be truncated to 3, got %', array_length(v_chain, 1);
  END IF;

  IF v_chain[1] != 'c0000000-0000-0000-0000-000000000004' THEN
    RAISE EXCEPTION 'TEST 17 FAILED: chain[1] should be U, got %', v_chain[1];
  END IF;

  SET LOCAL app.trigger_bypass = 'true';

  RAISE NOTICE 'TEST 17 PASSED: Deep chain truncated to 3 levels: [U, T, S]';
END $$;


-- ============================================================
-- TEST 18: get_agent_stats returns valid JSONB structure
-- ============================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  -- Simulate auth.uid() for R
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000001')::TEXT, TRUE);

  SELECT get_agent_stats() INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'TEST 18 FAILED: get_agent_stats returned NULL';
  END IF;

  -- Check required keys exist
  IF NOT (v_result ? 'total_credited') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: Missing total_credited key';
  END IF;

  IF NOT (v_result ? 'network_size') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: Missing network_size key';
  END IF;

  IF NOT (v_result ? 'agent_level') THEN
    RAISE EXCEPTION 'TEST 18 FAILED: Missing agent_level key';
  END IF;

  RAISE NOTICE 'TEST 18 PASSED: get_agent_stats returned valid structure: %', v_result;
END $$;


-- ============================================================
-- TEST 19: get_agent_network_tree returns valid tree for user with referrals
-- ============================================================
DO $$
DECLARE
  v_result JSONB;
  v_l1_count INTEGER;
BEGIN
  -- Simulate auth.uid() for R (has referrals)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000001')::TEXT, TRUE);

  SELECT get_agent_network_tree() INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'TEST 19 FAILED: get_agent_network_tree returned NULL';
  END IF;

  -- R's direct referral is S → should have at least 1 L1 node
  v_l1_count := jsonb_array_length(v_result);
  IF v_l1_count < 1 THEN
    RAISE EXCEPTION 'TEST 19 FAILED: Expected at least 1 L1 node, got %', v_l1_count;
  END IF;

  RAISE NOTICE 'TEST 19 PASSED: Network tree has % L1 nodes', v_l1_count;
END $$;


-- ============================================================
-- TEST 20: get_agent_network_tree returns empty array for user with no referrals
-- ============================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  -- Simulate auth.uid() for U (no referrals, until test 17 added one)
  -- Use a fresh user with no referrals
  INSERT INTO users (id, display_name, phone, balance_usd, referral_code)
  VALUES ('c0000000-0000-0000-0000-000000000020', 'test_ref_lonely', '+96170000020', 0, 'REF_LONELY')
  ON CONFLICT (id) DO NOTHING;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000020')::TEXT, TRUE);

  SELECT get_agent_network_tree() INTO v_result;

  IF v_result IS NULL OR v_result = 'null'::JSONB THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Should return empty array, not NULL';
  END IF;

  IF jsonb_array_length(v_result) != 0 THEN
    RAISE EXCEPTION 'TEST 20 FAILED: Expected empty array, got % elements', jsonb_array_length(v_result);
  END IF;

  RAISE NOTICE 'TEST 20 PASSED: User with no referrals gets empty tree';
END $$;


-- ============================================================
-- TEST 21: get_agent_commission_feed returns paginated results
-- ============================================================
DO $$
DECLARE
  v_result JSONB;
BEGIN
  -- Simulate auth.uid() for T (layer 1 referrer of U)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000003')::TEXT, TRUE);

  SELECT get_agent_commission_feed(50, 0, NULL) INTO v_result;

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'TEST 21 FAILED: get_agent_commission_feed returned NULL';
  END IF;

  -- Result should be a JSONB array
  IF jsonb_typeof(v_result) != 'array' THEN
    RAISE EXCEPTION 'TEST 21 FAILED: Expected array, got %', jsonb_typeof(v_result);
  END IF;

  RAISE NOTICE 'TEST 21 PASSED: Commission feed returned % items', jsonb_array_length(v_result);
END $$;


-- ============================================================
-- TEST 22: get_agent_commission_feed layer filter works
-- ============================================================
DO $$
DECLARE
  v_all JSONB;
  v_l1_only JSONB;
BEGIN
  -- Simulate auth.uid() for R (gets L1, L2, L3 commissions)
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', 'c0000000-0000-0000-0000-000000000001')::TEXT, TRUE);

  SELECT get_agent_commission_feed(50, 0, NULL) INTO v_all;
  SELECT get_agent_commission_feed(50, 0, 3) INTO v_l1_only;

  -- Filtered results should be <= total results
  IF jsonb_array_length(v_l1_only) > jsonb_array_length(v_all) THEN
    RAISE EXCEPTION 'TEST 22 FAILED: Filtered count (%) > total count (%)',
      jsonb_array_length(v_l1_only), jsonb_array_length(v_all);
  END IF;

  RAISE NOTICE 'TEST 22 PASSED: Layer filter works (all=%, L3 only=%)',
    jsonb_array_length(v_all), jsonb_array_length(v_l1_only);
END $$;


-- ============================================================
-- CLEANUP
-- ============================================================
ROLLBACK;

-- All tests ran inside a transaction that was rolled back — no test data persisted.
