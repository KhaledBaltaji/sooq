-- 268_branch_agent_pl_cap_trigger.sql — BEFORE UPDATE trigger enforcing 80% cap
--
-- Eng review finding (action 12): approve_branch_agent (mig 252) enforces
-- the 80% combined P/L rate cap ONLY at approval time. A direct
--   UPDATE branch_agents SET rate = 0.50 WHERE id = X AND agent_type = 'pl'
-- bypasses the check — either via admin backend tools, migration quirks,
-- or future RPCs that forget to re-validate.
--
-- Fix: BEFORE UPDATE trigger that re-computes the combined P/L rate sum
-- (including the proposed NEW row) and rejects the UPDATE if > cap.
-- The approve_branch_agent path still does its own explicit check for
-- better error messages, but the trigger is the defense-in-depth.
--
-- Scope: only fires when (agent_type = 'pl' AND is_active) and rate or
-- is_active is changing. No-op updates (e.g., cumulative_pl recomputes,
-- status changes that don't touch the rate) don't pay the check.
--
-- Grandfathering: if existing agents on the branch already exceed the cap
-- (pre-migration state), the trigger DOES NOT force a rejection on
-- updates that DON'T make it worse. Only blocks updates that increase
-- the combined sum.

BEGIN;

CREATE OR REPLACE FUNCTION _enforce_pl_rate_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap DECIMAL;
  v_existing_sum DECIMAL;
  v_old_contribution DECIMAL;
  v_new_contribution DECIMAL;
  v_proposed_total DECIMAL;
BEGIN
  -- Only care about P/L agent rows that are / will be active.
  IF NEW.agent_type IS DISTINCT FROM 'pl' AND OLD.agent_type IS DISTINCT FROM 'pl' THEN
    RETURN NEW;
  END IF;

  -- Fast path: nothing about rate or active status changed. Skip.
  IF  NEW.rate = OLD.rate
      AND NEW.is_active = OLD.is_active
      AND NEW.agent_type = OLD.agent_type
      AND NEW.branch_id = OLD.branch_id THEN
    RETURN NEW;
  END IF;

  -- Read the cap (default 0.80 if flag missing, matches approve_branch_agent).
  SELECT rate INTO v_cap
    FROM fee_config
   WHERE fee_type = 'max_pl_agent_rate_sum'
   LIMIT 1;
  v_cap := COALESCE(v_cap, 0.80);

  -- Sum existing active P/L rates on the destination branch, EXCLUDING this row.
  SELECT COALESCE(SUM(rate), 0) INTO v_existing_sum
    FROM branch_agents
   WHERE branch_id = NEW.branch_id
     AND agent_type = 'pl'
     AND is_active
     AND id != NEW.id;

  -- What this row contributes NOW vs BEFORE.
  v_new_contribution := CASE
    WHEN NEW.agent_type = 'pl' AND NEW.is_active THEN NEW.rate
    ELSE 0
  END;

  v_old_contribution := CASE
    WHEN OLD.agent_type = 'pl' AND OLD.is_active THEN OLD.rate
    ELSE 0
  END;

  v_proposed_total := v_existing_sum + v_new_contribution;

  -- Only reject when the proposed total exceeds the cap AND this update is
  -- making things worse (or newly exceeding). Grandfather pre-existing excess.
  IF v_proposed_total > v_cap AND v_new_contribution > v_old_contribution THEN
    RAISE EXCEPTION
      'P/L rate cap exceeded on branch %: existing active sum %, proposed new contribution %, total % > cap %',
      NEW.branch_id,
      ROUND(v_existing_sum * 100, 2) || '%',
      ROUND(v_new_contribution * 100, 2) || '%',
      ROUND(v_proposed_total * 100, 2) || '%',
      ROUND(v_cap * 100, 2) || '%';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION _enforce_pl_rate_cap() IS
  'BEFORE UPDATE trigger on branch_agents: rejects rate/status changes that would push combined active P/L rate on a branch above fee_config.max_pl_agent_rate_sum (default 0.80). Grandfathers pre-existing excess — only blocks worse states. Defense-in-depth for approve_branch_agent.';

DROP TRIGGER IF EXISTS trg_branch_agents_pl_cap ON branch_agents;

CREATE TRIGGER trg_branch_agents_pl_cap
  BEFORE UPDATE ON branch_agents
  FOR EACH ROW
  WHEN (
    NEW.rate IS DISTINCT FROM OLD.rate
    OR NEW.is_active IS DISTINCT FROM OLD.is_active
    OR NEW.agent_type IS DISTINCT FROM OLD.agent_type
    OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
  )
  EXECUTE FUNCTION _enforce_pl_rate_cap();

-- Also fire on INSERT for completeness — approve_branch_agent already checks
-- but a direct INSERT into branch_agents would bypass.

CREATE OR REPLACE FUNCTION _enforce_pl_rate_cap_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
      ROUND(v_existing_sum * 100, 2) || '%',
      ROUND(NEW.rate * 100, 2) || '%',
      ROUND(v_proposed_total * 100, 2) || '%',
      ROUND(v_cap * 100, 2) || '%';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branch_agents_pl_cap_insert ON branch_agents;

CREATE TRIGGER trg_branch_agents_pl_cap_insert
  BEFORE INSERT ON branch_agents
  FOR EACH ROW
  WHEN (NEW.agent_type = 'pl' AND NEW.is_active = TRUE)
  EXECUTE FUNCTION _enforce_pl_rate_cap_insert();

COMMIT;
