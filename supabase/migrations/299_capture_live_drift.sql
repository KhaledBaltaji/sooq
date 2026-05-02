-- ============================================================
-- 299: Capture live-staging schema drift as migrations catchup
--
-- Mechanical catchup — no behavior change. The CI schema-drift gate
-- (`supabase db diff --linked --schema public`) was flagging ~1200
-- lines of drift between the live staging DB and a shadow DB rebuilt
-- from committed migrations. The drift is PRE-EXISTING: these objects
-- were created directly against live (via Supabase UI or manual SQL)
-- before mid-April 2026, never checked in as migrations.
--
-- All CREATE statements here use CREATE OR REPLACE (functions) or
-- DROP IF EXISTS + CREATE (triggers/policies) so this migration is
-- idempotent on both the live DB (no-op, state already matches) and
-- a fresh DB (state reaches parity with live).
--
-- Groups of drift captured:
--   1. Audit-table triggers on branch_admin_overrides, branch_pools,
--      branch_trades, credit_chain_ledger — all DISABLED on live
--      (intentionally parked when mig 291 parked bookmaker V1, but
--      never formally captured in migrations).
--   2. OTP policy cleanup (duplicate "Service role full access" on
--      otp_verifications, already removed on live).
--   3. 14 orphan utility / staging-only functions:
--        - cleanup_test_data, staging_full_reset (test fixtures)
--        - _credit_branch_pl, _enforce_pl_rate_cap, _enforce_pl_rate_cap_insert,
--          _track_pool_underflow (parked bookmaker P&L helpers)
--        - _verify_admin_token, admin_update_fee, submit_manual_deposit,
--          verify_support_code (admin/support RPCs landed via UI)
--        - branch_settle_resolution, check_branch_velocity,
--          reconcile_branch_solvency, sweep_agent_microcredits
--          (branch subsystem helpers)
--
-- Generated from: supabase db diff --linked --schema public
-- (captured in CI log of run 24833006692 attempt 4, staging DB
-- zzebptrztuwnqlxxmjuo, 2026-04-23 12:20 UTC). No edits beyond
-- adding IF EXISTS to the single DROP POLICY at line 21 to make
-- the migration idempotent against a shadow that never had that
-- legacy policy in the first place.
-- ============================================================

BEGIN;

drop trigger if exists "prevent_branch_admin_overrides_delete" on "public"."branch_admin_overrides";

drop trigger if exists "prevent_branch_admin_overrides_update" on "public"."branch_admin_overrides";

drop trigger if exists "trg_branch_admin_overrides_no_delete" on "public"."branch_admin_overrides";

drop trigger if exists "trg_branch_admin_overrides_no_update" on "public"."branch_admin_overrides";

drop trigger if exists "trg_branch_pools_no_delete" on "public"."branch_pools";

drop trigger if exists "trg_branch_pools_no_update" on "public"."branch_pools";

drop trigger if exists "prevent_branch_trades_delete" on "public"."branch_trades";

drop trigger if exists "prevent_branch_trades_update" on "public"."branch_trades";

drop trigger if exists "trg_credit_chain_no_delete" on "public"."credit_chain_ledger";

drop trigger if exists "trg_credit_chain_no_update" on "public"."credit_chain_ledger";

drop policy if exists "Service role full access" on "public"."otp_verifications";

set check_function_bodies = off;

COMMIT;

-- Drift body (functions + triggers) begins after the cleanup transaction.
-- Each CREATE OR REPLACE is individually safe to run; they are intentionally
-- outside an explicit BEGIN/COMMIT so a single malformed function body
-- doesn't roll back the entire drift catchup.
set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.cleanup_test_data()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  test_user_ids uuid[];
  test_market_ids uuid[];
  u_count int;
  m_count int;
BEGIN
  SELECT array_agg(id) INTO test_user_ids FROM users WHERE display_name ~ '^Test User [a-f0-9]{6}$';
  SELECT array_agg(id) INTO test_market_ids FROM markets WHERE question_en = 'Test market?' OR (test_user_ids IS NOT NULL AND created_by = ANY(test_user_ids));
  
  m_count := coalesce(array_length(test_market_ids, 1), 0);
  u_count := coalesce(array_length(test_user_ids, 1), 0);
  
  IF test_market_ids IS NOT NULL THEN
    DELETE FROM referral_commissions WHERE market_id = ANY(test_market_ids);
    DELETE FROM platform_revenue WHERE market_id = ANY(test_market_ids);
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
    DELETE FROM telegram_users WHERE user_id = ANY(test_user_ids);
    DELETE FROM support_tickets WHERE user_id = ANY(test_user_ids);
    DELETE FROM support_verification_codes WHERE user_id = ANY(test_user_ids);
    DELETE FROM price_alerts WHERE user_id = ANY(test_user_ids);
    DELETE FROM comment_likes WHERE user_id = ANY(test_user_ids);
    DELETE FROM referral_commissions WHERE trader_id = ANY(test_user_ids) OR referrer_id = ANY(test_user_ids);
    UPDATE trades SET copied_from_user = NULL WHERE copied_from_user = ANY(test_user_ids);
    DELETE FROM transactions WHERE user_id = ANY(test_user_ids) OR performed_by = ANY(test_user_ids);
    DELETE FROM trades WHERE user_id = ANY(test_user_ids);
    DELETE FROM positions WHERE user_id = ANY(test_user_ids);
    DELETE FROM market_comments WHERE user_id = ANY(test_user_ids);
    DELETE FROM system_logs WHERE acknowledged_by = ANY(test_user_ids);
    DELETE FROM users WHERE id = ANY(test_user_ids);
  END IF;
  
  RETURN format('Deleted %s markets, %s users', m_count, u_count);
