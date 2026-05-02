Initialising login role...
Dumping schemas from remote database...



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."agent_level" AS ENUM (
    '1',
    '2',
    '3',
    '4'
);


ALTER TYPE "public"."agent_level" OWNER TO "postgres";


CREATE TYPE "public"."alert_direction" AS ENUM (
    'above',
    'below'
);


ALTER TYPE "public"."alert_direction" OWNER TO "postgres";


CREATE TYPE "public"."bet_side" AS ENUM (
    'yes',
    'no'
);


ALTER TYPE "public"."bet_side" OWNER TO "postgres";


CREATE TYPE "public"."branch_agent_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'suspended'
);


ALTER TYPE "public"."branch_agent_status" OWNER TO "postgres";


CREATE TYPE "public"."branch_agent_type" AS ENUM (
    'pl',
    'commission'
);


ALTER TYPE "public"."branch_agent_type" OWNER TO "postgres";


CREATE TYPE "public"."branch_book_type" AS ENUM (
    'reseller',
    'bookmaker',
    'commission'
);


ALTER TYPE "public"."branch_book_type" OWNER TO "postgres";


CREATE TYPE "public"."branch_display_mode" AS ENUM (
    'trading',
    'betting'
);


ALTER TYPE "public"."branch_display_mode" OWNER TO "postgres";


CREATE TYPE "public"."branch_override_type" AS ENUM (
    'solvency_gate_loosened',
    'withdrawal_lock_bypassed',
    'status_change',
    'pool_adjustment',
    'config_change'
);


ALTER TYPE "public"."branch_override_type" OWNER TO "postgres";


CREATE TYPE "public"."branch_pool_entry_type" AS ENUM (
    'credit',
    'trade_buy',
    'trade_sell',
    'exit_fee',
    'resolution_payout',
    'resolution_fee',
    'void_refund',
    'withdrawal',
    'withdrawal_fee',
    'payback_sweep',
    'adjustment',
    'sooq_branch_fee',
    'agent_commission',
    'agent_pl_payout',
    'owner_payout'
);


ALTER TYPE "public"."branch_pool_entry_type" OWNER TO "postgres";


CREATE TYPE "public"."branch_status" AS ENUM (
    'active',
    'payback',
    'frozen',
    'suspended'
);


ALTER TYPE "public"."branch_status" OWNER TO "postgres";


CREATE TYPE "public"."commission_source_type" AS ENUM (
    'referral_trade',
    'referral_resolution',
    'branch_commission',
    'branch_pl',
    'referral_speed'
);


ALTER TYPE "public"."commission_source_type" OWNER TO "postgres";


CREATE TYPE "public"."commission_status" AS ENUM (
    'escrowed',
    'credited',
    'voided',
    'pending'
);


ALTER TYPE "public"."commission_status" OWNER TO "postgres";


CREATE TYPE "public"."credit_chain_role" AS ENUM (
    'admin',
    'branch_manager',
    'agent',
    'sub_agent',
    'user'
);


ALTER TYPE "public"."credit_chain_role" OWNER TO "postgres";


CREATE TYPE "public"."demo_transaction_type" AS ENUM (
    'demo_bet',
    'demo_win',
    'demo_reset',
    'demo_seed'
);


ALTER TYPE "public"."demo_transaction_type" OWNER TO "postgres";


CREATE TYPE "public"."log_severity" AS ENUM (
    'info',
    'warn',
    'error',
    'critical'
);


ALTER TYPE "public"."log_severity" OWNER TO "postgres";


CREATE TYPE "public"."market_status" AS ENUM (
    'draft',
    'open',
    'closed',
    'resolved',
    'voided'
);


ALTER TYPE "public"."market_status" OWNER TO "postgres";


CREATE TYPE "public"."speed_asset" AS ENUM (
    'BTC'
);


ALTER TYPE "public"."speed_asset" OWNER TO "postgres";


CREATE TYPE "public"."speed_branch_status" AS ENUM (
    'inactive',
    'active',
    'warning',
    'frozen',
    'suspended'
);


ALTER TYPE "public"."speed_branch_status" OWNER TO "postgres";


CREATE TYPE "public"."speed_duration" AS ENUM (
    '5m',
    '15m',
    '1h',
    '24h'
);


ALTER TYPE "public"."speed_duration" OWNER TO "postgres";


CREATE TYPE "public"."speed_market_outcome" AS ENUM (
    'over',
    'under',
    'at_strike'
);


ALTER TYPE "public"."speed_market_outcome" OWNER TO "postgres";


CREATE TYPE "public"."speed_market_status" AS ENUM (
    'pending',
    'open',
    'resolving',
    'resolved',
    'voided',
    'halted'
);


ALTER TYPE "public"."speed_market_status" OWNER TO "postgres";


CREATE TYPE "public"."speed_pool_entry_type" AS ENUM (
    'collateral_credit',
    'collateral_withdraw',
    'fee_withdrawal_self',
    'admin_withdrawal_discretionary',
    'stake_in',
    'cashout_out',
    'winning_payout',
    'refund',
    'fee_share_in'
);


ALTER TYPE "public"."speed_pool_entry_type" OWNER TO "postgres";


CREATE TYPE "public"."speed_position_status" AS ENUM (
    'open',
    'cashed_out',
    'won',
    'lost',
    'refunded'
);


ALTER TYPE "public"."speed_position_status" OWNER TO "postgres";


CREATE TYPE "public"."speed_trade_kind" AS ENUM (
    'open',
    'cashout'
);


ALTER TYPE "public"."speed_trade_kind" OWNER TO "postgres";


CREATE TYPE "public"."trade_direction" AS ENUM (
    'buy',
    'sell'
);


ALTER TYPE "public"."trade_direction" OWNER TO "postgres";


CREATE TYPE "public"."transaction_type" AS ENUM (
    'bet',
    'win',
    'deposit',
    'withdrawal',
    'commission',
    'bonus',
    'refund',
    'seed',
    'trade',
    'close_position',
    'resolution_payout',
    'resolution_fee',
    'agent_transfer_out',
    'agent_transfer_in',
    'commission_release',
    'admin_credit',
    'admin_debit',
    'branch_credit_out',
    'branch_credit_in',
    'branch_owner_payout',
    'speed_stake',
    'speed_winning',
    'speed_cashout',
    'speed_refund'
);


ALTER TYPE "public"."transaction_type" OWNER TO "postgres";


CREATE TYPE "public"."withdrawal_status" AS ENUM (
    'pending',
    'approved',
    'rejected',
    'sent',
    'completed',
    'failed'
);


ALTER TYPE "public"."withdrawal_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF p_amount = 0 THEN RETURN; END IF;

  INSERT INTO agent_pending_microcredits (
    agent_id, agent_user_id, branch_id, accrued_amount, last_accrual_at, updated_at
  ) VALUES (
    p_agent_id, p_agent_user_id, p_branch_id, p_amount, NOW(), NOW()
  )
  ON CONFLICT (agent_id, branch_id) DO UPDATE SET
    accrued_amount = agent_pending_microcredits.accrued_amount + EXCLUDED.accrued_amount,
    last_accrual_at = NOW(),
    updated_at = NOW();
END;
$$;


ALTER FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) IS 'Adds a sub-cent P/L amount to the agent accumulator. Called from _credit_branch_pl when |amount| < $0.01.';



CREATE OR REPLACE FUNCTION "public"."_branch_worst_case_market"("p_branch_id" "uuid", "p_market_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_yes_shares DECIMAL := 0;
  v_no_shares DECIMAL := 0;
  v_pool_cash DECIMAL := 0;
  v_worst DECIMAL;
BEGIN
  SELECT COALESCE(SUM(shares_held), 0) INTO v_yes_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;

  SELECT COALESCE(SUM(shares_held), 0) INTO v_no_shares
  FROM positions
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

  -- All entry types affect pool cash (unified with reconcile_branch_solvency)
  SELECT COALESCE(SUM(amount), 0) INTO v_pool_cash
  FROM branch_pools
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  v_worst := GREATEST(0,
    GREATEST(v_yes_shares * 0.99, v_no_shares * 0.99) - v_pool_cash
  );

  RETURN v_worst;
END;
$$;


ALTER FUNCTION "public"."_branch_worst_case_market"("p_branch_id" "uuid", "p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) RETURNS numeric
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_hold_enabled DECIMAL;
  v_unlock_at    TIMESTAMPTZ;
  v_new_balance  DECIMAL;
BEGIN
  IF p_amount < 0.01 THEN
    RETURN 0;
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
    p_agent_user_id, p_trader_id, p_market_id, p_trade_id,
    1, 1,
    p_markup_amount, p_agent_rate, p_amount,
    'credited'::commission_status, 'trade',
    v_unlock_at, 'branch_commission'::commission_source_type, p_branch_id
  );

  UPDATE users
     SET agent_balance_usd = agent_balance_usd + p_amount
   WHERE id = p_agent_user_id
   RETURNING agent_balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_agent_user_id, 'commission', p_amount, v_new_balance,
    COALESCE(p_trade_id, p_market_id),
    'Branch Commission — ' || ROUND(p_agent_rate * 100, 1) || '% of $'
      || ROUND(p_markup_amount, 2) || ' markup'
  );

  RETURN p_amount;
END;
$_$;


ALTER FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) RETURNS numeric
    LANGUAGE "plpgsql"
    AS $_$
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
$_$;


ALTER FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_credit_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric, "p_fee_type" "text", "p_revenue_type" "text") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_rate DECIMAL;
  v_commission DECIMAL;
  v_new_balance DECIMAL;
  v_activated BOOLEAN;
  v_market_status TEXT;
  v_status commission_status;
  v_should_credit BOOLEAN;
BEGIN
  -- Lookup the commission rate for this tier + layer + fee type
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = p_fee_type
    AND level = p_agent_level
    AND depth = p_layer;

  IF v_rate IS NULL OR v_rate = 0 THEN
    RETURN 0;
  END IF;

  v_commission := p_platform_revenue * v_rate;

  -- Dust threshold: don't create sub-cent rows
  IF v_commission < 0.01 THEN
    RETURN 0;
  END IF;

  v_activated := _is_agent_activated(p_ancestor_id);

  -- Decide status:
  --  - Not activated → 'escrowed' (unchanged, released via _release_escrowed_commissions on activation)
  --  - Activated + resolution-time → 'credited' (the market is resolving RIGHT NOW)
  --  - Activated + trade-time → depends on market.status:
  --      open/locked → 'pending' (wait for resolution)
  --      resolved   → 'credited' (rare: trade happened but resolution landed first)
  --      voided     → 'voided' (shouldn't happen since market rejects trades)
  IF NOT v_activated THEN
    v_status := 'escrowed';
    v_should_credit := FALSE;
  ELSIF p_revenue_type = 'resolution' THEN
    v_status := 'credited';
    v_should_credit := TRUE;
  ELSE
    -- Trade-time, activated agent — check market status
    SELECT status INTO v_market_status FROM markets WHERE id = p_market_id;
    IF v_market_status IN ('open', 'closed') THEN
      v_status := 'pending';
      v_should_credit := FALSE;
    ELSIF v_market_status = 'resolved' THEN
      v_status := 'credited';
      v_should_credit := TRUE;
    ELSIF v_market_status = 'voided' THEN
      v_status := 'voided';
      v_should_credit := FALSE;
    ELSE
      -- Unknown state → default to pending (safest: not in balance yet)
      v_status := 'pending';
      v_should_credit := FALSE;
    END IF;
  END IF;

  -- Insert the commission row. unlock_at is always NULL going forward
  -- (the status column is the authoritative release gate).
  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type, unlock_at
  ) VALUES (
    p_ancestor_id, p_trader_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission,
    v_status,
    p_revenue_type,
    NULL
  );

  -- Only credit the wallet when the commission is immediately spendable
  IF v_should_credit THEN
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
$_$;


ALTER FUNCTION "public"."_credit_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric, "p_fee_type" "text", "p_revenue_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_credit_speed_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_rate         DECIMAL;
  v_commission   DECIMAL;
  v_activated    BOOLEAN;
  v_status       commission_status;
  v_should_credit BOOLEAN;
  v_new_balance  DECIMAL;
BEGIN
  SELECT rate INTO v_rate
  FROM fee_config
  WHERE fee_type = 'speed_ngr_commission'
    AND level = p_agent_level
    AND depth = p_layer;

  IF v_rate IS NULL OR v_rate = 0 THEN RETURN 0; END IF;

  v_commission := p_platform_revenue * v_rate;
  IF v_commission < 0.01 THEN RETURN 0; END IF;

  v_activated := _is_agent_activated(p_ancestor_id);

  IF NOT v_activated THEN
    v_status := 'escrowed';
    v_should_credit := FALSE;
  ELSE
    v_status := 'credited';
    v_should_credit := TRUE;
  END IF;

  INSERT INTO referral_commissions (
    referrer_id, trader_id, market_id, trade_id, layer,
    agent_level_at_time, platform_revenue_amount, commission_rate,
    commission_amount, status, revenue_type, source_type, branch_id
  ) VALUES (
    p_ancestor_id, p_trader_id, p_market_id, p_trade_id, p_layer,
    p_agent_level, p_platform_revenue, v_rate,
    v_commission, v_status, 'speed_trade', 'referral_speed', NULL
  );

  IF v_should_credit THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_commission
    WHERE id = p_ancestor_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      p_ancestor_id, 'commission', v_commission, v_new_balance,
      p_trade_id,
      'Speed commission (Layer ' || p_layer || ') — ' || ROUND(v_rate * 100, 1) || '% of $' || ROUND(p_platform_revenue, 4)
    );
  END IF;

  RETURN v_commission;
END;
$_$;


ALTER FUNCTION "public"."_credit_speed_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_demo_assert_admin"() RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id UUID;
  v_caller RECORD;
BEGIN
  v_caller_id := auth.uid();
  -- Service-role invocations (auth.uid() IS NULL) are always allowed. Callers
  -- already enforce service-role-or-admin at their boundary.
  IF v_caller_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, is_admin, admin_allowed_views INTO v_caller
  FROM users WHERE id = v_caller_id;

  IF NOT FOUND OR NOT v_caller.is_admin THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Super admin (no scope restriction) passes.
  IF v_caller.admin_allowed_views IS NULL
     OR array_length(v_caller.admin_allowed_views, 1) IS NULL
     OR array_length(v_caller.admin_allowed_views, 1) = 0 THEN
    RETURN v_caller_id;
  END IF;

  -- Sub-admin: must have 'demo' in allowed views
  IF NOT ('demo' = ANY(v_caller.admin_allowed_views)) THEN
    RAISE EXCEPTION 'Admin access required (demo scope)';
  END IF;

  RETURN v_caller_id;
END;
$$;


ALTER FUNCTION "public"."_demo_assert_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_commission_branch_agent_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_book_type branch_book_type;
BEGIN
  SELECT book_type INTO v_book_type
  FROM branches
  WHERE id = NEW.branch_id;

  IF v_book_type = 'commission' THEN
    IF NEW.agent_type <> 'commission' THEN
      RAISE EXCEPTION 'Commission branches accept commission-type agents only (got %)', NEW.agent_type
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.deposit_required IS DISTINCT FROM 0 OR NEW.deposit_held IS DISTINCT FROM 0 THEN
      RAISE EXCEPTION 'Commission branches require zero deposit (got required=%, held=%)',
        NEW.deposit_required, NEW.deposit_held
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_enforce_commission_branch_agent_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enforce_pl_rate_cap"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."_enforce_pl_rate_cap"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_enforce_pl_rate_cap"() IS 'BEFORE UPDATE trigger on branch_agents: rejects rate/status changes that would push combined active P/L rate on a branch above fee_config.max_pl_agent_rate_sum (default 0.80). Grandfathers pre-existing excess - only blocks worse states. Defense-in-depth for approve_branch_agent.';



CREATE OR REPLACE FUNCTION "public"."_enforce_pl_rate_cap_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."_enforce_pl_rate_cap_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_is_agent_activated"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."_is_agent_activated"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT CASE p_duration
    WHEN '5m'::speed_duration THEN
      date_trunc('hour', p_now)
        + INTERVAL '5 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 5) + 1)
    WHEN '15m'::speed_duration THEN
      date_trunc('hour', p_now)
        + INTERVAL '15 min' * (FLOOR(EXTRACT(MINUTE FROM p_now) / 15) + 1)
    WHEN '1h'::speed_duration THEN
      date_trunc('hour', p_now) + INTERVAL '1 hour'
    WHEN '24h'::speed_duration THEN
      date_trunc('day', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + INTERVAL '1 day'
  END;
$$;


ALTER FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) IS 'Returns the next clean clock boundary timestamp after p_now for a given duration. 5m → :00,:05,...; 15m → :00,:15,:30,:45; 1h → :00; 24h → midnight UTC.';



CREATE OR REPLACE FUNCTION "public"."_on_market_status_change_release_commissions"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Transition into 'resolved' → release pending commissions for this market
  IF NEW.status = 'resolved' AND (OLD.status IS NULL OR OLD.status <> 'resolved') THEN
    PERFORM _release_pending_commissions_for_market(NEW.id);
  END IF;

  -- Transition into 'voided' → sweep pending → voided (no balance change)
  IF NEW.status = 'voided' AND (OLD.status IS NULL OR OLD.status <> 'voided') THEN
    UPDATE referral_commissions
    SET status = 'voided'
    WHERE market_id = NEW.id AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_on_market_status_change_release_commissions"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_protect_branch_book_type"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.book_type IS DISTINCT FROM OLD.book_type THEN
    RAISE EXCEPTION 'branches.book_type is immutable after creation (row id=%)', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_protect_branch_book_type"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_recompute_branch_worst_case"("p_branch_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_total DECIMAL := 0;
  v_market RECORD;
BEGIN
  -- Sum worst case across all open markets where this branch has positions
  FOR v_market IN
    SELECT DISTINCT market_id
    FROM positions
    WHERE branch_id = p_branch_id AND shares_held > 0
  LOOP
    v_total := v_total + _branch_worst_case_market(p_branch_id, v_market.market_id);
  END LOOP;

  RETURN v_total;
END;
$$;


ALTER FUNCTION "public"."_recompute_branch_worst_case"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_reject_reserved_branch_slug"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF NEW.branch_code = ANY(_reserved_slugs()) THEN
    RAISE EXCEPTION 'Branch slug "%" is reserved', NEW.branch_code
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_reject_reserved_branch_slug"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_release_escrowed_commissions"("p_user_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_comm RECORD;
  v_market_status TEXT;
  v_total_credited DECIMAL := 0;
  v_new_balance DECIMAL;
BEGIN
  FOR v_comm IN
    SELECT c.* FROM referral_commissions c
    WHERE c.referrer_id = p_user_id AND c.status = 'escrowed'
    ORDER BY c.id
  LOOP
    SELECT status INTO v_market_status FROM markets WHERE id = v_comm.market_id;

    IF v_market_status = 'resolved' THEN
      -- Market already resolved → credit immediately
      UPDATE referral_commissions SET status = 'credited' WHERE id = v_comm.id;
      v_total_credited := v_total_credited + v_comm.commission_amount;
    ELSIF v_market_status IN ('open', 'closed') THEN
      -- Market still open → defer to pending
      UPDATE referral_commissions SET status = 'pending' WHERE id = v_comm.id;
    ELSIF v_market_status = 'voided' THEN
      -- Market already voided → this commission was never valid
      UPDATE referral_commissions SET status = 'voided' WHERE id = v_comm.id;
    ELSE
      -- Unknown market state → leave as escrowed (manual admin review)
      CONTINUE;
    END IF;
  END LOOP;

  -- Single bulk balance update + ledger row if anything got credited
  IF v_total_credited > 0 THEN
    UPDATE users SET agent_balance_usd = agent_balance_usd + v_total_credited
    WHERE id = p_user_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, description)
    VALUES (
      p_user_id, 'commission_release', v_total_credited, v_new_balance,
      'Agent activated — $' || ROUND(v_total_credited, 2)
      || ' in escrowed commissions released (resolved-market commissions only)'
    );
  END IF;

  RETURN v_total_credited;
END;
$_$;


ALTER FUNCTION "public"."_release_escrowed_commissions"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_release_pending_commissions_for_market"("p_market_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    AS $_$
DECLARE
  v_comm RECORD;
  v_new_balance DECIMAL;
  v_count INTEGER := 0;
BEGIN
  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'pending'
  LOOP
    -- Flip to credited + increment wallet + write ledger
    UPDATE referral_commissions SET status = 'credited'
    WHERE id = v_comm.id;

    UPDATE users SET agent_balance_usd = agent_balance_usd + v_comm.commission_amount
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_new_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', v_comm.commission_amount,
      v_new_balance,
      COALESCE(v_comm.trade_id, v_comm.market_id),
      'Commission released at resolution (Layer ' || v_comm.layer || ', '
      || v_comm.revenue_type || ') — $' || ROUND(v_comm.commission_amount, 2)
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$_$;


ALTER FUNCTION "public"."_release_pending_commissions_for_market"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_reserved_slugs"() RETURNS "text"[]
    LANGUAGE "sql" IMMUTABLE
    AS $$
  SELECT ARRAY[
    'admin', 'api', 'app', 'auth',
    'b', 'branch', 'branches',
    'dashboard', 'demo',
    'help', 'home',
    'login', 'logout',
    'market', 'markets',
    'r', 'referral', 'referrals',
    'settings', 'signup', 'signin', 'sooq', 'support',
    'terms', 'privacy'
  ]::TEXT[];
$$;


ALTER FUNCTION "public"."_reserved_slugs"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_reserved_slugs"() IS 'Reserved branch slugs — mirrors RESERVED_SLUGS in src/lib/slug-rules.ts. Update both together.';



CREATE OR REPLACE FUNCTION "public"."_set_trigger_bypass_wrapper"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
      BEGIN
        PERFORM set_config('app.trigger_bypass', 'true', TRUE);
      END;
      $$;


ALTER FUNCTION "public"."_set_trigger_bypass_wrapper"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_partition_name TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  v_start := p_target_date::TIMESTAMPTZ;
  v_end := (p_target_date + INTERVAL '1 day')::TIMESTAMPTZ;
  v_partition_name := 'speed_pool_ledger_' || to_char(p_target_date, 'YYYYMMDD');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF speed_pool_ledger FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start, v_end
  );
END;
$$;


ALTER FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") IS 'Creates the speed_pool_ledger partition for the given date if missing. Called by maintenance cron daily and by tests.';



CREATE OR REPLACE FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_partition_name TEXT;
  v_start TIMESTAMPTZ;
  v_end TIMESTAMPTZ;
BEGIN
  v_start := p_target_date::TIMESTAMPTZ;
  v_end := (p_target_date + INTERVAL '1 day')::TIMESTAMPTZ;
  v_partition_name := 'speed_trades_' || to_char(p_target_date, 'YYYYMMDD');
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF speed_trades FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start, v_end
  );
END;
$$;


ALTER FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") IS 'Creates the speed_trades partition for the given date if missing. Called by maintenance cron daily and by tests.';



CREATE OR REPLACE FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") RETURNS numeric
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_iv DECIMAL;
BEGIN
  SELECT rv INTO v_iv
  FROM speed_realized_vol_cache
  WHERE asset = p_asset
    AND computed_at > NOW() - INTERVAL '90 seconds';

  IF v_iv IS NULL THEN
    SELECT rate INTO v_iv FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    v_iv := COALESCE(v_iv, 0.60);
  END IF;

  RETURN v_iv;
END;
$$;


ALTER FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") IS 'Mig 354: shared IV lookup. Reads speed_realized_vol_cache with 90s freshness window (was 5min); falls back to fee_config.speed_iv_btc on stale/missing.';



CREATE OR REPLACE FUNCTION "public"."_speed_position_exposure_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_market_asset speed_asset;
  v_delta_over_stake DECIMAL := 0;
  v_delta_under_stake DECIMAL := 0;
  v_delta_count INTEGER := 0;
  v_effective_branch_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'open' THEN
      IF NEW.side = 'over' THEN
        v_delta_over_stake := NEW.stake;
      ELSE
        v_delta_under_stake := NEW.stake;
      END IF;
      v_delta_count := 1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = NEW.market_id;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'open' AND NEW.status <> 'open' THEN
      IF OLD.side = 'over' THEN
        v_delta_over_stake := -OLD.stake;
      ELSE
        v_delta_under_stake := -OLD.stake;
      END IF;
      v_delta_count := -1;
    ELSIF OLD.status <> 'open' AND NEW.status = 'open' THEN
      IF NEW.side = 'over' THEN
        v_delta_over_stake := NEW.stake;
      ELSE
        v_delta_under_stake := NEW.stake;
      END IF;
      v_delta_count := 1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = NEW.market_id;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'open' THEN
      IF OLD.side = 'over' THEN
        v_delta_over_stake := -OLD.stake;
      ELSE
        v_delta_under_stake := -OLD.stake;
      END IF;
      v_delta_count := -1;
    END IF;
    SELECT asset INTO v_market_asset FROM speed_markets WHERE id = OLD.market_id;
  END IF;

  IF v_delta_over_stake = 0 AND v_delta_under_stake = 0 AND v_delta_count = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- ── Per-market exposure cache (branch-agnostic) — always updated ──────
  INSERT INTO speed_market_exposure_live (
    market_id, asset, net_notional, net_qty, open_position_count, branch_breakdown, last_updated_at
  ) VALUES (
    COALESCE(NEW.market_id, OLD.market_id),
    v_market_asset,
    v_delta_over_stake - v_delta_under_stake,
    0,
    GREATEST(0, v_delta_count),
    '[]'::jsonb,
    NOW()
  )
  ON CONFLICT (market_id) DO UPDATE SET
    net_notional = speed_market_exposure_live.net_notional + (v_delta_over_stake - v_delta_under_stake),
    open_position_count = GREATEST(0, speed_market_exposure_live.open_position_count + v_delta_count),
    last_updated_at = NOW();

  -- ── Per-branch exposure cache — SKIP for retail (branch_id IS NULL) ───
  -- Mig 346 fix: speed_exposure_live.branch_id is NOT NULL with FK to
  -- branches(id), so the cache is per-reseller-branch only. Retail/main-pool
  -- flow doesn't have a branch, so there's nothing to record here. The
  -- per-market cache above is what the exposure-cap RPC actually reads.
  v_effective_branch_id := COALESCE(NEW.branch_id, OLD.branch_id);
  IF v_effective_branch_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  INSERT INTO speed_exposure_live (
    branch_id, asset, open_over_notional, open_under_notional, net_notional,
    open_position_count, utilization_pct, last_updated_at
  ) VALUES (
    v_effective_branch_id,
    v_market_asset,
    GREATEST(0, v_delta_over_stake),
    GREATEST(0, v_delta_under_stake),
    v_delta_over_stake - v_delta_under_stake,
    GREATEST(0, v_delta_count),
    0,
    NOW()
  )
  ON CONFLICT (branch_id, asset) DO UPDATE SET
    open_over_notional = GREATEST(0, speed_exposure_live.open_over_notional + v_delta_over_stake),
    open_under_notional = GREATEST(0, speed_exposure_live.open_under_notional + v_delta_under_stake),
    net_notional = speed_exposure_live.net_notional + (v_delta_over_stake - v_delta_under_stake),
    open_position_count = GREATEST(0, speed_exposure_live.open_position_count + v_delta_count),
    last_updated_at = NOW();

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."_speed_position_exposure_trigger"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_speed_position_exposure_trigger"() IS 'Maintains speed_market_exposure_live and (for branched flows only) speed_exposure_live caches via incremental deltas on every INSERT/UPDATE/DELETE of speed_positions. Mig 346: skips the per-branch cache when branch_id IS NULL (retail / main-pool flow) — that table has branch_id NOT NULL FK and isn''t needed for retail tracking; the per-market cache covers the exposure-cap path.';



CREATE OR REPLACE FUNCTION "public"."_track_pool_underflow"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."_track_pool_underflow"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_track_pool_underflow"() IS 'AFTER UPDATE trigger on branches - when pool_balance goes negative (or worsens past negative), records a commission_clawback_deficit row + system_log. Fires on real underflow events only, not on unrelated updates.';



CREATE OR REPLACE FUNCTION "public"."_try_clear_payback"("p_branch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_status branch_status;
  v_pending DECIMAL;
BEGIN
  SELECT status, pending_payouts INTO v_status, v_pending
  FROM branches WHERE id = p_branch_id;

  IF v_status = 'payback' AND v_pending <= 0 THEN
    PERFORM clear_payback_mode(p_branch_id);
  END IF;
END;
$$;


ALTER FUNCTION "public"."_try_clear_payback"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_config admin_config%ROWTYPE;
BEGIN
  IF p_pin IS NULL OR p_pin = '' THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;

  SELECT * INTO v_config FROM admin_config WHERE admin_user_id = p_admin_id FOR UPDATE;
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
    WHERE admin_user_id = p_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Reset on success
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = p_admin_id;
END;
$$;


ALTER FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") IS 'Shared PIN verification for destructive admin RPCs. Locks for 15min after 5 failed attempts.';



CREATE OR REPLACE FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") IS 'Verify an HMAC-signed admin operation token. Constant-time comparison via pgcrypto.hmac. Token freshness window 120s. Used by PIN-gated RPCs in place of raw PIN.';



CREATE OR REPLACE FUNCTION "public"."_void_market_internal"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_market RECORD;
  v_pos RECORD;
  v_pos_user RECORD;
  v_comm RECORD;
  v_user RECORD;
  v_refund_amount DECIMAL;
  v_refunds INTEGER := 0;
  v_actual_clawback DECIMAL;
  v_clawback_deficit DECIMAL;
  v_total_clawback_deficit DECIMAL := 0;
  v_clawback_deficit_count INTEGER := 0;
  v_new_agent_balance DECIMAL;
  v_branch_id UUID;
  v_branch_rec RECORD;
  v_branch_total_refund DECIMAL;
  v_branch_refunds INTEGER;
  v_deficit DECIMAL;
  v_new_pool_balance DECIMAL;
  v_new_worst_case DECIMAL;
  v_cash_in DECIMAL;
  v_cash_out_sells DECIMAL;
  v_total_refunds DECIMAL := 0;
  v_seed_pnl DECIMAL;
  v_affected_users UUID[];
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  -- ═══ 0. PRE-LOCK ALL TOUCHED USERS IN DETERMINISTIC UUID ORDER ═══
  -- Collect every user we'll touch (commission referrers + position holders
  -- across retail and branches), then lock them all in ascending UUID order.
  -- Prevents deadlock between concurrent voids that share users.
  SELECT ARRAY(
    SELECT DISTINCT user_id FROM (
      SELECT referrer_id AS user_id
        FROM referral_commissions
       WHERE market_id = p_market_id
         AND status IN ('escrowed', 'credited')
      UNION
      SELECT user_id
        FROM positions
       WHERE market_id = p_market_id AND shares_held > 0
    ) u
    WHERE user_id IS NOT NULL
    ORDER BY user_id
  ) INTO v_affected_users;

  IF v_affected_users IS NOT NULL AND array_length(v_affected_users, 1) > 0 THEN
    PERFORM 1
      FROM users
     WHERE id = ANY(v_affected_users)
     ORDER BY id
     FOR UPDATE;
  END IF;

  -- ═══ 1. CLAW BACK COMMISSIONS — track deficits ═══
  PERFORM 1 FROM referral_commissions
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited')
  FOR UPDATE;

  FOR v_comm IN
    SELECT * FROM referral_commissions
    WHERE market_id = p_market_id AND status = 'credited'
  LOOP
    SELECT * INTO v_user FROM users WHERE id = v_comm.referrer_id FOR UPDATE;

    -- Compute actual debit possible (clamped to current agent_balance_usd)
    v_actual_clawback := LEAST(v_user.agent_balance_usd, v_comm.commission_amount);
    v_clawback_deficit := v_comm.commission_amount - v_actual_clawback;

    UPDATE users SET agent_balance_usd = agent_balance_usd - v_actual_clawback
    WHERE id = v_comm.referrer_id
    RETURNING agent_balance_usd INTO v_new_agent_balance;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_comm.referrer_id, 'commission', -v_actual_clawback,
      v_new_agent_balance,
      p_market_id,
      CASE WHEN v_clawback_deficit > 0
        THEN 'Commission partially clawed back ($' || ROUND(v_actual_clawback, 2)
             || ' of $' || ROUND(v_comm.commission_amount, 2)
             || ', deficit $' || ROUND(v_clawback_deficit, 2) || ') — market voided'
        ELSE 'Commission clawed back — market voided'
      END
    );

    -- Track the deficit (platform loss)
    IF v_clawback_deficit > 0 THEN
      INSERT INTO commission_clawback_deficit
        (referrer_id, market_id, commission_id, expected_clawback, actual_clawback, deficit, reason)
      VALUES
        (v_comm.referrer_id, p_market_id, v_comm.id,
         v_comm.commission_amount, v_actual_clawback, v_clawback_deficit,
         'agent_balance_insufficient');

      v_total_clawback_deficit := v_total_clawback_deficit + v_clawback_deficit;
      v_clawback_deficit_count := v_clawback_deficit_count + 1;
    END IF;
  END LOOP;

  UPDATE referral_commissions SET status = 'voided'
  WHERE market_id = p_market_id AND status IN ('escrowed', 'credited');

  -- ═══ 2. REFUND RETAIL POSITIONS ═══
  FOR v_pos IN
    SELECT * FROM positions
    WHERE market_id = p_market_id
      AND shares_held > 0
      AND branch_id IS NULL
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
        v_pos_user.balance_usd, p_market_id,
        'Market voided — position refunded (' || v_pos.side || ')'
      );

      v_refunds := v_refunds + 1;
      v_total_refunds := v_total_refunds + v_refund_amount;
    END IF;
  END LOOP;

  -- ═══ 3. REFUND BRANCH POSITIONS — honest ledger ═══
  FOR v_branch_id IN
    SELECT DISTINCT branch_id
    FROM positions
    WHERE market_id = p_market_id
      AND branch_id IS NOT NULL
      AND shares_held > 0
  LOOP
    SELECT * INTO v_branch_rec FROM branches WHERE id = v_branch_id FOR UPDATE;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_branch_total_refund := 0;
    v_branch_refunds := 0;

    FOR v_pos IN
      SELECT * FROM positions
      WHERE market_id = p_market_id
        AND branch_id = v_branch_id
        AND shares_held > 0
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
          v_pos_user.balance_usd, p_market_id,
          'Market voided — branch position refunded (' || v_pos.side || ')'
        );

        v_branch_total_refund := v_branch_total_refund + v_refund_amount;
        v_branch_refunds := v_branch_refunds + 1;
        v_refunds := v_refunds + 1;
      END IF;
    END LOOP;

    IF v_branch_total_refund > 0 THEN
      v_deficit := GREATEST(0, v_branch_total_refund - v_branch_rec.pool_balance);
      v_new_pool_balance := v_branch_rec.pool_balance - v_branch_total_refund;

      UPDATE branches SET
        pool_balance = v_new_pool_balance,
        pending_payouts = CASE WHEN v_deficit > 0
                              THEN pending_payouts + v_deficit
                              ELSE pending_payouts END,
        updated_at = NOW()
      WHERE id = v_branch_id;

      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id)
      VALUES (v_branch_id, p_market_id, 'void_refund', -v_branch_total_refund,
              v_new_pool_balance, p_market_id);

      IF v_deficit > 0 AND v_branch_rec.status = 'active' THEN
        PERFORM activate_payback_mode(
          v_branch_id,
          format('Void refund shortfall on market %s: deficit $%s', p_market_id, ROUND(v_deficit, 2)),
          0
        );
      END IF;

      v_new_worst_case := _recompute_branch_worst_case(v_branch_id);
      UPDATE branches SET worst_case_total = v_new_worst_case WHERE id = v_branch_id;
    END IF;

    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('info', 'branch/void', format('Branch %s void refunds for market %s', v_branch_id, p_market_id),
      jsonb_build_object(
        'branch_id', v_branch_id,
        'market_id', p_market_id,
        'refunds', v_branch_refunds,
        'total_refunded', ROUND(v_branch_total_refund, 2),
        'deficit', ROUND(v_deficit, 2),
        'pool_balance_after', (SELECT pool_balance FROM branches WHERE id = v_branch_id)
      ));
  END LOOP;

  -- ═══ 4. SET seed_pnl ON amm_state ═══
  -- For voided markets: seed_pnl = retail_buys - retail_sells - retail_refunds
  -- Fees collected stay with SOOQ regardless (not refunded).
  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_in
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'buy';

  SELECT COALESCE(SUM(total_cost), 0) INTO v_cash_out_sells
  FROM retail_trades WHERE market_id = p_market_id AND direction = 'sell';

  v_seed_pnl := v_cash_in - v_cash_out_sells - v_total_refunds;

  UPDATE amm_state SET seed_pnl = v_seed_pnl WHERE market_id = p_market_id;

  -- ═══ 5. UPDATE MARKET STATUS ═══
  UPDATE markets SET status = 'voided' WHERE id = p_market_id;

  -- ═══ 6. SUMMARY LOG (only if clawback deficit happened) ═══
  IF v_total_clawback_deficit > 0 THEN
    INSERT INTO system_logs (severity, source, message, context)
    VALUES ('warn', 'admin/void',
      format('Market voided with clawback deficit: $%s across %s commissions',
             ROUND(v_total_clawback_deficit, 2), v_clawback_deficit_count),
      jsonb_build_object(
        'market_id', p_market_id,
        'total_deficit', ROUND(v_total_clawback_deficit, 2),
        'commissions_with_deficit', v_clawback_deficit_count
      ));
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'refunds_issued', v_refunds,
    'seed_pnl', ROUND(v_seed_pnl, 2),
    'clawback_deficit_total', ROUND(v_total_clawback_deficit, 2),
    'clawback_deficit_count', v_clawback_deficit_count
  );
END;
$_$;


ALTER FUNCTION "public"."_void_market_internal"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."acknowledge_system_log"("p_log_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_is_admin BOOLEAN;
BEGIN
  SELECT is_admin INTO v_is_admin FROM users WHERE id = v_user_id;
  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE system_logs
  SET acknowledged = TRUE,
      acknowledged_by = v_user_id,
      acknowledged_at = NOW()
  WHERE id = p_log_id;
END;
$$;


ALTER FUNCTION "public"."acknowledge_system_log"("p_log_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."activate_payback_mode"("p_branch_id" "uuid", "p_reason" "text", "p_shortfall" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_branch RECORD;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  IF v_branch.status != 'active' THEN
    RAISE EXCEPTION 'Can only activate payback from active status (current: %)', v_branch.status;
  END IF;

  UPDATE branches SET
    status = 'payback',
    payback_activated_at = now(),
    payback_reason = p_reason,
    pending_payouts = pending_payouts + GREATEST(0, p_shortfall),
    updated_at = NOW()
  WHERE id = p_branch_id;

  PERFORM log_system_event('warn'::log_severity, 'branch/payback_activated',
    'Branch ' || v_branch.name || ' entered payback mode',
    jsonb_build_object(
      'branch_id', p_branch_id, 'reason', p_reason,
      'shortfall', p_shortfall, 'pending_payouts', v_branch.pending_payouts + GREATEST(0, p_shortfall)
    )
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'new_status', 'payback',
    'pending_payouts', ROUND(v_branch.pending_payouts + GREATEST(0, p_shortfall), 2),
    'activated_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."activate_payback_mode"("p_branch_id" "uuid", "p_reason" "text", "p_shortfall" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_agent_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_user users%ROWTYPE;
  v_new_agent_balance DECIMAL;
  v_tx_type transaction_type;
  v_tx_id UUID;
BEGIN
  -- 1. Verify caller is admin
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: not an admin';
  END IF;

  -- 2. PIN check + lockout (same pattern as admin_adjust_balance)
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

  -- 3. Validate amount
  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  IF ABS(p_amount) > 10000 THEN RAISE EXCEPTION 'Amount exceeds maximum ($10,000)'; END IF;

  IF p_description IS NULL OR length(trim(p_description)) = 0 THEN
    RAISE EXCEPTION 'Description is required';
  END IF;

  -- 4. Transaction type
  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END;

  -- 5. Lock user + validate
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'User account is frozen'; END IF;

  -- For debits, don't overdraw the commission wallet
  IF p_amount < 0 AND v_user.agent_balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient agent balance for debit (current $%, debit $%)',
      ROUND(v_user.agent_balance_usd, 2), ROUND(ABS(p_amount), 2);
  END IF;

  -- 6. Update agent_balance_usd + ledger. The trigger_bypass flag lets us
  -- write to a protected column (agent_balance_usd) while running in
  -- SECURITY DEFINER context.
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_new_agent_balance := v_user.agent_balance_usd + p_amount;
  UPDATE users SET agent_balance_usd = v_new_agent_balance WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (
    p_user_id, v_tx_type, p_amount, v_new_agent_balance,
    'AGENT WALLET: ' || p_description,
    v_admin_id
  )
  RETURNING id INTO v_tx_id;

  -- 7. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (
    'info',
    'admin/agent_wallet_adjust',
    CASE WHEN p_amount > 0
      THEN format('Admin credited $%s to agent wallet', p_amount)
      ELSE format('Admin debited $%s from agent wallet', ABS(p_amount))
    END,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'user_id', p_user_id,
      'amount', p_amount,
      'new_agent_balance', v_new_agent_balance,
      'description', p_description,
      'transaction_id', v_tx_id
    )
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'amount', p_amount,
    'new_agent_balance', ROUND(v_new_agent_balance, 2),
    'user_id', p_user_id
  );
END;
$_$;


ALTER FUNCTION "public"."admin_adjust_agent_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_user users%ROWTYPE;
  v_new_balance DECIMAL;
  v_tx_type transaction_type;
  v_tx_id UUID;
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

  -- Check lockout
  IF v_config.pin_locked_until IS NOT NULL AND v_config.pin_locked_until > now() THEN
    RAISE EXCEPTION 'PIN locked. Try again after %', v_config.pin_locked_until;
  END IF;

  -- Verify PIN (using pgcrypto crypt/gen_salt)
  IF v_config.pin_hash != crypt(p_pin, v_config.pin_hash) THEN
    -- Increment failed attempts
    UPDATE admin_config SET
      failed_pin_attempts = failed_pin_attempts + 1,
      pin_locked_until = CASE
        WHEN failed_pin_attempts + 1 >= 5 THEN now() + interval '15 minutes'
        ELSE NULL
      END
    WHERE admin_user_id = v_admin_id;
    RAISE EXCEPTION 'Invalid PIN';
  END IF;

  -- Reset failed attempts on success
  UPDATE admin_config SET failed_pin_attempts = 0, pin_locked_until = NULL
  WHERE admin_user_id = v_admin_id;

  -- 3. Validate amount
  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;
  IF ABS(p_amount) > 10000 THEN RAISE EXCEPTION 'Amount exceeds maximum ($10,000)'; END IF;

  -- 4. Determine transaction type
  v_tx_type := CASE WHEN p_amount > 0 THEN 'admin_credit' ELSE 'admin_debit' END;

  -- 5. Lock user row + validate
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'User account is frozen'; END IF;

  -- For debits, check sufficient balance
  IF p_amount < 0 AND v_user.balance_usd + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient balance for debit';
  END IF;

  -- 6. Update balance + insert ledger entry
  v_new_balance := v_user.balance_usd + p_amount;
  UPDATE users SET balance_usd = v_new_balance WHERE id = p_user_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_user_id, v_tx_type, p_amount, v_new_balance, p_description, v_admin_id)
  RETURNING id INTO v_tx_id;

  -- 7. Audit log to system_logs
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (
    'info',
    'admin/credit',
    CASE WHEN p_amount > 0
      THEN format('Admin credited $%s to user', p_amount)
      ELSE format('Admin debited $%s from user', ABS(p_amount))
    END,
    jsonb_build_object(
      'admin_id', v_admin_id,
      'user_id', p_user_id,
      'amount', p_amount,
      'description', p_description,
      'transaction_id', v_tx_id,
      'new_balance', v_new_balance
    )
  );

  RETURN jsonb_build_object(
    'transaction_id', v_tx_id,
    'new_balance', v_new_balance,
    'type', v_tx_type::text
  );
END;
$_$;


ALTER FUNCTION "public"."admin_adjust_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_adjust_branch_pool"("p_branch_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_new_balance DECIMAL;
  v_sweep DECIMAL := 0;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_amount = 0 THEN RAISE EXCEPTION 'Amount cannot be zero'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- For debits, check sufficient balance
  IF p_amount < 0 AND v_branch.pool_balance + p_amount < 0 THEN
    RAISE EXCEPTION 'Insufficient pool balance for debit';
  END IF;

  -- Update pool balance
  UPDATE branches SET
    pool_balance = pool_balance + p_amount,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_balance;

  -- Pool ledger entry
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'adjustment', p_amount, v_new_balance,
          COALESCE(p_description, 'Admin pool adjustment'));

  -- Payback sweep on positive adjustment
  IF p_amount > 0 AND v_branch.status = 'payback' AND v_branch.pending_payouts > 0 THEN
    v_sweep := LEAST(p_amount, v_branch.pending_payouts);
    IF v_sweep > 0 THEN
      INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
      VALUES (p_branch_id, 'payback_sweep', -v_sweep,
              v_new_balance - v_sweep,
              'Payback sweep on admin pool credit');

      UPDATE branches SET
        pending_payouts = GREATEST(0, pending_payouts - v_sweep),
        pool_balance = pool_balance - v_sweep
      WHERE id = p_branch_id
      RETURNING pool_balance INTO v_new_balance;

      -- Auto-clear payback if pending hits 0
      PERFORM _try_clear_payback(p_branch_id);
    END IF;
  END IF;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'pool_adjustment',
    COALESCE(p_description, 'Pool adjustment'),
    jsonb_build_object('pool_balance', v_branch.pool_balance),
    jsonb_build_object('adjustment', p_amount, 'new_balance', v_new_balance, 'sweep', v_sweep)
  );

  PERFORM log_system_event('info'::log_severity, 'branch/pool_adjustment',
    'Admin pool adjustment $' || p_amount,
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'amount', p_amount, 'new_balance', v_new_balance)
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'adjustment', ROUND(p_amount, 2),
    'new_pool_balance', ROUND(v_new_balance, 2),
    'payback_sweep', ROUND(v_sweep, 2)
  );
END;
$_$;


ALTER FUNCTION "public"."admin_adjust_branch_pool"("p_branch_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_branch"("p_name" "text", "p_code" "text", "p_manager_user_id" "uuid", "p_config" "jsonb" DEFAULT '{}'::"jsonb", "p_pin" "text" DEFAULT NULL::"text", "p_book_type" "text" DEFAULT 'reseller'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_branch_id UUID;
  v_book_type branch_book_type;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- PIN required for branch creation
  IF p_pin IS NOT NULL THEN
    PERFORM _verify_admin_pin(v_admin_id, p_pin);
  ELSE
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Unauthorized: not an admin';
    END IF;
  END IF;

  -- Validate + coerce book_type
  IF p_book_type NOT IN ('reseller', 'commission') THEN
    RAISE EXCEPTION 'Invalid book_type: %. Allowed: reseller, commission (bookmaker is parked).', p_book_type;
  END IF;
  v_book_type := p_book_type::branch_book_type;

  -- Validate manager exists
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_manager_user_id) THEN
    RAISE EXCEPTION 'Manager user not found';
  END IF;

  -- Validate slug format for commission branches (friendly errors; DB CHECK is belt + suspenders)
  IF v_book_type = 'commission' THEN
    IF p_code !~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$' THEN
      RAISE EXCEPTION 'Slug must be 3-20 lowercase letters/numbers/hyphens, start and end with letter or number';
    END IF;
    IF p_code = ANY(_reserved_slugs()) THEN
      RAISE EXCEPTION 'Slug "%" is reserved', p_code;
    END IF;
  END IF;

  -- Validate code uniqueness
  IF EXISTS (SELECT 1 FROM branches WHERE branch_code = p_code) THEN
    RAISE EXCEPTION 'Branch code "%" is already in use', p_code;
  END IF;

  -- Create branch with config overrides. Commission branches force all
  -- capital/pricing fields to zero (belt + suspenders against bad config).
  IF v_book_type = 'commission' THEN
    INSERT INTO branches (
      branch_code, name, manager_user_id, book_type,
      yes_markup_pct, no_markup_pct, branch_fee_rate, exit_fee_pct,
      display_mode, cash_out_enabled,
      pool_balance, worst_case_total, pending_payouts
    ) VALUES (
      p_code, p_name, p_manager_user_id, 'commission',
      0, 0, 0, 0,
      'betting', TRUE,
      0, 0, 0
    )
    RETURNING id INTO v_branch_id;
  ELSE
    INSERT INTO branches (
      branch_code, name, manager_user_id, book_type,
      yes_markup_pct, no_markup_pct, branch_fee_rate,
      exit_fee_pct, display_mode, cash_out_enabled,
      default_position_cap_yes, default_position_cap_no
    ) VALUES (
      p_code, p_name, p_manager_user_id, 'reseller',
      COALESCE((p_config->>'yes_markup_pct')::DECIMAL, 0.0500),
      COALESCE((p_config->>'no_markup_pct')::DECIMAL, 0.0500),
      COALESCE((p_config->>'branch_fee_rate')::DECIMAL, 0.050000),
      COALESCE((p_config->>'exit_fee_pct')::DECIMAL, 0.0050),
      COALESCE((p_config->>'display_mode')::branch_display_mode, 'betting'),
      COALESCE((p_config->>'cash_out_enabled')::BOOLEAN, TRUE),
      (p_config->>'default_position_cap_yes')::DECIMAL,
      (p_config->>'default_position_cap_no')::DECIMAL
    )
    RETURNING id INTO v_branch_id;
  END IF;

  -- Reseller branches auto-assign the manager to the branch (venue-lock model).
  -- Commission branches do NOT — users stay retail, attribution flows via
  -- users.signup_branch_id, never branch_user_assignments.
  IF v_book_type = 'reseller' THEN
    INSERT INTO branch_user_assignments (user_id, branch_id)
    VALUES (p_manager_user_id, v_branch_id)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM log_system_event('info'::log_severity, 'branch/created',
    'Branch "' || p_name || '" created (' || p_book_type || ')',
    jsonb_build_object(
      'branch_id', v_branch_id,
      'code', p_code,
      'book_type', p_book_type,
      'manager_id', p_manager_user_id,
      'admin_id', v_admin_id
    )
  );

  RETURN jsonb_build_object(
    'branch_id', v_branch_id,
    'branch_code', p_code,
    'name', p_name,
    'book_type', p_book_type,
    'manager_user_id', p_manager_user_id
  );
END;
$_$;


ALTER FUNCTION "public"."admin_create_branch"("p_name" "text", "p_code" "text", "p_manager_user_id" "uuid", "p_config" "jsonb", "p_pin" "text", "p_book_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_demo_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text" DEFAULT NULL::"text", "p_description_ar" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT 'politics'::"text", "p_keywords" "text"[] DEFAULT '{}'::"text"[], "p_liquidity_param" numeric DEFAULT 5000, "p_opens_at" timestamp with time zone DEFAULT "now"(), "p_closes_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_scheduled_outcome" "text" DEFAULT NULL::"text", "p_resolves_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_image_url" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
  v_market_id UUID;
  v_b DECIMAL;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
  v_closes_at TIMESTAMPTZ;
  v_resolves_at TIMESTAMPTZ;
BEGIN
  v_admin_id := _demo_assert_admin();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Validate
  IF p_question_en IS NULL OR length(trim(p_question_en)) = 0 THEN
    RAISE EXCEPTION 'English question is required';
  END IF;
  IF p_question_ar IS NULL OR length(trim(p_question_ar)) = 0 THEN
    RAISE EXCEPTION 'Arabic question is required';
  END IF;
  IF p_scheduled_outcome IS NULL OR p_scheduled_outcome NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Scheduled outcome required (yes or no)';
  END IF;
  IF p_resolves_at IS NULL OR p_resolves_at <= now() THEN
    RAISE EXCEPTION 'resolves_at must be in the future';
  END IF;

  v_closes_at := COALESCE(p_closes_at, p_resolves_at);
  v_resolves_at := p_resolves_at;

  IF v_closes_at <= p_opens_at THEN
    RAISE EXCEPTION 'Close date must be after open date';
  END IF;
  IF v_resolves_at < v_closes_at THEN
    RAISE EXCEPTION 'Resolves date must be at or after close date';
  END IF;

  v_b := COALESCE(p_liquidity_param, 5000);
  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- 1. Insert market
  INSERT INTO demo_markets (
    question_en, question_ar, description_en, description_ar,
    category, keywords, amm_liquidity_param,
    opens_at, closes_at, resolves_at,
    created_by, status, image_url, resolution_fee_rate_snapshot
  ) VALUES (
    p_question_en, p_question_ar, p_description_en, p_description_ar,
    p_category, p_keywords, v_b,
    p_opens_at, v_closes_at, v_resolves_at,
    v_admin_id, 'open', p_image_url, 0
  )
  RETURNING id INTO v_market_id;

  -- 2. Insert scheduled outcome (admin-only table)
  INSERT INTO demo_market_scheduled_outcomes (market_id, scheduled_outcome, created_by)
  VALUES (v_market_id, p_scheduled_outcome::bet_side, v_admin_id);

  -- 3. Initialize AMM
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price  := lmsr_price(v_b, 0, 0, 'no');
  INSERT INTO demo_amm_state (market_id, liquidity_param, q_yes, q_no,
                              current_yes_price, current_no_price)
  VALUES (v_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- 4. Seed initial price point so charts render immediately
  INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                           price_per_share, total_cost, post_yes_price, post_no_price)
  VALUES (v_admin_id, v_market_id, 'yes'::bet_side, 'buy'::trade_direction,
          0.000001, 0.500000, 0.00, 0.500000, 0.500000);

  -- 5. Audit log
  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/create_demo_market', format('Demo market created: %s', left(p_question_en, 80)),
    jsonb_build_object(
      'admin_id', v_admin_id,
      'market_id', v_market_id,
      'category', p_category,
      'liquidity_param', v_b,
      'scheduled_outcome', p_scheduled_outcome,
      'resolves_at', v_resolves_at
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', v_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6),
    'scheduled_outcome', p_scheduled_outcome,
    'resolves_at', v_resolves_at
  );
END;
$$;


ALTER FUNCTION "public"."admin_create_demo_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_scheduled_outcome" "text", "p_resolves_at" timestamp with time zone, "p_image_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text" DEFAULT NULL::"text", "p_description_ar" "text" DEFAULT NULL::"text", "p_category" "text" DEFAULT 'politics'::"text", "p_keywords" "text"[] DEFAULT '{}'::"text"[], "p_liquidity_param" numeric DEFAULT NULL::numeric, "p_opens_at" timestamp with time zone DEFAULT "now"(), "p_closes_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval), "p_image_url" "text" DEFAULT NULL::"text", "p_opening_price" numeric DEFAULT 0.5) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_image_url" "text", "p_opening_price" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_image_url" "text", "p_opening_price" numeric) IS 'Creates a market + AMM state. Admin sets opening_price (0.05-0.95). Pre-mints seed shares so initial price matches. Seed shares are operator inventory (not retail).';



CREATE OR REPLACE FUNCTION "public"."admin_has_pin"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM admin_config WHERE admin_user_id = auth.uid()
  );
END;
$$;


ALTER FUNCTION "public"."admin_has_pin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_branches"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT jsonb_agg(row_to_json(t)::jsonb) INTO v_result
  FROM (
    SELECT
      b.id,
      b.name,
      b.branch_code,
      b.book_type,
      b.status,
      b.pool_balance,
      b.worst_case_total,
      b.pending_payouts,
      b.yes_markup_pct,
      b.no_markup_pct,
      b.branch_fee_rate,
      b.display_mode,
      b.cash_out_enabled,
      b.payback_activated_at,
      b.created_at,
      b.updated_at,
      u.display_name AS manager_name,
      u.phone AS manager_phone,
      b.manager_user_id,
      (SELECT COUNT(*) FROM branch_user_assignments bua WHERE bua.branch_id = b.id) AS user_count,
      (SELECT COUNT(*) FROM branch_agents ba WHERE ba.branch_id = b.id AND ba.is_active = TRUE) AS active_agent_count,
      (SELECT COUNT(*) FROM branch_trades bt WHERE bt.branch_id = b.id) AS trade_count,
      (SELECT COALESCE(SUM(bt.gross_amount), 0) FROM branch_trades bt WHERE bt.branch_id = b.id) AS total_volume,
      (SELECT COALESCE(SUM(br.total_revenue), 0) FROM branch_revenue br WHERE br.branch_id = b.id) AS total_revenue,
      CASE
        WHEN b.pool_balance > 0 AND b.worst_case_total > 0
        THEN ROUND((b.worst_case_total / b.pool_balance) * 100, 1)
        ELSE 0
      END AS utilization_pct
    FROM branches b
    JOIN users u ON u.id = b.manager_user_id
    ORDER BY b.created_at DESC
  ) t;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;


ALTER FUNCTION "public"."admin_list_branches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_list_demo_markets_with_outcomes"() RETURNS TABLE("market_id" "uuid", "question_en" "text", "question_ar" "text", "category" "text", "status" "public"."market_status", "outcome" "public"."bet_side", "scheduled_outcome" "public"."bet_side", "opens_at" timestamp with time zone, "closes_at" timestamp with time zone, "resolves_at" timestamp with time zone, "resolved_at" timestamp with time zone, "trade_count" integer, "unique_traders" integer, "amm_liquidity_param" numeric, "created_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM _demo_assert_admin();

  RETURN QUERY
  SELECT
    m.id, m.question_en, m.question_ar, m.category, m.status,
    m.outcome, s.scheduled_outcome,
    m.opens_at, m.closes_at, m.resolves_at, m.resolved_at,
    m.trade_count, m.unique_traders, m.amm_liquidity_param,
    m.created_at
  FROM demo_markets m
  LEFT JOIN demo_market_scheduled_outcomes s ON s.market_id = m.id
  ORDER BY m.created_at DESC;
END;
$$;


ALTER FUNCTION "public"."admin_list_demo_markets_with_outcomes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_mark_withdrawal_sent"("p_withdrawal_id" "uuid", "p_external_reference_id" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_withdrawal RECORD;
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ Input validation ═══
  IF p_external_reference_id IS NULL OR TRIM(p_external_reference_id) = '' THEN
    RAISE EXCEPTION 'External reference ID is required (Whish tx id, blockchain tx hash, or bank wire ref)';
  END IF;

  -- ═══ PIN verification (same pattern as admin_review_withdrawal) ═══
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

  -- ═══ Lock + validate withdrawal ═══
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'approved' THEN
    RAISE EXCEPTION 'Only approved withdrawals can be marked sent (current status: %)', v_withdrawal.status;
  END IF;
  IF v_withdrawal.external_reference_id IS NOT NULL THEN
    RAISE EXCEPTION 'Withdrawal already has an external reference (marked sent previously)';
  END IF;

  -- ═══ Transition approved → sent ═══
  UPDATE withdrawals
  SET status = 'sent',
      sent_at = now(),
      sent_by = v_admin_id,
      external_reference_id = TRIM(p_external_reference_id)
  WHERE id = p_withdrawal_id;

  PERFORM log_system_event(
    'info',
    'admin/withdrawal',
    'Withdrawal marked as sent',
    jsonb_build_object(
      'withdrawal_id', p_withdrawal_id,
      'user_id', v_withdrawal.user_id,
      'amount', v_withdrawal.amount,
      'net_amount', v_withdrawal.net_amount,
      'provider', v_withdrawal.provider,
      'external_reference_id', TRIM(p_external_reference_id),
      'admin_id', v_admin_id
    )
  );

  RETURN jsonb_build_object(
    'status', 'sent',
    'withdrawal_id', p_withdrawal_id,
    'external_reference_id', TRIM(p_external_reference_id),
    'sent_at', now()
  );
END;
$$;


ALTER FUNCTION "public"."admin_mark_withdrawal_sent"("p_withdrawal_id" "uuid", "p_external_reference_id" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_override_solvency"("p_branch_id" "uuid", "p_new_pct" numeric, "p_duration_hours" integer, "p_note" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_until TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate inputs
  IF p_new_pct < 0.80 OR p_new_pct > 1.00 THEN
    RAISE EXCEPTION 'Solvency threshold must be between 80%% and 100%%';
  END IF;
  IF p_duration_hours < 1 OR p_duration_hours > 168 THEN
    RAISE EXCEPTION 'Duration must be 1-168 hours (max 7 days)';
  END IF;
  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Note is required for solvency overrides';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  v_until := now() + (p_duration_hours || ' hours')::INTERVAL;

  UPDATE branches SET
    solvency_override_pct = p_new_pct,
    solvency_override_until = v_until,
    solvency_override_by = v_admin_id,
    updated_at = NOW()
  WHERE id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'solvency_gate_loosened', p_note,
    jsonb_build_object('old_pct', v_branch.solvency_override_pct, 'old_until', v_branch.solvency_override_until),
    jsonb_build_object('new_pct', p_new_pct, 'until', v_until, 'hours', p_duration_hours)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/solvency_override',
    'Solvency gate overridden to ' || (p_new_pct * 100) || '% for ' || p_duration_hours || 'h',
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'new_pct', p_new_pct, 'until', v_until)
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'new_threshold', p_new_pct,
    'until', v_until,
    'hours', p_duration_hours
  );
END;
$$;


ALTER FUNCTION "public"."admin_override_solvency"("p_branch_id" "uuid", "p_new_pct" numeric, "p_duration_hours" integer, "p_note" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_override_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_new_pool_balance DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_note IS NULL OR length(trim(p_note)) = 0 THEN
    RAISE EXCEPTION 'Note is required for override withdrawals';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Hard floor: cannot overdraw the actual pool
  IF p_amount > v_branch.pool_balance THEN
    RAISE EXCEPTION 'Amount exceeds pool balance ($%)', ROUND(v_branch.pool_balance, 2);
  END IF;

  -- Read fee
  SELECT rate INTO v_fee_rate FROM fee_config
  WHERE fee_type = 'branch_withdrawal_fee' AND level IS NULL;
  IF v_fee_rate IS NULL THEN v_fee_rate := 0.01; END IF;

  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- Pool ledger entries
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'withdrawal', -p_amount,
          v_branch.pool_balance - p_amount,
          'ADMIN OVERRIDE withdrawal to ' || p_destination);

  IF v_fee > 0 THEN
    INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
    VALUES (p_branch_id, 'withdrawal_fee', v_fee,
            v_branch.pool_balance - p_amount + v_fee,
            'Withdrawal fee retained');
  END IF;

  UPDATE branches SET
    pool_balance = pool_balance - p_amount + v_fee,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_pool_balance;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'withdrawal_lock_bypassed', p_note,
    jsonb_build_object('pool_balance', v_branch.pool_balance),
    jsonb_build_object('withdrawal', p_amount, 'fee', v_fee, 'destination', p_destination, 'new_pool', v_new_pool_balance)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/admin_withdrawal',
    'Admin override withdrawal $' || p_amount,
    jsonb_build_object('branch_id', p_branch_id, 'admin_id', v_admin_id, 'amount', p_amount, 'destination', p_destination)
  );

  RETURN jsonb_build_object(
    'withdrawal_amount', ROUND(p_amount, 2),
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'new_pool_balance', ROUND(v_new_pool_balance, 2),
    'destination', p_destination,
    'override', true
  );
END;
$_$;


ALTER FUNCTION "public"."admin_override_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_resolve_demo_market"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_market RECORD;
  v_schedule RECORD;
  v_pos RECORD;
  v_payout DECIMAL;
  v_total_paid DECIMAL := 0;
  v_winners_paid INTEGER := 0;
  v_new_balance DECIMAL;
BEGIN
  PERFORM _demo_assert_admin();

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;

  -- Idempotency: if already resolved, return early
  IF v_market.status = 'resolved' THEN
    RETURN jsonb_build_object(
      'already_resolved', true,
      'outcome', v_market.outcome::text,
      'resolved_at', v_market.resolved_at
    );
  END IF;

  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved (status: %)', v_market.status;
  END IF;

  SELECT * INTO v_schedule FROM demo_market_scheduled_outcomes
  WHERE market_id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No scheduled outcome for demo market';
  END IF;

  -- Pay winners: shares_held × $1.00 (no resolution fee)
  FOR v_pos IN
    SELECT * FROM demo_positions
    WHERE market_id = p_market_id
      AND side = v_schedule.scheduled_outcome
      AND shares_held > 0
    ORDER BY user_id
  LOOP
    v_payout := v_pos.shares_held * 1.0;

    UPDATE users SET
      demo_balance_usd = demo_balance_usd + v_payout,
      updated_at = NOW()
    WHERE id = v_pos.user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_pos.user_id, 'demo_win', v_payout, v_new_balance, p_market_id,
            'Demo win: ' || ROUND(v_pos.shares_held, 2) || ' shares × $1.00');

    v_total_paid := v_total_paid + v_payout;
    v_winners_paid := v_winners_paid + 1;
  END LOOP;

  UPDATE demo_markets SET
    status = 'resolved',
    outcome = v_schedule.scheduled_outcome,
    resolved_at = NOW(),
    updated_at = NOW()
  WHERE id = p_market_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/resolve_demo_market', format('Demo market resolved: %s', v_schedule.scheduled_outcome),
    jsonb_build_object(
      'market_id', p_market_id,
      'outcome', v_schedule.scheduled_outcome::text,
      'winners_paid', v_winners_paid,
      'total_paid', ROUND(v_total_paid, 2)
    ));

  RETURN jsonb_build_object(
    'success', true,
    'outcome', v_schedule.scheduled_outcome::text,
    'winners_paid', v_winners_paid,
    'total_paid', ROUND(v_total_paid, 2)
  );
END;
$_$;


ALTER FUNCTION "public"."admin_resolve_demo_market"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_deposit RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- Lock deposit row
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_deposit.status != 'pending_review' THEN
    RAISE EXCEPTION 'Deposit is not pending review (current: %)', v_deposit.status;
  END IF;

  IF p_action = 'approve' THEN
    -- Update deposit status
    UPDATE deposits
    SET status = 'confirmed', confirmed_at = NOW()
    WHERE id = p_deposit_id;

    -- Lock user row, credit balance
    UPDATE users
    SET balance_usd = balance_usd + v_deposit.net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_deposit.user_id, 'deposit', v_deposit.net_amount,
      v_new_balance, p_deposit_id,
      'Manual Whish deposit approved'
    );

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'net_amount', v_deposit.net_amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'net_amount', v_deposit.net_amount
    );
  ELSE
    -- Reject — no balance mutation needed
    UPDATE deposits
    SET status = 'rejected'
    WHERE id = p_deposit_id;

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_deposit.amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_deposit RECORD;
  v_new_balance DECIMAL;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_final_amount DECIMAL;
BEGIN
  -- Admin check
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- Lock deposit row
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_deposit.status != 'pending_review' THEN
    RAISE EXCEPTION 'Deposit is not pending review (current: %)', v_deposit.status;
  END IF;

  IF p_action = 'approve' THEN
    -- Use admin-provided amount, fall back to original deposit amount
    v_final_amount := COALESCE(p_amount, v_deposit.amount);

    IF v_final_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit amount must be greater than zero';
    END IF;

    -- Read deposit fee from config
    SELECT rate INTO v_deposit_fee_rate
    FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

    v_fee := v_final_amount * COALESCE(v_deposit_fee_rate, 0);
    v_net_amount := v_final_amount - v_fee;

    -- Update deposit with final amount, fee, net_amount
    UPDATE deposits
    SET status = 'confirmed',
        confirmed_at = NOW(),
        amount = v_final_amount,
        fee = v_fee,
        net_amount = v_net_amount
    WHERE id = p_deposit_id;

    -- Lock user row, credit balance
    UPDATE users
    SET balance_usd = balance_usd + v_net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (
      v_deposit.user_id, 'deposit', v_net_amount,
      v_new_balance, p_deposit_id,
      'Manual Whish deposit approved'
    );

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_final_amount,
        'fee', v_fee,
        'net_amount', v_net_amount,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'amount', v_final_amount,
      'net_amount', v_net_amount
    );
  ELSE
    -- Reject — no balance mutation needed
    UPDATE deposits
    SET status = 'rejected'
    WHERE id = p_deposit_id;

    -- Log
    PERFORM log_system_event(
      'info',
      'deposit/manual',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'admin_id', auth.uid()
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric DEFAULT NULL::numeric, "p_pin" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_deposit RECORD;
  v_new_balance DECIMAL;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_final_amount DECIMAL;
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ PIN enforcement (required) ═══
  IF p_pin IS NULL OR length(p_pin) = 0 THEN
    RAISE EXCEPTION 'Admin PIN required';
  END IF;

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

  -- ═══ Validate action ═══
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- ═══ Lock deposit row ═══
  SELECT * INTO v_deposit FROM deposits WHERE id = p_deposit_id FOR UPDATE;
  IF v_deposit IS NULL THEN
    RAISE EXCEPTION 'Deposit not found';
  END IF;
  IF v_deposit.status != 'pending_review' THEN
    RAISE EXCEPTION 'Deposit is not pending review (current: %)', v_deposit.status;
  END IF;

  IF p_action = 'approve' THEN
    -- Use admin-provided amount, fall back to original deposit amount
    v_final_amount := COALESCE(p_amount, v_deposit.amount);

    IF v_final_amount <= 0 THEN
      RAISE EXCEPTION 'Deposit amount must be greater than zero';
    END IF;

    -- Read deposit fee from config
    SELECT rate INTO v_deposit_fee_rate
    FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

    v_fee := v_final_amount * COALESCE(v_deposit_fee_rate, 0);
    v_net_amount := v_final_amount - v_fee;

    -- Update deposit with final amount, fee, and confirm
    UPDATE deposits
    SET amount = v_final_amount,
        fee = v_fee,
        net_amount = v_net_amount,
        status = 'confirmed',
        confirmed_at = now()
    WHERE id = p_deposit_id;

    -- Credit user balance
    UPDATE users
    SET balance_usd = balance_usd + v_net_amount
    WHERE id = v_deposit.user_id
    RETURNING balance_usd INTO v_new_balance;

    -- Ledger entry
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
    VALUES (
      v_deposit.user_id, 'deposit', v_net_amount,
      v_new_balance, p_deposit_id,
      'Manual deposit approved (' || v_deposit.provider || ')',
      v_admin_id
    );

    PERFORM log_system_event(
      'info',
      'admin/deposit',
      'Manual deposit approved by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'amount', v_final_amount,
        'net_amount', v_net_amount,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'confirmed',
      'amount', v_final_amount,
      'net_amount', v_net_amount,
      'new_balance', v_new_balance
    );

  ELSE
    -- ═══ REJECT: mark rejected, no balance change (no funds were held) ═══
    UPDATE deposits SET status = 'rejected' WHERE id = p_deposit_id;

    PERFORM log_system_event(
      'info',
      'admin/deposit',
      'Manual deposit rejected by admin',
      jsonb_build_object(
        'deposit_id', p_deposit_id,
        'user_id', v_deposit.user_id,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object('status', 'rejected');
  END IF;
END;
$$;


ALTER FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric, "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_review_withdrawal"("p_withdrawal_id" "uuid", "p_action" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_admin_id UUID;
  v_config admin_config%ROWTYPE;
  v_withdrawal RECORD;
  v_user RECORD;
  v_new_balance DECIMAL;
BEGIN
  -- ═══ Admin auth ═══
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized — admin only';
  END IF;

  -- ═══ PIN verification ═══
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

  -- ═══ Validate action ═══
  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid action: must be approve or reject';
  END IF;

  -- ═══ Lock withdrawal + validate status ═══
  SELECT * INTO v_withdrawal FROM withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
  IF v_withdrawal IS NULL THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Withdrawal is not pending (current: %)', v_withdrawal.status;
  END IF;

  IF p_action = 'approve' THEN
    -- ═══ Wagering recheck at approval (P2 #10 fix) ═══
    SELECT * INTO v_user FROM users WHERE id = v_withdrawal.user_id FOR UPDATE;
    IF v_user.total_wagered < v_user.wagering_requirement THEN
      RAISE EXCEPTION 'Wagering requirement no longer met (wagered: $%, required: $%). Reject this withdrawal and ask user to resubmit.',
        ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
    END IF;

    UPDATE withdrawals SET status = 'approved' WHERE id = p_withdrawal_id;

    PERFORM log_system_event(
      'info',
      'admin/withdrawal',
      'Withdrawal approved by admin',
      jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'net_amount', v_withdrawal.net_amount,
        'destination', v_withdrawal.destination,
        'destination_type', v_withdrawal.destination_type,
        'provider', v_withdrawal.provider,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'approved',
      'amount', v_withdrawal.amount,
      'net_amount', v_withdrawal.net_amount,
      'destination', v_withdrawal.destination,
      'provider', v_withdrawal.provider
    );

  ELSE
    -- ═══ REJECT: refund full amount ═══
    UPDATE users SET balance_usd = balance_usd + v_withdrawal.amount
    WHERE id = v_withdrawal.user_id
    RETURNING balance_usd INTO v_new_balance;

    UPDATE withdrawals SET status = 'rejected' WHERE id = p_withdrawal_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description, performed_by)
    VALUES (
      v_withdrawal.user_id, 'refund', v_withdrawal.amount,
      v_new_balance, p_withdrawal_id,
      'Withdrawal rejected — funds returned',
      v_admin_id
    );

    PERFORM log_system_event(
      'info',
      'admin/withdrawal',
      'Withdrawal rejected by admin — funds refunded',
      jsonb_build_object(
        'withdrawal_id', p_withdrawal_id,
        'user_id', v_withdrawal.user_id,
        'amount', v_withdrawal.amount,
        'refunded_balance', v_new_balance,
        'admin_id', v_admin_id
      )
    );

    RETURN jsonb_build_object(
      'status', 'rejected',
      'refunded_amount', v_withdrawal.amount,
      'new_balance', v_new_balance
    );
  END IF;
END;
$_$;


ALTER FUNCTION "public"."admin_review_withdrawal"("p_withdrawal_id" "uuid", "p_action" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_rotate_hmac_secret"("p_admin_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_secret TEXT;
BEGIN
  v_secret := encode(gen_random_bytes(32), 'hex');
  UPDATE admin_config
     SET hmac_secret = v_secret
   WHERE admin_user_id = p_admin_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Admin config not found for %', p_admin_id;
  END IF;

  RETURN v_secret;
END;
$$;


ALTER FUNCTION "public"."admin_rotate_hmac_secret"("p_admin_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_admin_role"("p_user_id" "uuid", "p_is_admin" boolean, "p_allowed_views" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id UUID;
  v_caller RECORD;
  v_target RECORD;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Caller must be a super admin (is_admin + no view restrictions)
  SELECT * INTO v_caller FROM users WHERE id = v_caller_id;
  IF NOT FOUND OR NOT v_caller.is_admin THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_caller.admin_allowed_views IS NOT NULL AND array_length(v_caller.admin_allowed_views, 1) > 0 THEN
    RAISE EXCEPTION 'Only super admins can manage admin roles';
  END IF;

  -- Cannot modify own role
  IF p_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Cannot modify your own admin role';
  END IF;

  -- Target user must exist
  SELECT * INTO v_target FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Bypass protected columns trigger
  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_is_admin THEN
    UPDATE users SET
      is_admin = TRUE,
      admin_allowed_views = p_allowed_views,
      updated_at = NOW()
    WHERE id = p_user_id;
  ELSE
    UPDATE users SET
      is_admin = FALSE,
      admin_allowed_views = NULL,
      updated_at = NOW()
    WHERE id = p_user_id;
  END IF;

  -- Log the action (TEXT message + JSONB context — 4 args, matching log_system_event signature)
  PERFORM log_system_event(
    'warn'::log_severity,
    'admin/role_change',
    'Admin role changed',
    jsonb_build_object(
      'caller_id', v_caller_id,
      'target_id', p_user_id,
      'is_admin', p_is_admin,
      'allowed_views', p_allowed_views
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', p_user_id,
    'is_admin', p_is_admin,
    'admin_allowed_views', p_allowed_views
  );
END;
$$;


ALTER FUNCTION "public"."admin_set_admin_role"("p_user_id" "uuid", "p_is_admin" boolean, "p_allowed_views" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_set_pin"("p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF length(p_pin) < 4 OR length(p_pin) > 8 THEN
    RAISE EXCEPTION 'PIN must be 4-8 digits';
  END IF;

  INSERT INTO admin_config (admin_user_id, pin_hash)
  VALUES (v_admin_id, crypt(p_pin, gen_salt('bf')))
  ON CONFLICT (admin_user_id)
  DO UPDATE SET pin_hash = crypt(p_pin, gen_salt('bf')), updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."admin_set_pin"("p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_branch_status"("p_branch_id" "uuid", "p_new_status" "text", "p_reason" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_admin_id UUID;
  v_branch RECORD;
  v_old_status TEXT;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  PERFORM _verify_admin_pin(v_admin_id, p_pin);
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  v_old_status := v_branch.status::TEXT;

  IF v_old_status = p_new_status THEN
    RAISE EXCEPTION 'Branch is already in % status', p_new_status;
  END IF;

  IF p_new_status NOT IN ('active', 'payback', 'frozen', 'suspended') THEN
    RAISE EXCEPTION 'Invalid status: %', p_new_status;
  END IF;

  -- If clearing payback, check pending_payouts
  IF v_old_status = 'payback' AND p_new_status = 'active' THEN
    IF v_branch.pending_payouts > 0 THEN
      IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN
        RAISE EXCEPTION 'Reason required when clearing payback with pending payouts ($%)',
          ROUND(v_branch.pending_payouts, 2);
      END IF;
      UPDATE branches SET pending_payouts = 0 WHERE id = p_branch_id;
    END IF;
  END IF;

  -- Execute status change
  UPDATE branches SET
    status = p_new_status::branch_status,
    suspension_reason = CASE WHEN p_new_status IN ('frozen', 'suspended') THEN p_reason ELSE NULL END,
    payback_activated_at = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_activated_at, now())
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_activated_at
    END,
    payback_reason = CASE
      WHEN p_new_status = 'payback' THEN COALESCE(v_branch.payback_reason, p_reason)
      WHEN p_new_status = 'active' THEN NULL
      ELSE v_branch.payback_reason
    END,
    -- *** FIX: set/clear frozen_at ***
    frozen_at = CASE
      WHEN p_new_status = 'frozen' THEN COALESCE(v_branch.frozen_at, NOW())
      WHEN p_new_status IN ('active', 'payback') THEN NULL
      ELSE v_branch.frozen_at
    END,
    updated_at = NOW()
  WHERE id = p_branch_id;

  -- Audit trail
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (v_admin_id, p_branch_id, 'status_change', COALESCE(p_reason, 'Admin status change'),
    jsonb_build_object('status', v_old_status),
    jsonb_build_object('status', p_new_status)
  );

  PERFORM log_system_event('warn'::log_severity, 'branch/status_change',
    'Branch status: ' || v_old_status || ' → ' || p_new_status,
    jsonb_build_object(
      'branch_id', p_branch_id, 'admin_id', v_admin_id,
      'old_status', v_old_status, 'new_status', p_new_status, 'reason', p_reason
    )
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'old_status', v_old_status,
    'new_status', p_new_status,
    'reason', p_reason
  );
END;
$_$;


ALTER FUNCTION "public"."admin_update_branch_status"("p_branch_id" "uuid", "p_new_status" "text", "p_reason" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_fee"("p_fee_id" "uuid", "p_new_rate" numeric, "p_pin" "text" DEFAULT NULL::"text", "p_token" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
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
$$;


ALTER FUNCTION "public"."admin_update_fee"("p_fee_id" "uuid", "p_new_rate" numeric, "p_pin" "text", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text" DEFAULT NULL::"text", "p_description_ar" "text" DEFAULT NULL::"text", "p_closes_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_keywords" "text"[] DEFAULT NULL::"text"[]) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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


ALTER FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text" DEFAULT NULL::"text", "p_description_ar" "text" DEFAULT NULL::"text", "p_closes_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_keywords" "text"[] DEFAULT NULL::"text"[], "p_image_url" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
    keywords = COALESCE(p_keywords, keywords),
    image_url = COALESCE(p_image_url, image_url)
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
        'keywords', p_keywords IS NOT NULL,
        'image_url', p_image_url IS NOT NULL
      )
    ));

  RETURN jsonb_build_object(
    'success', true,
    'market_id', p_market_id
  );
END;
$$;


ALTER FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[], "p_image_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_branch_agent"("p_branch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_agent_id UUID;
  v_code TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT id, status INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM branch_user_assignments
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  IF EXISTS (
    SELECT 1 FROM branch_agents
    WHERE user_id = v_user_id AND branch_id = p_branch_id
  ) THEN
    RAISE EXCEPTION 'Already applied to this branch';
  END IF;

  -- Qualify gen_random_bytes with its schema since search_path is public-only.
  v_code := encode(extensions.gen_random_bytes(4), 'hex');

  INSERT INTO branch_agents (branch_id, user_id, status, agent_type, rate, referral_code, is_active)
  VALUES (p_branch_id, v_user_id, 'pending', NULL, NULL, v_code, false)
  RETURNING id INTO v_agent_id;

  RETURN jsonb_build_object('agent_id', v_agent_id, 'status', 'pending');
END;
$$;


ALTER FUNCTION "public"."apply_branch_agent"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."approve_branch_agent"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
  v_existing_pl_sum DECIMAL;
  v_cap DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_agent.status != 'pending' THEN
    RAISE EXCEPTION 'Agent is not in pending status';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  -- 80% combined P/L rate cap (PR 3 feature — preserved).
  IF p_agent_type = 'pl' THEN
    SELECT COALESCE(SUM(rate), 0) INTO v_existing_pl_sum
    FROM branch_agents
    WHERE branch_id = v_agent.branch_id
      AND agent_type = 'pl'
      AND status = 'approved'
      AND id != p_agent_id;

    SELECT rate INTO v_cap
    FROM fee_config WHERE fee_type = 'max_pl_agent_rate_sum' LIMIT 1;
    v_cap := COALESCE(v_cap, 0.80);

    IF (v_existing_pl_sum + p_rate) > v_cap THEN
      RAISE EXCEPTION 'Combined P/L rate would exceed % cap (existing %, proposed %, sum %)',
        ROUND(v_cap * 100, 1),
        ROUND(v_existing_pl_sum * 100, 1),
        ROUND(p_rate * 100, 1),
        ROUND((v_existing_pl_sum + p_rate) * 100, 1);
    END IF;
  END IF;

  UPDATE branch_agents
  SET status = 'approved',
      agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0),
      is_active = true,
      approved_at = now(),
      approved_by = v_caller,
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'status', 'approved',
    'agent_type', p_agent_type,
    'rate', p_rate
  );
END;
$$;


ALTER FUNCTION "public"."approve_branch_agent"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."branch_credit_transfer"("p_branch_id" "uuid", "p_recipient_id" "uuid", "p_amount" numeric, "p_description" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_issuer_id UUID;
  v_branch RECORD;
  v_issuer RECORD;
  v_recipient RECORD;
  v_issuer_role credit_chain_role;
  v_recipient_role credit_chain_role;
  v_issuer_rank INT;
  v_recipient_rank INT;
  v_issuer_agent RECORD;
  v_recipient_agent RECORD;
  v_issuer_new_balance DECIMAL;
  v_recipient_new_balance DECIMAL;
  v_credit_id UUID;
BEGIN
  v_issuer_id := auth.uid();
  IF v_issuer_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate amount
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_amount > 100000 THEN
    RAISE EXCEPTION 'Amount exceeds maximum ($100,000)';
  END IF;

  -- Lock branch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- *** FIX: Block credits in payback, frozen, AND suspended ***
  IF v_branch.status IN ('payback', 'frozen', 'suspended') THEN
    RAISE EXCEPTION 'Branch is in % mode — credit transfers blocked', v_branch.status;
  END IF;

  -- Lock both user rows (consistent order by UUID)
  IF v_issuer_id < p_recipient_id THEN
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
  ELSE
    SELECT * INTO v_recipient FROM users WHERE id = p_recipient_id FOR UPDATE;
    SELECT * INTO v_issuer FROM users WHERE id = v_issuer_id FOR UPDATE;
  END IF;

  IF v_issuer IS NULL THEN RAISE EXCEPTION 'Issuer not found'; END IF;
  IF v_recipient IS NULL THEN RAISE EXCEPTION 'Recipient not found'; END IF;
  IF v_issuer.is_frozen THEN RAISE EXCEPTION 'Your account is frozen'; END IF;
  IF v_recipient.is_frozen THEN RAISE EXCEPTION 'Recipient account is frozen'; END IF;

  -- ═══ DETERMINE ISSUER ROLE ═══
  IF v_issuer.is_admin THEN
    v_issuer_role := 'admin';
    v_issuer_rank := 0;
  ELSIF v_branch.manager_user_id = v_issuer_id THEN
    v_issuer_role := 'branch_manager';
    v_issuer_rank := 1;
  ELSE
    SELECT * INTO v_issuer_agent
    FROM branch_agents
    WHERE user_id = v_issuer_id AND branch_id = p_branch_id AND is_active = true;

    IF FOUND THEN
      IF v_issuer_agent.parent_agent_id IS NULL THEN
        v_issuer_role := 'agent';
        v_issuer_rank := 2;
      ELSE
        v_issuer_role := 'sub_agent';
        v_issuer_rank := 3;
      END IF;
    ELSE
      RAISE EXCEPTION 'Not authorized to issue credits in this branch';
    END IF;
  END IF;

  -- ═══ DETERMINE RECIPIENT ROLE ═══
  IF v_recipient.is_admin THEN
    v_recipient_role := 'admin';
    v_recipient_rank := 0;
  ELSIF v_branch.manager_user_id = p_recipient_id THEN
    v_recipient_role := 'branch_manager';
    v_recipient_rank := 1;
  ELSE
    SELECT * INTO v_recipient_agent
    FROM branch_agents
    WHERE user_id = p_recipient_id AND branch_id = p_branch_id;

    IF FOUND THEN
      IF v_recipient_agent.parent_agent_id IS NULL THEN
        v_recipient_role := 'agent';
        v_recipient_rank := 2;
      ELSE
        v_recipient_role := 'sub_agent';
        v_recipient_rank := 3;
      END IF;
    ELSE
      IF EXISTS (SELECT 1 FROM branch_user_assignments WHERE user_id = p_recipient_id AND branch_id = p_branch_id) THEN
        v_recipient_role := 'user';
        v_recipient_rank := 4;
      ELSE
        RAISE EXCEPTION 'Recipient not assigned to this branch';
      END IF;
    END IF;
  END IF;

  -- ═══ HIERARCHY VALIDATION (downward only) ═══
  IF v_issuer_rank >= v_recipient_rank THEN
    RAISE EXCEPTION 'Credits can only flow downward (% cannot credit %)',
      v_issuer_role, v_recipient_role;
  END IF;

  -- Agent → sub_agent: verify parent chain
  IF v_issuer_role = 'agent' AND v_recipient_role = 'sub_agent' THEN
    IF v_recipient_agent.parent_agent_id != v_issuer_agent.id THEN
      RAISE EXCEPTION 'Sub-agent does not belong to your agent network';
    END IF;
  END IF;

  -- Sub-agent → user: verify assignment
  IF v_issuer_role = 'sub_agent' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments
      WHERE user_id = p_recipient_id AND branch_id = p_branch_id
        AND agent_id = v_issuer_agent.id
    ) THEN
      RAISE EXCEPTION 'User is not assigned to your agent network';
    END IF;
  END IF;

  -- Agent → user: verify assignment (direct or via sub-agents)
  IF v_issuer_role = 'agent' AND v_recipient_role = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM branch_user_assignments bua
      WHERE bua.user_id = p_recipient_id AND bua.branch_id = p_branch_id
        AND (bua.agent_id = v_issuer_agent.id
          OR bua.agent_id IN (SELECT id FROM branch_agents WHERE parent_agent_id = v_issuer_agent.id))
    ) THEN
      RAISE EXCEPTION 'User is not in your agent network';
    END IF;
  END IF;

  -- ═══ BALANCE CHECK ═══
  IF v_issuer.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance ($% available)', ROUND(v_issuer.balance_usd, 2);
  END IF;

  -- ═══ EXECUTE TRANSFER ═══
  UPDATE users SET balance_usd = balance_usd - p_amount, updated_at = NOW()
  WHERE id = v_issuer_id
  RETURNING balance_usd INTO v_issuer_new_balance;

  UPDATE users SET balance_usd = balance_usd + p_amount, updated_at = NOW()
  WHERE id = p_recipient_id
  RETURNING balance_usd INTO v_recipient_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (v_issuer_id, 'branch_credit_out', -p_amount, v_issuer_new_balance,
          COALESCE(p_description, 'Branch credit to ' || p_recipient_id::TEXT), v_issuer_id);

  INSERT INTO transactions (user_id, type, amount, balance_after, description, performed_by)
  VALUES (p_recipient_id, 'branch_credit_in', p_amount, v_recipient_new_balance,
          COALESCE(p_description, 'Branch credit from ' || v_issuer_id::TEXT), v_issuer_id);

  INSERT INTO credit_chain_ledger (branch_id, issuer_id, recipient_id, issuer_role, recipient_role, amount, description)
  VALUES (p_branch_id, v_issuer_id, p_recipient_id, v_issuer_role, v_recipient_role, p_amount, p_description)
  RETURNING id INTO v_credit_id;

  PERFORM log_system_event('info'::log_severity, 'branch/credit_transfer',
    'Credit transfer: ' || v_issuer_role || ' → ' || v_recipient_role || ' $' || p_amount,
    jsonb_build_object(
      'credit_id', v_credit_id, 'branch_id', p_branch_id,
      'issuer_id', v_issuer_id, 'recipient_id', p_recipient_id,
      'issuer_role', v_issuer_role, 'recipient_role', v_recipient_role,
      'amount', p_amount
    )
  );

  RETURN jsonb_build_object(
    'credit_id', v_credit_id,
    'issuer_new_balance', ROUND(v_issuer_new_balance, 2),
    'recipient_new_balance', ROUND(v_recipient_new_balance, 2),
    'issuer_role', v_issuer_role,
    'recipient_role', v_recipient_role
  );
END;
$_$;


ALTER FUNCTION "public"."branch_credit_transfer"("p_branch_id" "uuid", "p_recipient_id" "uuid", "p_amount" numeric, "p_description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."branch_dashboard_stats"("p_branch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_user_count INTEGER;
  v_active_agent_count INTEGER;
  v_trade_count INTEGER;
  v_total_volume DECIMAL;
  v_total_revenue DECIMAL;
  v_trades_last_24h INTEGER;
  v_total_markets INTEGER;
  v_commission_credited DECIMAL;
  v_commission_escrowed DECIMAL;
  v_qualified_referrals INTEGER;
  v_network_volume DECIMAL;
  v_agent_level INTEGER;
  v_agent_activated BOOLEAN;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  IF v_branch.manager_user_id != v_user_id THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Access denied: not admin or branch manager';
    END IF;
  END IF;

  IF v_branch.book_type = 'commission' THEN
    -- Commission branch: attributed users, commission sub-agents, earnings from referral system
    SELECT COUNT(*) INTO v_user_count
    FROM users WHERE signup_branch_id = p_branch_id;

    SELECT COUNT(*) INTO v_active_agent_count
    FROM branch_agents
    WHERE branch_id = p_branch_id AND is_active = TRUE;

    -- Commission totals from referral_commissions (manager's own + sub-agents' is
    -- via layer-2 chain; this shows manager's personal earnings only)
    SELECT
      COALESCE(SUM(CASE WHEN status = 'credited' THEN amount ELSE 0 END), 0),
      COALESCE(SUM(CASE WHEN status = 'escrowed' THEN amount ELSE 0 END), 0)
    INTO v_commission_credited, v_commission_escrowed
    FROM referral_commissions
    WHERE agent_user_id = v_branch.manager_user_id;

    -- Manager's agent profile for tier display
    SELECT qualified_referral_count, network_volume, agent_level, agent_activated
    INTO v_qualified_referrals, v_network_volume, v_agent_level, v_agent_activated
    FROM users WHERE id = v_branch.manager_user_id;

    RETURN jsonb_build_object(
      'book_type', 'commission',
      'user_count', v_user_count,
      'active_agent_count', v_active_agent_count,
      'commission_credited', ROUND(v_commission_credited, 2),
      'commission_escrowed', ROUND(v_commission_escrowed, 2),
      'qualified_referral_count', COALESCE(v_qualified_referrals, 0),
      'network_volume', ROUND(COALESCE(v_network_volume, 0), 2),
      'agent_level', COALESCE(v_agent_level, 1),
      'agent_activated', COALESCE(v_agent_activated, FALSE)
    );
  END IF;

  -- Reseller branch (default): existing pool/volume stats
  SELECT COUNT(*) INTO v_user_count
  FROM branch_user_assignments WHERE branch_id = p_branch_id;

  SELECT COUNT(*) INTO v_active_agent_count
  FROM branch_agents WHERE branch_id = p_branch_id AND is_active = TRUE;

  SELECT COUNT(*), COALESCE(SUM(gross_amount), 0)
  INTO v_trade_count, v_total_volume
  FROM branch_trades WHERE branch_id = p_branch_id;

  SELECT COALESCE(SUM(total_revenue), 0) INTO v_total_revenue
  FROM branch_revenue WHERE branch_id = p_branch_id;

  SELECT COUNT(*) INTO v_trades_last_24h
  FROM branch_trades
  WHERE branch_id = p_branch_id AND created_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_total_markets
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND is_enabled = TRUE;

  RETURN jsonb_build_object(
    'book_type', 'reseller',
    'user_count', v_user_count,
    'active_agent_count', v_active_agent_count,
    'trade_count', v_trade_count,
    'total_volume', ROUND(v_total_volume, 2),
    'total_revenue', ROUND(v_total_revenue, 2),
    'trades_last_24h', v_trades_last_24h,
    'active_markets', v_total_markets
  );
END;
$$;


ALTER FUNCTION "public"."branch_dashboard_stats"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."branch_settle_resolution"("p_market_id" "uuid", "p_outcome" "public"."bet_side") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."branch_settle_resolution"("p_market_id" "uuid", "p_outcome" "public"."bet_side") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."branch_solvency_check"("p_branch_id" "uuid", "p_additional_pool_inflow" numeric DEFAULT 0, "p_additional_worst_case_delta" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_branch RECORD;
  v_worst_case_total DECIMAL;
  v_pool_balance DECIMAL;
  v_utilization DECIMAL;
  v_status TEXT;
  v_can_trade BOOLEAN;
  v_withdrawal_available DECIMAL;
  v_solvency_threshold DECIMAL := 0.95;
BEGIN
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  -- Use cached worst_case_total (updated incrementally on each trade)
  v_worst_case_total := v_branch.worst_case_total + p_additional_worst_case_delta;
  v_pool_balance := v_branch.pool_balance + p_additional_pool_inflow;

  -- Check for admin solvency override
  IF v_branch.solvency_override_pct IS NOT NULL
     AND v_branch.solvency_override_until IS NOT NULL
     AND now() < v_branch.solvency_override_until THEN
    v_solvency_threshold := v_branch.solvency_override_pct;
  END IF;

  -- Calculate utilization
  IF v_pool_balance <= 0 THEN
    v_utilization := 1.0;  -- 100% = red
  ELSE
    v_utilization := (v_branch.pending_payouts + v_worst_case_total) / v_pool_balance;
  END IF;

  -- Determine status
  IF v_utilization >= v_solvency_threshold THEN
    v_status := 'red';
    v_can_trade := false;
  ELSIF v_utilization >= 0.80 THEN
    v_status := 'yellow';
    v_can_trade := true;
  ELSE
    v_status := 'green';
    v_can_trade := true;
  END IF;

  -- Frozen/suspended branches can never trade
  IF v_branch.status IN ('frozen', 'suspended') THEN
    v_can_trade := false;
    v_status := 'red';
  END IF;

  v_withdrawal_available := GREATEST(0,
    v_pool_balance - v_branch.pending_payouts - v_worst_case_total
  );

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'pool_balance', ROUND(v_pool_balance, 2),
    'worst_case_total', ROUND(v_worst_case_total, 2),
    'pending_payouts', ROUND(v_branch.pending_payouts, 2),
    'utilization', ROUND(v_utilization, 4),
    'status', v_status,
    'can_trade', v_can_trade,
    'withdrawal_available', ROUND(v_withdrawal_available, 2),
    'branch_status', v_branch.status::TEXT
  );
END;
$$;


ALTER FUNCTION "public"."branch_solvency_check"("p_branch_id" "uuid", "p_additional_pool_inflow" numeric, "p_additional_worst_case_delta" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."branch_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id UUID;
  v_branch RECORD;
  v_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_solvency JSONB;
  v_withdrawal_available DECIMAL;
  v_new_pool_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Validate
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Withdrawal amount must be positive';
  END IF;

  IF p_destination IS NULL OR length(trim(p_destination)) = 0 THEN
    RAISE EXCEPTION 'Destination is required';
  END IF;

  -- Lock branch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Authorization: only manager can withdraw
  IF v_user_id != v_branch.manager_user_id THEN
    RAISE EXCEPTION 'Only the branch manager can make withdrawals';
  END IF;

  -- Status checks
  IF v_branch.status = 'payback' THEN
    RAISE EXCEPTION 'Withdrawals blocked in payback mode';
  END IF;
  IF v_branch.status = 'frozen' THEN
    RAISE EXCEPTION 'Branch is frozen — withdrawals blocked';
  END IF;
  IF v_branch.status = 'suspended' THEN
    RAISE EXCEPTION 'Branch is suspended — withdrawals blocked';
  END IF;

  -- Read fee from config
  SELECT rate INTO v_fee_rate FROM fee_config
  WHERE fee_type = 'branch_withdrawal_fee' AND level IS NULL;
  IF v_fee_rate IS NULL THEN v_fee_rate := 0.01; END IF;

  -- Reserve lock check via solvency function
  v_solvency := branch_solvency_check(p_branch_id);
  v_withdrawal_available := (v_solvency->>'withdrawal_available')::DECIMAL;

  IF p_amount > v_withdrawal_available THEN
    RAISE EXCEPTION 'Insufficient available balance — reserve lock ($% available)',
      ROUND(v_withdrawal_available, 2);
  END IF;

  -- Calculate fee
  v_fee := ROUND(p_amount * v_fee_rate, 2);
  v_net_amount := p_amount - v_fee;

  -- Pool ledger: withdrawal entry (negative)
  INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
  VALUES (p_branch_id, 'withdrawal', -p_amount,
          v_branch.pool_balance - p_amount,
          'Withdrawal to ' || p_destination || COALESCE(' — ' || p_note, ''));

  -- Pool ledger: fee retained (positive)
  IF v_fee > 0 THEN
    INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
    VALUES (p_branch_id, 'withdrawal_fee', v_fee,
            v_branch.pool_balance - p_amount + v_fee,
            'Withdrawal fee retained (1%)');
  END IF;

  -- Update branch pool balance cache
  UPDATE branches SET
    pool_balance = pool_balance - p_amount + v_fee,
    updated_at = NOW()
  WHERE id = p_branch_id
  RETURNING pool_balance INTO v_new_pool_balance;

  -- Audit log
  PERFORM log_system_event('info'::log_severity, 'branch/withdrawal',
    'Branch withdrawal $' || p_amount || ' to ' || p_destination,
    jsonb_build_object(
      'branch_id', p_branch_id, 'manager_id', v_user_id,
      'gross_amount', p_amount, 'fee', v_fee, 'net_amount', v_net_amount,
      'destination', p_destination, 'note', p_note,
      'new_pool_balance', v_new_pool_balance
    )
  );

  RETURN jsonb_build_object(
    'withdrawal_amount', ROUND(p_amount, 2),
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'new_pool_balance', ROUND(v_new_pool_balance, 2),
    'destination', p_destination
  );
END;
$_$;


ALTER FUNCTION "public"."branch_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_withdrawal"("p_withdrawal_id" "uuid", "p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_withdrawal RECORD;
  v_user RECORD;
  v_new_balance DECIMAL(18,6);
  v_txn_id UUID;
BEGIN
  -- Lock withdrawal row first. Lock order matches process_withdrawal /
  -- withdrawal_reject (withdrawal → user) to avoid deadlocks with admin
  -- review paths running concurrently.
  SELECT * INTO v_withdrawal
  FROM withdrawals
  WHERE id = p_withdrawal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Withdrawal not found';
  END IF;

  -- Identity check: a user can only cancel their own withdrawal.
  IF v_withdrawal.user_id != p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: withdrawal does not belong to user';
  END IF;

  -- Status check: only 'pending' withdrawals can be cancelled. If the row
  -- has already been approved or rejected by an admin, the cancellation
  -- attempt fails cleanly without double-mutating state.
  IF v_withdrawal.status != 'pending' THEN
    RAISE EXCEPTION 'Cannot cancel — withdrawal status is %', v_withdrawal.status;
  END IF;

  -- Lock user row.
  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;

  v_new_balance := v_user.balance_usd + v_withdrawal.amount;

  -- Mark withdrawal rejected with audit-friendly note.
  UPDATE withdrawals
  SET status = 'rejected',
      admin_notes = 'Cancelled by user via support AI',
      processed_at = NOW()
  WHERE id = p_withdrawal_id;

  -- Refund user balance.
  UPDATE users SET balance_usd = v_new_balance WHERE id = p_user_id;

  -- Append-only ledger entry. Mirrors the refund pattern from
  -- withdrawal_reject (migration 026) so the ledger stays balanced.
  INSERT INTO transactions (
    user_id, type, amount, balance_after, reference_id, description
  )
  VALUES (
    p_user_id, 'refund', v_withdrawal.amount, v_new_balance, p_withdrawal_id,
    'Withdrawal cancelled by user via support AI'
  )
  RETURNING id INTO v_txn_id;

  RETURN jsonb_build_object(
    'success', true,
    'withdrawal_id', p_withdrawal_id,
    'refunded_amount', v_withdrawal.amount,
    'new_balance', v_new_balance,
    'transaction_id', v_txn_id
  );
END;
$$;


ALTER FUNCTION "public"."cancel_withdrawal"("p_withdrawal_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_branch_velocity"() RETURNS TABLE("branch_id" "uuid", "branch_name" "text", "today_volume" numeric, "daily_average" numeric, "velocity_ratio" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."check_branch_velocity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_payback_escalation"() RETURNS TABLE("branch_id" "uuid", "old_status" "text", "new_status" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_branch RECORD;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Escalate frozen → suspended: use frozen_at (NOT payback_activated_at)
  FOR v_branch IN
    SELECT * FROM branches
    WHERE status = 'frozen'
      AND frozen_at IS NOT NULL
      AND frozen_at + INTERVAL '30 days' < now()
  LOOP
    UPDATE branches SET
      status = 'suspended',
      suspension_reason = 'Payback escalation: 30+ days frozen',
      updated_at = NOW()
    WHERE id = v_branch.id;

    PERFORM log_system_event('error'::log_severity, 'branch/payback_escalation',
      'Branch ' || v_branch.name || ' escalated: frozen → suspended',
      jsonb_build_object('branch_id', v_branch.id, 'frozen_days', 30)
    );

    branch_id := v_branch.id;
    old_status := 'frozen';
    new_status := 'suspended';
    RETURN NEXT;
  END LOOP;

  -- Escalate payback → frozen: use payback_activated_at, SET frozen_at
  FOR v_branch IN
    SELECT * FROM branches
    WHERE status = 'payback'
      AND payback_activated_at IS NOT NULL
      AND payback_activated_at + INTERVAL '14 days' < now()
  LOOP
    UPDATE branches SET
      status = 'frozen',
      frozen_at = NOW(),
      suspension_reason = 'Payback escalation: 14+ days unresolved',
      updated_at = NOW()
    WHERE id = v_branch.id;

    PERFORM log_system_event('warn'::log_severity, 'branch/payback_escalation',
      'Branch ' || v_branch.name || ' escalated: payback → frozen',
      jsonb_build_object('branch_id', v_branch.id, 'days', 14)
    );

    branch_id := v_branch.id;
    old_status := 'payback';
    new_status := 'frozen';
    RETURN NEXT;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."check_payback_escalation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_deposit_bonus"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_bonus_amount DECIMAL := 5.00;
  v_min_deposit DECIMAL := 20.00;
  v_wagering_multiplier DECIMAL := 2.0;
  v_first_deposit RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  -- Check: not already claimed
  IF v_user.deposit_bonus_claimed THEN
    RAISE EXCEPTION 'Bonus already claimed';
  END IF;

  -- Check: non-referred users ONLY (anti-farming per Codex review)
  IF v_user.referred_by IS NOT NULL THEN
    RAISE EXCEPTION 'Deposit bonus is for non-referred users only';
  END IF;

  -- Check: has a confirmed deposit of $20+
  SELECT * INTO v_first_deposit
  FROM deposits
  WHERE user_id = v_user_id AND status = 'confirmed' AND amount >= v_min_deposit
  ORDER BY confirmed_at ASC LIMIT 1;

  IF v_first_deposit IS NULL THEN
    RAISE EXCEPTION 'Requires a confirmed deposit of $% or more', v_min_deposit;
  END IF;

  -- Credit bonus
  UPDATE users SET
    balance_usd = balance_usd + v_bonus_amount,
    deposit_bonus_claimed = TRUE,
    wagering_requirement = wagering_requirement + (v_bonus_amount * v_wagering_multiplier)
  WHERE id = v_user_id;

  -- Ledger entry
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'bonus', v_bonus_amount,
    v_user.balance_usd + v_bonus_amount,
    v_first_deposit.id,
    'First deposit bonus ($5 free)'
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'bonus_amount', v_bonus_amount
  );
END;
$_$;


ALTER FUNCTION "public"."claim_deposit_bonus"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_test_data"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
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
$$;


ALTER FUNCTION "public"."cleanup_test_data"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."clear_payback_mode"("p_branch_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_branch RECORD;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_branch.status != 'payback' THEN RETURN; END IF;
  IF v_branch.pending_payouts > 0 THEN RETURN; END IF;

  UPDATE branches SET
    status = 'active',
    payback_activated_at = NULL,
    payback_reason = NULL,
    pending_payouts = 0,
    frozen_at = NULL,
    updated_at = NOW()
  WHERE id = p_branch_id;

  PERFORM log_system_event('info'::log_severity, 'branch/payback_cleared',
    'Branch ' || v_branch.name || ' payback cleared — returned to active',
    jsonb_build_object('branch_id', p_branch_id)
  );
END;
$$;


ALTER FUNCTION "public"."clear_payback_mode"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dead_market_check"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_market RECORD;
  v_voided INTEGER := 0;
BEGIN
  -- Auth: service_role or admin
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Admin or service_role access required';
    END IF;
  END IF;

  FOR v_market IN
    SELECT m.id
    FROM markets m
    JOIN amm_state a ON a.market_id = m.id
    WHERE m.status = 'open'
      AND m.created_at < NOW() - INTERVAL '48 hours'
      AND a.total_volume < 100
  LOOP
    PERFORM _void_market_internal(v_market.id);
    v_voided := v_voided + 1;
  END LOOP;

  RETURN jsonb_build_object('voided_count', v_voided);
END;
$$;


ALTER FUNCTION "public"."dead_market_check"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demo_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric DEFAULT NULL::numeric, "p_shares_to_sell" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_position RECORD;

  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_b DECIMAL;
  v_price_per_share DECIMAL;
  v_gross_proceeds DECIMAL;
  v_sell_pnl DECIMAL;
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid side: must be "yes" or "no"';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- Lock user, market, amm in deterministic order to avoid deadlocks.
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;
  IF v_user.demo_first_enabled_at IS NULL THEN
    RAISE EXCEPTION 'Demo mode not initialized';
  END IF;

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  IF now() < v_market.opens_at THEN RAISE EXCEPTION 'Market not open yet'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM demo_amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══
    IF p_amount > v_user.demo_balance_usd THEN
      RAISE EXCEPTION 'Insufficient demo balance';
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);

    IF p_side = 'yes' THEN
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', p_amount);
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', p_amount);
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price  := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');
    v_price_per_share := p_amount / v_shares;

    -- Update AMM
    UPDATE demo_amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price  = v_new_no_price,
      total_volume = total_volume + p_amount,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    -- Upsert position
    INSERT INTO demo_positions (user_id, market_id, side, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, v_shares, v_price_per_share, p_amount)
    ON CONFLICT (user_id, market_id, side) DO UPDATE SET
      avg_entry_price = (demo_positions.total_invested + p_amount) / (demo_positions.shares_held + v_shares),
      shares_held = demo_positions.shares_held + v_shares,
      total_invested = demo_positions.total_invested + p_amount;

    -- Record trade
    INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                             price_per_share, total_cost, post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    -- Debit balance (RETURNING for post-update value)
    UPDATE users SET
      demo_balance_usd = demo_balance_usd - p_amount,
      demo_first_trade_at = COALESCE(demo_first_trade_at, NOW()),
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    -- Ledger
    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'demo_bet', -p_amount, v_new_balance, v_trade_id, 'Buy ' || p_side || ' demo shares');

    -- Market stats
    UPDATE demo_markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM demo_trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH ═══
    SELECT * INTO v_position FROM demo_positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no  := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no  := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price  := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_gross_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    UPDATE demo_amm_state SET
      q_yes = v_new_q_yes,
      q_no = v_new_q_no,
      current_yes_price = v_new_yes_price,
      current_no_price  = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds,
      total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE demo_positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl,
      updated_at = NOW()
    WHERE id = v_position.id;

    INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                             price_per_share, total_cost, post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_gross_proceeds, v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    UPDATE users SET
      demo_balance_usd = demo_balance_usd + v_gross_proceeds,
      demo_first_trade_at = COALESCE(demo_first_trade_at, NOW()),
      updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd INTO v_new_balance;

    INSERT INTO demo_transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'demo_bet', v_gross_proceeds, v_new_balance, v_trade_id, 'Sell ' || p_side || ' demo shares');

    UPDATE demo_markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;

  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(COALESCE(v_shares, v_shares_to_sell), 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(COALESCE(p_amount, v_gross_proceeds), 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6),
    'demo_balance_usd', v_new_balance
  );
END;
$$;


ALTER FUNCTION "public"."demo_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demo_get_price_history"("p_market_id" "uuid", "p_period" "text" DEFAULT '1D'::"text", "p_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("bucket_time" timestamp with time zone, "yes_price" numeric, "no_price" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ := NOW();
  v_interval INTERVAL;
  v_first_trade TIMESTAMPTZ;
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  SELECT MIN(t.created_at) INTO v_first_trade
  FROM demo_trades t WHERE t.market_id = p_market_id;

  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '6H'  THEN v_start := v_end - INTERVAL '6 hours';   v_interval := INTERVAL '2 minutes';
    WHEN '12H' THEN v_start := v_end - INTERVAL '12 hours';  v_interval := INTERVAL '3 minutes';
    WHEN '1D'  THEN v_start := v_end - INTERVAL '1 day';     v_interval := INTERVAL '5 minutes';
    WHEN '1W'  THEN v_start := v_end - INTERVAL '7 days';    v_interval := INTERVAL '30 minutes';
    WHEN '1M'  THEN v_start := v_end - INTERVAL '30 days';   v_interval := INTERVAL '2 hours';
    WHEN 'ALL' THEN
      v_start := COALESCE(p_created_at, v_end - INTERVAL '30 days');
      v_interval := GREATEST(
        (v_end - v_start) / 500,
        INTERVAL '1 minute'
      );
    ELSE
      v_start := v_end - INTERVAL '1 day'; v_interval := INTERVAL '5 minutes';
  END CASE;

  IF p_period != 'ALL' AND v_first_trade IS NOT NULL THEN
    DECLARE
      v_period_duration INTERVAL;
      v_buffer INTERVAL;
    BEGIN
      v_period_duration := v_end - v_start;
      v_buffer := v_period_duration * 0.1;
      IF v_first_trade > v_start + v_period_duration * 0.5 THEN
        v_start := v_first_trade - v_buffer;
      END IF;
    END;
  END IF;

  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(tr.post_yes_price,
        CASE WHEN tr.side::text = 'yes' THEN tr.price_per_share
             ELSE 1 - tr.price_per_share END) AS y_price,
      COALESCE(tr.post_no_price,
        CASE WHEN tr.side::text = 'yes' THEN 1 - tr.price_per_share
             ELSE tr.price_per_share END) AS n_price
    FROM demo_trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;


ALTER FUNCTION "public"."demo_get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demo_reset_balance"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_delta DECIMAL;
  v_new_balance DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  IF v_user.demo_first_enabled_at IS NULL THEN
    RAISE EXCEPTION 'Demo mode not initialized';
  END IF;

  v_delta := 10000 - v_user.demo_balance_usd;

  UPDATE users
  SET demo_balance_usd = 10000,
      updated_at = NOW()
  WHERE id = v_user_id
  RETURNING demo_balance_usd INTO v_new_balance;

  INSERT INTO demo_transactions (user_id, type, amount, balance_after, description)
  VALUES (v_user_id, 'demo_reset', v_delta, v_new_balance, 'Demo balance reset to $10,000');

  RETURN jsonb_build_object(
    'demo_balance_usd', v_new_balance,
    'delta', v_delta
  );
END;
$_$;


ALTER FUNCTION "public"."demo_reset_balance"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."demo_seed_initial_price"("p_market_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_market RECORD;
BEGIN
  PERFORM _demo_assert_admin();

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  -- Use the market creator as the synthetic trade user so FK holds.
  INSERT INTO demo_trades (user_id, market_id, side, direction, shares,
                           price_per_share, total_cost, post_yes_price, post_no_price,
                           created_at)
  VALUES (v_market.created_by, p_market_id, 'yes'::bet_side, 'buy'::trade_direction,
          0.000001, 0.500000, 0.00, 0.500000, 0.500000, v_market.created_at);
END;
$$;


ALTER FUNCTION "public"."demo_seed_initial_price"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_branch_trade"("p_market_id" "uuid", "p_branch_id" "uuid", "p_side" "text", "p_amount" numeric DEFAULT NULL::numeric, "p_shares_to_sell" numeric DEFAULT NULL::numeric, "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_branch RECORD;
  v_position RECORD;
  v_assignment RECORD;
  v_market_config RECORD;

  v_price_impact_cap DECIMAL;
  v_min_trade DECIMAL;

  v_markup_pct DECIMAL;
  v_markup_amount DECIMAL;
  v_net_canonical DECIMAL;

  v_sooq_fee DECIMAL := 0;
  v_net_pool_inflow DECIMAL;

  v_b DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_price_per_share DECIMAL;
  v_price_impact DECIMAL;

  v_gross_proceeds DECIMAL;
  v_exit_fee DECIMAL;
  v_net_proceeds DECIMAL;
  v_sell_pnl DECIMAL;
  v_cash_out_enabled BOOLEAN;

  v_solvency JSONB;
  v_old_worst_case DECIMAL;
  v_new_worst_case DECIMAL;
  v_worst_case_delta DECIMAL;

  v_position_cap DECIMAL;
  v_current_shares DECIMAL := 0;

  v_sweep DECIMAL := 0;

  v_trade_id UUID;
  v_branch_trade_id UUID;

  -- ───── PR 2 NEW ─────
  v_agent RECORD;
  v_agent_commission DECIMAL;
  v_pool_balance_after_commission DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT bt.id INTO v_branch_trade_id
    FROM branch_trades bt
    WHERE bt.branch_id = p_branch_id AND bt.idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'trade_id', v_branch_trade_id,
        'idempotent', true,
        'message', 'Duplicate trade — returning existing result'
      );
    END IF;
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.status IN ('frozen', 'suspended') THEN
    RAISE EXCEPTION 'Branch is %', v_branch.status;
  END IF;

  SELECT * INTO v_assignment
  FROM branch_user_assignments
  WHERE user_id = v_user_id AND branch_id = p_branch_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not assigned to this branch';
  END IF;

  SELECT * INTO v_market_config
  FROM branch_market_config
  WHERE branch_id = p_branch_id AND market_id = p_market_id;

  IF FOUND AND NOT v_market_config.is_enabled THEN
    RAISE EXCEPTION 'Market is disabled for this branch';
  END IF;

  SELECT rate INTO v_price_impact_cap FROM fee_config
  WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;

  SELECT rate INTO v_min_trade FROM fee_config
  WHERE fee_type = 'min_trade_amount' AND level IS NULL;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══

    IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
      RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
    END IF;

    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    v_markup_pct := CASE WHEN p_side = 'yes' THEN v_branch.yes_markup_pct
                         ELSE v_branch.no_markup_pct END;
    v_markup_amount := ROUND(p_amount * v_markup_pct, 2);
    v_net_canonical := p_amount - v_markup_amount;

    IF v_net_canonical <= 0 THEN
      RAISE EXCEPTION 'Trade too small after markup';
    END IF;

    v_sooq_fee := ROUND(p_amount * v_branch.branch_fee_rate, 2);
    v_net_pool_inflow := p_amount - v_sooq_fee;

    v_position_cap := CASE WHEN p_side = 'yes' THEN
      COALESCE(v_market_config.position_cap_yes, v_branch.default_position_cap_yes)
    ELSE
      COALESCE(v_market_config.position_cap_no, v_branch.default_position_cap_no)
    END;

    IF v_position_cap IS NOT NULL THEN
      SELECT COALESCE(shares_held, 0) INTO v_current_shares
      FROM positions
      WHERE user_id = v_user_id AND market_id = p_market_id
        AND side = p_side::bet_side AND branch_id = p_branch_id;
    END IF;

    v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, p_side, v_net_canonical);

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

    IF v_position_cap IS NOT NULL AND (v_current_shares + v_shares) * 0.99 > v_position_cap THEN
      RAISE EXCEPTION 'Position cap exceeded (max $%)', v_position_cap;
    END IF;

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap (%.1f%% > %.1f%%)',
        v_price_impact * 100, v_price_impact_cap * 100;
    END IF;

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

    DECLARE
      v_est_yes_shares DECIMAL;
      v_est_no_shares DECIMAL;
      v_est_pool_cash DECIMAL;
      v_est_worst DECIMAL;
    BEGIN
      SELECT COALESCE(SUM(shares_held), 0) INTO v_est_yes_shares
      FROM positions
      WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'yes' AND shares_held > 0;

      SELECT COALESCE(SUM(shares_held), 0) INTO v_est_no_shares
      FROM positions
      WHERE branch_id = p_branch_id AND market_id = p_market_id AND side = 'no' AND shares_held > 0;

      IF p_side = 'yes' THEN
        v_est_yes_shares := v_est_yes_shares + v_shares;
      ELSE
        v_est_no_shares := v_est_no_shares + v_shares;
      END IF;

      SELECT COALESCE(SUM(amount), 0) INTO v_est_pool_cash
      FROM branch_pools
      WHERE branch_id = p_branch_id AND market_id = p_market_id;

      v_est_pool_cash := v_est_pool_cash + v_net_pool_inflow;

      v_est_worst := GREATEST(0,
        GREATEST(v_est_yes_shares * 0.99, v_est_no_shares * 0.99) - v_est_pool_cash
      );

      v_worst_case_delta := v_est_worst - v_old_worst_case;
    END;

    v_solvency := branch_solvency_check(p_branch_id, v_net_pool_inflow, v_worst_case_delta);

    IF NOT (v_solvency->>'can_trade')::BOOLEAN THEN
      RAISE EXCEPTION 'Branch solvency gate: trade rejected (utilization %)',
        v_solvency->>'utilization';
    END IF;

    IF v_branch.status = 'payback' THEN
      DECLARE
        v_post_pool DECIMAL;
        v_after_reserving DECIMAL;
      BEGIN
        v_post_pool := v_branch.pool_balance + v_net_pool_inflow;
        v_after_reserving := v_post_pool - v_branch.pending_payouts;
        IF v_after_reserving < (v_branch.worst_case_total + v_worst_case_delta) THEN
          RAISE EXCEPTION 'Payback mode: insufficient post-trade coverage';
        END IF;
      END;
    END IF;

    v_price_per_share := v_net_canonical / v_shares;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_net_canonical, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, p_branch_id, v_shares, v_price_per_share, v_net_canonical)
    ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_canonical) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_canonical;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, 0, v_markup_amount, 0,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

    INSERT INTO branch_trades (
      trade_id, branch_id, agent_id, user_id, market_id,
      gross_amount, branch_markup, net_canonical_amount,
      branch_quote_shown,
      canonical_pre_yes_price, canonical_pre_no_price,
      canonical_post_yes_price, canonical_post_no_price,
      shares_issued, idempotency_key,
      side, direction, exit_fee_amount
    ) VALUES (
      v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
      p_amount, v_markup_amount, v_net_canonical,
      v_price_per_share,
      v_amm.current_yes_price, v_amm.current_no_price,
      v_new_yes_price, v_new_no_price,
      v_shares, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
      p_side::bet_side, 'buy', 0
    );

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_buy', p_amount,
            v_branch.pool_balance + p_amount, v_trade_id,
            'Buy ' || p_side || ' — gross $' || p_amount || ', markup $' || v_markup_amount);

    IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 THEN
      v_sweep := LEAST(v_net_pool_inflow, v_branch.pending_payouts);
      IF v_sweep > 0 THEN
        INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
        VALUES (p_branch_id, 'payback_sweep', -v_sweep,
                v_branch.pool_balance + p_amount - v_sweep,
                'Payback sweep on buy inflow');

        UPDATE branches SET
          pending_payouts = GREATEST(0, pending_payouts - v_sweep)
        WHERE id = p_branch_id;
      END IF;
    END IF;

    IF v_sooq_fee > 0 THEN
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (p_branch_id, p_market_id, 'sooq_branch_fee', -v_sooq_fee,
              v_branch.pool_balance + p_amount - v_sweep - v_sooq_fee, v_trade_id,
              'SOOQ ' || ROUND(v_branch.branch_fee_rate * 100, 1) || '% fee on $' || p_amount || ' buy volume');
    END IF;

    UPDATE branches SET
      pool_balance = pool_balance + p_amount - v_sooq_fee - v_sweep,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    -- ═══ PR 2 NEW: commission-type branch agent payout ═══
    -- Runs AFTER the main pool update so pool_balance reflects inflows
    -- and any payback sweep. We debit commission on top of that.
    -- Skipped during payback mode (agents wait until branch recovers).
    IF v_branch.status != 'payback' AND v_assignment.agent_id IS NOT NULL THEN
      SELECT user_id, rate, agent_type, is_active
      INTO v_agent
      FROM branch_agents
      WHERE id = v_assignment.agent_id;

      IF FOUND AND v_agent.is_active AND v_agent.agent_type = 'commission' THEN
        v_agent_commission := ROUND(v_markup_amount * v_agent.rate, 2);

        IF v_agent_commission >= 0.01 THEN
          UPDATE branches
             SET pool_balance = pool_balance - v_agent_commission
           WHERE id = p_branch_id
           RETURNING pool_balance INTO v_pool_balance_after_commission;

          INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
          VALUES (
            p_branch_id, p_market_id, 'agent_commission',
            -v_agent_commission, v_pool_balance_after_commission, v_trade_id,
            'Agent commission — ' || ROUND(v_agent.rate * 100, 1) || '% of $'
              || ROUND(v_markup_amount, 2) || ' markup'
          );

          PERFORM _credit_branch_commission(
            p_branch_id,
            v_agent.user_id,
            v_user_id,
            p_market_id,
            v_trade_id,
            v_agent_commission,
            v_markup_amount,
            v_agent.rate
          );
        END IF;
      END IF;
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id,
            'Branch buy ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'trade_id', v_trade_id,
      'shares', ROUND(v_shares, 6),
      'price_per_share', ROUND(v_price_per_share, 6),
      'total_cost', ROUND(p_amount, 2),
      'markup', ROUND(v_markup_amount, 2),
      'net_canonical', ROUND(v_net_canonical, 2),
      'sooq_fee', ROUND(v_sooq_fee, 2),
      'new_yes_price', ROUND(v_new_yes_price, 6),
      'new_no_price', ROUND(v_new_no_price, 6),
      'price_impact', ROUND(v_price_impact, 6),
      'solvency_status', v_solvency->>'status'
    );

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH (unchanged from migration 237) ═══
    -- Sells have no markup, so no commission payment.

    v_cash_out_enabled := COALESCE(v_market_config.cash_out_enabled, v_branch.cash_out_enabled);
    IF NOT v_cash_out_enabled THEN
      RAISE EXCEPTION 'Cash-out is disabled for this market';
    END IF;

    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id
      AND side = p_side::bet_side AND branch_id = p_branch_id
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    IF v_branch.pool_balance < v_gross_proceeds THEN
      RAISE EXCEPTION 'Branch pool insufficient for cash-out';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_exit_fee := ROUND(v_gross_proceeds * v_branch.exit_fee_pct, 2);
    v_net_proceeds := v_gross_proceeds - v_exit_fee;
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    v_old_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds, total_trades = total_trades + 1,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    UPDATE positions SET shares_held = 0, total_invested = 0
    WHERE id = v_position.id AND shares_held > 0 AND shares_held < 0.001;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price, branch_id)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, 0, 0, v_exit_fee,
            v_new_yes_price, v_new_no_price, p_branch_id)
    RETURNING id INTO v_trade_id;

    INSERT INTO branch_trades (
      trade_id, branch_id, agent_id, user_id, market_id,
      gross_amount, branch_markup, net_canonical_amount, branch_quote_shown,
      canonical_pre_yes_price, canonical_pre_no_price,
      canonical_post_yes_price, canonical_post_no_price,
      shares_issued, idempotency_key,
      side, direction, exit_fee_amount
    ) VALUES (
      v_trade_id, p_branch_id, v_assignment.agent_id, v_user_id, p_market_id,
      v_gross_proceeds, 0, v_net_proceeds, v_price_per_share,
      v_amm.current_yes_price, v_amm.current_no_price,
      v_new_yes_price, v_new_no_price,
      v_shares_to_sell, COALESCE(p_idempotency_key, gen_random_uuid()::TEXT),
      p_side::bet_side, 'sell', v_exit_fee
    );

    INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (p_branch_id, p_market_id, 'trade_sell', -v_gross_proceeds,
            v_branch.pool_balance - v_gross_proceeds, v_trade_id,
            'Sell ' || p_side || ' — payout $' || v_gross_proceeds);

    IF v_exit_fee > 0 THEN
      INSERT INTO branch_pools (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (p_branch_id, p_market_id, 'exit_fee', v_exit_fee,
              v_branch.pool_balance - v_gross_proceeds + v_exit_fee, v_trade_id,
              'Exit fee retained $' || v_exit_fee);
    END IF;

    v_new_worst_case := _branch_worst_case_market(p_branch_id, p_market_id);
    v_worst_case_delta := v_new_worst_case - v_old_worst_case;

    UPDATE branches SET
      pool_balance = pool_balance - v_gross_proceeds + v_exit_fee,
      worst_case_total = GREATEST(0, worst_case_total + v_worst_case_delta),
      updated_at = NOW()
    WHERE id = p_branch_id;

    IF v_branch.status = 'payback' AND v_branch.pending_payouts > 0 AND v_exit_fee > 0 THEN
      DECLARE v_sell_sweep DECIMAL;
      BEGIN
        v_sell_sweep := LEAST(v_exit_fee, v_branch.pending_payouts);
        IF v_sell_sweep > 0 THEN
          INSERT INTO branch_pools (branch_id, type, amount, balance_after, description)
          VALUES (p_branch_id, 'payback_sweep', -v_sell_sweep,
                  v_branch.pool_balance - v_gross_proceeds + v_exit_fee - v_sell_sweep,
                  'Payback sweep on exit fee');
          UPDATE branches SET
            pending_payouts = GREATEST(0, pending_payouts - v_sell_sweep),
            pool_balance = pool_balance - v_sell_sweep
          WHERE id = p_branch_id;
        END IF;
      END;
    END IF;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_user.balance_usd + v_net_proceeds, v_trade_id,
            'Branch sell ' || p_side || ' shares');

    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id;

    UPDATE markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

    RETURN jsonb_build_object(
      'trade_id', v_trade_id,
      'shares', ROUND(v_shares_to_sell, 6),
      'price_per_share', ROUND(v_price_per_share, 6),
      'gross_proceeds', ROUND(v_gross_proceeds, 2),
      'exit_fee', ROUND(v_exit_fee, 2),
      'net_proceeds', ROUND(v_net_proceeds, 2),
      'new_yes_price', ROUND(v_new_yes_price, 6),
      'new_no_price', ROUND(v_new_no_price, 6),
      'price_impact', ROUND(v_price_impact, 6)
    );

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;
END;
$_$;


ALTER FUNCTION "public"."execute_branch_trade"("p_market_id" "uuid", "p_branch_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric, "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric DEFAULT NULL::numeric, "p_shares_to_sell" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_market RECORD;
  v_amm RECORD;
  v_position RECORD;

  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_max_trade_pct DECIMAL;
  v_dyn_threshold DECIMAL;
  v_dyn_multiplier DECIMAL;
  v_dynamic_spread DECIMAL := 0;
  v_min_trade DECIMAL;
  v_price_impact_cap DECIMAL;
  v_exposure_cap_mult DECIMAL;

  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_shares DECIMAL;
  v_shares_to_sell DECIMAL;
  v_new_q_yes DECIMAL;
  v_new_q_no DECIMAL;
  v_new_yes_price DECIMAL;
  v_new_no_price DECIMAL;
  v_b DECIMAL;
  v_net_amount DECIMAL;
  v_explicit_fee DECIMAL;
  v_amm_spread DECIMAL;
  v_price_per_share DECIMAL;
  v_gross_proceeds DECIMAL;
  v_net_proceeds DECIMAL;
  v_cash_out_premium DECIMAL;
  v_sell_pnl DECIMAL;
  v_trade_id UUID;
  v_price_impact DECIMAL;
  v_current_price DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for trading'; END IF;
  -- [274/275] Pre-launch guard: market scheduled for future must not be tradable.
  IF now() < v_market.opens_at THEN RAISE EXCEPTION 'Market not open yet'; END IF;
  IF now() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed'; END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AMM not initialized'; END IF;
  v_b := v_amm.liquidity_param;

  -- Read fee config
  SELECT rate INTO v_explicit_fee_rate FROM fee_config WHERE fee_type = 'explicit_fee' AND level IS NULL;
  SELECT rate INTO v_cash_out_rate FROM fee_config WHERE fee_type = 'cash_out_premium' AND level IS NULL;
  SELECT rate INTO v_max_trade_pct FROM fee_config WHERE fee_type = 'max_trade_pct' AND level IS NULL;
  SELECT rate INTO v_dyn_threshold FROM fee_config WHERE fee_type = 'dynamic_spread_threshold' AND level IS NULL;
  SELECT rate INTO v_dyn_multiplier FROM fee_config WHERE fee_type = 'dynamic_spread_multiplier' AND level IS NULL;
  SELECT rate INTO v_min_trade FROM fee_config WHERE fee_type = 'min_trade_amount' AND level IS NULL;
  SELECT rate INTO v_price_impact_cap FROM fee_config WHERE fee_type = 'canonical_price_impact_cap' AND level IS NULL;
  SELECT rate INTO v_exposure_cap_mult FROM fee_config WHERE fee_type = 'retail_exposure_cap_multiplier' AND level IS NULL;

  IF v_explicit_fee_rate IS NULL THEN v_explicit_fee_rate := 0.005; END IF;
  IF v_cash_out_rate IS NULL THEN v_cash_out_rate := 0.005; END IF;
  IF v_max_trade_pct IS NULL THEN v_max_trade_pct := 0.10; END IF;
  IF v_dyn_threshold IS NULL THEN v_dyn_threshold := 0.05; END IF;
  IF v_dyn_multiplier IS NULL THEN v_dyn_multiplier := 0.5; END IF;
  IF v_price_impact_cap IS NULL THEN v_price_impact_cap := 0.05; END IF;
  IF v_exposure_cap_mult IS NULL THEN v_exposure_cap_mult := 2.0; END IF;

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    -- ═══ BUY PATH ═══

    IF v_min_trade IS NOT NULL AND p_amount < v_min_trade THEN
      RAISE EXCEPTION 'Trade below minimum ($% required)', v_min_trade;
    END IF;

    IF p_amount > v_user.balance_usd THEN
      RAISE EXCEPTION 'Insufficient balance';
    END IF;

    IF p_amount > v_amm.total_volume * v_max_trade_pct + 100 THEN
      RAISE EXCEPTION 'Trade exceeds maximum size';
    END IF;

    v_explicit_fee := ROUND(p_amount * v_explicit_fee_rate, 2);
    v_net_amount := p_amount - v_explicit_fee;

    IF p_side = 'yes' THEN
      v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', v_net_amount);
      v_new_q_yes := v_amm.q_yes + v_shares;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
      v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', v_net_amount);
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no + v_shares;
    END IF;

    IF v_shares <= 0 THEN
      RAISE EXCEPTION 'Trade too small';
    END IF;

    v_current_price := CASE WHEN p_side = 'yes' THEN v_amm.current_yes_price ELSE v_amm.current_no_price END;
    IF v_current_price > (1 - v_dyn_threshold) OR v_current_price < v_dyn_threshold THEN
      v_dynamic_spread := v_net_amount * v_dyn_multiplier * 0.01;
      v_net_amount := v_net_amount - v_dynamic_spread;
      IF p_side = 'yes' THEN
        v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'yes', v_net_amount);
        v_new_q_yes := v_amm.q_yes + v_shares;
      ELSE
        v_shares := lmsr_shares_for_cost(v_b, v_amm.q_yes, v_amm.q_no, 'no', v_net_amount);
        v_new_q_no := v_amm.q_no + v_shares;
      END IF;
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    -- Price impact cap (Section 23)
    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap (%.1f%% > %.1f%%)',
        v_price_impact * 100, v_price_impact_cap * 100;
    END IF;

    -- Retail exposure cap
    DECLARE
      v_retail_yes DECIMAL;
      v_retail_no DECIMAL;
      v_retail_cash DECIMAL;
      v_retail_worst DECIMAL;
      v_exposure_cap DECIMAL;
    BEGIN
      SELECT COALESCE(SUM(shares_held), 0) INTO v_retail_yes
      FROM positions WHERE market_id = p_market_id AND branch_id IS NULL AND side = 'yes' AND shares_held > 0;
      SELECT COALESCE(SUM(shares_held), 0) INTO v_retail_no
      FROM positions WHERE market_id = p_market_id AND branch_id IS NULL AND side = 'no' AND shares_held > 0;

      IF p_side = 'yes' THEN v_retail_yes := v_retail_yes + v_shares;
      ELSE v_retail_no := v_retail_no + v_shares; END IF;

      v_retail_cash := v_amm.retail_net_cash + v_net_amount;
      v_retail_worst := GREATEST(0, GREATEST(v_retail_yes * 0.99, v_retail_no * 0.99) - v_retail_cash);
      v_exposure_cap := v_b * v_exposure_cap_mult;

      IF v_retail_worst > v_exposure_cap THEN
        RAISE EXCEPTION 'Retail exposure cap exceeded';
      END IF;
    END;

    v_price_per_share := v_net_amount / v_shares;
    v_amm_spread := v_net_amount - (v_shares * CASE WHEN p_side = 'yes' THEN v_amm.current_yes_price ELSE v_amm.current_no_price END);
    IF v_amm_spread < 0 THEN v_amm_spread := 0; END IF;

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + p_amount, total_trades = total_trades + 1,
      retail_net_cash = retail_net_cash + v_net_amount,
      retail_shares_yes = CASE WHEN p_side = 'yes' THEN retail_shares_yes + v_shares ELSE retail_shares_yes END,
      retail_shares_no = CASE WHEN p_side = 'no' THEN retail_shares_no + v_shares ELSE retail_shares_no END,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    INSERT INTO positions (user_id, market_id, side, branch_id, shares_held, avg_entry_price, total_invested)
    VALUES (v_user_id, p_market_id, p_side::bet_side, NULL, v_shares, v_price_per_share, v_net_amount)
    ON CONFLICT (user_id, market_id, side, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000')) DO UPDATE SET
      avg_entry_price = (positions.total_invested + v_net_amount) / (positions.shares_held + v_shares),
      shares_held = positions.shares_held + v_shares,
      total_invested = positions.total_invested + v_net_amount;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'buy'::trade_direction, v_shares,
            v_price_per_share, p_amount, v_explicit_fee, v_amm_spread + v_dynamic_spread, 0,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', -p_amount, v_user.balance_usd - p_amount, v_trade_id, 'Buy ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, p_amount);

    UPDATE markets SET
      trade_count = trade_count + 1,
      unique_traders = (SELECT COUNT(DISTINCT user_id) FROM trades WHERE market_id = p_market_id)
    WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

    UPDATE users SET
      balance_usd = balance_usd - p_amount,
      total_wagered = total_wagered + p_amount,
      updated_at = NOW()
    WHERE id = v_user_id;

  ELSIF p_shares_to_sell IS NOT NULL AND p_shares_to_sell > 0 THEN
    -- ═══ SELL PATH ═══
    SELECT * INTO v_position FROM positions
    WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side::bet_side
      AND branch_id IS NULL
    FOR UPDATE;

    IF NOT FOUND OR v_position.shares_held <= 0 THEN
      RAISE EXCEPTION 'No position to sell';
    END IF;

    v_shares_to_sell := LEAST(p_shares_to_sell, v_position.shares_held);

    IF p_side = 'yes' THEN
      v_new_q_yes := v_amm.q_yes - v_shares_to_sell;
      v_new_q_no := v_amm.q_no;
    ELSE
      v_new_q_yes := v_amm.q_yes;
      v_new_q_no := v_amm.q_no - v_shares_to_sell;
    END IF;

    v_old_cost := lmsr_cost(v_b, v_amm.q_yes, v_amm.q_no);
    v_new_cost := lmsr_cost(v_b, v_new_q_yes, v_new_q_no);
    v_gross_proceeds := v_old_cost - v_new_cost;

    IF v_gross_proceeds <= 0 THEN
      RAISE EXCEPTION 'Sell would yield zero proceeds';
    END IF;

    v_new_yes_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'yes');
    v_new_no_price := lmsr_price(v_b, v_new_q_yes, v_new_q_no, 'no');

    v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);
    IF v_price_impact > v_price_impact_cap THEN
      RAISE EXCEPTION 'Price impact exceeds cap';
    END IF;

    v_explicit_fee := ROUND(v_gross_proceeds * v_explicit_fee_rate, 2);
    v_cash_out_premium := ROUND(v_gross_proceeds * v_cash_out_rate, 2);
    v_amm_spread := 0;
    v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;
    v_price_per_share := v_gross_proceeds / v_shares_to_sell;
    v_sell_pnl := v_net_proceeds - (v_position.avg_entry_price * v_shares_to_sell);

    UPDATE amm_state SET
      q_yes = v_new_q_yes, q_no = v_new_q_no,
      current_yes_price = v_new_yes_price, current_no_price = v_new_no_price,
      total_volume = total_volume + v_gross_proceeds, total_trades = total_trades + 1,
      retail_net_cash = retail_net_cash - v_gross_proceeds,
      retail_shares_yes = CASE WHEN p_side = 'yes' THEN retail_shares_yes - v_shares_to_sell ELSE retail_shares_yes END,
      retail_shares_no = CASE WHEN p_side = 'no' THEN retail_shares_no - v_shares_to_sell ELSE retail_shares_no END,
      updated_at = NOW()
    WHERE market_id = p_market_id;

    UPDATE positions SET
      shares_held = shares_held - v_shares_to_sell,
      total_invested = GREATEST(0, total_invested - (v_position.avg_entry_price * v_shares_to_sell)),
      realized_pnl = realized_pnl + v_sell_pnl
    WHERE id = v_position.id;

    UPDATE positions SET shares_held = 0, total_invested = 0
    WHERE id = v_position.id AND shares_held > 0 AND shares_held < 0.001;

    INSERT INTO trades (user_id, market_id, side, direction, shares, price_per_share,
                        total_cost, explicit_fee, amm_spread_cost, cash_out_premium,
                        post_yes_price, post_no_price)
    VALUES (v_user_id, p_market_id, p_side::bet_side, 'sell'::trade_direction, v_shares_to_sell,
            v_price_per_share, v_net_proceeds, v_explicit_fee, v_amm_spread, v_cash_out_premium,
            v_new_yes_price, v_new_no_price)
    RETURNING id INTO v_trade_id;

    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'trade', v_net_proceeds, v_user.balance_usd + v_net_proceeds, v_trade_id, 'Sell ' || p_side || ' shares');

    PERFORM pay_trade_commissions(v_trade_id, v_user_id, v_gross_proceeds);

    UPDATE markets SET trade_count = trade_count + 1 WHERE id = p_market_id;

    INSERT INTO leader_stats (user_id, total_trades)
    VALUES (v_user_id, 1)
    ON CONFLICT (user_id) DO UPDATE SET total_trades = leader_stats.total_trades + 1;

    UPDATE users SET
      balance_usd = balance_usd + v_net_proceeds,
      updated_at = NOW()
    WHERE id = v_user_id;

  ELSE
    RAISE EXCEPTION 'Must provide p_amount (buy) or p_shares_to_sell (sell)';
  END IF;

  -- Check price alerts
  UPDATE price_alerts SET is_triggered = true, triggered_at = NOW()
  WHERE market_id = p_market_id AND is_triggered = false
    AND (
      (side = 'yes' AND direction = 'above' AND v_new_yes_price >= target_price) OR
      (side = 'yes' AND direction = 'below' AND v_new_yes_price <= target_price) OR
      (side = 'no' AND direction = 'above' AND v_new_no_price >= target_price) OR
      (side = 'no' AND direction = 'below' AND v_new_no_price <= target_price)
    );

  v_price_impact := ABS(v_new_yes_price - v_amm.current_yes_price);

  RETURN jsonb_build_object(
    'trade_id', v_trade_id,
    'shares', ROUND(COALESCE(v_shares, v_shares_to_sell), 6),
    'price_per_share', ROUND(v_price_per_share, 6),
    'total_cost', ROUND(COALESCE(p_amount, v_net_proceeds), 2),
    'explicit_fee', ROUND(v_explicit_fee, 2),
    'new_yes_price', ROUND(v_new_yes_price, 6),
    'new_no_price', ROUND(v_new_no_price, 6),
    'price_impact', ROUND(v_price_impact, 6)
  );
END;
$_$;


ALTER FUNCTION "public"."execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_accounting_amm"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'aggregates', (
      SELECT row_to_json(agg) FROM (
        SELECT
          COALESCE(SUM(a.seed_pnl), 0) as total_seed_pnl,
          COUNT(*) FILTER (WHERE a.seed_pnl >= 0) as markets_in_profit,
          COUNT(*) FILTER (WHERE a.seed_pnl < 0) as markets_in_loss,
          COALESCE(SUM(a.total_volume), 0) as total_volume,
          SUM(a.total_trades) as total_trades,
          COALESCE(SUM(CASE WHEN a.seed_pnl >= 0 THEN a.seed_pnl ELSE 0 END), 0) as total_gains,
          COALESCE(SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END), 0) as total_losses
        FROM amm_state a
        JOIN markets m ON m.id = a.market_id
        WHERE m.status = 'resolved'
          AND m.resolved_at BETWEEN p_start_date AND p_end_date
      ) agg
    ),
    'markets', (
      SELECT COALESCE(jsonb_agg(row_to_json(mk) ORDER BY mk.seed_pnl DESC), '[]'::jsonb)
      FROM (
        SELECT
          a.market_id,
          m.question_en,
          m.outcome,
          m.resolved_at,
          a.seed_pnl,
          a.total_volume,
          a.total_trades,
          a.liquidity_param
        FROM amm_state a
        JOIN markets m ON m.id = a.market_id
        WHERE m.status = 'resolved'
          AND m.resolved_at BETWEEN p_start_date AND p_end_date
        ORDER BY a.seed_pnl DESC
      ) mk
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_accounting_amm"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_accounting_branches"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(br.total_revenue), 0) as total_branch_revenue,
          COALESCE(SUM(br.markup_revenue), 0) as total_markup_revenue,
          COALESCE(SUM(br.explicit_fee_revenue), 0) as total_explicit_fee_revenue,
          COALESCE(SUM(br.exit_fee_revenue), 0) as total_exit_fee_revenue,
          COALESCE(SUM(br.resolution_fee_revenue), 0) as total_resolution_fee_revenue,
          COALESCE(SUM(br.sooq_fee_revenue), 0) as total_sooq_fee_revenue,
          COALESCE((
            SELECT SUM(ba.cumulative_pl)
            FROM branch_agents ba
            WHERE ba.is_active = true
          ), 0) as total_agent_payouts
        FROM branch_revenue br
        WHERE br.created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'branches', (
      SELECT COALESCE(jsonb_agg(row_to_json(b) ORDER BY b.total_revenue DESC), '[]'::jsonb)
      FROM (
        SELECT
          br_agg.branch_id,
          bch.name as branch_name,
          bch.branch_code as branch_code,
          bch.status as branch_status,
          bch.branch_fee_rate,
          br_agg.markup_revenue,
          br_agg.explicit_fee_revenue,
          br_agg.exit_fee_revenue,
          br_agg.resolution_fee_revenue,
          br_agg.sooq_fee_revenue,
          br_agg.total_revenue,
          COALESCE(agent_agg.agent_payouts, 0) as agent_payouts,
          br_agg.sooq_fee_revenue + (br_agg.total_revenue - COALESCE(agent_agg.agent_payouts, 0)) as net_to_platform,
          COALESCE(agent_agg.agent_count, 0) as agent_count
        FROM (
          SELECT
            br.branch_id,
            SUM(br.markup_revenue) as markup_revenue,
            SUM(br.explicit_fee_revenue) as explicit_fee_revenue,
            SUM(br.exit_fee_revenue) as exit_fee_revenue,
            SUM(br.resolution_fee_revenue) as resolution_fee_revenue,
            SUM(br.sooq_fee_revenue) as sooq_fee_revenue,
            SUM(br.total_revenue) as total_revenue
          FROM branch_revenue br
          WHERE br.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY br.branch_id
        ) br_agg
        JOIN branches bch ON bch.id = br_agg.branch_id
        LEFT JOIN (
          SELECT
            ba.branch_id,
            SUM(ba.cumulative_pl) as agent_payouts,
            COUNT(*) as agent_count
          FROM branch_agents ba
          WHERE ba.is_active = true
          GROUP BY ba.branch_id
        ) agent_agg ON agent_agg.branch_id = br_agg.branch_id
      ) b
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_accounting_branches"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_accounting_commissions"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'by_status', (
      SELECT COALESCE(jsonb_agg(row_to_json(s)), '[]'::jsonb)
      FROM (
        SELECT
          status,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY status
      ) s
    ),
    'by_level', (
      SELECT COALESCE(jsonb_agg(row_to_json(l)), '[]'::jsonb)
      FROM (
        SELECT
          agent_level_at_time as level,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY agent_level_at_time
        ORDER BY agent_level_at_time
      ) l
    ),
    'by_revenue_type', (
      SELECT COALESCE(jsonb_agg(row_to_json(rt)), '[]'::jsonb)
      FROM (
        SELECT
          revenue_type,
          SUM(commission_amount) as total,
          COUNT(*) as count
        FROM referral_commissions
        WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
        GROUP BY revenue_type
      ) rt
    ),
    'top_earners', (
      SELECT COALESCE(jsonb_agg(row_to_json(te)), '[]'::jsonb)
      FROM (
        SELECT
          rc.referrer_id,
          u.display_name,
          u.phone,
          u.agent_level,
          SUM(rc.commission_amount) FILTER (WHERE rc.layer = 1) as layer_1,
          SUM(rc.commission_amount) FILTER (WHERE rc.layer = 2) as layer_2,
          SUM(rc.commission_amount) as total
        FROM referral_commissions rc
        JOIN users u ON u.id = rc.referrer_id
        WHERE rc.status = 'credited' AND rc.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY rc.referrer_id, u.display_name, u.phone, u.agent_level
        ORDER BY total DESC
        LIMIT 50
      ) te
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_accounting_commissions"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_accounting_pnl"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'revenue', (
      SELECT row_to_json(r) FROM (
        SELECT
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE(SUM(dynamic_spread), 0) as dynamic_spread,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0) as trade_revenue,
          COALESCE((
            SELECT SUM(resolution_fee_revenue)
            FROM platform_revenue
            WHERE created_at BETWEEN p_start_date AND p_end_date
          ), 0) as resolution_fees,
          COALESCE((
            SELECT SUM(ABS(amount))
            FROM branch_pools
            WHERE type = 'sooq_branch_fee' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as branch_fee_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((
                SELECT SUM(resolution_fee_revenue)
                FROM platform_revenue
                WHERE created_at BETWEEN p_start_date AND p_end_date
              ), 0)
            + COALESCE((
                SELECT SUM(ABS(amount))
                FROM branch_pools
                WHERE type = 'sooq_branch_fee' AND created_at BETWEEN p_start_date AND p_end_date
              ), 0) as gross_revenue
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) r
    ),
    'costs', (
      SELECT row_to_json(c) FROM (
        SELECT
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(commission_amount)
            FROM referral_commissions
            WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date
          ), 0) as commissions_escrowed,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_losses,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl >= 0 THEN a.seed_pnl ELSE 0 END)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_gains,
          COALESCE((
            SELECT SUM(a.seed_pnl)
            FROM amm_state a
            JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN p_start_date AND p_end_date
          ), 0) as amm_net_pnl
        ) c
    ),
    'previous_period', (
      SELECT row_to_json(pp) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + cash_out_premium + COALESCE(dynamic_spread, 0)), 0)
            + COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN v_prev_start AND p_start_date), 0)
            + COALESCE((SELECT SUM(ABS(amount)) FROM branch_pools WHERE type = 'sooq_branch_fee' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as gross_revenue,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as commissions_credited,
          COALESCE((
            SELECT SUM(CASE WHEN a.seed_pnl < 0 THEN ABS(a.seed_pnl) ELSE 0 END)
            FROM amm_state a JOIN markets m ON m.id = a.market_id
            WHERE m.status = 'resolved' AND m.resolved_at BETWEEN v_prev_start AND p_start_date
          ), 0) as amm_losses
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) pp
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          tr.date,
          tr.revenue,
          COALESCE(rc_agg.commissions, 0) as commissions,
          0 as amm_losses
        FROM (
          SELECT
            t.created_at::date as date,
            COALESCE(SUM(t.explicit_fee + t.amm_spread_cost + t.cash_out_premium + COALESCE(t.dynamic_spread, 0)), 0) as revenue
          FROM trades t
          WHERE t.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY t.created_at::date
        ) tr
        LEFT JOIN (
          SELECT rc.created_at::date as date, SUM(rc.commission_amount) as commissions
          FROM referral_commissions rc
          WHERE rc.status = 'credited' AND rc.created_at BETWEEN p_start_date AND p_end_date
          GROUP BY rc.created_at::date
        ) rc_agg ON rc_agg.date = tr.date
      ) d
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_accounting_pnl"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_admin_sidebar_counts"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_pending_deposits INTEGER;
  v_pending_withdrawals INTEGER;
BEGIN
  SELECT COALESCE(is_admin, false) INTO v_is_admin
  FROM users
  WHERE id = auth.uid();

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_pending_deposits
  FROM deposits
  WHERE status IN ('pending', 'pending_review');

  SELECT COUNT(*) INTO v_pending_withdrawals
  FROM withdrawals
  WHERE status = 'pending';

  RETURN jsonb_build_object(
    'pending_deposits', v_pending_deposits,
    'pending_withdrawals', v_pending_withdrawals,
    'pending_finance', v_pending_deposits + v_pending_withdrawals
  );
END;
$$;


ALTER FUNCTION "public"."get_admin_sidebar_counts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_admin_sidebar_counts"() IS 'Returns pending counts for admin sidebar badges. Admin-only. Called from the admin shell on mount and on Realtime events for deposits/withdrawals. (Migration 301: dropped support_tickets keys when ticket system was removed.)';



CREATE OR REPLACE FUNCTION "public"."get_agent_commission_feed"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_layer_filter" integer DEFAULT NULL::integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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
      ) AS trader_name,
      m.question_en AS market_question,
      t.side AS trade_side,
      t.total_cost AS trade_amount,
      rc.platform_revenue_amount AS platform_revenue,
      rc.commission_amount,
      rc.layer,
      rc.revenue_type,
      rc.status,
      rc.created_at,
      rc.unlock_at
    FROM referral_commissions rc
    JOIN users u ON u.id = rc.trader_id
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
      'trader_name', v_row.trader_name,
      'market_question', v_row.market_question,
      'trade_side', v_row.trade_side,
      'trade_amount', v_row.trade_amount,
      'platform_revenue', v_row.platform_revenue,
      'commission_amount', v_row.commission_amount,
      'layer', v_row.layer,
      'revenue_type', v_row.revenue_type,
      'status', v_row.status,
      'created_at', v_row.created_at,
      'unlock_at', v_row.unlock_at
    );
  END LOOP;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_agent_commission_feed"("p_limit" integer, "p_offset" integer, "p_layer_filter" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agent_network_flat"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_l1_users JSONB;
  v_l1_ids UUID[];
  v_l2_users JSONB;
  v_commissions JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Layer 1: direct referrals (limit 200)
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'display_name', COALESCE(
          split_part(u.display_name, ' ', 1) || ' ' ||
          LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
          u.phone
        ),
        'agent_level', u.agent_level,
        'referral_count', u.direct_referral_count,
        'referred_by', u.referred_by
      ) ORDER BY u.created_at DESC
    ), '[]'::JSONB),
    COALESCE(ARRAY_AGG(u.id), '{}')
  INTO v_l1_users, v_l1_ids
  FROM (
    SELECT * FROM users WHERE referred_by = v_uid ORDER BY created_at DESC LIMIT 200
  ) u;

  -- Layer 2: referrals of L1
  IF array_length(v_l1_ids, 1) > 0 THEN
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'display_name', COALESCE(
            split_part(u.display_name, ' ', 1) || ' ' ||
            LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
            u.phone
          ),
          'agent_level', u.agent_level,
          'referral_count', u.direct_referral_count,
          'referred_by', u.referred_by
        )
      ), '[]'::JSONB)
    INTO v_l2_users
    FROM users u
    WHERE u.referred_by = ANY(v_l1_ids);
  ELSE
    v_l2_users := '[]'::JSONB;
  END IF;

  -- Commissions: one grouped query for all bettors
  SELECT COALESCE(jsonb_object_agg(
    rc.bettor_id::TEXT,
    jsonb_build_object(
      'commission_earned', rc.total_commission,
      'revenue_generated', rc.total_revenue,
      'trade_count', rc.cnt
    )
  ), '{}'::JSONB)
  INTO v_commissions
  FROM (
    SELECT
      bettor_id,
      SUM(commission_amount) AS total_commission,
      SUM(platform_revenue_amount) AS total_revenue,
      COUNT(*) AS cnt
    FROM referral_commissions
    WHERE referrer_id = v_uid AND status = 'credited'
    GROUP BY bettor_id
  ) rc;

  RETURN jsonb_build_object(
    'l1_users', v_l1_users,
    'l2_users', v_l2_users,
    'commissions', v_commissions
  );
END;
$$;


ALTER FUNCTION "public"."get_agent_network_flat"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agent_network_tree"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_result JSONB := '[]'::JSONB;
  v_l1_ids UUID[];
  v_l2_ids UUID[];
  v_l1_users JSONB;
  v_l2_users JSONB;
  v_l3_users JSONB;
  v_commissions JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- ── Step 1: Fetch all 3 layers of users in 3 flat queries ──

  -- Layer 1: direct referrals (limit 100)
  SELECT
    COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', u.id,
        'display_name', COALESCE(
          split_part(u.display_name, ' ', 1) || ' ' ||
          LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
          u.phone
        ),
        'agent_level', u.agent_level,
        'referral_count', u.direct_referral_count,
        'referred_by', u.referred_by
      ) ORDER BY u.created_at DESC
    ), '[]'::JSONB),
    COALESCE(ARRAY_AGG(u.id), '{}')
  INTO v_l1_users, v_l1_ids
  FROM (
    SELECT * FROM users WHERE referred_by = v_uid ORDER BY created_at DESC LIMIT 100
  ) u;

  -- Layer 2: referrals of L1 (limit 50 per L1 parent, done via lateral join)
  IF array_length(v_l1_ids, 1) > 0 THEN
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'display_name', COALESCE(
            split_part(u.display_name, ' ', 1) || ' ' ||
            LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
            u.phone
          ),
          'agent_level', u.agent_level,
          'referral_count', u.direct_referral_count,
          'referred_by', u.referred_by
        )
      ), '[]'::JSONB),
      COALESCE(ARRAY_AGG(u.id), '{}')
    INTO v_l2_users, v_l2_ids
    FROM users u
    WHERE u.referred_by = ANY(v_l1_ids);
  ELSE
    v_l2_users := '[]'::JSONB;
    v_l2_ids := '{}';
  END IF;

  -- Layer 3: referrals of L2 (limit 20 per L2 parent)
  IF array_length(v_l2_ids, 1) > 0 THEN
    SELECT
      COALESCE(jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'display_name', COALESCE(
            split_part(u.display_name, ' ', 1) || ' ' ||
            LEFT(split_part(u.display_name, ' ', 2), 1) || '.',
            u.phone
          ),
          'agent_level', u.agent_level,
          'referral_count', u.direct_referral_count,
          'referred_by', u.referred_by
        )
      ), '[]'::JSONB)
    INTO v_l3_users
    FROM users u
    WHERE u.referred_by = ANY(v_l2_ids);
  ELSE
    v_l3_users := '[]'::JSONB;
  END IF;

  -- ── Step 2: Fetch all commissions in ONE query ──

  SELECT COALESCE(jsonb_object_agg(
    rc.bettor_id::TEXT,
    jsonb_build_object(
      'commission_earned', rc.total_commission,
      'revenue_generated', rc.total_revenue,
      'trade_count', rc.cnt
    )
  ), '{}'::JSONB)
  INTO v_commissions
  FROM (
    SELECT
      bettor_id,
      SUM(commission_amount) AS total_commission,
      SUM(platform_revenue_amount) AS total_revenue,
      COUNT(*) AS cnt
    FROM referral_commissions
    WHERE referrer_id = v_uid AND status = 'credited'
    GROUP BY bettor_id
  ) rc;

  -- ── Step 3: Assemble tree in-memory using jsonb operations ──

  -- Build L3 nodes (leaf nodes, no children)
  -- Build L2 nodes with L3 children attached
  -- Build L1 nodes with L2 children attached

  SELECT COALESCE(jsonb_agg(
    l1_node.val || jsonb_build_object(
      'layer', 1,
      'commission_earned', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'commission_earned',
      'revenue_generated', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'revenue_generated',
      'trade_count', COALESCE(v_commissions->>(l1_node.val->>'id'), '{}')::JSONB->'trade_count',
      'children', (
        SELECT COALESCE(jsonb_agg(
          l2_node.val || jsonb_build_object(
            'layer', 2,
            'commission_earned', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'commission_earned',
            'revenue_generated', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'revenue_generated',
            'trade_count', COALESCE(v_commissions->>(l2_node.val->>'id'), '{}')::JSONB->'trade_count',
            'children', (
              SELECT COALESCE(jsonb_agg(
                l3_node.val || jsonb_build_object(
                  'layer', 3,
                  'commission_earned', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'commission_earned',
                  'revenue_generated', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'revenue_generated',
                  'trade_count', COALESCE(v_commissions->>(l3_node.val->>'id'), '{}')::JSONB->'trade_count',
                  'children', '[]'::JSONB
                )
              ), '[]'::JSONB)
              FROM jsonb_array_elements(v_l3_users) AS l3_node(val)
              WHERE l3_node.val->>'referred_by' = l2_node.val->>'id'
            )
          )
        ), '[]'::JSONB)
        FROM jsonb_array_elements(v_l2_users) AS l2_node(val)
        WHERE l2_node.val->>'referred_by' = l1_node.val->>'id'
      )
    )
  ), '[]'::JSONB)
  INTO v_result
  FROM jsonb_array_elements(v_l1_users) AS l1_node(val);

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."get_agent_network_tree"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agent_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_user RECORD;
  v_total_credited DECIMAL := 0;
  v_total_pending DECIMAL := 0;
  v_total_escrowed DECIMAL := 0;
  v_this_month DECIMAL := 0;
  v_network_size INTEGER := 0;
  v_next_tier_volume DECIMAL := 0;
  v_tier1_ids UUID[];
  v_activation_threshold INTEGER := 5;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_uid;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Commission totals (single query)
  SELECT
    COALESCE(SUM(CASE WHEN status = 'credited' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'escrowed' THEN commission_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'credited'
      AND created_at >= date_trunc('month', now()) THEN commission_amount ELSE 0 END), 0)
  INTO v_total_credited, v_total_escrowed, v_this_month
  FROM referral_commissions
  WHERE referrer_id = v_uid;

  -- Network size: 2 layers only (L3 removed — commission model is 2 layers)
  SELECT ARRAY_AGG(id) INTO v_tier1_ids
  FROM users WHERE referred_by = v_uid;

  IF v_tier1_ids IS NOT NULL THEN
    v_network_size := array_length(v_tier1_ids, 1);

    v_network_size := v_network_size + (
      SELECT COUNT(*)::INTEGER FROM users WHERE referred_by = ANY(v_tier1_ids)
    );
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
    'total_credited', v_total_credited,
    'total_pending', v_total_escrowed,
    'total_escrowed', v_total_escrowed,
    'this_month_credited', v_this_month,
    'network_size', v_network_size,
    'network_volume', v_user.network_volume,
    'agent_level', v_user.agent_level,
    'next_tier_volume', v_next_tier_volume,
    'agent_balance_usd', v_user.agent_balance_usd,
    'agent_activated', (v_user.agent_activated OR v_user.agent_activation_override),
    'qualified_referral_count', v_user.qualified_referral_count,
    'activation_threshold', v_activation_threshold
  );
END;
$$;


ALTER FUNCTION "public"."get_agent_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_agent_wallet_summary"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_total DECIMAL;
  v_pending DECIMAL;
  v_available DECIMAL;
  v_next_unlock TIMESTAMPTZ;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT COALESCE(agent_balance_usd, 0) INTO v_total
  FROM users WHERE id = v_uid;

  SELECT COALESCE(SUM(commission_amount), 0), MIN(unlock_at)
  INTO v_pending, v_next_unlock
  FROM referral_commissions
  WHERE referrer_id = v_uid
    AND status = 'credited'
    AND unlock_at IS NOT NULL
    AND unlock_at > NOW();

  v_available := GREATEST(v_total - v_pending, 0);

  RETURN jsonb_build_object(
    'total', v_total,
    'available', v_available,
    'pending', v_pending,
    'next_unlock_at', v_next_unlock
  );
END;
$$;


ALTER FUNCTION "public"."get_agent_wallet_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_amm_price"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_amm RECORD;
BEGIN
  SELECT current_yes_price, current_no_price, total_volume, total_trades
  INTO v_amm
  FROM amm_state WHERE market_id = p_market_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMM not found for market %', p_market_id;
  END IF;

  RETURN jsonb_build_object(
    'yes_price', v_amm.current_yes_price,
    'no_price', v_amm.current_no_price,
    'volume', v_amm.total_volume,
    'trades', v_amm.total_trades
  );
END;
$$;


ALTER FUNCTION "public"."get_amm_price"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_amm_risk_snapshot"() RETURNS TABLE("section" "text", "market_id" "uuid", "market_name" "text", "market_status" "public"."market_status", "liquidity_param" numeric, "q_yes" numeric, "q_no" numeric, "imbalance" numeric, "cash_in" numeric, "worst_case_payout" numeric, "net_exposure" numeric, "theoretical_max_loss" numeric, "is_red_flag" boolean)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
#variable_conflict use_column
DECLARE
  v_fee_rate NUMERIC;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid()
      AND u.is_admin = TRUE
      AND (u.admin_allowed_views IS NULL OR 'amm' = ANY(u.admin_allowed_views))
  ) THEN
    RAISE EXCEPTION 'Not authorized: admin with amm view required';
  END IF;

  v_fee_rate := COALESCE(
    (SELECT fc.rate FROM fee_config fc WHERE fc.fee_type = 'resolution_fee' LIMIT 1),
    0.01
  );

  RETURN QUERY
  WITH per_market AS (
    SELECT
      'per_market'::TEXT AS section,
      m.id AS market_id,
      m.question_en AS market_name,
      m.status AS market_status,
      a.liquidity_param,
      a.retail_shares_yes AS q_yes,
      a.retail_shares_no  AS q_no,
      CASE
        WHEN (a.retail_shares_yes + a.retail_shares_no) = 0 THEN 0::DECIMAL(10,6)
        ELSE ROUND((ABS(a.retail_shares_yes - a.retail_shares_no) / (a.retail_shares_yes + a.retail_shares_no))::NUMERIC, 6)::DECIMAL(10,6)
      END AS imbalance,
      a.retail_net_cash::DECIMAL(18,2) AS cash_in,
      (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate))::DECIMAL(18,2) AS worst_case_payout,
      (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate) - a.retail_net_cash)::DECIMAL(18,2) AS net_exposure,
      (a.liquidity_param * LN(2))::DECIMAL(18,2) AS theoretical_max_loss,
      (
        (GREATEST(a.retail_shares_yes, a.retail_shares_no) * (1 - v_fee_rate) - a.retail_net_cash) > 500
        OR (
          CASE WHEN (a.retail_shares_yes + a.retail_shares_no) = 0 THEN 0
               ELSE ABS(a.retail_shares_yes - a.retail_shares_no) / (a.retail_shares_yes + a.retail_shares_no) END
        ) > 0.8
      ) AS is_red_flag,
      1::INT AS _sort_key
    FROM amm_state a INNER JOIN markets m ON m.id = a.market_id
    WHERE m.status IN ('open', 'closed')
  ),
  aggregate_row AS (
    SELECT
      'aggregate'::TEXT AS section,
      NULL::UUID        AS market_id,
      NULL::TEXT        AS market_name,
      NULL::market_status AS market_status,
      NULL::DECIMAL(18,6) AS liquidity_param,
      COALESCE(SUM(pm.q_yes), 0)::DECIMAL(18,6) AS q_yes,
      COALESCE(SUM(pm.q_no),  0)::DECIMAL(18,6) AS q_no,
      0::DECIMAL(10,6) AS imbalance,
      COALESCE(SUM(pm.cash_in),           0)::DECIMAL(18,2) AS cash_in,
      COALESCE(SUM(pm.worst_case_payout), 0)::DECIMAL(18,2) AS worst_case_payout,
      COALESCE(SUM(pm.net_exposure),      0)::DECIMAL(18,2) AS net_exposure,
      COALESCE(SUM(pm.theoretical_max_loss), 0)::DECIMAL(18,2) AS theoretical_max_loss,
      (COALESCE(SUM(pm.net_exposure), 0) > 0) AS is_red_flag,
      0::INT AS _sort_key
    FROM per_market pm
  ),
  combined AS (
    SELECT * FROM aggregate_row
    UNION ALL
    SELECT * FROM per_market
  )
  SELECT
    c.section, c.market_id, c.market_name, c.market_status, c.liquidity_param,
    c.q_yes, c.q_no, c.imbalance, c.cash_in, c.worst_case_payout,
    c.net_exposure, c.theoretical_max_loss, c.is_red_flag
  FROM combined c
  ORDER BY c._sort_key, c.net_exposure DESC NULLS LAST;
END;
$$;


ALTER FUNCTION "public"."get_amm_risk_snapshot"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_amm_risk_snapshot"() IS 'Admin-only (via admin_allowed_views amm gate) forward-looking risk snapshot for the retail LMSR AMM. Returns 1 aggregate row + N per-market rows. cash_in from amm_state.retail_net_cash; shares from amm_state.retail_shares_yes/no. Excludes branch trades and fees already routed to platform_revenue. Red-flag thresholds: net_exposure > $500 OR imbalance > 0.8.';



CREATE OR REPLACE FUNCTION "public"."get_branch_owner_summary"("p_branch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_pending_total DECIMAL;
  v_next_unlock TIMESTAMPTZ;
  v_effective DECIMAL;
  v_solvency_status TEXT;
  v_agents JSONB;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  SELECT COALESCE(SUM(pending_amount), 0), MIN(next_unlock_at)
  INTO v_pending_total, v_next_unlock
  FROM branch_pending_liabilities
  WHERE branch_id = p_branch_id;

  v_effective := v_branch.pool_balance - v_branch.worst_case_total - v_pending_total;

  v_solvency_status := CASE
    WHEN v_branch.status = 'payback' THEN 'payback_mode'
    WHEN v_effective < 0 THEN 'warning'
    WHEN v_branch.pool_balance < v_branch.worst_case_total THEN 'warning'
    ELSE 'healthy'
  END;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ba.id,
    'user_id', ba.user_id,
    'display_name', u.display_name,
    'agent_type', ba.agent_type,
    'rate', ba.rate,
    'status', ba.status,
    'is_active', ba.is_active,
    'approved_at', ba.approved_at,
    'cumulative_pl', ba.cumulative_pl,
    'created_at', ba.created_at,
    'pending_liability', COALESCE(bpl.pending_amount, 0),
    'next_unlock_at', bpl.next_unlock_at
  )), '[]'::jsonb) INTO v_agents
  FROM branch_agents ba
  JOIN users u ON u.id = ba.user_id
  LEFT JOIN branch_pending_liabilities bpl
    ON bpl.agent_user_id = ba.user_id AND bpl.branch_id = ba.branch_id
  WHERE ba.branch_id = p_branch_id;

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'pool_balance', v_branch.pool_balance,
    'worst_case_total', v_branch.worst_case_total,
    'pending_payouts', v_branch.pending_payouts,
    'pending_liabilities', v_pending_total,
    'effective_pool', v_effective,
    'solvency_status', v_solvency_status,
    'next_unlock_at', v_next_unlock,
    'agents', v_agents
  );
END;
$$;


ALTER FUNCTION "public"."get_branch_owner_summary"("p_branch_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cash_out_value"("p_market_id" "uuid", "p_side" "text", "p_shares" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_amm RECORD;
  v_old_cost DECIMAL;
  v_new_cost DECIMAL;
  v_gross_proceeds DECIMAL;
  v_explicit_fee_rate DECIMAL;
  v_cash_out_rate DECIMAL;
  v_explicit_fee DECIMAL;
  v_cash_out_premium DECIMAL;
  v_net_proceeds DECIMAL;
  v_price_per_share DECIMAL;
BEGIN
  IF p_shares <= 0 THEN
    RAISE EXCEPTION 'Shares must be positive';
  END IF;

  IF p_side NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Side must be yes or no';
  END IF;

  SELECT * INTO v_amm FROM amm_state WHERE market_id = p_market_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'AMM not found for market %', p_market_id;
  END IF;

  -- Validate shares don't exceed current q
  IF p_side = 'yes' AND p_shares > v_amm.q_yes THEN
    RAISE EXCEPTION 'Cannot sell more shares than exist in the AMM';
  END IF;
  IF p_side = 'no' AND p_shares > v_amm.q_no THEN
    RAISE EXCEPTION 'Cannot sell more shares than exist in the AMM';
  END IF;

  -- Calculate LMSR sell proceeds: cost(old_q) - cost(new_q)
  v_old_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes, v_amm.q_no);

  IF p_side = 'yes' THEN
    v_new_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes - p_shares, v_amm.q_no);
  ELSE
    v_new_cost := lmsr_cost(v_amm.liquidity_param, v_amm.q_yes, v_amm.q_no - p_shares);
  END IF;

  v_gross_proceeds := v_old_cost - v_new_cost;

  -- Read fee rates from fee_config
  SELECT rate INTO v_explicit_fee_rate FROM fee_config WHERE fee_type = 'explicit_fee' LIMIT 1;
  SELECT rate INTO v_cash_out_rate FROM fee_config WHERE fee_type = 'cash_out_premium' LIMIT 1;

  v_explicit_fee := v_gross_proceeds * COALESCE(v_explicit_fee_rate, 0.005);
  v_cash_out_premium := v_gross_proceeds * COALESCE(v_cash_out_rate, 0.005);
  v_net_proceeds := v_gross_proceeds - v_explicit_fee - v_cash_out_premium;
  v_price_per_share := v_gross_proceeds / p_shares;

  RETURN jsonb_build_object(
    'gross_proceeds', ROUND(v_gross_proceeds, 6),
    'explicit_fee', ROUND(v_explicit_fee, 6),
    'cash_out_premium', ROUND(v_cash_out_premium, 6),
    'net_proceeds', ROUND(v_net_proceeds, 6),
    'price_per_share', ROUND(v_price_per_share, 6)
  );
END;
$$;


ALTER FUNCTION "public"."get_cash_out_value"("p_market_id" "uuid", "p_side" "text", "p_shares" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_demo_conversion_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_stats JSONB;
  v_total_enabled INTEGER;
  v_total_traded  INTEGER;
  v_total_deposited INTEGER;
  v_median_hours DECIMAL;
  v_cohort_7d_enabled  INTEGER;
  v_cohort_7d_deposited INTEGER;
  v_cohort_30d_enabled INTEGER;
  v_cohort_30d_deposited INTEGER;
BEGIN
  PERFORM _demo_assert_admin();

  SELECT COUNT(*) INTO v_total_enabled
  FROM users WHERE demo_first_enabled_at IS NOT NULL;

  SELECT COUNT(*) INTO v_total_traded
  FROM users WHERE demo_first_trade_at IS NOT NULL;

  SELECT COUNT(*) INTO v_total_deposited
  FROM users WHERE first_real_deposit_after_demo_at IS NOT NULL;

  SELECT ROUND(
    EXTRACT(EPOCH FROM percentile_cont(0.5) WITHIN GROUP (
      ORDER BY first_real_deposit_after_demo_at - demo_first_enabled_at
    )) / 3600.0, 2
  ) INTO v_median_hours
  FROM users
  WHERE demo_first_enabled_at IS NOT NULL
    AND first_real_deposit_after_demo_at IS NOT NULL;

  SELECT
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '7 days'),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '7 days' AND first_real_deposit_after_demo_at IS NOT NULL),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '30 days'),
    COUNT(*) FILTER (WHERE demo_first_enabled_at IS NOT NULL AND demo_first_enabled_at >= now() - INTERVAL '30 days' AND first_real_deposit_after_demo_at IS NOT NULL)
  INTO v_cohort_7d_enabled, v_cohort_7d_deposited, v_cohort_30d_enabled, v_cohort_30d_deposited
  FROM users;

  v_stats := jsonb_build_object(
    'total_enabled', v_total_enabled,
    'total_traded', v_total_traded,
    'total_deposited_after_demo', v_total_deposited,
    'trade_rate', CASE WHEN v_total_enabled > 0
      THEN ROUND(v_total_traded::DECIMAL / v_total_enabled * 100, 2) ELSE 0 END,
    'deposit_rate', CASE WHEN v_total_enabled > 0
      THEN ROUND(v_total_deposited::DECIMAL / v_total_enabled * 100, 2) ELSE 0 END,
    'median_hours_to_deposit', COALESCE(v_median_hours, 0),
    'cohort_7d', jsonb_build_object(
      'enabled', v_cohort_7d_enabled,
      'deposited', v_cohort_7d_deposited,
      'conversion_rate', CASE WHEN v_cohort_7d_enabled > 0
        THEN ROUND(v_cohort_7d_deposited::DECIMAL / v_cohort_7d_enabled * 100, 2) ELSE 0 END
    ),
    'cohort_30d', jsonb_build_object(
      'enabled', v_cohort_30d_enabled,
      'deposited', v_cohort_30d_deposited,
      'conversion_rate', CASE WHEN v_cohort_30d_enabled > 0
        THEN ROUND(v_cohort_30d_deposited::DECIMAL / v_cohort_30d_enabled * 100, 2) ELSE 0 END
    )
  );

  RETURN v_stats;
END;
$$;


ALTER FUNCTION "public"."get_demo_conversion_stats"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_platform_stats"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'daily_volume', (
      SELECT COALESCE(jsonb_agg(row_to_json(d)), '[]'::jsonb)
      FROM (
        SELECT date_trunc('day', created_at)::date as date,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as volume,
               COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as trades,
               COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as deposits,
               COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as withdrawals,
               COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as active_users
        FROM transactions
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY date_trunc('day', created_at)::date
        ORDER BY date
      ) d
    ),
    'totals', (
      SELECT row_to_json(t)
      FROM (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as total_deposits,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as total_withdrawals,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as unique_traders
        FROM transactions
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t)
      FROM (
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE type = 'deposit'), 0) as total_deposits,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type = 'withdrawal'), 0) as total_withdrawals,
          COALESCE(SUM(ABS(amount)) FILTER (WHERE type IN ('trade', 'close_position')), 0) as total_volume,
          COUNT(*) FILTER (WHERE type IN ('trade', 'close_position')) as total_trades,
          COUNT(DISTINCT user_id) FILTER (WHERE type IN ('trade', 'close_position')) as unique_traders
        FROM transactions
        WHERE created_at BETWEEN
          p_start_date - (p_end_date - p_start_date)
          AND p_start_date
      ) t
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_platform_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_price_history"("p_market_id" "uuid", "p_period" "text" DEFAULT '1D'::"text", "p_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS TABLE("bucket_time" timestamp with time zone, "yes_price" numeric, "no_price" numeric)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    AS $$
DECLARE
  v_start    TIMESTAMPTZ;
  v_end      TIMESTAMPTZ := NOW();
  v_interval INTERVAL;
  v_first_trade TIMESTAMPTZ;
  -- LMSR initial price is always 0.5 when q_yes = q_no = 0
  v_initial_yes DECIMAL := 0.5;
  v_initial_no  DECIMAL := 0.5;
BEGIN
  -- Find the first trade time for this market
  SELECT MIN(t.created_at) INTO v_first_trade
  FROM trades t WHERE t.market_id = p_market_id;

  -- Determine time range and bucket interval based on period
  CASE p_period
    WHEN '1H'  THEN v_start := v_end - INTERVAL '1 hour';    v_interval := INTERVAL '30 seconds';
    WHEN '6H'  THEN v_start := v_end - INTERVAL '6 hours';   v_interval := INTERVAL '2 minutes';
    WHEN '12H' THEN v_start := v_end - INTERVAL '12 hours';  v_interval := INTERVAL '3 minutes';
    WHEN '1D'  THEN v_start := v_end - INTERVAL '1 day';     v_interval := INTERVAL '5 minutes';
    WHEN '1W'  THEN v_start := v_end - INTERVAL '7 days';    v_interval := INTERVAL '30 minutes';
    WHEN '1M'  THEN v_start := v_end - INTERVAL '30 days';   v_interval := INTERVAL '2 hours';
    WHEN 'ALL' THEN
      -- Start from market creation date to show full lifetime
      v_start := COALESCE(p_created_at, v_end - INTERVAL '30 days');
      v_interval := GREATEST(
        (v_end - v_start) / 500,
        INTERVAL '1 minute'
      );
    ELSE
      v_start := v_end - INTERVAL '1 day'; v_interval := INTERVAL '5 minutes';
  END CASE;

  -- For fixed time periods (1H, 12H, 1D, 1W, 1M), if the first trade
  -- happened after the period start, shift start forward to avoid dead space.
  -- Keep a small buffer (10% of period) before the first trade for context.
  IF p_period != 'ALL' AND v_first_trade IS NOT NULL THEN
    DECLARE
      v_period_duration INTERVAL;
      v_buffer INTERVAL;
    BEGIN
      v_period_duration := v_end - v_start;
      v_buffer := v_period_duration * 0.1;  -- 10% buffer
      -- Only shift if first trade is more than 50% into the period
      IF v_first_trade > v_start + v_period_duration * 0.5 THEN
        v_start := v_first_trade - v_buffer;
      END IF;
    END;
  END IF;

  -- Generate time buckets and find the most recent trade price at or before each bucket.
  -- Uses post_yes_price/post_no_price (post-trade marginal price) when available,
  -- falls back to price_per_share derivation for pre-migration trades.
  -- Pre-trade buckets fall back to 0.5 (LMSR initial price).
  RETURN QUERY
  SELECT
    gs.bucket AS bucket_time,
    COALESCE(t.y_price, v_initial_yes) AS yes_price,
    COALESCE(t.n_price, v_initial_no) AS no_price
  FROM generate_series(v_start, v_end, v_interval) AS gs(bucket)
  LEFT JOIN LATERAL (
    SELECT
      COALESCE(tr.post_yes_price,
        CASE WHEN tr.side::text = 'yes' THEN tr.price_per_share
             ELSE 1 - tr.price_per_share END) AS y_price,
      COALESCE(tr.post_no_price,
        CASE WHEN tr.side::text = 'yes' THEN 1 - tr.price_per_share
             ELSE tr.price_per_share END) AS n_price
    FROM trades tr
    WHERE tr.market_id = p_market_id
      AND tr.created_at <= gs.bucket
    ORDER BY tr.created_at DESC
    LIMIT 1
  ) t ON TRUE
  ORDER BY gs.bucket;
END;
$$;


ALTER FUNCTION "public"."get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'period_start', p_start_date,
    'period_end',   p_end_date,
    'revenue', (
      SELECT jsonb_build_object(
        'handle_fees',     COALESCE(SUM(handle_fee), 0),
        'spread_revenue',  COALESCE(SUM(amount * (offered_prob - fair_prob)), 0),
        'gross_revenue',   COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN p_start_date AND p_end_date
    ),
    'costs', (
      SELECT jsonb_build_object(
        'speed_payouts', COALESCE((
          SELECT -SUM(amount) FROM speed_pool_ledger
          WHERE type IN ('winning_payout', 'cashout_out', 'refund')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'speed_commissions_paid', COALESCE((
          SELECT SUM(commission_amount) FROM referral_commissions
          WHERE status = 'credited'
            AND source_type IN ('speed_trade', 'speed_resolution')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'branch_fee_share_paid', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger
          WHERE type = 'fee_share_in'
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0)
      )
    ),
    'previous_period_revenue', (
      SELECT jsonb_build_object(
        'gross_revenue', COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN v_prev_start AND p_start_date
    ),
    'per_branch', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'branch_id', t.branch_id,
        'branch_name', COALESCE(t.branch_name, 'SOOQ Main'),
        'gross_revenue', t.gross_revenue,
        'gross_stake', t.gross_stake,
        'pool_p_and_l', t.pool_p_and_l
      ) ORDER BY t.gross_revenue DESC), '[]'::jsonb)
      FROM (
        SELECT
          t.branch_id,
          b.name AS branch_name,
          SUM(t.handle_fee + (t.amount * (t.offered_prob - t.fair_prob))) AS gross_revenue,
          SUM(t.amount) AS gross_stake,
          COALESCE((
            SELECT SUM(amount) FROM speed_pool_ledger l
            WHERE l.branch_id IS NOT DISTINCT FROM t.branch_id
              AND l.created_at BETWEEN p_start_date AND p_end_date
          ), 0) AS pool_p_and_l
        FROM speed_trades t
        LEFT JOIN branches b ON b.id = t.branch_id
        WHERE t.kind = 'open'
          AND t.created_at BETWEEN p_start_date AND p_end_date
        GROUP BY t.branch_id, b.name
      ) t
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) IS 'Speed-market accounting summary for /admin/accounting. Per-branch P&L, period-over-period delta, costs breakdown. Frontend merges with get_accounting_pnl for combined view.';



CREATE OR REPLACE FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer DEFAULT 200) RETURNS TABLE("bucket_time" timestamp with time zone, "o" numeric, "h" numeric, "l" numeric, "c" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
  v_total_secs DOUBLE PRECISION;
BEGIN
  IF p_max_buckets < 10 THEN p_max_buckets := 10; END IF;
  IF p_to <= p_from THEN
    RETURN;
  END IF;

  v_total_secs := EXTRACT(EPOCH FROM (p_to - p_from));
  v_bucket_secs := GREATEST(1, v_total_secs / p_max_buckets);

  -- Fast path: window fits within max_buckets at 1s granularity → return raw klines
  IF v_bucket_secs <= 1 THEN
    RETURN QUERY
    SELECT
      k.ts AS bucket_time,
      k.open_price::DECIMAL AS o,
      k.high_price::DECIMAL AS h,
      k.low_price::DECIMAL AS l,
      k.close_price::DECIMAL AS c
    FROM speed_oracle_klines k
    WHERE k.asset = p_asset
      AND k.ts >= p_from
      AND k.ts <= p_to
    ORDER BY k.ts;
    RETURN;
  END IF;

  -- Slow path: aggregate multiple klines per bucket. Same OHLC semantics
  -- as the synthesis RPCs but starting from already-aggregated 1s candles.
  RETURN QUERY
  WITH klines AS (
    SELECT
      k.ts,
      k.open_price,
      k.high_price,
      k.low_price,
      k.close_price,
      (to_timestamp(
        floor(EXTRACT(EPOCH FROM k.ts) / v_bucket_secs) * v_bucket_secs
      ))::TIMESTAMPTZ AS bkt
    FROM speed_oracle_klines k
    WHERE k.asset = p_asset
      AND k.ts >= p_from
      AND k.ts <= p_to
  ),
  bucketed AS (
    SELECT
      bkt,
      FIRST_VALUE(open_price) OVER w  AS open_b,
      LAST_VALUE(close_price) OVER w  AS close_b,
      MAX(high_price) OVER (PARTITION BY bkt) AS high_b,
      MIN(low_price)  OVER (PARTITION BY bkt) AS low_b,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts) AS rn
    FROM klines
    WINDOW w AS (
      PARTITION BY bkt
      ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT
    bkt AS bucket_time,
    open_b::DECIMAL AS o,
    high_b::DECIMAL AS h,
    low_b::DECIMAL  AS l,
    close_b::DECIMAL AS c
  FROM bucketed
  WHERE rn = 1
  ORDER BY bkt;
END;
$$;


ALTER FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) IS 'Returns OHLC candles for chart rendering. Sub-minute windows return raw 1s klines as-is; longer windows aggregate. Settlement still uses speed_oracle_ticks via speed_resolve_market.';



CREATE OR REPLACE FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer DEFAULT 500) RETURNS TABLE("ts" timestamp with time zone, "price" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
BEGIN
  IF p_max_points < 10 THEN p_max_points := 10; END IF;
  IF p_to <= p_from THEN
    RETURN; -- empty result
  END IF;

  v_bucket_secs := GREATEST(1, EXTRACT(EPOCH FROM (p_to - p_from)) / p_max_points);

  RETURN QUERY
  SELECT
    (to_timestamp(
      floor(EXTRACT(EPOCH FROM t.ts) / v_bucket_secs) * v_bucket_secs
    ))::TIMESTAMPTZ AS ts,
    AVG(t.price)::DECIMAL AS price
  FROM speed_oracle_ticks t
  WHERE t.asset = p_asset
    AND t.ts >= p_from
    AND t.ts <= p_to
  GROUP BY 1
  ORDER BY 1;
END;
$$;


ALTER FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer) IS 'Returns time-bucketed AVG price for a speed asset between p_from and p_to. ≤ p_max_points buckets. Used by SpeedPriceChart on /speed/[id].';



CREATE OR REPLACE FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer DEFAULT 200) RETURNS TABLE("bucket_time" timestamp with time zone, "o" numeric, "h" numeric, "l" numeric, "c" numeric)
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_bucket_secs DOUBLE PRECISION;
BEGIN
  IF p_max_buckets < 10 THEN p_max_buckets := 10; END IF;
  IF p_to <= p_from THEN
    RETURN;
  END IF;

  v_bucket_secs := GREATEST(1, EXTRACT(EPOCH FROM (p_to - p_from)) / p_max_buckets);

  RETURN QUERY
  WITH ticks AS (
    SELECT
      t.ts,
      t.price,
      (to_timestamp(
        floor(EXTRACT(EPOCH FROM t.ts) / v_bucket_secs) * v_bucket_secs
      ))::TIMESTAMPTZ AS bkt
    FROM speed_oracle_ticks t
    WHERE t.asset = p_asset
      AND t.ts >= p_from
      AND t.ts <= p_to
  ),
  bucketed AS (
    SELECT
      bkt,
      FIRST_VALUE(price) OVER w AS open_p,
      LAST_VALUE(price)  OVER w AS close_p,
      MAX(price) OVER (PARTITION BY bkt) AS high_p,
      MIN(price) OVER (PARTITION BY bkt) AS low_p,
      ROW_NUMBER() OVER (PARTITION BY bkt ORDER BY ts) AS rn
    FROM ticks
    WINDOW w AS (
      PARTITION BY bkt
      ORDER BY ts
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    )
  )
  SELECT
    bkt AS bucket_time,
    open_p::DECIMAL AS o,
    high_p::DECIMAL AS h,
    low_p::DECIMAL AS l,
    close_p::DECIMAL AS c
  FROM bucketed
  WHERE rn = 1
  ORDER BY bkt;
END;
$$;


ALTER FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) IS 'Returns OHLC candles for a speed asset, time-bucketed. Output columns named to avoid PL/pgSQL ambiguity with speed_oracle_ticks.ts. Used by SpeedPriceChart on /speed/[id].';



CREATE OR REPLACE FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  RETURN jsonb_build_object(
    'period_start', p_start_date,
    'period_end',   p_end_date,
    'revenue', (
      SELECT jsonb_build_object(
        'handle_fees',     COALESCE(SUM(handle_fee), 0),
        'spread_revenue',  COALESCE(SUM(amount * (offered_prob - fair_prob)), 0),
        'gross_revenue',   COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0),
        'gross_stake',     COALESCE(SUM(amount), 0),
        'effective_edge_pct', CASE
          WHEN COALESCE(SUM(amount), 0) > 0
          THEN ROUND((SUM(handle_fee + (amount * (offered_prob - fair_prob))) / SUM(amount) * 100)::numeric, 2)
          ELSE 0
        END,
        'trade_count', COUNT(*)
      )
      FROM speed_trades
      WHERE kind = 'open'
        AND created_at BETWEEN p_start_date AND p_end_date
    ),
    'trading', (
      SELECT jsonb_build_object(
        'open_trades',     COALESCE(COUNT(*) FILTER (WHERE kind = 'open'), 0),
        'cashout_trades',  COALESCE(COUNT(*) FILTER (WHERE kind = 'cashout'), 0),
        'unique_traders',  COUNT(DISTINCT user_id),
        'total_volume',    COALESCE(SUM(amount), 0)
      )
      FROM speed_trades
      WHERE created_at BETWEEN p_start_date AND p_end_date
    ),
    'finance', (
      SELECT jsonb_build_object(
        'main_pool_balance', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger WHERE branch_id IS NULL
        ), 0),
        'branch_pools_total', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger WHERE branch_id IS NOT NULL
        ), 0),
        'gross_payouts', COALESCE((
          SELECT -SUM(amount) FROM speed_pool_ledger
          WHERE type IN ('winning_payout', 'cashout_out', 'refund')
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0),
        'gross_stakes_in', COALESCE((
          SELECT SUM(amount) FROM speed_pool_ledger
          WHERE type = 'stake_in'
            AND created_at BETWEEN p_start_date AND p_end_date
        ), 0)
      )
    ),
    'markets', (
      SELECT jsonb_build_object(
        'open_markets',      COUNT(*) FILTER (WHERE status = 'open'),
        'resolved_markets',  COUNT(*) FILTER (WHERE status = 'resolved' AND resolved_at BETWEEN p_start_date AND p_end_date),
        'voided_markets',    COUNT(*) FILTER (WHERE status = 'voided' AND voided_at BETWEEN p_start_date AND p_end_date)
      )
      FROM speed_markets
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) IS 'Speed-market analog of get_stats_revenue/trading/finance/markets, returned in one call. Frontend /admin/stats/* pages merge with the prediction-side RPC for combined view.';



CREATE OR REPLACE FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_row     RECORD;
  v_floor   DECIMAL;
BEGIN
  SELECT rv, computed_at INTO v_row
  FROM speed_realized_vol_cache
  WHERE asset = p_asset;

  IF FOUND AND v_row.computed_at > NOW() - INTERVAL '90 seconds' THEN
    RETURN jsonb_build_object('rv', v_row.rv, 'computed_at', v_row.computed_at, 'source', 'cache');
  END IF;

  SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
  RETURN jsonb_build_object('rv', COALESCE(v_floor, 0.6), 'computed_at', NOW(), 'source', 'fallback');
END;
$$;


ALTER FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") IS 'Mig 352 (Seam 4) + Mig 354: public RPC for client volatility badge. Returns {rv, computed_at, source} as jsonb. source=cache when fresh (<90s); source=fallback when stale/empty.';



CREATE OR REPLACE FUNCTION "public"."get_stats_finance"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as total_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as total_withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as net_flow,
          (SELECT COUNT(*) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date) as deposit_count,
          (SELECT COUNT(*) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date) as withdrawal_count,
          COALESCE((SELECT ROUND(AVG(amount), 2) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as avg_deposit,
          COALESCE((SELECT ROUND(AVG(amount), 2) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN p_start_date AND p_end_date), 0) as avg_withdrawal,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'pending'), 0) as pending_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'pending'), 0) as pending_withdrawals,
          ROUND(
            CASE WHEN (SELECT COUNT(*) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date) = 0 THEN 0
            ELSE (
              SELECT COUNT(DISTINCT d.user_id)::numeric * 100 /
                     NULLIF((SELECT COUNT(DISTINCT user_id) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN p_start_date AND p_end_date), 0)
              FROM deposits d
              WHERE d.status = 'confirmed' AND d.created_at BETWEEN p_start_date AND p_end_date
                AND d.user_id IN (SELECT DISTINCT user_id FROM trades WHERE created_at BETWEEN p_start_date AND p_end_date)
            )
            END, 1
          ) as deposit_to_trade_pct
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as total_deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as total_withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at BETWEEN v_prev_start AND p_start_date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as net_flow
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          gs::date as date,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at::date = gs::date), 0) as deposits,
          COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at::date = gs::date), 0) as withdrawals,
          COALESCE((SELECT SUM(amount) FROM deposits WHERE status = 'confirmed' AND created_at::date = gs::date), 0)
            - COALESCE((SELECT SUM(amount) FROM withdrawals WHERE status = 'approved' AND created_at::date = gs::date), 0) as net_flow
        FROM generate_series(p_start_date::date, p_end_date::date, '1 day'::interval) gs
      ) d
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_finance"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_health"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN jsonb_build_object(
    'amm', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(seed_pnl), 0) AS total_seed_pnl,
          COUNT(*) FILTER (WHERE seed_pnl < 0) AS markets_negative_pnl,
          COALESCE(SUM(liquidity_param), 0) AS total_liquidity
        FROM amm_state
      ) t
    ),
    'system', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) FILTER (WHERE severity = 'error') AS error_count,
          COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count
        FROM system_logs
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'agents', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0) AS total_agents,
          (SELECT COUNT(*) FROM users WHERE direct_referral_count > 0 AND created_at BETWEEN p_start_date AND p_end_date) AS new_agents,
          jsonb_build_object(
            'L1', (SELECT COUNT(*) FROM users WHERE agent_level = 1 AND direct_referral_count > 0),
            'L2', (SELECT COUNT(*) FROM users WHERE agent_level = 2),
            'L3', (SELECT COUNT(*) FROM users WHERE agent_level = 3),
            'L4', (SELECT COUNT(*) FROM users WHERE agent_level = 4)
          ) AS level_distribution,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) AS commissions_credited,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) AS commissions_escrowed
      ) t
    ),
    'engagement', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE((SELECT COUNT(*) FROM market_comments WHERE created_at BETWEEN p_start_date AND p_end_date), 0) AS comments_in_period,
          COALESCE((SELECT COUNT(*) FROM copy_settings WHERE is_active = true), 0) AS active_copy_trades
      ) t
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_health"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_markets"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) as total_markets,
          COUNT(*) FILTER (WHERE status = 'open') as open,
          COUNT(*) FILTER (WHERE status = 'closed') as closed,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved,
          COUNT(*) FILTER (WHERE status = 'voided') as voided,
          COUNT(*) FILTER (WHERE created_at BETWEEN p_start_date AND p_end_date) as created_in_period,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(AVG(trade_count), 1) END as avg_trades_per_market,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(AVG(unique_traders), 1) END as avg_traders_per_market
        FROM markets
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COUNT(*) FILTER (WHERE created_at BETWEEN v_prev_start AND p_start_date) as created_in_period
        FROM markets
      ) t
    ),
    'top_markets', (
      SELECT COALESCE(jsonb_agg(row_to_json(tm)), '[]'::jsonb)
      FROM (
        SELECT m.id as market_id, m.question_en as question,
               a.total_volume as volume, a.total_trades as trades
        FROM markets m
        JOIN amm_state a ON a.market_id = m.id
        WHERE m.status IN ('open', 'closed', 'resolved')
        ORDER BY a.total_volume DESC
        LIMIT 5
      ) tm
    ),
    'categories', (
      SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
      FROM (
        SELECT
          COALESCE(m.category, 'uncategorized') as category,
          COUNT(*) as count,
          COALESCE(SUM(a.total_volume), 0) as volume
        FROM markets m
        LEFT JOIN amm_state a ON a.market_id = m.id
        GROUP BY m.category
        ORDER BY volume DESC
      ) c
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_markets"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_revenue"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as net_revenue,
          COALESCE(SUM(explicit_fee), 0) as explicit_fees,
          COALESCE(SUM(amm_spread_cost), 0) as amm_spread,
          COALESCE(SUM(dynamic_spread), 0) as dynamic_spread,
          COALESCE((SELECT SUM(resolution_fee_revenue) FROM platform_revenue WHERE created_at BETWEEN p_start_date AND p_end_date), 0) as resolution_fees,
          COALESCE(SUM(cash_out_premium), 0) as cash_out_premium,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN p_start_date AND p_end_date), 0) as commissions_paid,
          COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'escrowed' AND created_at BETWEEN p_start_date AND p_end_date), 0) as escrowed_commissions,
          CASE WHEN COUNT(*) = 0 THEN 0
               ELSE ROUND(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium) / COUNT(*), 2)
          END as revenue_per_trade
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as gross_revenue,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0)
            - COALESCE((SELECT SUM(commission_amount) FROM referral_commissions WHERE status = 'credited' AND created_at BETWEEN v_prev_start AND p_start_date), 0) as net_revenue
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          created_at::date as date,
          COALESCE(SUM(explicit_fee), 0) as explicit,
          COALESCE(SUM(amm_spread_cost), 0) as spread,
          COALESCE(SUM(dynamic_spread), 0) as dynamic,
          COALESCE(SUM(cash_out_premium), 0) as cash_out,
          COALESCE(SUM(explicit_fee + amm_spread_cost + dynamic_spread + cash_out_premium), 0) as total
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY created_at::date
        ORDER BY date
      ) d
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_revenue"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_trading"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trade_count,
          CASE WHEN COUNT(*) = 0 THEN 0 ELSE ROUND(SUM(total_cost) / COUNT(*), 2) END as avg_trade_size,
          COUNT(*) FILTER (WHERE direction = 'buy') as buy_count,
          COUNT(*) FILTER (WHERE direction = 'sell') as sell_count,
          COALESCE(SUM(total_cost) FILTER (WHERE direction = 'buy'), 0) as buy_volume,
          COALESCE(SUM(total_cost) FILTER (WHERE direction = 'sell'), 0) as sell_volume,
          COUNT(DISTINCT user_id) as unique_traders,
          COALESCE((SELECT SUM(shares_held) FROM positions WHERE shares_held > 0), 0) as total_shares_outstanding,
          COUNT(*) FILTER (WHERE is_copy_trade = true) as copy_trade_count
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trade_count,
          COUNT(DISTINCT user_id) as unique_traders
        FROM trades
        WHERE created_at BETWEEN v_prev_start AND p_start_date
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          created_at::date as date,
          COALESCE(SUM(total_cost), 0) as volume,
          COUNT(*) as trades,
          COUNT(*) FILTER (WHERE direction = 'buy') as buys,
          COUNT(*) FILTER (WHERE direction = 'sell') as sells
        FROM trades
        WHERE created_at BETWEEN p_start_date AND p_end_date
        GROUP BY created_at::date
        ORDER BY date
      ) d
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_trading"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_stats_users"("p_start_date" timestamp with time zone DEFAULT ("now"() - '30 days'::interval), "p_end_date" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
  v_period_length INTERVAL;
  v_prev_start TIMESTAMPTZ;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  v_period_length := p_end_date - p_start_date;
  v_prev_start := p_start_date - v_period_length;

  RETURN jsonb_build_object(
    'totals', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users) as total_users,
          (SELECT COUNT(*) FROM users WHERE created_at BETWEEN p_start_date AND p_end_date) as new_users,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN p_start_date AND p_end_date) as active_traders,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '1 day') as dau,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '7 days') as wau,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at >= now() - interval '30 days') as mau,
          ROUND(
            CASE WHEN (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date) = 0
            THEN 0
            ELSE (
              SELECT COUNT(DISTINCT t1.user_id)::numeric * 100 /
                     NULLIF((SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date), 0)
              FROM trades t1
              WHERE t1.created_at BETWEEN p_start_date AND p_end_date
                AND t1.user_id IN (SELECT DISTINCT user_id FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date)
            )
            END, 1
          ) as retention_rate
      ) t
    ),
    'previous_period', (
      SELECT row_to_json(t) FROM (
        SELECT
          (SELECT COUNT(*) FROM users WHERE created_at BETWEEN v_prev_start AND p_start_date) as new_users,
          (SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at BETWEEN v_prev_start AND p_start_date) as active_traders
      ) t
    ),
    'daily', (
      SELECT COALESCE(jsonb_agg(row_to_json(d) ORDER BY d.date), '[]'::jsonb)
      FROM (
        SELECT
          gs::date as date,
          COALESCE((SELECT COUNT(*) FROM users WHERE created_at::date = gs::date), 0) as new_users,
          COALESCE((SELECT COUNT(DISTINCT user_id) FROM trades WHERE created_at::date = gs::date), 0) as active_users
        FROM generate_series(p_start_date::date, p_end_date::date, '1 day'::interval) gs
      ) d
    )
  );
END;
$$;


ALTER FUNCTION "public"."get_stats_users"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_referral_signup"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_referrer_chain UUID[];
  v_new_chain UUID[];
  v_referrer_referred_by UUID;
BEGIN
  -- Only fire when referred_by transitions from NULL to a value
  IF OLD.referred_by IS NOT NULL OR NEW.referred_by IS NULL THEN
    RETURN NEW;
  END IF;

  -- Read the referrer's referral_chain and referred_by
  SELECT referral_chain, referred_by INTO v_referrer_chain, v_referrer_referred_by
  FROM users WHERE id = NEW.referred_by;

  -- Circular referral guard: referrer must not be referred by this user
  IF v_referrer_referred_by = NEW.id THEN
    RAISE EXCEPTION 'Circular referral detected';
  END IF;

  -- Circular referral guard: this user must not appear in referrer's ancestor chain
  IF v_referrer_chain IS NOT NULL AND NEW.id = ANY(v_referrer_chain) THEN
    RAISE EXCEPTION 'Circular referral detected';
  END IF;

  -- Set bypass flag so the protect_sensitive_columns trigger allows our updates
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  -- Build new user's chain: [direct referrer, then up to 2 from referrer's chain], max 3
  v_new_chain := ARRAY[NEW.referred_by];
  IF v_referrer_chain IS NOT NULL AND array_length(v_referrer_chain, 1) > 0 THEN
    v_new_chain := v_new_chain || v_referrer_chain[1:LEAST(array_length(v_referrer_chain, 1), 2)];
  END IF;

  -- Update the new user's referral_chain
  UPDATE users SET referral_chain = v_new_chain WHERE id = NEW.id;

  -- Increment the referrer's direct_referral_count
  UPDATE users SET direct_referral_count = direct_referral_count + 1
  WHERE id = NEW.referred_by;

  -- Recalculate the referrer's agent level
  PERFORM update_agent_level(NEW.referred_by);

  -- Reset bypass flag
  PERFORM set_config('app.trigger_bypass', 'false', TRUE);

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_referral_signup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_referral_count"("p_referral_code" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  UPDATE prelaunch_waitlist
  SET referral_count = referral_count + 1
  WHERE referral_code = p_referral_code;
END;
$$;


ALTER FUNCTION "public"."increment_referral_count"("p_referral_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."initialize_amm"("p_market_id" "uuid", "p_liquidity_param" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_b DECIMAL;
  v_market RECORD;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- Admin/service-role check
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'Admin access required';
    END IF;
  END IF;

  -- Read default b from fee_config if not provided
  IF p_liquidity_param IS NULL THEN
    SELECT rate INTO v_b FROM fee_config WHERE fee_type = 'amm_default_b' LIMIT 1;
    IF v_b IS NULL THEN
      v_b := 1000;  -- fallback default
    END IF;
  ELSE
    v_b := p_liquidity_param;
  END IF;

  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  -- Validate market exists
  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  -- Check no AMM already exists
  IF EXISTS (SELECT 1 FROM amm_state WHERE market_id = p_market_id) THEN
    RAISE EXCEPTION 'AMM already initialized for this market';
  END IF;

  -- Calculate initial prices (both 0.50 at q_yes=0, q_no=0)
  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price := lmsr_price(v_b, 0, 0, 'no');

  -- Insert AMM state
  INSERT INTO amm_state (market_id, liquidity_param, q_yes, q_no, current_yes_price, current_no_price)
  VALUES (p_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  -- Store on markets table for quick access
  UPDATE markets SET amm_liquidity_param = v_b WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;


ALTER FUNCTION "public"."initialize_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."initialize_demo_amm"("p_market_id" "uuid", "p_liquidity_param" numeric DEFAULT 5000) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_b DECIMAL;
  v_market RECORD;
  v_yes_price DECIMAL;
  v_no_price DECIMAL;
BEGIN
  -- Allow service_role or admin
  PERFORM _demo_assert_admin();

  v_b := COALESCE(p_liquidity_param, 5000);
  IF v_b <= 0 THEN
    RAISE EXCEPTION 'Liquidity parameter must be positive';
  END IF;

  SELECT * INTO v_market FROM demo_markets WHERE id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found';
  END IF;

  IF EXISTS (SELECT 1 FROM demo_amm_state WHERE market_id = p_market_id) THEN
    RAISE EXCEPTION 'Demo AMM already initialized for this market';
  END IF;

  v_yes_price := lmsr_price(v_b, 0, 0, 'yes');
  v_no_price  := lmsr_price(v_b, 0, 0, 'no');

  INSERT INTO demo_amm_state (market_id, liquidity_param, q_yes, q_no,
                              current_yes_price, current_no_price)
  VALUES (p_market_id, v_b, 0, 0, v_yes_price, v_no_price);

  UPDATE demo_markets SET amm_liquidity_param = v_b WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'liquidity_param', v_b,
    'yes_price', ROUND(v_yes_price, 6),
    'no_price', ROUND(v_no_price, 6)
  );
END;
$$;


ALTER FUNCTION "public"."initialize_demo_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE
  );
$$;


ALTER FUNCTION "public"."is_admin"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_admin"() IS 'Returns TRUE if the current auth.uid() user is_admin. STABLE SECURITY DEFINER so RLS policies can inline it.';



CREATE OR REPLACE FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM branches WHERE id = p_branch_id AND manager_user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") IS 'Returns TRUE if the current auth.uid() user is the manager of the given branch_id. Used by all branch-scoped RLS policies on speed_* tables.';



CREATE OR REPLACE FUNCTION "public"."lmsr_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_max_q DECIMAL;
  v_diff DECIMAL;
BEGIN
  -- Hard cap: prevent overflow
  IF ABS(p_q_yes) > 50 * p_b OR ABS(p_q_no) > 50 * p_b THEN
    RAISE EXCEPTION 'LMSR overflow: q values exceed 50*b (q_yes=%, q_no=%, b=%)',
      ROUND(p_q_yes, 2), ROUND(p_q_no, 2), ROUND(p_b, 2);
  END IF;

  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;

  -- Log-sum-exp trick: ln(e^a + e^b) = max(a,b) + ln(1 + e^(-|a-b|))
  v_max_q := GREATEST(p_q_yes, p_q_no);
  v_diff := ABS(p_q_yes - p_q_no);

  RETURN p_b * (v_max_q / p_b + LN(1.0 + EXP(-v_diff / p_b)));
END;
$$;


ALTER FUNCTION "public"."lmsr_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lmsr_price"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_diff DECIMAL;
  v_exp_val DECIMAL;
BEGIN
  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;

  -- diff = (q_side - q_other) / b
  IF p_side = 'yes' THEN
    v_diff := (p_q_yes - p_q_no) / p_b;
  ELSIF p_side = 'no' THEN
    v_diff := (p_q_no - p_q_yes) / p_b;
  ELSE
    RAISE EXCEPTION 'LMSR: side must be yes or no';
  END IF;

  -- Stable sigmoid: avoid overflow in EXP
  -- If diff >= 0: 1 / (1 + e^(-diff))
  -- If diff < 0: e^(diff) / (1 + e^(diff))
  IF v_diff >= 0 THEN
    RETURN 1.0 / (1.0 + EXP(-v_diff));
  ELSE
    v_exp_val := EXP(v_diff);
    RETURN v_exp_val / (1.0 + v_exp_val);
  END IF;
END;
$$;


ALTER FUNCTION "public"."lmsr_price"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lmsr_shares_for_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text", "p_cost" numeric) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_q_side DECIMAL;
  v_q_other DECIMAL;
  v_cost_over_b DECIMAL;
  v_side_over_b DECIMAL;
  v_other_over_b DECIMAL;
  v_max_q_over_b DECIMAL;
  v_ln_sum_exp DECIMAL;
  v_A DECIMAL;
  v_B DECIMAL;
  v_ln_inner DECIMAL;
  v_shares DECIMAL;
BEGIN
  IF p_b <= 0 THEN
    RAISE EXCEPTION 'LMSR: liquidity parameter b must be positive';
  END IF;
  IF p_cost <= 0 THEN
    RAISE EXCEPTION 'LMSR: cost must be positive';
  END IF;

  IF p_side = 'yes' THEN
    v_q_side := p_q_yes;
    v_q_other := p_q_no;
  ELSIF p_side = 'no' THEN
    v_q_side := p_q_no;
    v_q_other := p_q_yes;
  ELSE
    RAISE EXCEPTION 'LMSR: side must be yes or no';
  END IF;

  -- Closed-form inverse:
  -- new_cost - old_cost = p_cost
  -- shares = b * ln(e^(cost/b) * (e^(q_side/b) + e^(q_other/b)) - e^(q_other/b)) - q_side
  --
  -- In log space:
  -- ln(sum_exp) = max(q_side, q_other)/b + ln(1 + e^(-|q_side - q_other|/b))
  -- A = cost/b + ln(sum_exp)
  -- B = q_other/b
  -- ln(inner) = A + ln(1 - e^(B - A))  [valid when A > B]
  -- shares = b * ln(inner) - q_side

  v_cost_over_b := p_cost / p_b;
  v_side_over_b := v_q_side / p_b;
  v_other_over_b := v_q_other / p_b;

  v_max_q_over_b := GREATEST(v_side_over_b, v_other_over_b);
  v_ln_sum_exp := v_max_q_over_b + LN(1.0 + EXP(-ABS(v_side_over_b - v_other_over_b)));

  v_A := v_cost_over_b + v_ln_sum_exp;
  v_B := v_other_over_b;

  IF v_A <= v_B THEN
    RAISE EXCEPTION 'LMSR: cost too small to purchase any shares';
  END IF;

  v_ln_inner := v_A + LN(1.0 - EXP(v_B - v_A));
  v_shares := p_b * v_ln_inner - v_q_side;

  IF v_shares <= 0 THEN
    RAISE EXCEPTION 'LMSR: computed shares <= 0 (cost may be too small)';
  END IF;

  -- Safety: check the new q wouldn't overflow
  IF (v_q_side + v_shares) > 50 * p_b THEN
    RAISE EXCEPTION 'LMSR: trade would exceed q limit (50*b)';
  END IF;

  RETURN v_shares;
END;
$$;


ALTER FUNCTION "public"."lmsr_shares_for_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text", "p_cost" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_market"("p_market_id" "uuid", "p_pin" "text" DEFAULT NULL::"text", "p_token" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_user_id UUID;
  v_market RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_user_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_user_id, p_token, 'lock_market');
  ELSE
    PERFORM _verify_admin_pin(v_user_id, p_pin);
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open (status: %)', v_market.status;
  END IF;

  UPDATE markets SET status = 'closed' WHERE id = p_market_id;

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/lock', 'Market locked',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN jsonb_build_object('success', TRUE, 'market_id', p_market_id, 'new_status', 'closed');
END;
$$;


ALTER FUNCTION "public"."lock_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_system_event"("p_severity" "public"."log_severity", "p_source" "text", "p_message" "text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO system_logs (severity, source, message, context)
  VALUES (p_severity, p_source, p_message, p_context);
END;
$$;


ALTER FUNCTION "public"."log_system_event"("p_severity" "public"."log_severity", "p_source" "text", "p_message" "text", "p_context" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."normal_cdf"("x" double precision) RETURNS double precision
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  k DOUBLE PRECISION;
  phi DOUBLE PRECISION;
  approx DOUBLE PRECISION;
  abs_x DOUBLE PRECISION;
  a1 CONSTANT DOUBLE PRECISION := 0.319381530;
  a2 CONSTANT DOUBLE PRECISION := -0.356563782;
  a3 CONSTANT DOUBLE PRECISION := 1.781477937;
  a4 CONSTANT DOUBLE PRECISION := -1.821255978;
  a5 CONSTANT DOUBLE PRECISION := 1.330274429;
BEGIN
  abs_x := ABS(x);

  -- Mig 352 (Seam 2a): clip extreme inputs before EXP() to avoid 22003
  -- numeric underflow. Beyond ~|38| the polynomial result is float-double
  -- precision noise around the asymptote (0 or 1). EXP(-38²/2) = EXP(-722)
  -- is already below ~1e-313, dangerously close to underflow. Clip earlier
  -- to leave headroom for the 1/SQRT(2π) division.
  IF abs_x >= 37 THEN
    RETURN CASE WHEN x >= 0 THEN 1.0 ELSE 0.0 END;
  END IF;

  k := 1.0 / (1.0 + 0.2316419 * abs_x);
  phi := EXP(-(x * x) / 2.0) / SQRT(2.0 * pi());
  approx := 1.0 - phi * (a1 * k + a2 * k * k + a3 * k * k * k + a4 * k * k * k * k + a5 * k * k * k * k * k);
  IF x >= 0 THEN
    RETURN approx;
  ELSE
    RETURN 1.0 - approx;
  END IF;
END;
$$;


ALTER FUNCTION "public"."normal_cdf"("x" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."normal_cdf"("x" double precision) IS 'Standard normal cumulative distribution function. Abramowitz & Stegun polynomial approximation, ~7.5e-8 accuracy. Used by speed-market binary pricing. Mig 352 (Seam 2a): added |x|>=37 clip to avoid 22003 EXP underflow at extreme d².';



CREATE OR REPLACE FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_chain UUID[];
  v_platform_revenue DECIMAL;
  v_ancestor_id UUID;
  v_layer INTEGER;
  v_ancestor RECORD;
  v_commission DECIMAL;
  v_total DECIMAL := 0;
  v_handle_fee_pct DECIMAL;
  v_spread_pct DECIMAL;
  v_new_level INTEGER;
BEGIN
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct';
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct';
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);

  -- Platform revenue per trade = handle_fee + half-spread × stake
  v_platform_revenue := p_stake * (v_handle_fee_pct + v_spread_pct / 2.0);

  IF v_platform_revenue <= 0 THEN RETURN 0; END IF;

  SELECT referral_chain INTO v_chain FROM users WHERE id = p_user_id;
  IF v_chain IS NULL OR array_length(v_chain, 1) IS NULL THEN RETURN 0; END IF;

  -- Walk 2 layers (capped)
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 2) LOOP
    v_ancestor_id := v_chain[v_layer];
    IF v_ancestor_id IS NULL THEN CONTINUE; END IF;

    SELECT * INTO v_ancestor FROM users WHERE id = v_ancestor_id FOR UPDATE;
    IF v_ancestor IS NULL THEN CONTINUE; END IF;

    -- Update network volume + ratchet tier
    UPDATE users SET network_volume = COALESCE(network_volume, 0) + p_stake
    WHERE id = v_ancestor_id;

    v_new_level := CASE
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 200000 THEN 4
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 50000  THEN 3
      WHEN COALESCE(v_ancestor.network_volume, 0) + p_stake >= 10000  THEN 2
      ELSE 1
    END;
    IF v_new_level > COALESCE(v_ancestor.agent_level, 1) THEN
      UPDATE users SET agent_level = v_new_level WHERE id = v_ancestor_id;
      v_ancestor.agent_level := v_new_level;
    END IF;

    v_commission := _credit_speed_commission(
      v_ancestor_id, p_user_id, p_market_id, p_trade_id,
      v_layer, COALESCE(v_ancestor.agent_level, 1), v_platform_revenue
    );
    v_total := v_total + v_commission;
  END LOOP;

  RETURN v_total;
END;
$$;


ALTER FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") IS 'Walks user.referral_chain (2 layers) and credits speed commissions. Basis = stake × (handle_fee_pct + spread_pct/2). Activation gate via _credit_speed_commission. Should ONLY be called for retail and commission-branch users (not reseller — reseller branches handle their own sub-agent payouts via Flows B/C in Part 3).';



CREATE OR REPLACE FUNCTION "public"."pay_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_trade_amount" numeric) RETURNS numeric
    LANGUAGE "plpgsql"
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
      IF NOT v_referrer_activated AND v_new_qual_count >= 5 THEN
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

  -- 5. Single-pass loop: volume + tier + commission for each ancestor (max 2 layers)
  FOR v_layer IN 1..LEAST(array_length(v_chain, 1), 2) LOOP
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


ALTER FUNCTION "public"."pay_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_trade_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_audit_table_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    IF current_setting('app.trigger_bypass', true) = 'true' THEN
      IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
      RETURN OLD;
    END IF;
    RAISE EXCEPTION '% is append-only — updates and deletes are not allowed', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_audit_table_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_branch_pools_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'branch_pools is append-only: % not allowed', TG_OP;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."prevent_branch_pools_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_sensitive_branch_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Allow service_role calls
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to financial/status columns
  IF NEW.pool_balance      IS DISTINCT FROM OLD.pool_balance
  OR NEW.worst_case_total  IS DISTINCT FROM OLD.worst_case_total
  OR NEW.pending_payouts   IS DISTINCT FROM OLD.pending_payouts
  OR NEW.status            IS DISTINCT FROM OLD.status
  THEN
    RAISE EXCEPTION 'Cannot modify protected branch columns';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_sensitive_branch_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_sensitive_user_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  -- Allow service_role calls (auth.uid() is NULL when called via service_role)
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Allow admin users
  IF EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
    RETURN NEW;
  END IF;

  -- Allow SECURITY DEFINER trigger functions (they set a local flag)
  IF current_setting('app.trigger_bypass', TRUE) = 'true' THEN
    RETURN NEW;
  END IF;

  -- Block changes to sensitive columns for regular users
  -- NOTE: referred_by is intentionally NOT listed — users can set it once via referral signup
  -- NOTE: demo_mode is intentionally NOT listed — user preference, route gate is elsewhere
  IF NEW.balance_usd        IS DISTINCT FROM OLD.balance_usd
  OR NEW.is_admin           IS DISTINCT FROM OLD.is_admin
  OR NEW.is_frozen          IS DISTINCT FROM OLD.is_frozen
  OR NEW.agent_level        IS DISTINCT FROM OLD.agent_level
  OR NEW.direct_referral_count IS DISTINCT FROM OLD.direct_referral_count
  OR NEW.wagering_requirement  IS DISTINCT FROM OLD.wagering_requirement
  OR NEW.total_wagered      IS DISTINCT FROM OLD.total_wagered
  OR NEW.deposit_bonus_claimed IS DISTINCT FROM OLD.deposit_bonus_claimed
  OR NEW.referral_chain     IS DISTINCT FROM OLD.referral_chain
  OR NEW.referral_code      IS DISTINCT FROM OLD.referral_code
  OR NEW.admin_allowed_views IS DISTINCT FROM OLD.admin_allowed_views
  OR NEW.demo_balance_usd            IS DISTINCT FROM OLD.demo_balance_usd
  OR NEW.demo_first_enabled_at       IS DISTINCT FROM OLD.demo_first_enabled_at
  OR NEW.demo_first_trade_at         IS DISTINCT FROM OLD.demo_first_trade_at
  OR NEW.first_real_deposit_after_demo_at IS DISTINCT FROM OLD.first_real_deposit_after_demo_at
  THEN
    RAISE EXCEPTION 'Cannot modify protected columns';
  END IF;

  -- Extra guard: referred_by can only go from NULL to non-NULL (one-time set)
  IF OLD.referred_by IS NOT NULL AND NEW.referred_by IS DISTINCT FROM OLD.referred_by THEN
    RAISE EXCEPTION 'Cannot modify referred_by after initial set';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_sensitive_user_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_speed_pool_ledger_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'speed_pool_ledger is append-only: % not allowed', TG_OP;
END;
$$;


ALTER FUNCTION "public"."prevent_speed_pool_ledger_mutation"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_transactions_mutation"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_bypass TEXT;
BEGIN
  -- Service role can opt into a per-statement bypass via session GUC.
  BEGIN
    v_bypass := current_setting('app.transactions_bypass', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;

  IF v_bypass = 'true' AND auth.role() = 'service_role' THEN
    -- Bypass allowed — must be intentional and is audited.
    INSERT INTO system_logs (severity, source, message, context)
    VALUES (
      'warn'::log_severity,
      'transactions/bypass',
      format('Append-only bypass: %s on transactions', TG_OP),
      jsonb_build_object(
        'op', TG_OP,
        'old', to_jsonb(OLD),
        'new', CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END
      )
    );
    RETURN COALESCE(NEW, OLD);
  END IF;

  RAISE EXCEPTION 'transactions is append-only: % not allowed', TG_OP;
END;
$$;


ALTER FUNCTION "public"."prevent_transactions_mutation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_transactions_mutation"() IS 'Append-only enforcement for transactions ledger. service_role can bypass via SET LOCAL app.transactions_bypass = ''true''; the bypass is logged to system_logs with severity warn.';



CREATE OR REPLACE FUNCTION "public"."preview_branch_agent_pl"("p_branch_id" "uuid", "p_rate" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller UUID;
  v_branch RECORD;
  v_net_pool_flow DECIMAL;
  v_projected_payout DECIMAL;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate';
  END IF;

  -- Net pool flow over last 30 days, excluding owner/agent payouts
  -- (we're projecting gross before this agent takes their cut).
  SELECT COALESCE(SUM(amount), 0) INTO v_net_pool_flow
  FROM branch_pools
  WHERE branch_id = p_branch_id
    AND created_at >= NOW() - INTERVAL '30 days'
    AND type IN ('trade_buy', 'trade_sell', 'exit_fee',
                 'resolution_payout', 'void_refund',
                 'withdrawal', 'withdrawal_fee');

  v_projected_payout := ROUND(GREATEST(0, v_net_pool_flow) * p_rate, 2);

  RETURN jsonb_build_object(
    'branch_id', p_branch_id,
    'proposed_rate', p_rate,
    'last_30d_net_pool_flow', ROUND(v_net_pool_flow, 2),
    'projected_monthly_payout', v_projected_payout,
    'basis', 'Projection based on last 30 days of branch pool activity. Actual P/L depends on which users are referred by this agent and their trading outcomes.'
  );
END;
$$;


ALTER FUNCTION "public"."preview_branch_agent_pl"("p_branch_id" "uuid", "p_rate" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_deposit"("p_user_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_provider_ref" "text", "p_provider" "text" DEFAULT '3pay'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_user RECORD;
  v_deposit_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_deposit_id UUID;
  v_existing UUID;
  v_new_balance DECIMAL;
BEGIN
  -- Auth check
  IF auth.uid() IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE) THEN
      RAISE EXCEPTION 'process_deposit: unauthorized — admin or service_role only';
    END IF;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid deposit amount: must be positive';
  END IF;

  -- Idempotency
  SELECT id INTO v_existing FROM deposits WHERE provider_ref = p_provider_ref;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('deposit_id', v_existing, 'status', 'already_processed');
  END IF;

  SELECT rate INTO v_deposit_fee_rate
  FROM fee_config WHERE fee_type = 'deposit_fee' LIMIT 1;

  v_fee := p_amount * COALESCE(v_deposit_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  INSERT INTO deposits (user_id, amount, fee, net_amount, currency, provider_ref, provider, status, confirmed_at)
  VALUES (p_user_id, p_amount, v_fee, v_net_amount, p_currency, p_provider_ref, p_provider, 'confirmed', NOW())
  RETURNING id INTO v_deposit_id;

  -- Single UPDATE folds balance credit + conversion analytics column.
  -- first_real_deposit_after_demo_at is set only if user previously enabled demo
  -- AND column is still null (COALESCE guard).
  UPDATE users SET
    balance_usd = balance_usd + v_net_amount,
    first_real_deposit_after_demo_at = COALESCE(
      first_real_deposit_after_demo_at,
      CASE WHEN demo_first_enabled_at IS NOT NULL THEN NOW() ELSE NULL END
    )
  WHERE id = p_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    p_user_id, 'deposit', v_net_amount,
    v_new_balance,
    v_deposit_id,
    'Deposit ' || p_currency || ' via ' || p_provider
  );

  RETURN jsonb_build_object(
    'deposit_id', v_deposit_id,
    'net_amount', v_net_amount,
    'status', 'confirmed'
  );
END;
$$;


ALTER FUNCTION "public"."process_deposit"("p_user_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_provider_ref" "text", "p_provider" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."process_withdrawal"("p_amount" numeric, "p_destination" "text", "p_currency" "text", "p_destination_type" "text", "p_network" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_withdrawal_fee_rate DECIMAL;
  v_fee DECIMAL;
  v_net_amount DECIMAL;
  v_withdrawal_id UUID;
  v_min_withdrawal DECIMAL := 10;
  v_first_deposit_time TIMESTAMPTZ;
  v_new_balance DECIMAL;
  v_provider TEXT;
  v_destination_trimmed TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount < v_min_withdrawal THEN
    RAISE EXCEPTION 'Minimum withdrawal is $%', v_min_withdrawal;
  END IF;

  -- ═══ Destination validation — Whish or USDT TRC20 only ═══
  IF p_destination_type IS NULL OR p_destination_type NOT IN ('crypto', 'whish') THEN
    RAISE EXCEPTION 'Invalid destination_type: must be crypto or whish';
  END IF;

  v_destination_trimmed := TRIM(COALESCE(p_destination, ''));
  IF v_destination_trimmed = '' THEN
    RAISE EXCEPTION 'Destination cannot be empty';
  END IF;

  IF p_destination_type = 'crypto' THEN
    -- Only TRC20 supported at launch. ERC20 intentionally disabled (gas fees
    -- make small withdrawals uneconomical). If NULL, default to TRC20.
    IF p_network IS NULL THEN
      p_network := 'TRC20';
    END IF;
    IF p_network != 'TRC20' THEN
      RAISE EXCEPTION 'Only USDT TRC20 is supported for crypto withdrawals at this time';
    END IF;
    IF v_destination_trimmed !~ '^T[1-9A-HJ-NP-Za-km-z]{33}$' THEN
      RAISE EXCEPTION 'Invalid TRC20 address format (must start with T, 34 characters, base58)';
    END IF;
    v_provider := '3pay';
  ELSE  -- whish
    -- Lebanese phone: loose validation — 8-15 digits, optional leading +
    IF v_destination_trimmed !~ '^[+]?[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Invalid phone number format for Whish withdrawal';
    END IF;
    IF p_network IS NOT NULL THEN
      RAISE EXCEPTION 'Network must be NULL for Whish withdrawal';
    END IF;
    v_provider := 'whish_manual';
  END IF;

  -- ═══ Lock user row + guards ═══
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  IF v_user.total_wagered < v_user.wagering_requirement THEN
    RAISE EXCEPTION 'Wagering requirement not met. Wagered: $%, Required: $%',
      ROUND(v_user.total_wagered, 2), ROUND(v_user.wagering_requirement, 2);
  END IF;

  SELECT MIN(confirmed_at) INTO v_first_deposit_time
  FROM deposits WHERE user_id = v_user_id AND status = 'confirmed';
  IF v_first_deposit_time IS NULL OR v_first_deposit_time > NOW() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Withdrawals available 24 hours after first deposit';
  END IF;

  SELECT rate INTO v_withdrawal_fee_rate
  FROM fee_config WHERE fee_type = 'withdrawal_fee' LIMIT 1;
  v_fee := p_amount * COALESCE(v_withdrawal_fee_rate, 0);
  v_net_amount := p_amount - v_fee;

  IF v_user.balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- ═══ Hold funds ═══
  UPDATE users SET balance_usd = balance_usd - p_amount WHERE id = v_user_id
  RETURNING balance_usd INTO v_new_balance;

  INSERT INTO withdrawals (
    user_id, amount, fee, net_amount, currency,
    destination, destination_type, network, provider
  )
  VALUES (
    v_user_id, p_amount, v_fee, v_net_amount, p_currency,
    v_destination_trimmed, p_destination_type, p_network, v_provider
  )
  RETURNING id INTO v_withdrawal_id;

  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (
    v_user_id, 'withdrawal', -p_amount,
    v_new_balance,
    v_withdrawal_id,
    'Withdrawal request (' || p_currency || ' via ' || v_provider || ')'
  );

  RETURN jsonb_build_object(
    'withdrawal_id', v_withdrawal_id,
    'fee', ROUND(v_fee, 2),
    'net_amount', ROUND(v_net_amount, 2),
    'provider', v_provider
  );
END;
$_$;


ALTER FUNCTION "public"."process_withdrawal"("p_amount" numeric, "p_destination" "text", "p_currency" "text", "p_destination_type" "text", "p_network" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_agent_balances"() RETURNS TABLE("user_id" "uuid", "cached_balance" numeric, "ledger_balance" numeric, "difference" numeric)
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."reconcile_agent_balances"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_balances"() RETURNS TABLE("user_id" "uuid", "cached_balance" numeric, "ledger_balance" numeric, "difference" numeric)
    LANGUAGE "plpgsql" STABLE
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


ALTER FUNCTION "public"."reconcile_balances"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_branch_solvency"() RETURNS TABLE("branch_id" "uuid", "branch_name" "text", "cached_worst_case" numeric, "computed_worst_case" numeric, "difference" numeric, "cached_pool_balance" numeric, "ledger_pool_balance" numeric, "pool_difference" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."reconcile_branch_solvency"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_branch_revenue"("p_market_id" "uuid", "p_branch_id" "uuid", "p_outcome" "public"."bet_side", "p_resolution_fee_collected" numeric DEFAULT 0) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_markup DECIMAL;
  v_explicit DECIMAL;
  v_exit DECIMAL;
  v_sooq_fee DECIMAL;
  v_total DECIMAL;
BEGIN
  -- Sum markup fees from branch buy trades
  SELECT COALESCE(SUM(branch_markup), 0) INTO v_markup
  FROM branch_trades
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND direction = 'buy';

  -- Sum explicit fees from trades table (branch trades)
  SELECT COALESCE(SUM(explicit_fee), 0) INTO v_explicit
  FROM trades
  WHERE market_id = p_market_id AND branch_id = p_branch_id;

  -- Sum exit fees from branch sell trades
  SELECT COALESCE(SUM(exit_fee_amount), 0) INTO v_exit
  FROM branch_trades
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND direction = 'sell';

  -- Sum SOOQ fees from branch_pools ledger
  SELECT COALESCE(SUM(ABS(amount)), 0) INTO v_sooq_fee
  FROM branch_pools
  WHERE branch_id = p_branch_id AND market_id = p_market_id AND type = 'sooq_branch_fee';

  -- total_revenue is GROSS (branch's fees earned, NOT reduced by SOOQ cut)
  v_total := v_markup + v_explicit + v_exit + p_resolution_fee_collected;

  INSERT INTO branch_revenue (
    branch_id, market_id, markup_revenue, explicit_fee_revenue,
    exit_fee_revenue, resolution_fee_revenue, sooq_fee_revenue, total_revenue
  ) VALUES (
    p_branch_id, p_market_id, v_markup, v_explicit,
    v_exit, p_resolution_fee_collected, v_sooq_fee, v_total
  )
  ON CONFLICT (branch_id, market_id) DO UPDATE SET
    markup_revenue = EXCLUDED.markup_revenue,
    explicit_fee_revenue = EXCLUDED.explicit_fee_revenue,
    exit_fee_revenue = EXCLUDED.exit_fee_revenue,
    resolution_fee_revenue = EXCLUDED.resolution_fee_revenue,
    sooq_fee_revenue = EXCLUDED.sooq_fee_revenue,
    total_revenue = EXCLUDED.total_revenue;
END;
$$;


ALTER FUNCTION "public"."record_branch_revenue"("p_market_id" "uuid", "p_branch_id" "uuid", "p_outcome" "public"."bet_side", "p_resolution_fee_collected" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_prelaunch_vote"("p_question_id" "uuid", "p_vote" "text", "p_visitor_id" "text") RETURNS TABLE("yes_count" integer, "no_count" integer, "user_vote" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing_vote TEXT;
BEGIN
  -- Check if visitor already voted on this question
  SELECT pv.vote INTO v_existing_vote
  FROM prelaunch_votes pv
  WHERE pv.question_id = p_question_id AND pv.visitor_id = p_visitor_id;

  IF v_existing_vote IS NOT NULL THEN
    -- Already voted — return existing vote + current counts
    RETURN QUERY
      SELECT pq.yes_count, pq.no_count, v_existing_vote
      FROM prelaunch_questions pq
      WHERE pq.id = p_question_id;
    RETURN;
  END IF;

  -- Insert the vote
  INSERT INTO prelaunch_votes (question_id, visitor_id, vote)
  VALUES (p_question_id, p_visitor_id, p_vote);

  -- Atomic increment
  IF p_vote = 'yes' THEN
    UPDATE prelaunch_questions SET yes_count = prelaunch_questions.yes_count + 1
    WHERE prelaunch_questions.id = p_question_id;
  ELSE
    UPDATE prelaunch_questions SET no_count = prelaunch_questions.no_count + 1
    WHERE prelaunch_questions.id = p_question_id;
  END IF;

  -- Return updated counts
  RETURN QUERY
    SELECT pq.yes_count, pq.no_count, p_vote
    FROM prelaunch_questions pq
    WHERE pq.id = p_question_id;
END;
$$;


ALTER FUNCTION "public"."record_prelaunch_vote"("p_question_id" "uuid", "p_vote" "text", "p_visitor_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_revenue"("p_market_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
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

  -- Snapshot read (set in migration 245)
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

  -- Idempotent: re-running record_revenue overwrites (recomputes from immutable trade/position sources)
  INSERT INTO platform_revenue (
    market_id, total_pot, seed_amount, platform_fee,
    total_commissions, net_revenue,
    explicit_fee_revenue, amm_spread_revenue, resolution_fee_revenue,
    dynamic_spread_revenue, cash_out_premium_revenue
  ) VALUES (
    p_market_id, v_total_volume, 0, v_total_fees,
    v_total_commissions, v_net_revenue,
    v_total_explicit, v_total_amm_spread, v_resolution_fee,
    v_dynamic_spread, v_total_cash_out
  )
  ON CONFLICT (market_id) DO UPDATE SET
    total_pot = EXCLUDED.total_pot,
    platform_fee = EXCLUDED.platform_fee,
    total_commissions = EXCLUDED.total_commissions,
    net_revenue = EXCLUDED.net_revenue,
    explicit_fee_revenue = EXCLUDED.explicit_fee_revenue,
    amm_spread_revenue = EXCLUDED.amm_spread_revenue,
    resolution_fee_revenue = EXCLUDED.resolution_fee_revenue,
    dynamic_spread_revenue = EXCLUDED.dynamic_spread_revenue,
    cash_out_premium_revenue = EXCLUDED.cash_out_premium_revenue;
END;
$$;


ALTER FUNCTION "public"."record_revenue"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reject_branch_agent"("p_agent_id" "uuid", "p_reason" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_agent.status != 'pending' THEN
    RAISE EXCEPTION 'Agent is not in pending status';
  END IF;

  UPDATE branch_agents
  SET status = 'rejected',
      rejection_reason = p_reason,
      is_active = false,
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object('agent_id', p_agent_id, 'status', 'rejected');
END;
$$;


ALTER FUNCTION "public"."reject_branch_agent"("p_agent_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_market"("p_market_id" "uuid", "p_outcome" "public"."bet_side", "p_pin" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."resolve_market"("p_market_id" "uuid", "p_outcome" "public"."bet_side", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."settle_resolution_commissions"("p_market_id" "uuid") RETURNS numeric
    LANGUAGE "plpgsql"
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


ALTER FUNCTION "public"."settle_resolution_commissions"("p_market_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id     UUID;
  v_branch       RECORD;
  v_new_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Credit amount must be positive'; END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  v_new_balance := v_branch.speed_pool_balance + p_amount;

  UPDATE speed_branches SET
    speed_pool_balance = v_new_balance,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_credit', p_amount, v_new_balance,
    NULL, COALESCE(p_notes, 'Admin collateral credit')
  );

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'pool_adjustment',
    'Speed collateral credit: ' || COALESCE(p_notes, '(no notes)'),
    jsonb_build_object('pool_balance', v_branch.speed_pool_balance),
    jsonb_build_object('pool_balance', v_new_balance, 'amount', p_amount)
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Collateral credit ' || p_amount || ' to branch ' || p_branch_id,
    jsonb_build_object('event', 'collateral_credit', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'amount', p_amount, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'amount_credited', p_amount,
    'new_pool_balance', v_new_balance
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") IS 'PIN-gated admin RPC. Credits collateral to a speed-enabled branch (top-up, hedge offset, etc).';



CREATE OR REPLACE FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id     UUID;
  v_branch       RECORD;
  v_new_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'Withdraw amount must be positive'; END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  v_new_balance := v_branch.speed_pool_balance - p_amount;

  UPDATE speed_branches SET
    speed_pool_balance = v_new_balance,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_withdraw', -p_amount, v_new_balance,
    NULL, COALESCE(p_notes, 'Admin collateral withdrawal')
  );

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'pool_adjustment',
    'Speed collateral withdraw: ' || COALESCE(p_notes, '(no notes)'),
    jsonb_build_object('pool_balance', v_branch.speed_pool_balance),
    jsonb_build_object('pool_balance', v_new_balance, 'amount_withdrawn', p_amount)
  );

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Collateral withdraw ' || p_amount || ' from branch ' || p_branch_id,
    jsonb_build_object('event', 'collateral_withdraw', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'amount', p_amount, 'notes', p_notes)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'amount_withdrawn', p_amount,
    'new_pool_balance', v_new_balance
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") IS 'PIN-gated admin RPC. Withdraws collateral from a speed-enabled branch. Negative ledger entry.';



CREATE OR REPLACE FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id      UUID;
  v_branch        RECORD;
  v_existing      RECORD;
  v_pool_balance  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- ── Pre-flight: branch exists, not already speed-enabled ────────────
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;
  IF v_branch.book_type <> 'reseller' THEN
    RAISE EXCEPTION 'Speed enable is for reseller branches only (this branch is %)', v_branch.book_type;
  END IF;

  SELECT * INTO v_existing FROM speed_branches WHERE branch_id = p_branch_id;
  IF FOUND THEN
    RAISE EXCEPTION 'Branch already speed-enabled (status: %)', v_existing.speed_status;
  END IF;

  -- ── Validate inputs ─────────────────────────────────────────────────
  IF p_collateral <= 0 THEN RAISE EXCEPTION 'Collateral must be positive'; END IF;
  IF p_fee_share_pct < 0 OR p_fee_share_pct > 1 THEN
    RAISE EXCEPTION 'fee_share_pct must be in [0, 1]';
  END IF;
  IF p_stake_min <= 0 OR p_stake_max <= p_stake_min THEN
    RAISE EXCEPTION 'Invalid stake range';
  END IF;
  IF NOT (p_unfreeze_pct < p_freeze_warn_pct AND p_freeze_warn_pct < p_freeze_hard_pct) THEN
    RAISE EXCEPTION 'Freeze thresholds must satisfy unfreeze < warn < hard';
  END IF;
  IF jsonb_typeof(p_stake_caps_per_side) <> 'object' THEN
    RAISE EXCEPTION 'stake_caps_per_side must be a JSON object';
  END IF;

  -- ── Create speed_branches row ───────────────────────────────────────
  INSERT INTO speed_branches (
    branch_id, speed_status, speed_pool_balance,
    fee_share_pct, freeze_warn_pct, freeze_hard_pct, unfreeze_pct,
    stake_min, stake_max, stake_caps_per_side,
    activated_at, activated_by
  ) VALUES (
    p_branch_id, 'active', p_collateral,
    p_fee_share_pct, p_freeze_warn_pct, p_freeze_hard_pct, p_unfreeze_pct,
    p_stake_min, p_stake_max, p_stake_caps_per_side,
    NOW(), v_admin_id
  );

  -- ── Initial collateral ledger entry ─────────────────────────────────
  v_pool_balance := p_collateral;
  INSERT INTO speed_pool_ledger (
    branch_id, market_id, type, amount, balance_after,
    reference_id, description
  ) VALUES (
    p_branch_id, NULL, 'collateral_credit', p_collateral, v_pool_balance,
    NULL, 'Initial collateral on speed enable by admin ' || v_admin_id
  );

  -- ── Audit ───────────────────────────────────────────────────────────
  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'config_change',
    'Speed markets enabled',
    NULL,
    jsonb_build_object(
      'collateral', p_collateral,
      'fee_share_pct', p_fee_share_pct,
      'stake_min', p_stake_min,
      'stake_max', p_stake_max,
      'stake_caps_per_side', p_stake_caps_per_side
    )
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Speed markets enabled for branch ' || p_branch_id,
    jsonb_build_object(
      'event', 'enable_branch',
      'admin_id', v_admin_id, 'branch_id', p_branch_id, 'collateral', p_collateral
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'branch_id', p_branch_id,
    'speed_status', 'active',
    'pool_balance', v_pool_balance
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") IS 'PIN-gated admin RPC. Speed-enables a reseller branch, posts initial collateral, audits to branch_admin_overrides + system_logs.';



CREATE OR REPLACE FUNCTION "public"."speed_admin_freeze_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id    UUID;
  v_branch      RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  UPDATE speed_branches SET speed_status = 'frozen', updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch frozen: ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'frozen')
  );

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Branch frozen ' || p_branch_id,
    jsonb_build_object('event', 'freeze_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'frozen');
END;
$$;


ALTER FUNCTION "public"."speed_admin_freeze_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_master_kill_hard"("p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id      UUID;
  v_market        RECORD;
  v_voided_count  INTEGER := 0;
  v_pos           RECORD;
  v_new_balance   DECIMAL;
  v_new_pool_bal  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  -- 1. Soft kill first
  UPDATE fee_config SET rate = 0
  WHERE fee_type = 'speed_markets_enabled';

  -- 2. Loop over all open markets, void each (refund all positions)
  FOR v_market IN
    SELECT * FROM speed_markets WHERE status IN ('open', 'pending') FOR UPDATE
  LOOP
    -- Refund all open positions
    FOR v_pos IN
      SELECT * FROM speed_positions
      WHERE market_id = v_market.id AND status = 'open'
    LOOP
      -- Idempotency: skip if already settled
      IF EXISTS (SELECT 1 FROM speed_settlements WHERE position_id = v_pos.id) THEN
        CONTINUE;
      END IF;

      -- Refund stake to user
      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id
      RETURNING balance_usd INTO v_new_balance;

      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (
        v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id,
        'Speed master-kill refund'
      );

      UPDATE speed_positions SET
        status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW()
      WHERE id = v_pos.id;

      -- Pool ledger refund entry
      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_bal FROM speed_branches
        WHERE branch_id = v_pos.branch_id FOR UPDATE;
        v_new_pool_bal := v_new_pool_bal - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, v_market.id, 'refund', -v_pos.stake, v_new_pool_bal, v_pos.id, 'Master-kill refund');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_bal WHERE branch_id = v_pos.branch_id;
      ELSE
        SELECT COALESCE(SUM(amount), 0) - v_pos.stake INTO v_new_pool_bal
        FROM speed_pool_ledger WHERE branch_id IS NULL;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, v_market.id, 'refund', -v_pos.stake, v_new_pool_bal, v_pos.id, 'Master-kill refund (main pool)');
      END IF;

      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, v_market.id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);
    END LOOP;

    UPDATE speed_markets SET
      status = 'voided', voided_at = NOW(),
      void_reason = 'Master kill hard by admin ' || v_admin_id,
      updated_at = NOW()
    WHERE id = v_market.id;

    v_voided_count := v_voided_count + 1;
  END LOOP;

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'MASTER KILL HARD by admin ' || v_admin_id || ': voided ' || v_voided_count || ' markets',
    jsonb_build_object('event', 'master_kill_hard', 'admin_id', v_admin_id, 'markets_voided', v_voided_count)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'kill_type', 'hard',
    'markets_voided', v_voided_count,
    'message', 'All open markets voided, stakes refunded. Speed markets disabled.'
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_master_kill_hard"("p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_master_kill_soft"("p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  UPDATE fee_config SET rate = 0
  WHERE fee_type = 'speed_markets_enabled';

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'MASTER KILL SOFT triggered by admin ' || v_admin_id,
    jsonb_build_object('event', 'master_kill_soft', 'admin_id', v_admin_id)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'kill_type', 'soft',
    'message', 'Speed markets disabled. New trades blocked. Open positions resolve normally.'
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_master_kill_soft"("p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_master_revive"("p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  UPDATE fee_config SET rate = 1
  WHERE fee_type = 'speed_markets_enabled';

  PERFORM log_system_event(
    'warn'::log_severity, 'speed_admin',
    'Speed markets revived by admin ' || v_admin_id,
    jsonb_build_object('event', 'master_revive', 'admin_id', v_admin_id)
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'message', 'Speed markets re-enabled. Voided markets remain voided.'
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_master_revive"("p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_overview"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id          UUID;
  v_master_enabled    DECIMAL;
  v_per_asset         JSONB;
  v_per_branch        JSONB;
  v_per_duration      JSONB;
  v_main_pool         DECIMAL;
  v_today_revenue     DECIMAL;
  v_today_payouts     DECIMAL;
  v_today_gross_stake DECIMAL;
  v_open_markets      INTEGER;
  v_open_positions    INTEGER;
  v_rv_computed_at         TIMESTAMPTZ;
  v_rv_freshness_seconds   INTEGER;
  v_rv_cache_status        TEXT;
  v_late_window_trades     INTEGER;
  v_late_window_stake      DECIMAL;
  v_late_window_revenue    DECIMAL;
  v_use_realized_vol       DECIMAL;
  v_late_window_threshold  DECIMAL;
  v_late_window_surcharge  DECIMAL;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  SELECT jsonb_agg(jsonb_build_object('asset', t.asset, 'open_position_count', t.open_position_count,
    'open_over_stake', t.open_over_stake, 'open_under_stake', t.open_under_stake, 'net_stake', t.net_stake)) INTO v_per_asset
  FROM (SELECT m.asset, COUNT(p.id) AS open_position_count,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS open_over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS open_under_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0)
        - COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS net_stake
    FROM speed_markets m LEFT JOIN speed_positions p ON p.market_id = m.id AND p.status = 'open'
    WHERE m.status = 'open' GROUP BY m.asset) t;
  SELECT jsonb_agg(jsonb_build_object('branch_id', sb.branch_id, 'branch_name', b.name, 'branch_code', b.branch_code,
    'speed_status', sb.speed_status, 'pool_balance', sb.speed_pool_balance, 'fee_share_pct', sb.fee_share_pct)
    ORDER BY sb.speed_pool_balance DESC) INTO v_per_branch
  FROM speed_branches sb JOIN branches b ON b.id = sb.branch_id;
  SELECT jsonb_agg(jsonb_build_object('duration', t.duration, 'open_markets', t.open_markets,
    'open_position_count', t.open_position_count, 'open_over_stake', t.open_over_stake, 'open_under_stake', t.open_under_stake)) INTO v_per_duration
  FROM (SELECT m.duration, COUNT(DISTINCT m.id) AS open_markets, COUNT(p.id) AS open_position_count,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS open_over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS open_under_stake
    FROM speed_markets m LEFT JOIN speed_positions p ON p.market_id = m.id AND p.status = 'open'
    WHERE m.status = 'open' GROUP BY m.duration) t;
  SELECT COALESCE(SUM(amount), 0) INTO v_main_pool FROM speed_pool_ledger WHERE branch_id IS NULL;
  SELECT COALESCE(SUM(handle_fee + (amount * (offered_prob - fair_prob))), 0), COALESCE(SUM(amount), 0)
  INTO v_today_revenue, v_today_gross_stake FROM speed_trades
  WHERE kind = 'open' AND created_at >= date_trunc('day', NOW());
  SELECT COALESCE(-SUM(amount) FILTER (WHERE type IN ('winning_payout', 'cashout_out', 'refund')), 0)
  INTO v_today_payouts FROM speed_pool_ledger WHERE created_at >= date_trunc('day', NOW());
  SELECT COUNT(*) INTO v_open_markets FROM speed_markets WHERE status = 'open';
  SELECT COUNT(*) INTO v_open_positions FROM speed_positions WHERE status = 'open';

  SELECT computed_at INTO v_rv_computed_at FROM speed_realized_vol_cache WHERE asset = 'BTC' LIMIT 1;
  IF v_rv_computed_at IS NULL THEN
    v_rv_freshness_seconds := NULL;
    v_rv_cache_status := 'missing';
  ELSE
    v_rv_freshness_seconds := FLOOR(EXTRACT(EPOCH FROM (NOW() - v_rv_computed_at)))::INTEGER;
    v_rv_cache_status := CASE
      WHEN v_rv_freshness_seconds < 90 THEN 'fresh'
      WHEN v_rv_freshness_seconds < 300 THEN 'stale'
      ELSE 'very_stale'
    END;
  END IF;

  SELECT COUNT(*), COALESCE(SUM(t.amount), 0), COALESCE(SUM(t.amount * 0.075), 0)
  INTO v_late_window_trades, v_late_window_stake, v_late_window_revenue
  FROM speed_trades t JOIN speed_markets m ON m.id = t.market_id
  WHERE t.kind = 'open' AND t.created_at >= date_trunc('day', NOW())
    AND (m.closes_at - t.created_at) < INTERVAL '30 seconds';

  SELECT rate INTO v_use_realized_vol FROM fee_config WHERE fee_type = 'speed_use_realized_vol' LIMIT 1;
  SELECT rate INTO v_late_window_threshold FROM fee_config WHERE fee_type = 'speed_late_window_threshold' LIMIT 1;
  SELECT rate INTO v_late_window_surcharge FROM fee_config WHERE fee_type = 'speed_late_window_surcharge' LIMIT 1;

  RETURN jsonb_build_object(
    'master_enabled', COALESCE(v_master_enabled, 0) = 1,
    'per_asset', COALESCE(v_per_asset, '[]'::jsonb),
    'per_branch', COALESCE(v_per_branch, '[]'::jsonb),
    'per_duration', COALESCE(v_per_duration, '[]'::jsonb),
    'main_pool_balance', v_main_pool,
    'today_revenue', v_today_revenue,
    'today_payouts', v_today_payouts,
    'today_gross_stake', v_today_gross_stake,
    'today_effective_edge_pct', CASE WHEN v_today_gross_stake > 0
      THEN ROUND((v_today_revenue / v_today_gross_stake * 100)::numeric, 2) ELSE 0 END,
    'open_markets', v_open_markets,
    'open_positions', v_open_positions,
    'monitoring', jsonb_build_object(
      'rv_cache', jsonb_build_object(
        'status', v_rv_cache_status,
        'freshness_seconds', v_rv_freshness_seconds,
        'computed_at', v_rv_computed_at,
        'threshold_seconds', 90
      ),
      'late_window_today', jsonb_build_object(
        'trade_count', v_late_window_trades,
        'gross_stake', v_late_window_stake,
        'estimated_extra_revenue', ROUND(v_late_window_revenue, 2),
        'pct_of_total_trades', CASE WHEN v_today_gross_stake > 0
          THEN ROUND((v_late_window_stake / v_today_gross_stake * 100)::numeric, 2) ELSE 0 END
      ),
      'kill_switches', jsonb_build_object(
        'master_enabled', COALESCE(v_master_enabled, 0) = 1,
        'realized_vol_active', COALESCE(v_use_realized_vol, 1) = 1,
        'late_window_threshold_seconds', COALESCE(v_late_window_threshold, 30),
        'late_window_surcharge_active', COALESCE(v_late_window_surcharge, 0) > 0,
        'late_window_surcharge_value', COALESCE(v_late_window_surcharge, 0)
      )
    ),
    'snapshot_at', NOW()
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_overview"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_admin_overview"() IS 'Admin-only overview for /admin/speed. today_revenue = handle_fee + (stake × (offered - fair)) per trade, summed. Captures retail + reseller flows uniformly.';



CREATE OR REPLACE FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id     UUID;
  v_snapshot_id  UUID;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  INSERT INTO speed_external_book_snapshots (
    asset, venue, snapshot_at,
    net_position_qty, avg_entry_price, mark_price,
    unrealized_pnl_usd, realized_pnl_since_last, funding_paid_since_last,
    margin_balance_usd, recorded_by, notes
  ) VALUES (
    p_asset, 'binance_futures', p_snapshot_at,
    p_net_position_qty, p_avg_entry_price, p_mark_price,
    p_unrealized_pnl_usd, p_realized_pnl_since_last, p_funding_paid_since_last,
    p_margin_balance_usd, v_admin_id, p_notes
  )
  RETURNING id INTO v_snapshot_id;

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Book snapshot recorded: ' || p_asset::TEXT || ' qty=' || p_net_position_qty,
    jsonb_build_object(
      'event', 'book_snapshot',
      'admin_id', v_admin_id, 'snapshot_id', v_snapshot_id, 'asset', p_asset,
      'unrealized_pnl', p_unrealized_pnl_usd, 'realized_pnl', p_realized_pnl_since_last
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'snapshot_id', v_snapshot_id,
    'asset', p_asset
  );
END;
$$;


ALTER FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") IS 'PIN-gated admin RPC. Records daily Binance Futures snapshot for ops dashboard reconciliation.';



CREATE OR REPLACE FUNCTION "public"."speed_admin_suspend_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id   UUID;
  v_branch     RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;

  UPDATE speed_branches SET
    speed_status = 'suspended',
    suspension_reason = p_reason,
    updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch suspended: ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'suspended', 'suspension_reason', p_reason)
  );

  PERFORM log_system_event(
    'critical'::log_severity, 'speed_admin',
    'Branch SUSPENDED ' || p_branch_id || ': ' || COALESCE(p_reason, '(no reason)'),
    jsonb_build_object('event', 'suspend_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id, 'reason', p_reason)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'suspended');
END;
$$;


ALTER FUNCTION "public"."speed_admin_suspend_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_admin_unfreeze_branch"("p_branch_id" "uuid", "p_pin" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id   UUID;
  v_branch     RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;
  IF NOT _verify_admin_pin(v_admin_id, p_pin) THEN
    RAISE EXCEPTION 'Invalid admin PIN';
  END IF;

  SELECT * INTO v_branch FROM speed_branches WHERE branch_id = p_branch_id FOR UPDATE;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not speed-enabled'; END IF;
  IF v_branch.speed_status NOT IN ('frozen', 'warning') THEN
    RAISE EXCEPTION 'Branch is %, not frozen/warning', v_branch.speed_status;
  END IF;

  UPDATE speed_branches SET speed_status = 'active', updated_at = NOW()
  WHERE branch_id = p_branch_id;

  INSERT INTO branch_admin_overrides (admin_id, branch_id, override_type, note, previous_value, new_value)
  VALUES (
    v_admin_id, p_branch_id, 'status_change',
    'Speed branch unfrozen',
    jsonb_build_object('speed_status', v_branch.speed_status),
    jsonb_build_object('speed_status', 'active')
  );

  PERFORM log_system_event(
    'info'::log_severity, 'speed_admin',
    'Branch unfrozen ' || p_branch_id,
    jsonb_build_object('event', 'unfreeze_branch', 'admin_id', v_admin_id, 'branch_id', p_branch_id)
  );

  RETURN jsonb_build_object('success', TRUE, 'branch_id', p_branch_id, 'speed_status', 'active');
END;
$$;


ALTER FUNCTION "public"."speed_admin_unfreeze_branch"("p_branch_id" "uuid", "p_pin" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) RETURNS double precision
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_threshold      DECIMAL;
  v_surcharge      DECIMAL;
BEGIN
  SELECT rate INTO v_threshold FROM fee_config WHERE fee_type = 'speed_late_window_threshold' LIMIT 1;
  SELECT rate INTO v_surcharge FROM fee_config WHERE fee_type = 'speed_late_window_surcharge' LIMIT 1;
  v_threshold := COALESCE(v_threshold, 30);
  v_surcharge := COALESCE(v_surcharge, 0.15);

  IF v_surcharge < 0 OR v_surcharge > 0.30 THEN
    RAISE WARNING 'speed_late_window_surcharge out of bounds [0, 0.30]: % — clamping to default 0.15', v_surcharge;
    v_surcharge := 0.15;
  END IF;
  IF v_threshold < 0 THEN
    RAISE WARNING 'speed_late_window_threshold negative: % — clamping to 30', v_threshold;
    v_threshold := 30;
  END IF;

  IF p_seconds_left < v_threshold::DOUBLE PRECISION THEN
    RETURN p_base_spread + v_surcharge::DOUBLE PRECISION;
  ELSE
    RETURN p_base_spread;
  END IF;
END;
$$;


ALTER FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) IS 'Mig 356: returns spread widened by speed_late_window_surcharge when seconds_left < threshold; otherwise returns base unchanged. Bounds-clamps to [0, 0.30].';



CREATE OR REPLACE FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller_id      UUID;
  v_branch         RECORD;
  v_speed          RECORD;
  v_user_pl        DECIMAL;
  v_fee_revenue    DECIMAL;
  v_collateral     DECIMAL;
  v_open_count     INTEGER;
  v_today_volume   DECIMAL;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id;
  IF v_branch IS NULL THEN RAISE EXCEPTION 'Branch not found'; END IF;

  -- Branch operator OR admin can read
  IF v_branch.manager_user_id <> v_caller_id
     AND NOT EXISTS (SELECT 1 FROM users WHERE id = v_caller_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_speed FROM speed_branches WHERE branch_id = p_branch_id;
  IF v_speed IS NULL THEN
    RETURN jsonb_build_object(
      'enabled', FALSE,
      'branch_id', p_branch_id
    );
  END IF;

  -- Three trackers — computed live from ledger, not cached.
  -- User Book P/L: stake_in (winning_payout + cashout_out + refund)
  SELECT COALESCE(SUM(amount), 0) INTO v_user_pl
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type IN ('stake_in', 'winning_payout', 'cashout_out', 'refund');

  -- Fee Revenue: sum of fee_share_in
  SELECT COALESCE(SUM(amount), 0) INTO v_fee_revenue
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type = 'fee_share_in';

  -- Collateral: collateral_credit + collateral_withdraw
  SELECT COALESCE(SUM(amount), 0) INTO v_collateral
  FROM speed_pool_ledger
  WHERE branch_id = p_branch_id
    AND type IN ('collateral_credit', 'collateral_withdraw');

  SELECT COUNT(*) INTO v_open_count
  FROM speed_positions
  WHERE branch_id = p_branch_id AND status = 'open';

  SELECT COALESCE(SUM(stake), 0) INTO v_today_volume
  FROM speed_positions
  WHERE branch_id = p_branch_id
    AND created_at >= date_trunc('day', NOW());

  RETURN jsonb_build_object(
    'enabled', TRUE,
    'branch_id', p_branch_id,
    'speed_status', v_speed.speed_status,
    'pool_balance', v_speed.speed_pool_balance,
    'fee_share_pct', v_speed.fee_share_pct,
    'stake_min', v_speed.stake_min,
    'stake_max', v_speed.stake_max,
    'stake_caps_per_side', v_speed.stake_caps_per_side,
    'trackers', jsonb_build_object(
      'user_book_pl', v_user_pl,
      'fee_revenue', v_fee_revenue,
      'collateral', v_collateral
    ),
    'open_position_count', v_open_count,
    'today_volume', v_today_volume,
    'snapshot_at', NOW()
  );
END;
$$;


ALTER FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") IS 'Branch operator + admin dashboard data: three trackers (User Book P/L, Fee Revenue, Collateral) + pool params + open count + daily volume.';



CREATE OR REPLACE FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_low  DECIMAL;
  v_high DECIMAL;
  v_pct  DOUBLE PRECISION;
BEGIN
  IF p_role NOT IN ('winner', 'loser') THEN
    RAISE EXCEPTION 'Invalid role: % (expected winner | loser)', p_role;
  END IF;

  v_pct := GREATEST(0, LEAST(1, p_pct));

  SELECT rate INTO v_low
  FROM fee_config
  WHERE fee_type = 'speed_cashout_' || p_duration::TEXT || '_' || p_role || '_low'
  LIMIT 1;

  SELECT rate INTO v_high
  FROM fee_config
  WHERE fee_type = 'speed_cashout_' || p_duration::TEXT || '_' || p_role || '_high'
  LIMIT 1;

  IF v_low IS NULL OR v_high IS NULL THEN
    RAISE EXCEPTION 'Cashout endpoints not configured for (%, %)', p_duration, p_role;
  END IF;

  RETURN (v_low + (v_high - v_low) * v_pct)::DECIMAL;
END;
$$;


ALTER FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) IS 'Continuous cashout multiplier — linear interpolation between fee_config speed_cashout_<dur>_<role>_low and _high. Replaces the bucket-based lookup (high/mid/low) that produced visible discontinuities at pct=0.6 and pct=0.2. STABLE, not IMMUTABLE — reads fee_config.';



CREATE OR REPLACE FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id           UUID;
  v_position          RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;
  v_oracle_stale_secs DECIMAL;
  v_iv                DECIMAL;
  v_seconds_total     DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_pct               DOUBLE PRECISION;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_payout_per_dollar DECIMAL;
  v_fair_value        DECIMAL;
  v_fair_profit       DECIMAL;
  v_role              TEXT;
  v_multiplier        DECIMAL;
  v_cashout_amount    DECIMAL;
  v_existing_trade    RECORD;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_spread_pct          DECIMAL;
  v_extreme_coeff       DECIMAL;
  v_distance            DOUBLE PRECISION;
  v_overage             DOUBLE PRECISION;
  v_widened_spread      DOUBLE PRECISION;
  v_surcharged_offered  DECIMAL;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_trade FROM speed_trades
    WHERE idempotency_key = p_idempotency_key AND user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'trade_id', v_existing_trade.id,
        'message', 'Duplicate cashout — returning existing result');
    END IF;
  END IF;
  SELECT * INTO v_position FROM speed_positions WHERE id = p_position_id FOR UPDATE;
  IF v_position IS NULL THEN RAISE EXCEPTION 'Position not found'; END IF;
  IF v_position.user_id <> v_user_id THEN RAISE EXCEPTION 'Not your position'; END IF;
  IF v_position.status <> 'open' THEN RAISE EXCEPTION 'Position is not open (status: %)', v_position.status; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = v_position.market_id FOR UPDATE;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Market is not open for cashout (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Market has closed; cannot cash out'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable'; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale; try again';
  END IF;
  IF v_position.branch_id IS NOT NULL THEN
    SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_position.branch_id FOR UPDATE;
    IF v_speed_branch IS NULL THEN RAISE EXCEPTION 'Speed branch row missing for this position'; END IF;
    IF v_speed_branch.speed_status NOT IN ('active', 'warning') THEN
      RAISE EXCEPTION 'Branch is %, cashout unavailable', v_speed_branch.speed_status;
    END IF;
  ELSE
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;

  v_iv := _speed_get_iv(v_market.asset);
  v_seconds_total := EXTRACT(EPOCH FROM (v_market.closes_at - v_market.opens_at));
  v_seconds_left  := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF v_position.side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;

  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);
  v_surcharged_offered := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_surcharged_offered > 0.99 THEN v_surcharged_offered := 0.99;
  ELSIF v_surcharged_offered < 0.01 THEN v_surcharged_offered := 0.01;
  END IF;

  v_payout_per_dollar := 1.0 / v_position.entry_offered_prob;
  v_fair_value := v_fair_prob_side * v_position.stake * v_payout_per_dollar;

  IF v_seconds_left < 30 THEN
    v_fair_value := v_fair_value * (v_fair_prob_side / v_surcharged_offered);
  END IF;
  v_fair_profit := v_fair_value - v_position.stake;

  -- Mig 358 fix: strict > (not >=) so a tie at the clipped boundary breaks
  -- toward loser. Otherwise immediate round-trip when fair = entry_offered
  -- returns exactly stake (break-even), violating the strict invariant.
  IF v_fair_prob_side > v_position.entry_offered_prob THEN v_role := 'winner';
  ELSE v_role := 'loser';
  END IF;
  IF v_seconds_total > 0 THEN v_pct := v_seconds_left / v_seconds_total;
  ELSE v_pct := 0;
  END IF;
  v_multiplier := speed_cashout_multiplier(v_market.duration, v_role, v_pct);

  IF v_role = 'winner' THEN
    v_cashout_amount := v_position.stake + v_fair_profit * v_multiplier;
  ELSE
    v_cashout_amount := v_fair_value * v_multiplier;
  END IF;
  IF v_cashout_amount < 0 THEN v_cashout_amount := 0; END IF;
  v_cashout_amount := ROUND(v_cashout_amount, 2);

  UPDATE speed_positions SET status = 'cashed_out', payout_amount = v_cashout_amount, closed_at = NOW()
  WHERE id = p_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, cashout_multiplier, idempotency_key)
  VALUES (p_position_id, v_user_id, v_market.id, v_position.branch_id, 'cashout', v_cashout_amount,
    v_oracle.price, v_fair_prob_side, v_position.entry_offered_prob, v_multiplier, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_position.branch_id IS NOT NULL THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_position.branch_id, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id);
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW()
    WHERE branch_id = v_position.branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance - v_cashout_amount;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, v_market.id, 'cashout_out', -v_cashout_amount, v_new_pool_balance, v_trade_id,
      'Speed cashout to user ' || v_user_id || ' (from main pool)');
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  IF v_cashout_amount > 0 THEN
    UPDATE users SET balance_usd = balance_usd + v_cashout_amount, updated_at = NOW()
    WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
    INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
    VALUES (v_user_id, 'speed_cashout', v_cashout_amount, v_new_balance, v_trade_id,
      'Speed cashout (' || v_role || ', mult ' || v_multiplier || ', pct ' || ROUND(v_pct::NUMERIC, 4) || ')');
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'trade_id', v_trade_id, 'cashout_amount', v_cashout_amount,
    'fair_value', ROUND(v_fair_value, 2), 'fair_profit', ROUND(v_fair_profit, 2),
    'role', v_role, 'multiplier', v_multiplier, 'pct_time_left', ROUND(v_pct::NUMERIC, 4));
END;
$$;


ALTER FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text") IS 'Cash out a single open speed position. Mig 352 + Mig 354 + Mig 356: late-window surcharge applied to fair_value in last 30s — compounds with role × time-bucket multiplier.';



CREATE OR REPLACE FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_user_id           UUID;
  v_user              RECORD;
  v_market            RECORD;
  v_oracle            RECORD;
  v_signup_branch_id  UUID;
  v_signup_branch     RECORD;
  v_routing_branch_id UUID;
  v_speed_branch      RECORD;
  v_main_pool         RECORD;
  v_is_reseller_flow  BOOLEAN;
  v_master_enabled    DECIMAL;
  v_handle_fee_pct    DECIMAL;
  v_spread_pct        DECIMAL;
  v_iv                DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_max_exposure_pct  DECIMAL;
  v_extreme_coeff     DECIMAL;
  v_handle_fee        DECIMAL;
  v_fair_prob_over    DECIMAL;
  v_fair_prob_side    DECIMAL;
  v_offered_prob      DECIMAL;
  v_widened_spread    DOUBLE PRECISION;
  v_distance          DOUBLE PRECISION;
  v_overage           DOUBLE PRECISION;
  v_seconds_left      DOUBLE PRECISION;
  v_existing_dup      RECORD;
  v_current_side_sum  DECIMAL;
  v_cap_for_duration  DECIMAL;
  v_market_exposure   RECORD;
  v_pool_collateral   DECIMAL;
  v_payout_if_won     DECIMAL;
  v_side_worst_case   DECIMAL;
  v_over_payout_total  DECIMAL;
  v_under_payout_total DECIMAL;
  v_position_id       UUID;
  v_trade_id          UUID;
  v_new_balance       DECIMAL;
  v_fee_share_amount  DECIMAL;
  v_new_pool_balance  DECIMAL;
  v_total_commissions DECIMAL := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  PERFORM set_config('app.trigger_bypass', 'true', true);
  IF p_side NOT IN ('over', 'under') THEN RAISE EXCEPTION 'Side must be over or under'; END IF;
  IF p_stake IS NULL OR p_stake <= 0 THEN RAISE EXCEPTION 'Stake must be positive'; END IF;
  IF p_idempotency_key IS NOT NULL THEN
    SELECT t.* INTO v_existing_dup FROM speed_trades t
    WHERE t.idempotency_key = p_idempotency_key AND t.user_id = v_user_id LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('idempotent', TRUE, 'position_id', v_existing_dup.position_id,
        'trade_id', v_existing_dup.id, 'message', 'Duplicate trade — returning existing result');
    END IF;
  END IF;
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN RAISE EXCEPTION 'Speed markets are currently disabled'; END IF;
  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;
  IF v_user IS NULL THEN RAISE EXCEPTION 'User not found'; END IF;
  IF v_user.is_frozen THEN RAISE EXCEPTION 'Account is frozen'; END IF;
  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Speed market not found'; END IF;
  IF v_market.status <> 'open' THEN RAISE EXCEPTION 'Speed market is not open (status: %)', v_market.status; END IF;
  IF NOW() >= v_market.closes_at THEN RAISE EXCEPTION 'Speed market has closed'; END IF;
  IF NOW() < v_market.opens_at THEN RAISE EXCEPTION 'Speed market has not opened yet'; END IF;
  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);
  SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_market.asset;
  IF v_oracle IS NULL THEN RAISE EXCEPTION 'Oracle price unavailable for %', v_market.asset; END IF;
  IF EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
    RAISE EXCEPTION 'Oracle price stale (>%s sec); try again', v_oracle_stale_secs;
  END IF;
  v_signup_branch_id := v_user.signup_branch_id;
  IF v_signup_branch_id IS NULL THEN
    v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
  ELSE
    SELECT * INTO v_signup_branch FROM branches WHERE id = v_signup_branch_id;
    IF v_signup_branch IS NULL THEN
      v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
    ELSE
      IF v_signup_branch.manager_user_id = v_user_id THEN
        RAISE EXCEPTION 'Branch operators cannot place bets on their own branch';
      END IF;
      IF v_signup_branch.book_type = 'reseller' THEN
        SELECT * INTO v_speed_branch FROM speed_branches WHERE branch_id = v_signup_branch_id FOR UPDATE;
        IF v_speed_branch IS NOT NULL AND v_speed_branch.speed_status = 'active' THEN
          v_is_reseller_flow := TRUE; v_routing_branch_id := v_signup_branch_id;
        ELSE
          RAISE EXCEPTION 'Speed markets not enabled for your branch';
        END IF;
      ELSE
        v_is_reseller_flow := FALSE; v_routing_branch_id := NULL;
      END IF;
    END IF;
  END IF;
  IF NOT v_is_reseller_flow THEN
    SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
    IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing — run mig 345 init'; END IF;
  END IF;
  IF v_is_reseller_flow THEN
    IF p_stake < v_speed_branch.stake_min OR p_stake > v_speed_branch.stake_max THEN
      RAISE EXCEPTION 'Stake $% outside branch limits ($% - $%)', p_stake, v_speed_branch.stake_min, v_speed_branch.stake_max;
    END IF;
    v_cap_for_duration := (v_speed_branch.stake_caps_per_side ->> v_market.duration::TEXT)::DECIMAL;
    IF v_cap_for_duration IS NULL THEN
      RAISE EXCEPTION 'Stake cap not configured for duration % on this branch', v_market.duration;
    END IF;
  ELSE
    IF p_stake < 1.00 OR p_stake > 25.00 THEN RAISE EXCEPTION 'Stake $% outside allowed range ($1 - $25)', p_stake; END IF;
    v_cap_for_duration := 200.00;
  END IF;
  SELECT COALESCE(SUM(stake), 0) INTO v_current_side_sum FROM speed_positions
  WHERE user_id = v_user_id AND market_id = p_market_id AND side = p_side AND status = 'open';
  IF v_current_side_sum + p_stake > v_cap_for_duration THEN
    RAISE EXCEPTION 'Cap reached on % side: max remaining $%', p_side, GREATEST(0, v_cap_for_duration - v_current_side_sum);
  END IF;
  IF v_user.balance_usd < p_stake THEN RAISE EXCEPTION 'Insufficient balance'; END IF;
  SELECT rate INTO v_handle_fee_pct FROM fee_config WHERE fee_type = 'speed_handle_fee_pct' LIMIT 1;
  SELECT rate INTO v_spread_pct FROM fee_config WHERE fee_type = 'speed_spread_pct' LIMIT 1;
  SELECT rate INTO v_extreme_coeff FROM fee_config WHERE fee_type = 'speed_extreme_spread_coeff' LIMIT 1;
  v_handle_fee_pct := COALESCE(v_handle_fee_pct, 0.01);
  v_spread_pct := COALESCE(v_spread_pct, 0.04);
  v_extreme_coeff := COALESCE(v_extreme_coeff, 8);
  v_iv := _speed_get_iv(v_market.asset);
  v_handle_fee := p_stake * v_handle_fee_pct;
  v_seconds_left := EXTRACT(EPOCH FROM (v_market.closes_at - NOW()));
  v_fair_prob_over := speed_fair_prob_over(v_oracle.price, v_market.strike_price, v_seconds_left, v_iv);
  IF p_side = 'over' THEN v_fair_prob_side := v_fair_prob_over;
  ELSE v_fair_prob_side := 1.0 - v_fair_prob_over;
  END IF;
  v_distance := ABS(v_fair_prob_side::DOUBLE PRECISION - 0.5);
  v_overage  := GREATEST(0.0, v_distance - 0.45);
  v_widened_spread := v_spread_pct::DOUBLE PRECISION + v_overage * v_overage * v_extreme_coeff::DOUBLE PRECISION;
  v_widened_spread := speed_apply_late_window_surcharge(v_seconds_left, v_widened_spread);
  v_offered_prob := (v_fair_prob_side::DOUBLE PRECISION + v_widened_spread / 2.0)::DECIMAL;
  IF v_offered_prob > 0.99 THEN v_offered_prob := 0.99;
  ELSIF v_offered_prob < 0.01 THEN v_offered_prob := 0.01;
  END IF;
  SELECT rate INTO v_max_exposure_pct FROM fee_config WHERE fee_type = 'speed_max_market_exposure_pct' LIMIT 1;
  v_max_exposure_pct := COALESCE(v_max_exposure_pct, 0.40);
  v_payout_if_won := p_stake / v_offered_prob;
  IF v_is_reseller_flow THEN v_pool_collateral := GREATEST(v_speed_branch.speed_pool_balance, 0);
  ELSE v_pool_collateral := GREATEST(v_main_pool.speed_pool_balance, 0);
  END IF;
  IF v_pool_collateral > 0 THEN
    SELECT * INTO v_market_exposure FROM speed_market_exposure_live
    WHERE market_id = p_market_id FOR UPDATE;
    SELECT
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'over'), 0),
      COALESCE(SUM(stake / entry_offered_prob) FILTER (WHERE side = 'under'), 0)
    INTO v_over_payout_total, v_under_payout_total
    FROM speed_positions WHERE market_id = p_market_id AND status = 'open';
    IF p_side = 'over' THEN v_side_worst_case := v_over_payout_total + v_payout_if_won;
    ELSE v_side_worst_case := v_under_payout_total + v_payout_if_won;
    END IF;
    IF v_side_worst_case > v_max_exposure_pct * v_pool_collateral THEN
      -- Mig 359 fix: PostgreSQL format() doesn't support C-style %.2f.
      -- Use string concatenation with ROUND for the HINT.
      RAISE EXCEPTION 'Market exposure cap reached on % side', p_side
        USING HINT = 'payout liability $' || ROUND(v_side_worst_case, 2)::TEXT
                  || ' vs cap $' || ROUND(v_max_exposure_pct * v_pool_collateral, 2)::TEXT
                  || ' (40% of $' || ROUND(v_pool_collateral, 2)::TEXT || ' pool)';
    END IF;
  END IF;
  INSERT INTO speed_positions (user_id, market_id, branch_id, side, stake, entry_price, entry_fair_prob, entry_offered_prob, status)
  VALUES (v_user_id, p_market_id, v_routing_branch_id, p_side, p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, 'open')
  RETURNING id INTO v_position_id;
  INSERT INTO speed_trades (position_id, user_id, market_id, branch_id, kind, amount, spot_price, fair_prob, offered_prob, handle_fee, idempotency_key)
  VALUES (v_position_id, v_user_id, p_market_id, v_routing_branch_id, 'open', p_stake, v_oracle.price, v_fair_prob_side, v_offered_prob, v_handle_fee, p_idempotency_key)
  RETURNING id INTO v_trade_id;
  IF v_is_reseller_flow THEN
    v_new_pool_balance := v_speed_branch.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (v_routing_branch_id, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' — ' || p_side);
    v_fee_share_amount := ROUND(v_handle_fee * v_speed_branch.fee_share_pct, 2);
    IF v_fee_share_amount > 0 THEN
      v_new_pool_balance := v_new_pool_balance + v_fee_share_amount;
      INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
      VALUES (v_routing_branch_id, p_market_id, 'fee_share_in', v_fee_share_amount, v_new_pool_balance, v_trade_id,
        'Branch fee share — ' || ROUND(v_speed_branch.fee_share_pct * 100, 1) || '% of $' || ROUND(v_handle_fee, 4));
    END IF;
    UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE branch_id = v_routing_branch_id;
  ELSE
    v_new_pool_balance := v_main_pool.speed_pool_balance + p_stake;
    INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
    VALUES (NULL, p_market_id, 'stake_in', p_stake, v_new_pool_balance, v_trade_id,
      'Speed stake from user ' || v_user_id || ' (main pool) — ' || p_side);
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;
  UPDATE users SET balance_usd = balance_usd - p_stake, updated_at = NOW()
  WHERE id = v_user_id RETURNING balance_usd INTO v_new_balance;
  INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
  VALUES (v_user_id, 'speed_stake', -p_stake, v_new_balance, v_trade_id,
    'Speed bet: ' || p_side || ' on ' || v_market.asset || ' ' || v_market.duration);
  IF NOT v_is_reseller_flow THEN
    v_total_commissions := pay_speed_trade_commissions(v_trade_id, v_user_id, p_stake, p_market_id);
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'position_id', v_position_id, 'trade_id', v_trade_id,
    'side', p_side, 'stake', ROUND(p_stake, 2), 'spot_price', ROUND(v_oracle.price, 8),
    'strike', ROUND(v_market.strike_price, 8), 'fair_prob', ROUND(v_fair_prob_side, 6),
    'offered_prob', ROUND(v_offered_prob, 6), 'payout_if_won', ROUND(p_stake / v_offered_prob, 2),
    'handle_fee', ROUND(v_handle_fee, 4),
    'flow', CASE WHEN v_is_reseller_flow THEN 'reseller' ELSE 'retail_or_commission' END,
    'commissions_paid', ROUND(v_total_commissions, 4));
END;
$_$;


ALTER FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text") IS 'Place a speed bet. Mig 352 (Seams 3+4) + Mig 353 (cap fix) + Mig 354 (90s RV) + Mig 356 (late-window surcharge in last 30s).';



CREATE OR REPLACE FUNCTION "public"."speed_extend_partitions"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  i INTEGER;
  v_count INTEGER := 0;
BEGIN
  FOR i IN 0..13 LOOP
    PERFORM _speed_create_trade_partitions((CURRENT_DATE + i)::DATE);
    PERFORM _speed_create_pool_partitions((CURRENT_DATE + i)::DATE);
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'days_ensured', v_count);
END;
$$;


ALTER FUNCTION "public"."speed_extend_partitions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_extend_partitions"() IS 'Cron-driven RPC. Ensures partitions exist for next 14 days on speed_trades + speed_pool_ledger. Run weekly.';



CREATE OR REPLACE FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE
  v_seconds_left DOUBLE PRECISION;
  v_years_left   DOUBLE PRECISION;
  v_sigma_sqrt_t DOUBLE PRECISION;
  v_d2           DOUBLE PRECISION;
  v_iv_dbl       DOUBLE PRECISION;
  v_fair         DOUBLE PRECISION;
BEGIN
  v_seconds_left := GREATEST(p_seconds_left, 1.0);
  v_years_left := v_seconds_left / (365.0 * 24.0 * 3600.0);
  v_iv_dbl := p_iv::DOUBLE PRECISION;
  v_sigma_sqrt_t := v_iv_dbl * SQRT(v_years_left);

  IF v_sigma_sqrt_t = 0 THEN
    -- Edge: zero time or zero vol → step function
    RETURN CASE WHEN p_spot > p_strike THEN 0.99 ELSE 0.01 END;
  END IF;

  v_d2 := (LN(p_spot::DOUBLE PRECISION / p_strike::DOUBLE PRECISION)
           - (v_iv_dbl * v_iv_dbl * v_years_left) / 2.0) / v_sigma_sqrt_t;
  v_fair := normal_cdf(v_d2);

  -- Mig 357 (cashout invariant fix): tighten clip from Seam 2's [0.001, 0.999]
  -- to [0.01, 0.99] — same as the offered_prob cap. This ensures fair < offered
  -- at extremes, preserving the cashout-round-trip-loses-money invariant.
  -- Seam 3's quadratic widening still handles the user-visible spread at extremes.
  RETURN GREATEST(0.01, LEAST(0.99, v_fair))::DECIMAL;
END;
$$;


ALTER FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) IS 'Mig 318 + Mig 357: Black-Scholes binary fair probability that spot > strike at expiry. Clipped to [0.01, 0.99] (mig 357 reverts mig 352 Seam 2 widening because fair > offered_cap created round-trip arbitrage at extreme moneyness — caught by speed-cashout-invariant.test.ts).';



CREATE OR REPLACE FUNCTION "public"."speed_finalize_pending_markets"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH finalized AS (
    UPDATE speed_markets m
    SET
      strike_price = o.price,
      status       = 'open',
      updated_at   = NOW()
    FROM speed_oracle_latest o
    WHERE m.status        = 'pending'
      AND m.strike_price IS NULL
      AND m.opens_at     <= NOW()
      AND o.asset         = m.asset
    RETURNING m.id
  )
  SELECT COUNT(*) INTO v_count FROM finalized;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."speed_finalize_pending_markets"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_finalize_pending_markets"() IS 'Finalizes any pending speed_market whose opens_at has arrived: sets strike_price from speed_oracle_latest.price for the matching asset and flips status to open. Returns row count. Idempotent — pending rows with NULL oracle stay pending.';



CREATE OR REPLACE FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_id   UUID;
  v_market     RECORD;
  v_breakdown  JSONB;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Unauthorized: admin only';
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'branch_id', t.branch_id,
    'branch_name', t.branch_name,
    'over_stake', t.over_stake,
    'under_stake', t.under_stake,
    'position_count', t.position_count
  )) INTO v_breakdown
  FROM (
    SELECT
      p.branch_id,
      COALESCE(b.name, 'SOOQ Main') AS branch_name,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'over'), 0) AS over_stake,
      COALESCE(SUM(p.stake) FILTER (WHERE p.side = 'under'), 0) AS under_stake,
      COUNT(p.id) AS position_count
    FROM speed_positions p
    LEFT JOIN branches b ON b.id = p.branch_id
    WHERE p.market_id = p_market_id AND p.status = 'open'
    GROUP BY p.branch_id, b.name
  ) t;

  RETURN jsonb_build_object(
    'market_id', p_market_id,
    'asset', v_market.asset,
    'duration', v_market.duration,
    'strike_price', v_market.strike_price,
    'closes_at', v_market.closes_at,
    'status', v_market.status,
    'breakdown', COALESCE(v_breakdown, '[]'::jsonb)
  );
END;
$$;


ALTER FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") IS 'Admin-only per-market drill-down: per-branch over/under exposure for a single open market.';



CREATE OR REPLACE FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer DEFAULT 3600) RETURNS numeric
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_var      DOUBLE PRECISION;
  v_n        INTEGER;
  v_floor    DECIMAL;
  v_use_rv   DECIMAL;
BEGIN
  -- Kill switch: speed_use_realized_vol = 0 → return floor IV directly.
  SELECT rate INTO v_use_rv FROM fee_config WHERE fee_type = 'speed_use_realized_vol' LIMIT 1;
  IF COALESCE(v_use_rv, 1) = 0 THEN
    SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    RETURN COALESCE(v_floor, 0.6);
  END IF;

  WITH closes AS (
    -- Filter to single source so duplicate timestamps don't bias variance.
    SELECT close_price, ts
    FROM speed_oracle_klines
    WHERE asset = p_asset
      AND source = 'binance'
      AND ts >= NOW() - (p_window_seconds || ' seconds')::INTERVAL
    ORDER BY ts
  ),
  rets AS (
    SELECT
      LN(close_price / LAG(close_price) OVER (ORDER BY ts)) AS r,
      EXTRACT(EPOCH FROM (ts - LAG(ts) OVER (ORDER BY ts))) AS dt_s
    FROM closes
  ),
  normalized AS (
    -- per-second variance contribution; gap-robust.
    SELECT (r * r) / NULLIF(dt_s, 0) AS per_sec_var
    FROM rets
    WHERE r IS NOT NULL AND dt_s > 0
  )
  SELECT AVG(per_sec_var), COUNT(*) INTO v_var, v_n FROM normalized;

  IF v_n < 60 OR v_var IS NULL THEN
    -- Insufficient data → fall back to fee_config IV.
    SELECT rate INTO v_floor FROM fee_config WHERE fee_type = 'speed_iv_btc' LIMIT 1;
    RETURN COALESCE(v_floor, 0.6);
  END IF;

  -- Annualize: σ = sqrt(per_sec_var * seconds_per_year), clamped to [0.2, 2.0].
  RETURN GREATEST(0.2, LEAST(2.0, SQRT(v_var * 365.0 * 24.0 * 3600.0)::DECIMAL));
END;
$$;


ALTER FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer) IS 'Mig 352 (Seam 4): annualized realized volatility from speed_oracle_klines. Per-second variance normalization handles gaps. Filters source=binance to avoid duplicate-timestamp bias. Returns σ ∈ [0.2, 2.0]; falls back to fee_config.speed_iv_btc on insufficient data or kill-switch (speed_use_realized_vol=0). STABLE — reads fee_config and klines.';



CREATE OR REPLACE FUNCTION "public"."speed_resolve_expired_markets"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_market         RECORD;
  v_result         JSONB;
  v_results        JSONB := '[]'::JSONB;
  v_resolved       INTEGER := 0;
  v_voided         INTEGER := 0;
  v_failed         INTEGER := 0;
  v_errors         JSONB := '[]'::JSONB;
BEGIN
  FOR v_market IN
    SELECT id FROM speed_markets
    WHERE status IN ('open', 'resolving') AND closes_at <= NOW()
    ORDER BY closes_at
  LOOP
    BEGIN
      v_result := speed_resolve_market(v_market.id);

      IF (v_result->>'voided')::BOOLEAN THEN
        v_voided := v_voided + 1;
      ELSIF (v_result->>'success')::BOOLEAN THEN
        v_resolved := v_resolved + 1;
      END IF;

      v_results := v_results || jsonb_build_object('market_id', v_market.id, 'result', v_result);
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_errors := v_errors || jsonb_build_object(
        'market_id', v_market.id,
        'error', SQLERRM
      );
      PERFORM log_system_event(
        'error'::log_severity, 'speed_cron',
        'Failed to resolve market ' || v_market.id || ': ' || SQLERRM,
        jsonb_build_object('market_id', v_market.id, 'error', SQLERRM)
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'resolved', v_resolved,
    'voided', v_voided,
    'failed', v_failed,
    'errors', v_errors
  );
END;
$$;


ALTER FUNCTION "public"."speed_resolve_expired_markets"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_resolve_expired_markets"() IS 'Cron-driven RPC. Finds all expired open/resolving markets and resolves them. Idempotent via speed_resolve_market advisory lock.';



CREATE OR REPLACE FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_lock_acquired   BOOLEAN;
  v_market          RECORD;
  v_settlement_price DECIMAL;
  v_settlement_tick_ts TIMESTAMPTZ;
  v_window_start    TIMESTAMPTZ;
  v_window_end      TIMESTAMPTZ;
  v_outcome         speed_market_outcome;
  v_pos             RECORD;
  v_payout          DECIMAL;
  v_winners         INTEGER := 0;
  v_losers          INTEGER := 0;
  v_total_paid      DECIMAL := 0;
  v_existing        RECORD;
  v_new_balance     DECIMAL;
  v_new_pool_balance DECIMAL;
  v_main_pool       RECORD;
  v_main_pool_locked BOOLEAN := FALSE;
  v_voided          BOOLEAN := FALSE;
  v_void_reason     TEXT;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', true);

  v_lock_acquired := pg_try_advisory_xact_lock(hashtext('speed_resolve_' || p_market_id::TEXT));
  IF NOT v_lock_acquired THEN
    RETURN jsonb_build_object('skipped', TRUE, 'reason', 'Another invocation is already resolving this market');
  END IF;

  SELECT * INTO v_market FROM speed_markets WHERE id = p_market_id FOR UPDATE;
  IF v_market IS NULL THEN RAISE EXCEPTION 'Market not found'; END IF;
  IF v_market.status NOT IN ('open', 'resolving') THEN
    RETURN jsonb_build_object('skipped', TRUE, 'status', v_market.status, 'reason', 'Market not in resolvable state');
  END IF;
  IF NOW() < v_market.closes_at THEN RAISE EXCEPTION 'Market has not closed yet'; END IF;

  UPDATE speed_markets SET status = 'resolving', updated_at = NOW() WHERE id = p_market_id AND status = 'open';

  v_window_start := v_market.closes_at - INTERVAL '2 seconds';
  v_window_end   := v_market.closes_at;

  SELECT price, ts INTO v_settlement_price, v_settlement_tick_ts
  FROM speed_oracle_ticks
  WHERE asset = v_market.asset AND ts >= v_window_start AND ts < v_window_end
  ORDER BY ts DESC
  LIMIT 1;

  IF v_settlement_price IS NULL THEN
    v_voided := TRUE;
    v_void_reason := 'No oracle tick available within 2s before closes_at';
  END IF;

  IF v_voided THEN
    FOR v_pos IN SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open' LOOP
      SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
      IF FOUND THEN CONTINUE; END IF;
      UPDATE users SET balance_usd = balance_usd + v_pos.stake, updated_at = NOW()
      WHERE id = v_pos.user_id RETURNING balance_usd INTO v_new_balance;
      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_refund', v_pos.stake, v_new_balance, v_pos.id, 'Speed market voided — full refund');
      UPDATE speed_positions SET status = 'refunded', payout_amount = v_pos.stake, closed_at = NOW() WHERE id = v_pos.id;
      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id, 'Refund (market voided)');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing'; END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_pos.stake;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, p_market_id, 'refund', -v_pos.stake, v_new_pool_balance, v_pos.id, 'Refund from main pool (market voided)');
      END IF;
      INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
      VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, 'at_strike', v_pos.stake);
      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_voided', 'Speed market voided', 'تم إلغاء السوق السريع',
        'Your ' || v_market.asset || ' ' || v_market.duration || ' bet was voided. $' || ROUND(v_pos.stake, 2) || ' refunded.',
        'تم إلغاء رهانك ' || v_market.asset || ' ' || v_market.duration || '. تم إعادة $' || ROUND(v_pos.stake, 2) || '.',
        v_pos.id);
    END LOOP;
    IF v_main_pool_locked THEN
      UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
    END IF;
    UPDATE speed_markets SET status = 'voided', voided_at = NOW(), void_reason = v_void_reason, updated_at = NOW() WHERE id = p_market_id;
    RETURN jsonb_build_object('success', TRUE, 'voided', TRUE, 'reason', v_void_reason,
      'positions_refunded', (SELECT COUNT(*) FROM speed_settlements WHERE market_id = p_market_id));
  END IF;

  IF v_settlement_price > v_market.strike_price THEN v_outcome := 'over';
  ELSIF v_settlement_price < v_market.strike_price THEN v_outcome := 'under';
  ELSE v_outcome := 'at_strike';
  END IF;

  FOR v_pos IN SELECT * FROM speed_positions WHERE market_id = p_market_id AND status = 'open' ORDER BY user_id LOOP
    SELECT * INTO v_existing FROM speed_settlements WHERE position_id = v_pos.id;
    IF FOUND THEN CONTINUE; END IF;
    IF v_outcome = 'at_strike' THEN
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW() WHERE id = v_pos.id;
      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_at_strike', 'Closed exactly at strike', 'أُغلق عند السعر بالضبط',
        v_market.asset || ' ' || v_market.duration || ' closed at strike. Both sides lose.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق عند السعر المرجعي. كلا الجانبين يخسر.',
        v_pos.id);
    ELSIF v_pos.side::TEXT = v_outcome::TEXT THEN
      v_payout := ROUND(v_pos.stake / v_pos.entry_offered_prob, 2);
      v_winners := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;
      UPDATE speed_positions SET status = 'won', payout_amount = v_payout, closed_at = NOW() WHERE id = v_pos.id;
      UPDATE users SET balance_usd = balance_usd + v_payout, updated_at = NOW()
      WHERE id = v_pos.user_id RETURNING balance_usd INTO v_new_balance;
      INSERT INTO transactions (user_id, type, amount, balance_after, reference_id, description)
      VALUES (v_pos.user_id, 'speed_winning', v_payout, v_new_balance, v_pos.id, 'Speed win on ' || v_outcome::TEXT);
      IF v_pos.branch_id IS NOT NULL THEN
        SELECT speed_pool_balance INTO v_new_pool_balance FROM speed_branches WHERE branch_id = v_pos.branch_id;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (v_pos.branch_id, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout (' || v_outcome::TEXT || ')');
        UPDATE speed_branches SET speed_pool_balance = v_new_pool_balance WHERE branch_id = v_pos.branch_id;
      ELSE
        IF NOT v_main_pool_locked THEN
          SELECT * INTO v_main_pool FROM speed_main_pool_state WHERE id = 1 FOR UPDATE;
          IF v_main_pool IS NULL THEN RAISE EXCEPTION 'speed_main_pool_state row missing'; END IF;
          v_main_pool_locked := TRUE;
          v_new_pool_balance := v_main_pool.speed_pool_balance;
        END IF;
        v_new_pool_balance := v_new_pool_balance - v_payout;
        INSERT INTO speed_pool_ledger (branch_id, market_id, type, amount, balance_after, reference_id, description)
        VALUES (NULL, p_market_id, 'winning_payout', -v_payout, v_new_pool_balance, v_pos.id,
          'Winning payout from main pool (' || v_outcome::TEXT || ')');
      END IF;
      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_won',
        'You won! +$' || ROUND(v_payout, 2), 'لقد ربحت! +$' || ROUND(v_payout, 2),
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_settlement_price, 2) || '. Payout $' || ROUND(v_payout, 2) || '.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_settlement_price, 2) || '. العائد $' || ROUND(v_payout, 2) || '.',
        v_pos.id);
    ELSE
      v_payout := 0;
      v_losers := v_losers + 1;
      UPDATE speed_positions SET status = 'lost', payout_amount = 0, closed_at = NOW() WHERE id = v_pos.id;
      INSERT INTO notifications (user_id, type, title_en, title_ar, body_en, body_ar, reference_id)
      VALUES (v_pos.user_id, 'speed_market_lost', 'Speed bet settled', 'انتهى الرهان السريع',
        v_market.asset || ' ' || v_market.duration || ' settled ' || v_outcome::TEXT || ' at $' || ROUND(v_settlement_price, 2) || '. Better luck next round.',
        v_market.asset || ' ' || v_market.duration || ' أُغلق ' || v_outcome::TEXT || ' عند $' || ROUND(v_settlement_price, 2) || '. حظاً أوفر المرة القادمة.',
        v_pos.id);
    END IF;
    INSERT INTO speed_settlements (position_id, market_id, user_id, branch_id, outcome, payout_amount)
    VALUES (v_pos.id, p_market_id, v_pos.user_id, v_pos.branch_id, v_outcome, v_payout);
  END LOOP;

  IF v_main_pool_locked THEN
    UPDATE speed_main_pool_state SET speed_pool_balance = v_new_pool_balance, updated_at = NOW() WHERE id = 1;
  END IF;

  UPDATE speed_markets SET
    status = 'resolved', outcome = v_outcome, settlement_price = v_settlement_price,
    twap_window_start = v_window_start, twap_window_end = v_settlement_tick_ts,
    twap_tick_count = 1, resolved_at = NOW(), updated_at = NOW()
  WHERE id = p_market_id;

  RETURN jsonb_build_object('success', TRUE, 'voided', FALSE, 'outcome', v_outcome::TEXT,
    'settlement_price', ROUND(v_settlement_price, 8), 'settlement_tick_ts', v_settlement_tick_ts,
    'winners', v_winners, 'losers', v_losers, 'total_paid', ROUND(v_total_paid, 2));
END;
$_$;


ALTER FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") IS 'Resolve an expired speed market. Mig 355: switches from 30s TWAP averaging to single-tick settlement at closes_at (2s fallback window). Renames twap_settlement_price column to settlement_price. Mig 345 main-pool sentinel locking preserved. Voids on no-tick.';



CREATE OR REPLACE FUNCTION "public"."speed_roll_markets"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_master_enabled    DECIMAL;
  v_oracle_stale_secs DECIMAL;
  v_assets            speed_asset[];
  v_durations         speed_duration[];
  v_asset             speed_asset;
  v_duration          speed_duration;
  v_oracle            RECORD;
  v_opens_at          TIMESTAMPTZ;
  v_closes_at         TIMESTAMPTZ;
  v_market_id         UUID;
  v_created_count     INTEGER := 0;
  v_skipped_count     INTEGER := 0;
  v_finalized_count   INTEGER := 0;
  v_created_markets   JSONB := '[]'::JSONB;
BEGIN
  SELECT rate INTO v_master_enabled FROM fee_config WHERE fee_type = 'speed_markets_enabled' LIMIT 1;
  IF COALESCE(v_master_enabled, 0) = 0 THEN
    RETURN jsonb_build_object('success', TRUE, 'skipped', 'master_kill_active', 'created', 0);
  END IF;

  SELECT rate INTO v_oracle_stale_secs FROM fee_config WHERE fee_type = 'speed_oracle_stale_seconds' LIMIT 1;
  v_oracle_stale_secs := COALESCE(v_oracle_stale_secs, 2);

  v_assets    := ARRAY['BTC']::speed_asset[];
  v_durations := ARRAY['5m', '1h']::speed_duration[];

  FOREACH v_asset IN ARRAY v_assets LOOP
    SELECT * INTO v_oracle FROM speed_oracle_latest WHERE asset = v_asset;
    IF v_oracle IS NULL
       OR EXTRACT(EPOCH FROM (NOW() - v_oracle.received_at)) > v_oracle_stale_secs THEN
      v_skipped_count := v_skipped_count + array_length(v_durations, 1);
      CONTINUE;
    END IF;

    FOREACH v_duration IN ARRAY v_durations LOOP
      v_opens_at  := _next_clean_boundary(v_duration, NOW());
      v_closes_at := CASE v_duration
        WHEN '5m'::speed_duration  THEN v_opens_at + INTERVAL '5 minutes'
        WHEN '15m'::speed_duration THEN v_opens_at + INTERVAL '15 minutes'
        WHEN '1h'::speed_duration  THEN v_opens_at + INTERVAL '1 hour'
        WHEN '24h'::speed_duration THEN v_opens_at + INTERVAL '1 day'
      END;

      IF v_duration = '24h' AND v_closes_at - NOW() < INTERVAL '1 hour' THEN
        v_skipped_count := v_skipped_count + 1;
        CONTINUE;
      END IF;

      v_market_id := NULL;

      INSERT INTO speed_markets (
        asset, duration, strike_price, opens_at, closes_at, status
      ) VALUES (
        v_asset, v_duration, NULL, v_opens_at, v_closes_at, 'pending'
      )
      ON CONFLICT (asset, duration, opens_at) DO NOTHING
      RETURNING id INTO v_market_id;

      IF v_market_id IS NULL THEN
        v_skipped_count := v_skipped_count + 1;
      ELSE
        v_created_count := v_created_count + 1;
        v_created_markets := v_created_markets || jsonb_build_object(
          'id',        v_market_id,
          'asset',     v_asset,
          'duration',  v_duration,
          'opens_at',  v_opens_at,
          'closes_at', v_closes_at
        );
      END IF;
    END LOOP;
  END LOOP;

  v_finalized_count := speed_finalize_pending_markets();

  RETURN jsonb_build_object(
    'success',   TRUE,
    'created',   v_created_count,
    'skipped',   v_skipped_count,
    'finalized', v_finalized_count,
    'markets',   v_created_markets
  );
END;
$$;


ALTER FUNCTION "public"."speed_roll_markets"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_roll_markets"() IS 'Mig 363: swapped 24h for 1h. Active offering is 5m + 1h. Historical 15m/24h rows remain queryable.';



CREATE OR REPLACE FUNCTION "public"."speed_rv_refresh"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO speed_realized_vol_cache (asset, rv, computed_at)
  SELECT 'BTC'::speed_asset, speed_realized_vol('BTC'::speed_asset, 3600), NOW()
  ON CONFLICT (asset) DO UPDATE
    SET rv = EXCLUDED.rv, computed_at = EXCLUDED.computed_at;
END;
$$;


ALTER FUNCTION "public"."speed_rv_refresh"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."speed_rv_refresh"() IS 'Mig 352 (Seam 4): writes the latest 1h-window σ into speed_realized_vol_cache for BTC. Called by pg_cron every 60s (job: speed-rv-refresh — see Part C.5; Supabase pg_cron does not support 6-field sub-minute schedules). When more assets are added, expand this to loop through speed_asset values.';



CREATE OR REPLACE FUNCTION "public"."speed_time_bucket"("p_seconds_total" double precision, "p_seconds_left" double precision) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
DECLARE v_pct DOUBLE PRECISION;
BEGIN
  IF p_seconds_total <= 0 THEN RETURN 'low'; END IF;
  v_pct := p_seconds_left / p_seconds_total;
  IF v_pct >= 0.6 THEN RETURN 'high';
  ELSIF v_pct >= 0.2 THEN RETURN 'mid';
  ELSE RETURN 'low';
  END IF;
END;
$$;


ALTER FUNCTION "public"."speed_time_bucket"("p_seconds_total" double precision, "p_seconds_left" double precision) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."staging_full_reset"() RETURNS "text"
    LANGUAGE "plpgsql"
    AS $$
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
  DELETE FROM deposits;
  DELETE FROM withdrawals;
  DELETE FROM leader_stats;
  DELETE FROM price_alerts;
  DELETE FROM platform_revenue;
  DELETE FROM system_logs;
  DELETE FROM prelaunch_votes;
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
$$;


ALTER FUNCTION "public"."staging_full_reset"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."submit_manual_deposit"("p_amount" numeric, "p_whish_number" "text" DEFAULT NULL::"text", "p_proof_image_url" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
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
$$;


ALTER FUNCTION "public"."submit_manual_deposit"("p_amount" numeric, "p_whish_number" "text", "p_proof_image_url" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sweep_agent_microcredits"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."sweep_agent_microcredits"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sweep_agent_microcredits"() IS 'Monthly sweep of sub-cent P/L accruals. Any agent_pending_microcredits row with accrued_amount >= $0.01 gets materialized as a referral_commissions row + agent_balance credit + transaction ledger entry. Call from the same monthly cron that unlocks commissions.';



CREATE OR REPLACE FUNCTION "public"."toggle_agent_activation_override"("p_user_id" "uuid", "p_override" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


ALTER FUNCTION "public"."toggle_agent_activation_override"("p_user_id" "uuid", "p_override" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_demo_mode"("p_enabled" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id UUID;
  v_granted BOOLEAN := FALSE;
  v_new_balance DECIMAL;
  v_first_enabled_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  PERFORM set_config('app.trigger_bypass', 'true', true);

  IF p_enabled THEN
    -- Atomic first-enable: only one caller can pass the WHERE guard.
    UPDATE users
    SET demo_balance_usd = 10000,
        demo_first_enabled_at = now(),
        demo_mode = TRUE,
        updated_at = NOW()
    WHERE id = v_user_id
      AND demo_first_enabled_at IS NULL
    RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;

    IF FOUND THEN
      v_granted := TRUE;
      -- Seed the ledger with the initial grant.
      INSERT INTO demo_transactions (user_id, type, amount, balance_after, description)
      VALUES (v_user_id, 'demo_seed', 10000, v_new_balance, 'Initial demo balance grant');
    ELSE
      -- Already initialized — just flip the preference flag.
      UPDATE users
      SET demo_mode = TRUE,
          updated_at = NOW()
      WHERE id = v_user_id
      RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;
    END IF;
  ELSE
    -- Disable: just flip the preference. Balance + positions preserved.
    UPDATE users
    SET demo_mode = FALSE,
        updated_at = NOW()
    WHERE id = v_user_id
    RETURNING demo_balance_usd, demo_first_enabled_at INTO v_new_balance, v_first_enabled_at;
  END IF;

  RETURN jsonb_build_object(
    'demo_mode', p_enabled,
    'demo_balance_usd', v_new_balance,
    'demo_first_enabled_at', v_first_enabled_at,
    'granted_initial_balance', v_granted
  );
END;
$$;


ALTER FUNCTION "public"."toggle_demo_mode"("p_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."toggle_user_freeze"("p_user_id" "uuid", "p_frozen" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
DECLARE
  v_admin_id UUID;
BEGIN
  v_admin_id := auth.uid();
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = v_admin_id AND is_admin = TRUE) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  UPDATE users SET is_frozen = p_frozen WHERE id = p_user_id;

  RETURN jsonb_build_object('success', TRUE, 'frozen', p_frozen);
END;
$$;


ALTER FUNCTION "public"."toggle_user_freeze"("p_user_id" "uuid", "p_frozen" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transfer_agent_to_portfolio"("p_amount" numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_user_id UUID;
  v_user RECORD;
  v_new_agent_balance NUMERIC;
  v_new_portfolio_balance NUMERIC;
  v_pending NUMERIC;
  v_available NUMERIC;
  v_pl_aggregate DECIMAL;
BEGIN
  PERFORM set_config('app.trigger_bypass', 'true', TRUE);

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = v_user_id FOR UPDATE;

  IF v_user.is_frozen THEN
    RAISE EXCEPTION 'Account is frozen';
  END IF;

  -- PR 3 NEW: block transfer if user has negative aggregate cumulative_pl
  -- across all their branch_agent rows. The "P/L debt" must be covered
  -- by future earnings before they can withdraw anything.
  SELECT COALESCE(SUM(cumulative_pl), 0) INTO v_pl_aggregate
  FROM branch_agents
  WHERE user_id = v_user_id;

  IF v_pl_aggregate < 0 THEN
    RAISE EXCEPTION 'P/L debt outstanding ($%) — cover via future earnings before withdrawing',
      ROUND(-v_pl_aggregate, 2);
  END IF;

  -- PR 1: compute pending (locked) and available balances
  SELECT COALESCE(SUM(commission_amount), 0) INTO v_pending
  FROM referral_commissions
  WHERE referrer_id = v_user_id
    AND status = 'credited'
    AND unlock_at IS NOT NULL
    AND unlock_at > NOW();

  v_available := GREATEST(v_user.agent_balance_usd - v_pending, 0);

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Insufficient unlocked balance (available: $%, pending: $%, requested: $%)',
      ROUND(v_available, 2), ROUND(v_pending, 2), ROUND(p_amount, 2);
  END IF;

  IF v_user.agent_balance_usd < p_amount THEN
    RAISE EXCEPTION 'Insufficient agent wallet balance';
  END IF;

  UPDATE users
  SET agent_balance_usd = agent_balance_usd - p_amount,
      balance_usd = balance_usd + p_amount
  WHERE id = v_user_id
  RETURNING agent_balance_usd, balance_usd
  INTO v_new_agent_balance, v_new_portfolio_balance;

  INSERT INTO transactions (user_id, type, amount, balance_after, description)
  VALUES
    (v_user_id, 'agent_transfer_out', -p_amount, v_new_agent_balance,
     'Transfer from Agent Wallet to Portfolio'),
    (v_user_id, 'agent_transfer_in', p_amount, v_new_portfolio_balance,
     'Transfer from Agent Wallet to Portfolio');

  RETURN jsonb_build_object(
    'agent_balance_usd', v_new_agent_balance,
    'balance_usd', v_new_portfolio_balance,
    'available', GREATEST(v_new_agent_balance - v_pending, 0),
    'pending', v_pending
  );
END;
$_$;


ALTER FUNCTION "public"."transfer_agent_to_portfolio"("p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_speed_finalize_on_oracle"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM speed_finalize_pending_markets();
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trg_speed_finalize_on_oracle"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."trg_speed_finalize_on_oracle"() IS 'Trigger body for speed_oracle_finalize_pending. Calls speed_finalize_pending_markets() on every oracle upsert so newly-mature pending markets pick up a strike within ~1 second.';



CREATE OR REPLACE FUNCTION "public"."update_agent_level"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $_$
DECLARE
  v_user RECORD;
  v_new_level INTEGER;
BEGIN
  -- Auth check: allow service_role, admins, and internal trigger calls
  IF auth.uid() IS NOT NULL
    AND current_setting('app.trigger_bypass', TRUE) IS DISTINCT FROM 'true'
    AND NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND is_admin = TRUE)
  THEN
    RAISE EXCEPTION 'update_agent_level: unauthorized — admin or service_role only';
  END IF;

  SELECT * INTO v_user FROM users WHERE id = p_user_id FOR UPDATE;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  -- Volume-based thresholds (replaces direct_referral_count thresholds)
  v_new_level := CASE
    WHEN v_user.network_volume >= 200000 THEN 4  -- Tier 4: $200K+
    WHEN v_user.network_volume >= 50000  THEN 3  -- Tier 3: $50K+
    WHEN v_user.network_volume >= 10000  THEN 2  -- Tier 2: $10K+
    ELSE 1                                        -- Tier 1: default
  END;

  -- Ratchet: only go up
  IF v_new_level > v_user.agent_level THEN
    UPDATE users SET agent_level = v_new_level WHERE id = p_user_id;
  END IF;

  RETURN GREATEST(v_new_level, v_user.agent_level);
END;
$_$;


ALTER FUNCTION "public"."update_agent_level"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_branch_agent_deal"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric DEFAULT 0) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_caller UUID;
  v_agent RECORD;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT ba.*, b.manager_user_id
  INTO v_agent
  FROM branch_agents ba
  JOIN branches b ON b.id = ba.branch_id
  WHERE ba.id = p_agent_id;

  IF v_agent IS NULL THEN
    RAISE EXCEPTION 'Agent not found';
  END IF;

  IF v_agent.manager_user_id != v_caller THEN
    RAISE EXCEPTION 'Not authorized: not branch manager';
  END IF;

  IF v_agent.status != 'approved' THEN
    RAISE EXCEPTION 'Can only update deal for approved agents';
  END IF;

  IF p_rate IS NULL OR p_rate <= 0 OR p_rate > 1.0 THEN
    RAISE EXCEPTION 'Invalid rate: must be between 0 and 1';
  END IF;

  IF p_agent_type NOT IN ('pl', 'commission') THEN
    RAISE EXCEPTION 'Invalid agent type: must be pl or commission';
  END IF;

  UPDATE branch_agents
  SET agent_type = p_agent_type::branch_agent_type,
      rate = p_rate,
      deposit_required = COALESCE(p_deposit_required, 0),
      updated_at = now()
  WHERE id = p_agent_id;

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'agent_type', p_agent_type,
    'rate', p_rate,
    'deposit_required', COALESCE(p_deposit_required, 0)
  );
END;
$$;


ALTER FUNCTION "public"."update_branch_agent_deal"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_branch_config"("p_branch_id" "uuid", "p_yes_markup" numeric DEFAULT NULL::numeric, "p_no_markup" numeric DEFAULT NULL::numeric, "p_exit_fee" numeric DEFAULT NULL::numeric, "p_display_mode" "text" DEFAULT NULL::"text", "p_cash_out_enabled" boolean DEFAULT NULL::boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_branch RECORD;
BEGIN
  -- Lock and fetch
  SELECT * INTO v_branch FROM branches WHERE id = p_branch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Branch not found';
  END IF;

  -- Auth check: caller must be the branch manager
  IF v_branch.manager_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  -- Validate ranges
  IF p_yes_markup IS NOT NULL AND (p_yes_markup < 0 OR p_yes_markup > 0.50) THEN
    RAISE EXCEPTION 'YES markup must be 0-50%%';
  END IF;
  IF p_no_markup IS NOT NULL AND (p_no_markup < 0 OR p_no_markup > 0.50) THEN
    RAISE EXCEPTION 'NO markup must be 0-50%%';
  END IF;
  IF p_exit_fee IS NOT NULL AND (p_exit_fee < 0 OR p_exit_fee > 0.10) THEN
    RAISE EXCEPTION 'Exit fee must be 0-10%%';
  END IF;
  IF p_display_mode IS NOT NULL AND p_display_mode NOT IN ('betting', 'trading', 'hybrid') THEN
    RAISE EXCEPTION 'Invalid display mode';
  END IF;

  -- Update only allowed columns
  UPDATE branches SET
    yes_markup_pct   = COALESCE(p_yes_markup, yes_markup_pct),
    no_markup_pct    = COALESCE(p_no_markup, no_markup_pct),
    exit_fee_pct     = COALESCE(p_exit_fee, exit_fee_pct),
    display_mode     = COALESCE(p_display_mode, display_mode),
    cash_out_enabled = COALESCE(p_cash_out_enabled, cash_out_enabled),
    updated_at       = NOW()
  WHERE id = p_branch_id;
END;
$$;


ALTER FUNCTION "public"."update_branch_config"("p_branch_id" "uuid", "p_yes_markup" numeric, "p_no_markup" numeric, "p_exit_fee" numeric, "p_display_mode" "text", "p_cash_out_enabled" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_homepage_ranks"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Reset all ranks
  UPDATE markets SET homepage_rank = NULL WHERE homepage_rank IS NOT NULL;

  -- Assign ranks atomically using ROW_NUMBER
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY trade_count DESC) AS rn
    FROM markets
    WHERE status = 'open'
  )
  UPDATE markets m
  SET homepage_rank = r.rn
  FROM ranked r
  WHERE m.id = r.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."update_homepage_ranks"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_market"("p_market_id" "uuid", "p_pin" "text" DEFAULT NULL::"text", "p_token" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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

  IF p_token IS NOT NULL THEN
    PERFORM _verify_admin_token(v_user_id, p_token, 'void_market');
  ELSE
    PERFORM _verify_admin_pin(v_user_id, p_pin);
  END IF;

  SELECT * INTO v_market FROM markets WHERE id = p_market_id;
  IF v_market IS NULL THEN
    RAISE EXCEPTION 'Market not found';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be voided (status: %)', v_market.status;
  END IF;

  v_result := _void_market_internal(p_market_id);

  INSERT INTO system_logs (severity, source, message, context)
  VALUES ('info', 'admin/void', 'Market voided',
    jsonb_build_object('admin_id', v_user_id, 'market_id', p_market_id, 'question', v_market.question_en));

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."void_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_user_id" "uuid",
    "pin_hash" "text" NOT NULL,
    "failed_pin_attempts" integer DEFAULT 0,
    "pin_locked_until" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "hmac_secret" "text"
);


ALTER TABLE "public"."admin_config" OWNER TO "postgres";


COMMENT ON COLUMN "public"."admin_config"."hmac_secret" IS '32-byte hex-encoded secret used to sign admin operation tokens. Rotated whenever pin_hash is updated. NEVER displayed in UI; only used server-side to sign/verify tokens.';



CREATE TABLE IF NOT EXISTS "public"."agent_pending_microcredits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "agent_id" "uuid" NOT NULL,
    "agent_user_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "accrued_amount" numeric(18,6) DEFAULT 0 NOT NULL,
    "last_accrual_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_sweep_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."agent_pending_microcredits" OWNER TO "postgres";


COMMENT ON TABLE "public"."agent_pending_microcredits" IS 'Per-(agent_id, branch_id) accumulator for sub-cent P/L amounts that do not meet the $0.01 floor to create a commission row. Swept monthly by sweep_agent_microcredits() - any accumulator >= $0.01 is materialized as a proper referral_commissions row and zeroed. Prevents silent loss of micro-earnings.';



CREATE TABLE IF NOT EXISTS "public"."amm_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "liquidity_param" numeric(18,6) DEFAULT 1000 NOT NULL,
    "q_yes" numeric(18,6) DEFAULT 0 NOT NULL,
    "q_no" numeric(18,6) DEFAULT 0 NOT NULL,
    "current_yes_price" numeric(10,6) DEFAULT 0.500000 NOT NULL,
    "current_no_price" numeric(10,6) DEFAULT 0.500000 NOT NULL,
    "total_volume" numeric(18,2) DEFAULT 0 NOT NULL,
    "total_trades" integer DEFAULT 0 NOT NULL,
    "seed_pnl" numeric(18,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "retail_net_cash" numeric(18,2) DEFAULT 0 NOT NULL,
    "retail_shares_yes" numeric(18,6) DEFAULT 0 NOT NULL,
    "retail_shares_no" numeric(18,6) DEFAULT 0 NOT NULL,
    CONSTRAINT "amm_liquidity_positive" CHECK (("liquidity_param" > (0)::numeric)),
    CONSTRAINT "amm_prices_valid" CHECK ((("current_yes_price" >= 0.000001) AND ("current_yes_price" <= 0.999999) AND ("current_no_price" >= 0.000001) AND ("current_no_price" <= 0.999999)))
);


ALTER TABLE "public"."amm_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_admin_overrides" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "admin_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "override_type" "public"."branch_override_type" NOT NULL,
    "note" "text" NOT NULL,
    "previous_value" "jsonb",
    "new_value" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."branch_admin_overrides" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_agents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "parent_agent_id" "uuid",
    "agent_type" "public"."branch_agent_type",
    "rate" numeric(8,6),
    "deposit_required" numeric(18,2) DEFAULT 0 NOT NULL,
    "deposit_held" numeric(18,2) DEFAULT 0 NOT NULL,
    "cumulative_pl" numeric(18,2) DEFAULT 0 NOT NULL,
    "referral_code" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "status" "public"."branch_agent_status" DEFAULT 'pending'::"public"."branch_agent_status" NOT NULL,
    "rejection_reason" "text",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    CONSTRAINT "branch_agents_deposit_held_check" CHECK (("deposit_held" >= (0)::numeric)),
    CONSTRAINT "branch_agents_rate_check" CHECK ((("rate" IS NULL) OR (("rate" > (0)::numeric) AND ("rate" <= 1.000000))))
);


ALTER TABLE "public"."branch_agents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_market_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "is_enabled" boolean DEFAULT true NOT NULL,
    "cash_out_enabled" boolean,
    "position_cap_yes" numeric(18,2),
    "position_cap_no" numeric(18,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."branch_market_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."referral_commissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid" NOT NULL,
    "trader_id" "uuid" NOT NULL,
    "market_id" "uuid",
    "layer" integer NOT NULL,
    "agent_level_at_time" integer NOT NULL,
    "commission_rate" numeric(5,4) NOT NULL,
    "commission_amount" numeric(18,6) NOT NULL,
    "status" "public"."commission_status" DEFAULT 'escrowed'::"public"."commission_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "trade_id" "uuid",
    "platform_revenue_amount" numeric(18,6) DEFAULT 0 NOT NULL,
    "revenue_type" "text" DEFAULT 'trade'::"text" NOT NULL,
    "unlock_at" timestamp with time zone,
    "source_type" "public"."commission_source_type" DEFAULT 'referral_trade'::"public"."commission_source_type" NOT NULL,
    "branch_id" "uuid",
    CONSTRAINT "chk_revenue_type" CHECK (("revenue_type" = ANY (ARRAY['trade'::"text", 'resolution'::"text"]))),
    CONSTRAINT "referral_commissions_agent_level_at_time_check" CHECK ((("agent_level_at_time" >= 1) AND ("agent_level_at_time" <= 4))),
    CONSTRAINT "referral_commissions_depth_check" CHECK ((("layer" >= 1) AND ("layer" <= 3)))
);


ALTER TABLE "public"."referral_commissions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."referral_commissions"."market_id" IS 'Market the commission accrued on. NULL for branch_pl microcredit sweep rows which aggregate sub-cent P/L across multiple markets.';



COMMENT ON COLUMN "public"."referral_commissions"."unlock_at" IS 'Timestamp when this commission becomes transferable from agent wallet to portfolio. NULL = instantly available (grandfathered pre-migration rows, admin credits, or when commission_hold_enabled = 0). Set by _credit_commission based on fee_config.commission_hold_enabled.';



COMMENT ON COLUMN "public"."referral_commissions"."source_type" IS 'Discriminator: which commission flow produced this row. referral_trade/referral_resolution for retail, branch_commission for branch commission-type agents (PR 2), branch_pl reserved for PR 3.';



COMMENT ON COLUMN "public"."referral_commissions"."branch_id" IS 'Non-null for branch-sourced commissions. References branches(id) for scoped reporting.';



CREATE OR REPLACE VIEW "public"."branch_pending_liabilities" WITH ("security_invoker"='true') AS
 SELECT "referrer_id" AS "agent_user_id",
    "branch_id",
    COALESCE("sum"("commission_amount"), (0)::numeric) AS "pending_amount",
    "min"("unlock_at") AS "next_unlock_at",
    "count"(*) AS "pending_count"
   FROM "public"."referral_commissions"
  WHERE (("status" = 'credited'::"public"."commission_status") AND ("source_type" = ANY (ARRAY['branch_commission'::"public"."commission_source_type", 'branch_pl'::"public"."commission_source_type"])) AND ("branch_id" IS NOT NULL) AND ("unlock_at" IS NOT NULL) AND ("unlock_at" > "now"()))
  GROUP BY "referrer_id", "branch_id";


ALTER VIEW "public"."branch_pending_liabilities" OWNER TO "postgres";


COMMENT ON VIEW "public"."branch_pending_liabilities" IS 'Live view of commissions owed to branch agents that have not yet unlocked. Summed per (agent_user_id, branch_id). Used by get_branch_owner_summary and transfer_branch_pool_to_owner_portfolio.';



CREATE TABLE IF NOT EXISTS "public"."branch_pools" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "market_id" "uuid",
    "type" "public"."branch_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."branch_pools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_revenue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "markup_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "explicit_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "exit_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "resolution_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "total_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sooq_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL
);


ALTER TABLE "public"."branch_revenue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "trade_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "agent_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "gross_amount" numeric(18,2) NOT NULL,
    "branch_markup" numeric(18,2) NOT NULL,
    "net_canonical_amount" numeric(18,2) NOT NULL,
    "branch_quote_shown" numeric(10,6),
    "canonical_pre_yes_price" numeric(10,6) NOT NULL,
    "canonical_pre_no_price" numeric(10,6) NOT NULL,
    "canonical_post_yes_price" numeric(10,6) NOT NULL,
    "canonical_post_no_price" numeric(10,6) NOT NULL,
    "shares_issued" numeric(18,6) NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "direction" "text" NOT NULL,
    "exit_fee_amount" numeric(18,2) DEFAULT 0,
    CONSTRAINT "branch_trades_branch_markup_check" CHECK (("branch_markup" >= (0)::numeric)),
    CONSTRAINT "branch_trades_direction_check" CHECK (("direction" = ANY (ARRAY['buy'::"text", 'sell'::"text"]))),
    CONSTRAINT "branch_trades_shares_issued_check" CHECK (("shares_issued" > (0)::numeric))
);


ALTER TABLE "public"."branch_trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branch_user_assignments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "agent_id" "uuid",
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."branch_user_assignments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."branches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "public"."branch_status" DEFAULT 'active'::"public"."branch_status" NOT NULL,
    "manager_user_id" "uuid" NOT NULL,
    "yes_markup_pct" numeric(5,4) DEFAULT 0.0500 NOT NULL,
    "no_markup_pct" numeric(5,4) DEFAULT 0.0500 NOT NULL,
    "branch_fee_rate" numeric(8,6) DEFAULT 0.050000 NOT NULL,
    "exit_fee_pct" numeric(5,4) DEFAULT 0.0050 NOT NULL,
    "display_mode" "public"."branch_display_mode" DEFAULT 'betting'::"public"."branch_display_mode" NOT NULL,
    "cash_out_enabled" boolean DEFAULT true NOT NULL,
    "pool_balance" numeric(18,2) DEFAULT 0 NOT NULL,
    "worst_case_total" numeric(18,2) DEFAULT 0 NOT NULL,
    "pending_payouts" numeric(18,2) DEFAULT 0 NOT NULL,
    "default_position_cap_yes" numeric(18,2),
    "default_position_cap_no" numeric(18,2),
    "solvency_override_pct" numeric(5,4),
    "solvency_override_until" timestamp with time zone,
    "solvency_override_by" "uuid",
    "payback_activated_at" timestamp with time zone,
    "payback_reason" "text",
    "suspension_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "frozen_at" timestamp with time zone,
    "webhook_url" "text",
    "webhook_secret" "text",
    "book_type" "public"."branch_book_type" DEFAULT 'reseller'::"public"."branch_book_type" NOT NULL,
    CONSTRAINT "branches_commission_no_capital" CHECK ((("book_type" <> 'commission'::"public"."branch_book_type") OR (("pool_balance" = (0)::numeric) AND ("worst_case_total" = (0)::numeric) AND ("pending_payouts" = (0)::numeric) AND ("yes_markup_pct" = (0)::numeric) AND ("no_markup_pct" = (0)::numeric) AND ("exit_fee_pct" = (0)::numeric) AND ("branch_fee_rate" = (0)::numeric) AND ("solvency_override_pct" IS NULL) AND ("solvency_override_until" IS NULL)))),
    CONSTRAINT "branches_commission_no_payback" CHECK ((("book_type" <> 'commission'::"public"."branch_book_type") OR ("status" <> 'payback'::"public"."branch_status"))),
    CONSTRAINT "branches_commission_slug_format" CHECK ((("book_type" <> 'commission'::"public"."branch_book_type") OR ("branch_code" ~ '^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$'::"text"))),
    CONSTRAINT "branches_fee_rate_valid" CHECK ((("branch_fee_rate" >= (0)::numeric) AND ("branch_fee_rate" <= 0.200000))),
    CONSTRAINT "branches_markup_valid" CHECK ((("yes_markup_pct" >= (0)::numeric) AND ("yes_markup_pct" <= 0.5000) AND ("no_markup_pct" >= (0)::numeric) AND ("no_markup_pct" <= 0.5000))),
    CONSTRAINT "branches_pending_payouts_check" CHECK (("pending_payouts" >= (0)::numeric)),
    CONSTRAINT "branches_worst_case_total_check" CHECK (("worst_case_total" >= (0)::numeric))
);


ALTER TABLE "public"."branches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."branches"."webhook_url" IS 'Optional URL for resolution webhook notifications (HMAC-SHA256 signed)';



COMMENT ON COLUMN "public"."branches"."webhook_secret" IS 'HMAC-SHA256 secret for signing webhook payloads';



CREATE TABLE IF NOT EXISTS "public"."comment_likes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "comment_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."comment_likes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commission_clawback_deficit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "referrer_id" "uuid",
    "market_id" "uuid",
    "commission_id" "uuid",
    "expected_clawback" numeric(18,2),
    "actual_clawback" numeric(18,2),
    "deficit" numeric(18,2) NOT NULL,
    "reason" "text" DEFAULT 'agent_balance_insufficient'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch_id" "uuid"
);


ALTER TABLE "public"."commission_clawback_deficit" OWNER TO "postgres";


COMMENT ON TABLE "public"."commission_clawback_deficit" IS 'Records the gap when commission clawback could not fully recover the credited amount (agent withdrew before void). Platform loss; not auto-recovered from balance_usd.';



COMMENT ON COLUMN "public"."commission_clawback_deficit"."reason" IS 'Reason for deficit. Known values: agent_balance_insufficient (void clawback could not fully debit because agent already withdrew), pool_underflow (branch pool_balance went negative - platform owes branch money).';



CREATE TABLE IF NOT EXISTS "public"."copy_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "copier_id" "uuid" NOT NULL,
    "leader_id" "uuid" NOT NULL,
    "amount_per_trade" numeric(18,2) NOT NULL,
    "max_per_market" numeric(18,2) DEFAULT 100 NOT NULL,
    "max_total" numeric(18,2) DEFAULT 1000 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "copy_no_self" CHECK (("copier_id" <> "leader_id")),
    CONSTRAINT "copy_settings_amount_per_trade_check" CHECK (("amount_per_trade" > (0)::numeric))
);


ALTER TABLE "public"."copy_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."credit_chain_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid" NOT NULL,
    "issuer_id" "uuid" NOT NULL,
    "recipient_id" "uuid" NOT NULL,
    "issuer_role" "public"."credit_chain_role" NOT NULL,
    "recipient_role" "public"."credit_chain_role" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "credit_chain_ledger_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."credit_chain_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demo_amm_state" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "liquidity_param" numeric(18,6) DEFAULT 5000 NOT NULL,
    "q_yes" numeric(18,6) DEFAULT 0 NOT NULL,
    "q_no" numeric(18,6) DEFAULT 0 NOT NULL,
    "current_yes_price" numeric(10,6) DEFAULT 0.500000 NOT NULL,
    "current_no_price" numeric(10,6) DEFAULT 0.500000 NOT NULL,
    "total_volume" numeric(18,2) DEFAULT 0 NOT NULL,
    "total_trades" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "demo_amm_liquidity_positive" CHECK (("liquidity_param" > (0)::numeric)),
    CONSTRAINT "demo_amm_prices_valid" CHECK ((("current_yes_price" >= 0.000001) AND ("current_yes_price" <= 0.999999) AND ("current_no_price" >= 0.000001) AND ("current_no_price" <= 0.999999)))
);


ALTER TABLE "public"."demo_amm_state" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demo_market_scheduled_outcomes" (
    "market_id" "uuid" NOT NULL,
    "scheduled_outcome" "public"."bet_side" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."demo_market_scheduled_outcomes" OWNER TO "postgres";


COMMENT ON TABLE "public"."demo_market_scheduled_outcomes" IS 'Admin-only answer key for demo markets. Never readable by end users.';



CREATE TABLE IF NOT EXISTS "public"."demo_markets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_en" "text" NOT NULL,
    "question_ar" "text" NOT NULL,
    "description_en" "text",
    "description_ar" "text",
    "category" "text" DEFAULT 'politics'::"text" NOT NULL,
    "status" "public"."market_status" DEFAULT 'open'::"public"."market_status" NOT NULL,
    "outcome" "public"."bet_side",
    "amm_liquidity_param" numeric(18,6) DEFAULT 5000 NOT NULL,
    "trade_count" integer DEFAULT 0 NOT NULL,
    "unique_traders" integer DEFAULT 0 NOT NULL,
    "homepage_rank" integer,
    "opens_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "closes_at" timestamp with time zone NOT NULL,
    "resolves_at" timestamp with time zone NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "keywords" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "image_url" "text",
    "short_code" character varying(8) DEFAULT "substr"("md5"(("random"())::"text"), 1, 8) NOT NULL,
    "resolution_fee_rate_snapshot" numeric(8,6) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "demo_closes_after_opens" CHECK (("closes_at" > "opens_at")),
    CONSTRAINT "demo_resolves_after_closes" CHECK (("resolves_at" >= "closes_at"))
);


ALTER TABLE "public"."demo_markets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."demo_markets"."resolves_at" IS 'When cron should auto-resolve this market. Denormalized here (not on demo_market_scheduled_outcomes) so users can see the countdown.';



COMMENT ON COLUMN "public"."demo_markets"."resolution_fee_rate_snapshot" IS 'Always 0 for demo markets — no resolution fee in the sandbox.';



CREATE TABLE IF NOT EXISTS "public"."demo_positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "shares_held" numeric(18,6) DEFAULT 0 NOT NULL,
    "avg_entry_price" numeric(10,6) DEFAULT 0 NOT NULL,
    "total_invested" numeric(18,2) DEFAULT 0 NOT NULL,
    "realized_pnl" numeric(18,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "demo_positions_shares_held_check" CHECK (("shares_held" >= (0)::numeric))
);


ALTER TABLE "public"."demo_positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demo_trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "direction" "public"."trade_direction" NOT NULL,
    "shares" numeric(18,6) NOT NULL,
    "price_per_share" numeric(10,6) NOT NULL,
    "total_cost" numeric(18,2) NOT NULL,
    "post_yes_price" numeric(10,6),
    "post_no_price" numeric(10,6),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "demo_trades_price_per_share_check" CHECK ((("price_per_share" > (0)::numeric) AND ("price_per_share" < (1)::numeric))),
    CONSTRAINT "demo_trades_shares_check" CHECK (("shares" > (0)::numeric))
);


ALTER TABLE "public"."demo_trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."demo_transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "public"."demo_transaction_type" NOT NULL,
    "amount" numeric(18,6) NOT NULL,
    "balance_after" numeric(18,6) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."demo_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."deposits" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric(18,6) NOT NULL,
    "fee" numeric(18,6) DEFAULT 0 NOT NULL,
    "net_amount" numeric(18,6) NOT NULL,
    "currency" "text" DEFAULT 'USDT'::"text" NOT NULL,
    "provider_ref" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "confirmed_at" timestamp with time zone,
    "provider" "text" DEFAULT '3pay'::"text" NOT NULL,
    "proof_image_url" "text",
    "whish_number" "text",
    CONSTRAINT "deposits_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "deposits_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'confirmed'::"text", 'failed'::"text", 'pending_review'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."deposits" OWNER TO "postgres";


COMMENT ON CONSTRAINT "deposits_amount_check" ON "public"."deposits" IS 'Amount >= 0. Zero allowed for manual deposits in pending_review; admin_review_deposit enforces > 0 at approval time before crediting balance.';



CREATE TABLE IF NOT EXISTS "public"."fee_config" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "fee_type" "text" NOT NULL,
    "level" integer,
    "depth" integer,
    "rate" numeric(18,6) NOT NULL,
    "description" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."fee_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."help_articles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "collection_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "help_articles_slug_check" CHECK (("slug" ~ '^[a-z0-9-]+$'::"text"))
);


ALTER TABLE "public"."help_articles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."help_collections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "icon" "text" DEFAULT 'help-circle'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_published" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "locale" "text" DEFAULT 'en'::"text" NOT NULL,
    CONSTRAINT "help_collections_slug_check" CHECK (("slug" ~ '^[a-z0-9-]+$'::"text"))
);


ALTER TABLE "public"."help_collections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leader_stats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "total_trades" integer DEFAULT 0 NOT NULL,
    "winning_trades" integer DEFAULT 0 NOT NULL,
    "accuracy_pct" numeric(5,2) DEFAULT 0 NOT NULL,
    "total_pnl" numeric(18,2) DEFAULT 0 NOT NULL,
    "copier_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leader_stats" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."market_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "side" "text",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_id" "uuid",
    "like_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "market_comments_body_check" CHECK ((("char_length"("body") >= 1) AND ("char_length"("body") <= 500))),
    CONSTRAINT "market_comments_side_check" CHECK ((("side" IS NULL) OR ("side" = ANY (ARRAY['yes'::"text", 'no'::"text"]))))
);


ALTER TABLE "public"."market_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."markets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_en" "text" NOT NULL,
    "question_ar" "text" NOT NULL,
    "description_en" "text",
    "description_ar" "text",
    "category" "text" DEFAULT 'politics'::"text" NOT NULL,
    "status" "public"."market_status" DEFAULT 'draft'::"public"."market_status" NOT NULL,
    "outcome" "public"."bet_side",
    "trade_count" integer DEFAULT 0 NOT NULL,
    "unique_traders" integer DEFAULT 0 NOT NULL,
    "opens_at" timestamp with time zone NOT NULL,
    "closes_at" timestamp with time zone NOT NULL,
    "resolved_at" timestamp with time zone,
    "created_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "amm_liquidity_param" numeric(18,6) DEFAULT 1000,
    "keywords" "text"[] DEFAULT '{}'::"text"[],
    "homepage_rank" integer,
    "image_url" "text",
    "short_code" character varying(8) DEFAULT "substr"("md5"(("random"())::"text"), 1, 8) NOT NULL,
    "resolution_fee_rate_snapshot" numeric(8,6),
    "branch_settled_at" timestamp with time zone,
    "branch_settlement_result" "jsonb",
    "opening_price" numeric(5,4) DEFAULT 0.5000 NOT NULL,
    CONSTRAINT "closes_after_opens" CHECK (("closes_at" > "opens_at")),
    CONSTRAINT "markets_opening_price_check" CHECK ((("opening_price" >= 0.05) AND ("opening_price" <= 0.95)))
);


ALTER TABLE "public"."markets" OWNER TO "postgres";


COMMENT ON COLUMN "public"."markets"."resolution_fee_rate_snapshot" IS 'Resolution fee rate frozen at market creation. NULL means use live fee_config (back-compat).';



COMMENT ON COLUMN "public"."markets"."branch_settled_at" IS 'Timestamp when branch_settle_resolution completed for this market. NULL until first successful run. Used as idempotency key.';



COMMENT ON COLUMN "public"."markets"."branch_settlement_result" IS 'Cached JSONB result from branch_settle_resolution - returned on idempotent retries.';



COMMENT ON COLUMN "public"."markets"."opening_price" IS 'Initial market price set at creation. AMM pre-mints shares to reach this price. Range 0.05-0.95 to prevent certainty markets. 0.5 = classic 50/50 behavior.';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title_en" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "body_en" "text",
    "body_ar" "text",
    "reference_id" "uuid",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."otp_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text" NOT NULL,
    "code" "text" NOT NULL,
    "message_id" "text",
    "attempts" integer DEFAULT 0 NOT NULL,
    "verified" boolean DEFAULT false NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "text"
);


ALTER TABLE "public"."otp_verifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."platform_revenue" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "market_id" "uuid" NOT NULL,
    "total_pot" numeric(18,6) NOT NULL,
    "seed_amount" numeric(18,6) NOT NULL,
    "platform_fee" numeric(18,6) NOT NULL,
    "total_commissions" numeric(18,6) DEFAULT 0 NOT NULL,
    "net_revenue" numeric(18,6) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "explicit_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "amm_spread_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "resolution_fee_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "dynamic_spread_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "cash_out_premium_revenue" numeric(18,2) DEFAULT 0 NOT NULL,
    "branch_id" "uuid"
);


ALTER TABLE "public"."platform_revenue" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "shares_held" numeric(18,6) DEFAULT 0 NOT NULL,
    "avg_entry_price" numeric(10,6) DEFAULT 0 NOT NULL,
    "total_invested" numeric(18,2) DEFAULT 0 NOT NULL,
    "realized_pnl" numeric(18,2) DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "branch_id" "uuid",
    CONSTRAINT "positions_shares_held_check" CHECK (("shares_held" >= (0)::numeric))
);


ALTER TABLE "public"."positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prelaunch_questions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "title_ar" "text" NOT NULL,
    "title_en" "text" NOT NULL,
    "description_ar" "text",
    "description_en" "text",
    "category" "text" DEFAULT 'general'::"text" NOT NULL,
    "yes_count" integer DEFAULT 0 NOT NULL,
    "no_count" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."prelaunch_questions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prelaunch_votes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "question_id" "uuid" NOT NULL,
    "visitor_id" "text" NOT NULL,
    "vote" "text" NOT NULL,
    "ip_hash" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "prelaunch_votes_vote_check" CHECK (("vote" = ANY (ARRAY['yes'::"text", 'no'::"text"])))
);


ALTER TABLE "public"."prelaunch_votes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."prelaunch_waitlist" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "phone" "text",
    "position" integer NOT NULL,
    "referral_code" "text" DEFAULT "substr"("replace"(("gen_random_uuid"())::"text", '-'::"text", ''::"text"), 1, 6) NOT NULL,
    "referred_by" "text",
    "referral_count" integer DEFAULT 0 NOT NULL,
    "votes_json" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text"
);


ALTER TABLE "public"."prelaunch_waitlist" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."prelaunch_waitlist_position_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."prelaunch_waitlist_position_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."prelaunch_waitlist_position_seq" OWNED BY "public"."prelaunch_waitlist"."position";



CREATE TABLE IF NOT EXISTS "public"."price_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "target_price" numeric(10,6) NOT NULL,
    "direction" "public"."alert_direction" NOT NULL,
    "is_triggered" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "triggered_at" timestamp with time zone,
    CONSTRAINT "price_alerts_target_price_check" CHECK ((("target_price" > (0)::numeric) AND ("target_price" < (1)::numeric)))
);


ALTER TABLE "public"."price_alerts" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."retail_positions" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "market_id",
    "side",
    "shares_held",
    "avg_entry_price",
    "total_invested",
    "realized_pnl",
    "created_at",
    "updated_at",
    "branch_id"
   FROM "public"."positions"
  WHERE ("branch_id" IS NULL);


ALTER VIEW "public"."retail_positions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "side" "public"."bet_side" NOT NULL,
    "direction" "public"."trade_direction" NOT NULL,
    "shares" numeric(18,6) NOT NULL,
    "price_per_share" numeric(10,6) NOT NULL,
    "total_cost" numeric(18,2) NOT NULL,
    "explicit_fee" numeric(18,6) DEFAULT 0 NOT NULL,
    "amm_spread_cost" numeric(18,6) DEFAULT 0 NOT NULL,
    "cash_out_premium" numeric(18,6) DEFAULT 0 NOT NULL,
    "is_copy_trade" boolean DEFAULT false NOT NULL,
    "copied_from_user" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "post_yes_price" numeric(10,6),
    "post_no_price" numeric(10,6),
    "dynamic_spread" numeric(18,6) DEFAULT 0 NOT NULL,
    "branch_id" "uuid",
    CONSTRAINT "trades_amm_spread_cost_check" CHECK (("amm_spread_cost" >= (0)::numeric)),
    CONSTRAINT "trades_cash_out_premium_check" CHECK (("cash_out_premium" >= (0)::numeric)),
    CONSTRAINT "trades_explicit_fee_check" CHECK (("explicit_fee" >= (0)::numeric)),
    CONSTRAINT "trades_price_per_share_check" CHECK ((("price_per_share" > (0)::numeric) AND ("price_per_share" < (1)::numeric))),
    CONSTRAINT "trades_shares_check" CHECK (("shares" > (0)::numeric))
);


ALTER TABLE "public"."trades" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."retail_trades" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "market_id",
    "side",
    "direction",
    "shares",
    "price_per_share",
    "total_cost",
    "explicit_fee",
    "amm_spread_cost",
    "cash_out_premium",
    "is_copy_trade",
    "copied_from_user",
    "created_at",
    "post_yes_price",
    "post_no_price",
    "dynamic_spread",
    "branch_id"
   FROM "public"."trades"
  WHERE ("branch_id" IS NULL);


ALTER VIEW "public"."retail_trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_branches" (
    "branch_id" "uuid" NOT NULL,
    "speed_status" "public"."speed_branch_status" DEFAULT 'inactive'::"public"."speed_branch_status" NOT NULL,
    "speed_pool_balance" numeric(18,2) DEFAULT 0 NOT NULL,
    "fee_share_pct" numeric(5,4) NOT NULL,
    "freeze_warn_pct" numeric(5,4) NOT NULL,
    "freeze_hard_pct" numeric(5,4) NOT NULL,
    "unfreeze_pct" numeric(5,4) NOT NULL,
    "stake_min" numeric(18,2) NOT NULL,
    "stake_max" numeric(18,2) NOT NULL,
    "stake_caps_per_side" "jsonb" NOT NULL,
    "activated_at" timestamp with time zone,
    "activated_by" "uuid",
    "suspension_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_fee_share_range" CHECK ((("fee_share_pct" >= (0)::numeric) AND ("fee_share_pct" <= (1)::numeric))),
    CONSTRAINT "speed_stake_caps_is_object" CHECK (("jsonb_typeof"("stake_caps_per_side") = 'object'::"text")),
    CONSTRAINT "speed_stake_range" CHECK (("stake_min" < "stake_max")),
    CONSTRAINT "speed_thresholds_ordered" CHECK ((("unfreeze_pct" < "freeze_warn_pct") AND ("freeze_warn_pct" < "freeze_hard_pct")))
);


ALTER TABLE "public"."speed_branches" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_branches" IS 'Sidecar table for reseller branches opting into speed markets. One row per branch. Commission branches do not have rows here — they earn via retail commission walk.';



COMMENT ON COLUMN "public"."speed_branches"."speed_pool_balance" IS 'Cumulative balance from all speed_pool_ledger entries. CAN BE NEGATIVE. Freeze rules govern, not a hard CHECK.';



COMMENT ON COLUMN "public"."speed_branches"."stake_caps_per_side" IS 'JSONB map of duration -> max total stake from one user on one side of one market. Set by admin at enable. Required.';



CREATE TABLE IF NOT EXISTS "public"."speed_exposure_live" (
    "branch_id" "uuid" NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "open_over_notional" numeric(18,2) DEFAULT 0 NOT NULL,
    "open_under_notional" numeric(18,2) DEFAULT 0 NOT NULL,
    "net_notional" numeric(18,2) DEFAULT 0 NOT NULL,
    "open_position_count" integer DEFAULT 0 NOT NULL,
    "utilization_pct" numeric(8,4) DEFAULT 0 NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_exposure_live" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_exposure_live" IS 'Per (branch, asset) exposure cache. Updated by trigger on speed_positions in Part 3 RPC migration.';



CREATE TABLE IF NOT EXISTS "public"."speed_external_book_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "venue" "text" DEFAULT 'binance_futures'::"text" NOT NULL,
    "snapshot_at" timestamp with time zone NOT NULL,
    "net_position_qty" numeric(18,8) DEFAULT 0 NOT NULL,
    "avg_entry_price" numeric(18,8),
    "mark_price" numeric(18,8),
    "unrealized_pnl_usd" numeric(18,2),
    "realized_pnl_since_last" numeric(18,2),
    "funding_paid_since_last" numeric(18,2) DEFAULT 0,
    "margin_balance_usd" numeric(18,2),
    "recorded_by" "uuid" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_external_book_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_external_book_snapshots" IS 'SOOQ-only audit table. Daily snapshots of hedge book state at external venue. Admin-only RLS. Branches do NOT see this data.';



CREATE TABLE IF NOT EXISTS "public"."speed_main_pool_state" (
    "id" integer DEFAULT 1 NOT NULL,
    "speed_pool_balance" numeric DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_main_pool_state_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."speed_main_pool_state" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_main_pool_state" IS 'Singleton: running balance of the SOOQ main pool (used by retail and commission-branch flows). Locked FOR UPDATE during every trade/cashout/resolve to prevent concurrent balance_after drift. The audit trail is speed_pool_ledger WHERE branch_id IS NULL; this table is the live cache.';



CREATE TABLE IF NOT EXISTS "public"."speed_market_exposure_live" (
    "market_id" "uuid" NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "net_notional" numeric(18,2) DEFAULT 0 NOT NULL,
    "net_qty" numeric(18,8) DEFAULT 0 NOT NULL,
    "open_position_count" integer DEFAULT 0 NOT NULL,
    "branch_breakdown" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "last_updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_market_exposure_live" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_market_exposure_live" IS 'Per (market) exposure cache. Powers the operations dashboard per-market drilldown.';



CREATE TABLE IF NOT EXISTS "public"."speed_markets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "duration" "public"."speed_duration" NOT NULL,
    "strike_price" numeric(18,8),
    "opens_at" timestamp with time zone NOT NULL,
    "closes_at" timestamp with time zone NOT NULL,
    "status" "public"."speed_market_status" DEFAULT 'pending'::"public"."speed_market_status" NOT NULL,
    "outcome" "public"."speed_market_outcome",
    "settlement_price" numeric(18,8),
    "twap_window_start" timestamp with time zone,
    "twap_window_end" timestamp with time zone,
    "twap_tick_count" integer,
    "resolved_at" timestamp with time zone,
    "voided_at" timestamp with time zone,
    "void_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_market_resolved_has_outcome" CHECK ((("status" <> 'resolved'::"public"."speed_market_status") OR ("outcome" IS NOT NULL))),
    CONSTRAINT "speed_market_twap_required" CHECK ((("status" <> 'resolved'::"public"."speed_market_status") OR ("twap_tick_count" > 0))),
    CONSTRAINT "speed_market_window" CHECK (("opens_at" < "closes_at")),
    CONSTRAINT "speed_markets_strike_price_check" CHECK ((("strike_price" IS NULL) OR ("strike_price" > (0)::numeric)))
);

ALTER TABLE ONLY "public"."speed_markets" REPLICA IDENTITY FULL;


ALTER TABLE "public"."speed_markets" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_markets" IS 'Speed-market entity. Continuously rolling per (asset, duration). Resolves automatically at expiry via TWAP from speed_oracle_ticks.';



COMMENT ON COLUMN "public"."speed_markets"."settlement_price" IS 'Mig 355: settlement price at market close. Single oracle tick at closes_at, or most recent tick within 2 seconds before close. Replaces the prior 30s TWAP. NULL until resolution.';



COMMENT ON CONSTRAINT "speed_market_twap_required" ON "public"."speed_markets" IS 'Schema-level guarantee that no market can be marked resolved without at least one TWAP tick. Forces resolve RPC to either gather data or void.';



COMMENT ON CONSTRAINT "speed_markets_strike_price_check" ON "public"."speed_markets" IS 'NULL allowed only while a row is in pending state — finalized to (oracle.price > 0) when status flips to open. Resolved/voided/halted rows always have strike set (their status came from open).';



CREATE TABLE IF NOT EXISTS "public"."speed_oracle_klines" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "source" "text" DEFAULT 'binance'::"text" NOT NULL,
    "ts" timestamp with time zone NOT NULL,
    "open_price" numeric(18,8) NOT NULL,
    "high_price" numeric(18,8) NOT NULL,
    "low_price" numeric(18,8) NOT NULL,
    "close_price" numeric(18,8) NOT NULL,
    "volume" numeric(18,8) DEFAULT 0 NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_oracle_klines_close_price_check" CHECK (("close_price" > (0)::numeric)),
    CONSTRAINT "speed_oracle_klines_high_price_check" CHECK (("high_price" > (0)::numeric)),
    CONSTRAINT "speed_oracle_klines_low_price_check" CHECK (("low_price" > (0)::numeric)),
    CONSTRAINT "speed_oracle_klines_open_price_check" CHECK (("open_price" > (0)::numeric))
);


ALTER TABLE "public"."speed_oracle_klines" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_oracle_latest" (
    "asset" "public"."speed_asset" NOT NULL,
    "source" "text" DEFAULT 'binance'::"text" NOT NULL,
    "price" numeric(18,8) NOT NULL,
    "ts" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone NOT NULL,
    CONSTRAINT "speed_oracle_latest_price_check" CHECK (("price" > (0)::numeric))
);

ALTER TABLE ONLY "public"."speed_oracle_latest" REPLICA IDENTITY FULL;


ALTER TABLE "public"."speed_oracle_latest" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_oracle_latest" IS 'Last-write-wins cache, one row per asset. Public-read RLS so user app can display live prices without hitting auth.';



CREATE TABLE IF NOT EXISTS "public"."speed_oracle_ticks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset" "public"."speed_asset" NOT NULL,
    "source" "text" DEFAULT 'binance'::"text" NOT NULL,
    "price" numeric(18,8) NOT NULL,
    "ts" timestamp with time zone NOT NULL,
    "received_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_oracle_ticks_price_check" CHECK (("price" > (0)::numeric))
);


ALTER TABLE "public"."speed_oracle_ticks" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_oracle_ticks" IS 'Rolling 5-min history of Binance ticks. Source for TWAP at market expiry. Pruned aggressively by maintenance cron.';



CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
)
PARTITION BY RANGE ("created_at");


ALTER TABLE "public"."speed_pool_ledger" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_pool_ledger" IS 'Append-only ledger for speed-market money flows. branch_id NULL = SOOQ main pool. Partitioned daily.';



CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260427" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260427" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260428" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260428" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260429" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260429" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260430" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260430" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260501" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260501" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260502" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260502" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260503" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260503" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260504" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260504" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260505" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260505" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260506" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260506" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260507" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260507" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260508" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260508" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260509" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260509" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_pool_ledger_20260510" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "branch_id" "uuid",
    "market_id" "uuid",
    "type" "public"."speed_pool_entry_type" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "balance_after" numeric(18,2) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_pool_ledger_20260510" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "side" "text" NOT NULL,
    "stake" numeric(18,2) NOT NULL,
    "entry_price" numeric(18,8) NOT NULL,
    "entry_fair_prob" numeric(8,6) NOT NULL,
    "entry_offered_prob" numeric(8,6) NOT NULL,
    "status" "public"."speed_position_status" DEFAULT 'open'::"public"."speed_position_status" NOT NULL,
    "payout_amount" numeric(18,2),
    "closed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "speed_positions_side_check" CHECK (("side" = ANY (ARRAY['over'::"text", 'under'::"text"]))),
    CONSTRAINT "speed_positions_stake_check" CHECK (("stake" > (0)::numeric))
);


ALTER TABLE "public"."speed_positions" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_positions" IS 'User position rows. Multi-position stacking allowed (no UNIQUE). Cashout is per-position. branch_id NULL for retail / commission-branch users (variance to SOOQ main). Set for reseller-branch users.';



CREATE TABLE IF NOT EXISTS "public"."speed_realized_vol_cache" (
    "asset" "public"."speed_asset" NOT NULL,
    "rv" numeric NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_realized_vol_cache" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_realized_vol_cache" IS 'Mig 352 (Seam 4): cached realized volatility per asset. Refreshed every 60s by speed_rv_refresh() via pg_cron. Trade/cashout RPCs read here first, fall back to fee_config.speed_iv_btc on cache miss/stale.';



CREATE TABLE IF NOT EXISTS "public"."speed_settlements" (
    "position_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "outcome" "public"."speed_market_outcome" NOT NULL,
    "payout_amount" numeric(18,2) NOT NULL,
    "settled_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_settlements" OWNER TO "postgres";


COMMENT ON TABLE "public"."speed_settlements" IS 'Per-position settlement record. PK position_id makes the resolve worker idempotent on retry.';



CREATE TABLE IF NOT EXISTS "public"."speed_trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
)
PARTITION BY RANGE ("created_at");


ALTER TABLE "public"."speed_trades" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260427" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260427" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260428" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260428" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260429" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260429" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260430" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260430" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260501" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260501" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260502" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260502" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260503" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260503" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260504" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260504" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260505" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260505" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260506" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260506" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260507" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260507" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260508" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260508" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260509" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260509" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."speed_trades_20260510" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "position_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "market_id" "uuid" NOT NULL,
    "branch_id" "uuid",
    "kind" "public"."speed_trade_kind" NOT NULL,
    "amount" numeric(18,2) NOT NULL,
    "spot_price" numeric(18,8) NOT NULL,
    "fair_prob" numeric(8,6) NOT NULL,
    "offered_prob" numeric(8,6) NOT NULL,
    "handle_fee" numeric(18,2) DEFAULT 0 NOT NULL,
    "cashout_multiplier" numeric(5,4),
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."speed_trades_20260510" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "severity" "public"."log_severity" DEFAULT 'error'::"public"."log_severity" NOT NULL,
    "source" "text" NOT NULL,
    "message" "text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb",
    "acknowledged" boolean DEFAULT false NOT NULL,
    "acknowledged_by" "uuid",
    "acknowledged_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transactions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "public"."transaction_type" NOT NULL,
    "amount" numeric(18,6) NOT NULL,
    "balance_after" numeric(18,6) NOT NULL,
    "reference_id" "uuid",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "performed_by" "uuid"
);


ALTER TABLE "public"."transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_wallets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "provider" "text" DEFAULT '3pay'::"text" NOT NULL,
    "provider_user_id" "text",
    "wallet_address_trc20" "text",
    "wallet_address_erc20" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "phone" "text",
    "display_name" "text",
    "avatar_url" "text",
    "balance_usd" numeric(18,6) DEFAULT 0 NOT NULL,
    "referral_code" "text" DEFAULT "substr"("md5"(("random"())::"text"), 1, 8) NOT NULL,
    "referred_by" "uuid",
    "referral_chain" "uuid"[] DEFAULT '{}'::"uuid"[],
    "agent_level" integer DEFAULT 1 NOT NULL,
    "direct_referral_count" integer DEFAULT 0 NOT NULL,
    "locale" "text" DEFAULT 'en'::"text" NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "is_frozen" boolean DEFAULT false NOT NULL,
    "wagering_requirement" numeric(18,6) DEFAULT 0 NOT NULL,
    "total_wagered" numeric(18,6) DEFAULT 0 NOT NULL,
    "deposit_bonus_claimed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "network_volume" numeric(18,2) DEFAULT 0 NOT NULL,
    "agent_balance_usd" numeric(12,2) DEFAULT 0.00 NOT NULL,
    "agent_activated" boolean DEFAULT false NOT NULL,
    "agent_activation_override" boolean DEFAULT false NOT NULL,
    "qualified_referral_count" integer DEFAULT 0 NOT NULL,
    "email" "text",
    "bio" "text",
    "admin_allowed_views" "text"[],
    "demo_mode" boolean DEFAULT false NOT NULL,
    "demo_balance_usd" numeric(18,6) DEFAULT 0 NOT NULL,
    "demo_first_enabled_at" timestamp with time zone,
    "demo_first_trade_at" timestamp with time zone,
    "first_real_deposit_after_demo_at" timestamp with time zone,
    "signup_branch_id" "uuid",
    CONSTRAINT "users_agent_balance_usd_nonneg" CHECK (("agent_balance_usd" >= (0)::numeric)),
    CONSTRAINT "users_agent_level_check" CHECK ((("agent_level" >= 1) AND ("agent_level" <= 4))),
    CONSTRAINT "users_balance_usd_nonneg" CHECK (("balance_usd" >= (0)::numeric)),
    CONSTRAINT "users_locale_check" CHECK (("locale" = ANY (ARRAY['en'::"text", 'ar'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON COLUMN "public"."users"."demo_mode" IS 'User-writable preference flag. Does NOT grant demo balance on its own. /demo/* route gate is demo_first_enabled_at IS NOT NULL.';



COMMENT ON COLUMN "public"."users"."demo_balance_usd" IS 'Demo sandbox balance. DECIMAL(18,6) to match live balance_usd precision.';



COMMENT ON COLUMN "public"."users"."demo_first_enabled_at" IS 'Set atomically by toggle_demo_mode RPC on first enable. Source of truth for "demo initialized for this user".';



COMMENT ON COLUMN "public"."users"."demo_first_trade_at" IS 'Set by demo_execute_trade on first successful demo trade. Null-guarded for idempotency.';



COMMENT ON COLUMN "public"."users"."first_real_deposit_after_demo_at" IS 'Set by process_deposit on first real deposit for users who previously enabled demo. Conversion funnel metric.';



COMMENT ON COLUMN "public"."users"."signup_branch_id" IS 'Branch through which this user signed up. Populated by the signup resolver for commission-branch signups (via /b/[slug]/ or /b/[slug]/?agent=[code]). Powers the branch manager dashboard "my users" query. ON DELETE RESTRICT: cannot delete a branch with attributed users; admin must suspend instead.';



CREATE TABLE IF NOT EXISTS "public"."withdrawals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "amount" numeric(18,6) NOT NULL,
    "fee" numeric(18,6) DEFAULT 0 NOT NULL,
    "net_amount" numeric(18,6) NOT NULL,
    "currency" "text" DEFAULT 'USDT'::"text" NOT NULL,
    "destination" "text" NOT NULL,
    "status" "public"."withdrawal_status" DEFAULT 'pending'::"public"."withdrawal_status" NOT NULL,
    "admin_notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "destination_type" "text",
    "network" "text",
    "provider" "text",
    "sent_at" timestamp with time zone,
    "sent_by" "uuid",
    "external_reference_id" "text",
    CONSTRAINT "withdrawals_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "public"."withdrawals" OWNER TO "postgres";


COMMENT ON COLUMN "public"."withdrawals"."destination" IS 'Actual destination — wallet address (crypto), phone number (whish), or IBAN/account (bank). Validated in process_withdrawal RPC per destination_type.';



COMMENT ON COLUMN "public"."withdrawals"."destination_type" IS 'Payment rail type: crypto | whish | bank. Determines destination format + which provider handles the outbound.';



COMMENT ON COLUMN "public"."withdrawals"."network" IS 'Crypto network — TRC20 or ERC20. NULL for non-crypto rails. Required when destination_type = crypto.';



COMMENT ON COLUMN "public"."withdrawals"."provider" IS 'Payment provider: 3pay (crypto automated), whish_manual (Lebanese mobile, manual send), bank_manual (wire, manual send).';



COMMENT ON COLUMN "public"."withdrawals"."sent_at" IS 'When admin marked withdrawal as sent externally (status transition approved → sent).';



COMMENT ON COLUMN "public"."withdrawals"."sent_by" IS 'Which admin clicked "Mark sent" (FK to users.id, admin only).';



COMMENT ON COLUMN "public"."withdrawals"."external_reference_id" IS 'Receipt from the external payment rail — blockchain tx hash for 3pay, whish transaction id, or bank wire reference. Recorded by admin_mark_withdrawal_sent.';



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260427" FOR VALUES FROM ('2026-04-27 00:00:00+00') TO ('2026-04-28 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260428" FOR VALUES FROM ('2026-04-28 00:00:00+00') TO ('2026-04-29 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260429" FOR VALUES FROM ('2026-04-29 00:00:00+00') TO ('2026-04-30 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260430" FOR VALUES FROM ('2026-04-30 00:00:00+00') TO ('2026-05-01 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260501" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-05-02 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260502" FOR VALUES FROM ('2026-05-02 00:00:00+00') TO ('2026-05-03 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260503" FOR VALUES FROM ('2026-05-03 00:00:00+00') TO ('2026-05-04 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260504" FOR VALUES FROM ('2026-05-04 00:00:00+00') TO ('2026-05-05 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260505" FOR VALUES FROM ('2026-05-05 00:00:00+00') TO ('2026-05-06 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260506" FOR VALUES FROM ('2026-05-06 00:00:00+00') TO ('2026-05-07 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260507" FOR VALUES FROM ('2026-05-07 00:00:00+00') TO ('2026-05-08 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260508" FOR VALUES FROM ('2026-05-08 00:00:00+00') TO ('2026-05-09 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260509" FOR VALUES FROM ('2026-05-09 00:00:00+00') TO ('2026-05-10 00:00:00+00');



ALTER TABLE ONLY "public"."speed_pool_ledger" ATTACH PARTITION "public"."speed_pool_ledger_20260510" FOR VALUES FROM ('2026-05-10 00:00:00+00') TO ('2026-05-11 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260427" FOR VALUES FROM ('2026-04-27 00:00:00+00') TO ('2026-04-28 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260428" FOR VALUES FROM ('2026-04-28 00:00:00+00') TO ('2026-04-29 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260429" FOR VALUES FROM ('2026-04-29 00:00:00+00') TO ('2026-04-30 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260430" FOR VALUES FROM ('2026-04-30 00:00:00+00') TO ('2026-05-01 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260501" FOR VALUES FROM ('2026-05-01 00:00:00+00') TO ('2026-05-02 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260502" FOR VALUES FROM ('2026-05-02 00:00:00+00') TO ('2026-05-03 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260503" FOR VALUES FROM ('2026-05-03 00:00:00+00') TO ('2026-05-04 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260504" FOR VALUES FROM ('2026-05-04 00:00:00+00') TO ('2026-05-05 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260505" FOR VALUES FROM ('2026-05-05 00:00:00+00') TO ('2026-05-06 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260506" FOR VALUES FROM ('2026-05-06 00:00:00+00') TO ('2026-05-07 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260507" FOR VALUES FROM ('2026-05-07 00:00:00+00') TO ('2026-05-08 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260508" FOR VALUES FROM ('2026-05-08 00:00:00+00') TO ('2026-05-09 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260509" FOR VALUES FROM ('2026-05-09 00:00:00+00') TO ('2026-05-10 00:00:00+00');



ALTER TABLE ONLY "public"."speed_trades" ATTACH PARTITION "public"."speed_trades_20260510" FOR VALUES FROM ('2026-05-10 00:00:00+00') TO ('2026-05-11 00:00:00+00');



ALTER TABLE ONLY "public"."prelaunch_waitlist" ALTER COLUMN "position" SET DEFAULT "nextval"('"public"."prelaunch_waitlist_position_seq"'::"regclass");



ALTER TABLE ONLY "public"."admin_config"
    ADD CONSTRAINT "admin_config_admin_user_id_key" UNIQUE ("admin_user_id");



ALTER TABLE ONLY "public"."admin_config"
    ADD CONSTRAINT "admin_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."agent_pending_microcredits"
    ADD CONSTRAINT "agent_pending_microcredits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."amm_state"
    ADD CONSTRAINT "amm_state_market_unique" UNIQUE ("market_id");



ALTER TABLE ONLY "public"."amm_state"
    ADD CONSTRAINT "amm_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_admin_overrides"
    ADD CONSTRAINT "branch_admin_overrides_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_referral_code_unique" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_unique_user_branch" UNIQUE ("user_id", "branch_id");



ALTER TABLE ONLY "public"."branch_market_config"
    ADD CONSTRAINT "branch_market_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_market_config"
    ADD CONSTRAINT "branch_market_config_unique" UNIQUE ("branch_id", "market_id");



ALTER TABLE ONLY "public"."branch_pools"
    ADD CONSTRAINT "branch_pools_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_revenue"
    ADD CONSTRAINT "branch_revenue_branch_id_market_id_key" UNIQUE ("branch_id", "market_id");



ALTER TABLE ONLY "public"."branch_revenue"
    ADD CONSTRAINT "branch_revenue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_idempotency" UNIQUE ("branch_id", "idempotency_key");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_user_assignments"
    ADD CONSTRAINT "branch_user_assignments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."branch_user_assignments"
    ADD CONSTRAINT "branch_user_unique" UNIQUE ("user_id", "branch_id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_code_unique" UNIQUE ("branch_code");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_user_id_key" UNIQUE ("comment_id", "user_id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commission_clawback_deficit"
    ADD CONSTRAINT "commission_clawback_deficit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."copy_settings"
    ADD CONSTRAINT "copy_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."copy_settings"
    ADD CONSTRAINT "copy_settings_unique" UNIQUE ("copier_id", "leader_id");



ALTER TABLE ONLY "public"."credit_chain_ledger"
    ADD CONSTRAINT "credit_chain_ledger_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_amm_state"
    ADD CONSTRAINT "demo_amm_state_market_unique" UNIQUE ("market_id");



ALTER TABLE ONLY "public"."demo_amm_state"
    ADD CONSTRAINT "demo_amm_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_market_scheduled_outcomes"
    ADD CONSTRAINT "demo_market_scheduled_outcomes_pkey" PRIMARY KEY ("market_id");



ALTER TABLE ONLY "public"."demo_markets"
    ADD CONSTRAINT "demo_markets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_markets"
    ADD CONSTRAINT "demo_markets_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."demo_positions"
    ADD CONSTRAINT "demo_positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_positions"
    ADD CONSTRAINT "demo_positions_user_market_side_unique" UNIQUE ("user_id", "market_id", "side");



ALTER TABLE ONLY "public"."demo_trades"
    ADD CONSTRAINT "demo_trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."demo_transactions"
    ADD CONSTRAINT "demo_transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deposits"
    ADD CONSTRAINT "deposits_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deposits"
    ADD CONSTRAINT "deposits_threepay_ref_key" UNIQUE ("provider_ref");



ALTER TABLE ONLY "public"."fee_config"
    ADD CONSTRAINT "fee_config_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_collection_id_slug_key" UNIQUE ("collection_id", "slug");



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."help_collections"
    ADD CONSTRAINT "help_collections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."help_collections"
    ADD CONSTRAINT "help_collections_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."leader_stats"
    ADD CONSTRAINT "leader_stats_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."leader_stats"
    ADD CONSTRAINT "leader_stats_user_unique" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."market_comments"
    ADD CONSTRAINT "market_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."markets"
    ADD CONSTRAINT "markets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."markets"
    ADD CONSTRAINT "markets_short_code_key" UNIQUE ("short_code");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."otp_verifications"
    ADD CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."platform_revenue"
    ADD CONSTRAINT "platform_revenue_market_id_key" UNIQUE ("market_id");



ALTER TABLE ONLY "public"."platform_revenue"
    ADD CONSTRAINT "platform_revenue_market_unique" UNIQUE ("market_id");



ALTER TABLE ONLY "public"."platform_revenue"
    ADD CONSTRAINT "platform_revenue_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prelaunch_questions"
    ADD CONSTRAINT "prelaunch_questions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prelaunch_questions"
    ADD CONSTRAINT "prelaunch_questions_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."prelaunch_votes"
    ADD CONSTRAINT "prelaunch_votes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prelaunch_votes"
    ADD CONSTRAINT "prelaunch_votes_question_id_visitor_id_key" UNIQUE ("question_id", "visitor_id");



ALTER TABLE ONLY "public"."prelaunch_waitlist"
    ADD CONSTRAINT "prelaunch_waitlist_phone_key" UNIQUE ("phone");



ALTER TABLE ONLY "public"."prelaunch_waitlist"
    ADD CONSTRAINT "prelaunch_waitlist_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."prelaunch_waitlist"
    ADD CONSTRAINT "prelaunch_waitlist_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."price_alerts"
    ADD CONSTRAINT "price_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_branches"
    ADD CONSTRAINT "speed_branches_pkey" PRIMARY KEY ("branch_id");



ALTER TABLE ONLY "public"."speed_exposure_live"
    ADD CONSTRAINT "speed_exposure_live_pkey" PRIMARY KEY ("branch_id", "asset");



ALTER TABLE ONLY "public"."speed_external_book_snapshots"
    ADD CONSTRAINT "speed_external_book_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_main_pool_state"
    ADD CONSTRAINT "speed_main_pool_state_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_market_exposure_live"
    ADD CONSTRAINT "speed_market_exposure_live_pkey" PRIMARY KEY ("market_id");



ALTER TABLE ONLY "public"."speed_markets"
    ADD CONSTRAINT "speed_markets_asset_duration_opens_at_uq" UNIQUE ("asset", "duration", "opens_at");



COMMENT ON CONSTRAINT "speed_markets_asset_duration_opens_at_uq" ON "public"."speed_markets" IS 'Race guard for speed_roll_markets — at most one market per (asset, duration) at any clean clock boundary.';



ALTER TABLE ONLY "public"."speed_markets"
    ADD CONSTRAINT "speed_markets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_oracle_klines"
    ADD CONSTRAINT "speed_oracle_klines_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_oracle_latest"
    ADD CONSTRAINT "speed_oracle_latest_pkey" PRIMARY KEY ("asset");



ALTER TABLE ONLY "public"."speed_oracle_ticks"
    ADD CONSTRAINT "speed_oracle_ticks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_pool_ledger"
    ADD CONSTRAINT "speed_pool_ledger_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260427"
    ADD CONSTRAINT "speed_pool_ledger_20260427_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260428"
    ADD CONSTRAINT "speed_pool_ledger_20260428_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260429"
    ADD CONSTRAINT "speed_pool_ledger_20260429_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260430"
    ADD CONSTRAINT "speed_pool_ledger_20260430_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260501"
    ADD CONSTRAINT "speed_pool_ledger_20260501_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260502"
    ADD CONSTRAINT "speed_pool_ledger_20260502_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260503"
    ADD CONSTRAINT "speed_pool_ledger_20260503_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260504"
    ADD CONSTRAINT "speed_pool_ledger_20260504_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260505"
    ADD CONSTRAINT "speed_pool_ledger_20260505_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260506"
    ADD CONSTRAINT "speed_pool_ledger_20260506_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260507"
    ADD CONSTRAINT "speed_pool_ledger_20260507_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260508"
    ADD CONSTRAINT "speed_pool_ledger_20260508_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260509"
    ADD CONSTRAINT "speed_pool_ledger_20260509_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_pool_ledger_20260510"
    ADD CONSTRAINT "speed_pool_ledger_20260510_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_positions"
    ADD CONSTRAINT "speed_positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."speed_realized_vol_cache"
    ADD CONSTRAINT "speed_realized_vol_cache_pkey" PRIMARY KEY ("asset");



ALTER TABLE ONLY "public"."speed_settlements"
    ADD CONSTRAINT "speed_settlements_pkey" PRIMARY KEY ("position_id");



ALTER TABLE ONLY "public"."speed_trades"
    ADD CONSTRAINT "speed_trades_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260427"
    ADD CONSTRAINT "speed_trades_20260427_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260428"
    ADD CONSTRAINT "speed_trades_20260428_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260429"
    ADD CONSTRAINT "speed_trades_20260429_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260430"
    ADD CONSTRAINT "speed_trades_20260430_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260501"
    ADD CONSTRAINT "speed_trades_20260501_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260502"
    ADD CONSTRAINT "speed_trades_20260502_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260503"
    ADD CONSTRAINT "speed_trades_20260503_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260504"
    ADD CONSTRAINT "speed_trades_20260504_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260505"
    ADD CONSTRAINT "speed_trades_20260505_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260506"
    ADD CONSTRAINT "speed_trades_20260506_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260507"
    ADD CONSTRAINT "speed_trades_20260507_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260508"
    ADD CONSTRAINT "speed_trades_20260508_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260509"
    ADD CONSTRAINT "speed_trades_20260509_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."speed_trades_20260510"
    ADD CONSTRAINT "speed_trades_20260510_pkey" PRIMARY KEY ("id", "created_at");



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_user_id_key" UNIQUE ("user_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referral_code_key" UNIQUE ("referral_code");



ALTER TABLE ONLY "public"."withdrawals"
    ADD CONSTRAINT "withdrawals_pkey" PRIMARY KEY ("id");



CREATE UNIQUE INDEX "demo_markets_question_en_unique" ON "public"."demo_markets" USING "btree" ("question_en");



CREATE UNIQUE INDEX "fee_config_canonical_idx" ON "public"."fee_config" USING "btree" ("fee_type", COALESCE("level", '-1'::integer), COALESCE("depth", '-1'::integer));



CREATE INDEX "idx_agent_microcredits_accrued" ON "public"."agent_pending_microcredits" USING "btree" ("accrued_amount") WHERE ("accrued_amount" >= 0.01);



CREATE UNIQUE INDEX "idx_agent_microcredits_agent_branch_unique" ON "public"."agent_pending_microcredits" USING "btree" ("agent_id", "branch_id");



CREATE INDEX "idx_agent_microcredits_agent_user" ON "public"."agent_pending_microcredits" USING "btree" ("agent_user_id");



CREATE INDEX "idx_amm_state_market" ON "public"."amm_state" USING "btree" ("market_id");



CREATE INDEX "idx_branch_admin_overrides_branch" ON "public"."branch_admin_overrides" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_admin_overrides_created" ON "public"."branch_admin_overrides" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_branch_agents_branch" ON "public"."branch_agents" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_agents_parent" ON "public"."branch_agents" USING "btree" ("parent_agent_id");



CREATE INDEX "idx_branch_agents_status" ON "public"."branch_agents" USING "btree" ("branch_id", "status");



CREATE INDEX "idx_branch_agents_user" ON "public"."branch_agents" USING "btree" ("user_id");



CREATE INDEX "idx_branch_market_config_branch" ON "public"."branch_market_config" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_pools_branch" ON "public"."branch_pools" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_pools_branch_market" ON "public"."branch_pools" USING "btree" ("branch_id", "market_id");



CREATE INDEX "idx_branch_pools_branch_type_ref" ON "public"."branch_pools" USING "btree" ("branch_id", "type", "reference_id");



CREATE INDEX "idx_branch_pools_created" ON "public"."branch_pools" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_branch_revenue_branch" ON "public"."branch_revenue" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_revenue_market" ON "public"."branch_revenue" USING "btree" ("market_id");



CREATE INDEX "idx_branch_trades_branch" ON "public"."branch_trades" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_trades_branch_created" ON "public"."branch_trades" USING "btree" ("branch_id", "created_at");



CREATE INDEX "idx_branch_trades_branch_market" ON "public"."branch_trades" USING "btree" ("branch_id", "market_id");



CREATE INDEX "idx_branch_trades_trade" ON "public"."branch_trades" USING "btree" ("trade_id");



CREATE INDEX "idx_branch_trades_user" ON "public"."branch_trades" USING "btree" ("user_id");



CREATE INDEX "idx_branch_user_assignments_agent" ON "public"."branch_user_assignments" USING "btree" ("agent_id");



CREATE INDEX "idx_branch_user_assignments_branch" ON "public"."branch_user_assignments" USING "btree" ("branch_id");



CREATE INDEX "idx_branch_user_assignments_user" ON "public"."branch_user_assignments" USING "btree" ("user_id");



CREATE INDEX "idx_branches_book_type" ON "public"."branches" USING "btree" ("book_type");



CREATE INDEX "idx_branches_code" ON "public"."branches" USING "btree" ("branch_code");



CREATE INDEX "idx_branches_manager" ON "public"."branches" USING "btree" ("manager_user_id");



CREATE INDEX "idx_branches_status" ON "public"."branches" USING "btree" ("status");



CREATE INDEX "idx_clawback_deficit_branch" ON "public"."commission_clawback_deficit" USING "btree" ("branch_id");



CREATE INDEX "idx_clawback_deficit_market" ON "public"."commission_clawback_deficit" USING "btree" ("market_id");



CREATE INDEX "idx_clawback_deficit_referrer" ON "public"."commission_clawback_deficit" USING "btree" ("referrer_id");



CREATE INDEX "idx_comment_likes_comment" ON "public"."comment_likes" USING "btree" ("comment_id");



CREATE INDEX "idx_comment_likes_user" ON "public"."comment_likes" USING "btree" ("user_id");



CREATE INDEX "idx_copy_settings_copier" ON "public"."copy_settings" USING "btree" ("copier_id");



CREATE INDEX "idx_copy_settings_leader" ON "public"."copy_settings" USING "btree" ("leader_id");



CREATE INDEX "idx_credit_chain_branch" ON "public"."credit_chain_ledger" USING "btree" ("branch_id");



CREATE INDEX "idx_credit_chain_created" ON "public"."credit_chain_ledger" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_credit_chain_issuer" ON "public"."credit_chain_ledger" USING "btree" ("issuer_id");



CREATE INDEX "idx_credit_chain_recipient" ON "public"."credit_chain_ledger" USING "btree" ("recipient_id");



CREATE INDEX "idx_demo_amm_state_market" ON "public"."demo_amm_state" USING "btree" ("market_id");



CREATE INDEX "idx_demo_markets_category" ON "public"."demo_markets" USING "btree" ("category");



CREATE INDEX "idx_demo_markets_closes_at" ON "public"."demo_markets" USING "btree" ("closes_at");



CREATE INDEX "idx_demo_markets_resolves_at" ON "public"."demo_markets" USING "btree" ("resolves_at");



CREATE INDEX "idx_demo_markets_short_code" ON "public"."demo_markets" USING "btree" ("short_code");



CREATE INDEX "idx_demo_markets_status" ON "public"."demo_markets" USING "btree" ("status");



CREATE INDEX "idx_demo_positions_active" ON "public"."demo_positions" USING "btree" ("user_id") WHERE ("shares_held" > (0)::numeric);



CREATE INDEX "idx_demo_positions_market" ON "public"."demo_positions" USING "btree" ("market_id");



CREATE INDEX "idx_demo_positions_user" ON "public"."demo_positions" USING "btree" ("user_id");



CREATE INDEX "idx_demo_positions_user_market" ON "public"."demo_positions" USING "btree" ("user_id", "market_id");



CREATE INDEX "idx_demo_scheduled_outcomes_created" ON "public"."demo_market_scheduled_outcomes" USING "btree" ("created_at");



CREATE INDEX "idx_demo_trades_market" ON "public"."demo_trades" USING "btree" ("market_id");



CREATE INDEX "idx_demo_trades_market_created" ON "public"."demo_trades" USING "btree" ("market_id", "created_at" DESC);



CREATE INDEX "idx_demo_trades_user" ON "public"."demo_trades" USING "btree" ("user_id");



CREATE INDEX "idx_demo_trades_user_created" ON "public"."demo_trades" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_demo_trades_user_market" ON "public"."demo_trades" USING "btree" ("user_id", "market_id");



CREATE INDEX "idx_demo_transactions_reference" ON "public"."demo_transactions" USING "btree" ("reference_id");



CREATE INDEX "idx_demo_transactions_type" ON "public"."demo_transactions" USING "btree" ("type");



CREATE INDEX "idx_demo_transactions_user" ON "public"."demo_transactions" USING "btree" ("user_id");



CREATE INDEX "idx_demo_transactions_user_created" ON "public"."demo_transactions" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_deposits_one_pending_per_user_provider" ON "public"."deposits" USING "btree" ("user_id", "provider") WHERE ("status" = 'pending_review'::"text");



COMMENT ON INDEX "public"."idx_deposits_one_pending_per_user_provider" IS 'Enforces at most one pending_review deposit per (user_id, provider). Prevents race-condition duplicates from submit_manual_deposit.';



CREATE INDEX "idx_deposits_provider" ON "public"."deposits" USING "btree" ("provider");



CREATE INDEX "idx_deposits_provider_ref" ON "public"."deposits" USING "btree" ("provider_ref");



CREATE INDEX "idx_deposits_status" ON "public"."deposits" USING "btree" ("status");



CREATE INDEX "idx_deposits_user_id" ON "public"."deposits" USING "btree" ("user_id");



CREATE INDEX "idx_help_articles_collection" ON "public"."help_articles" USING "btree" ("collection_id", "sort_order");



CREATE INDEX "idx_help_articles_search" ON "public"."help_articles" USING "gin" ("to_tsvector"('"english"'::"regconfig", (("title" || ' '::"text") || "content")));



CREATE INDEX "idx_help_collections_locale" ON "public"."help_collections" USING "btree" ("locale", "sort_order");



CREATE INDEX "idx_leader_stats_accuracy" ON "public"."leader_stats" USING "btree" ("accuracy_pct" DESC);



CREATE INDEX "idx_leader_stats_pnl" ON "public"."leader_stats" USING "btree" ("total_pnl" DESC);



CREATE INDEX "idx_market_comments_market" ON "public"."market_comments" USING "btree" ("market_id", "created_at" DESC);



CREATE INDEX "idx_market_comments_market_id" ON "public"."market_comments" USING "btree" ("market_id", "created_at" DESC);



CREATE INDEX "idx_market_comments_parent" ON "public"."market_comments" USING "btree" ("parent_id");



CREATE INDEX "idx_market_comments_user" ON "public"."market_comments" USING "btree" ("user_id");



CREATE INDEX "idx_markets_category" ON "public"."markets" USING "btree" ("category");



CREATE INDEX "idx_markets_closes_at" ON "public"."markets" USING "btree" ("closes_at");



CREATE INDEX "idx_markets_short_code" ON "public"."markets" USING "btree" ("short_code");



CREATE INDEX "idx_markets_status" ON "public"."markets" USING "btree" ("status");



CREATE INDEX "idx_notifications_created" ON "public"."notifications" USING "btree" ("created_at");



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id", "is_read");



CREATE INDEX "idx_otp_phone_expires" ON "public"."otp_verifications" USING "btree" ("phone", "expires_at");



CREATE INDEX "idx_positions_active" ON "public"."positions" USING "btree" ("user_id") WHERE ("shares_held" > (0)::numeric);



CREATE INDEX "idx_positions_branch" ON "public"."positions" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "idx_positions_market" ON "public"."positions" USING "btree" ("market_id");



CREATE INDEX "idx_positions_user" ON "public"."positions" USING "btree" ("user_id");



CREATE INDEX "idx_positions_user_market" ON "public"."positions" USING "btree" ("user_id", "market_id");



CREATE INDEX "idx_pr_market" ON "public"."platform_revenue" USING "btree" ("market_id");



CREATE INDEX "idx_prelaunch_questions_active" ON "public"."prelaunch_questions" USING "btree" ("active", "sort_order");



CREATE INDEX "idx_prelaunch_votes_question" ON "public"."prelaunch_votes" USING "btree" ("question_id");



CREATE INDEX "idx_prelaunch_votes_visitor" ON "public"."prelaunch_votes" USING "btree" ("visitor_id");



CREATE UNIQUE INDEX "idx_prelaunch_waitlist_email" ON "public"."prelaunch_waitlist" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE INDEX "idx_prelaunch_waitlist_referral" ON "public"."prelaunch_waitlist" USING "btree" ("referral_code");



CREATE INDEX "idx_price_alerts_active" ON "public"."price_alerts" USING "btree" ("market_id", "is_active") WHERE ("is_active" = true);



CREATE INDEX "idx_price_alerts_user" ON "public"."price_alerts" USING "btree" ("user_id");



CREATE INDEX "idx_rc_market" ON "public"."referral_commissions" USING "btree" ("market_id");



CREATE INDEX "idx_rc_referrer" ON "public"."referral_commissions" USING "btree" ("referrer_id");



CREATE INDEX "idx_rc_referrer_bettor" ON "public"."referral_commissions" USING "btree" ("referrer_id", "trader_id");



CREATE INDEX "idx_rc_referrer_created" ON "public"."referral_commissions" USING "btree" ("referrer_id", "created_at" DESC);



CREATE INDEX "idx_rc_revenue_type" ON "public"."referral_commissions" USING "btree" ("revenue_type");



CREATE INDEX "idx_rc_status" ON "public"."referral_commissions" USING "btree" ("status");



CREATE INDEX "idx_rc_trader" ON "public"."referral_commissions" USING "btree" ("trader_id");



CREATE INDEX "idx_referral_commissions_agent_unlock" ON "public"."referral_commissions" USING "btree" ("referrer_id", "unlock_at") WHERE ("status" = 'credited'::"public"."commission_status");



CREATE INDEX "idx_referral_commissions_branch" ON "public"."referral_commissions" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "idx_referral_commissions_market_status" ON "public"."referral_commissions" USING "btree" ("market_id", "status");



CREATE INDEX "idx_referral_commissions_referrer_status" ON "public"."referral_commissions" USING "btree" ("referrer_id", "status");



CREATE INDEX "idx_referral_commissions_trade" ON "public"."referral_commissions" USING "btree" ("trade_id");



CREATE INDEX "idx_speed_book_snapshots_asset_at" ON "public"."speed_external_book_snapshots" USING "btree" ("asset", "snapshot_at" DESC);



CREATE INDEX "idx_speed_book_snapshots_venue_at" ON "public"."speed_external_book_snapshots" USING "btree" ("venue", "snapshot_at" DESC);



CREATE INDEX "idx_speed_branches_status" ON "public"."speed_branches" USING "btree" ("speed_status") WHERE ("speed_status" = ANY (ARRAY['active'::"public"."speed_branch_status", 'warning'::"public"."speed_branch_status"]));



CREATE INDEX "idx_speed_klines_asset_ts" ON "public"."speed_oracle_klines" USING "btree" ("asset", "ts" DESC);



CREATE UNIQUE INDEX "idx_speed_klines_dedupe" ON "public"."speed_oracle_klines" USING "btree" ("asset", "ts", "source");



CREATE INDEX "idx_speed_market_exposure_asset" ON "public"."speed_market_exposure_live" USING "btree" ("asset");



CREATE INDEX "idx_speed_markets_asset_status" ON "public"."speed_markets" USING "btree" ("asset", "status");



CREATE INDEX "idx_speed_markets_open" ON "public"."speed_markets" USING "btree" ("asset", "closes_at") WHERE ("status" = 'open'::"public"."speed_market_status");



CREATE INDEX "idx_speed_markets_resolving" ON "public"."speed_markets" USING "btree" ("closes_at") WHERE ("status" = ANY (ARRAY['open'::"public"."speed_market_status", 'resolving'::"public"."speed_market_status"]));



CREATE INDEX "idx_speed_oracle_asset_ts" ON "public"."speed_oracle_ticks" USING "btree" ("asset", "ts" DESC);



CREATE UNIQUE INDEX "idx_speed_oracle_ticks_dedupe" ON "public"."speed_oracle_ticks" USING "btree" ("asset", "ts", "source");



CREATE INDEX "idx_speed_pool_branch_created" ON ONLY "public"."speed_pool_ledger" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "idx_speed_pool_branch_market_created" ON ONLY "public"."speed_pool_ledger" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "idx_speed_pool_branch_type_created" ON ONLY "public"."speed_pool_ledger" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "idx_speed_positions_branch_market_open" ON "public"."speed_positions" USING "btree" ("branch_id", "market_id") WHERE ("status" = 'open'::"public"."speed_position_status");



CREATE INDEX "idx_speed_positions_market_open" ON "public"."speed_positions" USING "btree" ("market_id") WHERE ("status" = 'open'::"public"."speed_position_status");



CREATE INDEX "idx_speed_positions_user_market_side_open" ON "public"."speed_positions" USING "btree" ("user_id", "market_id", "side") WHERE ("status" = 'open'::"public"."speed_position_status");



CREATE INDEX "idx_speed_positions_user_recent" ON "public"."speed_positions" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_speed_settlements_branch" ON "public"."speed_settlements" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "idx_speed_settlements_market" ON "public"."speed_settlements" USING "btree" ("market_id");



CREATE INDEX "idx_speed_trades_branch_created" ON ONLY "public"."speed_trades" USING "btree" ("branch_id", "created_at");



CREATE INDEX "idx_speed_trades_idempotency" ON ONLY "public"."speed_trades" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "idx_speed_trades_market_created" ON ONLY "public"."speed_trades" USING "btree" ("market_id", "created_at");



CREATE INDEX "idx_speed_trades_user_created" ON ONLY "public"."speed_trades" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "idx_system_logs_created_at" ON "public"."system_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_system_logs_severity" ON "public"."system_logs" USING "btree" ("severity");



CREATE INDEX "idx_system_logs_source" ON "public"."system_logs" USING "btree" ("source");



CREATE INDEX "idx_system_logs_unacknowledged" ON "public"."system_logs" USING "btree" ("acknowledged") WHERE ("acknowledged" = false);



CREATE INDEX "idx_trades_branch" ON "public"."trades" USING "btree" ("branch_id") WHERE ("branch_id" IS NOT NULL);



CREATE INDEX "idx_trades_created" ON "public"."trades" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_trades_market" ON "public"."trades" USING "btree" ("market_id");



CREATE INDEX "idx_trades_market_created" ON "public"."trades" USING "btree" ("market_id", "created_at" DESC);



CREATE INDEX "idx_trades_market_side" ON "public"."trades" USING "btree" ("market_id", "side");



CREATE INDEX "idx_trades_user" ON "public"."trades" USING "btree" ("user_id");



CREATE INDEX "idx_trades_user_id" ON "public"."trades" USING "btree" ("user_id");



CREATE INDEX "idx_trades_user_market" ON "public"."trades" USING "btree" ("user_id", "market_id");



CREATE INDEX "idx_transactions_created_at" ON "public"."transactions" USING "btree" ("created_at");



CREATE INDEX "idx_transactions_reference" ON "public"."transactions" USING "btree" ("reference_id");



CREATE INDEX "idx_transactions_type" ON "public"."transactions" USING "btree" ("type");



CREATE INDEX "idx_transactions_user_id" ON "public"."transactions" USING "btree" ("user_id");



CREATE INDEX "idx_transactions_user_type" ON "public"."transactions" USING "btree" ("user_id", "type");



CREATE INDEX "idx_user_wallets_erc20" ON "public"."user_wallets" USING "btree" ("wallet_address_erc20") WHERE ("wallet_address_erc20" IS NOT NULL);



CREATE INDEX "idx_user_wallets_trc20" ON "public"."user_wallets" USING "btree" ("wallet_address_trc20") WHERE ("wallet_address_trc20" IS NOT NULL);



CREATE INDEX "idx_users_demo_first_enabled" ON "public"."users" USING "btree" ("demo_first_enabled_at") WHERE ("demo_first_enabled_at" IS NOT NULL);



CREATE UNIQUE INDEX "idx_users_display_name_unique" ON "public"."users" USING "btree" ("lower"("display_name")) WHERE ("display_name" IS NOT NULL);



CREATE INDEX "idx_users_email" ON "public"."users" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE INDEX "idx_users_phone" ON "public"."users" USING "btree" ("phone");



CREATE INDEX "idx_users_referral_code" ON "public"."users" USING "btree" ("referral_code");



CREATE INDEX "idx_users_referred_by" ON "public"."users" USING "btree" ("referred_by");



CREATE INDEX "idx_users_signup_branch" ON "public"."users" USING "btree" ("signup_branch_id") WHERE ("signup_branch_id" IS NOT NULL);



CREATE INDEX "idx_withdrawals_destination_type" ON "public"."withdrawals" USING "btree" ("destination_type");



CREATE INDEX "idx_withdrawals_external_reference_id" ON "public"."withdrawals" USING "btree" ("external_reference_id") WHERE ("external_reference_id" IS NOT NULL);



CREATE INDEX "idx_withdrawals_provider" ON "public"."withdrawals" USING "btree" ("provider");



CREATE INDEX "idx_withdrawals_status" ON "public"."withdrawals" USING "btree" ("status");



CREATE INDEX "idx_withdrawals_user_id" ON "public"."withdrawals" USING "btree" ("user_id");



CREATE UNIQUE INDEX "positions_user_market_side_branch_unique" ON "public"."positions" USING "btree" ("user_id", "market_id", "side", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::"uuid"));



CREATE INDEX "speed_pool_ledger_20260427_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260427" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260427_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260427" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260427_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260427" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260428_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260428" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260428_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260428" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260428_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260428" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260429_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260429" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260429_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260429" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260429_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260429" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260430_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260430" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260430_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260430" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260430_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260430" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260501_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260501" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260501_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260501" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260501_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260501" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260502_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260502" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260502_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260502" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260502_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260502" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260503_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260503" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260503_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260503" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260503_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260503" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260504_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260504" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260504_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260504" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260504_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260504" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260505_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260505" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260505_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260505" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260505_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260505" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260506_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260506" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260506_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260506" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260506_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260506" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260507_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260507" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260507_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260507" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260507_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260507" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260508_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260508" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260508_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260508" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260508_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260508" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260509_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260509" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260509_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260509" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260509_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260509" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260510_branch_id_created_at_idx" ON "public"."speed_pool_ledger_20260510" USING "btree" ("branch_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260510_branch_id_market_id_created_at_idx" ON "public"."speed_pool_ledger_20260510" USING "btree" ("branch_id", "market_id", "created_at" DESC);



CREATE INDEX "speed_pool_ledger_20260510_branch_id_type_created_at_idx" ON "public"."speed_pool_ledger_20260510" USING "btree" ("branch_id", "type", "created_at" DESC);



CREATE INDEX "speed_trades_20260427_branch_id_created_at_idx" ON "public"."speed_trades_20260427" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260427_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260427" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260427_market_id_created_at_idx" ON "public"."speed_trades_20260427" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260427_user_id_created_at_idx" ON "public"."speed_trades_20260427" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260428_branch_id_created_at_idx" ON "public"."speed_trades_20260428" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260428_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260428" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260428_market_id_created_at_idx" ON "public"."speed_trades_20260428" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260428_user_id_created_at_idx" ON "public"."speed_trades_20260428" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260429_branch_id_created_at_idx" ON "public"."speed_trades_20260429" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260429_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260429" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260429_market_id_created_at_idx" ON "public"."speed_trades_20260429" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260429_user_id_created_at_idx" ON "public"."speed_trades_20260429" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260430_branch_id_created_at_idx" ON "public"."speed_trades_20260430" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260430_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260430" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260430_market_id_created_at_idx" ON "public"."speed_trades_20260430" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260430_user_id_created_at_idx" ON "public"."speed_trades_20260430" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260501_branch_id_created_at_idx" ON "public"."speed_trades_20260501" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260501_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260501" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260501_market_id_created_at_idx" ON "public"."speed_trades_20260501" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260501_user_id_created_at_idx" ON "public"."speed_trades_20260501" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260502_branch_id_created_at_idx" ON "public"."speed_trades_20260502" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260502_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260502" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260502_market_id_created_at_idx" ON "public"."speed_trades_20260502" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260502_user_id_created_at_idx" ON "public"."speed_trades_20260502" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260503_branch_id_created_at_idx" ON "public"."speed_trades_20260503" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260503_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260503" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260503_market_id_created_at_idx" ON "public"."speed_trades_20260503" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260503_user_id_created_at_idx" ON "public"."speed_trades_20260503" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260504_branch_id_created_at_idx" ON "public"."speed_trades_20260504" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260504_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260504" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260504_market_id_created_at_idx" ON "public"."speed_trades_20260504" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260504_user_id_created_at_idx" ON "public"."speed_trades_20260504" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260505_branch_id_created_at_idx" ON "public"."speed_trades_20260505" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260505_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260505" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260505_market_id_created_at_idx" ON "public"."speed_trades_20260505" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260505_user_id_created_at_idx" ON "public"."speed_trades_20260505" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260506_branch_id_created_at_idx" ON "public"."speed_trades_20260506" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260506_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260506" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260506_market_id_created_at_idx" ON "public"."speed_trades_20260506" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260506_user_id_created_at_idx" ON "public"."speed_trades_20260506" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260507_branch_id_created_at_idx" ON "public"."speed_trades_20260507" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260507_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260507" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260507_market_id_created_at_idx" ON "public"."speed_trades_20260507" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260507_user_id_created_at_idx" ON "public"."speed_trades_20260507" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260508_branch_id_created_at_idx" ON "public"."speed_trades_20260508" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260508_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260508" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260508_market_id_created_at_idx" ON "public"."speed_trades_20260508" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260508_user_id_created_at_idx" ON "public"."speed_trades_20260508" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260509_branch_id_created_at_idx" ON "public"."speed_trades_20260509" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260509_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260509" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260509_market_id_created_at_idx" ON "public"."speed_trades_20260509" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260509_user_id_created_at_idx" ON "public"."speed_trades_20260509" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "speed_trades_20260510_branch_id_created_at_idx" ON "public"."speed_trades_20260510" USING "btree" ("branch_id", "created_at");



CREATE INDEX "speed_trades_20260510_branch_id_idempotency_key_idx" ON "public"."speed_trades_20260510" USING "btree" ("branch_id", "idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "speed_trades_20260510_market_id_created_at_idx" ON "public"."speed_trades_20260510" USING "btree" ("market_id", "created_at");



CREATE INDEX "speed_trades_20260510_user_id_created_at_idx" ON "public"."speed_trades_20260510" USING "btree" ("user_id", "created_at" DESC);



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260427_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260427_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260427_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260427_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260428_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260428_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260428_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260428_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260429_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260429_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260429_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260429_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260430_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260430_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260430_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260430_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260501_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260501_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260501_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260501_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260502_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260502_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260502_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260502_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260503_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260503_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260503_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260503_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260504_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260504_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260504_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260504_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260505_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260505_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260505_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260505_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260506_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260506_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260506_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260506_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260507_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260507_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260507_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260507_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260508_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260508_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260508_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260508_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260509_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260509_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260509_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260509_pkey";



ALTER INDEX "public"."idx_speed_pool_branch_created" ATTACH PARTITION "public"."speed_pool_ledger_20260510_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_market_created" ATTACH PARTITION "public"."speed_pool_ledger_20260510_branch_id_market_id_created_at_idx";



ALTER INDEX "public"."idx_speed_pool_branch_type_created" ATTACH PARTITION "public"."speed_pool_ledger_20260510_branch_id_type_created_at_idx";



ALTER INDEX "public"."speed_pool_ledger_pkey" ATTACH PARTITION "public"."speed_pool_ledger_20260510_pkey";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260427_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260427_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260427_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260427_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260427_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260428_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260428_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260428_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260428_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260428_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260429_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260429_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260429_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260429_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260429_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260430_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260430_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260430_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260430_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260430_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260501_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260501_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260501_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260501_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260501_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260502_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260502_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260502_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260502_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260502_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260503_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260503_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260503_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260503_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260503_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260504_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260504_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260504_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260504_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260504_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260505_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260505_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260505_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260505_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260505_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260506_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260506_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260506_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260506_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260506_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260507_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260507_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260507_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260507_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260507_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260508_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260508_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260508_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260508_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260508_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260509_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260509_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260509_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260509_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260509_user_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_branch_created" ATTACH PARTITION "public"."speed_trades_20260510_branch_id_created_at_idx";



ALTER INDEX "public"."idx_speed_trades_idempotency" ATTACH PARTITION "public"."speed_trades_20260510_branch_id_idempotency_key_idx";



ALTER INDEX "public"."idx_speed_trades_market_created" ATTACH PARTITION "public"."speed_trades_20260510_market_id_created_at_idx";



ALTER INDEX "public"."speed_trades_pkey" ATTACH PARTITION "public"."speed_trades_20260510_pkey";



ALTER INDEX "public"."idx_speed_trades_user_created" ATTACH PARTITION "public"."speed_trades_20260510_user_id_created_at_idx";



CREATE OR REPLACE TRIGGER "amm_state_updated_at" BEFORE UPDATE ON "public"."amm_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "branch_agents_commission_rules" BEFORE INSERT OR UPDATE ON "public"."branch_agents" FOR EACH ROW EXECUTE FUNCTION "public"."_enforce_commission_branch_agent_rules"();



CREATE OR REPLACE TRIGGER "branch_agents_updated_at" BEFORE UPDATE ON "public"."branch_agents" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "branch_market_config_updated_at" BEFORE UPDATE ON "public"."branch_market_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "branches_book_type_immutable" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."_protect_branch_book_type"();



CREATE OR REPLACE TRIGGER "branches_reject_reserved_slug" BEFORE INSERT OR UPDATE OF "branch_code" ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."_reject_reserved_branch_slug"();



CREATE OR REPLACE TRIGGER "branches_updated_at" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "copy_settings_updated_at" BEFORE UPDATE ON "public"."copy_settings" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "demo_amm_state_updated_at" BEFORE UPDATE ON "public"."demo_amm_state" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "demo_markets_updated_at" BEFORE UPDATE ON "public"."demo_markets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "demo_positions_updated_at" BEFORE UPDATE ON "public"."demo_positions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "fee_config_updated_at" BEFORE UPDATE ON "public"."fee_config" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "leader_stats_updated_at" BEFORE UPDATE ON "public"."leader_stats" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "markets_commission_release_on_status_change" AFTER UPDATE OF "status" ON "public"."markets" FOR EACH ROW WHEN (("new"."status" IS DISTINCT FROM "old"."status")) EXECUTE FUNCTION "public"."_on_market_status_change_release_commissions"();



CREATE OR REPLACE TRIGGER "markets_updated_at" BEFORE UPDATE ON "public"."markets" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "positions_updated_at" BEFORE UPDATE ON "public"."positions" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "prevent_branch_admin_overrides_delete" BEFORE DELETE ON "public"."branch_admin_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_table_mutation"();

ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "prevent_branch_admin_overrides_delete";



CREATE OR REPLACE TRIGGER "prevent_branch_admin_overrides_update" BEFORE UPDATE ON "public"."branch_admin_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_table_mutation"();

ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "prevent_branch_admin_overrides_update";



CREATE OR REPLACE TRIGGER "prevent_branch_trades_delete" BEFORE DELETE ON "public"."branch_trades" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_table_mutation"();

ALTER TABLE "public"."branch_trades" DISABLE TRIGGER "prevent_branch_trades_delete";



CREATE OR REPLACE TRIGGER "prevent_branch_trades_update" BEFORE UPDATE ON "public"."branch_trades" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_audit_table_mutation"();

ALTER TABLE "public"."branch_trades" DISABLE TRIGGER "prevent_branch_trades_update";



CREATE OR REPLACE TRIGGER "speed_oracle_finalize_pending" AFTER INSERT OR UPDATE ON "public"."speed_oracle_latest" FOR EACH STATEMENT EXECUTE FUNCTION "public"."trg_speed_finalize_on_oracle"();



COMMENT ON TRIGGER "speed_oracle_finalize_pending" ON "public"."speed_oracle_latest" IS 'Strike-at-launch hook (mig 350): every oracle upsert flushes any pending speed_market past its opens_at. Worker upserts at 1Hz, so strike lag ≤ ~1 second.';



CREATE OR REPLACE TRIGGER "trg_branch_admin_overrides_no_delete" BEFORE DELETE ON "public"."branch_admin_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "trg_branch_admin_overrides_no_delete";



CREATE OR REPLACE TRIGGER "trg_branch_admin_overrides_no_update" BEFORE UPDATE ON "public"."branch_admin_overrides" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."branch_admin_overrides" DISABLE TRIGGER "trg_branch_admin_overrides_no_update";



CREATE OR REPLACE TRIGGER "trg_branch_agents_pl_cap" BEFORE UPDATE ON "public"."branch_agents" FOR EACH ROW WHEN ((("new"."rate" IS DISTINCT FROM "old"."rate") OR ("new"."is_active" IS DISTINCT FROM "old"."is_active") OR ("new"."agent_type" IS DISTINCT FROM "old"."agent_type") OR ("new"."branch_id" IS DISTINCT FROM "old"."branch_id"))) EXECUTE FUNCTION "public"."_enforce_pl_rate_cap"();



CREATE OR REPLACE TRIGGER "trg_branch_agents_pl_cap_insert" BEFORE INSERT ON "public"."branch_agents" FOR EACH ROW WHEN ((("new"."agent_type" = 'pl'::"public"."branch_agent_type") AND ("new"."is_active" = true))) EXECUTE FUNCTION "public"."_enforce_pl_rate_cap_insert"();



CREATE OR REPLACE TRIGGER "trg_branch_pools_no_delete" BEFORE DELETE ON "public"."branch_pools" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."branch_pools" DISABLE TRIGGER "trg_branch_pools_no_delete";



CREATE OR REPLACE TRIGGER "trg_branch_pools_no_update" BEFORE UPDATE ON "public"."branch_pools" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."branch_pools" DISABLE TRIGGER "trg_branch_pools_no_update";



CREATE OR REPLACE TRIGGER "trg_branches_pool_underflow" AFTER UPDATE OF "pool_balance" ON "public"."branches" FOR EACH ROW WHEN (("new"."pool_balance" IS DISTINCT FROM "old"."pool_balance")) EXECUTE FUNCTION "public"."_track_pool_underflow"();



CREATE OR REPLACE TRIGGER "trg_credit_chain_no_delete" BEFORE DELETE ON "public"."credit_chain_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."credit_chain_ledger" DISABLE TRIGGER "trg_credit_chain_no_delete";



CREATE OR REPLACE TRIGGER "trg_credit_chain_no_update" BEFORE UPDATE ON "public"."credit_chain_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_branch_pools_mutation"();

ALTER TABLE "public"."credit_chain_ledger" DISABLE TRIGGER "trg_credit_chain_no_update";



CREATE OR REPLACE TRIGGER "trg_handle_referral_signup" AFTER UPDATE ON "public"."users" FOR EACH ROW WHEN ((("old"."referred_by" IS NULL) AND ("new"."referred_by" IS NOT NULL))) EXECUTE FUNCTION "public"."handle_referral_signup"();



CREATE OR REPLACE TRIGGER "trg_protect_sensitive_branch_columns" BEFORE UPDATE ON "public"."branches" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_sensitive_branch_updates"();



CREATE OR REPLACE TRIGGER "trg_protect_sensitive_user_columns" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_sensitive_user_updates"();



CREATE OR REPLACE TRIGGER "trg_speed_pool_ledger_no_delete" BEFORE DELETE ON "public"."speed_pool_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_speed_pool_ledger_mutation"();



CREATE OR REPLACE TRIGGER "trg_speed_pool_ledger_no_update" BEFORE UPDATE ON "public"."speed_pool_ledger" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_speed_pool_ledger_mutation"();



CREATE OR REPLACE TRIGGER "trg_speed_position_exposure" AFTER INSERT OR DELETE OR UPDATE ON "public"."speed_positions" FOR EACH ROW EXECUTE FUNCTION "public"."_speed_position_exposure_trigger"();



CREATE OR REPLACE TRIGGER "trg_transactions_no_delete" BEFORE DELETE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_transactions_mutation"();



CREATE OR REPLACE TRIGGER "trg_transactions_no_update" BEFORE UPDATE ON "public"."transactions" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_transactions_mutation"();



CREATE OR REPLACE TRIGGER "users_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."admin_config"
    ADD CONSTRAINT "admin_config_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."agent_pending_microcredits"
    ADD CONSTRAINT "agent_pending_microcredits_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."branch_agents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_pending_microcredits"
    ADD CONSTRAINT "agent_pending_microcredits_agent_user_id_fkey" FOREIGN KEY ("agent_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."agent_pending_microcredits"
    ADD CONSTRAINT "agent_pending_microcredits_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."amm_state"
    ADD CONSTRAINT "amm_state_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."branch_admin_overrides"
    ADD CONSTRAINT "branch_admin_overrides_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branch_admin_overrides"
    ADD CONSTRAINT "branch_admin_overrides_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_parent_agent_id_fkey" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."branch_agents"("id");



ALTER TABLE ONLY "public"."branch_agents"
    ADD CONSTRAINT "branch_agents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branch_market_config"
    ADD CONSTRAINT "branch_market_config_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_market_config"
    ADD CONSTRAINT "branch_market_config_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."branch_pools"
    ADD CONSTRAINT "branch_pools_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_pools"
    ADD CONSTRAINT "branch_pools_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."branch_revenue"
    ADD CONSTRAINT "branch_revenue_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_revenue"
    ADD CONSTRAINT "branch_revenue_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."branch_agents"("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id");



ALTER TABLE ONLY "public"."branch_trades"
    ADD CONSTRAINT "branch_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branch_user_assignments"
    ADD CONSTRAINT "branch_user_assignments_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "public"."branch_agents"("id");



ALTER TABLE ONLY "public"."branch_user_assignments"
    ADD CONSTRAINT "branch_user_assignments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."branch_user_assignments"
    ADD CONSTRAINT "branch_user_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_manager_user_id_fkey" FOREIGN KEY ("manager_user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."branches"
    ADD CONSTRAINT "branches_solvency_override_by_fkey" FOREIGN KEY ("solvency_override_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "public"."market_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comment_likes"
    ADD CONSTRAINT "comment_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."commission_clawback_deficit"
    ADD CONSTRAINT "commission_clawback_deficit_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."commission_clawback_deficit"
    ADD CONSTRAINT "commission_clawback_deficit_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "public"."referral_commissions"("id");



ALTER TABLE ONLY "public"."commission_clawback_deficit"
    ADD CONSTRAINT "commission_clawback_deficit_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."commission_clawback_deficit"
    ADD CONSTRAINT "commission_clawback_deficit_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."copy_settings"
    ADD CONSTRAINT "copy_settings_copier_id_fkey" FOREIGN KEY ("copier_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."copy_settings"
    ADD CONSTRAINT "copy_settings_leader_id_fkey" FOREIGN KEY ("leader_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."credit_chain_ledger"
    ADD CONSTRAINT "credit_chain_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."credit_chain_ledger"
    ADD CONSTRAINT "credit_chain_ledger_issuer_id_fkey" FOREIGN KEY ("issuer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."credit_chain_ledger"
    ADD CONSTRAINT "credit_chain_ledger_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."demo_amm_state"
    ADD CONSTRAINT "demo_amm_state_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."demo_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_market_scheduled_outcomes"
    ADD CONSTRAINT "demo_market_scheduled_outcomes_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."demo_market_scheduled_outcomes"
    ADD CONSTRAINT "demo_market_scheduled_outcomes_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."demo_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_markets"
    ADD CONSTRAINT "demo_markets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."demo_positions"
    ADD CONSTRAINT "demo_positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."demo_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_positions"
    ADD CONSTRAINT "demo_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_trades"
    ADD CONSTRAINT "demo_trades_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."demo_markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_trades"
    ADD CONSTRAINT "demo_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."demo_transactions"
    ADD CONSTRAINT "demo_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deposits"
    ADD CONSTRAINT "deposits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."help_articles"
    ADD CONSTRAINT "help_articles_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "public"."help_collections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leader_stats"
    ADD CONSTRAINT "leader_stats_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."market_comments"
    ADD CONSTRAINT "market_comments_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."market_comments"
    ADD CONSTRAINT "market_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."market_comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."market_comments"
    ADD CONSTRAINT "market_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."markets"
    ADD CONSTRAINT "markets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."platform_revenue"
    ADD CONSTRAINT "platform_revenue_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."platform_revenue"
    ADD CONSTRAINT "platform_revenue_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."prelaunch_votes"
    ADD CONSTRAINT "prelaunch_votes_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "public"."prelaunch_questions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."price_alerts"
    ADD CONSTRAINT "price_alerts_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."price_alerts"
    ADD CONSTRAINT "price_alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_bettor_id_fkey" FOREIGN KEY ("trader_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_referrer_id_fkey" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."referral_commissions"
    ADD CONSTRAINT "referral_commissions_trade_id_fkey" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id");



ALTER TABLE ONLY "public"."speed_branches"
    ADD CONSTRAINT "speed_branches_activated_by_fkey" FOREIGN KEY ("activated_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_branches"
    ADD CONSTRAINT "speed_branches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_exposure_live"
    ADD CONSTRAINT "speed_exposure_live_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_external_book_snapshots"
    ADD CONSTRAINT "speed_external_book_snapshots_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_market_exposure_live"
    ADD CONSTRAINT "speed_market_exposure_live_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."speed_markets"("id") ON DELETE CASCADE;



ALTER TABLE "public"."speed_pool_ledger"
    ADD CONSTRAINT "speed_pool_ledger_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."speed_pool_ledger"
    ADD CONSTRAINT "speed_pool_ledger_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."speed_markets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_positions"
    ADD CONSTRAINT "speed_positions_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_positions"
    ADD CONSTRAINT "speed_positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."speed_markets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_positions"
    ADD CONSTRAINT "speed_positions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_settlements"
    ADD CONSTRAINT "speed_settlements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_settlements"
    ADD CONSTRAINT "speed_settlements_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."speed_markets"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."speed_settlements"
    ADD CONSTRAINT "speed_settlements_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."speed_positions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."speed_settlements"
    ADD CONSTRAINT "speed_settlements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."speed_trades"
    ADD CONSTRAINT "speed_trades_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."speed_trades"
    ADD CONSTRAINT "speed_trades_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."speed_markets"("id") ON DELETE RESTRICT;



ALTER TABLE "public"."speed_trades"
    ADD CONSTRAINT "speed_trades_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "public"."speed_positions"("id") ON DELETE CASCADE;



ALTER TABLE "public"."speed_trades"
    ADD CONSTRAINT "speed_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."system_logs"
    ADD CONSTRAINT "system_logs_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_copied_from_user_fkey" FOREIGN KEY ("copied_from_user") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."transactions"
    ADD CONSTRAINT "transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."user_wallets"
    ADD CONSTRAINT "user_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_referred_by_fkey" FOREIGN KEY ("referred_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_signup_branch_id_fkey" FOREIGN KEY ("signup_branch_id") REFERENCES "public"."branches"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."withdrawals"
    ADD CONSTRAINT "withdrawals_sent_by_fkey" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."withdrawals"
    ADD CONSTRAINT "withdrawals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");



CREATE POLICY "Admin can read branch_revenue" ON "public"."branch_revenue" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admin can read clawback deficit" ON "public"."commission_clawback_deficit" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admin full access on speed_main_pool_state" ON "public"."speed_main_pool_state" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin only" ON "public"."speed_external_book_snapshots" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_branches" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_exposure_live" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_market_exposure_live" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_oracle_ticks" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_pool_ledger" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_positions" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_settlements" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin read" ON "public"."speed_trades" FOR SELECT USING ("public"."is_admin"());



CREATE POLICY "Admin reads all microcredits" ON "public"."agent_pending_microcredits" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admin write" ON "public"."speed_markets" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "Admins can insert markets" ON "public"."markets" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all assignments" ON "public"."branch_user_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all branch_agents" ON "public"."branch_agents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all branch_market_config" ON "public"."branch_market_config" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all branch_pools" ON "public"."branch_pools" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all branch_trades" ON "public"."branch_trades" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all branches" ON "public"."branches" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all commissions" ON "public"."referral_commissions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all credit_chain entries" ON "public"."credit_chain_ledger" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all deposits" ON "public"."deposits" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all notifications" ON "public"."notifications" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all overrides" ON "public"."branch_admin_overrides" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all transactions" ON "public"."transactions" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read all withdrawals" ON "public"."withdrawals" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read revenue" ON "public"."platform_revenue" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can read system_logs" ON "public"."system_logs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update branches" ON "public"."branches" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update fee config" ON "public"."fee_config" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update markets" ON "public"."markets" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Admins can update system_logs" ON "public"."system_logs" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "Agents can read assigned users" ON "public"."branch_user_assignments" FOR SELECT USING (("agent_id" IN ( SELECT "branch_agents"."id"
   FROM "public"."branch_agents"
  WHERE ("branch_agents"."user_id" = "auth"."uid"()))));



CREATE POLICY "Agents can read own record" ON "public"."branch_agents" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Agents can read sub-agents" ON "public"."branch_agents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branch_agents" "ba"
  WHERE (("ba"."user_id" = "auth"."uid"()) AND ("ba"."id" = "branch_agents"."parent_agent_id") AND ("ba"."branch_id" = "branch_agents"."branch_id")))));



CREATE POLICY "Agents read own microcredits" ON "public"."agent_pending_microcredits" FOR SELECT USING (("agent_user_id" = "auth"."uid"()));



CREATE POLICY "Anyone can read AMM state" ON "public"."amm_state" FOR SELECT USING (true);



CREATE POLICY "Anyone can read active branches (public)" ON "public"."branches" FOR SELECT USING (("status" <> 'suspended'::"public"."branch_status"));



CREATE POLICY "Anyone can read branch_market_config (public)" ON "public"."branch_market_config" FOR SELECT USING (true);



CREATE POLICY "Anyone can read fee config" ON "public"."fee_config" FOR SELECT USING (true);



CREATE POLICY "Anyone can read leader stats" ON "public"."leader_stats" FOR SELECT USING (true);



CREATE POLICY "Anyone can read markets" ON "public"."markets" FOR SELECT USING (true);



CREATE POLICY "Anyone can read trades" ON "public"."trades" FOR SELECT USING (true);



CREATE POLICY "Branch manager read own" ON "public"."speed_branches" FOR SELECT USING ("public"."is_branch_manager_of"("branch_id"));



CREATE POLICY "Branch manager read own" ON "public"."speed_exposure_live" FOR SELECT USING ("public"."is_branch_manager_of"("branch_id"));



CREATE POLICY "Branch manager read own" ON "public"."speed_pool_ledger" FOR SELECT USING ((("branch_id" IS NOT NULL) AND "public"."is_branch_manager_of"("branch_id")));



CREATE POLICY "Branch manager read own" ON "public"."speed_positions" FOR SELECT USING ((("branch_id" IS NOT NULL) AND "public"."is_branch_manager_of"("branch_id")));



CREATE POLICY "Branch manager read own" ON "public"."speed_settlements" FOR SELECT USING ((("branch_id" IS NOT NULL) AND "public"."is_branch_manager_of"("branch_id")));



CREATE POLICY "Branch manager read own" ON "public"."speed_trades" FOR SELECT USING ((("branch_id" IS NOT NULL) AND "public"."is_branch_manager_of"("branch_id")));



CREATE POLICY "Branch managers can manage own config" ON "public"."branch_market_config" USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_market_config"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_market_config"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Branch managers can read own agents" ON "public"."branch_agents" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_agents"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Branch managers can read own assignments" ON "public"."branch_user_assignments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_user_assignments"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Branch managers can read own branch" ON "public"."branches" FOR SELECT USING (("auth"."uid"() = "manager_user_id"));



CREATE POLICY "Branch managers can read own branch trades" ON "public"."branch_trades" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_trades"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Branch managers can read own chain" ON "public"."credit_chain_ledger" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "credit_chain_ledger"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Branch managers can read own pool" ON "public"."branch_pools" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."branches"
  WHERE (("branches"."id" = "branch_pools"."branch_id") AND ("branches"."manager_user_id" = "auth"."uid"())))));



CREATE POLICY "Leaders can see who copies them" ON "public"."copy_settings" FOR SELECT USING (("auth"."uid"() = "leader_id"));



CREATE POLICY "No direct transaction inserts" ON "public"."transactions" FOR INSERT WITH CHECK (false);



CREATE POLICY "Public read" ON "public"."speed_markets" FOR SELECT USING (true);



CREATE POLICY "Public read" ON "public"."speed_oracle_latest" FOR SELECT USING (true);



CREATE POLICY "Referrers can read own commissions" ON "public"."referral_commissions" FOR SELECT USING (("auth"."uid"() = "referrer_id"));



CREATE POLICY "Service role all" ON "public"."speed_branches" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_exposure_live" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_external_book_snapshots" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_market_exposure_live" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_markets" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_oracle_latest" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_oracle_ticks" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_pool_ledger" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_positions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_settlements" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role all" ON "public"."speed_trades" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can insert system_logs" ON "public"."system_logs" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage AMM state" ON "public"."amm_state" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage copy settings" ON "public"."copy_settings" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage leader stats" ON "public"."leader_stats" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage positions" ON "public"."positions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage price alerts" ON "public"."price_alerts" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role can manage trades" ON "public"."trades" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_admin_overrides" ON "public"."branch_admin_overrides" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_agents" ON "public"."branch_agents" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_market_config" ON "public"."branch_market_config" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_pools" ON "public"."branch_pools" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_trades" ON "public"."branch_trades" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branch_user_assignments" ON "public"."branch_user_assignments" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on branches" ON "public"."branches" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on credit_chain_ledger" ON "public"."credit_chain_ledger" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "Service role full access on user_wallets" ON "public"."user_wallets" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "User read own" ON "public"."speed_positions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User read own" ON "public"."speed_settlements" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "User read own" ON "public"."speed_trades" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create own copy settings" ON "public"."copy_settings" FOR INSERT WITH CHECK (("auth"."uid"() = "copier_id"));



CREATE POLICY "Users can create own price alerts" ON "public"."price_alerts" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can create own profile" ON "public"."users" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can delete own copy settings" ON "public"."copy_settings" FOR DELETE USING (("auth"."uid"() = "copier_id"));



CREATE POLICY "Users can delete own price alerts" ON "public"."price_alerts" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own assignment" ON "public"."branch_user_assignments" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own branch trades" ON "public"."branch_trades" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own copy settings" ON "public"."copy_settings" FOR SELECT USING (("auth"."uid"() = "copier_id"));



CREATE POLICY "Users can read own credit entries" ON "public"."credit_chain_ledger" FOR SELECT USING ((("auth"."uid"() = "issuer_id") OR ("auth"."uid"() = "recipient_id")));



CREATE POLICY "Users can read own deposits" ON "public"."deposits" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own positions" ON "public"."positions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own price alerts" ON "public"."price_alerts" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own profile" ON "public"."users" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "Users can read own transactions" ON "public"."transactions" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read own withdrawals" ON "public"."withdrawals" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read public profiles" ON "public"."users" FOR SELECT USING (true);



CREATE POLICY "Users can update own copy settings" ON "public"."copy_settings" FOR UPDATE USING (("auth"."uid"() = "copier_id")) WITH CHECK (("auth"."uid"() = "copier_id"));



CREATE POLICY "Users can update own notifications" ON "public"."notifications" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own price alerts" ON "public"."price_alerts" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update own profile" ON "public"."users" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



CREATE POLICY "Users can view own wallet" ON "public"."user_wallets" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."admin_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "admin_config_self" ON "public"."admin_config" USING (("auth"."uid"() = "admin_user_id"));



ALTER TABLE "public"."agent_pending_microcredits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."amm_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_admin_overrides" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_agents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_market_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_pools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_revenue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_trades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branch_user_assignments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."comment_likes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "comments_delete" ON "public"."market_comments" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "comments_insert" ON "public"."market_comments" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "comments_select" ON "public"."market_comments" FOR SELECT USING (true);



ALTER TABLE "public"."commission_clawback_deficit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."copy_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."credit_chain_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."demo_amm_state" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "demo_amm_state admin all" ON "public"."demo_amm_state" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "demo_amm_state select authenticated" ON "public"."demo_amm_state" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."demo_market_scheduled_outcomes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."demo_markets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "demo_markets admin write" ON "public"."demo_markets" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "demo_markets select authenticated" ON "public"."demo_markets" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



ALTER TABLE "public"."demo_positions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "demo_positions admin all" ON "public"."demo_positions" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "demo_positions select own or admin" ON "public"."demo_positions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))));



CREATE POLICY "demo_scheduled_outcomes admin only" ON "public"."demo_market_scheduled_outcomes" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



ALTER TABLE "public"."demo_trades" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "demo_trades admin all" ON "public"."demo_trades" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "demo_trades select own or admin" ON "public"."demo_trades" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))));



ALTER TABLE "public"."demo_transactions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "demo_transactions admin all" ON "public"."demo_transactions" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "demo_transactions select own or admin" ON "public"."demo_transactions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true))))));



ALTER TABLE "public"."deposits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fee_config" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."help_articles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "help_articles_admin_all" ON "public"."help_articles" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "help_articles_public_read" ON "public"."help_articles" FOR SELECT USING (("is_published" = true));



ALTER TABLE "public"."help_collections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "help_collections_admin_all" ON "public"."help_collections" USING ((EXISTS ( SELECT 1
   FROM "public"."users"
  WHERE (("users"."id" = "auth"."uid"()) AND ("users"."is_admin" = true)))));



CREATE POLICY "help_collections_public_read" ON "public"."help_collections" FOR SELECT USING (("is_published" = true));



ALTER TABLE "public"."leader_stats" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "likes_delete" ON "public"."comment_likes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "likes_insert" ON "public"."comment_likes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "likes_select" ON "public"."comment_likes" FOR SELECT USING (true);



ALTER TABLE "public"."market_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."markets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."otp_verifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."platform_revenue" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."positions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."prelaunch_questions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prelaunch_questions_public_read" ON "public"."prelaunch_questions" FOR SELECT USING (true);



ALTER TABLE "public"."prelaunch_votes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prelaunch_votes_public_insert" ON "public"."prelaunch_votes" FOR INSERT WITH CHECK (true);



CREATE POLICY "prelaunch_votes_public_read" ON "public"."prelaunch_votes" FOR SELECT USING (true);



ALTER TABLE "public"."prelaunch_waitlist" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "prelaunch_waitlist_public_insert" ON "public"."prelaunch_waitlist" FOR INSERT WITH CHECK (true);



CREATE POLICY "prelaunch_waitlist_public_read" ON "public"."prelaunch_waitlist" FOR SELECT USING (true);



ALTER TABLE "public"."price_alerts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."referral_commissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_branches" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_exposure_live" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_external_book_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_main_pool_state" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_market_exposure_live" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_markets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_oracle_klines" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speed_oracle_klines_admin_all" ON "public"."speed_oracle_klines" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "speed_oracle_klines_public_read" ON "public"."speed_oracle_klines" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."speed_oracle_latest" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_oracle_ticks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_pool_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_positions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_realized_vol_cache" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "speed_rv_cache_admin_all" ON "public"."speed_realized_vol_cache" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());



CREATE POLICY "speed_rv_cache_public_read" ON "public"."speed_realized_vol_cache" FOR SELECT TO "authenticated", "anon" USING (true);



ALTER TABLE "public"."speed_settlements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."speed_trades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."system_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trades" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."transactions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_wallets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."withdrawals" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_accrue_microcredit"("p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_branch_id" "uuid", "p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."_branch_worst_case_market"("p_branch_id" "uuid", "p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_branch_worst_case_market"("p_branch_id" "uuid", "p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_branch_worst_case_market"("p_branch_id" "uuid", "p_market_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_credit_branch_commission"("p_branch_id" "uuid", "p_agent_user_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_amount" numeric, "p_markup_amount" numeric, "p_agent_rate" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_credit_branch_pl"("p_branch_id" "uuid", "p_agent_id" "uuid", "p_agent_user_id" "uuid", "p_market_id" "uuid", "p_amount" numeric, "p_agent_rate" numeric, "p_pool_contribution" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."_credit_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric, "p_fee_type" "text", "p_revenue_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_credit_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric, "p_fee_type" "text", "p_revenue_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_credit_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric, "p_fee_type" "text", "p_revenue_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_credit_speed_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."_credit_speed_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_credit_speed_commission"("p_ancestor_id" "uuid", "p_trader_id" "uuid", "p_market_id" "uuid", "p_trade_id" "uuid", "p_layer" integer, "p_agent_level" integer, "p_platform_revenue" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."_demo_assert_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."_demo_assert_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_demo_assert_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_enforce_commission_branch_agent_rules"() TO "anon";
GRANT ALL ON FUNCTION "public"."_enforce_commission_branch_agent_rules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_enforce_commission_branch_agent_rules"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap"() TO "anon";
GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap_insert"() TO "anon";
GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap_insert"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_enforce_pl_rate_cap_insert"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_is_agent_activated"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_is_agent_activated"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_is_agent_activated"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_next_clean_boundary"("p_duration" "public"."speed_duration", "p_now" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."_on_market_status_change_release_commissions"() TO "anon";
GRANT ALL ON FUNCTION "public"."_on_market_status_change_release_commissions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_on_market_status_change_release_commissions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_protect_branch_book_type"() TO "anon";
GRANT ALL ON FUNCTION "public"."_protect_branch_book_type"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_protect_branch_book_type"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_recompute_branch_worst_case"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_recompute_branch_worst_case"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_recompute_branch_worst_case"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_reject_reserved_branch_slug"() TO "anon";
GRANT ALL ON FUNCTION "public"."_reject_reserved_branch_slug"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_reject_reserved_branch_slug"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_release_escrowed_commissions"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_release_escrowed_commissions"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_release_escrowed_commissions"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_release_pending_commissions_for_market"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_release_pending_commissions_for_market"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_release_pending_commissions_for_market"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_reserved_slugs"() TO "anon";
GRANT ALL ON FUNCTION "public"."_reserved_slugs"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_reserved_slugs"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_set_trigger_bypass_wrapper"() TO "anon";
GRANT ALL ON FUNCTION "public"."_set_trigger_bypass_wrapper"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_set_trigger_bypass_wrapper"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_speed_create_pool_partitions"("p_target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_speed_create_trade_partitions"("p_target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") TO "anon";
GRANT ALL ON FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_speed_get_iv"("p_asset" "public"."speed_asset") TO "service_role";



GRANT ALL ON FUNCTION "public"."_speed_position_exposure_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."_speed_position_exposure_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_speed_position_exposure_trigger"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_track_pool_underflow"() TO "anon";
GRANT ALL ON FUNCTION "public"."_track_pool_underflow"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_track_pool_underflow"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_try_clear_payback"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_try_clear_payback"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_try_clear_payback"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_verify_admin_pin"("p_admin_id" "uuid", "p_pin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_verify_admin_token"("p_admin_id" "uuid", "p_token" "text", "p_expected_operation" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."_void_market_internal"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."_void_market_internal"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_void_market_internal"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."acknowledge_system_log"("p_log_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."acknowledge_system_log"("p_log_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."acknowledge_system_log"("p_log_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."activate_payback_mode"("p_branch_id" "uuid", "p_reason" "text", "p_shortfall" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."activate_payback_mode"("p_branch_id" "uuid", "p_reason" "text", "p_shortfall" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."activate_payback_mode"("p_branch_id" "uuid", "p_reason" "text", "p_shortfall" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_agent_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_agent_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_agent_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_balance"("p_user_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_adjust_branch_pool"("p_branch_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_adjust_branch_pool"("p_branch_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_adjust_branch_pool"("p_branch_id" "uuid", "p_amount" numeric, "p_description" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_branch"("p_name" "text", "p_code" "text", "p_manager_user_id" "uuid", "p_config" "jsonb", "p_pin" "text", "p_book_type" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_branch"("p_name" "text", "p_code" "text", "p_manager_user_id" "uuid", "p_config" "jsonb", "p_pin" "text", "p_book_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_branch"("p_name" "text", "p_code" "text", "p_manager_user_id" "uuid", "p_config" "jsonb", "p_pin" "text", "p_book_type" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_demo_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_scheduled_outcome" "text", "p_resolves_at" timestamp with time zone, "p_image_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_demo_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_scheduled_outcome" "text", "p_resolves_at" timestamp with time zone, "p_image_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_demo_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_scheduled_outcome" "text", "p_resolves_at" timestamp with time zone, "p_image_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_image_url" "text", "p_opening_price" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_image_url" "text", "p_opening_price" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_create_market"("p_question_en" "text", "p_question_ar" "text", "p_description_en" "text", "p_description_ar" "text", "p_category" "text", "p_keywords" "text"[], "p_liquidity_param" numeric, "p_opens_at" timestamp with time zone, "p_closes_at" timestamp with time zone, "p_image_url" "text", "p_opening_price" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_has_pin"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_has_pin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_has_pin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_branches"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_branches"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_branches"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_list_demo_markets_with_outcomes"() TO "anon";
GRANT ALL ON FUNCTION "public"."admin_list_demo_markets_with_outcomes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_list_demo_markets_with_outcomes"() TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_mark_withdrawal_sent"("p_withdrawal_id" "uuid", "p_external_reference_id" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_mark_withdrawal_sent"("p_withdrawal_id" "uuid", "p_external_reference_id" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_mark_withdrawal_sent"("p_withdrawal_id" "uuid", "p_external_reference_id" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_override_solvency"("p_branch_id" "uuid", "p_new_pct" numeric, "p_duration_hours" integer, "p_note" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_override_solvency"("p_branch_id" "uuid", "p_new_pct" numeric, "p_duration_hours" integer, "p_note" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_override_solvency"("p_branch_id" "uuid", "p_new_pct" numeric, "p_duration_hours" integer, "p_note" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_override_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_override_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_override_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_resolve_demo_market"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_resolve_demo_market"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_resolve_demo_market"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric, "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric, "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_deposit"("p_deposit_id" "uuid", "p_action" "text", "p_amount" numeric, "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_review_withdrawal"("p_withdrawal_id" "uuid", "p_action" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_review_withdrawal"("p_withdrawal_id" "uuid", "p_action" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_review_withdrawal"("p_withdrawal_id" "uuid", "p_action" "text", "p_pin" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_rotate_hmac_secret"("p_admin_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_rotate_hmac_secret"("p_admin_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_set_admin_role"("p_user_id" "uuid", "p_is_admin" boolean, "p_allowed_views" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_admin_role"("p_user_id" "uuid", "p_is_admin" boolean, "p_allowed_views" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_admin_role"("p_user_id" "uuid", "p_is_admin" boolean, "p_allowed_views" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_set_pin"("p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_set_pin"("p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_set_pin"("p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_branch_status"("p_branch_id" "uuid", "p_new_status" "text", "p_reason" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_branch_status"("p_branch_id" "uuid", "p_new_status" "text", "p_reason" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_branch_status"("p_branch_id" "uuid", "p_new_status" "text", "p_reason" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_fee"("p_fee_id" "uuid", "p_new_rate" numeric, "p_pin" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_fee"("p_fee_id" "uuid", "p_new_rate" numeric, "p_pin" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_fee"("p_fee_id" "uuid", "p_new_rate" numeric, "p_pin" "text", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[], "p_image_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[], "p_image_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."admin_update_market"("p_market_id" "uuid", "p_description_en" "text", "p_description_ar" "text", "p_closes_at" timestamp with time zone, "p_keywords" "text"[], "p_image_url" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_branch_agent"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_branch_agent"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_branch_agent"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."approve_branch_agent"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."approve_branch_agent"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."approve_branch_agent"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."branch_credit_transfer"("p_branch_id" "uuid", "p_recipient_id" "uuid", "p_amount" numeric, "p_description" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."branch_credit_transfer"("p_branch_id" "uuid", "p_recipient_id" "uuid", "p_amount" numeric, "p_description" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."branch_credit_transfer"("p_branch_id" "uuid", "p_recipient_id" "uuid", "p_amount" numeric, "p_description" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."branch_dashboard_stats"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."branch_dashboard_stats"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."branch_dashboard_stats"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."branch_settle_resolution"("p_market_id" "uuid", "p_outcome" "public"."bet_side") TO "anon";
GRANT ALL ON FUNCTION "public"."branch_settle_resolution"("p_market_id" "uuid", "p_outcome" "public"."bet_side") TO "authenticated";
GRANT ALL ON FUNCTION "public"."branch_settle_resolution"("p_market_id" "uuid", "p_outcome" "public"."bet_side") TO "service_role";



GRANT ALL ON FUNCTION "public"."branch_solvency_check"("p_branch_id" "uuid", "p_additional_pool_inflow" numeric, "p_additional_worst_case_delta" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."branch_solvency_check"("p_branch_id" "uuid", "p_additional_pool_inflow" numeric, "p_additional_worst_case_delta" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."branch_solvency_check"("p_branch_id" "uuid", "p_additional_pool_inflow" numeric, "p_additional_worst_case_delta" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."branch_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."branch_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."branch_withdrawal"("p_branch_id" "uuid", "p_amount" numeric, "p_destination" "text", "p_note" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_withdrawal"("p_withdrawal_id" "uuid", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_withdrawal"("p_withdrawal_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_branch_velocity"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_branch_velocity"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_branch_velocity"() TO "service_role";



GRANT ALL ON FUNCTION "public"."check_payback_escalation"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_payback_escalation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_payback_escalation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_deposit_bonus"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_deposit_bonus"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_deposit_bonus"() TO "service_role";



GRANT ALL ON FUNCTION "public"."cleanup_test_data"() TO "anon";
GRANT ALL ON FUNCTION "public"."cleanup_test_data"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."cleanup_test_data"() TO "service_role";



GRANT ALL ON FUNCTION "public"."clear_payback_mode"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."clear_payback_mode"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."clear_payback_mode"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."dead_market_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."dead_market_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."dead_market_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."demo_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."demo_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."demo_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."demo_get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."demo_get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."demo_get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."demo_reset_balance"() TO "anon";
GRANT ALL ON FUNCTION "public"."demo_reset_balance"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."demo_reset_balance"() TO "service_role";



GRANT ALL ON FUNCTION "public"."demo_seed_initial_price"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."demo_seed_initial_price"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."demo_seed_initial_price"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."execute_branch_trade"("p_market_id" "uuid", "p_branch_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric, "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."execute_branch_trade"("p_market_id" "uuid", "p_branch_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_branch_trade"("p_market_id" "uuid", "p_branch_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric, "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_trade"("p_market_id" "uuid", "p_side" "text", "p_amount" numeric, "p_shares_to_sell" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_accounting_amm"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_accounting_amm"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_accounting_amm"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_accounting_branches"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_accounting_branches"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_accounting_branches"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_accounting_commissions"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_accounting_commissions"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_accounting_commissions"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_accounting_pnl"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_accounting_pnl"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_accounting_pnl"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_admin_sidebar_counts"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_admin_sidebar_counts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_sidebar_counts"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agent_commission_feed"("p_limit" integer, "p_offset" integer, "p_layer_filter" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_agent_commission_feed"("p_limit" integer, "p_offset" integer, "p_layer_filter" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agent_commission_feed"("p_limit" integer, "p_offset" integer, "p_layer_filter" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agent_network_flat"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_agent_network_flat"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agent_network_flat"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agent_network_tree"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_agent_network_tree"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agent_network_tree"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agent_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_agent_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agent_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_agent_wallet_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_agent_wallet_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_agent_wallet_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_amm_price"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_amm_price"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_amm_price"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_amm_risk_snapshot"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_amm_risk_snapshot"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_amm_risk_snapshot"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_branch_owner_summary"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_branch_owner_summary"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_branch_owner_summary"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_cash_out_value"("p_market_id" "uuid", "p_side" "text", "p_shares" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."get_cash_out_value"("p_market_id" "uuid", "p_side" "text", "p_shares" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cash_out_value"("p_market_id" "uuid", "p_side" "text", "p_shares" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_demo_conversion_stats"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_demo_conversion_stats"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_demo_conversion_stats"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_platform_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_platform_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_platform_stats"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_price_history"("p_market_id" "uuid", "p_period" "text", "p_created_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_accounting_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_klines"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_price_history"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_points" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_price_history_ohlc"("p_asset" "public"."speed_asset", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_max_buckets" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_stats_summary"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") TO "anon";
GRANT ALL ON FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_speed_volatility"("p_asset" "public"."speed_asset") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_finance"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_finance"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_finance"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_health"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_health"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_health"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_markets"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_markets"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_markets"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_revenue"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_revenue"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_revenue"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_trading"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_trading"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_trading"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_stats_users"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."get_stats_users"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_stats_users"("p_start_date" timestamp with time zone, "p_end_date" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_referral_signup"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_referral_signup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_referral_signup"() TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_referral_count"("p_referral_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."increment_referral_count"("p_referral_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_referral_count"("p_referral_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."initialize_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."initialize_demo_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."initialize_demo_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."initialize_demo_amm"("p_market_id" "uuid", "p_liquidity_param" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."is_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_branch_manager_of"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."lmsr_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."lmsr_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lmsr_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."lmsr_price"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lmsr_price"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lmsr_price"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."lmsr_shares_for_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text", "p_cost" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."lmsr_shares_for_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text", "p_cost" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lmsr_shares_for_cost"("p_b" numeric, "p_q_yes" numeric, "p_q_no" numeric, "p_side" "text", "p_cost" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lock_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."log_system_event"("p_severity" "public"."log_severity", "p_source" "text", "p_message" "text", "p_context" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_system_event"("p_severity" "public"."log_severity", "p_source" "text", "p_message" "text", "p_context" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_system_event"("p_severity" "public"."log_severity", "p_source" "text", "p_message" "text", "p_context" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."normal_cdf"("x" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."normal_cdf"("x" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."normal_cdf"("x" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."pay_speed_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_stake" numeric, "p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."pay_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_trade_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."pay_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_trade_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."pay_trade_commissions"("p_trade_id" "uuid", "p_user_id" "uuid", "p_trade_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_audit_table_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_audit_table_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_audit_table_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_branch_pools_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_branch_pools_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_branch_pools_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_sensitive_branch_updates"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_sensitive_branch_updates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_sensitive_branch_updates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_sensitive_user_updates"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_sensitive_user_updates"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_sensitive_user_updates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_speed_pool_ledger_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_speed_pool_ledger_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_speed_pool_ledger_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_transactions_mutation"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_transactions_mutation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_transactions_mutation"() TO "service_role";



GRANT ALL ON FUNCTION "public"."preview_branch_agent_pl"("p_branch_id" "uuid", "p_rate" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."preview_branch_agent_pl"("p_branch_id" "uuid", "p_rate" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."preview_branch_agent_pl"("p_branch_id" "uuid", "p_rate" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."process_deposit"("p_user_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_provider_ref" "text", "p_provider" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_deposit"("p_user_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_provider_ref" "text", "p_provider" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_deposit"("p_user_id" "uuid", "p_amount" numeric, "p_currency" "text", "p_provider_ref" "text", "p_provider" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."process_withdrawal"("p_amount" numeric, "p_destination" "text", "p_currency" "text", "p_destination_type" "text", "p_network" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."process_withdrawal"("p_amount" numeric, "p_destination" "text", "p_currency" "text", "p_destination_type" "text", "p_network" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."process_withdrawal"("p_amount" numeric, "p_destination" "text", "p_currency" "text", "p_destination_type" "text", "p_network" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."reconcile_agent_balances"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_agent_balances"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_agent_balances"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reconcile_balances"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_balances"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_balances"() TO "service_role";



GRANT ALL ON FUNCTION "public"."reconcile_branch_solvency"() TO "anon";
GRANT ALL ON FUNCTION "public"."reconcile_branch_solvency"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_branch_solvency"() TO "service_role";



GRANT ALL ON FUNCTION "public"."record_branch_revenue"("p_market_id" "uuid", "p_branch_id" "uuid", "p_outcome" "public"."bet_side", "p_resolution_fee_collected" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."record_branch_revenue"("p_market_id" "uuid", "p_branch_id" "uuid", "p_outcome" "public"."bet_side", "p_resolution_fee_collected" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_branch_revenue"("p_market_id" "uuid", "p_branch_id" "uuid", "p_outcome" "public"."bet_side", "p_resolution_fee_collected" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."record_prelaunch_vote"("p_question_id" "uuid", "p_vote" "text", "p_visitor_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."record_prelaunch_vote"("p_question_id" "uuid", "p_vote" "text", "p_visitor_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_prelaunch_vote"("p_question_id" "uuid", "p_vote" "text", "p_visitor_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."record_revenue"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."record_revenue"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."record_revenue"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_branch_agent"("p_agent_id" "uuid", "p_reason" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."reject_branch_agent"("p_agent_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_branch_agent"("p_agent_id" "uuid", "p_reason" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."resolve_market"("p_market_id" "uuid", "p_outcome" "public"."bet_side", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_market"("p_market_id" "uuid", "p_outcome" "public"."bet_side", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_market"("p_market_id" "uuid", "p_outcome" "public"."bet_side", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."settle_resolution_commissions"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."settle_resolution_commissions"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."settle_resolution_commissions"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_collateral_credit"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_collateral_withdraw"("p_branch_id" "uuid", "p_amount" numeric, "p_notes" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_enable_branch"("p_branch_id" "uuid", "p_collateral" numeric, "p_fee_share_pct" numeric, "p_freeze_warn_pct" numeric, "p_freeze_hard_pct" numeric, "p_unfreeze_pct" numeric, "p_stake_min" numeric, "p_stake_max" numeric, "p_stake_caps_per_side" "jsonb", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_freeze_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_freeze_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_freeze_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_hard"("p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_hard"("p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_hard"("p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_soft"("p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_soft"("p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_master_kill_soft"("p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_master_revive"("p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_master_revive"("p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_master_revive"("p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_overview"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_overview"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_overview"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_record_book_snapshot"("p_asset" "public"."speed_asset", "p_snapshot_at" timestamp with time zone, "p_net_position_qty" numeric, "p_avg_entry_price" numeric, "p_mark_price" numeric, "p_unrealized_pnl_usd" numeric, "p_realized_pnl_since_last" numeric, "p_funding_paid_since_last" numeric, "p_margin_balance_usd" numeric, "p_notes" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_suspend_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_suspend_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_suspend_branch"("p_branch_id" "uuid", "p_reason" "text", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_admin_unfreeze_branch"("p_branch_id" "uuid", "p_pin" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_admin_unfreeze_branch"("p_branch_id" "uuid", "p_pin" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_admin_unfreeze_branch"("p_branch_id" "uuid", "p_pin" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_apply_late_window_surcharge"("p_seconds_left" double precision, "p_base_spread" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_branch_summary"("p_branch_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_cashout_multiplier"("p_duration" "public"."speed_duration", "p_role" "text", "p_pct" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_execute_cashout"("p_position_id" "uuid", "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_execute_trade"("p_market_id" "uuid", "p_side" "text", "p_stake" numeric, "p_idempotency_key" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_extend_partitions"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_extend_partitions"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_extend_partitions"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_fair_prob_over"("p_spot" numeric, "p_strike" numeric, "p_seconds_left" double precision, "p_iv" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_finalize_pending_markets"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_finalize_pending_markets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_finalize_pending_markets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_market_exposure"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_realized_vol"("p_asset" "public"."speed_asset", "p_window_seconds" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_resolve_expired_markets"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_resolve_expired_markets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_resolve_expired_markets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_resolve_market"("p_market_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_roll_markets"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_roll_markets"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_roll_markets"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_rv_refresh"() TO "anon";
GRANT ALL ON FUNCTION "public"."speed_rv_refresh"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_rv_refresh"() TO "service_role";



GRANT ALL ON FUNCTION "public"."speed_time_bucket"("p_seconds_total" double precision, "p_seconds_left" double precision) TO "anon";
GRANT ALL ON FUNCTION "public"."speed_time_bucket"("p_seconds_total" double precision, "p_seconds_left" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."speed_time_bucket"("p_seconds_total" double precision, "p_seconds_left" double precision) TO "service_role";



GRANT ALL ON FUNCTION "public"."staging_full_reset"() TO "anon";
GRANT ALL ON FUNCTION "public"."staging_full_reset"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."staging_full_reset"() TO "service_role";



GRANT ALL ON FUNCTION "public"."submit_manual_deposit"("p_amount" numeric, "p_whish_number" "text", "p_proof_image_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."submit_manual_deposit"("p_amount" numeric, "p_whish_number" "text", "p_proof_image_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."submit_manual_deposit"("p_amount" numeric, "p_whish_number" "text", "p_proof_image_url" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sweep_agent_microcredits"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sweep_agent_microcredits"() TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_agent_activation_override"("p_user_id" "uuid", "p_override" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_agent_activation_override"("p_user_id" "uuid", "p_override" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_agent_activation_override"("p_user_id" "uuid", "p_override" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_demo_mode"("p_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_demo_mode"("p_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_demo_mode"("p_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."toggle_user_freeze"("p_user_id" "uuid", "p_frozen" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."toggle_user_freeze"("p_user_id" "uuid", "p_frozen" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."toggle_user_freeze"("p_user_id" "uuid", "p_frozen" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."transfer_agent_to_portfolio"("p_amount" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."transfer_agent_to_portfolio"("p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."transfer_agent_to_portfolio"("p_amount" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_speed_finalize_on_oracle"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_speed_finalize_on_oracle"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_speed_finalize_on_oracle"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_agent_level"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."update_agent_level"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_agent_level"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."update_branch_agent_deal"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "anon";
GRANT ALL ON FUNCTION "public"."update_branch_agent_deal"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_branch_agent_deal"("p_agent_id" "uuid", "p_agent_type" "text", "p_rate" numeric, "p_deposit_required" numeric) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_branch_config"("p_branch_id" "uuid", "p_yes_markup" numeric, "p_no_markup" numeric, "p_exit_fee" numeric, "p_display_mode" "text", "p_cash_out_enabled" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."update_branch_config"("p_branch_id" "uuid", "p_yes_markup" numeric, "p_no_markup" numeric, "p_exit_fee" numeric, "p_display_mode" "text", "p_cash_out_enabled" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_branch_config"("p_branch_id" "uuid", "p_yes_markup" numeric, "p_no_markup" numeric, "p_exit_fee" numeric, "p_display_mode" "text", "p_cash_out_enabled" boolean) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_homepage_ranks"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_homepage_ranks"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_homepage_ranks"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."void_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."void_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."void_market"("p_market_id" "uuid", "p_pin" "text", "p_token" "text") TO "service_role";



GRANT ALL ON TABLE "public"."admin_config" TO "anon";
GRANT ALL ON TABLE "public"."admin_config" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_config" TO "service_role";



GRANT ALL ON TABLE "public"."agent_pending_microcredits" TO "anon";
GRANT ALL ON TABLE "public"."agent_pending_microcredits" TO "authenticated";
GRANT ALL ON TABLE "public"."agent_pending_microcredits" TO "service_role";



GRANT ALL ON TABLE "public"."amm_state" TO "anon";
GRANT ALL ON TABLE "public"."amm_state" TO "authenticated";
GRANT ALL ON TABLE "public"."amm_state" TO "service_role";



GRANT ALL ON TABLE "public"."branch_admin_overrides" TO "anon";
GRANT ALL ON TABLE "public"."branch_admin_overrides" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_admin_overrides" TO "service_role";



GRANT ALL ON TABLE "public"."branch_agents" TO "anon";
GRANT ALL ON TABLE "public"."branch_agents" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_agents" TO "service_role";



GRANT ALL ON TABLE "public"."branch_market_config" TO "anon";
GRANT ALL ON TABLE "public"."branch_market_config" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_market_config" TO "service_role";



GRANT ALL ON TABLE "public"."referral_commissions" TO "anon";
GRANT ALL ON TABLE "public"."referral_commissions" TO "authenticated";
GRANT ALL ON TABLE "public"."referral_commissions" TO "service_role";



GRANT ALL ON TABLE "public"."branch_pending_liabilities" TO "anon";
GRANT ALL ON TABLE "public"."branch_pending_liabilities" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_pending_liabilities" TO "service_role";



GRANT ALL ON TABLE "public"."branch_pools" TO "anon";
GRANT ALL ON TABLE "public"."branch_pools" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_pools" TO "service_role";



GRANT ALL ON TABLE "public"."branch_revenue" TO "anon";
GRANT ALL ON TABLE "public"."branch_revenue" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_revenue" TO "service_role";



GRANT ALL ON TABLE "public"."branch_trades" TO "anon";
GRANT ALL ON TABLE "public"."branch_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_trades" TO "service_role";



GRANT ALL ON TABLE "public"."branch_user_assignments" TO "anon";
GRANT ALL ON TABLE "public"."branch_user_assignments" TO "authenticated";
GRANT ALL ON TABLE "public"."branch_user_assignments" TO "service_role";



GRANT ALL ON TABLE "public"."branches" TO "anon";
GRANT ALL ON TABLE "public"."branches" TO "authenticated";
GRANT ALL ON TABLE "public"."branches" TO "service_role";



GRANT ALL ON TABLE "public"."comment_likes" TO "anon";
GRANT ALL ON TABLE "public"."comment_likes" TO "authenticated";
GRANT ALL ON TABLE "public"."comment_likes" TO "service_role";



GRANT ALL ON TABLE "public"."commission_clawback_deficit" TO "anon";
GRANT ALL ON TABLE "public"."commission_clawback_deficit" TO "authenticated";
GRANT ALL ON TABLE "public"."commission_clawback_deficit" TO "service_role";



GRANT ALL ON TABLE "public"."copy_settings" TO "anon";
GRANT ALL ON TABLE "public"."copy_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."copy_settings" TO "service_role";



GRANT ALL ON TABLE "public"."credit_chain_ledger" TO "anon";
GRANT ALL ON TABLE "public"."credit_chain_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."credit_chain_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."demo_amm_state" TO "anon";
GRANT ALL ON TABLE "public"."demo_amm_state" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_amm_state" TO "service_role";



GRANT ALL ON TABLE "public"."demo_market_scheduled_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."demo_market_scheduled_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_market_scheduled_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."demo_markets" TO "anon";
GRANT ALL ON TABLE "public"."demo_markets" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_markets" TO "service_role";



GRANT ALL ON TABLE "public"."demo_positions" TO "anon";
GRANT ALL ON TABLE "public"."demo_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_positions" TO "service_role";



GRANT ALL ON TABLE "public"."demo_trades" TO "anon";
GRANT ALL ON TABLE "public"."demo_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_trades" TO "service_role";



GRANT ALL ON TABLE "public"."demo_transactions" TO "anon";
GRANT ALL ON TABLE "public"."demo_transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."demo_transactions" TO "service_role";



GRANT ALL ON TABLE "public"."deposits" TO "anon";
GRANT ALL ON TABLE "public"."deposits" TO "authenticated";
GRANT ALL ON TABLE "public"."deposits" TO "service_role";



GRANT ALL ON TABLE "public"."fee_config" TO "anon";
GRANT ALL ON TABLE "public"."fee_config" TO "authenticated";
GRANT ALL ON TABLE "public"."fee_config" TO "service_role";



GRANT ALL ON TABLE "public"."help_articles" TO "anon";
GRANT ALL ON TABLE "public"."help_articles" TO "authenticated";
GRANT ALL ON TABLE "public"."help_articles" TO "service_role";



GRANT ALL ON TABLE "public"."help_collections" TO "anon";
GRANT ALL ON TABLE "public"."help_collections" TO "authenticated";
GRANT ALL ON TABLE "public"."help_collections" TO "service_role";



GRANT ALL ON TABLE "public"."leader_stats" TO "anon";
GRANT ALL ON TABLE "public"."leader_stats" TO "authenticated";
GRANT ALL ON TABLE "public"."leader_stats" TO "service_role";



GRANT ALL ON TABLE "public"."market_comments" TO "anon";
GRANT ALL ON TABLE "public"."market_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."market_comments" TO "service_role";



GRANT ALL ON TABLE "public"."markets" TO "anon";
GRANT ALL ON TABLE "public"."markets" TO "authenticated";
GRANT ALL ON TABLE "public"."markets" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."otp_verifications" TO "anon";
GRANT ALL ON TABLE "public"."otp_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."otp_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."platform_revenue" TO "anon";
GRANT ALL ON TABLE "public"."platform_revenue" TO "authenticated";
GRANT ALL ON TABLE "public"."platform_revenue" TO "service_role";



GRANT ALL ON TABLE "public"."positions" TO "anon";
GRANT ALL ON TABLE "public"."positions" TO "authenticated";
GRANT ALL ON TABLE "public"."positions" TO "service_role";



GRANT ALL ON TABLE "public"."prelaunch_questions" TO "anon";
GRANT ALL ON TABLE "public"."prelaunch_questions" TO "authenticated";
GRANT ALL ON TABLE "public"."prelaunch_questions" TO "service_role";



GRANT ALL ON TABLE "public"."prelaunch_votes" TO "anon";
GRANT ALL ON TABLE "public"."prelaunch_votes" TO "authenticated";
GRANT ALL ON TABLE "public"."prelaunch_votes" TO "service_role";



GRANT ALL ON TABLE "public"."prelaunch_waitlist" TO "anon";
GRANT ALL ON TABLE "public"."prelaunch_waitlist" TO "authenticated";
GRANT ALL ON TABLE "public"."prelaunch_waitlist" TO "service_role";



GRANT ALL ON SEQUENCE "public"."prelaunch_waitlist_position_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."prelaunch_waitlist_position_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."prelaunch_waitlist_position_seq" TO "service_role";



GRANT ALL ON TABLE "public"."price_alerts" TO "anon";
GRANT ALL ON TABLE "public"."price_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."price_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."retail_positions" TO "anon";
GRANT ALL ON TABLE "public"."retail_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."retail_positions" TO "service_role";



GRANT ALL ON TABLE "public"."trades" TO "anon";
GRANT ALL ON TABLE "public"."trades" TO "authenticated";
GRANT ALL ON TABLE "public"."trades" TO "service_role";



GRANT ALL ON TABLE "public"."retail_trades" TO "anon";
GRANT ALL ON TABLE "public"."retail_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."retail_trades" TO "service_role";



GRANT ALL ON TABLE "public"."speed_branches" TO "anon";
GRANT ALL ON TABLE "public"."speed_branches" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_branches" TO "service_role";



GRANT ALL ON TABLE "public"."speed_exposure_live" TO "anon";
GRANT ALL ON TABLE "public"."speed_exposure_live" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_exposure_live" TO "service_role";



GRANT ALL ON TABLE "public"."speed_external_book_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."speed_external_book_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_external_book_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."speed_main_pool_state" TO "anon";
GRANT ALL ON TABLE "public"."speed_main_pool_state" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_main_pool_state" TO "service_role";



GRANT ALL ON TABLE "public"."speed_market_exposure_live" TO "anon";
GRANT ALL ON TABLE "public"."speed_market_exposure_live" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_market_exposure_live" TO "service_role";



GRANT ALL ON TABLE "public"."speed_markets" TO "anon";
GRANT ALL ON TABLE "public"."speed_markets" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_markets" TO "service_role";



GRANT ALL ON TABLE "public"."speed_oracle_klines" TO "anon";
GRANT ALL ON TABLE "public"."speed_oracle_klines" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_oracle_klines" TO "service_role";



GRANT ALL ON TABLE "public"."speed_oracle_latest" TO "anon";
GRANT ALL ON TABLE "public"."speed_oracle_latest" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_oracle_latest" TO "service_role";



GRANT ALL ON TABLE "public"."speed_oracle_ticks" TO "anon";
GRANT ALL ON TABLE "public"."speed_oracle_ticks" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_oracle_ticks" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260427" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260427" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260427" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260428" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260428" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260428" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260429" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260429" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260429" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260430" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260430" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260430" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260501" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260501" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260501" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260502" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260502" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260502" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260503" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260503" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260503" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260504" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260504" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260504" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260505" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260505" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260505" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260506" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260506" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260506" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260507" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260507" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260507" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260508" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260508" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260508" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260509" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260509" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260509" TO "service_role";



GRANT ALL ON TABLE "public"."speed_pool_ledger_20260510" TO "anon";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260510" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_pool_ledger_20260510" TO "service_role";



GRANT ALL ON TABLE "public"."speed_positions" TO "anon";
GRANT ALL ON TABLE "public"."speed_positions" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_positions" TO "service_role";



GRANT ALL ON TABLE "public"."speed_realized_vol_cache" TO "anon";
GRANT ALL ON TABLE "public"."speed_realized_vol_cache" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_realized_vol_cache" TO "service_role";



GRANT ALL ON TABLE "public"."speed_settlements" TO "anon";
GRANT ALL ON TABLE "public"."speed_settlements" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_settlements" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260427" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260427" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260427" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260428" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260428" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260428" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260429" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260429" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260429" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260430" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260430" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260430" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260501" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260501" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260501" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260502" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260502" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260502" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260503" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260503" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260503" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260504" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260504" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260504" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260505" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260505" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260505" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260506" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260506" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260506" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260507" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260507" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260507" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260508" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260508" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260508" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260509" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260509" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260509" TO "service_role";



GRANT ALL ON TABLE "public"."speed_trades_20260510" TO "anon";
GRANT ALL ON TABLE "public"."speed_trades_20260510" TO "authenticated";
GRANT ALL ON TABLE "public"."speed_trades_20260510" TO "service_role";



GRANT ALL ON TABLE "public"."system_logs" TO "anon";
GRANT ALL ON TABLE "public"."system_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."system_logs" TO "service_role";



GRANT ALL ON TABLE "public"."transactions" TO "anon";
GRANT ALL ON TABLE "public"."transactions" TO "authenticated";
GRANT ALL ON TABLE "public"."transactions" TO "service_role";



GRANT ALL ON TABLE "public"."user_wallets" TO "anon";
GRANT ALL ON TABLE "public"."user_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."user_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";



GRANT ALL ON TABLE "public"."withdrawals" TO "anon";
GRANT ALL ON TABLE "public"."withdrawals" TO "authenticated";
GRANT ALL ON TABLE "public"."withdrawals" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







A new version of Supabase CLI is available: v2.95.4 (currently installed v2.75.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli
