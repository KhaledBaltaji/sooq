-- ============================================================================
-- 322_capture_post_speed_drift.sql
--
-- Sync staging utility-function bodies with what migrations describe.
--
-- Same pattern as mig 299 (`capture_live_drift`): two staging-only utility
-- helpers (`cleanup_test_data`, `staging_full_reset`) had been edited
-- in-place on staging since mig 299 ran, drifting from the migration
-- file's body. Schema-drift gate caught it after the speed-markets push
-- (because regenerating schema.sql exposed the gap).
--
-- These functions are NOT called by application or test code (no matches
-- under src/app, src/lib, or src/tests). They exist only as ad-hoc reset
-- helpers an operator can call manually via psql or Supabase Studio.
-- Codifying the live bodies here brings the drift-gate green.
--
-- Both function bodies copied verbatim from the `supabase db diff --linked`
-- output of the mig 321 deploy run (24983454243).
-- ============================================================================

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cleanup_test_data()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  test_user_ids UUID[];
  test_market_ids UUID[];
BEGIN
  SELECT ARRAY_AGG(id) INTO test_user_ids
  FROM users
  WHERE phone LIKE '+961%test%' OR email LIKE '%test%@%';

  SELECT ARRAY_AGG(id) INTO test_market_ids
  FROM markets
  WHERE question_en LIKE '%test%' OR question_en LIKE '%Test%';

  IF test_market_ids IS NOT NULL THEN
    DELETE FROM price_alerts WHERE market_id = ANY(test_market_ids);
    DELETE FROM news_articles WHERE market_id = ANY(test_market_ids);
    DELETE FROM market_comments WHERE market_id = ANY(test_market_ids);
    DELETE FROM trades WHERE market_id = ANY(test_market_ids);
    DELETE FROM positions WHERE market_id = ANY(test_market_ids);
    DELETE FROM amm_state WHERE market_id = ANY(test_market_ids);
    DELETE FROM markets WHERE id = ANY(test_market_ids);
  END IF;

  IF test_user_ids IS NOT NULL THEN
    UPDATE users SET referred_by = NULL WHERE referred_by = ANY(test_user_ids);
    DELETE FROM leader_stats WHERE user_id = ANY(test_user_ids);
    DELETE FROM copy_settings WHERE copier_id = ANY(test_user_ids) OR leader_id = ANY(test_user_ids);
    DELETE FROM admin_config WHERE admin_user_id = ANY(test_user_ids);
    DELETE FROM deposits WHERE user_id = ANY(test_user_ids);
    DELETE FROM withdrawals WHERE user_id = ANY(test_user_ids);
    DELETE FROM notifications WHERE user_id = ANY(test_user_ids);
    DELETE FROM user_wallets WHERE user_id = ANY(test_user_ids);
    DELETE FROM user_locations WHERE user_id = ANY(test_user_ids);
    DELETE FROM price_alerts WHERE user_id = ANY(test_user_ids);
    DELETE FROM comment_likes WHERE user_id = ANY(test_user_ids);
    DELETE FROM referral_commissions WHERE trader_id = ANY(test_user_ids) OR referrer_id = ANY(test_user_ids);
    UPDATE trades SET copied_from_user = NULL WHERE copied_from_user = ANY(test_user_ids);
    DELETE FROM transactions WHERE user_id = ANY(test_user_ids) OR performed_by = ANY(test_user_ids);
    DELETE FROM trades WHERE user_id = ANY(test_user_ids);
    DELETE FROM positions WHERE user_id = ANY(test_user_ids);
    DELETE FROM market_comments WHERE user_id = ANY(test_user_ids);
    DELETE FROM users WHERE id = ANY(test_user_ids);
  END IF;

  RETURN format('Cleaned %s test users and %s test markets',
                COALESCE(array_length(test_user_ids, 1), 0),
                COALESCE(array_length(test_market_ids, 1), 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.staging_full_reset()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
BEGIN
  ALTER TABLE branch_pools DISABLE TRIGGER USER;
  ALTER TABLE branch_trades DISABLE TRIGGER USER;
  ALTER TABLE credit_chain_ledger DISABLE TRIGGER USER;
  ALTER TABLE branch_admin_overrides DISABLE TRIGGER USER;

  DELETE FROM credit_chain_ledger;
  DELETE FROM branch_admin_overrides;
  DELETE FROM branch_trades;
  DELETE FROM branch_revenue;
  DELETE FROM branch_user_assignments;
  DELETE FROM branch_agents;
  DELETE FROM branch_market_config;
  DELETE FROM branch_pools;
  DELETE FROM referral_commissions;
  DELETE FROM retail_positions;
  DELETE FROM retail_trades;
  DELETE FROM positions;
  DELETE FROM trades;
  DELETE FROM transactions;
  DELETE FROM notifications;
  DELETE FROM market_comments;
  DELETE FROM comment_likes;
  DELETE FROM news_articles;
  DELETE FROM deposits;
  DELETE FROM withdrawals;
  DELETE FROM leader_stats;
  DELETE FROM price_alerts;
  DELETE FROM platform_revenue;
  DELETE FROM system_logs;
  DELETE FROM prelaunch_votes;
  DELETE FROM user_locations;
  DELETE FROM user_wallets;
  DELETE FROM otp_verifications;
  DELETE FROM copy_settings;
  DELETE FROM admin_config;
  DELETE FROM branches;

  DELETE FROM amm_state WHERE market_id NOT IN (
    'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008'
  );
  UPDATE markets SET created_by = '5e6e5299-bc89-457e-818b-d24d5f080a35';
  DELETE FROM markets WHERE id NOT IN (
    'a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000000004',
    'a0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000000006',
    'a0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000000008'
  );
  UPDATE markets SET
    status = 'open', outcome = NULL, trade_count = 0, unique_traders = 0,
    resolved_at = NULL, updated_at = NOW(), closes_at = NOW() + INTERVAL '6 months';
  UPDATE amm_state SET
    q_yes = 0, q_no = 0, current_yes_price = 0.5, current_no_price = 0.5,
    total_volume = 0, total_trades = 0, seed_pnl = 0, updated_at = NOW();

  DELETE FROM users WHERE id NOT IN (
    '5e6e5299-bc89-457e-818b-d24d5f080a35',
    'b0000000-0000-4000-8000-000000000001',
    'ad0b1999-129b-4c8c-97f8-b4e91d29d8f6'
  );
  UPDATE users SET
    balance_usd = 1000, total_wagered = 0, wagering_requirement = 0,
    deposit_bonus_claimed = false, agent_level = 1, direct_referral_count = 0,
    network_volume = 0, agent_balance_usd = 0, agent_activated = false,
    agent_activation_override = false, qualified_referral_count = 0,
    referred_by = NULL, referral_chain = '{}', updated_at = NOW();
  DELETE FROM auth.users WHERE id NOT IN (
    '5e6e5299-bc89-457e-818b-d24d5f080a35',
    'b0000000-0000-4000-8000-000000000001',
    'ad0b1999-129b-4c8c-97f8-b4e91d29d8f6'
  );

  INSERT INTO branches (id, name, branch_code, manager_user_id, pool_balance, worst_case_total, pending_payouts, status)
  VALUES ('c0000000-0000-4000-8000-000000000001', 'Test Branch', 'TEST-BRANCH', 'b0000000-0000-4000-8000-000000000001', 5000, 0, 0, 'active');
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES ('c0000000-0000-4000-8000-000000000001', 'credit', 5000, 5000, 'Initial test deposit');

  ALTER TABLE branch_pools ENABLE TRIGGER USER;
  ALTER TABLE branch_trades ENABLE TRIGGER USER;
  ALTER TABLE credit_chain_ledger ENABLE TRIGGER USER;
  ALTER TABLE branch_admin_overrides ENABLE TRIGGER USER;

  RETURN 'cleanup_complete';
END;
$function$;