END;
$function$
;

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
  DELETE FROM support_messages;
  DELETE FROM support_tickets;
  DELETE FROM news_articles;
  DELETE FROM deposits;
  DELETE FROM withdrawals;
  DELETE FROM leader_stats;
  DELETE FROM price_alerts;
  DELETE FROM platform_revenue;
  DELETE FROM system_logs;
  DELETE FROM prelaunch_votes;
  DELETE FROM telegram_users;
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
$function$
;

CREATE OR REPLACE FUNCTION public._credit_branch_pl(p_branch_id uuid, p_agent_id uuid, p_agent_user_id uuid, p_market_id uuid, p_amount numeric, p_agent_rate numeric, p_pool_contribution numeric)
 RETURNS numeric
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_hold_enabled DECIMAL;
  v_unlock_at    TIMESTAMPTZ;
  v_new_balance  DECIMAL;
BEGIN
  UPDATE branch_agents
     SET cumulative_pl = cumulative_pl + p_amount
   WHERE id = p_agent_id;

  IF p_amount != 0 AND ABS(p_amount) < 0.01 THEN
    PERFORM _accrue_microcredit(p_agent_id, p_agent_user_id, p_branch_id, p_amount);
    RETURN p_amount;
  END IF;

  IF p_amount < 0 THEN
    RETURN p_amount;
  END IF;

  SELECT rate INTO v_hold_enabled
    FROM fee_config
   WHERE fee_type = 'commission_hold_enabled'
   LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id,
    layer, agent_level_at_time,
    platform_revenue_amount, commission_rate, commission_amount,
    status, revenue_type,
    unlock_at, source_type, branch_id
  ) VALUES (
    p_agent_user_id, p_agent_user_id, p_market_id, NULL,
    1, 1,
    p_pool_contribution, p_agent_rate, p_amount,
    'credited'::commission_status, 'resolution',
    v_unlock_at, 'branch_pl'::commission_source_type, p_branch_id
  );

  UPDATE users
     SET agent_balance_usd = agent_balance_usd + p_amount
   WHERE id = p_agent_user_id
   RETURNING agent_balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_agent_user_id, 'commission', p_amount, v_new_balance,
    p_market_id,
    'Branch P/L - ' || ROUND(p_agent_rate * 100, 1) || '% of $'
      || ROUND(p_pool_contribution, 2) || ' pool contribution'
  );

  RETURN p_amount;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._enforce_pl_rate_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap DECIMAL;
  v_existing_sum DECIMAL;
  v_old_contribution DECIMAL;
  v_new_contribution DECIMAL;
  v_proposed_total DECIMAL;
BEGIN
  IF NEW.agent_type IS DISTINCT FROM 'pl' AND OLD.agent_type IS DISTINCT FROM 'pl' THEN
    RETURN NEW;
  END IF;

  IF  NEW.rate = OLD.rate
      AND NEW.is_active = OLD.is_active
      AND NEW.agent_type = OLD.agent_type
      AND NEW.branch_id = OLD.branch_id THEN
    RETURN NEW;
  END IF;

  SELECT rate INTO v_cap
    FROM fee_config
   WHERE fee_type = 'max_pl_agent_rate_sum'
   LIMIT 1;
  v_cap := COALESCE(v_cap, 0.80);

  SELECT COALESCE(SUM(rate), 0) INTO v_existing_sum
    FROM branch_agents
   WHERE branch_id = NEW.branch_id
     AND agent_type = 'pl'
     AND is_active
     AND id != NEW.id;

  v_new_contribution := CASE
    WHEN NEW.agent_type = 'pl' AND NEW.is_active THEN NEW.rate
    ELSE 0
  END;

  v_old_contribution := CASE
    WHEN OLD.agent_type = 'pl' AND OLD.is_active THEN OLD.rate
    ELSE 0
  END;

  v_proposed_total := v_existing_sum + v_new_contribution;

  IF v_proposed_total > v_cap AND v_new_contribution > v_old_contribution THEN
    RAISE EXCEPTION
      'P/L rate cap exceeded on branch %: existing active sum %, proposed new contribution %, total % > cap %',
      NEW.branch_id,
      ROUND(v_existing_sum * 100, 2) || '%%',
      ROUND(v_new_contribution * 100, 2) || '%%',
      ROUND(v_proposed_total * 100, 2) || '%%',
      ROUND(v_cap * 100, 2) || '%%';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._enforce_pl_rate_cap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cap DECIMAL;
  v_existing_sum DECIMAL;
  v_proposed_total DECIMAL;
BEGIN
  IF NEW.agent_type IS DISTINCT FROM 'pl' OR NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  SELECT rate INTO v_cap
    FROM fee_config
   WHERE fee_type = 'max_pl_agent_rate_sum'
   LIMIT 1;
  v_cap := COALESCE(v_cap, 0.80);

  SELECT COALESCE(SUM(rate), 0) INTO v_existing_sum
    FROM branch_agents
   WHERE branch_id = NEW.branch_id
     AND agent_type = 'pl'
     AND is_active;

  v_proposed_total := v_existing_sum + NEW.rate;

  IF v_proposed_total > v_cap THEN
    RAISE EXCEPTION
      'P/L rate cap exceeded on branch % at INSERT: existing active sum %, new rate %, total % > cap %',
      NEW.branch_id,
      ROUND(v_existing_sum * 100, 2) || '%%',
      ROUND(NEW.rate * 100, 2) || '%%',
      ROUND(v_proposed_total * 100, 2) || '%%',
      ROUND(v_cap * 100, 2) || '%%';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._track_pool_underflow()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_underflow DECIMAL;
BEGIN
  IF NEW.pool_balance >= 0 THEN
    RETURN NEW;
  END IF;

  IF OLD.pool_balance >= 0 THEN
    v_underflow := ABS(NEW.pool_balance);
  ELSIF NEW.pool_balance < OLD.pool_balance THEN
    v_underflow := OLD.pool_balance - NEW.pool_balance;
  ELSE
    RETURN NEW;
  END IF;

  IF v_underflow < 0.01 THEN
    RETURN NEW;
  END IF;

  INSERT INTO commission_clawback_deficit (
    branch_id, deficit, reason
  ) VALUES (
    NEW.id, ROUND(v_underflow, 2), 'pool_underflow'
  );

  PERFORM log_system_event(
    'warn'::log_severity,
    'branch/pool_underflow',
    format('Branch %s pool_balance went negative: $%s (was $%s, now $%s)',
           NEW.name,
           ROUND(v_underflow, 2),
           ROUND(OLD.pool_balance, 2),
           ROUND(NEW.pool_balance, 2)),
    jsonb_build_object(
      'branch_id', NEW.id,
      'branch_name', NEW.name,
      'old_pool_balance', OLD.pool_balance,
      'new_pool_balance', NEW.pool_balance,
      'underflow_amount', v_underflow
    )
  );

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public._verify_admin_token(p_admin_id uuid, p_token text, p_expected_operation text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_config admin_config%ROWTYPE;
  v_parts TEXT[];
  v_payload_b64 TEXT;
  v_provided_sig TEXT;
  v_payload TEXT;
  v_payload_fields TEXT[];
  v_token_admin_id UUID;
  v_token_operation TEXT;
  v_issued_at TIMESTAMPTZ;
  v_computed_sig TEXT;
  v_freshness_window INTERVAL := INTERVAL '120 seconds';
BEGIN
  IF p_token IS NULL OR p_token = '' THEN
    RAISE EXCEPTION 'Admin token required';
  END IF;

  SELECT * INTO v_config
    FROM admin_config
   WHERE admin_user_id = p_admin_id;

  IF v_config IS NULL OR v_config.hmac_secret IS NULL THEN
    RAISE EXCEPTION 'Admin HMAC not configured. Set PIN first.';
  END IF;

  v_parts := string_to_array(p_token, '.');
  IF array_length(v_parts, 1) != 2 THEN
    RAISE EXCEPTION 'Invalid token format';
  END IF;

  v_payload_b64 := v_parts[1];
  v_provided_sig := v_parts[2];

  BEGIN
    v_payload := convert_from(decode(v_payload_b64, 'base64'), 'UTF8');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid token payload encoding';
  END;

  v_payload_fields := string_to_array(v_payload, '|');
  IF array_length(v_payload_fields, 1) != 3 THEN
    RAISE EXCEPTION 'Invalid token payload structure';
  END IF;

  BEGIN
    v_token_admin_id := v_payload_fields[1]::UUID;
    v_token_operation := v_payload_fields[2];
    v_issued_at := v_payload_fields[3]::TIMESTAMPTZ;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Malformed token payload';
  END;

  v_computed_sig := encode(
    extensions.hmac(v_payload::BYTEA, v_config.hmac_secret::BYTEA, 'sha256'),
    'hex'
  );

  IF v_computed_sig != v_provided_sig THEN
    RAISE EXCEPTION 'Invalid token signature';
  END IF;

  IF v_token_admin_id != p_admin_id THEN
    RAISE EXCEPTION 'Token admin mismatch';
  END IF;

  IF v_token_operation != p_expected_operation THEN
    RAISE EXCEPTION 'Token operation mismatch (expected %, got %)', p_expected_operation, v_token_operation;
  END IF;

  IF v_issued_at > NOW() + INTERVAL '10 seconds' THEN
    RAISE EXCEPTION 'Token issued in future (clock skew)';
  END IF;

  IF NOW() - v_issued_at > v_freshness_window THEN
    RAISE EXCEPTION 'Token expired (issued %)', v_issued_at;
  END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_fee(p_fee_id uuid, p_new_rate numeric, p_pin text DEFAULT NULL::text, p_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_admin_id UUID;
  v_old_rate DECIMAL;
  v_fee_type TEXT;
  v_fee_desc TEXT;
  v_min_rate DECIMAL;
  v_max_rate DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_admin_id, p_token, 'admin_update_fee');
  ELSE
    PERFORM _verify_admin_pin(v_admin_id, p_pin);
  END IF;

  SELECT rate, fee_type, description INTO v_old_rate, v_fee_type, v_fee_desc
  FROM fee_config WHERE id = p_fee_id;

  IF v_fee_type IS NULL THEN
    RAISE EXCEPTION 'Fee config not found';
  END IF;

  CASE v_fee_type
    WHEN 'explicit_fee'              THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'resolution_fee'            THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'cash_out_premium'          THEN v_min_rate := 0;     v_max_rate := 0.05;
    WHEN 'dynamic_spread_threshold'  THEN v_min_rate := 0.5;   v_max_rate := 1.0;
    WHEN 'dynamic_spread_multiplier' THEN v_min_rate := 0;     v_max_rate := 5.0;
    WHEN 'amm_default_b'             THEN v_min_rate := 100;   v_max_rate := 100000;
    WHEN 'amm_max_trade_pct'         THEN v_min_rate := 0;     v_max_rate := 1.0;
    WHEN 'min_trade_amount'          THEN v_min_rate := 0;     v_max_rate := 1000;
    WHEN 'deposit_fee'               THEN v_min_rate := 0;     v_max_rate := 0.10;
    WHEN 'withdrawal_fee'            THEN v_min_rate := 0;     v_max_rate := 0.10;
    WHEN 'ngr_commission'            THEN v_min_rate := 0;     v_max_rate := 0.60;
    WHEN 'ngr_resolution_commission' THEN v_min_rate := 0;     v_max_rate := 0.60;
    WHEN 'canonical_price_impact_cap' THEN v_min_rate := 0;    v_max_rate := 1.0;
    ELSE
      v_min_rate := 0; v_max_rate := 1.0;
      INSERT INTO system_logs (severity, source, message, context)
      VALUES ('warn', 'admin/fee',
        format('admin_update_fee: unknown fee_type %s - using default bounds [0, 1]', v_fee_type),
        jsonb_build_object('admin_id', v_admin_id, 'fee_id', p_fee_id, 'fee_type', v_fee_type));
  END CASE;

  IF p_new_rate < v_min_rate OR p_new_rate > v_max_rate THEN
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('warn', 'admin/fee',
      format('Fee update rejected: %s rate %s out of bounds [%s, %s]',
             v_fee_type, p_new_rate, v_min_rate, v_max_rate),
      jsonb_build_object(
        'admin_id', v_admin_id, 'fee_id', p_fee_id,
        'fee_type', v_fee_type, 'attempted_rate', p_new_rate,
        'min_allowed', v_min_rate, 'max_allowed', v_max_rate
      ));
    RAISE EXCEPTION 'Rate % out of bounds for %: must be between % and %',
      p_new_rate, v_fee_type, v_min_rate, v_max_rate;
  END IF;

  UPDATE fee_config SET rate = p_new_rate WHERE id = p_fee_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/fee', format('Fee updated: %s (%s -> %s)', v_fee_type, v_old_rate, p_new_rate),
    jsonb_build_object(
      'admin_id', v_admin_id, 'fee_id', p_fee_id, 'fee_type', v_fee_type,
      'old_rate', v_old_rate, 'new_rate', p_new_rate, 'description', v_fee_desc
    ));

  RETURN jsonb_build_object(
    'success', true, 'fee_type', v_fee_type,
    'old_rate', v_old_rate, 'new_rate', p_new_rate
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.branch_settle_resolution(p_market_id uuid, p_outcome public.bet_side)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_new_pool_balance DECIMAL;
  v_new_worst_case DECIMAL;
  v_branches_settled INTEGER := 0;
  v_total_branch_payouts DECIMAL := 0;
  v_branches_in_payback INTEGER := 0;
  v_branch_id UUID;
  v_pl_agent RECORD;
  v_trade_impact DECIMAL;
  v_sooq_addback_trades DECIMAL;
  v_resolution_impact DECIMAL;
  v_sooq_addback_resolution DECIMAL;
  v_pool_contribution DECIMAL;
  v_agent_pl DECIMAL;
  v_new_pool DECIMAL;
  v_pl_agents_settled INTEGER := 0;
  v_result JSONB;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  IF v_market.branch_settled_at IS NOT NULL THEN
    RETURN COALESCE(
      v_market.branch_settlement_result,
      jsonb_build_object('already_settled', true, 'settled_at', v_market.branch_settled_at)
    );
  END IF;

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
      v_new_pool_balance := v_branch_rec.pool_balance - v_branch_total_paid;

      UPDATE branches SET
        pool_balance = v_new_pool_balance,
        pending_payouts = CASE WHEN v_deficit > 0
                              THEN pending_payouts + v_deficit
                              ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'resolution_payout', -v_branch_total_paid,
              v_new_pool_balance, p_market_id);

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

    IF v_branch_rec.status != 'payback' THEN
      FOR v_pl_agent IN
        SELECT id, user_id, rate
        FROM branch_agents
        WHERE branch_id = v_branch_id
          AND agent_type = 'pl'
          AND is_active
      LOOP
        SELECT COALESCE(SUM(bp.amount), 0) INTO v_trade_impact
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type IN ('trade_buy', 'trade_sell', 'exit_fee');

        SELECT COALESCE(-SUM(bp.amount), 0) INTO v_sooq_addback_trades
        FROM branch_pools bp
        JOIN branch_trades bt ON bt.trade_id = bp.reference_id
        WHERE bp.branch_id = v_branch_id
          AND bp.market_id = p_market_id
          AND bt.agent_id = v_pl_agent.id
          AND bp.type = 'sooq_branch_fee';

        SELECT COALESCE(-SUM(p.shares_held * (1.0 - v_resolution_fee_rate)), 0)
          INTO v_resolution_impact
        FROM positions p
        JOIN branch_user_assignments a ON a.user_id = p.user_id
          AND a.branch_id = v_branch_id
        WHERE p.market_id = p_market_id
          AND p.branch_id = v_branch_id
          AND p.side = p_outcome
          AND p.shares_held > 0
          AND a.agent_id = v_pl_agent.id;

        SELECT COALESCE(SUM(p.shares_held * v_resolution_fee_rate), 0)
          INTO v_sooq_addback_resolution
        FROM positions p
        JOIN branch_user_assignments a ON a.user_id = p.user_id
          AND a.branch_id = v_branch_id
        WHERE p.market_id = p_market_id
          AND p.branch_id = v_branch_id
          AND p.side = p_outcome
          AND p.shares_held > 0
          AND a.agent_id = v_pl_agent.id;

        v_pool_contribution := v_trade_impact + v_sooq_addback_trades
                             + v_resolution_impact + v_sooq_addback_resolution;
        v_agent_pl := ROUND(v_pool_contribution * v_pl_agent.rate, 2);

        IF ABS(v_agent_pl) >= 0.01 THEN
          IF v_agent_pl > 0 THEN
            UPDATE branches
               SET pool_balance = pool_balance - v_agent_pl
             WHERE id = v_branch_id
             RETURNING pool_balance INTO v_new_pool;

            INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
            VALUES (v_branch_id, p_market_id, 'agent_pl_payout',
                    -v_agent_pl, v_new_pool, p_market_id,
                    'P/L payout - ' || ROUND(v_pl_agent.rate * 100, 1) || '% of $'
                      || ROUND(v_pool_contribution, 2) || ' pool contribution');
          END IF;

          PERFORM _credit_branch_pl(
            v_branch_id,
            v_pl_agent.id,
            v_pl_agent.user_id,
            p_market_id,
            v_agent_pl,
            v_pl_agent.rate,
            v_pool_contribution
          );

          v_pl_agents_settled := v_pl_agents_settled + 1;
        END IF;
      END LOOP;

      v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
      UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;
    END IF;

    v_branches_settled := v_branches_settled + 1;
    v_total_branch_payouts := v_total_branch_payouts + v_branch_total_paid;

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/resolution', format('Branch %s settled for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'winners', v_branch_winners,
        'total_paid', ROUND(v_branch_total_paid, 2),
        'deficit', ROUND(v_deficit, 2),
        'resolution_fees', ROUND(v_branch_fees, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id),
        'resolution_fee_rate_applied', v_resolution_fee_rate,
        'pl_agents_settled', v_pl_agents_settled
      ));
  END LOOP;

  v_result := jsonb_build_object(
    'branches_settled', v_branches_settled,
    'total_branch_payouts', ROUND(v_total_branch_payouts, 2),
    'branches_in_payback', v_branches_in_payback,
    'pl_agents_settled', v_pl_agents_settled
  );

  UPDATE markets
     SET branch_settled_at = NOW(),
         branch_settlement_result = v_result
   WHERE id = p_market_id;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.check_branch_velocity()
 RETURNS TABLE(branch_id uuid, branch_name text, today_volume numeric, daily_average numeric, velocity_ratio numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch RECORD;
  v_today_vol DECIMAL;
  v_avg_vol DECIMAL;
  v_ratio DECIMAL;
  v_already_logged BOOLEAN;
BEGIN
  FOR v_branch IN
    SELECT b.id, b.name FROM branches b WHERE b.status NOT IN ('suspended')
  LOOP
    SELECT COALESCE(SUM(t.total_cost), 0) INTO v_today_vol
    FROM trades t
    WHERE t.branch_id = v_branch.id
      AND t.created_at >= date_trunc('day', now());

    SELECT COALESCE(SUM(t.total_cost), 0) / 7.0 INTO v_avg_vol
    FROM trades t
    WHERE t.branch_id = v_branch.id
      AND t.created_at >= date_trunc('day', now() - INTERVAL '7 days')
      AND t.created_at < date_trunc('day', now());

    IF v_avg_vol <= 0 THEN
      CONTINUE;
    END IF;

    v_ratio := v_today_vol / v_avg_vol;

    IF v_ratio > 5.0 THEN
      SELECT EXISTS(
        SELECT 1 FROM system_logs
        WHERE source = 'pg/branch-velocity'
          AND (context->>'branch_id')::text = v_branch.id::text
          AND created_at >= now() - INTERVAL '1 hour'
      ) INTO v_already_logged;

      IF NOT v_already_logged THEN
        PERFORM log_system_event(
          'warn'::log_severity,
          'pg/branch-velocity',
          'Branch ' || v_branch.name || ' velocity spike: ' || ROUND(v_ratio, 1) || 'x average (today $' || ROUND(v_today_vol, 2) || ' vs avg $' || ROUND(v_avg_vol, 2) || '/day)',
          jsonb_build_object(
            'branch_id', v_branch.id,
            'branch_name', v_branch.name,
            'today_volume', ROUND(v_today_vol, 2),
            'daily_average', ROUND(v_avg_vol, 2),
            'velocity_ratio', ROUND(v_ratio, 2)
          )
        );
      END IF;

      branch_id := v_branch.id;
      branch_name := v_branch.name;
      today_volume := ROUND(v_today_vol, 2);
      daily_average := ROUND(v_avg_vol, 2);
      velocity_ratio := ROUND(v_ratio, 2);
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_branch_solvency()
 RETURNS TABLE(branch_id uuid, branch_name text, cached_worst_case numeric, computed_worst_case numeric, difference numeric, cached_pool_balance numeric, ledger_pool_balance numeric, pool_difference numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_branch         RECORD;
  v_computed       DECIMAL;
  v_ledger_balance DECIMAL;
  v_diff           DECIMAL;
  v_pool_diff      DECIMAL;
BEGIN
  FOR v_branch IN
    SELECT *
      FROM branches
     WHERE status NOT IN ('suspended')
       AND book_type = 'reseller'
  LOOP
    v_computed  := _recompute_branch_worst_case(v_branch.id);
    v_diff      := v_branch.worst_case_total - v_computed;

    SELECT COALESCE(SUM(amount), 0) INTO v_ledger_balance
      FROM branch_pools WHERE branch_pools.branch_id = v_branch.id;
    v_pool_diff := v_branch.pool_balance - v_ledger_balance;

    IF ABS(v_diff) > 0.01 OR ABS(v_pool_diff) > 0.01 THEN
      PERFORM log_system_event(
        'error'::log_severity,
        'branch_solvency_reconciliation',
        'Branch ' || v_branch.name || ' solvency mismatch',
        jsonb_build_object(
          'branch_id',          v_branch.id,
          'book_type',          v_branch.book_type::TEXT,
          'cached_worst_case',  v_branch.worst_case_total,
          'computed_worst_case',v_computed,
          'wc_difference',      v_diff,
          'cached_pool',        v_branch.pool_balance,
          'ledger_pool',        v_ledger_balance,
          'pool_difference',    v_pool_diff
        )
      );

      PERFORM set_config('app.trigger_bypass', 'true', true);
      UPDATE branches SET
        worst_case_total = v_computed,
        pool_balance = GREATEST(0, v_ledger_balance)
      WHERE id = v_branch.id;
    END IF;

    branch_id            := v_branch.id;
    branch_name          := v_branch.name;
    cached_worst_case    := v_branch.worst_case_total;
    computed_worst_case  := v_computed;
    difference           := v_diff;
    cached_pool_balance  := v_branch.pool_balance;
    ledger_pool_balance  := v_ledger_balance;
    pool_difference      := v_pool_diff;
    RETURN NEXT;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_manual_deposit(p_amount numeric, p_whish_number text DEFAULT NULL::text, p_proof_image_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
  v_deposit_id UUID;
  v_existing_pending UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must not be negative';
  END IF;

  BEGIN
    INSERT INTO deposits (
      user_id, amount, fee, net_amount, currency,
      provider, status, whish_number, proof_image_url
    )
    VALUES (
      v_user_id, p_amount, 0, 0, 'USD',
      'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
    )
    RETURNING id INTO v_deposit_id;

    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual Whish deposit submitted',
      jsonb_build_object(
        'deposit_id', v_deposit_id,
        'user_id', v_user_id,
        'has_proof', p_proof_image_url IS NOT NULL
      )
    );

    RETURN jsonb_build_object(
      'deposit_id', v_deposit_id,
      'status', 'pending_review',
      'already_pending', false
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_existing_pending
        FROM deposits
       WHERE user_id = v_user_id
         AND provider = 'whish_manual'
         AND status = 'pending_review'
       LIMIT 1;

      IF v_existing_pending IS NULL THEN
        INSERT INTO deposits (
          user_id, amount, fee, net_amount, currency,
          provider, status, whish_number, proof_image_url
        )
        VALUES (
          v_user_id, p_amount, 0, 0, 'USD',
          'whish_manual', 'pending_review', p_whish_number, p_proof_image_url
        )
        RETURNING id INTO v_deposit_id;

        RETURN jsonb_build_object(
          'deposit_id', v_deposit_id,
          'status', 'pending_review',
          'already_pending', false
        );
      END IF;

      PERFORM log_system_event(
        'info',
        'deposit/manual',
        'Manual Whish deposit duplicate submission (idempotent return)',
        jsonb_build_object(
          'existing_deposit_id', v_existing_pending,
          'user_id', v_user_id
        )
      );

      RETURN jsonb_build_object(
        'deposit_id', v_existing_pending,
        'status', 'pending_review',
        'already_pending', true
      );
  END;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sweep_agent_microcredits()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row RECORD;
  v_swept_count INT := 0;
  v_swept_total DECIMAL := 0;
  v_new_balance DECIMAL;
  v_hold_enabled DECIMAL;
  v_unlock_at TIMESTAMPTZ;
BEGIN
  SELECT rate INTO v_hold_enabled
    FROM fee_config
   WHERE fee_type = 'commission_hold_enabled'
   LIMIT 1;

  IF v_hold_enabled IS NOT NULL AND v_hold_enabled > 0 THEN
    v_unlock_at := date_trunc('month', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 month';
  ELSE
    v_unlock_at := NULL;
  END IF;

  FOR v_row IN
    SELECT *
      FROM agent_pending_microcredits
     WHERE accrued_amount >= 0.01
     FOR UPDATE
  LOOP
    INSERT INTO referral_commissions (
      referrer_id, trader_id, market_id, trade_id,
      layer, agent_level_at_time,
      platform_revenue_amount, commission_rate, commission_amount,
      status, revenue_type,
      unlock_at, source_type, branch_id
    ) VALUES (
      v_row.agent_user_id, v_row.agent_user_id, NULL, NULL,
      1, 1,
      v_row.accrued_amount, 0, ROUND(v_row.accrued_amount, 2),
      'credited'::commission_status, 'resolution',
      v_unlock_at, 'branch_pl'::commission_source_type, v_row.branch_id
    );

    UPDATE users
       SET agent_balance_usd = agent_balance_usd + ROUND(v_row.accrued_amount, 2)
     WHERE id = v_row.agent_user_id
     RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, description)
    VALUES (
      v_row.agent_user_id, 'commission', ROUND(v_row.accrued_amount, 2), v_new_balance,
      'Branch P/L microcredit sweep - ' || ROUND(v_row.accrued_amount, 4) || ' accrued'
    );

    UPDATE agent_pending_microcredits
       SET accrued_amount = v_row.accrued_amount - ROUND(v_row.accrued_amount, 2),
           last_sweep_at = NOW(),
           updated_at = NOW()
     WHERE id = v_row.id;

    v_swept_count := v_swept_count + 1;
    v_swept_total := v_swept_total + ROUND(v_row.accrued_amount, 2);
  END LOOP;

  IF v_swept_count > 0 THEN
    PERFORM log_system_event(
      'info'::log_severity,
      'commission/microcredit_sweep',
      format('Swept %s microcredit accumulators totaling $%s', v_swept_count, ROUND(v_swept_total, 2)),
      jsonb_build_object('swept_count', v_swept_count, 'swept_total', v_swept_total)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'swept_count', v_swept_count,
    'swept_total', ROUND(v_swept_total, 2)
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_support_code(p_ticket_id uuid, p_user_id uuid, p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_record RECORD;
  v_ticket RECORD;
  v_max_attempts INT := 3;
  v_now TIMESTAMPTZ;
  v_remaining INT;
BEGIN
  v_now := NOW();

  SELECT * INTO v_ticket
    FROM support_tickets
   WHERE id = p_ticket_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ticket not found';
  END IF;

  IF v_ticket.user_id != p_user_id THEN
    RAISE EXCEPTION 'Ticket does not belong to user';
  END IF;

  SELECT * INTO v_record
    FROM support_verification_codes
   WHERE ticket_id = p_ticket_id
     AND verified_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'no_pending_code',
      'error', 'No pending verification code. Please request a new one.'
    );
  END IF;

  IF v_record.expires_at < v_now THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'expired',
      'error', 'Verification code has expired. Please request a new one.'
    );
  END IF;

  IF v_record.attempts >= v_max_attempts THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'too_many_attempts',
      'error', 'Too many failed attempts. Escalating to support team.'
    );
  END IF;

  UPDATE support_verification_codes
     SET attempts = attempts + 1
   WHERE id = v_record.id;

  IF v_record.code != TRIM(p_code) THEN
    v_remaining := v_max_attempts - (v_record.attempts + 1);
    IF v_remaining <= 0 THEN
      RETURN jsonb_build_object(
        'success', false,
        'reason', 'too_many_attempts',
        'error', 'Too many failed attempts. Escalating to support team.',
        'remaining', 0
      );
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'incorrect_code',
      'error', format('Incorrect code. %s attempt%s remaining.', v_remaining, CASE WHEN v_remaining = 1 THEN '' ELSE 's' END),
      'remaining', v_remaining
    );
  END IF;

  UPDATE support_verification_codes
     SET verified_at = v_now
   WHERE id = v_record.id;

  UPDATE support_tickets
     SET identity_verified_at = v_now
   WHERE id = p_ticket_id;

  RETURN jsonb_build_object(
    'success', true,
    'verified_at', v_now
  );
END;
$function$
;

CREATE TRIGGER prevent_branch_admin_overrides_delete BEFORE DELETE ON public.branch_admin_overrides FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_table_mutation();
ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "prevent_branch_admin_overrides_delete";

CREATE TRIGGER prevent_branch_admin_overrides_update BEFORE UPDATE ON public.branch_admin_overrides FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_table_mutation();
ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "prevent_branch_admin_overrides_update";

CREATE TRIGGER trg_branch_admin_overrides_no_delete BEFORE DELETE ON public.branch_admin_overrides FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "trg_branch_admin_overrides_no_delete";

CREATE TRIGGER trg_branch_admin_overrides_no_update BEFORE UPDATE ON public.branch_admin_overrides FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "trg_branch_admin_overrides_no_update";

CREATE TRIGGER trg_branch_pools_no_delete BEFORE DELETE ON public.branch_pools FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."branch_pools" DISABLE TRIGGER "trg_branch_pools_no_delete";

CREATE TRIGGER trg_branch_pools_no_update BEFORE UPDATE ON public.branch_pools FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."branch_pools" DISABLE TRIGGER "trg_branch_pools_no_update";

CREATE TRIGGER prevent_branch_trades_delete BEFORE DELETE ON public.branch_trades FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_table_mutation();
ALTER TABLE "public"."branch_trades" DISABLE TRIGGER "prevent_branch_trades_delete";

CREATE TRIGGER prevent_branch_trades_update BEFORE UPDATE ON public.branch_trades FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_table_mutation();
ALTER TABLE "public"."branch_trades" DISABLE TRIGGER "prevent_branch_trades_update";

CREATE TRIGGER trg_credit_chain_no_delete BEFORE DELETE ON public.credit_chain_ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."credit_chain_ledger" DISABLE TRIGGER "trg_credit_chain_no_delete";

CREATE TRIGGER trg_credit_chain_no_update BEFORE UPDATE ON public.credit_chain_ledger FOR EACH ROW EXECUTE FUNCTION public.prevent_branch_pools_mutation();
ALTER TABLE "public"."credit_chain_ledger" DISABLE TRIGGER "trg_credit_chain_no_update";



